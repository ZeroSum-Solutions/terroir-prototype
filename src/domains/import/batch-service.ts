// G1-4 — import batch lifecycle: confirm, apply (chunked, resumable),
// resolve, revert. Every function here takes the caller's session-scoped
// supabase client and always filters by restaurantId explicitly, in
// addition to (never instead of) the RLS policies added in 0076 — the
// same belt-and-suspenders pattern src/lib/reconcile-ledger uses.
//
// P3 (2026-08-23-p3-chunked-import.md) additions: content-hash re-upload
// idempotency (§2.2, C09), optional session/chunk context (§3.2), and the
// count_import_batch_rows/create_import_batch RPCs (§5, C03/C09) replacing
// the two uncapped/non-atomic client-side calls this file used to make.

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import { buildImportPreview, type PreviewRow, type RowOverrides } from "./preview-service";
import {
  OVERRIDES_DIGEST_STEM,
  canonicalizeApprovedLwinRows,
  canonicalizeConfirmExtras,
  canonicalizeConfirmExtrasV3,
  canonicalizeRejectedLwinRows,
  canonicalizeRowOverrides,
  extractFileDigestHex,
  isWellFormedDigestForFile,
} from "./confirm-digest";
import {
  applyLwinApprovalVeto,
  applyLwinRejections,
  checkApprovedLwinRows,
  checkRejectedLwinRows,
} from "./lwin-overrides";
import { checkMissingProducerAcknowledgement } from "./producer-acknowledgement";

export { applyLwinApprovalVeto, applyLwinRejections };

// Re-exported so this module's public surface is unchanged by the split: every
// existing `from "./batch-service"` import keeps resolving exactly as before.
export {
  canonicalizeApprovedLwinRows,
  canonicalizeConfirmExtras,
  canonicalizeConfirmExtrasV3,
  canonicalizeRejectedLwinRows,
  canonicalizeRowOverrides,
};
import { APPLY_CHUNK_SIZE } from "./constants";
import {
  revertImportBatchRpc,
  type ImportRevertError,
} from "./import-revert-rpc";
import {
  bulkResolveImportRowsRpc,
  resolutionInternalError,
  resolveImportRowRpc,
  type BulkResolveResult,
  type ResolveAction,
  type ResolveRowResult,
} from "./import-resolution-rpc";

export type {
  BulkResolveReceipt,
  BulkResolveResult,
  ResolveAction,
  ResolveRowReceipt,
  ResolveRowResult,
} from "./import-resolution-rpc";

// Round-4 audit finding 4 / round-5 audit finding 6: how many candidate rows
// findLiveBatchByUnderlyingFile reads before format-filtering in TS — see
// that function's own comment for why 20, and its post-read saturation
// check for what happens if contamination ever actually fills this.
const LIVE_BATCH_LOOKUP_LIMIT = 20;

// Namespace STEM for an overrides/rejections-bearing content_sha256 (see
// confirmImportBatch's own comment for the full format and why). Contains
// characters (":" ) that never appear in a bare hex sha256 digest, so a
// namespaced digest can never be confused with — or collide with — a
// bare-file digest by construction, not by hoping no file's bytes happen
// to look like one.
//
// Item 2 (per-row LWIN match visibility/rejection): this used to be the
// full literal prefix "overrides-v1:". Generalized to the STEM ("overrides-v",
// no version digit) with the version number appended at each construction
// site instead, so a second namespace (v2, for a confirm that carries
// rejectedLwinRows — see the digest-construction comment below) can be
// recognized everywhere a v1 digest already is, without silently missing
// it. Every place that used to hardcode the v1 literal now goes through
// this same stem:
//   - isWellFormedDigestForFile / extractFileDigestHex: their regexes now
//     match ANY version digit after the stem, not just "1".
//   - findLiveBatchesByUnderlyingFile's and findSiblingWithAppliedRows'
//     own `.or() ... .like.` patterns: unchanged in SHAPE
//     (`${STEM}%:${fileDigestHex}`) — the "%" wildcard already had to
//     absorb the sha256 hex blob, so it transparently absorbs "1:<hex>" or
//     "2:<hex>" too. No call-site change was needed there, only this
//     constant's value.
//
// Sol audit round 3, finding 2 (BLOCK 2): a THIRD namespace (v3, for a
// confirm that also carries approvedLwinRows — see the digest-construction
// comment below and canonicalizeConfirmExtrasV3's own comment) needed no
// further generalization here at all — every reader above already matches
// "ANY version digit"/"any 1:<hex> or 2:<hex> or ... suffix" by
// construction, so a v3 digest is recognized everywhere a v1 or v2 one
// already is, with zero additional changes to any of the sites listed
// above.

function summarize(rows: PreviewRow[]) {
  return {
    totalRows: rows.length,
    validRows: rows.filter((r) => r.rowState === "valid").length,
    errorRows: rows.filter((r) => r.rowState === "error").length,
    matchedRows: rows.filter((r) => r.lwinStatus === "matched").length,
    unmatchedRows: rows.filter((r) => r.rowState === "valid" && r.lwinStatus === "unmatched").length,
    missingCostRows: rows.filter((r) => r.rowState === "valid" && r.costStatus === "missing").length,
    readyToApplyRows: rows.filter((r) => r.resolution === "auto").length,
    pendingResolutionRows: rows.filter((r) => r.resolution === "pending").length,
  };
}

export type ConfirmBatchOptions = {
  /** P3 §3.2: this chunk belongs to a multi-batch onboarding session. */
  sessionId?: string;
  chunkIndex?: number;
  chunkTotal?: number;
  /** P3 §2.3: sha256 of the pre-split ORIGINAL file, from the chunk's own
   * manifest (scripts/validate-bulk-import.ts's PerChunkManifest.
   * source_csv_sha256) — checked against the session's own source_sha256
   * to reject a chunk from the wrong file being mixed in. Never confused
   * with content_sha256 (this SPECIFIC chunk's own bytes), which is
   * always computed server-side below, never client-supplied. */
  sourceSha256?: string;
  /** Inline row-fix overrides — let users fix rejected rows inline
   * instead of "fix the errors above and re-upload": keyed by the
   * 1-indexed data row number the operator saw in THIS SAME file's
   * own preview, each a partial set of canonical-field replacement text.
   * Applied inside buildImportPreview, after parsing but before
   * row-validator.ts's own validation runs — so server-side validation
   * stays the sole authority and a still-invalid override just rejects
   * that one row with the normal per-row reason, never a bypass. Also
   * folded into content_sha256 below — see the hash computation's own
   * comment for why. */
  rowOverrides?: RowOverrides;
  /** Item 2 (per-row LWIN match visibility/rejection) — row numbers (this
   * SAME file's own preview numbering, post intra-batch-duplicate-merge —
   * see checkRejectedLwinRows' own comment) the operator rejected a LWIN
   * match on. Applied once to the re-derived preview's own rows, via
   * applyLwinRejections, before BOTH the persisted rowsPayload and the
   * returned summary are built — a rejected row imports with no LWIN link
   * at all, exactly like a row that never matched (see applyLwinRejections'
   * own comment). Also folded into content_sha256 below, in its own v2
   * namespace — see the digest-construction comment for why. */
  rejectedLwinRows?: string[];
  /** Sol audit round 3, finding 2 (BLOCK 2) — row number (this SAME file's
   * own preview numbering, same convention as rejectedLwinRows above) ->
   * the lwin_id the operator actually saw and accepted for that row in
   * preview. Applied once, via applyLwinApprovalVeto, right after
   * applyLwinRejections — see that function's own comment for the full
   * veto mechanics and why this can never cause MORE (or different) to be
   * written than confirm's own from-scratch re-match already decided.
   *
   * BLOCK 1 (round 5 fix) — PRESENCE of this key (checked via
   * `!== undefined`, distinct from whether it canonicalizes to anything)
   * is itself meaningful now: it tells applyLwinApprovalVeto the client
   * showed the operator its FULL linking picture for this confirm, so any
   * currently-matched, apply-eligible row absent from it must fail closed
   * (dropped to unmatched) rather than being silently stamped — see that
   * function's own comment. The real client (import-client.tsx) always
   * sends this field now, even as `{}` for a file with zero linking
   * matches, for exactly this reason. Folded into content_sha256 below, in
   * its own v3 namespace when non-empty, or a NEW v4 namespace when present
   * but empty (a state the pre-fix client could never produce) — see the
   * digest-construction comment for why the two need to stay distinct. */
  approvedLwinRows?: Record<string, string>;
  /** SD-41 — how many producer-less rows the operator was shown and
   * acknowledged in preview; absent (an unacknowledging caller) is refused
   * outright when the file has any. producer-acknowledgement.ts carries the
   * whole argument, including why this is NOT part of content_sha256. */
  acknowledgedMissingProducerRows?: number;
};

export type ConfirmBatchResult =
  | { ok: true; alreadyExists: false; batchId: string; totalRows: number; summary: ReturnType<typeof summarize> }
  /** P3 §2.2 (C09): the exact bytes (or the same session+chunk_index)
   * were already confirmed as a live (non-reverted) batch — a resume
   * pointer, not a bare rejection. Re-applying is already idempotent
   * (§2.1), so the client's correct move is "call /apply on batchId
   * again," never "upload again." sessionId is the EXISTING batch's own
   * session (null if it has none) — the caller must compare this against
   * whatever session it thinks it's uploading into, since a content-hash
   * match can point at a batch from a completely different session. */
  /** Sol round-3 audit (2026-08-27) finding 3: chunkIndex is the EXISTING
   * batch's own chunk slot (null if it has none) — the caller must compare
   * this, together with sessionId, against the exact (session, chunkIndex)
   * slot it is confirming, since a content-hash match can point at a
   * different chunk of the SAME session (two sibling chunks with
   * identical bytes are a legitimate duplicate segment, never each
   * other's confirmation). */
  | { ok: true; alreadyExists: true; batchId: string; status: string; sessionId: string | null; chunkIndex: number | null; counts: BatchCounts }
  /** Round-27 audit (removes the in-preview conflict-recovery panel, which
   * failed five straight audits — see docs/runbooks/csv-import.md): a
   * multiple_live_batches conflict used to also carry every conflicting
   * batch's id/filename/status/created_at, plus a count and a
   * truncated-lower-bound flag, so the client could render a revert
   * affordance per candidate directly. That panel is gone; `message` (built
   * by reconcileLiveBatchesForFile) is now the only thing the client shows
   * for this conflict, and recovery is through Recent imports, which lists
   * every non-reverted batch. */
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        missingHeaders?: string[];
      };
    };

type RowPayload = {
  row_number: number;
  raw: Json;
  row_state: string;
  validation_errors: Json;
  lwin_status: string;
  lwin_id: string | null;
  lwin_score: number | null;
  cost_status: string;
  resolution: string;
  duplicate_reason: Json | null;
};

/**
 * Confirm an import: re-derives the full preview from the uploaded file
 * (never trusts a client-supplied preview) and persists it as one batch +
 * N rows via the create_import_batch RPC (0107) — a single function call
 * whose implicit transaction wraps the batch insert, the rows insert, and
 * tier-2 duplicate flagging together. A rows-insert failure rolls back the
 * batch insert too (C09): a failed confirm can never leave an orphaned,
 * empty batch behind.
 *
 * content_sha256 is computed here, over the RAW fileBuffer, BEFORE
 * buildImportPreview's internal decodeCsvBuffer() call ever runs — hashing
 * post-decode text could let two byte-for-byte-different uploads collide,
 * or the same file hash differently across two decode passes (§2.2).
 */
export async function confirmImportBatch(
  supabase: SupabaseClient<Database>,
  restaurantId: string,
  userId: string,
  filename: string,
  fileBuffer: Buffer,
  options: ConfirmBatchOptions = {},
): Promise<ConfirmBatchResult> {
  const preview = await buildImportPreview(supabase, fileBuffer, options.rowOverrides);
  if (!preview.ok) {
    return { ok: false, error: preview.error };
  }
  if (preview.rows.length === 0) {
    return { ok: false, error: { code: "empty_file", message: "CSV has no data rows." } };
  }

  // Item 2 (per-row LWIN match visibility/rejection): bounds-check, then
  // apply, the operator's rejected-match set ONCE here — before BOTH the
  // persisted rowsPayload and the returned summary are built below, so the
  // two can never disagree about which rows carry a LWIN link (decision 5,
  // item-2 brief). `rows` (not `preview.rows`) is used for everything past
  // this point.
  const rejectedCheck = checkRejectedLwinRows(options.rejectedLwinRows, preview.rows);
  if (!rejectedCheck.ok) {
    return { ok: false, error: rejectedCheck.error };
  }
  // Sol audit round 3, finding 2 (BLOCK 2): bounds-checked the same way,
  // then applied AFTER rejections — see applyLwinApprovalVeto's own
  // comment for the full veto mechanics and why this call order matters.
  const approvedCheck = checkApprovedLwinRows(options.approvedLwinRows, preview.rows);
  if (!approvedCheck.ok) {
    return { ok: false, error: approvedCheck.error };
  }
  // BLOCK 1 (round 5 fix): presence, not non-emptiness, is what tells
  // applyLwinApprovalVeto whether this confirm carries the operator's full
  // linking picture — see that function's own comment for why. Computed
  // from options.approvedLwinRows directly (never from
  // approvedCheck.approvedByRowNumber.size), because an explicitly empty
  // `{}` payload — "the operator's preview showed zero linking matches" —
  // must engage the fail-closed veto exactly like a non-empty one does,
  // and a Map built from `{}` has size 0 indistinguishable from one built
  // from `undefined`.
  const hasLwinFullPicture = options.approvedLwinRows !== undefined;
  const rows = applyLwinApprovalVeto(
    applyLwinRejections(preview.rows, rejectedCheck.rowNumbers),
    approvedCheck.approvedByRowNumber,
    hasLwinFullPicture,
  );

  // SD-41 — the blank-producer gate, checked before a single row is
  // persisted, against confirm's OWN re-derived rows (overrides applied).
  const producerCheck = checkMissingProducerAcknowledgement(options.acknowledgedMissingProducerRows, rows);
  if (!producerCheck.ok) return { ok: false, error: producerCheck.error };

  // content_sha256 identity, extended for inline row-fix overrides: an
  // override changes the EFFECTIVE content of this confirm, so two
  // requests for byte-identical file content but different overrides
  // must never collide as "the same upload" (§2.2's own resume/dedup
  // logic would otherwise silently resume the WRONG fix). Conversely,
  // the same file with the SAME overrides must still resume exactly as
  // before — and a request with NO overrides (every batch confirmed
  // before this feature existed, and the overwhelming common case going
  // forward) must hash to EXACTLY the bare-file digest, unchanged, so
  // every content_sha256 already in the database keeps resolving.
  //
  // Sol audit (2026-08-27) finding 2: an EARLIER version of this hashed
  // SHA256(fileBuffer || tag || overridesJson) — one hash over the
  // CONCATENATION of file bytes and the overrides blob. That is
  // ambiguous: a crafted bare file (no overrides at all) whose own bytes
  // happen to equal `<some other file's bytes><tag><that file's overrides
  // JSON>` hashes to the exact same digest as that other, legitimately
  // overridden batch — a real collision, not merely a theoretical one
  // (the auditor constructed one). Concatenating into one hash INPUT can
  // never be made safe by picking a "safer" separator; the fix is to
  // never let a bare-file digest and an overrides-bearing digest share
  // the same STRING FORMAT at all. So: hash the file and the canonical
  // overrides JSON SEPARATELY, then join them with the OVERRIDES_DIGEST_STEM
  // (contains ":", which never appears in a bare hex digest) into a
  // string that cannot equal any bare 64-char-hex digest by construction
  // — not by hoping no file's bytes happen to collide. content_sha256 is
  // `text` in the DB (supabase/schema.snapshot.sql), not a fixed-length
  // column, so there is no length constraint forcing this into 64 hex
  // characters; the readable, unambiguous form is used instead.
  // canonicalizeRowOverrides fixes key order (numeric row order, then
  // CANONICAL_HEADERS field order) so one override SET always hashes
  // identically regardless of client-side object key order.
  //
  // Item 2 (per-row LWIN match visibility/rejection): rejectedLwinRows is a
  // SECOND, independent thing that changes this confirm's effective
  // content — two requests for the same file and the same (or no)
  // overrides but DIFFERENT rejected matches must not collide as "the same
  // upload" either, for the identical reason overrides don't (§2.2's
  // resume/dedup logic would otherwise silently resume the wrong set of
  // rejections). Three cases, by whether either extra is present:
  //   - neither present  -> the bare fileDigestHex, byte-for-byte UNCHANGED
  //     from before this feature existed.
  //   - overrides only   -> `overrides-v1:<sha256(overridesJson)>:<fileDigestHex>`,
  //     byte-for-byte UNCHANGED from before this feature existed — real
  //     batches already exist in exactly this shape.
  //   - rejections present (with or without overrides too), but no
  //     approved-match set -> a NEW, previously-unwritten
  //     `overrides-v2:<sha256(combinedJson)>:<fileDigestHex>` namespace,
  //     folding both extras into one canonical blob (canonicalizeConfirmExtras)
  //     so a confirm that changes EITHER one hashes differently.
  //     Namespacing rejections onto v1 instead (rather than minting v2)
  //     would make an overrides-only confirm and a rejections-only confirm
  //     of the same file indistinguishable from each other whenever their
  //     combined JSON happened to canonicalize the same length — v2 avoids
  //     that ambiguity by construction, at the cost of one more namespace
  //     every downstream reader must recognize (see OVERRIDES_DIGEST_STEM's
  //     own comment for where).
  //   - an approved-match set present (BLOCK 2, Sol audit round 3 finding 2,
  //     with or without overrides/rejections too) -> a THIRD,
  //     previously-unwritten `overrides-v3:<sha256(combinedJson)>:<fileDigestHex>`
  //     namespace (canonicalizeConfirmExtrasV3), for the identical reason
  //     v2 exists: two requests differing only in which lwin_id the
  //     operator approved must not collide as "the same upload" either.
  //     v3 is minted rather than reusing/extending v2's shape so every
  //     already-written v2 digest (rejections, no approvals) keeps hashing
  //     exactly as it always has — see canonicalizeConfirmExtrasV3's own
  //     comment for why it's a separate function, not a 3rd argument
  //     bolted onto canonicalizeConfirmExtras.
  //   - BLOCK 1 (round 5 fix): an approved-match set present but EMPTY (or
  //     every entry malformed — impossible in practice, since
  //     checkApprovedLwinRows above already rejects the whole confirm on a
  //     malformed entry, but canonicalizeApprovedLwinRows' own null-collapse
  //     is written to treat it identically to `{}` regardless) -> a FOURTH,
  //     previously-unwritten `overrides-v4:<sha256(combinedJson)>:<fileDigestHex>`
  //     namespace. This state — hasLwinFullPicture true, yet
  //     approvedLwinRowsCanonicalJson null — could never occur before this
  //     round: the pre-fix client only ever sent approvedLwinRows when
  //     non-empty (buildApprovedLwinRows' own `if (Object.keys(...).length >
  //     0)` guard, since removed — see import-client.tsx). It now means
  //     something the v1/v2 tiers' own "no approvedLwinRows" null-collapse
  //     never had to mean: "the operator's preview showed zero linking
  //     matches, and applyLwinApprovalVeto's fail-closed veto is engaged for
  //     this confirm" — a REAL difference in what gets WRITTEN relative to a
  //     v1/v2/bare confirm of the identical file/overrides/rejections (where
  //     hasLwinFullPicture is false and the veto never runs at all). Folding
  //     it into v1/v2's own bytes would let a full-picture-but-nothing-
  //     approved confirm dedupe-collide with an old-style permissive one —
  //     resolving to whichever batch was created FIRST via the
  //     (restaurant_id, content_sha256) lookup, silently skipping this
  //     confirm's own veto. v4 reuses canonicalizeConfirmExtras (v2's own
  //     2-key blob), not a new 3-key function: approvedLwinRowsCanonicalJson
  //     is always null on this branch, so a 3rd "approvedLwinRows: null" key
  //     would add nothing beyond what the STEM DIGIT ALONE ("4" vs "2")
  //     already guarantees — the digit sits outside the hashed bytes, so v2
  //     and v4 can share an identical combinedCanonicalJson for the same
  //     overrides/rejections and still never collide.
  const overridesCanonicalJson = canonicalizeRowOverrides(options.rowOverrides);
  const rejectedLwinRowsCanonicalJson = canonicalizeRejectedLwinRows(options.rejectedLwinRows);
  const approvedLwinRowsCanonicalJson = canonicalizeApprovedLwinRows(options.approvedLwinRows);
  const fileDigestHex = createHash("sha256").update(fileBuffer).digest("hex");
  let contentSha256: string;
  if (overridesCanonicalJson === null && rejectedLwinRowsCanonicalJson === null && !hasLwinFullPicture) {
    contentSha256 = fileDigestHex;
  } else if (rejectedLwinRowsCanonicalJson === null && !hasLwinFullPicture) {
    contentSha256 = `${OVERRIDES_DIGEST_STEM}1:${createHash("sha256").update(overridesCanonicalJson!).digest("hex")}:${fileDigestHex}`;
  } else if (!hasLwinFullPicture) {
    const combinedCanonicalJson = canonicalizeConfirmExtras(overridesCanonicalJson, rejectedLwinRowsCanonicalJson);
    contentSha256 = `${OVERRIDES_DIGEST_STEM}2:${createHash("sha256").update(combinedCanonicalJson).digest("hex")}:${fileDigestHex}`;
  } else if (approvedLwinRowsCanonicalJson !== null) {
    const combinedCanonicalJson = canonicalizeConfirmExtrasV3(
      overridesCanonicalJson,
      rejectedLwinRowsCanonicalJson,
      approvedLwinRowsCanonicalJson,
    );
    contentSha256 = `${OVERRIDES_DIGEST_STEM}3:${createHash("sha256").update(combinedCanonicalJson).digest("hex")}:${fileDigestHex}`;
  } else {
    const combinedCanonicalJson = canonicalizeConfirmExtras(overridesCanonicalJson, rejectedLwinRowsCanonicalJson);
    contentSha256 = `${OVERRIDES_DIGEST_STEM}4:${createHash("sha256").update(combinedCanonicalJson).digest("hex")}:${fileDigestHex}`;
  }

  // Sol round-2 audit (2026-08-27) finding 2: overrides (or the lack of them)
  // namespace a confirm's content_sha256, so the DB's own (restaurant_id,
  // content_sha256) unique index can never catch "same file, different —
  // or no — fixes" as a duplicate; each combination hashes differently
  // and would otherwise create its own live batch, importing the same
  // valid rows again. Checked proactively, BEFORE the create RPC, because
  // the unique index has no way to express this cross-format identity at
  // all — a genuine race (another request's insert lands between this
  // check and the RPC call) still 23505s on an EXACT content_sha256
  // match, handled separately by findDuplicateBatch below. The exact
  // (session, chunkIndex) slot this confirm targets is excluded here —
  // that is finding 1's territory (a real content change within one
  // chunk's own retry loop), surfaced as chunk_content_mismatch by
  // findDuplicateBatch's 23505 fallback, never silently resumed here as
  // a plain duplicate.
  // Sol round-3 audit (2026-08-27) finding 3: a sibling chunk of the SAME
  // session carrying identical bytes is a legitimate duplicate segment
  // (e.g. a duplicated export range), never this confirm's own slot — the
  // WHOLE session is excluded here, not just the exact (session,
  // chunkIndex) slot the old code excluded. The exact-slot retry case
  // (same chunk re-submitted, content changed or not) is still handled
  // exactly as before: excluded here by the same session exclusion, then
  // decided by the create RPC's own unique index + findDuplicateBatch's
  // 23505 fallback below (idempotent resume, or chunk_content_mismatch).
  //
  // Round-7 audit finding 1: this is an about-to-hand-out-a-resume-pointer
  // site, so it goes through reconcileLiveBatchesForFile rather than the
  // bare oldest-first lookup — see that function's own comment for why
  // "oldest" alone can hand a new client an unapplied orphan while the
  // actual survivor is being applied elsewhere.
  const preCheck = await reconcileLiveBatchesForFile(supabase, restaurantId, fileDigestHex, {
    excludeSessionId: options.sessionId,
  });
  if (!preCheck.ok) {
    // Sol round-3 audit finding 4: fail CLOSED on a lookup error — never
    // fall through to create_import_batch when we couldn't actually check
    // for a duplicate.
    return { ok: false, error: preCheck.error };
  }
  if (preCheck.match) {
    // Round-28 audit, BLOCK 1: the underlying-file lookup that produced
    // preCheck.match matches ACROSS every content_sha256 namespace on
    // purpose (see reconcileLiveBatchesForFile's and
    // findLiveBatchesByUnderlyingFile's own comments) — it exists to
    // detect siblings/races for the SAME file, not to prove the candidate
    // it finds was confirmed under THIS request's own approvals. When a
    // candidate's content_sha256 disagrees with what THIS confirm just
    // minted, it was persisted under different effective content — but
    // "different effective content" has TWO, differently-risky causes
    // (see the digest-construction comment above): different rowOverrides
    // (row-fix TEXT — bounded by row-validator.ts's own validation either
    // way, and idempotently resuming across override formats is a
    // pre-existing, deliberately-designed feature — see "underlying-file
    // idempotency across override formats", Sol audit finding 2, and its
    // own pinned tests below), or a different LWIN approval/rejection
    // decision (rejectedLwinRows / approvedLwinRows — which rows get a
    // catalogue LINK WRITTEN AT ALL). Only the second is the hazard this
    // round's audit reported: resuming a sibling whose rows were stamped
    // under someone ELSE's approval decision lets THIS confirm's own
    // rejection, or its `{}` "nothing approved" full picture, be silently
    // bypassed by an older/rival batch's already-persisted stamps. This
    // was reachable with an EMPTY fake batch table in the pre-fix test
    // suite because the hole is specifically about a live SIBLING existing
    // with disagreeing content, never exercised by a table with nothing
    // in it.
    //
    // Round-29 audit, BLOCK 2: the previous version of this fix (round-28)
    // refused the resume ONLY when THIS confirm's own request carried an
    // LWIN approval/rejection signal (`hasLwinApprovalSignal` below) —
    // reasoning that a confirm with neither field set carries no operator
    // decision that a stale sibling could be overriding, so any digest
    // mismatch in that case "can only stem from rowOverrides." That
    // reasoning is FALSE: an OMITTING caller (neither field set,
    // `hasLwinApprovalSignal` false) can still be resumed onto a candidate
    // whose OWN digest is v2/v3/v4-namespaced — i.e. a candidate that
    // itself encodes a PRIOR confirm's LWIN approvals/rejections. Silently
    // resuming it hands out that old batch's stale LWIN-linked rows,
    // bypassing whatever this confirm's own (omitted-signal) re-match
    // would have decided, with no signal to the caller at all.
    //
    // The contract, corrected: resume is refused whenever the digests
    // disagree AND *either* side of the comparison could hold an LWIN
    // decision the other side never agreed to —
    //   - `hasLwinApprovalSignal`: THIS confirm's own request carries an
    //     approval/rejection decision (unchanged from round-28), or
    //   - `digestTierEncodesLwinState(preCheck.match.content_sha256)`: the
    //     CANDIDATE's own digest tier (v2/v3/v4) encodes a decision from
    //     WHATEVER confirm originally minted it, regardless of what this
    //     request carries.
    // Only when NEITHER holds — this request carries no LWIN signal AND
    // the candidate is bare-or-v1-tier, meaning its digest cannot encode
    // an LWIN decision at all — can a mismatch be proven to stem from
    // rowOverrides alone. That is exactly the pre-existing,
    // separately-audited "resume across override formats" idempotency
    // feature, and it still resumes exactly as before.
    //
    // Refused as the SAME conflict shape reconcileLiveBatchesForFile itself
    // already returns for 2+ live candidates: a terminal, non-retryable
    // error naming the condition, resolved by the operator reverting the
    // stale batch from Recent imports before confirming this version —
    // never a silent reuse, and never an attempt to create a second live
    // batch here (which would only chase the exact same conflict through
    // the POST-check SEER-YIELDS path below, at the cost of a wasted
    // insert+revert round trip). A genuine same-request retry (identical
    // file, identical overrides/rejections/approvals) still mints the
    // identical contentSha256 and resumes exactly as before — this only
    // narrows which MISMATCHED siblings count as a resume target, never a
    // real retry's own digest match.
    //
    // API-CALLER-VISIBLE CONTRACT: a confirm is resumable onto a live
    // sibling for the same file if and only if the two differ ONLY in
    // rowOverrides (row-fix text) — never if either side's digest could
    // encode a different rejected/approved LWIN decision, whether or not
    // THIS request happens to state one explicitly.
    const hasLwinApprovalSignal = hasLwinFullPicture || rejectedLwinRowsCanonicalJson !== null;
    const candidateEncodesLwinState =
      preCheck.match.content_sha256 !== null && digestTierEncodesLwinState(preCheck.match.content_sha256);
    if (preCheck.match.content_sha256 !== contentSha256 && (hasLwinApprovalSignal || candidateEncodesLwinState)) {
      // NIT 6 (round-29 audit): the old wording claimed the disagreement
      // was specifically "different LWIN match approvals or rejections" —
      // overstated, since a v3/v4 digest hashes row overrides TOGETHER
      // with LWIN state (see the digest-construction comment above), so
      // two confirms with IDENTICAL approvals but different row fixes hit
      // this same branch. All the digest mismatch actually proves is
      // "different content" of some kind; it cannot say which kind. The
      // `multiple_live_batches` code is reused here (the same conflict
      // shape reconcileLiveBatchesForFile returns for a genuine 2+-way
      // race) even though only ONE live batch is involved on this path —
      // kept for the client's existing code-based handling (see
      // import-client.tsx/session-step.tsx), but the message itself no
      // longer implies a specific cause or a specific count.
      return {
        ok: false,
        error: {
          code: "multiple_live_batches",
          message:
            "This file already has a live import confirmed with different content (row fixes and/or LWIN match " +
            "approvals or rejections) — this can't be resumed automatically. Revert it from Recent imports before " +
            "confirming this version.",
        },
      };
    }
    return toAlreadyExistsResult(supabase, preCheck.match);
  }

  const rowsPayload: RowPayload[] = rows.map((row) => ({
    row_number: row.rowNumber,
    raw: row.raw as unknown as Json,
    row_state: row.rowState,
    validation_errors: row.errors as unknown as Json,
    lwin_status: row.lwinStatus,
    lwin_id: row.lwinId,
    lwin_score: row.lwinScore,
    cost_status: row.costStatus,
    resolution: row.resolution,
    duplicate_reason: row.duplicateReason as unknown as Json | null,
  }));

  const { data, error } = await supabase.rpc("create_import_batch", {
    p_restaurant_id: restaurantId,
    p_created_by: userId,
    p_filename: filename,
    p_total_rows: rows.length,
    p_rows: rowsPayload,
    p_session_id: options.sessionId ?? null,
    p_chunk_index: options.chunkIndex ?? null,
    p_chunk_total: options.chunkTotal ?? null,
    p_content_sha256: contentSha256,
    p_source_sha256: options.sourceSha256 ?? null,
  } as never);

  if (error) {
    const pgError = error as { code?: string; message?: string };

    if (pgError.code === "23505") {
      const existing = await findDuplicateBatch(supabase, restaurantId, contentSha256, options);
      if (existing) return existing;
      // A 23505 means SOME row already satisfies the unique index — if we
      // can't find it, fail loudly rather than silently reporting success.
      throw error;
    }
    if (pgError.code === "P0002") {
      return { ok: false, error: { code: "session_not_found", message: pgError.message ?? "Import session not found." } };
    }
    if (pgError.code === "P0006") {
      return { ok: false, error: { code: "session_source_mismatch", message: pgError.message ?? "Chunk source file does not match this session." } };
    }
    throw error;
  }

  const batchId = (data as { batchId: string }).batchId;

  // Sol round-3 audit (2026-08-27) finding 2, corrected by round-4 audit
  // finding 1: decide-AFTER-write TOCTOU close. The pre-check above ran
  // BEFORE this insert — two concurrent confirms for the same underlying
  // file but different content_sha256 FORMATS (one bare, one
  // overrides-v1-namespaced; the unique index from 0103 is an exact
  // content_sha256 match and can't catch this) can both pass their own
  // pre-check and both reach create_import_batch. Re-run the identical
  // lookup now, excluding our own just-created batch (and our own
  // session, for the same reason as the pre-check).
  //
  // Round-4 audit finding 1: the previous version of this comment claimed
  // a deterministic (created_at, id) total order picks a single survivor.
  // That is WRONG — created_at is the row's INSERT-TRANSACTION-START time
  // (effectively `now()`), not commit order, and under read-committed a
  // transaction that starts first can still commit last. Concretely: A
  // starts first (earlier created_at) but commits slowly; B starts later,
  // commits first, runs its post-check, sees nothing committed yet (A
  // hasn't committed), and survives; A then commits, runs its post-check,
  // sees B — but the (created_at, id) rule said A was "older", so A
  // ALSO survived. Two live batches, precisely the bug this function
  // exists to prevent.
  //
  // The fix is the unconditional SEER-YIELDS rule: any confirm whose
  // post-create check observes ANY rival live batch over the same
  // underlying file reverts ITSELF, full stop — no timestamp comparison,
  // no "who is older" logic at all.
  //
  // Why this can never leave two survivors, under every interleaving:
  // each request's post-check runs strictly AFTER its own insert has
  // committed (the very next thing this function does, in the same
  // request, using the same connection). Consider two racing confirms A
  // and B. A batch survives ONLY if its own post-check sees no rival —
  // i.e. the rival's insert had not yet committed when this batch's
  // post-check ran. Suppose (for contradiction) BOTH A and B survive:
  // then A's post-check ran before B's commit, AND B's post-check ran
  // before A's commit. But A's own commit precedes A's post-check
  // (same request, sequential) precedes B's commit (assumed) — so A's
  // commit precedes B's commit. Symmetrically B's commit precedes A's
  // commit. Both can't hold at once, so at most one of A/B can have seen
  // no rival — at most one survivor, for any two-way race, and by the
  // same pairwise argument for any N-way race (a batch only survives if
  // NO other rival was already committed when its own post-check ran,
  // and the earliest committer is the only batch that can possibly
  // satisfy that for every other rival).
  //
  // The residual: it is possible for BOTH post-checks to see each other
  // (A's post-check happens to run after B's commit, and vice versa —
  // e.g. both inserts commit before either post-check starts). Then BOTH
  // self-revert unconditionally, under this rule — zero survivors, never
  // two. A retry from either client then re-enters this function from
  // scratch and hits the ordinary PRE-check, which resolves against
  // whichever batch (if any) is now the sole survivor.
  //
  // Round-5 audit finding 1 — SCOPE of the proof above: "at most one
  // survivor" is proven for every interleaving of two SUCCESSFUL
  // post-checks. It says nothing about a post-check that itself FAILS
  // (a lookup error, not "no rival found") — that is a distinct case,
  // handled explicitly below by selfRevertAndRetry: a failure to verify
  // is treated exactly like a rival was actually seen, never like "no
  // rival, safe to survive". Every path out of this function past the
  // insert — success, sees a rival, or can't tell — either returns a
  // survivor whose post-check genuinely saw no rival, or reverts-BEFORE-
  // returning. A single failure (the post-check call, or the revert it
  // triggers) can therefore never itself produce two live survivors; it
  // can only ever leave OUR OWN batch live (see selfRevertAndRetry's own
  // comment for that residual) or ask for a retry.
  //
  // Round-5 audit finding 7: this residual — and the "both self-revert"
  // case above — assume retries are HUMAN-triggered, arriving with
  // natural timing jitter (a page reload, a re-click), not two processes
  // racing to resubmit in lockstep. Two literally-simultaneous automated
  // retries COULD repeat a zero-survivor round again — that is still
  // SAFE (never a duplicate, just another round of the same protocol) and
  // converges given any real-world timing variance between the two
  // retries; it is not a scenario this codebase needs to engineer around.
  const postCheck = await findLiveBatchByUnderlyingFile(supabase, restaurantId, fileDigestHex, {
    excludeSessionId: options.sessionId,
    excludeBatchId: batchId,
  });
  if (!postCheck.ok) {
    // Round-5 audit finding 1: a lookup ERROR here is not evidence there's
    // no rival — it's evidence we can't tell. Treating it as "no rival,
    // batch survives" would let an unverified batch stay live opposite a
    // concurrent confirm that also can't see it (findLiveBatchByUnderlyingFile
    // is symmetric — the SAME lookup backs both this batch's and the
    // rival's own post-check). Fail exactly like seeing a rival: self-revert.
    return selfRevertAndRetry(supabase, restaurantId, batchId);
  }

  if (postCheck.match) {
    // We saw a rival that was already committed — yield unconditionally.
    // Nothing has applied yet — apply only ever starts after this confirm
    // call returns — so undoing our own batch is always safe.
    //
    // Round-5 audit finding 2(a): this used to re-read the rival's CURRENT
    // status and, if still live, return an already-exists result pointing
    // at it directly. That is itself a race: the rival may be mid its OWN
    // self-revert on a different connection, and even a fresh read here
    // can't prove it won't revert a moment later, before the client acts
    // on the pointer. Never hand back already-exists from this path at
    // all — always ask for a retry. A retry re-enters this function from
    // scratch and resolves through the ordinary PRE-check, whose
    // already-exists path (toAlreadyExistsResult) is itself hardened
    // (finding 2(b)) to re-verify a target's live status immediately
    // before ever handing it out as a resume pointer.
    return selfRevertAndRetry(supabase, restaurantId, batchId);
  }

  return {
    ok: true,
    alreadyExists: false,
    batchId,
    totalRows: rows.length,
    summary: summarize(rows),
  };
}

/** Self-revert OUR just-created batch and hand back the retryable
 * duplicate_race_retry error — the SEER-YIELDS "we lost, or can't prove we
 * didn't" outcome (round-5 audit findings 1 and 2(a)). Used identically
 * whether we can PROVE a rival exists (postCheck.match) or merely CAN'T
 * PROVE we're clear (the postCheck lookup itself failed) — an inability to
 * verify is not evidence of safety, so it's treated exactly like seeing a
 * rival, never like "no rival, safe to survive".
 *
 * Nothing has applied yet — apply only ever starts after confirm returns —
 * so undoing our own batch is always safe. import_batches/import_batch_rows
 * both have DELETE REVOKEd from `authenticated` (0076) and migrations are
 * locked for this fix, so a literal DELETE is out of reach; revert_import_batch
 * (already TS-layer-reachable, and — per the auditor — migration 0109
 * permits reverting a batch that was only just created, since its guard is
 * "status <> reverted", not "status = completed") is the equivalent move
 * here — it flips our batch to status='reverted' (0 rows to revert, since
 * nothing was ever applied), which every live-batch lookup in this file
 * already treats as gone via .neq("status","reverted"): functionally
 * indistinguishable from deleted to every future confirm.
 *
 * Round-6 audit finding 1: retries the revert call ONCE, immediately, if
 * the first attempt fails — a transient failure (a dropped connection, a
 * momentary lock conflict) is far more likely than a durable one, and a
 * successful second attempt fully closes the orphan instead of leaving it
 * for a later confirm to stumble onto. If BOTH attempts fail, this now
 * returns the SAME retryable duplicate_race_retry a successful revert
 * does, never the old, distinct duplicate_check_failed code — see the
 * proof below for why that convergence is correct, not merely convenient.
 *
 * FAILURE-ATOMICITY, corrected again (round-6 finding 1, round-7 finding 1,
 * then HONESTY-CORRECTED round-10/round-11): earlier versions of this
 * comment claimed the invariant this file maintains is "at most one live
 * batch [for a given underlying file] at any time," then narrowed that
 * (round-7) to "at most one live batch is ever APPLIED per underlying
 * file," with points 3-4 below describing reconciliation as actively
 * choosing a survivor and reverting every other live candidate to make
 * that hold. Round 10 deleted that authority entirely — see
 * reconcileLiveBatchesForFile's own comment: it now NEVER calls
 * revertImportBatch, only reads and reports. With 0 or 1 live candidates
 * it resumes the match; with 2 or more it returns a terminal
 * multiple_live_batches error naming every candidate ITS OWN LOOKUP FOUND
 * (findLiveBatchesByUnderlyingFile is capped at LIVE_BATCH_LOOKUP_LIMIT —
 * WARN 5, round-13 audit — so this is "every candidate within that cap,"
 * not a literal guarantee of completeness beyond it) and leaves ALL of
 * them live — recovery is an operator reverting by hand from Recent
 * imports (round-27 audit: it lists every non-reverted batch for the
 * restaurant, not just the ten newest). So neither older claim holds any more: this
 * file does not guarantee at most one live batch, and does not guarantee
 * at most one applied batch either — that would-be guarantee is what
 * findSiblingWithAppliedRows' own comment now documents as a NARROWED
 * race, not a closed one (0108 locks only its own batch's row; two
 * sibling applies can still both pass that guard and both persist
 * inventory).
 *
 * What THIS function's own failure mode actually leaves behind:
 *   1. Applying a batch requires a CLIENT holding that batch's own id (the
 *      apply endpoint is called with a specific batchId) — apply is never
 *      driven by a server-side scan that could stumble onto B on its own.
 *   2. B's own client (the request that failed to create/self-revert it)
 *      never received a batchId to apply: every path that reaches this
 *      function returns an ERROR for that request (never
 *      `{ ok: true, batchId: B }`). HONESTY-CORRECTED (round-13 audit,
 *      BLOCK 3): earlier wording concluded from this that "no client
 *      anywhere holds a pointer to B" — false. GET /api/import/batches
 *      lists every live batch for the restaurant with no per-creator
 *      filter (api/import/batches/route.ts's getBatches), and the import
 *      UI's own Recent imports section renders every one of them (round-27
 *      audit: no longer capped at the newest ten) with an Open/Apply
 *      affordance (RecentImports, import-client.tsx) — any authenticated
 *      member of this restaurant can reach and open B that way, not only
 *      via a later confirm's own pre-check (point 3, below).
 *   3. A revert-failure here leaves B live alongside whatever rival (A)
 *      it lost to. The NEXT confirm attempt for the SAME underlying file,
 *      by any client, re-enters reconcileLiveBatchesForFile's pre-check,
 *      which now sees 2 (or more) live candidates for the file and
 *      returns the terminal multiple_live_batches conflict — it does NOT
 *      pick a survivor or revert anything automatically. B does not
 *      resolve itself; an operator has to revert it (or A) by hand from
 *      Recent imports (point 2).
 * A revert-failure orphan is still not, by itself, a data hazard.
 * HONESTY-CORRECTED (round-13 audit, BLOCK 3): this is NOT because B is
 * unreachable — it is reachable (point 2) — it's because the safeguards
 * that actually matter here don't depend on that. Reconciliation still
 * never auto-picks a survivor once 2+ live candidates exist for the file
 * (returns the terminal multiple_live_batches conflict instead, same as
 * any other multi-candidate conflict), and findSiblingWithAppliedRows' own
 * apply-time guard (see its own comment) refuses to apply ANY batch for a
 * file — B included — once a sibling already has applied rows. A member
 * who opens B from Recent imports and applies it either hits that guard or
 * legitimately applies it as the surviving import for that file, exactly
 * like resolving any other multiple_live_batches conflict by hand — never
 * a distinct hazard unique to a revert-failure orphan. (The distinct
 * hazard that CAN cause the same underlying content to be applied twice —
 * two sibling batches both applying concurrently — is the narrower race
 * findSiblingWithAppliedRows' own comment documents; it is unrelated to
 * whether a self-revert here succeeded.) That is what makes "retry once,
 * then report the same retryable outcome either way" still the right
 * shape for THIS function: unlike the old duplicate_check_failed branch
 * (which existed only because a live-but-unverified batch felt unsafe to
 * treat like an ordinary duplicate), there is no unsafe state left to
 * signal separately here — a failed revert produces a leftover orphan
 * batch needing manual cleanup, same as a successful one produces nothing to
 * clean up; the caller gets the same instruction either way: retry the
 * upload (and, if that now reports a conflict, revert the duplicate).
 *
 */
async function selfRevertAndRetry(
  supabase: SupabaseClient<Database>,
  restaurantId: string,
  batchId: string,
): Promise<ConfirmBatchResult> {
  // The strict revert caller maps every database/refusal outcome to a fixed
  // result. Collapse that result to a boolean here because this confirm-time
  // race recovery has one safe response to any failure: retry once, then
  // return the existing retryable duplicate-race outcome.
  const tryRevertOnce = async (): Promise<boolean> => {
    try {
      return (await revertImportBatch(supabase, restaurantId, batchId)).ok;
    } catch {
      return false;
    }
  };

  let reverted = await tryRevertOnce();
  if (!reverted) {
    // Round-6 audit finding 1: one immediate retry. See this function's
    // own comment above for why a second failure is still safe to report
    // as the ordinary retryable outcome below, rather than a distinct
    // "unsafe, can't verify" error.
    reverted = await tryRevertOnce();
  }

  return {
    ok: false,
    error: {
      code: "duplicate_race_retry",
      message: reverted
        ? "This upload raced with a duplicate confirm of the same file, and both attempts were withdrawn to avoid a conflict. Please retry the upload."
        // Round-27 audit (removes the in-preview conflict-recovery panel,
        // which failed five straight audits — see docs/runbooks/
        // csv-import.md): the old wording pointed at that panel. Recovery
        // is now Recent imports, which lists every non-reverted batch for
        // this restaurant (no ten-newest cap), so the orphan this call
        // failed to withdraw is always reachable there once it exists.
        : "This upload raced with a duplicate confirm of the same file and could not be fully withdrawn on this " +
          "attempt. It will not resolve itself — retrying will report a conflict naming the other duplicate, which " +
          "you can revert under Recent imports. Please retry the upload.",
    },
  };
}

/** Reads back a batch's CURRENT (post-any-revert) status, session and
 * chunk slot by primary key — used by toAlreadyExistsResult (round-5 audit
 * finding 2(b)) to re-verify a resume-pointer target's live status
 * immediately before handing it out, rather than trusting a snapshot read
 * by whichever query found the match (the pre-check's own read, or the
 * 23505 fallback's). Returns null on a missing row OR a lookup error —
 * both are treated identically by the caller (fail toward the safe,
 * explicitly-retryable outcome, never toward an already-exists pointing
 * at a batch that may no longer be live). */
async function readBatchLiveState(
  supabase: SupabaseClient<Database>,
  batchId: string,
): Promise<{ id: string; status: string; session_id: string | null; chunk_index: number | null } | null> {
  const { data, error } = await supabase
    .from("import_batches")
    .select("id, status, session_id, chunk_index")
    .eq("id", batchId)
    .maybeSingle();
  if (error) return null;
  return (data as { id: string; status: string; session_id: string | null; chunk_index: number | null } | null) ?? null;
}

/** Looks up the pre-existing live batch a 23505 from create_import_batch
 * must be referring to — either a content_sha256 match (works with or
 * without a session) or, failing that, a (session_id, chunk_index) match.
 * Returns null only if neither lookup finds anything, which the caller
 * treats as "fail loudly" rather than silently swallowing the conflict.
 *
 * Sol audit (2026-08-27) finding 1: the (session_id, chunk_index) fallback
 * used to resume whatever batch already held that chunk slot WITHOUT ever
 * checking whether its stored content_sha256 matches this confirm's own
 * digest — so a retry that ALSO carries edited row overrides (a different
 * effective content, thus a different digest) would silently resume the
 * OLD batch with the OLD values, discarding the operator's fix with no
 * signal at all. The two lookups can now disagree — the same
 * (session_id, chunk_index) slot but a different content_sha256 — exactly
 * when a chunk was confirmed once, then re-submitted with different
 * overrides before ever being reverted. That is reported as a distinct,
 * typed error rather than treated as a resume.
 *
 * Round-7 audit finding 1: the byHash exact match used to be handed back
 * directly — correct proof that SOME live batch has this exact
 * content_sha256, but silent about whether a DIFFERENT-format sibling
 * (bare vs. overrides-v1-namespaced) for the SAME underlying file also
 * exists live, e.g. an orphan left by a failed self-revert (round-6's own
 * FAILURE-ATOMICITY comment). A same-session sibling match is left exactly
 * as before — a legitimate duplicate SEGMENT within the caller's OWN
 * upload, resolved by the operator (Skip / Import anyway), never silently
 * reconciled away. Anything else (a different session, or no session at
 * all) is routed through the same reconcile-on-resume logic the pre-check
 * uses, exactly like an ordinary resume would. */
async function findDuplicateBatch(
  supabase: SupabaseClient<Database>,
  restaurantId: string,
  contentSha256: string,
  options: ConfirmBatchOptions,
): Promise<ConfirmBatchResult | null> {
  const { data: byHash } = await supabase
    .from("import_batches")
    .select("id, status, session_id, chunk_index")
    .eq("restaurant_id", restaurantId)
    .eq("content_sha256", contentSha256)
    .neq("status", "reverted")
    .maybeSingle();

  let match = byHash as { id: string; status: string; session_id: string | null; chunk_index: number | null } | null;

  const isOwnSessionSibling = match !== null && options.sessionId != null && match.session_id === options.sessionId;
  if (match && !isOwnSessionSibling) {
    const fileDigestHex = extractFileDigestHex(contentSha256);
    if (fileDigestHex) {
      const reconciled = await reconcileLiveBatchesForFile(supabase, restaurantId, fileDigestHex, {
        excludeSessionId: options.sessionId,
      });
      if (!reconciled.ok) {
        return { ok: false, error: reconciled.error };
      }
      // Round-29 audit, BLOCK 1: the previous comment here ("match's own
      // row is always among reconcile's candidates, so this can only ever
      // narrow to match itself") assumed `match` (the exact byHash row) is
      // still LIVE by the time this second, separate query runs. It is
      // not guaranteed to be: `match` can be reverted in the gap between
      // the byHash read above and reconcileLiveBatchesForFile's own read
      // (e.g. its own SEER-YIELDS self-revert, racing this confirm). Once
      // reverted, `match` drops out of the live-candidate set entirely —
      // and if a DIFFERENT-digest sibling for the same underlying file
      // remains (or newly appears) as the sole survivor, reconcile hands
      // it back as `candidates[0]` with no id or digest relationship to
      // `match` whatsoever. Blindly substituting it would silently resume
      // that stranger — a batch whose digest (and therefore whatever LWIN
      // approvals/rejections or row overrides it encodes) this confirm
      // never agreed to — bypassing the operator's current approval state.
      //
      // So the reconciled candidate is only accepted when it is
      // PROVABLY still the same row: same id AND same exact
      // content_sha256 as the original byHash match. Anything else (a
      // different id, or — defensively — a different digest under the
      // same id, which should be impossible since content_sha256 is
      // immutable per batch) is reported as the same retryable outcome
      // toAlreadyExistsResult already uses for an observed revert, rather
      // than handed out as a resume pointer.
      if (reconciled.match && (reconciled.match.id !== match.id || reconciled.match.content_sha256 !== contentSha256)) {
        return {
          ok: false,
          error: {
            code: "duplicate_race_retry",
            message: "This upload matched an import that was withdrawn moments ago — please try confirming again.",
          },
        };
      }
      match = reconciled.match;
    }
  }

  if (!match && options.sessionId && options.chunkIndex !== undefined) {
    const { data: byChunk } = await supabase
      .from("import_batches")
      .select("id, status, session_id, chunk_index, content_sha256")
      .eq("session_id", options.sessionId)
      .eq("chunk_index", options.chunkIndex)
      .neq("status", "reverted")
      .maybeSingle();
    const chunkMatch = byChunk as
      | { id: string; status: string; session_id: string | null; chunk_index: number | null; content_sha256: string | null }
      | null;

    if (chunkMatch && chunkMatch.content_sha256 !== contentSha256) {
      return {
        ok: false,
        error: {
          code: "chunk_content_mismatch",
          message:
            `Chunk ${options.chunkIndex} of this import session was already confirmed with different content ` +
            "or row fixes. Revert that import before re-uploading a corrected version of this chunk.",
        },
      };
    }
    match = chunkMatch;
  }

  if (!match) return null;

  return toAlreadyExistsResult(supabase, match);
}

/** Shared "resume pointer" projection — every existing-batch lookup below
 * (byHash, the session+chunk fallback, and the finding-2 underlying-file
 * check) converges on this exact result shape.
 *
 * Round-5 audit finding 2(b): `match.status` (and the rest of `match`) may
 * be a STALE snapshot from whatever query found it — the target could have
 * been reverted (by its own SEER-YIELDS self-revert, racing a completely
 * different confirm) in the moments between that query and this call. Every
 * already-exists result in this file funnels through here, so re-reading
 * the CURRENT status right before handing out a resume pointer closes that
 * gap for every caller at once — including the finding-2(a) POST-check race
 * path above, which no longer does its own rival re-read and relies
 * entirely on this one. (Resuming a reverted batch would be DATA-safe
 * regardless — apply only ever selects apply_status='not_applied' rows,
 * and a revert never leaves any row in that state — but it's a confusing
 * dead end for the operator: refused here rather than merely tolerated.)
 *
 * Round-6 audit finding 2: the status re-read above used to run FIRST,
 * with countBatchRows' own await sitting AFTER it, between the read and
 * the return — so a revert landing in that count-await window produced a
 * resume pointer whose status field this function had already decided was
 * live, built from a status value that was stale by the time the caller
 * ever saw it. Reordered so COUNT runs first and the status re-read is the
 * LAST await before this function returns — nothing (no further await, no
 * branch back to the network) sits between reading `current` and either
 * refusing or constructing the result below. A revert can still land in
 * the sub-millisecond gap between that final read returning and this
 * function's own return statement executing — no synchronous function can
 * close a window that isn't itself synchronous — but that residual is
 * about as tight as a single extra round trip can make it, and it is
 * DATA-safe regardless: apply only ever selects apply_status='not_applied'
 * rows, and apply_import_batch_chunk_v2 (0108) already no-ops on a
 * reverted batch, so a client acting on a pointer that reverted a moment
 * after this call returned simply finds nothing to apply, not a duplicate. */
async function toAlreadyExistsResult(
  supabase: SupabaseClient<Database>,
  match: { id: string; status: string; session_id: string | null; chunk_index: number | null },
): Promise<ConfirmBatchResult> {
  const counts = await countBatchRows(supabase, match.id);
  const current = await readBatchLiveState(supabase, match.id);
  if (!current || current.status === "reverted") {
    // Fail closed: a status-read ERROR (readBatchLiveState returns null for
    // either a missing row or a lookup failure — see its own comment) is
    // treated identically to an observed revert, never as "probably still
    // live, hand out the pointer anyway."
    return {
      ok: false,
      error: {
        code: "duplicate_race_retry",
        message:
          "This upload matched an import that was withdrawn moments ago — please try confirming again.",
      },
    };
  }
  return {
    ok: true,
    alreadyExists: true,
    batchId: current.id,
    status: current.status,
    sessionId: current.session_id,
    chunkIndex: current.chunk_index,
    counts,
  };
}

type LiveBatchMatch = {
  id: string;
  status: string;
  session_id: string | null;
  chunk_index: number | null;
  content_sha256: string | null;
  created_at: string;
  filename: string;
};

type FindLiveBatchResult =
  | { ok: true; match: LiveBatchMatch | null }
  | { ok: false; error: { code: string; message: string } };


/** Round-29 audit, BLOCK 2: whether a content_sha256 value's OWN namespace
 * tier folds LWIN state (rejectedLwinRows and/or the full-picture
 * approvedLwinRows decision — see confirmImportBatch's own digest-
 * construction comment) into its hashed bytes. Bare and v1 never do —
 * their only possible difference from another digest for the same
 * underlying file is rowOverrides. v2/v3/v4 always do. This is a property
 * of the CANDIDATE row being considered for resume, independent of
 * whether the CURRENT request happens to carry its own approval/rejection
 * signal — a candidate can carry a prior confirm's LWIN decision that this
 * request never sent and never agreed to. */
function digestTierEncodesLwinState(contentSha256: string): boolean {
  const match = new RegExp(`^${OVERRIDES_DIGEST_STEM}([0-9]+):`).exec(contentSha256);
  if (!match) return false;
  return Number(match[1]) >= 2;
}


/** Sol round-2/3 audit (2026-08-27) findings 2/3/4/6: finds the OLDEST live
 * (non-reverted) batch for this restaurant whose content_sha256 refers to
 * the SAME underlying file as fileDigestHex — either the bare digest
 * itself, or ANY overrides-v1 namespaced digest ending in it (the
 * namespaced format always embeds the bare file digest as its trailing
 * segment). Hex digests contain no LIKE metacharacters, so the pattern is
 * safe to build directly from fileDigestHex.
 *
 * `excludeSessionId`, when given, excludes EVERY batch belonging to that
 * whole session (finding 3) — not just one chunk slot. Two sibling chunks
 * of the SAME session carrying identical bytes are a legitimate duplicate
 * segment (e.g. a duplicated export range), never each other's
 * confirmation; the exact-slot retry case (same chunk re-submitted) is
 * still handled by the create RPC's own unique index + findDuplicateBatch's
 * 23505 fallback, unaffected by this exclusion. `excludeBatchId`, when
 * given, excludes one specific batch id — used by the finding-2 POST-write
 * check to exclude the confirm's own just-created row, which obviously
 * matches its own content_sha256.
 *
 * Finding 4 (round-3): this used to be `.maybeSingle()`, which THROWS a
 * PostgREST error (not "no match") when more than one row satisfies the
 * filter — the old code discarded that error (destructured only `data`)
 * and fell through to creating a THIRD live variant. Replaced with a
 * deterministic ordered LIST read (oldest created_at, then oldest id,
 * first) — errors are now propagated as a typed, retryable confirm error
 * (fail CLOSED, never silently proceed to create on a lookup failure)
 * rather than discarded.
 *
 * Round-4 audit finding 4: `.limit(2)` read the two OLDEST rows matching
 * the LIKE pattern BEFORE the finding-6 exact-format re-check below ran —
 * so two malformed (never-written-by-this-product) content_sha256 values
 * that merely happen to sort before a genuine match can fill both slots
 * and evict it, leaving `rows.find(isWellFormedDigestForFile)` with
 * nothing to find even though a real match exists further down the
 * result set. A malformed value can only exist from a direct DB write —
 * this product only ever writes the two well-formed shapes
 * (isWellFormedDigestForFile's own comment) — so any realistic amount of
 * contamination is vanishingly unlikely to reach double digits; raised to
 * limit(20), which is far beyond that, then format-filtered in TS below.
 * The ordering (oldest created_at, then oldest id) is kept for
 * deterministic MATCH SELECTION among multiple well-formed rows (a list
 * read ordering which row is picked first is fine) — it no longer has
 * any role in surviving a race (see confirmImportBatch's own comment on
 * the round-4 SEER-YIELDS fix for why timestamp-based survivor election
 * was wrong). */
type FindLiveBatchesResult =
  | { ok: true; matches: LiveBatchMatch[]; rawReadHitCap: boolean }
  | { ok: false; error: { code: string; message: string } };

/** Round-7 audit finding 1: the plural form — every well-formed live
 * candidate for the file, oldest-first, not just the first one. Split out
 * of the old findLiveBatchByUnderlyingFile (below, now a thin wrapper over
 * this) so reconcileLiveBatchesForFile can see and act on EVERY live
 * candidate, not merely the one a naive "pick a match" caller would have
 * used — see that function's own comment for why more than one can exist
 * and what happens when it does. */
async function findLiveBatchesByUnderlyingFile(
  supabase: SupabaseClient<Database>,
  restaurantId: string,
  fileDigestHex: string,
  options: { excludeSessionId?: string; excludeBatchId?: string } = {},
): Promise<FindLiveBatchesResult> {
  // Round-4 audit finding 5 (defense-in-depth): fileDigestHex is provably
  // server-computed hex today (createHash("sha256").update(...).digest
  // ("hex") a few lines up in confirmImportBatch), so the .or() filter
  // string built from it below is provably safe from PostgREST
  // filter-syntax injection — but "provably safe today, given the current
  // call site" is a property of the CALLER, not of this function. Asserting
  // the shape here makes the injection-safety property LOCAL to this
  // function, independent of what any future caller passes in.
  if (!/^[0-9a-f]{64}$/.test(fileDigestHex)) {
    return {
      ok: false,
      error: { code: "internal_error", message: "Invalid file digest — expected 64 lowercase hex characters." },
    };
  }

  // Item 2: OVERRIDES_DIGEST_STEM is the bare stem ("overrides-v", no
  // version digit) — the "%" wildcard already has to absorb the sha256 hex
  // blob, so it transparently absorbs "1:<hex>" or "2:<hex>" too. This LIKE
  // pattern therefore matches BOTH namespace versions with no shape change
  // here; only OVERRIDES_DIGEST_STEM's own value changed (see its comment).
  let query = supabase
    .from("import_batches")
    .select("id, status, session_id, chunk_index, content_sha256, created_at, filename")
    .eq("restaurant_id", restaurantId)
    .neq("status", "reverted")
    .or(`content_sha256.eq.${fileDigestHex},content_sha256.like.${OVERRIDES_DIGEST_STEM}%:${fileDigestHex}`);

  if (options.excludeSessionId) {
    // NULL-safe "not this session": a plain `.neq("session_id", id)` would
    // silently drop every session_id IS NULL row too (`NULL <> id` is
    // UNKNOWN, not TRUE, in SQL's three-valued WHERE logic) — those
    // sessionless batches are never part of the session being excluded
    // and must still count as genuine duplicates.
    query = query.or(`session_id.is.null,session_id.neq.${options.excludeSessionId}`);
  }
  if (options.excludeBatchId) {
    query = query.neq("id", options.excludeBatchId);
  }

  const { data, error } = await query
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(LIVE_BATCH_LOOKUP_LIMIT);

  if (error) {
    return {
      ok: false,
      error: {
        code: "duplicate_check_failed",
        message: "Could not verify this file wasn't already imported — please try confirming again.",
      },
    };
  }

  const rows = (data ?? []) as LiveBatchMatch[];
  const matches = rows.filter((row) => isWellFormedDigestForFile(row.content_sha256 ?? null, fileDigestHex));

  // Round-5 audit finding 6: LIVE_BATCH_LOOKUP_LIMIT is heuristic, not a
  // proof — if the query returns EXACTLY the limit and NONE of those rows
  // survive the exact-format re-check above, a genuine well-formed match
  // could be sitting beyond row LIVE_BATCH_LOOKUP_LIMIT, shadowed by that
  // many malformed/contaminated rows sorting ahead of it (the comment above
  // already calls this "vanishingly unlikely" for this product's own write
  // paths — unlikely is not impossible). Fail CLOSED here rather than
  // silently reporting "no live batch" and letting the caller proceed to
  // create — a spurious duplicate live batch is a worse failure mode than
  // asking the operator to retry.
  if (matches.length === 0 && rows.length === LIVE_BATCH_LOOKUP_LIMIT) {
    return {
      ok: false,
      error: {
        code: "duplicate_check_failed",
        message: "Could not verify this file wasn't already imported — please try confirming again.",
      },
    };
  }

  // FINDING 4 (round-15 audit): whether the RAW read (before the
  // well-formed-digest filter above) came back at the cap — the only
  // honest signal for "more candidates may exist beyond what this lookup
  // saw." reconcileLiveBatchesForFile used to test `matches.length ===
  // LIVE_BATCH_LOOKUP_LIMIT` instead, which is wrong: 20 raw rows with 19
  // well-formed and 1 malformed produces matches.length === 19, silently
  // hiding the "more may exist beyond the cap" signal even though the READ
  // itself hit the limit and a genuine 21st candidate could be sitting
  // just past it, unseen.
  return { ok: true, matches, rawReadHitCap: rows.length === LIVE_BATCH_LOOKUP_LIMIT };
}

/** Sol round-2/3 audit (2026-08-27) findings 2/3/4/6: finds the OLDEST live
 * (non-reverted) batch for this restaurant whose content_sha256 refers to
 * the SAME underlying file as fileDigestHex — either the bare digest
 * itself, or ANY overrides-v1 namespaced digest ending in it (the
 * namespaced format always embeds the bare file digest as its trailing
 * segment). Hex digests contain no LIKE metacharacters, so the pattern is
 * safe to build directly from fileDigestHex.
 *
 * `excludeSessionId`, when given, excludes EVERY batch belonging to that
 * whole session (finding 3) — not just one chunk slot. Two sibling chunks
 * of the SAME session carrying identical bytes are a legitimate duplicate
 * segment (e.g. a duplicated export range), never each other's
 * confirmation; the exact-slot retry case (same chunk re-submitted) is
 * still handled by the create RPC's own unique index + findDuplicateBatch's
 * 23505 fallback, unaffected by this exclusion. `excludeBatchId`, when
 * given, excludes one specific batch id — used by the finding-2 POST-write
 * check to exclude the confirm's own just-created row, which obviously
 * matches its own content_sha256.
 *
 * Finding 4 (round-3): this used to be `.maybeSingle()`, which THROWS a
 * PostgREST error (not "no match") when more than one row satisfies the
 * filter — the old code discarded that error (destructured only `data`)
 * and fell through to creating a THIRD live variant. Replaced with a
 * deterministic ordered LIST read (oldest created_at, then oldest id,
 * first) — errors are now propagated as a typed, retryable confirm error
 * (fail CLOSED, never silently proceed to create on a lookup failure)
 * rather than discarded.
 *
 * Round-4 audit finding 4: `.limit(2)` read the two OLDEST rows matching
 * the LIKE pattern BEFORE the finding-6 exact-format re-check below ran —
 * so two malformed (never-written-by-this-product) content_sha256 values
 * that merely happen to sort before a genuine match can fill both slots
 * and evict it, leaving `rows.find(isWellFormedDigestForFile)` with
 * nothing to find even though a real match exists further down the
 * result set. A malformed value can only exist from a direct DB write —
 * this product only ever writes the two well-formed shapes
 * (isWellFormedDigestForFile's own comment) — so any realistic amount of
 * contamination is vanishingly unlikely to reach double digits; raised to
 * limit(20), which is far beyond that, then format-filtered in TS below.
 * The ordering (oldest created_at, then oldest id) is kept for
 * deterministic MATCH SELECTION among multiple well-formed rows (a list
 * read ordering which row is picked first is fine) — it no longer has
 * any role in surviving a race (see confirmImportBatch's own comment on
 * the round-4 SEER-YIELDS fix for why timestamp-based survivor election
 * was wrong).
 *
 * Round-7 audit finding 1: this "just take the first one" wrapper is now
 * used ONLY by the POST-create SEER-YIELDS check (confirmImportBatch),
 * which only ever needs "does ANY rival exist" — never by a caller about
 * to hand out an already-exists RESUME pointer. Every resume-pointer path
 * goes through reconcileLiveBatchesForFile instead (below), which sees
 * every live candidate rather than just the oldest — see its own comment
 * for why "oldest" alone is unsafe there. */
async function findLiveBatchByUnderlyingFile(
  supabase: SupabaseClient<Database>,
  restaurantId: string,
  fileDigestHex: string,
  options: { excludeSessionId?: string; excludeBatchId?: string } = {},
): Promise<FindLiveBatchResult> {
  const result = await findLiveBatchesByUnderlyingFile(supabase, restaurantId, fileDigestHex, options);
  if (!result.ok) return result;
  return { ok: true, match: result.matches[0] ?? null };
}

/** Round-10 audit, HONESTY-CORRECTED round-11: THE INVARIANT AND WHERE IT
 * IS (NOT FULLY) ENFORCED.
 *
 * "At most one applied batch per underlying file" is NOT enforced anywhere
 * in this codebase — see findSiblingWithAppliedRows' own comment for the
 * proof that its apply-time guard only narrows the window and cannot close
 * it (0108 locks only its own batch's row; two sibling applies can still
 * both pass the guard and both persist inventory). This function
 * (reconcileLiveBatchesForFile) never enforced it either, before or after
 * round 10 — it is a resume/confirm-time lookup. Nine rounds of audits
 * (rounds 4-9) kept finding fresh races in giving THIS function authority
 * to REVERT a rival: round-8 fixed a best-effort revert that silently
 * swallowed failures; round-9 (BLOCK 1) then found that even the
 * fail-closed version was TOCTOU — a rival can acquire the apply lock and
 * create genuinely-applied rows in the gap between this function's own
 * applied/unapplied snapshot and its revert call, and the revert then
 * deletes those newly-created rows. Every fix narrowed the window; none of
 * them could close it, because the authority itself — destroying a live
 * batch from a code path that runs concurrently with independent apply
 * requests — is the bug. This function now NEVER calls revertImportBatch.
 * It only reads and reports.
 *
 * Fewer than two live candidates for the file: nothing to reconcile, exact
 * same resume-pointer behavior as always. Two or more: this is a genuine
 * conflict — MORE than one client independently believes it owns this
 * file's import — and there is no read-only way to know which one is
 * "right" (see round-4's own SEER-YIELDS finding for why created_at can't
 * decide that either). Returned as a NON-retryable error naming every live
 * candidate; the operator resolves it by hand from Recent imports (revert
 * all but one — see BatchStep's own revert-availability fix, round-10
 * audit finding BLOCK 3, for why Revert now reaches every live status this
 * conflict can produce, not just 'completed'). Retrying the SAME upload
 * without reverting anything first reaches the exact same conflict every
 * time, by design — this is not a transient race to wait out. */
async function reconcileLiveBatchesForFile(
  supabase: SupabaseClient<Database>,
  restaurantId: string,
  fileDigestHex: string,
  options: { excludeSessionId?: string; excludeBatchId?: string } = {},
): Promise<FindLiveBatchResult> {
  const listed = await findLiveBatchesByUnderlyingFile(supabase, restaurantId, fileDigestHex, options);
  if (!listed.ok) return listed;
  const candidates = listed.matches;
  if (candidates.length <= 1) {
    return { ok: true, match: candidates[0] ?? null };
  }

  // WARN 5 (round-13 audit): findLiveBatchesByUnderlyingFile is capped at
  // LIVE_BATCH_LOOKUP_LIMIT (its own comment) — if the read comes back
  // exactly at that cap, there is no way to tell "exactly this many exist"
  // from "more exist beyond the cap," so the count is stated as a lower
  // bound rather than an exact, possibly-false "every conflicting batch"
  // claim. FINDING 4 (round-15 audit): the signal is `listed.rawReadHitCap`
  // — whether the RAW read hit the cap, before format-filtering — not
  // `candidates.length === LIVE_BATCH_LOOKUP_LIMIT`. The two diverge
  // whenever malformed rows are mixed into the raw read: 20 raw rows with
  // 19 well-formed and 1 malformed reads exactly at the cap (a 21st,
  // well-formed candidate could be sitting just past it, unseen) but
  // candidates.length is 19, which the old check treated as "definitely not
  // truncated" — reporting an exact "19 live import batches" that
  // contradicts this function's own runbook-documented cap paragraph.
  const candidateCountMayBeTruncated = listed.rawReadHitCap;

  return {
    ok: false,
    error: {
      code: "multiple_live_batches",
      message:
        `This file has ${candidateCountMayBeTruncated ? "at least " : ""}${candidates.length} live import ` +
        "batches for the same underlying content — this can't be resolved automatically. Revert all but one of " +
        "them from Recent imports before resuming or re-uploading this file.",
    },
  };
}

export type BatchCounts = {
  total: number;
  applied: number;
  excluded: number;
  pending: number;
  eligibleNotApplied: number;
};

/** C03 (db audit 2026-08-23): replaces the old uncapped
 * `.select("apply_status, resolution").eq("batch_id", batchId)` (silently
 * truncated by PostgREST's 1,000-row max_rows past 1,000 rows, causing a
 * false status='completed') with the count_import_batch_rows RPC (0106) —
 * a single-row aggregate, immune to the row cap by construction. */
async function countBatchRows(
  supabase: SupabaseClient<Database>,
  batchId: string,
): Promise<BatchCounts> {
  const { data, error } = await supabase.rpc("count_import_batch_rows", {
    p_batch_id: batchId,
  } as never);
  if (error) throw error;

  const row = (Array.isArray(data) ? data[0] : data) as
    | { total: number; applied: number; excluded: number; pending: number; eligible_not_applied: number }
    | undefined;

  return {
    total: row?.total ?? 0,
    applied: row?.applied ?? 0,
    excluded: row?.excluded ?? 0,
    pending: row?.pending ?? 0,
    eligibleNotApplied: row?.eligible_not_applied ?? 0,
  };
}

/** Pure projection from row counts to the batch's convenience status. */
export function deriveBatchStatus(counts: BatchCounts): "created" | "applying" | "completed" {
  const settled = counts.applied + counts.excluded;
  if (settled === counts.total && counts.pending === 0 && counts.eligibleNotApplied === 0) {
    return "completed";
  }
  if (counts.applied > 0) return "applying";
  return "created";
}

async function recomputeBatchStatus(
  supabase: SupabaseClient<Database>,
  batchId: string,
): Promise<{ status: "created" | "applying" | "completed"; counts: BatchCounts }> {
  const counts = await countBatchRows(supabase, batchId);
  const status = deriveBatchStatus(counts);
  const { error } = await supabase
    .from("import_batches")
    .update({ status } as never)
    .eq("id", batchId)
    .neq("status", "reverted");
  if (error) throw error;
  return { status, counts };
}

export type ApplyChunkOutcome = {
  rowId: string;
  rowNumber: number;
  outcome: "applied" | "blocked" | "error";
  inventoryItemId: string | null;
  errorMessage: string | null;
};

export type ApplyChunkResult = {
  processed: ApplyChunkOutcome[];
  status: "created" | "applying" | "completed";
  counts: BatchCounts;
};

export type SiblingAppliedConflictCheck =
  | { ok: true; conflictBatchId: string | null }
  | { ok: false; error: { code: string; message: string } };

/** Round-10 audit, HONESTY-CORRECTED round-11: this NARROWS the cross-
 * batch apply race — it does NOT close it, and it is not "the real
 * enforcement point" for "at most one applied batch per underlying file."
 * No enforcement point for that invariant currently exists.
 *
 * This is a pure READ, in its own transaction, run immediately before a
 * chunk is allowed to apply — see reconcileLiveBatchesForFile's own
 * comment for why that resume-time function no longer has any destructive
 * authority. Because it is read-only, it has the one property the old
 * revert-based enforcement (BLOCK 1, round-9 audit) lacked: no matter how
 * two concurrent applies interleave around it, it can only ever REFUSE an
 * apply, never destroy a concurrent writer's already-applied rows.
 *
 * But this guard and the apply it gates (applyImportBatchChunk, via the
 * apply route) are separate awaits over separate transactions — there is
 * no lock spanning both. apply_import_batch_chunk (0108) only takes
 * `for update` on ITS OWN batch's import_batches row before inserting
 * inventory and marking rows applied; a sibling batch locks a DIFFERENT
 * row, so nothing serializes two sibling applies against each other. Two
 * clients can therefore both run this guard, both see "no sibling has
 * applied rows yet" (because neither has committed), and both proceed to
 * apply — both persist inventory. This function catches the common
 * SEQUENTIAL case (a resumed batch applying after a sibling already
 * committed applied rows); it does not catch two applies racing
 * simultaneously.
 *
 * Separately, apply_import_batch_chunk is GRANTed EXECUTE to `authenticated`
 * directly (0108, bottom) — any client holding a batch id can call the RPC
 * without ever going through this route, so this guard is not a security
 * boundary either, only a best-effort check the route happens to run.
 *
 * Migration 0128 CLOSES the race properly: apply_import_batch_chunk now takes
 * a transaction-scoped advisory lock keyed by (restaurant, underlying file)
 * and re-checks for an applied sibling under that lock, raising P0004. That
 * is the enforcement point; this function is not.
 *
 * This guard is nonetheless RETAINED, deliberately. Migrations reach
 * production out-of-band rather than from CI, so a build carrying this code
 * can be live before 0128 is applied — deleting the guard on the assumption
 * the barrier is already there would leave production with no protection at
 * all in that window. Once 0128 is confirmed applied in production this
 * function and its call site can be deleted, leaving the route with only the
 * P0004 -> 409 mapping. docs/runbooks/csv-import.md carries the SQL to verify
 * the barrier is live before doing that.
 *
 * A sibling counts as a conflict only once it has an ACTUAL applied row —
 * the same "applied rows are the strongest signal a client is/was really
 * applying this" reasoning reconciliation itself used to use.
 * revert_import_batch (0109) flips every one of a reverted batch's rows
 * OFF apply_status='applied' (to 'reverted') BEFORE flipping the batch
 * itself to 'reverted', so a reverted sibling's rows can never satisfy
 * this query — no separate status filter is needed.
 *
 * contentSha256 not parsing to a well-formed file digest (defensive only —
 * every batch this product creates has one; see confirmImportBatch's own
 * construction) means there is nothing to check against — treated as "no
 * conflict" rather than blocking every apply. */
export async function findSiblingWithAppliedRows(
  supabase: SupabaseClient<Database>,
  restaurantId: string,
  batchId: string,
  contentSha256: string | null,
): Promise<SiblingAppliedConflictCheck> {
  const fileDigestHex = contentSha256 ? extractFileDigestHex(contentSha256) : null;
  if (!fileDigestHex) return { ok: true, conflictBatchId: null };

  // Item 2: same OVERRIDES_DIGEST_STEM generalization as
  // findLiveBatchesByUnderlyingFile's own identical `.or()` pattern above —
  // this call site was NOT one of the three the item-2 brief named, but it
  // hardcoded the exact same v1 literal and would otherwise have silently
  // stopped recognizing a v2 (rejections-bearing) sibling's content_sha256
  // as referring to this same underlying file, defeating the apply-time
  // sibling-conflict guard for exactly the confirms this feature adds.
  const { data, error } = await supabase
    .from("import_batches")
    .select("id, content_sha256, import_batch_rows!inner(id)")
    .eq("restaurant_id", restaurantId)
    .neq("id", batchId)
    .eq("import_batch_rows.apply_status", "applied")
    .or(`content_sha256.eq.${fileDigestHex},content_sha256.like.${OVERRIDES_DIGEST_STEM}%:${fileDigestHex}`)
    .limit(5);

  if (error) {
    return {
      ok: false,
      error: {
        code: "duplicate_check_failed",
        message: "Could not verify this file wasn't already imported — please try applying again.",
      },
    };
  }

  const rows = (data ?? []) as { id: string; content_sha256: string | null }[];
  const match = rows.find((r) => isWellFormedDigestForFile(r.content_sha256, fileDigestHex));
  return { ok: true, conflictBatchId: match?.id ?? null };
}

/**
 * Apply up to APPLY_CHUNK_SIZE eligible rows. Safe to call repeatedly —
 * on a crash, a timeout, or a deliberate pause, whatever wasn't
 * processed stays `not_applied` and is picked up by the next call; an
 * already-applied row is never revisited (FOR UPDATE SKIP LOCKED at the
 * DB layer also makes two concurrent calls for the same batch safe).
 * C03 (db audit 2026-08-23): apply_import_batch_chunk_v2 (0108) now also
 * no-ops on a REVERTED batch — calling this after a revert can never
 * recreate the inventory the operator just undid.
 */
export async function applyImportBatchChunk(
  supabase: SupabaseClient<Database>,
  batchId: string,
): Promise<ApplyChunkResult> {
  const { data, error } = await supabase.rpc("apply_import_batch_chunk", {
    p_batch_id: batchId,
    p_limit: APPLY_CHUNK_SIZE,
  } as never);
  if (error) throw error;

  const processed = ((data ?? []) as Array<{
    row_id: string;
    row_number: number;
    outcome: string;
    inventory_item_id: string | null;
    error_message: string | null;
  }>).map((r) => ({
    rowId: r.row_id,
    rowNumber: r.row_number,
    outcome: r.outcome as ApplyChunkOutcome["outcome"],
    inventoryItemId: r.inventory_item_id,
    errorMessage: r.error_message,
  }));

  const { status, counts } = await recomputeBatchStatus(supabase, batchId);

  return { processed, status, counts };
}

/**
 * Operator resolution for a row sitting in the pending bucket — unmatched
 * LWIN, missing cost, or (P3 §1.5) a flagged duplicate. `include` on a
 * missing-cost row requires an explicit, non-negative manualUnitCost — there
 * is no path that lets a row apply with a silently-defaulted cost.
 */
export async function resolveImportBatchRow(
  supabase: SupabaseClient<Database>,
  restaurantId: string,
  _userId: string,
  rowId: string,
  action: ResolveAction,
  manualUnitCost?: number,
): Promise<ResolveRowResult> {
  const { data: row, error: fetchError } = await supabase
    .from("import_batch_rows")
    .select("id, batch_id, resolution, cost_status")
    .eq("id", rowId)
    .eq("restaurant_id", restaurantId)
    .maybeSingle();
  if (fetchError) return resolutionInternalError("row");
  if (!row) return { ok: false, error: { code: "not_found", message: "Row not found." } };

  const current = row as { id: string; batch_id: string; resolution: string; cost_status: string };
  if (current.resolution !== "pending") {
    return { ok: false, error: { code: "not_pending", message: "Row is not awaiting resolution." } };
  }

  if (action === "include" && current.cost_status === "missing") {
    if (
      manualUnitCost === undefined ||
      !Number.isFinite(manualUnitCost) ||
      manualUnitCost < 0 ||
      manualUnitCost > 1_000_000
    ) {
      return {
        ok: false,
        error: { code: "manual_cost_required", message: "A non-negative unit cost is required to include this row." },
      };
    }
  }

  return resolveImportRowRpc(
    supabase,
    rowId,
    current.batch_id,
    action,
    action === "include" && current.cost_status === "missing" ? manualUnitCost : undefined,
  );
}

/**
 * Bulk operator resolution for every row in one batch's pending bucket.
 * `include` deliberately touches ONLY cost-present rows — a missing-cost
 * row still requires the per-row path with an explicit manualUnitCost
 * (resolveImportBatchRow), preserving the "no silently-defaulted cost"
 * invariant verbatim. `exclude` covers every pending row regardless of
 * cost state. The closed RPC derives both counts in the same transaction
 * as the update, never from a PostgREST-truncated returned row list.
 */
export async function bulkResolveImportBatchRows(
  supabase: SupabaseClient<Database>,
  restaurantId: string,
  _userId: string,
  batchId: string,
  action: ResolveAction,
): Promise<BulkResolveResult> {
  const { data: batch, error: batchError } = await supabase
    .from("import_batches")
    .select("id, status")
    .eq("id", batchId)
    .eq("restaurant_id", restaurantId)
    .maybeSingle();
  if (batchError) return resolutionInternalError("bulk");
  if (!batch) return { ok: false, error: { code: "not_found", message: "Import batch not found." } };
  if ((batch as { status: string }).status === "reverted") {
    return { ok: false, error: { code: "reverted", message: "A reverted batch cannot be resolved." } };
  }

  return bulkResolveImportRowsRpc(supabase, batchId, action);
}

export type RevertBatchResult =
  | {
      ok: true;
      revertedCount: number;
      orphanWinesDeleted: 0;
      lwinStampsCleared: number;
    }
  | { ok: false; error: ImportRevertError };

/**
 * Revert one import batch through the closed database operation. The database
 * owns inventory reversal, eligible LWIN cleanup, and the final status in one
 * transaction. Catalog wines and history are deliberately retained.
 */
export async function revertImportBatch(
  supabase: SupabaseClient<Database>,
  _restaurantId: string,
  batchId: string,
): Promise<RevertBatchResult> {
  const result = await revertImportBatchRpc(supabase, batchId);
  if (!result.ok) return result;

  return {
    ok: true,
    revertedCount: result.receipt.revertedItemCount,
    orphanWinesDeleted: result.receipt.orphanWinesDeleted,
    lwinStampsCleared: result.receipt.lwinStampsCleared,
  };
}
