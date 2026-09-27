# Active-site regression repairs — bounded source PASS

Reviewed 2026-09-27 against prior HEAD `fe9ba7c103770f7bf6a932db9175888fe307e0b1`. This verdict covers only the four identity-preflight repairs and their tests. It is not whole-checkpoint security approval, production admission, an atomic tenant seal, or live-database/browser proof.

All four routes now resolve only safe identity, with both object ID and the authenticated active restaurant, before invoking their existing ID-only mutation RPC. Missing/cross-site identities stop before mutation (undo: context 409; scans/wine: 404). Returned/thrown lookup failures stop without mutation. Existing database authorization remains necessary and is not replaced by the preflight. No production migration bytes changed for these repairs.

The undo test uses a filter-aware different-site fixture; the scan/dismiss tests assert the exact restaurant filter, missing-result refusal and returned/thrown failures. These are meaningful regression checks. Independent clean-environment Node 20.20.2 checks:

- `pnpm exec tsc --noEmit --incremental false`: exit 0.
- `pnpm exec eslint . --ext .ts,.tsx,.js,.jsx`: exit 0, zero errors, ten warnings. Three warnings are unused portable-launcher declarations; seven are outside this bounded repair.
- Focused Vitest over the four route test files: 85/85 passed, four files; no live database configured or exercised.
- `git diff --check`: exit 0.

## Exact reviewed bytes

| Path | SHA-256 |
|---|---|
| src/app/api/reconcile-queue/undo/route.ts | 17c3a9fc49a4f6da92f25449b3e1e45439965fd7e239ae82f41548f4d6e90cce |
| src/app/api/reconcile-queue/undo/route.test.ts | 281a959e97475c4d329a89c15296e71886748dd17b83b8bc34f27b595f98c1b9 |
| src/app/api/scans/[id]/commit/route.ts | 0d9b752133c68ad7012ae34cd4dd1245b8a5f37f2e1ca47d64674f81cb3f9f3e |
| src/app/api/scans/[id]/commit/route.test.ts | ce4c7c1423b0a22c5035ae7fb31805b4c4b8441d69683e39e00db2dbf96b124b |
| src/app/api/scans/[id]/route.ts | eeaf7ecc5907b2adf91a3a4545ffbedc7010633ddbea037216554a952d207b96 |
| src/app/api/scans/[id]/route.test.ts | 7a701284b6a1b9515e7652b1fe4bba995f92eeaecfe7353876ef116664c8a247 |
| src/app/api/wines/[id]/dismiss-pricing-alert/route.ts | f634d06153ecba7b78d42cb43cef186ab4d7a45141227ce423298fc5de05b857 |
| src/app/api/wines/[id]/dismiss-pricing-alert/route.test.ts | 9bac7b88346c073310cf674ce933c15e4f1e168b0b51becc55aa5e1f6df3333e |

## Residual boundaries

These preflights restore the prior ordinary selected-site behavior; they are not atomic guards against concurrent raw ownership rewrites. In particular, 0059/0084 batch UPDATE policies do not make batch restaurant identity immutable. Final contract work must close direct writes or compare expected site inside the mutating function. The additive staff-cost work also retains direct table/Storage access until its separate final contract cut. None of the current UI-denial proofs certifies that broader seal.

Production compatibility remains unverified; a main merge auto-deploys app code but does not apply migrations. The new application depends on the admitted local migration/RPC set. A source checkpoint or draft PR must not be represented as a production-ready release. The proposed portable launcher is independently held pending its ownership/cleanup repairs or an explicit fail-closed execution gate.

The 419-file current-content secret scan found no detected values, but it is target-only and not immutable range certification. Historical potential findings remain separate. Full formal checkpoint security review is incomplete; no full security PASS is issued.
