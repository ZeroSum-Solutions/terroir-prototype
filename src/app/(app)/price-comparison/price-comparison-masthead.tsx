/**
 * The Distributor Pricing masthead (DESIGN.md — Components, Masthead): the
 * copper `.dawn-gradient` glow, an eyebrow carrying the tenant and how many
 * wines are in the comparison, the room's name in the serif, and the export
 * as a ghost pill in the top-right on desktop / below the headline on a
 * phone.
 *
 * The h1 stays the literal "Distributor Pricing": the demo journeys assert it
 * by name.
 */
export function PriceComparisonMasthead({
  tenant,
  count,
  action,
}: {
  tenant?: string;
  count?: number;
  action?: React.ReactNode;
}) {
  const eyebrow = [
    tenant?.trim(),
    count == null
      ? null
      : `${count.toLocaleString()} wine${count === 1 ? "" : "s"}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="dawn-gradient -mx-md -mt-lg mb-xl px-md pb-lg pt-lg md:-mx-lg md:-mt-xl md:mb-3xl md:px-lg md:pb-2xl md:pt-xl">
      <div className="flex flex-col gap-md md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <p className="truncate text-caption font-medium uppercase tracking-[0.18em] text-accent">
            {eyebrow}
          </p>
          <h1 className="mt-xs font-serif text-heading font-normal leading-[1.0] tracking-[-0.02em] text-ink lg:text-display">
            Distributor Pricing
          </h1>
          <p className="mt-sm text-body text-ink-soft">
            Compare prices across suppliers
          </p>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </div>
  );
}
