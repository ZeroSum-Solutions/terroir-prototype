# Recovered owner/staff browser proof

Verdict: PASS for the bounded recovered owner service flow and synthetic staff authorization checks. Not a first-pass journey, full security seal, viewport PASS, import proof, or production approval.

Independently read the actual continuation and staff JSON receipts, checked their assertions against the admitted source, and viewed both continuation screenshots. No browser/database/runtime calls were made by this reviewer.

Bindings:

- Continuation source: `a8e98ebd53a42b6e82c33bce40d7699e2ed1e65663c366c4e9db9b2edb3c3a01`.
- Staff source: `06c66eb751839f716de7702c8fdb5c0adcaea74c3bd840bc582deae1101bebf5`.
- `journey/evidence-continuation/continuation-result.json`: `5220d0f195ec3831e8c75f227d1987f9063a5ee0c0c17cb49efd80895aa6e227`.
- `journey/evidence-continuation/staff-result.json`: `e256329f09aa7dc634b66aefb3fa1cf546b276549cbbc26019f8296c6287bcdf`.

The continuation starts from the independently guarded 750ml/version 0 bottle with exactly the original two receive receipts and one open receipt. It does not replay these operations. Four distinct UI pour operations assert 600/450/300/150ml and versions 1–4. The real v2 cellar-menu reconciliation asserts an expected version 4 request and 120ml/version 5 response. Reload and fresh-login checks require the selected exact bottle and visible 120ml. The cross-site restaurant PATCH returns 403, and full captured restaurant plus selected bottle state compare equal before/after.

The separate staff fixture receives two bottles and opens one. The synthetic staff actor's password login and site context are asserted; its real UI pour changes that separate bottle from 750ml/version 0 to 600ml/version 1. Management reconciliation returns 403 with zero operation receipt and unchanged main bottle at 120ml/version 5. The staff screenshot visibly shows that main bottle, 120 of 750ml and disabled “Below pour size.” Cost/margin controls are absent in the inspected drawer; this does not prove all sensitive data surfaces are sealed.

The original owner timeout and mutation latch remain preserved. The cause of that timeout is unproven. The four-pour screenshot was captured during rendering: it shows four success toasts but still the old 25.4oz display. It is not settled-volume visual evidence; response assertions, later reload checks and captured database state support the resulting volume. The first viewport failure is also preserved and requires its separate corrected non-mutating run. Full protected-database conservation and owned-runtime cleanup remain the root's later closeout gates.
