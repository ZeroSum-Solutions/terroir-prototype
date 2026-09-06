# Project protocol and independent review

The draft canonical protocol and harness adapters are in preparation/. They are inactive; root AGENTS.md and CLAUDE.md remain unchanged. V0 must port verified existing safety rules into docs/PROJECT-PROTOCOL.md and update thin adapters in the same reviewed PR after Gate 1. Existing production-env, guarded-start, generated-file, migration/down-file, CI and machine-read artifact rules remain mandatory. Never activate a draft simply because it exists.

## One builder and one claim record

The proposed repository-tracked docs/rebuild/state.json is the one authoritative state file. One integration controller writes it: C normally, O during C-authored V1 and Q-authored V0/V4 admissions. Distinct role sessions perform authorship, findings stewardship and landing. The controller records its identity and every transfer. It persists an exact file claim before acknowledging admission; workers do not claim by editing another branch's copy. All active write claims must be disjoint, and only one application builder is active globally, regardless of model/provider. Parallel packet reviews do not grant write authority.

For this single-builder plan use a simple claim protocol, not a lease service or timed heartbeat system: claim before work, update at pause/handoff, verify ownership before resume, release after verified landing. The controller checks branch/SHA/dirty files and the active session before admitting another worker. No timeout permits stealing a branch. After a lost session, freeze that claim until process/diff ownership is resolved. If the control checkout is unavailable, stop admissions. Persist the record before work; include reviewed snapshots in the next integration PR, never hold all claims until landing. No second journal or competing state authority is needed. More than one mutating builder requires a separately reviewed concurrency/lock/lease protocol and measured capacity; it is outside S.

State records gate/deadline/scope/budget, controller, exact base/head, track/agent/session/model/effort/harness/machine/branch/worktree/files, status, dependencies, test evidence and next action, queue, decisions and findings supplied by the non-author steward. Restart/compaction/quota/model change requires re-reading protocol/state, checking actual repo identity/SHA/diff/process/DB target and open PR/check evidence before continuing. Preserve all owned work; no branch deletion, destructive reset, rebase, shared stash or force-push. Exact-SHA evidence cannot certify a different head.

## Author, findings steward and landing roles

| Slice | Author | Non-author steward | Non-author lander/controller |
|---|---|---|---|
| V0 | Q | D | O |
| M1 | D | Q | C |
| V1 | C | D | O |
| M2 | D | Q | C |
| V2 | R | Q | C |
| V3 | O | Q | C |
| V4 | Q | D | O |

Letters are distinct agents/sessions, not aliases the same author adopts. Reviewers are additional independent sessions. Controller transfers occur before admission, with explicit stop/release acknowledgment; only one controller exists. Update the table before a changed or mixed author is admitted. An author cannot land its own work or close findings by renaming its role.

## Review contract

Codex-authored work → fresh Claude plus Gemini. Claude-authored work → fresh GPT-5.6 Sol plus Gemini. Use the verified exact model/effort routing in 11-model-routing.md. Each reviewer differs from every author by vendor, harness, session and agent. Run the pair concurrently on the same immutable requirement/specification/diff/test-evidence packet, without the author's defense. Mixed-vendor coauthorship requires a genuinely independent pair from the remaining vendors or splitting authorship; two same-vendor models never satisfy diversity. Missing vendor means one independent review plus owner adjudication, not silent replacement.

Record requested/reported model, harness/version, session, packet/diff/test hashes, base/head, actual commands/results including named skips, limits and tool use. No production rows/assets or secret/config values enter a model packet. Planning review has no implementation test evidence and must say so. Claude packet review disables tools/MCP; Gemini plan/sandbox receives a packet-only instruction; record enforcement limitations rather than infer them from flags.

The non-author steward consolidates findings by invariant, preserving original wording and evidence. Authors may respond with evidence but cannot close their own findings. The controller only copies steward-approved dispositions into state. P0 data loss/tenant/secret breach blocks immediately; P1 broken required flow, unsupported feasibility or safety/review hole blocks affected work; P2 concrete within-scope weakness is fixed or explicitly owner-adjudicated; P3 optional improvement is nonblocking.

One bounded correction round follows the initial concurrent reviews. The original finder or an objective check verifies each correction; the non-author steward records that receipt. Unsupported assertions may be withdrawn with evidence. Remaining material disagreement returns the slice to planning or owner adjudication; no majority-vote workaround. A diagnostic model consultation can occur inside the same fix round, not restart unlimited coding attempts. Review closure is limited to the original issues unless the fix itself creates a new blocker.

LAND-GO requires exact reviewed head/current base, required checks, selected-scope zero skips, closed blockers, file-claim clearance and a non-author lander with integration authority. Main auto-deploy safety and Gate 2 remain distinct. Use systematic debugging for reproducible failures; senior review for architecture, migration, security and maintainability. Do not write implementation-mirroring tests for prose. The current 390px bug is not fixed by assigning its owner.

## Rules, agents, skills and documentation preparation

preparation/ contains the canonical protocol draft, thin adapter drafts, role cards, task/review/state templates, contract specifications, qualification plan and activation checklist. None is a root configuration or runnable migration. V0 checks adapters load the same protocol/version and preserve existing rules, then tests both harnesses with read-only refusal/allowed-command fixtures. Text/hash equality alone does not establish tool enforcement. Do not change global hooks, install packages/skills, or copy credential configuration.

After implementation, Q/C update architecture/codemaps, guarded README setup and environment/recovery runbooks from actual paths and commands. Preserve app_spec.txt and claude-progress.txt and generator-owned feature records. Correct stale one-DB/adapter-test/restore-history claims only with dated current evidence. Future model changes require exact lane verification and a routing decision recorded in state.
