import type { Metadata } from "next";
import Link from "next/link";
import { getAuthContext } from "@/lib/auth-context";
import { ArrowLeft, ChevronLeft, ChevronRight, ScanLine } from "lucide-react";
import { RouteDataEmpty } from "@/components/route-data-state";
import { expireStalledScans } from "@/domains/scanning/stalled-scans";
import { describeScanStatusReason } from "@/lib/scanner/scan-status-reason";
import { ExportCsvButton } from "./export-csv-button";
import { ScanStatusSelect } from "./scan-status-select";
import {
  buildQuery,
  parseStatus,
  statusBadge,
  statusLabel,
  type StatusFilter,
} from "./scan-list-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Scan History" };

const PAGE_SIZE = 20;

type ScanRow = {
  id: string;
  distributor_name: string;
  invoice_number: string | null;
  invoice_date: string | null;
  status: string;
  item_count: number;
  accuracy_score: number | null;
  status_reason: string | null;
  created_at: string;
};

type SearchParams = Promise<{ page?: string; status?: string }>;

export default async function ScansPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const status = parseStatus(sp.status);

  const auth = await getAuthContext();
  if (!auth) return null;
  const { supabase, restaurantId } = auth;

  // A row left in "processing" by a request that never finished would spin
  // here forever; settle it as failed/stalled before listing (best effort).
  await expireStalledScans({ supabase, restaurantId });

  let query = supabase
    .from("invoice_scans")
    .select(
      "id, distributor_name, invoice_number, invoice_date, status, item_count, accuracy_score, status_reason, created_at",
      { count: "exact" },
    )
    .eq("restaurant_id", restaurantId);

  if (status !== "all") {
    query = query.eq("status", status);
  }

  const statusCountQuery = (s: Exclude<StatusFilter, "all">) =>
    supabase
      .from("invoice_scans")
      .select("id", { count: "exact", head: true })
      .eq("restaurant_id", restaurantId)
      .eq("status", s);

  const [scansRes, completeRes, processingRes, reviewRes, failedRes] = await Promise.all([
    query.order("created_at", { ascending: false }).range(offset, offset + PAGE_SIZE - 1),
    statusCountQuery("complete"),
    statusCountQuery("processing"),
    statusCountQuery("review"),
    statusCountQuery("failed"),
  ]);
  const { data: scans, error, count } = scansRes;

  const statusCounts: Record<Exclude<StatusFilter, "all">, number> = {
    complete: completeRes.count ?? 0,
    processing: processingRes.count ?? 0,
    review: reviewRes.count ?? 0,
    failed: failedRes.count ?? 0,
  };

  if (error) {
    console.error("Failed to load scan history:", error);
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <p className="text-body-sm text-grey">Failed to load scan history.</p>
      </div>
    );
  }

  const total = count ?? scans.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rows: ScanRow[] = scans;
  const hasMore = page < totalPages;

  const statusFilter = (
    <ScanStatusSelect status={status} counts={statusCounts} />
  );

  // The masthead (DESIGN.md — Components, Masthead): the copper glow rather
  // than a photograph, the range and the section in the eyebrow, the room's
  // name in the serif. The old count pill is that eyebrow now — one control
  // fewer on a 390px row.
  const headerBlock = (
    <header className="dawn-gradient relative -mx-md -mt-lg mb-lg overflow-hidden px-md pb-lg pt-md md:-mx-lg md:-mt-xl md:mb-xl md:px-lg md:pb-xl md:pt-lg">
      <Link
        href="/scan"
        className="mb-md inline-flex min-h-11 items-center gap-xs text-caption font-medium uppercase tracking-[0.18em] text-grey hover:text-accent focus-ring"
      >
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.9} />
        Back to scanner
      </Link>
      <div className="flex items-end justify-between gap-md">
        <div className="min-w-0">
          <p className="text-caption font-medium uppercase tracking-[0.18em] text-accent">
            Scan · History
            {rows.length > 0 ? (
              <>
                {" · "}
                <span className="tabular">
                  {offset + 1}–{offset + rows.length} of {total}
                </span>
              </>
            ) : null}
          </p>
          <h1 className="mt-xs font-serif text-heading font-normal leading-[1.0] tracking-[-0.02em] text-ink">
            Scan history
          </h1>
        </div>
        <ExportCsvButton rows={rows} />
      </div>
      {statusFilter}
    </header>
  );

  if (rows.length === 0 && page === 1) {
    const emptyCopy =
      status === "processing"
        ? {
            title: "No scans in progress",
            body: "Nothing is being extracted right now. Photograph an invoice to start a new scan.",
          }
        : status === "complete"
          ? {
              title: "No completed scans yet",
              body: "Scans show up here once OCR finishes successfully.",
            }
          : status === "failed"
            ? {
                title: "No failed scans",
                body: "Nice — every scan has extracted cleanly.",
              }
            : status === "review"
              ? {
                  title: "Nothing needs a second look",
                  body: "Nice — no scan has numbers that don't add up right now.",
                }
              : {
                  title: "No scans yet",
                  body: "Photograph an invoice to start building your inventory.",
                };

    return (
      <section>
        {headerBlock}
        <RouteDataEmpty
          icon={<ScanLine className="h-6 w-6" strokeWidth={1.5} />}
          title={emptyCopy.title}
          description={emptyCopy.body}
          action={
            <Link
              href="/scan"
              className="inline-flex h-12 items-center gap-sm rounded-pill bg-primary px-md text-control font-semibold text-seal-ink transition-colors hover:bg-primary-hover focus-ring"
            >
              Scan an invoice
            </Link>
          }
        />
      </section>
    );
  }

  return (
    <section>
      {headerBlock}

      {/* One index list at every width (DESIGN.md — Index Row): supplier in
          the serif, date and invoice number as the eyebrow, the wine count
          right-aligned, the status as a seal. The desktop table this replaces
          carried the same six fields in six columns and a second, unrelated
          card layout below it. */}
      <div className="overflow-hidden rounded-card card-surface">
        {rows.map((s, i) => (
          <Link
            key={s.id}
            href={`/scan/${s.id}`}
            className={`flex min-h-11 items-start gap-md px-md py-sm transition-colors hover:bg-surface-raised focus-ring${
              i > 0 ? " border-t border-rule" : ""
            }`}
          >
            <span className="min-w-0 flex-1">
              <span className="tabular block text-caption font-medium uppercase tracking-[0.18em] text-grey">
                {s.invoice_date ?? s.created_at.slice(0, 10)}
                {s.invoice_number ? ` · #${s.invoice_number}` : ""}
              </span>
              <span className="mt-2xs block truncate font-serif text-body-lg text-ink">
                {s.distributor_name}
              </span>
              {/* D6 rule 1: nothing vanishes on its own, so a row that found
                  nothing or failed has to say WHY here — a 0-item "complete"
                  and a 0-item "failed" were otherwise indistinguishable. */}
              {describeScanStatusReason(s.status_reason) && (
                <span className="mt-2xs block text-ledger text-risk-ink">
                  {describeScanStatusReason(s.status_reason)}
                </span>
              )}
            </span>
            <span className="flex shrink-0 flex-col items-end gap-xs">
              <span
                className={`inline-block rounded-pill px-sm py-2xs text-caption font-medium uppercase tracking-[0.14em] ${statusBadge(
                  s.status,
                )}`}
              >
                {statusLabel(s.status)}
              </span>
              <span className="tabular text-body-lg text-ink">{s.item_count}</span>
              <span className="tabular text-ledger text-grey">
                {s.accuracy_score != null
                  ? `${Math.round(s.accuracy_score * 100)}%`
                  : "—"}
              </span>
            </span>
          </Link>
        ))}
      </div>

      {/* Pagination */}
      <nav
        aria-label="Scan history pagination"
        className="mt-lg flex items-center justify-center gap-sm"
      >
        {page > 1 ? (
          <Link
            href={`/scans${buildQuery({ page: page - 1, status })}`}
            className="inline-flex min-h-11 items-center gap-xs rounded-pill border border-rule-strong bg-transparent px-md text-control font-medium text-ink transition-colors hover:border-accent hover:text-accent focus-ring"
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={1.9} />
            Previous
          </Link>
        ) : (
          <span className="inline-flex min-h-11 items-center gap-xs rounded-pill border border-rule bg-transparent px-md text-control font-medium text-grey opacity-50">
            <ChevronLeft className="h-4 w-4" strokeWidth={1.9} />
            Previous
          </span>
        )}
        <span className="tabular px-sm text-caption font-medium uppercase tracking-[0.18em] text-grey">
          Page {page} of {totalPages}
        </span>
        {hasMore ? (
          <Link
            href={`/scans${buildQuery({ page: page + 1, status })}`}
            className="inline-flex min-h-11 items-center gap-xs rounded-pill border border-rule-strong bg-transparent px-md text-control font-medium text-ink transition-colors hover:border-accent hover:text-accent focus-ring"
          >
            Next
            <ChevronRight className="h-4 w-4" strokeWidth={1.9} />
          </Link>
        ) : (
          <span className="inline-flex min-h-11 items-center gap-xs rounded-pill border border-rule bg-transparent px-md text-control font-medium text-grey opacity-50">
            Next
            <ChevronRight className="h-4 w-4" strokeWidth={1.9} />
          </span>
        )}
      </nav>
    </section>
  );
}
