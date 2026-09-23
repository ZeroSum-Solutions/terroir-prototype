# Database restore drill

This is the canonical execution guide for `scripts/restore-drill.mjs`, linked
by the backup and release-evidence runbook at
`docs/runbooks/database-backup-restore.md`. It proves that a specific DB
Backup artifact actually restores: it verifies the artifact, decrypts it
offline, restores it into a throwaway PostgreSQL container, and diffs exact
per-table row counts (plus migration version and content checksums) against
the evidence captured at dump time. Nothing here ever touches production or
the backup role's connection — the restore target is always a Docker
container the script starts and destroys with networking disabled.

This is a data-restore drill, not a complete permission-recovery drill. The
script uses `--no-owner --no-privileges`; it does not restore or compare object
ownership and grants. Its evidence collector excludes extension-owned tables,
including `cron.job`. Those boundaries apply even when the report says `PASS`.

## What the workflow now asserts (before running a drill)

The [backup workflow](../.github/workflows/db-backup.yml) calls `scripts/backup/assert-dump-coverage.mjs`
on every backup run, before the dump is encrypted and uploaded. That script now
checks two things, both against the same exported PostgreSQL snapshot the dump
itself was taken from:

- **Schema coverage** (pre-existing): every non-system, non-extension-owned
  schema present in the source also appears in the archive.
- **Table coverage** (new in this slice): every non-system, non-extension-owned
  base table present in the source has a `TABLE DATA` entry in the archive —
  not just an aggregate "more than zero table-data entries" count. A single
  table silently dropped from the dump (a privilege change, a `pg_dump`
  filtering bug, a bad flag) now fails the backup run by name instead of
  hiding inside an otherwise-healthy-looking artifact.

The exact per-table row counts themselves (`SELECT count(*)`, never
`pg_stat`'s estimated `n_live_tup`) are captured by
`scripts/backup/collect-database-evidence.mjs` into `source-evidence.json`,
taken from the same snapshot as the dump and shipped alongside it inside the
same encrypted `.tar.age` payload. `scripts/restore-drill.mjs` is what proves
those counts actually come back out on the other side of a restore.

## Prerequisites

- `docker` running locally (`docker info` succeeds).
- `age`, `gh`, and Node.js on `PATH`.
- ZS Vault access to `terroir_backup_age_identity` (the identity that
  decrypts `BACKUP_AGE_RECIPIENT`-encrypted artifacts).
- A downloaded DB Backup artifact directory (see below).

The scratch database is a disposable
`public.ecr.aws/supabase/postgres:17.6.1.143` container (Supabase's own
Postgres 17 image, not vanilla `postgres:17`) started fresh by the script and
torn down when it exits. The vanilla `postgres` image does **not** work here:
the dump's schema needs `pg_cron`, `pgsodium`/`vault`, and `pg_graphql`
extension control files that only Supabase's image ships. The repository does
have `supabase/config.toml`; its active development stack and ports are documented
in [the local-stack runbook](runbooks/local-stack.md). The restore script
does not use, reset, or stop that stack. It owns a separate container and needs
neither an available localhost database port nor a running Supabase CLI stack.

The scratch container has Docker networking set to `none`, no published ports
or host bind mounts, and `cron.launch_active_jobs` disabled from startup. The
script checks those settings before and after restoring. Queries run through
`docker exec` in that exact container, ignoring ambient database service-file
and backup-snapshot settings. Restored jobs cannot make external network calls;
disabled cron jobs cannot alter the data being compared. This is not a sandbox
for an untrusted backup: accept artifacts only after verifying their provenance.

The startup command preserves the pinned image's `postgres -D /etc/postgresql`
entry point and adds the cron setting. An image override must be checked for
that command/configuration contract as well as PostgreSQL-major and extension
compatibility before using it for a real recovery.

## Running the drill

Find the latest successful run and download its artifact:

```bash
run_id="$(
  gh run list --repo ZeroSum-Solutions/terroir-prototype --workflow "DB Backup" \
    --json databaseId,conclusion --jq \
    '[.[] | select(.conclusion == "success")][0].databaseId'
)"
drill_work="$(mktemp -d)"
chmod 700 "$drill_work"
gh run download "$run_id" --repo ZeroSum-Solutions/terroir-prototype --dir "$drill_work/artifact"
```

Fetch the offline age identity to a private file (never inline it in an
env var value or command argument):

```bash
umask 077
zsvault get terroir_backup_age_identity > "$drill_work/identity.txt"
chmod 600 "$drill_work/identity.txt"
```

Run the drill:

```bash
RESTORE_ARTIFACT_DIR="$drill_work/artifact" \
RESTORE_AGE_IDENTITY_FILE="$drill_work/identity.txt" \
RESTORE_REPORT_FILE="$drill_work/report" \
  node scripts/restore-drill.mjs
```

The `report` file contains JSON. Preserve the redacted report and authenticated artifact metadata in the release
evidence, then remove the private identity and downloaded artifact from that exact
temporary directory. Do not remove an active development database or run
`supabase stop --no-backup` as drill cleanup. The script itself cleans up its own
decrypted work directory and scratch container automatically
(`RESTORE_KEEP_WORKDIR=1` skips that, for debugging only).

The script exits non-zero and prints every failure if any table is missing,
any row count differs, the migration version differs, or any of the ten
largest tables' content checksums differ. On success it prints a
`schema.table | source | restored | match` table and writes a JSON report
(`format_version`, `ok`, `failures`, `tables`, `sequences`,
`content_checksums`). `isolation` records the verified network, port, bind-mount,
and cron boundaries; `permissions_restored` and
`extension_owned_tables_compared` are `false`. The `artifact` object records
the manifest and encrypted-artifact SHA-256 digests; authenticate those against
the GitHub run/artifact and integrity-ledger records before accepting provenance.
A successful backup
workflow proves artifact creation, not restoration. A passing synthetic drill
proves the tested mechanics, not recovery of the latest hosted artifact.

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `RESTORE_ARTIFACT_DIR` | yes | Directory containing one `*.tar.age`, `*.manifest.json`, and `*.sha256` (searched recursively, so a raw `gh run download` directory works as-is). |
| `RESTORE_AGE_IDENTITY_FILE` | yes | Path to the offline age identity file. |
| `RESTORE_DOCKER_IMAGE` | no | Overrides the scratch Postgres image. Must be a Supabase-flavored image matching the dump's PostgreSQL major version. |
| `RESTORE_REPORT_FILE` | no | Where to write the JSON comparison report. Defaults to a file inside the (deleted-on-exit) work directory. |
| `RESTORE_KEEP_WORKDIR` | no | Set to `1` to keep the decrypted material and scratch container after a run, for debugging. |

## Local isolation drill — 2026-09-23

The canonical script passed an encrypted synthetic-artifact rehearsal on
PostgreSQL 17.6 with seven non-extension tables, exact row counts, sequences,
migration version, and content checksums matching. The source fixture contained
a scheduled cron write. The drill observed the cron setting disabled before
and after restore; it did not compare the restored job or run an armed scheduler
negative control. An invalid ambient backup snapshot and a nonexistent database service file did
not affect scratch collection. The process exited `0`.

This was a temporary, locally generated encryption identity and synthetic data,
not a download or decryption of a current hosted backup. The seven-table comparison
does not prove the extension-owned cron job contents or owner/grant recovery.
Release acceptance still needs evidence for its selected real artifact and
the permissions needed by the application.

## Drill record: 2026-08-22

This historical record was not reverified by the September 23 rehearsal.
Retain and inspect its original report and authenticated artifact metadata
before relying on this older drill for a release decision; this prose alone
is not proof.

Executed against the latest green scheduled run at the time
(`32557316027`, `2026-08-22T06:34:18Z`, commit `beeb2d4`). Checksums in the
`.sha256` file verified, the manifest matched the encrypted artifact,
decryption with `terroir_backup_age_identity` succeeded, and the dump
restored cleanly into a disposable `public.ecr.aws/supabase/postgres:17.6.1.143`
container on loopback-only port. The comparison result was **PASS** — 60
tables checked, all exact row counts matched, the migration version
(`20260820042618`) matched, and all ten largest-table content checksums
matched.

One finding: `terroir_restore_drill_age_identity` (the second identity
credential provisioned for this slice) does **not** decrypt artifacts
produced by the current `BACKUP_AGE_RECIPIENT` — only
`terroir_backup_age_identity` does. This drill used
`terroir_backup_age_identity`, matching `docs/runbooks/database-backup-restore.md`.
If `terroir_restore_drill_age_identity` is meant to become the drill-specific
identity going forward, the workflow's `BACKUP_AGE_RECIPIENT` secret needs to
be rotated to its matching recipient first — until then it is not a usable
decryption key for any existing backup artifact.

### Per-table counts, source vs. restored

| Table | Source | Restored | Match |
| --- | ---: | ---: | :---: |
| auth.audit_log_entries | 0 | 0 | OK |
| auth.custom_oauth_providers | 0 | 0 | OK |
| auth.flow_state | 20 | 20 | OK |
| auth.identities | 3 | 3 | OK |
| auth.instances | 0 | 0 | OK |
| auth.mfa_amr_claims | 195 | 195 | OK |
| auth.mfa_challenges | 0 | 0 | OK |
| auth.mfa_factors | 0 | 0 | OK |
| auth.oauth_authorizations | 0 | 0 | OK |
| auth.oauth_client_states | 0 | 0 | OK |
| auth.oauth_clients | 0 | 0 | OK |
| auth.oauth_consents | 0 | 0 | OK |
| auth.one_time_tokens | 0 | 0 | OK |
| auth.refresh_tokens | 270 | 270 | OK |
| auth.saml_providers | 0 | 0 | OK |
| auth.saml_relay_states | 0 | 0 | OK |
| auth.schema_migrations | 77 | 77 | OK |
| auth.sessions | 195 | 195 | OK |
| auth.sso_domains | 0 | 0 | OK |
| auth.sso_providers | 0 | 0 | OK |
| auth.users | 3 | 3 | OK |
| auth.webauthn_challenges | 0 | 0 | OK |
| auth.webauthn_credentials | 0 | 0 | OK |
| public.availability_events | 10 | 10 | OK |
| public.background_jobs | 0 | 0 | OK |
| public.bins | 40 | 40 | OK |
| public.bottle_closeouts | 0 | 0 | OK |
| public.brand_kits | 0 | 0 | OK |
| public.cellar_config | 1 | 1 | OK |
| public.cellar_health | 41 | 41 | OK |
| public.inventory_items | 56 | 56 | OK |
| public.invitations | 0 | 0 | OK |
| public.invoice_scans | 6 | 6 | OK |
| public.lwin_catalog | 211498 | 211498 | OK |
| public.memberships | 4 | 4 | OK |
| public.open_bottles | 12 | 12 | OK |
| public.pour_events | 75 | 75 | OK |
| public.pricing_recommendations | 41 | 41 | OK |
| public.reason_codes | 28 | 28 | OK |
| public.reconcile_actions | 0 | 0 | OK |
| public.reconcile_batches | 0 | 0 | OK |
| public.restaurants | 4 | 4 | OK |
| public.scan_idempotency | 2 | 2 | OK |
| public.stock_adjustments | 0 | 0 | OK |
| public.wine_lineages | 148 | 148 | OK |
| public.wine_list_items | 56 | 56 | OK |
| public.wine_list_sections | 27 | 27 | OK |
| public.wine_lists | 6 | 6 | OK |
| public.wines | 60 | 60 | OK |
| realtime.schema_migrations | 69 | 69 | OK |
| realtime.subscription | 0 | 0 | OK |
| storage.buckets | 1 | 1 | OK |
| storage.buckets_analytics | 0 | 0 | OK |
| storage.buckets_vectors | 0 | 0 | OK |
| storage.migrations | 61 | 61 | OK |
| storage.objects | 1 | 1 | OK |
| storage.s3_multipart_uploads | 0 | 0 | OK |
| storage.s3_multipart_uploads_parts | 0 | 0 | OK |
| storage.vector_indexes | 0 | 0 | OK |
| supabase_migrations.schema_migrations | 40 | 40 | OK |

Sequences (`last_value`/`is_called`) and the ten largest non-empty tables'
SHA-256 content checksums also matched exactly; see the full JSON report from
this run for the checksum values (not reproduced here since they are not
useful without the underlying row bytes).

Note the 26 `public` schema tables here (plus 34 Supabase-managed
`auth`/`realtime`/`storage`/`supabase_migrations` tables, 60 total) — not the
16 originally assumed for this slice. `assert-dump-coverage.mjs`'s table
coverage check is schema-driven and table-count-agnostic by design, so it
does not need updating as the schema grows.
