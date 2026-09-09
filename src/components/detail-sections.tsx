import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { TasteAxis } from "@/lib/wine-intelligence/xwines-profile";

// Shared building blocks for the wine detail surfaces — the cellar wine page
// (src/app/(app)/cellar/[wineId]/wine-detail-view.tsx) and the catalogue
// detail page (src/app/(app)/catalogue/[source]/[id]/catalogue-detail-view.tsx)
// render the same corpus facts, so the pieces live once, here. Extracted from
// wine-detail-view.tsx when the catalogue view became their second consumer
// (P1 slice 2b), and extended with the hero band + glass sheet when Obsidian
// Glass made both pages open the same way.

/**
 * The scrim over a hero band (DESIGN.md — Imagery, Masthead): the photograph
 * fades into the canvas by 84% so the sheet below it never sits on a busy
 * region. Built from the canvas token rather than a literal, so the bone room
 * fades to bone and the obsidian room fades to obsidian.
 */
const HERO_SCRIM =
  "linear-gradient(180deg, color-mix(in srgb, var(--color-canvas) 50%, transparent) 0%, transparent 28%, color-mix(in srgb, var(--color-canvas) 34%, transparent) 56%, color-mix(in srgb, var(--color-canvas) 90%, transparent) 84%, var(--color-canvas) 100%)";

/**
 * A detail page's opening: the bottle full-bleed in a band that fades into the
 * canvas, the room's controls floating over it as glass circles, and a glass
 * sheet carrying the wine's identity pulled up over the band's foot.
 *
 * The band is `.dawn-gradient` under the picture rather than a cover crop:
 * DESIGN.md calls out the banner crop by name for cutting the tops off
 * bottles, so the bottle is contained and the copper glow is what fills the
 * frame around it.
 */
export function DetailHero({
  image,
  back,
  children,
}: {
  image: React.ReactNode;
  back: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <header className="relative -mx-md -mt-lg md:-mx-lg md:-mt-xl">
      <div className="dawn-gradient relative h-[min(52vh,380px)] overflow-hidden md:h-[420px]">
        {image}
        <div aria-hidden className="absolute inset-0" style={{ background: HERO_SCRIM }} />
      </div>
      <Link
        href={back.href}
        aria-label={back.label}
        className="glass focus-ring absolute left-md top-md flex h-11 w-11 items-center justify-center rounded-full text-ink transition-colors hover:text-accent md:left-lg md:top-lg"
      >
        <ArrowLeft aria-hidden="true" className="h-5 w-5" strokeWidth={1.8} />
      </Link>
      <div className="relative -mt-2xl px-md md:-mt-3xl md:px-lg">
        <div className="glass rounded-card p-lg md:p-xl">{children}</div>
      </div>
    </header>
  );
}

export type StatItem = { label: string; value: React.ReactNode };

/** Two across on a phone, one row on a tablet up. */
const STRIP_COLS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-2 sm:grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-4",
};

/**
 * The figures a bottle is judged on, in one strip inside the identity sheet
 * rather than four bordered cards down the page. Divided by hairlines, never
 * boxed (DESIGN.md — Do's and Don'ts). An item with no value is dropped: a
 * blank cell is a claim nobody made.
 */
export function StatStrip({ items }: { items: StatItem[] }) {
  const shown = items.filter((item) => item.value !== null && item.value !== "");
  if (shown.length === 0) return null;
  return (
    <dl className={`mt-lg grid border-t border-rule ${STRIP_COLS[shown.length] ?? STRIP_COLS[4]}`}>
      {shown.map((item) => (
        <div
          key={item.label}
          className="border-rule py-md pr-sm [&:nth-child(2n)]:border-l [&:nth-child(2n)]:pl-md [&:nth-child(n+3)]:border-t sm:[&:not(:first-child)]:border-l sm:[&:not(:first-child)]:pl-md sm:[&:nth-child(n+3)]:border-t-0"
        >
          <dt className="text-caption font-medium uppercase tracking-[0.18em] text-grey">
            {item.label}
          </dt>
          <dd className="mt-2xs text-body-sm text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-rule pt-xl mt-xl md:pt-2xl md:mt-2xl">
      <h2 className="mb-lg font-serif text-heading-sm font-normal text-ink">{title}</h2>
      {children}
    </section>
  );
}

export function Fact({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode | null;
}) {
  if (value === null || value === "") return null;
  return (
    <div className="flex items-baseline justify-between gap-md border-b border-rule py-md last:border-b-0 sm:odd:border-b">
      <dt className="text-caption uppercase text-grey">{label}</dt>
      <dd className="text-right text-body-sm text-ink">{value}</dd>
    </div>
  );
}

/**
 * A taste axis, drawn as the system's meter (DESIGN.md — Components, Meter):
 * a 3px hairline-strong track with a copper→bone fill. The corpus's own word
 * for the value is shown alongside so the position is never the only claim
 * being made — a reader who distrusts a bar can still read "Very full-bodied".
 */
export function AxisBar({ axis }: { axis: TasteAxis }) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-caption uppercase text-grey">
        <span>{axis.low}</span>
        <span className="text-ink-soft">{axis.label}</span>
        <span>{axis.high}</span>
      </div>
      <div
        className="mt-sm h-[3px] rounded-pill bg-rule-strong"
        role="img"
        aria-label={`${axis.label}, between ${axis.low} and ${axis.high}`}
      >
        <div
          className="h-full rounded-pill bg-gradient-to-r from-accent to-primary"
          style={{ width: `${Math.round(axis.position * 100)}%` }}
        />
      </div>
    </div>
  );
}

export function CommunityRating({ avg, count }: { avg: number; count: number }) {
  return (
    <div className="flex flex-col">
      <span className="font-serif text-subheading leading-none text-ink tabular">
        {avg.toFixed(1)}
      </span>
      <span className="mt-2xs text-ledger text-grey">
        from {count.toLocaleString()} ratings
      </span>
    </div>
  );
}
