/**
 * The /lists masthead (DESIGN.md — Masthead): an eyebrow carrying the counts,
 * then the room's name in the named face. No photograph here — the copper
 * `.dawn-gradient` glow is what a masthead without an image band gets.
 *
 * The h1 stays the literal "Wine Lists": the demo journeys assert it by name.
 */
export function ListsMasthead({
  total,
  published,
}: {
  total: number;
  published: number;
}) {
  return (
    <div className="dawn-gradient relative -mx-md -mt-lg mb-lg overflow-hidden px-md pb-lg pt-xl md:-mx-lg md:-mt-xl md:mb-xl md:px-lg md:pb-2xl md:pt-2xl">
      <p className="text-caption font-medium uppercase tracking-[0.18em] text-accent">
        <span className="tabular">{total.toLocaleString()}</span> list
        {total === 1 ? "" : "s"}
        {published > 0 ? (
          <>
            {" · "}
            <span className="tabular">{published.toLocaleString()}</span>{" "}
            published
          </>
        ) : null}
      </p>
      <h1 className="mt-xs font-serif text-heading font-normal leading-[1.0] tracking-[-0.02em] text-ink lg:text-display">
        Wine Lists
      </h1>
      {/* One line — the two-line onboarding pitch pushed the first card
          below ~45% of the mobile viewport (Kimi audit 2026-08-26). */}
      <p className="mt-sm max-w-[46ch] text-body text-ink-soft">
        Published menus sync to inventory automatically.
      </p>
    </div>
  );
}
