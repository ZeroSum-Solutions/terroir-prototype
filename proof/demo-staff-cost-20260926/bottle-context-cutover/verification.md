# Bottle context cutover verification

Date: 2026-09-26 (America/Los_Angeles)

Scope: BPR-001 client actor/site cutover, server expected-context admission, and
the application route handoff to the applied-0158
`save_bottle_inventory_private` RPC. No database, browser, provider,
credential, Git, migration, generated-type, auth-resolver, or membership-resolver
action was performed.

Verdict: **PARTIAL**. The BPR-001 trigger and typed atomic-route cutover are
green in source tests. Acceptance remains blocked by the separately recorded
completed-transport replay/input-conflict gap in `canonical-replay-blocker.md`.

## Baseline before regression

Command:

```text
/Users/zero/.local/share/mise/installs/node/20.20.2/bin/node /Users/zero/.cache/node/corepack/v1/pnpm/9.15.9/bin/pnpm.cjs exec vitest run src/domains/scanning/bottle-pending-operation.test.ts 'src/app/(app)/scan/bottle-pending-recovery.test.tsx' src/app/api/inventory/save-bottle-scan/route.test.ts
```

Exit: `0`

Stdout result:

```text
Test Files  3 passed (3)
Tests  27 passed (27)
Duration  674ms
25 live-DB suites reported skipped by the repository harness.
```

## BPR-001 red regression

Command:

```text
/Users/zero/.local/share/mise/installs/node/20.20.2/bin/node /Users/zero/.cache/node/corepack/v1/pnpm/9.15.9/bin/pnpm.cjs exec vitest run 'src/app/(app)/scan/bottle-pending-recovery.test.tsx' src/app/api/inventory/save-bottle-scan/route.test.ts
```

Exit: `1`

Stdout result:

```text
Test Files  2 failed (2)
Tests  10 failed | 16 passed (26)

All four delayed-Web-Lock cases failed the zero-POST assertion:
actor switch, site switch, sign-out, and unmount each observed 1 save POST.
The persisted request lacked X-Expected-User-Id and
X-Expected-Restaurant-Id.
Both server stale-context cases expected 409 but received 200.
The atomic-RPC assertion observed claim_scan_idempotency,
find_or_create_wines_batch, inventory:insert, match_lwin_batch, and
complete_scan_idempotency instead of save_bottle_inventory_private.
```

This is the concrete pre-fix behavior reported by independent finding BPR-001.

## Final focused green

Command:

```text
/Users/zero/.local/share/mise/installs/node/20.20.2/bin/node /Users/zero/.cache/node/corepack/v1/pnpm/9.15.9/bin/pnpm.cjs exec vitest run 'src/app/(app)/scan/scanner.test.tsx' 'src/app/(app)/scan/bottle-pending-recovery.test.tsx' src/domains/scanning/bottle-pending-operation.test.ts src/app/api/inventory/save-bottle-scan/route.test.ts src/app/api/scan-ingestion-boundaries.test.ts
```

Exit: `0`

Stdout result:

```text
Test Files  5 passed (5)
Tests  109 passed (109)
Duration  992ms
25 live-DB suites reported skipped by the repository harness.
```

The green set includes exact locked-record replacement refusal, delayed-lock
actor/site/sign-out/unmount zero-POST retention, expected-context headers,
missing/stale server context before claim, strict receipts, 400/409/5xx/network/
malformed-2xx retention, a 30-second hung-fetch abort with retry state restored,
transport replay through the durable writer contract, changed-input replay
conflict, bounded hung fetch and response-body handling, and the scanner
double-submit guard. Route coverage also includes
in-progress/expired transport states, actor/kind claim conflict, atomic
uncertainty, and redacted durable conflict.

## Mechanical gates

TypeScript command:

```text
/Users/zero/.local/share/mise/installs/node/20.20.2/bin/node /Users/zero/.cache/node/corepack/v1/pnpm/9.15.9/bin/pnpm.cjs exec tsc --noEmit
```

Exit: `0`; stdout: empty.

Lint command:

```text
/Users/zero/.local/share/mise/installs/node/20.20.2/bin/node /Users/zero/.cache/node/corepack/v1/pnpm/9.15.9/bin/pnpm.cjs lint
```

Exit: `0`.

Stdout result:

```text
7 warnings, 0 errors
```

All seven warnings are in pre-existing, out-of-scope files: imagery audit,
cellar enrichment test, list reorder tests/hooks, note composer test, and the
wine corpus fixture. None is in a changed bottle-context path.

File-size command:

```text
/Users/zero/.local/share/mise/installs/node/20.20.2/bin/node /Users/zero/.cache/node/corepack/v1/pnpm/9.15.9/bin/pnpm.cjs check:file-size
```

Exit: `0`

Stdout:

```text
File size: no new monoliths (22 file(s) over budget (400 source / 1000 test), of 25 baselined; 1443 lines paid down).
```

## Limitations

- No live database was used. The applied-0158 SQL and generated database type
  were inspected read-only; their hashes are in `source-hashes.sha256`.
- No browser run was performed.
- The 25 live-DB suites were not run because no loopback Supabase environment
  was configured; production `.env.local` was never read or used.
- The canonical-input conflict on completed transport replay is an active
  blocker, not a waiver. See `canonical-replay-blocker.md`.
