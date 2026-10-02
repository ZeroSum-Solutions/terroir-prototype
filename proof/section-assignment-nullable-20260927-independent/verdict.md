# Independent TypeScript review — section assignment boundary

Verdict: **SOURCE APPROVED; NOT MERGE-READY UNTIL GENERATED TYPES LAND**

No CRITICAL or HIGH findings remain in the reviewed normalizer, routes, tests, or receipt parser. The earlier HIGH finding is closed: the normalizer now rejects both optional plain and optional already-nullable declarations for the new RPC argument while leaving the existing allowlisted functions unchanged.

The repository TypeScript gate is still red with exactly two expected `TS2345` errors because `src/types/database.ts` does not yet contain `assign_wine_sections_private`. No cast or generated-file hand edit was used. Regenerate types from the admitted 0160 schema and rerun `pnpm exec tsc --noEmit` before merge.

## Exact reviewed source

- `scripts/nullable-rpc-args.mjs` — `20cc2f62b7ff54e5cd76326090b3263b78a7c594d1391848742a52ac4ff95ad0`
- `src/test/contracts/nullable-rpc-args.test.ts` — `c3eb11be0db1e5a27c5d11cda117e9b1fd68bc5314ff3d6f4c7ab7e503514da5`
- `src/app/api/cellar/[id]/section/route.ts` — `fd8f4b63229ffd08a37543e7210f344cb8e3c11aaa1e094c810d5eac0135d73c`
- `src/app/api/cellar/[id]/section/route.test.ts` — `62d4d6d70df2b4382d471c964b0345445492d24e5eb183574030f9ec4fd57041`
- `src/app/api/cellar/batch-section/route.ts` — `629b1f4c2c7b2f41bdee7eb06bafc82edfa7fc64e72c0cf95e09fecb88ca25cc`
- `src/app/api/cellar/batch-section/route.test.ts` — `1fe6be6b2e9af00086780996de3339f3c4676c70d1a1f74e83150863db7e47d1`
- `src/lib/staff-cost/wine-section-assignment.ts` — `00fb86cb8f128436026cf3e75c81f6b070c0748f4cac588d19dcd5b9c7abac6e`

Branch/HEAD at review: `feat/production-readiness-20260923` / `fe9ba7c103770f7bf6a932db9175888fe307e0b1`.

## Contract review result

- The exact nullable span count is 30 and normalization remains idempotent.
- `assign_wine_sections_private.p_section` becomes `string | null` while remaining required.
- Optional `p_section?: string` and `p_section?: string | null` both fail closed.
- Site and wine-set inputs remain required and nonnullable.
- PATCH and POST authorize before parsing, strip unknown body keys, pass only parsed fields, do not deduplicate the batch, and perform exactly one RPC with the authenticated restaurant ID.
- PATCH preserves blank-to-null and the existing `{ wine_id, section }` response. POST preserves nonempty sections and returns `{ updated, section }` from the verified receipt.
- `P04W1`, `42501`, post-validation `P04V1`, unknown returned failures, and thrown failures follow the accepted mappings and redaction rules.
- The shared parser requires one strict non-array object with exactly `requestedWineCount` and `section`, a safe integral exact count, and an exact normalized section.
- No direct table read/update remains in either route.

## Verification

- Root RED proof reviewed: `root-optional-red.json` — 2 expected failures, 17 passes.
- Root GREEN proof reviewed: `root-optional-green.json` — 19/19 passes.
- Independent normalizer plus adjacent generator run: 2 files, 43/43 tests passed (`fixed-normalizer-and-adjacent-tests.log`).
- Independent route run: 2 files, 45/45 tests passed (`section-route-tests.log`).
- Bounded ESLint over all seven reviewed files: exit 0 (`fixed-and-app-bounded-eslint.log`; empty output).
- Full `tsc --noEmit`: exit 2 with only the two expected missing-generated-RPC `TS2345` diagnostics (`app-tsc-no-emit.log`).

No DB, Docker, runtime server, network, Git mutation, credential access, or generated-type edit was performed.
