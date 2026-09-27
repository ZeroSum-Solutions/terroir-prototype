# Portable demo default-deny checkpoint — source-only admission

The frozen launcher CLI cannot reach materialization, stack startup, synthetic user creation, fixture writes or cleanup: `parseLauncherArgs` unconditionally throws for `--execute`, including the exact acknowledgement. Without execution it returns `executionReady:false` and `blockedReason:docker-resource-ownership-not-admitted`; its subsequent checks are read-only. The private execute function is not exported. Importing the module does not run main.

Independent clean Node 20.20.2 pure-source tests: 7/7 PASS, zero skipped. The test explicitly exercises denial with the otherwise valid execution acknowledgement. No runtime, DB, Docker, browser, credential or environment-file action was performed by the reviewer.

This admits inclusion as **unfinished, non-runnable launcher source**, not runtime execution. The separate journey CLI still exists and is not thereby admitted for standalone use. Do not bypass the launcher gate or manufacture a READY document. The resource-ownership and cleanup findings in `independent-portable-demo-initial-hold.md` remain execution blockers. No new MacBook, header-browser, mobile URL or production proof follows from this decision.

Exact SHA-256 values:

| File | SHA-256 |
|---|---|
| scripts/local/restaurant-demo/launcher.mjs | cbd3668ced614e8728abb0d2d04c2f8f370786e6a75f1d6e76820339ce5f13cd |
| scripts/local/restaurant-demo/fixture.sql | fab670419c0b9ea2250034625f1991d6dee71ef4379556184406b2bbea9f0af4 |
| scripts/local/restaurant-demo/journey.mjs | 615d66ca1ee9ec9bc88cd8e6d5973181680fee3e61f89a914a456558bbc43cec |
| scripts/local/restaurant-demo/portable-demo.test.mjs | 50fc621fed5053eaecc68197b824227feb4f3fa15ad99ca05c572ec0faeb1aa3 |
| docs/runbooks/restaurant-demo-macbook-handoff.md | 4d9ba371ab1f767807ad2e0c64ee1a5c6d337bf4f7548e524a9536b29e5148a3 |

The draft runbook explicitly marks the package NOT_RUNTIME_ADMITTED. Known production compatibility, immutable-range security review and final staff-cost contract gates remain separate.
