# Completed transport replay canonical-input blocker

Verdict: **ROUTE FIXED / SQL acceptance still blocking**.

The approved contract requires the operation UUID to bind exact canonical
input and requires changed input to refuse. The current 0157 transport replay
contains a strict cost-free receipt but no canonical request input. The current
0158 writer validates durable canonical input only after requiring an unfinished
transport claim. Therefore a completed transport replay returns before the 0158
writer can compare input.

The honest scanner client always re-reads and sends the exact persisted bytes.
The route now invokes `save_bottle_inventory_private` for both `claimed` and
`replay`, never returns the transport receipt directly, strict-parses the writer
receipt, and maps exact durable input conflict to a redacted HTTP 409. Its route
regressions are green against the revised writer contract. The inspected 0158
SQL hash below still rejects completed transport before durable validation, so
runtime acceptance remains blocked until that SQL delta and its database proof
land.

## Proof-only red regression

The canonical route test was temporarily changed to require HTTP 409
`idempotency_conflict` and a durable validation call for a completed transport
replay whose body changed from quantity/cost `2/42.5` to `99/999`.

Command:

```text
/Users/zero/.local/share/mise/installs/node/20.20.2/bin/node /Users/zero/.cache/node/corepack/v1/pnpm/9.15.9/bin/pnpm.cjs exec vitest run src/app/api/inventory/save-bottle-scan/route.test.ts -t 'refuses a completed transport replay when a direct caller changes the body'
```

Exit: `1`

Stdout:

```text
Test Files  1 failed (1)
Tests  1 failed | 9 skipped (10)
AssertionError: expected 200 to be 409
- Expected 409
+ Received 200
```

After the defect was confirmed, the canonical route behavior was changed. The
retained tests now require exact replay to call the writer and return its strict
receipt, while changed-input replay calls the writer and receives a redacted
conflict. The application suite is not knowingly red.

## Required follow-on

The smallest SQL follow-on must admit an exact within-TTL completed bottle
transport into durable version-3 request validation, return the same strict
receipt for the exact payload, and refuse changed input or incomplete durable
state before wine/inventory mutation. Migration 0157 remains frozen; this packet
did not edit SQL.
