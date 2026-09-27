# 0164 physical open/revert races — independent actual review

Date: 2026-09-27

## Verdict

**PASS** for the bounded physical open/revert concurrency proof. The abandoned
first attempt is correctly classified only as a conserved fixture closeout and
is not counted as race evidence.

This review is read-only. It did not execute PostgreSQL, Docker, migrations, or
fixture SQL.

## Frozen evidence

- `0164-physical-open-first-r2-actual.json`
  - SHA-256 `76ccedbc88f04588917fe8282c40b35981fd782fbf1c2ab4040085614a39b2de`
- `0164-physical-revert-first-r2-actual.json`
  - SHA-256 `3c63a810929ac666ec5ab1910a01b28dc643ec54dfe9c3192c0b254ba4baa815`
- `0164-physical-abandoned-fixture-closeout.json`
  - SHA-256 `4eb548ddcb3755537aac7f052a12575c65926c9bfda588087acdba3e0065c515`
- `0164-physical-final-conservation.json`
  - SHA-256 `8ff849a3e917e07d306caf370a5b604dbca3de99f11470dbd793dafc329538d3`

Every execution record pins the accepted target
`terroir_bottle_location_0161_20260927a`, migration SHA-256
`b5416022789c096d9b94245770e543465d74a02f60c847270254e862545294ad`,
and these exact fixture inputs:

- setup `ff55865bf31a59a36e1930437c38bf71da8605cdf0ada228b02b6c14d291df0a`
- A `01df63516e23b468ceb74c5c52793664afdb6bdcef4728d49476455e5089b2b5`
- B `948c3e93928487e50510139d34097db30a46feea6cf82d3c88451b6f8a09720f`
- observer `8f9d5b9d80597f53a6d8325d7bddef464bd7e177740bb9563e81305f800eae61`
- verifier `219b1e0f25c03ce8924e89c8a5f2ee979e6d2224a4184f2ecedaa8d24152c4f5`
- corrected cleanup `7982073748cfc0ae4bce11debc5780956b46ffc33574c5fdc10b621d63399912`

## Criterion review

| Criterion | Result | Independent evidence |
|---|---|---|
| Abandoned attempt does not become race proof | PASS | Closeout has cleanup status 0 and marker `C09_0164_PHYSICAL_RACE_CLEANUP_PASS`; raw target/protected/clone projections equal their before captures; peers are `0`; `raceProof` is explicitly `false`. |
| Open-first real overlap | PASS | A PID `95746` was `active / Timeout / PgSleep`; B PID `95758` was `active / Lock / transactionid` with sole blocker `{95746}`; observer scalar was `1`. |
| Open-first terminal behavior | PASS | Setup, observer, A, B, verifier, and cleanup all have status/exit 0. Frozen B input enforces exact `P04D3 physical_bottle_dependency`; verifier returned `c09_0164_open_first_exact_state = 1`. |
| Revert-first real overlap | PASS | A PID `95833` was `active / Timeout / PgSleep`; B PID `95851` was `active / Lock / transactionid` with sole blocker `{95833}`; observer scalar was `1`. |
| Revert-first terminal behavior | PASS | Setup, observer, A, B, verifier, and cleanup all have status/exit 0. Frozen B input enforces exact `P0001 no_inventory`; verifier returned `c09_0164_revert_first_exact_state = 1`. |
| Per-mode cleanup restores target | PASS | Each corrected cleanup exited 0 with its terminal marker. Independently projected SQL value plus schema/data dump records after each cleanup are byte-for-byte equal to the three-record before-target projection. |
| Protected databases and browser clones conserved | PASS | Independently projected final records equal the before captures: 23 protected records and four browser-clone dump records. Final peers are `0`; both mode target captures equal the before-target projection. |

## Independent method

A clean Node 20 read-only validator reparsed every outer JSON artifact and each
embedded command/capture JSON. It asserted artifact hashes, target/mode/source
arguments, all six fixture pins, exit/status values, terminal markers, timestamp
ordering, A/B wait rows, sole-blocker PID equality, exact-state scalars, and
record-by-record conservation after projecting away capture-only timestamps and
stdout hashes. All assertions exited 0.

## Boundary

This PASS covers the two physical open/revert schedules and their conservation
only. It does not complete the separate authority, LWIN, shared-source, or
inverse-session schedules.
