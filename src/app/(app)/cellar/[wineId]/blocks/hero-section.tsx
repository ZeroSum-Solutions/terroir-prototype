import Image from "next/image";
import { StatusChip } from "@/components/status-chip";
import {
  CommunityRating,
  DetailHero,
  StatStrip,
  type StatItem,
} from "@/components/detail-sections";
import { wineTint, wineInitials } from "@/components/wine-thumb";
import { CORPUS_IMAGE_NOTE } from "@/lib/wine-intelligence/corpus-image";
import { wineDisplayName } from "@/lib/wine-display-name";
import type { ResolvedWineFacts } from "@/lib/wine-intelligence/wine-reference-facts";
import type { XWinesProfile } from "@/lib/wine-intelligence/xwines-profile";
import type { WineRow } from "./types";
import { wineImageReferenceNote } from "@/lib/wine-intelligence/wine-image-reference";

export type HeroSectionProps = {
  wine: WineRow;
  profile: XWinesProfile | null;
  bottleCount: number;
  /** Bins this wine is placed in, for the stat strip. */
  locations: string[];
  facts: ResolvedWineFacts;
  heroSrc: string | null;
  heroAlt: string;
  corpusImage: NonNullable<XWinesProfile["image"]> | null;
};

/**
 * The wine, as the page opens (DESIGN.md — Masthead, Imagery): the bottle
 * full-bleed in a band that fades into the canvas, then a glass sheet carrying
 * the eyebrow, the name in the serif, one line of metadata and the strip of
 * figures the bottle is judged on.
 *
 * Everything the old two-column header stated is still stated — producer,
 * region, country, vintage, style, varietal, format, the picture's caption,
 * the 86 seal, the stock count, the community rating — regrouped so a phone
 * reads it in one pass instead of scrolling a 300px image column first.
 */
export function HeroSection({
  wine,
  profile,
  bottleCount,
  locations,
  facts,
  heroSrc,
  heroAlt,
  corpusImage,
}: HeroSectionProps) {
  const referenceNote = wineImageReferenceNote(wine.hero_image_url);
  // The no-photo hero: the same tint WineThumb uses, at 2:3 portrait in the
  // middle of the band — a considered graphic element, not a stand-in for a
  // missing asset (DESIGN.md — Imagery).
  const tint = wineTint(wine.colour);
  const initials = wineInitials(wine.producer, wine.name);
  const caption =
    referenceNote ?? (corpusImage !== null ? CORPUS_IMAGE_NOTE[corpusImage.kind] : null);
  const credit = referenceNote === null ? (corpusImage?.credit ?? null) : null;

  const eyebrow = [wine.producer, facts.region, facts.country]
    .filter((value): value is string => Boolean(value))
    .join(" · ");
  const meta = [
    wine.vintage !== null ? String(wine.vintage) : null,
    profile?.type ?? null,
    facts.varietal,
    wine.size_ml !== null ? `${wine.size_ml} ml` : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" · ");

  const stats: StatItem[] = [
    {
      label: "Stock",
      value: (
        <span className="text-body-lg text-ink">
          <span className="tabular">{bottleCount === 0 ? "None" : bottleCount}</span>{" "}
          <span className="text-ledger text-grey">on hand</span>
        </span>
      ),
    },
    { label: "Bin", value: locations.length > 0 ? locations.join(" · ") : null },
    {
      label: "Retail median",
      value:
        wine.retail_median != null ? (
          <span className="text-body-lg tabular text-ink">${wine.retail_median}</span>
        ) : null,
    },
    {
      label: "Community",
      value:
        profile?.ratingAvg != null ? (
          <CommunityRating avg={profile.ratingAvg} count={profile.ratingCount} />
        ) : null,
    },
  ];

  const image =
    heroSrc !== null ? (
      /* unoptimized, as every other hero_image_url render does
         (wine-detail-drawer, WineThumb): the URL is an absolute Supabase
         Storage one and next.config.ts declares no images.remotePatterns, so
         the optimizer would refuse it and the page would throw for any wine
         that HAS a picture. object-contain, never a cover crop: the band is
         full-bleed, the bottle inside it is whole. */
      <Image
        src={heroSrc}
        alt={heroAlt}
        fill
        priority
        unoptimized
        sizes="100vw"
        /* A radial mask fades the photograph's own studio backdrop into
           the canvas at the edges, so a white reference plate reads as
           light on the bottle rather than a pale rectangle on obsidian. */
        className="object-contain p-lg [mask-image:radial-gradient(ellipse_62%_72%_at_50%_46%,black_42%,transparent_80%)]"
      />
    ) : (
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          aria-hidden="true"
          data-wine-image-fallback="true"
          className={`flex h-[210px] w-[140px] items-center justify-center rounded-lg border border-glass-edge md:h-[264px] md:w-[176px] ${tint.surface}`}
        >
          {/* The size token is concatenated outside cn() on purpose: the
              tint's `text-ink` and the scale's `text-heading` read as one
              tailwind-merge group and the size would be dropped. */}
          <span className={`font-serif text-heading font-normal leading-none ${tint.ink}`}>
            {initials}
          </span>
        </div>
      </div>
    );

  return (
    <DetailHero image={image} back={{ href: "/cellar", label: "The cellar" }}>
      {eyebrow && (
        <p className="text-caption font-medium uppercase tracking-[0.18em] text-accent">
          {eyebrow}
        </p>
      )}
      <h1 className="mt-xs font-serif text-heading font-normal leading-[1.02] tracking-[-0.02em] text-ink">
        {wineDisplayName(wine.producer, wine.name)}
      </h1>
      {meta && <p className="mt-sm text-body-sm text-ink-soft">{meta}</p>}
      {(wine.is_eightysixed || caption !== null) && (
        <div className="mt-sm flex flex-wrap items-center gap-sm">
          {wine.is_eightysixed && <StatusChip tone="urgent">86&rsquo;d</StatusChip>}
          {caption !== null && (
            <p className="text-ledger text-grey">
              {caption}
              {credit !== null && <span className="block">{credit}</span>}
            </p>
          )}
        </div>
      )}
      <StatStrip items={stats} />
    </DetailHero>
  );
}
