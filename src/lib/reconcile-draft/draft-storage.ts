/**
 * Reconciliation draft persistence — the safety net beneath
 * ReconcileNavigationGuard (BND-??? — Back/Forward draft loss).
 *
 * Next 16's App Router gives userland no way to intercept a browser
 * Back/Forward traversal (confirmed against node_modules/next/dist —
 * popstate is unconditional and not cancelable), so ReconcileList's
 * in-memory `pending` counts are destroyed on any Back/Forward. Rather than
 * fight the platform, we make the loss harmless: every change to `pending`
 * is mirrored here, and the next mount of ReconcileList restores it.
 *
 * sessionStorage, not localStorage: a reconciliation count is shift-scoped.
 * It should die when the tab closes, not linger into tomorrow's shift on
 * the same device. sessionStorage is also per-tab, so it can't leak a
 * half-finished count from one open tab into another.
 *
 * The key is namespaced by BOTH restaurantId and userId. This is a
 * tenant-isolation surface (AGENTS.md non-negotiable #3, applied to
 * client-side storage rather than RLS): two restaurants — or two staff
 * members sharing a device/browser profile — must never see each other's
 * in-progress counts.
 *
 * Every entry point wraps sessionStorage access in try/catch. Safari
 * private-browsing mode throws on both read and write; a storage failure
 * must degrade to "no draft persistence", never crash the reconcile screen.
 */

export type ReconcileDraftEntries = Record<
  string,
  { newRemainingMl: number; note?: string }
>;

interface StoredDraft {
  savedAt: number;
  entries: ReconcileDraftEntries;
}

/**
 * 12 hours. Long enough to survive a full extended shift (open through
 * close, including a phone call, a split shift, or a manager picking the
 * count back up after service) without a phone left on a shelf resurfacing
 * last week's counts days later. A reconciliation count older than a single
 * shift is more likely to be confusing than useful, so it expires rather
 * than persisting indefinitely.
 */
const DRAFT_TTL_MS = 12 * 60 * 60 * 1000;

const KEY_PREFIX = "terroir:reconcile-draft";

export function reconcileDraftKey(restaurantId: string, userId: string): string {
  return `${KEY_PREFIX}:${restaurantId}:${userId}`;
}

function getStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage;
  } catch {
    // Some browsers (Safari private mode, storage-blocked settings) throw
    // merely accessing the property, before any get/set call.
    return null;
  }
}

export type ReconcileDraftReadResult =
  | { kind: "none" }
  | { kind: "restored"; entries: ReconcileDraftEntries; count: number }
  | { kind: "expired"; count: number };

/**
 * Reads and validates the persisted draft for (restaurantId, userId). An
 * expired draft is discarded (cleared from storage) before returning, so
 * the caller never has to remember to clean it up.
 */
export function readReconcileDraft(
  restaurantId: string,
  userId: string,
): ReconcileDraftReadResult {
  const storage = getStorage();
  if (!storage) return { kind: "none" };
  try {
    const raw = storage.getItem(reconcileDraftKey(restaurantId, userId));
    if (!raw) return { kind: "none" };
    const parsed = JSON.parse(raw) as Partial<StoredDraft> | null;
    if (
      typeof parsed?.savedAt !== "number" ||
      typeof parsed.entries !== "object" ||
      parsed.entries === null
    ) {
      return { kind: "none" };
    }
    const count = Object.keys(parsed.entries).length;
    if (count === 0) return { kind: "none" };
    if (Date.now() - parsed.savedAt > DRAFT_TTL_MS) {
      clearReconcileDraft(restaurantId, userId);
      return { kind: "expired", count };
    }
    return { kind: "restored", entries: parsed.entries, count };
  } catch {
    return { kind: "none" };
  }
}

/**
 * Persists `entries` for (restaurantId, userId). An empty object clears the
 * draft instead of writing a pointless `{}` — an empty draft and no draft
 * mean the same thing.
 */
export function writeReconcileDraft(
  restaurantId: string,
  userId: string,
  entries: ReconcileDraftEntries,
): void {
  if (Object.keys(entries).length === 0) {
    clearReconcileDraft(restaurantId, userId);
    return;
  }
  const storage = getStorage();
  if (!storage) return;
  try {
    const draft: StoredDraft = { savedAt: Date.now(), entries };
    storage.setItem(reconcileDraftKey(restaurantId, userId), JSON.stringify(draft));
  } catch {
    // Storage full or blocked — the in-memory `pending` state in
    // ReconcileList still works for this session; it just won't survive a
    // Back/Forward. That is today's behaviour, not a regression.
  }
}

/**
 * Turns a read result into the copy ReconcileList shows the user. Restoring
 * a form with numbers the user does not remember typing is a correctness
 * hazard on an inventory screen, so a restore is never silent — and it is
 * always explicitly undoable (the "expired" case had no restore to undo).
 */
export function describeReconcileDraft(
  result: ReconcileDraftReadResult,
): { message: string; canUndo: boolean } | null {
  if (result.kind === "restored") {
    const n = result.count;
    return { message: `Restored ${n} unsaved count${n === 1 ? "" : "s"} from before you left.`, canUndo: true };
  }
  if (result.kind === "expired") {
    const n = result.count;
    return { message: `Your previous draft (${n} count${n === 1 ? "" : "s"}) was more than 12 hours old and was discarded.`, canUndo: false };
  }
  return null;
}

export function clearReconcileDraft(restaurantId: string, userId: string): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(reconcileDraftKey(restaurantId, userId));
  } catch {
    // Nothing to do — if removal fails, the draft (if any) is stale data
    // that will simply expire on its own via the TTL check above.
  }
}
