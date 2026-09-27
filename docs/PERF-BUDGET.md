# Scan pipeline performance budget

**Status: draft — thresholds pending owner decision Q-perfbudget (device
tier, network condition, and percentile all still open). Nothing in this
document is a committed SLO.** Remote M1-1 scan timing is retired. Client
User Timing still measures, clears, and returns individual durations locally,
but the shipped app does not aggregate, display, persist, or export them. No
server stage timing or real device/network distribution is currently captured.

## Why this doc exists

The owner's live-walkthrough complaint was "scanning feels slow," with no
measured distribution showing where the time goes. This document preserves a
provisional decomposition of a possible budget; it does **no optimization
work** and does not claim a measured p50/p95. A future measurement channel
requires its own reviewed data contract and regression proof before activation.

## Stage taxonomy

| Stage | Shipped measurement state | Intended interval |
| --- | --- | --- |
| `capture` | Local User Timing; duration is returned then discarded | Tap-to-take-photo/upload-file through a file being selected. Mostly user think-time (framing a photo), not app latency — included for completeness, not as an optimization target. |
| `prep` | Local User Timing; duration is returned then discarded | Building the multipart upload request. Near-zero today because no client-side image compression or resize exists. |
| `upload` | Local User Timing; duration is returned then discarded | The full `fetch()` round trip: network transfer **plus** all server-side processing, since the browser cannot split one request into upload and processing. |
| `ocr.page` | Not measured; compatibility wrapper only | One Azure Document Intelligence call per invoice page. A multi-page invoice fans these out in parallel (`Promise.all`), so wall-clock cost is roughly the slowest page, not the sum. |
| `ocr.merge` | Not measured; compatibility wrapper only | Merging per-page OCR results into one document before extraction. |
| `extract` | Not measured; compatibility wrapper only | Claude structured extraction from the merged OCR text. |
| `extract.retry` | Not measured; compatibility wrapper only | The G1-12 higher-effort retry, only when the first attempt fails deterministic arithmetic validation. |
| `persist` | Not measured; compatibility wrapper only | Writing the final parsed invoice back to the `invoice_scans` row. |
| `render` | Local User Timing; duration is returned then discarded | From the scan response being received to the browser painting the results view (double-`requestAnimationFrame`, not just scheduling the update). |

## Draft stage-level targets

Illustrative only — a proposed split of the plan's **<10s single-page
invoice** ambition across the stages above, not a measured baseline. Treat
every number as a placeholder until Q-perfbudget is answered and this table
is replaced with real percentile data.

The row below labeled "`upload` (network share)" is a target for the
network-transfer portion only — it is **not** the same thing as the raw
`upload` client mark, which (as noted in the taxonomy above) measures
network **plus** every server-side stage combined, since a browser can't
see inside one HTTP round trip. The `ocr.*`/`extract`/`persist` rows below
are separate, conceptual budget slices for what happens once the request
lands on the server. They are not independently measured today. Summing them
describes the proposed target decomposition, not an observed trace.

| Stage | Draft target (single page) | Notes |
| --- | --- | --- |
| `upload` (network share) | ~1.0s | Rough allowance for image upload over a typical mobile connection; grows with file size and with additional pages. |
| `ocr.page` | ~2.5s | Per Azure Document Intelligence call; multi-page invoices should stay close to this via the existing parallel fan-out, not multiply by page count. |
| `ocr.merge` | <0.05s | Synchronous, should never be a meaningful contributor. |
| `extract` | ~3.5s | Claude structured extraction at the `INVOICE_EXTRACTION` profile (medium effort). |
| `extract.retry` | ~5s (only on mismatch) | Higher-effort retry; only a subset of scans pay this, but those scans' total budget should be judged against this larger number, not the no-retry path. |
| `persist` | <0.2s | Single-row Supabase update. |
| `render` | <0.3s | State update through paint; should be dominated by React/DOM work, not data size, at current result-set sizes. |
| **Total (no retry)** | **~7.5s** | Leaves headroom under the <10s ambition for real-world network variance. |
| **Total (with retry)** | **~12.5s** | Exceeds the <10s ambition — whether a retried scan should have its own, looser budget (vs. optimizing the retry path itself) is exactly the kind of call Q-perfbudget needs to make. |

None of these numbers are backed by measured device data. They are a starting
proposal sized against the model profiles and pipeline shape, to be replaced
only after an approved measurement path produces real distributions.

## Open question: Q-perfbudget

Before any row above becomes a real threshold, the owner needs to decide:

- **Device tier** — what hardware defines "acceptable"? A recent iPhone on
  the restaurant's own Wi-Fi is a very different budget than a three-year-old
  Android on a spotty cellular connection at the loading dock.
- **Network condition** — Wi-Fi, LTE, or the worse of the two, since a
  restaurant back-of-house is exactly where connectivity is often bad.
- **Percentile** — p50 ("typical"), p95 ("bad but not rare"), or p99. A
  single-number "average" budget hides the tail that actually generates
  complaints.

## Reading the data

There is no shipped performance view or remote scan-timing dataset to read.
Client helpers measure one interval, clear its User Timing marks and measure,
and return a duration that current callers discard. Server stage wrappers do
not time or export their callbacks. Consequently, the app cannot currently
produce percentiles, correlate one scan end-to-end, or separate network time
from server processing. Those are future measurement requirements, not present
capabilities.

## Illustrative budget decomposition

Synthetic arithmetic for discussion only — not a captured trace, baseline, or
distribution. The shipped app cannot currently produce this breakdown:

| Stage | Duration |
| --- | --- |
| `capture` | 1.8s (user already had the photo framed) |
| `prep` | 10ms |
| `upload` (client-observed round trip) | 10.3s |
| — `ocr.page` (server) | 1.9s |
| — `ocr.merge` (server) | 4ms |
| — `extract` (server, attempt 1) | 2.8s |
| — `extract.retry` (server, attempt 2 — arithmetic mismatch) | 4.6s |
| — `persist` (server) | 0.15s |
| — hypothetical network/queueing remainder | ~0.85s |
| `render` | 0.1s |
| **Total (capture through render)** | **~12.2s** |

The `upload` row and its indented rows are a proposed accounting model for the
same interval, not two measurements available in the product. If a future
approved measurement path supplied these values, the decomposition could show
whether retry or another stage dominates. Until then, it must not be presented
as operational evidence.
