# Operational caller inventory evidence

Run from `/Users/zero/projects/_archive/terroir-prototype` on 2026-09-26. These are read-only commands.

```sh
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
rg -n --hidden --glob '!node_modules/**' --glob '!.git/**' 'scan_idempotency|claim_scan_idempotency|complete_scan_idempotency|abandon_scan_idempotency' .
rg -n 'withIdempotency|isValidIdempotencyKey' src --glob '!**/*.test.*'
rg -n '\.from\(["'"']scan_idempotency["'"']\)' src scripts --glob '!**/*.test.*'
rg -n 'processInvoiceScanOnce|extractFromOcr|readInvoicePages|enqueue_invoice_extract_job' src supabase/migrations --glob '!**/*.test.*'
rg -n '\.rpc\(' src/app/api/scan src/app/api/scans src/app/api/inventory src/domains/scanning src/lib/jobs --glob '!**/*.test.*'
rg -n '\.rpc\(' src/domains/import src/app/api/import --glob '!**/*.test.*'
rg -n '\.rpc\(' src/domains/cellar src/app/api/reconcile src/app/api/reconcile-queue src/app/api/wines/merge --glob '!**/*.test.*'
rg -n '\.from\(' src/app/api/scan src/app/api/scans src/app/api/inventory src/domains/scanning src/domains/import src/app/api/import src/domains/cellar src/app/api/reconcile src/app/api/reconcile-queue src/app/api/wines/merge src/lib/jobs --glob '!**/*.test.*'
```

Observed repository identity:

```text
/Users/zero/projects/_archive/terroir-prototype
feat/production-readiness-20260923
fe9ba7c103770f7bf6a932db9175888fe307e0b1
```

Observed cache production call sites:

```text
src/app/api/scan/route.ts:154
src/app/api/scan/route.ts:288
src/app/api/inventory/save-scan/route.ts:100
src/app/api/inventory/save-bottle-scan/route.ts:50
```

Observed direct production table accessor:

```text
src/lib/api/idempotency.ts:119
```

Observed current generated RPC surface:

```text
src/types/database.ts:2894 cleanup_scan_idempotency only
```

No current source occurrence of `claim_scan_idempotency`, `complete_scan_idempotency`, or `abandon_scan_idempotency` exists outside the accepted plan.
