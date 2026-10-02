# Portable restaurant demo: independent source admission

Date: 2026-10-01. Reviewer: independent Codex agent, not the implementer.

## Decision

**Source admission PASS; current complete demonstration FAIL.** Attempt C below failed after receiving; STOP/no restart or replay applies. Its always-preserved runtime supersedes the earlier directory-cleanup description.
No unresolved critical/high source-admission finding was found in the reviewed
launcher, Docker lifecycle, fixture or journey. The parent may execute the
activated runner with its exact acknowledgement in a new admitted namespace.
This is not a production certificate, a migration/runtime PASS, permission to
touch retained stacks, or approval to deploy, merge, rotate credentials or change
hosted data. A passing browser run must produce its own evidence.

Scope: canonical checkout `/Users/zero/projects/_archive/terroir-prototype`,
branch `feat/restaurant-demo-closeout-20261001`, landed HEAD
`c4bf61b453706925d2c97646250c0b3ac686b260`, plus the frozen working-tree changes
below. The reviewer read root `AGENTS.md`, the accepted M1/M2 milestone and import
contract, source and tests, `scripts/local/dev-local.sh`, and the delegated
`scripts/run-live-test-conservation.mjs` admission helper. No PR merge-readiness
or current candidate CI verdict was available for these uncommitted bytes.

The reviewer ran no Docker mutation, SQL, app startup, browser journey or hosted
request; loaded no dotenv; and changed no source/test file. Pure Node tests use
mocked Docker runners and owned temporary directories. The only authored files
are independent evidence reports. Review used the security-review skill because
the delta touches authorization, local credentials, filesystem destinations and
privileged Docker/database operations.

## Frozen bytes

| File under `scripts/local/restaurant-demo/` | SHA-256 after approved activation |
| --- | --- |
| `launcher.mjs` | `7c006caa0dc0d98df2fc52369e6b8431e36037ceba31e3a8c1aff063c9eed54a` |
| `docker-lifecycle.mjs` | `13ff6195b890d6d748ee83f5d3f94a9bc6d40e8407e8b03806c2551f80bafc53` |
| `portable-demo.test.mjs` | `096e3039acceba68fa0dc890ce8a097dcdd484f1a5d83908cd560c37d597f7c4` |
| `fixture.sql` | `2db52e17ddeb329855d0de164e14370951c112dba105979ec4c294156029988b` |
| `journey.mjs` | `85f22c2543e8b6d818441ccc955f9d084c25d56aa26ae4a65c931d7844874749` |
| `fixture.test.mjs` | `a74e5d5fbbf8bb7c3fb9e65e5f06c2e9f12502a9b85cbaca93532fb528b6662c` |
| `journey.test.mjs` | `46c9d8667f250d8290c5184a320009ec489d4f8962a09f734ed559a47a4b9731` |

The initially admitted launcher/test hashes were
`7d629abbaba6342c1050c0740a846670260e53f90211fdcf9146094515a48cdb` and
`314df02eb884fecbc202977ad128175d581858f8951e19483595b6f1807364b9`.
After source admission, the parent removed only the intentional execute refusal,
moved the no-ack assertion into the dry-run branch, reported
`SOURCE_ONLY_UNEXECUTED`/`executionReady: true` without `blockedReason`, and changed
the exact-ack parser test to expect `execute: true`. The reviewer reversed exactly
those edits in memory; both original frozen hashes were reproduced. The command
printed `ACTIVATION_ONLY_DELTA_PASS`, exit 0. Other frozen files were unchanged.
No runtime action had occurred before that independent activation recheck.

## Safety and application boundaries

| Boundary | Source result and evidence |
| --- | --- |
| Caller validation | Closed arguments; exact disposable namespace; distinct synthetic `@terroir.test` users; exact execution acknowledgement; unique nonprivileged ports; complete journey width only 390 or 1200. `launcher.mjs:18`, `journey.mjs:24`. |
| Filesystem destination | Absolute dedicated leaves, source/destination nonoverlap, realpath parent admission, existing destination refusal. Owned marker plus device/inode and canonical path are rechecked before/after Docker cleanup. `launcher.mjs:149`, `:341`. |
| Source materialization | Regular files only, traversal/Git/temp/ownership-marker refusal; all dotenv entries—including tracked examples—omitted without opening them. No inherited production credential environment. Intentional dependency symlink is not a source copy. `launcher.mjs:75`, `:163`, `:188`. |
| Local daemon | Unix-only endpoint without remote authority/query/fragment; canonical local socket type/device/inode admitted before mutations. All child environments are pinned to that endpoint. Every direct Docker/Supabase command rechecks socket identity. The imported stack helper receives the pinned runner; app and nested journey inherit the same pin. `docker-lifecycle.mjs:16`, `:34`, `:43`; `launcher.mjs:163`, `:219`, `:409`. |
| Namespace and topology | Inventory includes stopped containers, networks and volumes. Fresh namespace required before creating a nonce-labelled bridge with loopback binding. Stack ledger verifies exact project labels, immutable IDs, network attachment, requested loopback published ports and owned volume users. No foreign attached user is admitted. `docker-lifecycle.mjs:48`, `:84`, `:88`, `:116`. |
| Cleanup | Full remaining ledger re-admission before every removal. Containers/networks use immutable IDs. Docker volumes lack an immutable API ID, so name, CreatedAt, labels and users are freshly checked. No project-name Supabase stop, reset or prune. Failed/partial runs preserve resources, runtime, latch and evidence; successful cleanup is only of this execution's ledger and owned runtime. `docker-lifecycle.mjs:142`, `:155`; `launcher.mjs:341`, `:396`. |
| Migrations | Only admitted empty ledger and immutable database container; filename allowlist and 0164 ceiling; each migration and its ledger insertion share one `psql --single-transaction` invocation. Transaction-owning/concurrent-index input is refused. Existing 0156/0157/0158 pre/postflights remain part of the sequence. `launcher.mjs:358`, `:366`. This is source inspection, not SQL execution. |
| Fixture | Single transaction; final migration/native physical contract and exact named fresh synthetic identities required. Catalog/bin/list setup only; no received stock, open bottles, pours, operational receipts or history preseeded. Only exact synthetic owner gets the explicit 0154 cost/margin/pricing capabilities; staff receives no governance/pricing grant. `fixture.sql:3`, `:47`, `:135`, `:265`. |
| Thin complete journey | Password UI login, receive into explicit bin, repeat same receive identity without duplicate state, find/open chosen inventory, four UI pours with repeat identity, actual measured 120 ml input and screenshot before manager save, reload and fresh-login persistence, staff pour, server staff reconciliation denial and foreign-site denial with unchanged state. `journey.mjs:206`, `:219`, `:286`, `:355`. |
| Mobile and team visibility | Complete journey defaults 390px; optional explicit 1200px run. Layout observations at 320/390/768/1200 cover overflow, 44px controls, keyboard focus, site context/navigation and screenshots. Staff cost-control absence is a UI observation, not proof that every raw response/SQL ACL hides financial data. `journey.mjs:372`. |

Resolved source finding: preserving `DOCKER_CONFIG` while only stripping ambient
`DOCKER_HOST` could still select a persisted remote Docker context. Namespace,
network and migration operations could then target that daemon before loopback
app health failed. The worker added the Unix-socket admission and pinned every
delegated consumer. Independent source review and the remote/malformed-endpoint,
socket identity, namespace, topology and cleanup tests passed after that repair.

## Commands actually run

All commands used explicit canonical cwd, `/bin/bash`, non-login shell.

| ID | Command | Exit and observed result |
| --- | --- | --- |
| CMD-101 | `pnpm exec tsc --noEmit --incremental false` | 0; no TypeScript diagnostics. |
| CMD-102 | Scoped ESLint of session revert route/test and all reviewed `.mjs` source/tests | 0; no ESLint diagnostics. Repeated after activation for launcher/test, exit 0. |
| CMD-103 | `git diff --check` | 0. |
| CMD-104 | `node --test scripts/local/restaurant-demo/portable-demo.test.mjs scripts/local/restaurant-demo/fixture.test.mjs scripts/local/restaurant-demo/journey.test.mjs` | 0; 24 passed, 0 failed/skipped/cancelled/todo. Repeated after activation with the same count. 18 portable, 4 fixture, 2 journey tests. |
| CMD-105 | `shasum -a 256` of the seven frozen package files | 0; exact hashes above. |
| CMD-106 | In-memory reversal of only approved activation edits followed by SHA-256 assertions | 0; `ACTIVATION_ONLY_DELTA_PASS`; both pre-activation hashes reproduced. No file writes. |
| CMD-107 | `gitleaks detect --source scripts/local/restaurant-demo --no-git --no-banner --redact` | 0; 100,746 bytes scanned, no detected leaks at the reviewed pre-activation package. Target-only supplementary scan, not a range certificate. |
| CMD-108 | `gitleaks detect --source . --no-banner --redact` | 1; 857 commits, 26.86 MB, 10 historical findings. No values printed or copied. This broad fallback is not the current candidate range. |
| CMD-109 | Exact scoped `git diff --name-only HEAD --` for the eight tracked implementation/test paths listed below | 0; recorded output below. New helper/fixture/journey tests are untracked expanded source context, covered separately by hashes and source/tests. |

CMD-109 output:

```text
scripts/local/restaurant-demo/fixture.sql
scripts/local/restaurant-demo/journey.mjs
scripts/local/restaurant-demo/launcher.mjs
scripts/local/restaurant-demo/portable-demo.test.mjs
src/app/api/import/sessions/[id]/revert/route.test.ts
src/app/api/import/sessions/[id]/revert/route.ts
src/domains/import/import-revert-rpc.test.ts
src/domains/import/import-revert-rpc.ts
```

The session active-site mutation preflight and UUID receipt repair separately
passed independent source review, full TypeScript, scoped ESLint and 36 focused
tests with zero selected skips. See `import-current-review.md`. Its lower-priority
object-membership GET/read boundary remains explicitly open.

## Security surface coverage and scanner limits

| Canonical surface | Coverage | Evidence |
| --- | --- | --- |
| `prompt-injection` | NOT-APPLICABLE | No model prompt/retrieval/agent instruction path is added. Docker/database commands use fixed commands and validated argv, not content-selected tools or shell strings. |
| `secrets` | REVIEWED | Minimal process environment, dotenv exclusion, fresh random local passwords, redacted errors, target scan CMD-107, historical fallback CMD-108. Immutable final candidate range still unavailable. |
| `authentication` | REVIEWED | Exact synthetic auth identity validation and password UI login; no production login/bypass added. `fixture.sql:47`, `journey.mjs:206`. |
| `authorization` | REVIEWED | Exact synthetic owner grants; staff no pricing/governance; HTTP session active-site prefilter; Docker/runtime ownership; server denial assertions. Raw production financial ACL/privacy remains a separate database concern. |
| `untrusted-input` | REVIEWED | Closed args, paths, IDs, ports, filenames, Docker status/topology and ready-file identity validation; fail-closed JSON/assertions; no shell interpolation. |
| `export` | NOT-APPLICABLE | No new application/provider export; demo evidence stays on the local filesystem and browser targets are synthetic loopback. No repository content uploaded to a model provider. Existing dependency/image distribution is unchanged, not an application-data export. Export policy for this delta: PASS. |

CMD-108 is mechanically adverse history evidence, not a clean scan. The owner
identified its ten findings as known September 27 findings. The auxiliary
redacted report yielded only path/line/rule/fingerprint/commit metadata. None is
in CMD-109's current tracked diff. Three historical dotenv-example findings are
explicitly excluded from runtime copying; three other historical paths are now
absent. Remaining source-test findings require their separate historical triage;
this review does not silently waive them or rotate credentials. The structured
history review records that fallback as FAIL, distinct from this bounded source
admission PASS. The final committed `origin/main..candidate` scan remains required
before any release security verdict.

## What is not proved

Actual Docker startup/migration/fixture/browser/cleanup behavior, browser recovery,
live import undo/bin rename/stalled-expiry HTTP checks, independent raw financial
ACL/privacy, broader sealed-stock counting, and the final immutable candidate
CI/secrets/release checks remain separate gates. This packet's count means
measuring the open bottle to 120 ml in the reconciliation form before manager
save, matching the accepted demo runbook—not completion of the broader C06 stock
counting system. Do not relabel the thin demonstration as a production-ready
application or use an older successful CI run as coverage of these changed bytes.

## Attempt 1 and narrow pnpm repair

The parent's first actual execution failed before stack admission. Preserved
`launcher-result.json` reports `owned-loopback-network-created` and
`runtimePreserved: true`; the independent read-only resource observation contains
only network `96562db8a4c19f850aaecb587784c2975b99b0bf34062ba4aa76535abef45d8b`
under the exact `terroir-demo-20261001-mobile-a` namespace. There are no recorded
containers or volumes. No browser/database success is inferred from this attempt.
Evidence lives under the goal state's
`proof/terroir-demo-20261001-mobile-evidence/`.

The separate actual build command produced
`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` followed by `pnpm install` failure.
Installed pnpm 11.15.1 source at `dist/pnpm.mjs:149687` reads the explicit
`pnpm_config_verify_deps_before_run` environment override; `:250498` otherwise
runs the dependency check and can select install. In a materialized checkout with
a shared dependency symlink, enabling CI or disabling the purge confirmation
would permit the wrong mutation. The parent instead pins this setting to
`"false"` in the already-minimal child environment, preventing automatic install.

Independent recheck: reversing that one added field and its one test assertion in
memory reproduced the two admitted post-activation hashes. A stripped-environment
read-only `pnpm exec supabase --version` in the preserved runtime returned
`2.109.1`, exit 0; no install or Docker start occurred. All 24 Node tests and
scoped ESLint passed again. The repaired launcher/test hashes are
`ae91d3ba5c068eef07e272f81fb13bc9938c4668daa951ff327bf6eae4f24d1c` and
`085f4ad480d58c2f6c220618727935040f07cff260570981779e9c8197ee82ec`.

The root then observed Turbopack rejecting the external `node_modules` symlink
outside its configured filesystem root. A fresh attempt is held until the
proposed contained dependency-copy delta receives its independent source review;
the earlier admission does not certify that forthcoming change. CLI help omits
`logflare`/`supavisor` exclusion aliases, but the reviewer did not establish those
aliases as this attempt's cause and did not recommend a speculative change.

## Historical scanner metadata appendix

No values, Match or Secret fields are included. Fingerprint for each row is the
exact concatenation `commit:path:rule:line`. Every row is outside CMD-109's
current tracked diff. “Tracked now” was checked with exact `git ls-files --`
paths; it does not mean the historical matched bytes still exist at that line.
The owner states these are the already-known September 27 findings. They remain
an adverse broad-history scan result pending separate triage, not a new candidate
range verdict.

| Path | Line | Rule | Commit | Tracked now |
| --- | --- | --- | --- | --- |
| `.env.local.example` | 13 | `generic-api-key` | `1d0bc93ce7fab8a16f296ce1aa37041060059af7` | Yes; runtime copy excludes it |
| `.env.local.example` | 39 | `generic-api-key` | `1d0bc93ce7fab8a16f296ce1aa37041060059af7` | Yes; runtime copy excludes it |
| `.env.local.example` | 22 | `jwt` | `1d0bc93ce7fab8a16f296ce1aa37041060059af7` | Yes; runtime copy excludes it |
| `supabase/tests/0069_wine_list_publication_idempotency.sql` | 659 | `generic-api-key` | `aca35e4e381599382b3bc84ef0dce77b33f79af3` | No; file absent |
| `src/app/api/reconcile/route.test.ts` | 115 | `generic-api-key` | `cb6445c2e8a799cd9952db4d5755d68070f91aef` | Yes; unchanged |
| `src/app/api/pour/undo/route.test.ts` | 25 | `generic-api-key` | `fa984b74f58d8f70e82071935967ed2a472238ef` | Yes; unchanged |
| `src/app/api/pour/route.test.ts` | 25 | `generic-api-key` | `8a8be6104a3ecd44459919707b0e3ef9e8a1721a` | Yes; unchanged |
| `supabase/tests/0057_atomic_idempotent_commands.sql` | 752 | `generic-api-key` | `f6b6507a886410299ee269cc0c757deac117650d` | No; file absent |
| `src/lib/auth/temporary-bypass.test.ts` | 4 | `generic-api-key` | `00ea10912e711ff149807abe5882fc683e6f67b5` | No; file absent |
| `src/app/api/dev-login/route.test.ts` | 4 | `generic-api-key` | `00ea10912e711ff149807abe5882fc683e6f67b5` | Yes; unchanged |

## Contained dependency-copy admission

The parent/worker replaced only the external dependency-root symlink with a
contained recursive copy. Source and destination walks refuse absolute links,
relative links resolving outside their respective canonical `node_modules`, and
dotenv-named entries. `fs.cp` preserves the admitted relative links and requests
`COPYFILE_FICLONE` (best-effort copy-on-write, not a correctness assumption).
Destination admission requires an actual directory, not a root symlink. No
canonical dependency install/write or Next bundler/configuration change is added.
The already-pinned pnpm setting prevents implicit dependency installation in all
child consumers.

Independent source/test recheck passed: 26 Node tests, 0 failures/skips, scoped
ESLint exit 0. The two new tests verify source/destination link containment,
absolute/escaping/dotenv refusals, and unchanged canonical content/inode/mode
after modifying the runtime copy. The current admitted hashes are:

- launcher: `c1e540fe3bcc2d78192b06e1689bddb9d80748a4e81b0eb83a2dbd3a811540c9`
- portable tests: `430b26f8d67cdffd0ea397366bc6eaea323e34a512927ff0b8f611804c538ba3`

Other frozen package hashes above remain unchanged. Bounded source admission
extends to fresh `terroir-demo-20261001-mobile-b` at the already-admitted requested
ports (app 3102, API 61321, DB 61322). Actual copying, default Turbopack startup,
migrations, browser execution and cleanup still need fresh execution evidence.
Attempt A remains preserved; its empty loopback network is not permission to
delete or reuse its namespace. The reviewer performed no Docker or DB mutation.

## Later immutable application-range scanner result

After the parent committed only the four reviewed import application/test files,
HEAD became `ffced31d0964082c2554b1e566d5762e4c36619a`; verified `origin/main` was
`2d76a701c466cf2ed28aac77eb0176444f7919f5`. The reviewer then independently ran
the exact `gitleaks detect --source . --no-banner --redact --log-opts
origin/main..ffced31d`: exit 0, two commits, 4.97 KB, no leaks. The exact
`git diff --name-only origin/main...ffced31d` returned 15 application/E2E paths,
including the preserved Cellar checkpoint and new import repairs. This is a
clean secrets scan of that immutable application range, not a security/source
review of all Cellar changes or a scan of the still-uncommitted portable harness.
The final committed portable candidate needs its own full-range check.

`portable-security-history-review.json` separately records the earlier canonical
all-history fallback as FAIL with metadata-only unresolved historical triage.
The security-review validator returned `security-review-report: OK`, exit 0.
Its verdict deliberately remains distinct from the passing local source admission
and later passing immutable application-range scan.

## Independent attempt-C replan admission

**PASS, source only**, after independently reading
`portable-startup-replan.md`, the preserved attempt-B graph/result and the
database reviewer's read-only base-ledger note. Attempt B started seven healthy
containers attached to the intended owned network, but the CLI also created a
second empty network named after the 64-hex ID supplied to `--network-id` and one
unattached excluded Edge Runtime cache volume. Source topology admission stopped
before source migrations/users. The raw evidence confirms these concrete
observations; the reviewer did not start, stop, adopt or delete B's resources.

The materially different startup supplies the pre-admitted `network.name` to the
CLI. The ledger, attachment checks, returned identity and cleanup still use
`network.id`. Every extra network remains refused. The only excluded-service
artifact admitted is exact `supabase_edge_runtime_<project>`, with exact project
labels, observed empty execution label, finite creation time at/after the owned
network at their shared precision, and no container in the complete inventory
using it. Pre-start namespace absence remains required. Its raw name, timestamp
and labels enter the ledger; re-admission still refuses drift and foreign users.
This is not a generic orphan-volume exception.

The reviewer found and reproduced a timestamp precision defect in the first
replan: whole-second Docker volume `CreatedAt` was compared directly to subsecond
network `Created`, rejecting a valid same-second creation. Root added one
`Math.floor(ms / 1000)` comparison after the finite checks and one regression for
same-second acceptance/preceding-second refusal. Independent reproduction using
the preserved B graph in memory passed after the fix; reversing that exact
comparison reproduced the prior frozen helper hash. Raw timestamps used for
ledger identity are unchanged. The finding is resolved.

The additional goal-safety change renames the successful cleanup to
`cleanupOwnedServices`, removes its runtime-directory `rm`, retains marker/path/
device/inode checks around exact Docker cleanup, and always records
`runtimePreserved: true`. Success may remove only this execution's admitted new
Docker resources; failure preserves them. Runtime/evidence/latch files are never
deleted by the revised launcher, including on success.

Final reviewed hashes:

- launcher: `fc8a856dd766d2322ad279ada7e9525861a51bc13e721b3afe65990058006e84`
- lifecycle: `3842dcf284dbf330f10831f0950dbb07411e0b8fe2624faf750a281359926dcf`
- portable tests: `02f0e1b0c25f8d5ef0e917f4cbcb69645184124b85bfe4390caed04ba3878219`

Fixture and journey frozen hashes above remain unchanged. Independent full
non-incremental TypeScript, scoped ESLint and diff checks exited 0. The package's
pure Node command passed 29 tests, 0 failures/skips. Fresh redacted target-only
gitleaks scanned 113.43 KB with no leaks, exit 0; this is supplementary source
evidence, not the still-pending final immutable candidate range certificate.

Admission is only for fresh `terroir-demo-20261001-mobile-c` and fresh runtime/
evidence destinations: shadow/API/DB/studio/mail ports
62320/62321/62322/62323/62324, app 3103, complete journey 390px. It confers no
authority over B or other retained stacks. Per the parent's explicit bounded
replan, if C fails: stop, preserve and report the exact failing boundary; do not
launch a fourth environment. Actual C startup/migrations/browser/database checks
remain unverified at this review checkpoint. No production conclusion is made.

## Attempt-C partial runtime verdict and stopping point

The replanned run reached local app admission and then failed in the browser.
The reviewer independently read `launcher-result.json`, `journey-result.json` and
the frozen script/current Cellar source, and viewed `journey/failure.png` from
`proof/terroir-demo-20261001-mobile-c-evidence/`. No restart, live browser action,
SQL, replay, source correction or Docker mutation was performed by the reviewer.

Captured launcher result: 136 migrations, exact admitted database container
`be1e35bbb6f67dda282207f8de293920146381dfaa1119ebb98c6625fd47b350`, last step
`local-app-admitted`, failed status, preserved runtime. Captured journey result:
390px; last completed step `received-main-2-of-2`; no in-flight mutation;
two distinct receive operation IDs and two distinct inventory item IDs;
`receiveReplayVerified: true`; failed status. The routine screenshot array is
empty because the measured-count and viewport phases were never reached.
`failure.png` exists separately and visibly shows two wines, the main wine at
2 in stock, and `DEMO-A1`. It proves neither an open bottle nor a pour.

### Source-evidenced failure trigger

`journey.mjs:179` asks Playwright for placeholder
`Search name, producer, region…`, immediately after receiving and the committed
receive replay. Current `cellar-shell.tsx:510-511` instead renders accessible name
`Filter this cellar` and placeholder `Filter this cellar…`. The captured failure
image shows that current empty filter. The obsolete selector cannot match it;
the first visibility assertion in `selectWine` cannot progress to search/row click.
The raw Playwright error/stack is deliberately not saved, so this conclusion
comes from the deterministic source mismatch plus the exact stop point/image,
not an invented terminal traceback.

`data-cellar-row` still exists at `cellar-row.tsx:124`, and the received wine/stock
is visible. Existing updated E2E helpers already locate the canonical
`getByRole('searchbox', { name: 'Filter this cellar' })`. No missing-stock or
application search malfunction is established by this failed selector wait.
Highest-priority next approved fix: update the journey to that semantic locator
and add a regression tied to the current search contract. Do not revert the
application's intended filter wording. No fix or fourth launch is authorized by
this stopping-point report.

### Milestone disposition

| Criterion | Verdict | Independently checked evidence boundary |
| --- | --- | --- |
| Receiving/place and committed retry prefix | PASS, bounded partial only | Saved result contains two distinct operation/inventory IDs and verified same-key response/state replay; 390px failure image shows 2 bottles in DEMO-A1. |
| M1: complete integration/privacy | FAIL, not fully proved | Launcher records migrations applied, but that is not full database authorization/concurrency/privacy or canonical live-suite certification. Separate database verifier owns fresh 0162/0163 and raw-cost evidence; this reviewer did not rerun SQL. |
| M2: four repairs live application boundaries | FAIL, incomplete | Receiving prefix executed. Live bin rename, batch/session import undo and recoverable stalled-expiry HTTP/browser checks were not executed by this journey. |
| M3: complete authenticated staff/manager journey | FAIL | No open/pour/count/reconcile/reload/fresh-session/staff-denial/cross-site phase reached. `received-main-2-of-2` and failed status are decisive. |
| M4: role-aware responsive UX | FAIL, incomplete | One failed 390px state only. No current 320/768/1200 observation, keyboard/focus, role controls or state-recovery matrix was captured. Source/unit coverage is not rendered proof. |
| M5: complete reviewed reproducible demo handoff | FAIL, incomplete | Known selector defect and no successful one-pass/MacBook run. A safe partial source checkpoint is not M5 completion; final source-range/CI/remote SHA checks remain required. |

**VERDICT: FAIL for the current restaurant-demo milestone.** The reviewed safety
source is a coherent incomplete checkpoint suitable for preservation on the
authorized feature branch once final source/security/commit/remote checks pass.
Do not label it demo-ready, production-ready or mobile-URL-ready. Do not merge to
`main`, deploy, overwrite data or infer hosted state from a source push.

Preserve C's Docker graph, runtime, mutation latch, committed receiving receipts
and failure evidence. Stop after this replanned failure: no fourth environment,
restart, reseed or blind mutation replay. Correct the handoff's earlier 26-test/
pending-runtime and successful-runtime-removal statements before publishing the
checkpoint. Current independent TypeScript/scoped ESLint/diff checks passed;
29 pure Node tests passed, 0 failed/skipped. Those passing checks do not erase
the executable browser failure.
