import type { Metadata } from "next";
import { WineThumb } from "@/components/wine-thumb";
import Link from "next/link";
import { ArrowLeft, Wine } from "lucide-react";
import { getAuthContext } from "@/lib/auth-context";
import { RouteDataEmpty } from "@/components/route-data-state";
import { ML_PER_OZ } from "@/lib/units";
import { cn } from "@/lib/utils";
import { CloseBottleButton } from "./close-button";
import { wineDisplayName } from "@/lib/wine-display-name";
import {
  formatPhysicalBottleId,
  getInventoryContractVersion,
  listActivePhysicalBottles,
} from "@/domains/pours/physical-bottle-command";
import type { PhysicalBottleSummary } from "@/lib/wine-list/shapes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Open Bottles" };

type WineDisplay = {
  id: string;
  name: string;
  producer: string;
  vintage: number | null;
  hero_image_url: string | null;
  colour: string | null;
};

export default async function OpenBottlesPage() {
  const auth = (await getAuthContext())!;
  const { supabase, restaurantId } = auth;

  const [inventoryContractVersion, bottles] = await Promise.all([
    getInventoryContractVersion(supabase),
    listActivePhysicalBottles(supabase, restaurantId),
  ]);
  const wineIds = [...new Set(bottles.map((bottle) => bottle.wineId))];
  const wineQuery = supabase.from("wines")
    .select("id, name, producer, vintage, hero_image_url, colour")
    .eq("restaurant_id", restaurantId)
    .in("id", wineIds);
  const { data: wines, error: winesError } = wineIds.length > 0
    ? await wineQuery
    : { data: [], error: null };
  if (winesError) throw winesError;
  const winesById = new Map(
    ((wines ?? []) as WineDisplay[]).map((wine) => [wine.id, wine]),
  );
  const openBottles = [...bottles].sort((a, b) =>
    b.openedAt.localeCompare(a.openedAt));
  const renderedAtMs = new Date().getTime();

  return (
    <section>
      {/* Masthead (DESIGN.md — Components, Masthead): the tally moves into the
          eyebrow so the room's name has the line to itself. */}
      <header className="dawn-gradient relative -mx-md -mt-lg mb-lg overflow-hidden px-md pb-lg pt-xl md:-mx-lg md:-mt-xl md:mb-xl md:px-lg md:pb-xl md:pt-2xl">
        <div className="flex items-start gap-sm">
          <Link
            href="/cellar"
            className="glass flex h-11 w-11 shrink-0 items-center justify-center rounded-pill text-ink-soft transition-colors hover:text-ink"
            aria-label="Back to cellar"
          >
            <ArrowLeft className="h-5 w-5" strokeWidth={1.9} />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="text-caption font-medium uppercase tracking-[0.18em] text-accent">
              Cellar · Open ·{" "}
              <span className="tabular">{openBottles.length}</span> bottle
              {openBottles.length !== 1 ? "s" : ""}
            </p>
            <h1 className="mt-xs font-serif text-heading font-normal leading-[1.0] tracking-[-0.02em] text-ink lg:text-display">
              Open Bottles
            </h1>
          </div>
        </div>
      </header>

      {openBottles.length === 0 && (
        <RouteDataEmpty
          icon={<Wine className="h-6 w-6" strokeWidth={1.5} />}
          title="No open bottles"
          description="Open a bottle from the cellar to start tracking pours. Open bottles will appear here with their remaining volume."
          action={
            <Link
              href="/cellar"
              className="inline-flex h-11 items-center rounded-pill bg-primary px-md text-control font-semibold text-seal-ink hover:bg-primary-hover"
            >
              Return to cellar
            </Link>
          }
        />
      )}

      {openBottles.length > 0 && (
        <div className="border-y border-rule">
          <div className="hidden gap-md border-b border-rule-strong px-lg py-sm md:grid md:grid-cols-[1fr_120px_160px_120px_100px]">
            <span className="text-caption font-medium text-grey uppercase">Wine</span>
            <span className="text-caption font-medium text-grey uppercase">Format</span>
            <span className="text-caption font-medium text-grey uppercase">Opened</span>
            <span className="text-caption font-medium text-grey uppercase text-right">Remaining</span>
            <span className="text-caption font-medium text-grey uppercase text-right">Action</span>
          </div>

          <ul className="divide-y divide-rule">
            {openBottles.map((bottle) => {
              const wine = winesById.get(bottle.wineId) ?? null;
              const sizeMl = bottle.nominalCapacityMl;
              const remainingOz = bottle.remainingMl / ML_PER_OZ;
              const remainingPct =
                sizeMl === null ? null : Math.round((bottle.remainingMl / sizeMl) * 100);
              const openedDate = new Date(bottle.openedAt);
              const daysOpen = Math.floor(
                (renderedAtMs - openedDate.getTime()) / (1000 * 60 * 60 * 24),
              );
              const openedLabel =
                daysOpen === 0
                  ? "Today"
                  : daysOpen === 1
                    ? "Yesterday"
                    : `${daysOpen}d ago`;

              return (
                <li key={bottle.id}>
                  <Link
                    href={`/cellar?wine=${bottle.wineId}&bottle=${bottle.id}`}
                    className="block px-lg py-md transition-colors hover:bg-wash focus-ring"
                  >
                    <div className="md:hidden">
                      <div className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-start gap-sm">
                        <OpenThumb wine={wine} />
                        <div className="min-w-0 font-serif text-body-lg font-normal leading-snug text-ink">
                          {wine?.producer ?? "Unknown"}{" "}
                          {wine ? wineDisplayName(wine.producer, wine.name) : "Unknown"}
                          {wine?.vintage != null && (
                            <span className="font-sans font-light text-grey ml-xs">
                              {wine.vintage}
                            </span>
                          )}
                        </div>
                        <CloseBottleButton
                          bottleId={bottle.id}
                          wineId={bottle.wineId}
                          identityContract={inventoryContractVersion}
                          openedAt={bottle.openedAt}
                          remainingOz={remainingOz}
                        />
                      </div>
                      <div className="mt-xs flex flex-wrap items-center gap-sm text-ledger text-grey">
                        <span>{sizeMl === null ? "Capacity unavailable" : formatBottleSize(sizeMl)}</span>
                        <span aria-hidden>·</span>
                        <span>
                          {openedLabel}{" "}
                          <span className="text-grey">
                            {openedDate.toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                            })}
                          </span>
                        </span>
                      </div>
                      <div className="mt-sm flex items-center gap-sm">
                        {remainingPct !== null && <PourMeter pct={remainingPct} className="flex-1" />}
                        <span className="shrink-0 text-body-sm tabular text-ink">
                          {formatOz(remainingOz)}
                        </span>
                      </div>
                      <BottleIdentity bottle={bottle} />
                    </div>

                    <div className="hidden md:grid md:grid-cols-[40px_1fr_120px_160px_120px_100px] gap-md items-center">
                      <OpenThumb wine={wine} />
                      <div className="min-w-0">
                        <div className="truncate font-serif text-body-lg font-normal text-ink">
                          {wine?.producer ?? "Unknown"}{" "}
                          {wine ? wineDisplayName(wine.producer, wine.name) : "Unknown"}
                        </div>
                        {wine?.vintage != null && (
                          <div className="text-ledger tabular text-grey">
                            {wine.vintage}
                          </div>
                        )}
                      </div>
                      <div className="text-body-sm tabular text-ink">
                        {sizeMl === null ? "Capacity unavailable" : formatBottleSize(sizeMl)}
                      </div>
                      <div className="text-body-sm text-ink">
                        <span>{openedLabel}</span>
                        <span className="text-grey ml-xs">
                          {openedDate.toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      <div className="text-right">
                        <div className="flex items-center justify-end gap-sm">
                          {remainingPct !== null && <PourMeter pct={remainingPct} className="w-16" />}
                          <span className="text-body-sm tabular text-ink">
                            {formatOz(remainingOz)}
                          </span>
                        </div>
                      </div>
                      <div className="text-right">
                        <CloseBottleButton
                          bottleId={bottle.id}
                          wineId={bottle.wineId}
                          identityContract={inventoryContractVersion}
                          openedAt={bottle.openedAt}
                          remainingOz={remainingOz}
                        />
                      </div>
                      <BottleIdentity bottle={bottle} />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

/** 2:3 portrait behind a glass hairline (DESIGN.md — Imagery). */
function OpenThumb({ wine }: { wine: WineDisplay | null }) {
  return (
    <WineThumb
      src={wine?.hero_image_url}
      producer={wine?.producer}
      name={wine?.name}
      colour={wine?.colour}
      size={40}
    />
  );
}

function BottleIdentity({ bottle }: { bottle: PhysicalBottleSummary }) {
  const source = bottle.sourceProvenance === "known" ? "Tracked source" : "Legacy source";
  return (
    <p className="mt-xs break-all font-mono text-ledger text-grey md:col-span-5 md:col-start-2 md:mt-0">
      Bottle {formatPhysicalBottleId(bottle.id)} · {source}
      {bottle.sourceBinLocation ? ` · ${bottle.sourceBinLocation}` : ""}
    </p>
  );
}

/**
 * How much is left, as the system's one meter: a 3px `rule-strong` track with
 * a copper→bone fill (DESIGN.md — Components, Meter). The level is carried by
 * the width and by the ounce figure beside it, so the fill does not need a
 * second, competing hue to say the same thing.
 */
function PourMeter({ pct, className }: { pct: number; className?: string }) {
  return (
    <div className={cn("h-[3px] overflow-hidden rounded-pill bg-rule-strong", className)}>
      <div
        className="h-full rounded-pill bg-gradient-to-r from-accent to-primary transition-all"
        style={{ width: `${Math.max(pct, 2)}%` }}
      />
    </div>
  );
}

function formatBottleSize(ml: number): string {
  if (ml === 750) return "Standard (750ml)";
  if (ml === 375) return "Half (375ml)";
  if (ml === 1500) return "Magnum (1.5L)";
  if (ml === 3000) return "Double Magnum (3L)";
  if (ml >= 1000) return `${(ml / 1000).toFixed(1)}L`;
  return `${ml}ml`;
}

function formatOz(oz: number): string {
  if (oz < 0.05) return "0 oz";
  if (oz < 1) return `${oz.toFixed(1)} oz`;
  return `${oz.toFixed(1)} oz`;
}
