import Image from "next/image";

/**
 * The cellar masthead (DESIGN.md — Components, Masthead): a copper-light
 * image band fading into the canvas, an eyebrow carrying the count and the
 * tenant, and the room's name in the serif.
 *
 * The photograph is the owner's supplied reference crop
 * (public/design-refs, not licensed for production — see DESIGN.md,
 * Imagery). The h1 stays the literal "Cellar": the demo journeys assert it
 * by name.
 */
export function CellarMasthead({
  count,
  restaurantName,
}: {
  count: number;
  restaurantName: string;
}) {
  const tenant = restaurantName?.trim();
  return (
    <div className="relative -mx-md -mt-lg overflow-hidden px-md pb-lg pt-[132px] max-[359px]:pt-[96px] md:-mx-lg md:-mt-xl md:px-lg md:pb-2xl md:pt-[168px]">
      <Image
        src="/design-refs/cellar-masthead.jpg"
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover"
        style={{ objectPosition: "50% 45%" }}
        aria-hidden
      />
      {/* The scrim is built from the canvas token so the band fades into
          whichever room is on: obsidian by default, bone in daylight. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, color-mix(in srgb, var(--color-canvas) 45%, transparent) 0%, transparent 26%, color-mix(in srgb, var(--color-canvas) 30%, transparent) 52%, color-mix(in srgb, var(--color-canvas) 92%, transparent) 82%, var(--color-canvas) 100%)",
        }}
        aria-hidden
      />
      <div className="relative">
        <p className="text-caption font-medium uppercase tracking-[0.18em] text-accent">
          <span className="tabular">{count.toLocaleString()}</span> wine{count === 1 ? "" : "s"}
          {tenant ? <> · {tenant}</> : null}
        </p>
        <h1 className="mt-xs font-serif text-heading font-normal leading-[1.0] tracking-[-0.02em] text-ink lg:text-display">
          Cellar
        </h1>
      </div>
    </div>
  );
}
