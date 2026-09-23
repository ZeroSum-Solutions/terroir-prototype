# Database backup and restore runbook

This runbook is the operational gate for TER-002. The GitHub workflow creates
an encrypted PostgreSQL custom-format dump plus source evidence. A backup is
healthy only after the encrypted artifact, manifest, and checksum file upload
successfully. A release that includes a migration remains blocked unless the
latest backup is healthy and the selected real artifact has a current passing
disposable restore drill with retained release evidence.

The workflow never receives the decryption identity. Production connection
credentials and the offline age identity live only in ZS Vault. Never put a
database URL, password, or age identity in command arguments or logs.
The dump includes every non-system, non-extension-owned schema discovered at
runtime. The job fails if the archive schema inventory omits any such source
schema, or if any individual application table present at dump time has no
corresponding `TABLE DATA` entry in the archive, so a later migration cannot
silently fall outside a static allowlist and a single missing table cannot
hide inside an otherwise-healthy backup. The archive, source table counts,
migration version, and ten content checksums are all read from one exported
PostgreSQL snapshot, so concurrent production writes cannot create
self-inconsistent evidence. See [the database restore drill guide](../RESTORE-DRILL.md)
for the disposable Docker-based procedure and its exact proof limits.

## One-time provisioning

These steps change production roles and credentials and require explicit owner
approval. They are not routine restore-drill prerequisites. Reuse existing
credentials through the approved vault; missing access is not authorization to
reset a password or replace an encryption identity.

The production project is `qcfmwphlaekfkqwkfyth`. An approved `postgres`
password reset is performed in the Supabase dashboard.
From the Connect panel, select the IPv4-compatible **session pooler** on port
5432 for database `postgres`—never the transaction pooler on port 6543—and
save that admin URL to ZS Vault as `terroir_supabase_admin_db_url`. GitHub-hosted
runners cannot safely assume access to the direct IPv6 endpoint. This reset
does not change Supabase API keys, but it must be recorded as a credential
rotation.

Create a dedicated read-only role. The helper sends the role password to
`psql` over stdin; it never places the password in process arguments.
The role has no write, create, replication, or ownership capability. It does
have `BYPASSRLS` because PostgreSQL otherwise refuses a complete `pg_dump` of
RLS-protected tenant tables; treat this credential as full read access.

```bash
umask 077
export PGSERVICEFILE="$TMPDIR/terroir-admin.pg_service.conf"
export PGSERVICE_NAME=terroir_admin
export PG_DATABASE_URL="$(zsvault get terroir_supabase_admin_db_url)"
node scripts/backup/write-pg-service.mjs
unset PG_DATABASE_URL

IFS= read -r BACKUP_ROLE_PASSWORD <<EOF
$(openssl rand -base64 48)
EOF
export BACKUP_ROLE_PASSWORD
printf '%s' "$BACKUP_ROLE_PASSWORD" |
  zsvault add terroir_backup_db_password \
    --type plain_secret \
    --label "Terroir backup-only database role" \
    --env-name TERROIR_BACKUP_DB_PASSWORD \
    --yes \
    --value-stdin
PGSERVICE=terroir_admin node scripts/backup/provision-backup-role.mjs
unset BACKUP_ROLE_PASSWORD
rm -f "$PGSERVICEFILE"
unset PGSERVICEFILE PGSERVICE_NAME
```

Derive the backup role's session-pooler URL, save it to ZS Vault, and then set
GitHub from stdin. The helper rejects direct/transaction-pooler endpoints,
wrong project usernames, and short passwords. No URL is printed to the
terminal.

```bash
export SUPABASE_SESSION_POOLER_URL="$(
  zsvault get terroir_supabase_admin_db_url
)"
IFS= read -r BACKUP_ROLE_PASSWORD <<EOF
$(zsvault get terroir_backup_db_password)
EOF
export BACKUP_ROLE_PASSWORD
node scripts/backup/create-backup-database-url.mjs |
  zsvault add terroir_supabase_backup_db_url \
    --type plain_secret \
    --label "Terroir backup role session-pooler URL" \
    --env-name TERROIR_BACKUP_DB_URL \
    --yes \
    --value-stdin
unset SUPABASE_SESSION_POOLER_URL BACKUP_ROLE_PASSWORD

zsvault get terroir_supabase_backup_db_url |
  gh secret set SUPABASE_DB_URL --repo ZeroSum-Solutions/terroir-prototype
```

Generate a distinct offline age identity, save the private identity to ZS
Vault, and send only its public recipient to GitHub.

```bash
umask 077
identity_file="$TMPDIR/terroir-backup-age-identity.txt"
age-keygen -o "$identity_file"
age-keygen -y "$identity_file" > "$TMPDIR/terroir-backup-age-recipient.txt"
zsvault add terroir_backup_age_identity \
  --type plain_secret \
  --label "Terroir database backup age identity" \
  --env-name TERROIR_BACKUP_AGE_IDENTITY \
  --yes \
  --value-stdin < "$identity_file"
gh secret set BACKUP_AGE_RECIPIENT \
  --repo ZeroSum-Solutions/terroir-prototype \
  < "$TMPDIR/terroir-backup-age-recipient.txt"
rm -f "$identity_file" "$TMPDIR/terroir-backup-age-recipient.txt"
```

Confirm the repository has both secret names. GitHub never returns values.

```bash
gh secret list --repo ZeroSum-Solutions/terroir-prototype |
  grep -E '^(SUPABASE_DB_URL|BACKUP_AGE_RECIPIENT)[[:space:]]'
```

## Run and inspect a backup

Dispatch a manual run and watch the exact run to completion.

```bash
gh workflow run "DB Backup" --repo ZeroSum-Solutions/terroir-prototype
run_id="$(
  gh run list \
    --repo ZeroSum-Solutions/terroir-prototype \
    --workflow "DB Backup" \
    --event workflow_dispatch \
    --limit 1 \
    --json databaseId \
    --jq '.[0].databaseId'
)"
gh run watch "$run_id" --repo ZeroSum-Solutions/terroir-prototype --exit-status
```

The workflow must report:

- a non-privileged role with `pg_read_all_data`;
- a non-empty custom dump containing table-data entries;
- successful age encryption;
- removal of every plaintext file before artifact upload; and
- one uploaded artifact retained for 90 days; and
- a matching SHA-256 anchor appended to the persistent GitHub issue named
  `Database backup integrity ledger`.

Do not download or expose the artifact during routine health checks. Record the
run URL. TER-002 requires three consecutive successful runs, including at
least one scheduled run.

## Restore drill status and release evidence

The canonical execution procedure is [the database restore drill guide](../RESTORE-DRILL.md).
Do not reproduce that procedure here and do not use the former local-Supabase
walkthrough: the canonical drill owns a separate network-disabled container and
must not start, reset, or stop the active development stack.

Current evidence has two different scopes:

- The 2026-09-23 encrypted synthetic-artifact rehearsal passed the canonical
  restore mechanics and isolation checks. It did not download or decrypt a
  hosted backup, compare extension-owned tables, or restore/test original
  ownership and grants.
- The 2026-08-22 section in the canonical guide records an older hosted-artifact
  restore claim. That historical prose was not reverified by the September 23
  rehearsal; retain and inspect its original report and authenticated artifact
  metadata before using it in a release decision.

A migration release remains blocked unless the latest production backup is
healthy and the selected real artifact has a passing current drill with retained
release evidence. The synthetic rehearsal is not a substitute for that
hosted-artifact drill.

Keep only non-sensitive evidence: the redacted restore report, manifest and
checksum metadata, the authenticated GitHub run/artifact metadata that binds the
artifact to its run and digest, and the integrity-ledger record. Follow the
canonical guide for collection and cleanup. A passing report establishes only
the data-restore coverage named there; it does not prove recovery of original
object ownership or grants. Validate the permissions the application needs
separately before release.

## Failure and rotation handling

- Missing configuration, a privileged or effectively writable backup role,
  incomplete schema coverage, an empty dump, encryption failure, upload
  failure, a missing integrity-ledger anchor, or restore mismatch is a hard
  failure.
- Never delete prior backup artifacts while repairing a run.
- If the backup role credential is exposed, rotate only that role password,
  replace `SUPABASE_DB_URL`, and run a new backup. The role can read across RLS
  boundaries even though it cannot mutate data.
- If the age identity is exposed, generate a new identity and recipient. Keep
  the old identity offline until every retained artifact encrypted to it has
  expired or been intentionally re-encrypted.
- A failed scheduled run blocks schema promotion until a new successful backup
  and, when required by the release gate, a restore drill are complete.
