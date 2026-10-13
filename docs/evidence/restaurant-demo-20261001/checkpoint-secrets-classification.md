# Checkpoint scanner classification

Independent read-only review, 2026-10-01 Pacific. No UUID/key value is reproduced
here. No SQL, source, credential or history change was made by this reviewer.

## Finding and provenance

The initial exact immutable branch-range scan returned one finding:

- Ref: `26df60b0e2d26463e6ec00830756e58897d9386f`
- Path: `docs/evidence/restaurant-demo-20261001/staff-raw-cost-probe.sql`
- Rule/line: `generic-api-key`, 22
- Fingerprint: `26df60b0e2d26463e6ec00830756e58897d9386f:docs/evidence/restaurant-demo-20261001/staff-raw-cost-probe.sql:generic-api-key:22`

**Classification: confirmed false positive, synthetic identity UUID—not a
credential.** The flagged literal is the residual-count query's auth-user ID. It
equals the identity inserted earlier within this transaction and the local
authenticated subject used by this exact probe. It is not a password, signing
key, service/API key, bearer token or connection string. The synthetic email uses
the reserved test domain. ROLLBACK precedes the residual queries; captured actual
user/wine/inventory residual counts are 0/0/0.

Independent assertions compared the committed SQL bytes against the executed
probe, checked identity equality in memory, transaction/rollback order and the
captured residue. They exited 0 without executing SQL or printing the literal.
The common SQL SHA-256 is
`192f6bc1bff05533ccded4ab7ed9303869b024fbd46173aa4b598fbda1958ca9`.
See `staff-raw-cost-failure.md` for the separate actual confidentiality failure
and `staff-raw-cost-probe.sql` for exact executed source.

The implementer added only this immutable fingerprint to `.gitleaksignore`, with its
provenance comment. Independent inspection confirmed no path exclusion, rule
exclusion, UUID/value regex, changed SQL or history rewrite. Future edits or a
different commit fingerprint are not suppressed. No credential rotation is
warranted by this scanner match.

## Command evidence

CMD-201: `git rev-parse HEAD origin/main`, exit 0, returned respectively
`26df60b0e2d26463e6ec00830756e58897d9386f` and
`2d76a701c466cf2ed28aac77eb0176444f7919f5`.

CMD-202: `git diff --name-only origin/main...26df60b0e2d26463e6ec00830756e58897d9386f`,
exit 0, exact captured paths:

```text
docs/evidence/restaurant-demo-20261001/functional-contracts.md
docs/evidence/restaurant-demo-20261001/import-current-review.md
docs/evidence/restaurant-demo-20261001/m2-live-test-map.md
docs/evidence/restaurant-demo-20261001/mobile-c-failure.png
docs/evidence/restaurant-demo-20261001/mobile-c-journey-result.json
docs/evidence/restaurant-demo-20261001/portable-security-history-review.json
docs/evidence/restaurant-demo-20261001/portable-source-review.md
docs/evidence/restaurant-demo-20261001/portable-startup-replan.md
docs/evidence/restaurant-demo-20261001/staff-raw-cost-failure.md
docs/evidence/restaurant-demo-20261001/staff-raw-cost-probe.sql
docs/plans/2026-09-27-terroir-restaurant-demo-milestone.md
docs/runbooks/restaurant-demo-macbook-handoff.md
e2e/inventory-command-recovery.test.ts
e2e/lineage.test.ts
e2e/mobile-service-readiness.test.ts
e2e/pour-flow.test.ts
scripts/local/restaurant-demo/docker-lifecycle.mjs
scripts/local/restaurant-demo/fixture.sql
scripts/local/restaurant-demo/fixture.test.mjs
scripts/local/restaurant-demo/journey.mjs
scripts/local/restaurant-demo/journey.test.mjs
scripts/local/restaurant-demo/launcher.mjs
scripts/local/restaurant-demo/portable-demo.test.mjs
src/app/(app)/cellar/cellar-list.test.tsx
src/app/(app)/cellar/cellar-list.tsx
src/app/(app)/cellar/cellar-masthead.tsx
src/app/(app)/cellar/cellar-shell-open-bottles.test.tsx
src/app/(app)/cellar/cellar-shell.tsx
src/app/(app)/cellar/section-group.test.tsx
src/app/(app)/cellar/section-group.tsx
src/app/api/import/sessions/[id]/revert/route.test.ts
src/app/api/import/sessions/[id]/revert/route.ts
src/domains/import/import-revert-rpc.test.ts
src/domains/import/import-revert-rpc.ts
```

CMD-203: `gitleaks detect --source . --no-banner --redact --log-opts origin/main..26df60b0e2d26463e6ec00830756e58897d9386f`,
initial exit 1; three commits, 157.99 KB, exactly the one finding above. A separate
redacted stdout-report invocation confirmed exact metadata; no Match/Secret or
UUID value was printed.

CMD-204: the exact same canonical range command, after the implementer added the
reviewed fingerprint policy, exit 0; three commits, 157.99 KB, no leaks. This was
independently rerun, not merely read from the implementer's log. The policy was
still uncommitted at this review checkpoint: include it in the follow-up commit,
then independently scan the full final branch range again before push. A clean
scan of this earlier ref does not certify new follow-up bytes.

CMD-205: independent in-memory provenance assertions described above, exit 0.
CMD-206: `git diff --check`, exit 0. No database or browser command was executed.
CMD-207: `gh repo view --json isPrivate,nameWithOwner`, exit 0, confirmed the
existing `ZeroSum-Solutions/terroir-prototype` repository is public. `git remote -v`
confirmed its existing fetch/push destination. No visibility or remote change occurred.

## Coverage and release disposition

The complete changed-path map and six security surfaces are recorded in
`checkpoint-security-review.json`. Cellar changes in the earlier source commit
are display/refinement/accessibility changes; they add no identity, server grant,
export or model/tool boundary. Portable source and import changes retain their
prior independent admission/review evidence. There is no application/provider
export change. The planned checkpoint publication is to the existing public
GitHub repository on the owner-approved feature branch; its evidence contains
synthetic identities and test-state metadata, not production records or secrets.
No model-provider upload, visibility change or new destination is approved here.

**Secrets classification: PASS with the exact documented false-positive policy.**
This does not erase the separately captured HIGH/open raw staff-cost SELECT path:
staff without `cost.read` recovered the synthetic acquisition cost through legacy
table privileges. The structured product-release security verdict remains FAIL,
as do the current complete-demo and production-readiness verdicts. Publishing an
honest incomplete feature-branch checkpoint is distinct from shipping the app.

Do not amend/rewrite the already-created commit, alter the exact SQL proof,
rotate credentials, weaken broad scanning, restart C, replay mutations or launch
another environment. Commit the narrow policy and this classification separately,
check the final immutable range and remote SHA, and retain all explicit failures.
