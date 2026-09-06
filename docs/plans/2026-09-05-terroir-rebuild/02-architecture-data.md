# Target architecture and data safety

## System shape

Keep Next.js16 App Router, React and the existing design system, TypeScript, pnpm, Supabase Postgres/Auth/Storage and Railway deployment. Use current pinned versions; no dependency refresh is bundled with rebuilding. Keep SQL/RPCs for atomic stock work and generated DB types inside server repositories. Do not add an ORM, search cluster, message broker, Kubernetes or microservices without measured need.

Server route → validated application command → scoped domain → database transaction/adapters. Browser and public DTOs must not expose generated table types. One deployable web app and a bounded job process share a modular codebase. The full target uses a durable Postgres inbox/outbox and leased workers for Toast/processing; the S slice needs only a resumable intake state and atomic receipt, not an idle fleet.

Minimal S contracts land immediately before consumers. Future F contract shapes are planning notes until their first consumer is admitted:

- ScopeContext: actor, group, owning business, venue and explicit capabilities; active context is a selection, not authority. Recheck grants at mutation execution, including queued work. Costs and supplier terms need separate grants.
- WineIdentity: producer, wine, release/vintage state and package. Unknown vintage differs from NV; preserve source IDs and ambiguity. Shared identity never publishes private overrides automatically.
- StockCommand/Receipt: owning business, custody location, lot, exact units and money/currency, source/actor, operation key bound to payload. Event, balance and durable receipt commit in one transaction; retry returns the same receipt, conflicting reuse fails.
- CountObservation/DraftEnvelope and ConsumptionReconciliation: freeze these interfaces before counts/offline or pours/Toast are implemented. Break their previous feature-dependency cycles here.
- PublicWineView/Publication: rights-approved assertions/assets with source, version, expiry/withdrawal and audit. Public read path has no private tenant joins. Producer assertions remain attributed.
- JobEnvelope: source scope, lease, attempt, retained input, bounded retries, terminal case and dedupe receipt. Entitlement flags do not confer data permissions.

The full stock ledger uses explicit source/destination accounts for venue/transit/consumption, with immutable reversals and transaction isolation/locking chosen and concurrency-tested by the schema owner. No binary floating-point quantities. Money totals stay per currency. A return changes stock only after physical disposition; a Toast refund alone does not.

## Environments and classification

| Environment | Purpose and permitted data | Authority / readiness |
|---|---|---|
| Existing production | Existing private inventory, invoice files, user identities and reference inputs; treat as sensitive until classified | Preserve; account/region/config/current schema must be freshly verified. User reports no dependent users, not absence of personal data. |
| Existing staging | Historical application test environment with reported schema drift | Quarantine from migration rehearsal until metadata/owners confirm contents and isolation. Do not copy its divergence blindly. |
| Protected recovery environment | Restore production DB/Auth/config and object bytes inside the approved production account AND region | Owner-approved destination and access; no general-purpose CI/model access. Rehearsal must pass before destructive work. |
| Candidate integration environment | Synthetic-only production-shaped schemas/fixtures; new pilot accounts only after Gate 2 | Dedicated verified project; no reuse of unknown hosted refs. Before any real pilot identity or receipt, designate it as production within the approved production account and region, with full backup/retention/access policy; otherwise synthetic-only. |
| CI / optional AWS test runner | Ephemeral local Postgres/Supabase and deterministic synthetic assets | No production dumps, tokens, customer rows, invoice images or live Toast payloads. |
| Macs | Source, synthetic fixtures and redacted aggregate evidence | No production copies. `.env.local` is not a test environment; never read/copy it. |

Names above are roles, not evidence that infrastructure exists. Before any future connection, authorized operator records exact account, project, region and purpose without secrets. Production restore/transform jobs run within that approved boundary; export only aggregate counts and sanitized rejection categories for review. No payment-card need is identified; verify schema/asset classification rather than asserting payment data is absent. Credentials and supplier terms are restricted even if no customers depend on them today.

## Retention and transformation proposal

Recommended Gate 1 policy: preserve all existing environments and encrypted backups; new pilot identities and opening inventory start clean. Retain licensed reference datasets, private notes/assets and legacy audit evidence in their original boundary. Selective transformation requires an explicit manifest, not inferred value. Keep recovery artifacts for30 days after accepted cutover and legacy schema/read compatibility for at least30 days; owner must approve duration/cost. Expiry triggers review, never automatic deletion under this plan.

[All 44 generated table dispositions](database-dispositions.csv) are included explicitly: tenancy/config; reference identity/lineage; inventory/events; intake/import; notes/lists; derived views; jobs. No blanket table deletion. Rebuild derived projections; preserve source lineage/tombstones; map legacy restaurant to business/venue only from approved facts. Do not automatically convert null vintage to NV or infer full ledger history from current balances.

Pilot-data policy is separate from preservation of old production. O is accountable, D implements backup/retention controls. Gate 2 must name the pilot production account/project/region and prohibit cross-region exports. Encrypt daily DB/Auth/config backups and separately inventory/version private object bytes inside that boundary. Run a restore of new pilot records/assets before admission. Proposed pilot retention: active pilot duration plus30 days; backup recovery window30 days, approved against cost and actual data obligations. On pilot abandonment, revoke access and stop intake, offer an authorized export, inventory records/assets/backups, then obtain explicit deletion approval for a scoped purge after retention obligations are resolved. No automatic expiry or abandonment deletion. Record export delivery, deletion disposition and backup expiry; keep only approved audit evidence. S accepts typed receipt fields; photo uploads/extraction are disabled, reducing sensitive asset collection, but identity and supplier-cost data still require protection.

Only synthetic fixtures may leave the approved production boundary for Macs, CI or general AWS. **No anonymized production-derived export is proposed or permitted by S.** Any later anonymization project requires a separately approved in-boundary pipeline and re-identification review; “anonymized” is not an escape clause.

Sequence after approval:

1. Inventory actual migration versions, normalized objects, functions/RLS/grants, triggers/extensions, Auth settings, Storage policies and byte volumes. Record confidential row/asset classes and jobs. Investigate staging-only objects; never manufacture migration-history rows to silence drift.
2. For S, D/O verify the candidate recovery destination on Day 1 and attempt a candidate synthetic DB/Auth/config restore by Day 3; inability makes the real-pilot deadline NO-GO. Rehearse the final candidate schema again before Gate 2. The following legacy production restore work belongs to F or any legacy destructive/cutover proposal, not the S critical path: Verify encrypted backup age and decryption access, snapshot-consistent DB/Auth export, configuration manifest and separate Storage-object inventory/checksums. Existing Storage metadata is not the bytes. Restore into the approved recovery environment; prove private asset access and revoked access. A drill from an older schema is insufficient.
3. Create additive target structures in isolated candidate after schema owner approval. Generate types from the intended candidate/local applied schema, not the default hosted target. No migration is created during planning.
4. Dry-run the deterministic transformation on synthetic production-shaped fixtures. In approved recovery boundary only, rehearse selected real-source transformations if retention requires them. Use stable source→target IDs, rule version, batch checkpoints, reject reason and idempotent resume. Repeated run must produce identical state.
5. Transform permissions/organizations → references/identity → venue config → source documents → accepted receipt lots or reviewed opening balances → history links → notes/lists → derived views. Every row is mapped, retained, rejected or excluded with a reason. Never fabricate missing producer/ownership/history.
6. Validate row disposition totals; per-table canonical hashes of unchanged fields (rows sorted by stable source key; fixed field order, explicit null token, normalized exact decimal/unit representation and UTC timestamps; exclude only approved generated fields); mapping uniqueness; zero orphan FKs; exact-unit balance conservation per owner/venue/lot/package; money totals per currency; all exceptional rows and stratified samples of every source type. For each table sample min(30, retained rows), plus100% rejects and high-risk permission/stock anomalies. Record sample seed and hashes in protected evidence.

S has no legacy backfill requirement: synthetic candidate plus explicitly created pilot intake records. Full production transformation is deferred until F. This reduces work without authorizing destruction of anything old.

## Candidate authorization and S deployment boundary

S uses a separately verified candidate deployment and Supabase project, with additive candidate tables and explicit capabilities. Reuse Auth identity exchange only where characterized; do not replace legacy scope/auth helpers or migrate their consumers. Candidate host exposes only invited bootstrap, candidate pages/APIs and required assets/Auth endpoints; legacy app and API entrypoints on that host fail closed. Old production remains on its existing host/project. Route filtering is defense in depth, not a database authorization boundary.

RLS cannot distinguish /pilot from a legacy Next route sharing the same authenticated role. Withhold direct authenticated writes to candidate stock tables; grant only narrow, actor/scope-validating command RPCs. SQL validates grants at execution and rejects caller-supplied actor/ownership spoofing. Server authorization and RLS protect reads/cost projections; a client-hidden column is not protection. Enumerate every SECURITY DEFINER and service-role capability; service_role bypasses RLS, so RLS is never claimed as its containment. Candidate credentials must not enter legacy data adapters. Bootstrap/admin capabilities are bounded and audited, not a general service-role stock endpoint. D/C choose concrete grants and function security after review; this is a contract specification, not applied SQL.

Acceptance includes direct RPC/table calls as authenticated/signed-out/foreign/revoked actors, replay and concurrent revocation at the transaction boundary, cost leakage tests and legacy endpoint calls that leave candidate state unchanged. Candidate backend lookup returns only approved catalog fields. No legacy unified search fallback is permitted. Missing boundary proof blocks real pilot admission.

S Gate 2 admits the separate candidate as a supervised evaluation production environment after its own backup/restore and deployment checks. It does not replace main or migrate old production. Full legacy migration/maintenance rules below remain F requirements. For S, record the applicable candidate pause/recovery window and compatible application rollback; first pilot write still forbids restoring an older snapshot over newer records.

## Full migration cutover and rollback

Choose maintenance downtime and one stock writer. Cross-database dual write is rejected. Optional shadow calculations compare approved read-only inputs; they do not post stock. Candidate routes must enforce a server-side supported-command allowlist so excluded legacy writers cannot be invoked directly. Full migration must adapt or disable every stock writer before activation. No old/new worker pair may consume the same Toast stream into two authorities.

Proposed window: staffed60 minutes, rehearsal must demonstrate execution within30 minutes and rollback decision by minute30, leaving30 minutes for recovery. These are acceptance budgets, not measured timings. If rehearsal exceeds them, re-plan the window and Gate 2 approval. Pause affected writes, drain jobs, capture final delta and checkpoint, validate, route new app/workers, smoke, then reopen. If Toast is in selected scope, keep ingress durable or prove provider replay bounds while deductions pause.

**Point of no return for simple restore: the first accepted post-cutover write.** Before it, restore/re-route to the verified legacy baseline. After it, do not restore a snapshot over new records. Roll back only to a previously tested app compatible with the new schema, or freeze mutations and repair forward while retaining inbox and assets. Reverse migration to legacy is unavailable unless a complete inverse mapping and replay of every new mutation/asset/checkpoint have passed rehearsal. A paired down SQL file is not that evidence. Stop rollback attempt at its rehearsed deadline and enter documented read-only support mode rather than improvise.

Confirm users and jobs again before cutover. If live users exist by then, owner/Rohan sends approved downtime notice, explains stock-entry fallback/export and support window, and records acknowledgement from the pilot operator. This plan sends no messages. S pilot users keep operational inventory outside the evaluation candidate; failure pauses evaluations without losing the restaurant's stock authority.

## Complete Gate 2 checklist

Every applicable item must have a named reviewer, exact SHA/schema, evidence path and PASS. NOT APPLICABLE requires an explicit selected-scope reason; no silent skip.

- Scope S/F and user-facing limitations match the running candidate; all selected requirements and surviving journeys verified. For S use candidate-data manifests and candidate recovery, marking legacy transformation/cutover items explicitly F-only. No legacy production promotion is authorized by S.
- Exact accounts/regions/project refs recorded; production data location policy verified; destination approved.
- O/D record pilot account/region designation, daily encrypted backup and object-byte coverage, retention duration/cost, abandonment/export and owner-approved deletion procedure; synthetic-only before this passes.
- Backup database/Auth/config and Storage bytes verified; fresh restore passed; row/hash/FK/sample and stock/currency reconciliation passed.
- Applied schema clean replay and upgrade path passed; forward/reverse compatibility limits documented; all unmapped/rejected rows adjudicated.
- Permission matrix, revoked access, service-role paths, public/private assets and malicious cross-business references passed.
- Actual persistence E2E, concurrency/idempotency, crash/retry/restart, export and blocked legacy writer tests passed without selected-scope skips.
- Required check green on integrated SHA; full relevant suite green with named exclusions; independent blocking findings closed by finder/objective evidence.
- Measured workload/performance/cost budgets passed; credentials authorized and scoped; safe logs and alert owner verified.
- Deployment health reports exact SHA and successful platform status; smoke checks actual routes/DB, not health alone. Candidate staging schema parity recorded.
- Supported rollout and tested compatible rollback artifact present; maintenance time rehearsal, rollback deadline, write freeze/drain and support/export fallback verified.
- Full Toast scope only: real authorized venue access, mapping coverage, duplicate/order correction/manual overlap/shadow parity and replay proven. Source fixture success alone fails this gate. S marks all Toast unavailable.
- Full public scope only: approved source/geodata/image rights, signed-out search/pages/map, withdrawal and privacy canary pass. S makes no public discovery promise.
- Owner/Rohan coverage and any user communication completed; owner explicitly approves production admission/cutover. No automatic promotion from green CI.
