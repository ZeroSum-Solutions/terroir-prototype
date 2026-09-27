# 0164 remaining concurrency — independent actual review

Date: 2026-09-27

## Verdict

**PASS** for all six bounded remaining 0164 schedules and their final
conservation. This is an independent review of root-executed runtime evidence;
it performed no PostgreSQL, Docker, migration, fixture, or provider action.

The frozen source contract was independently rerun under Node 20.20.2 and
passed 1/1 with SHA-256
`c4445d0e5bf788ac0a122f9dddf7e608473d1b2bf0d4f832ec9d20d79abc51bf`.

## Frozen evidence

| Artifact | SHA-256 |
|---|---|
| `0164-authority-advisory-actual.json` | `1116808b444e279122ec5af8377c943d576714722b6846a57243004242e2eef1` |
| `0164-authority-batch-actual.json` | `aa06c38165ee2f7ca142dd207e7cbd91b64e75418ebed799b563217758234450` |
| `0164-lwin-apply_first-actual.json` | `6727a86ddcf8cc73e14737efe0be10094e0b4c48cae910c96ee8bb799898eabe` |
| `0164-lwin-revert_first-actual.json` | `d5f49a5bd881e4806cd2f77a14883662a2d243112b8918d5e3e018a808dc0de5` |
| `0164-source-conflict-batch-actual.json` | `11a3d8ab7da68ed7ab7e95d919c2932f210ec2f49e268e341f5d4c22629809df` |
| `0164-source-conflict-session-actual.json` | `e92e6fbabb1c7bf3c921d0657024ce1d47fa4719d84be9e20f779141f96964ec` |
| `0164-remaining-final-conservation.json` | `2014055c35813499365958a0e771d3647293a7d833bdf306379cf49470dd713a` |

Every executed SQL record pins target
`terroir_bottle_location_0161_20260927a`, migration SHA-256
`b5416022789c096d9b94245770e543465d74a02f60c847270254e862545294ad`,
and the exact admitted source packet.

## Criterion review

| Schedule | Result | Independent evidence |
|---|---|---|
| Fresh authority after advisory wait | PASS | A PID `96117` was `Timeout/PgSleep`; B PID `96129` was `Lock/advisory` with sole blocker `[96117]`. The revocation command began and ended while both transactions were active, proved one observed waiter and one revoked membership, and B's pinned source accepted only exact `P0002 import_batch_not_found`. Verify, cleanup, and three-record target equality passed. |
| Fresh authority after batch-row wait | PASS | A PID `96224` was `Timeout/PgSleep`; B PID `96236` was `Lock/transactionid` with sole blocker `[96224]`. Revocation occurred while both were active. The same exact refusal, conservation, cleanup, and target checks passed. |
| LWIN apply first | PASS | A PID `96323` was observed in `PgSleep`; B was `Lock/advisory` before A committed. A's real apply scalar was `1`; B's exact old-batch revert receipt scalar was `1` and therefore enforced `lwinStampsCleared: 0`. Final newer-pair/timestamp state scalar, cleanup, and target equality passed. |
| LWIN revert first | PASS | A PID `96392` was observed in `PgSleep`; B was `Lock/advisory`. A's exact revert receipt scalar was `1` and therefore enforced `lwinStampsCleared: 2`; B's real apply scalar was `1`. The identical final newer-pair/timestamp state, cleanup, and target checks passed. |
| Shared-source batch refusal | PASS | A PID `96485` held the site lock; B PID `96504` was `Lock/advisory` with sole blocker `{96485}`. Both pinned calls accepted only exact `P04I2 import_source_conflict`. Before/after digest `1184d1a61922851eb7508beab36a7ce3e1c7337d05877c9a3672dabd5dd5a350`, exact-state scalar, cleanup, and target equality passed. |
| Inverse-session shared-source refusal | PASS | A PID `96553` held the site lock; B PID `96567` was `Lock/advisory` with sole blocker `{96553}`. Both pinned session calls accepted only exact `P04I2 import_source_conflict`. Before/after digest `0a57655451add45d4da1333e1bfe90d7cedb51ab99af699f99685c83eb4787d2`, inverse-session exact-state scalar, cleanup, and target equality passed. |
| Final conservation | PASS | All six target projections independently equal the same three-record before-target baseline. The final 23 protected records and four browser-clone dump records independently equal their before captures; peers are `0`. |

The validator reparsed every outer artifact and embedded command/capture JSON,
checked artifact and input hashes, complete pin maps, target/source arguments,
statuses, terminal markers, wait rows, sole-blocker PID equality, timestamp
overlap, result scalars, state digests, and record-by-record conservation. All
assertions exited 0.

## M1/M2 database proof boundary

### M1

The migration-specific local integration evidence is now complete for 0160
through 0164: functional, refusal, authorization, both-order concurrency,
paired-down/cycle, conservation, generated types, 136-migration snapshot, and
full TypeScript evidence are present.

One explicit M1 database gate remains unmet: the canonical full unit run
`0164-full-unit.json` was green only with the live database suites disabled. It
records 517 passed and 23 skipped files, 5,576 passed and 182 skipped tests, and
names 25 self-skipped loopback database suites, including cross-tenant
containment. M1 requires no skipped critical database tests. A guarded loopback
run of those canonical suites at the final candidate, with zero critical skips,
is still required; the purpose-built 0160–0164 fixtures do not replace that
broader gate.

### M2

No migration/RPC-level database proof remains open for the four repairs:
receiving 0161, bin mirroring 0162, stalled expiry 0163, and retained-catalog
import revert 0164 all have actual functional, authority/concurrency, rollback,
and conservation evidence appropriate to their contracts.

M2 as a whole is not completed by these database results. The evidence reviewed
here does not provide live application-boundary invocation for the bin PATCH,
batch/session import-revert HTTP callers, or stalled-scan page housekeeping and
warning recovery. Their focused source tests and independent reviews remain
valid, and receiving has browser evidence, but final caller/live-boundary proof
is an application criterion rather than another migration execution.

## Overall boundary

This PASS closes the remaining named 0164 database concurrency matrix. It is
not a production, hosted-migration, full M1, full M2, or milestone-completion
verdict.
