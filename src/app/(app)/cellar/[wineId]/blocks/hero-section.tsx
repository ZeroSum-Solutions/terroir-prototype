import Image from "next/image";
import { cn } from "@/lib/utils";
import { StatusChip } from "@/components/status-chip";
import { CommunityRating } from "@/components/detail-sections";
import { wineTint, wineInitials } from "@/components/wine-thumb";
import { CORPUS_IMAGE_NOTE } from "@/lib/wine-intelligence/corpus-image";
import { wineDisplayName } from "@/lib/wine-display-name";
import type { XWinesProfile } from "@/lib/wine-intelligence/xwines-profile";
import type { WineRow } from "./types";
import { wineImageReferenceNote } from "@/lib/wine-intelligence/wine-image-reference";

export type HeroSectionProps = {
  wine: WineRow;
  profile: XWinesProfile | null;
  bottleCount: number;
  facets: string[];
  heroSrc: string | null;
  heroAlt: string;
  corpusImage: NonNullable<XWinesProfile["image"]> | null;
};

export function HeroSection({
  wine,
  profile,
  bottleCount,
  facets,
  heroSrc,
  heroAlt,
  corpusImage,
}: HeroSectionProps) {
  const referenceNote = wineImageReferenceNote(wine.hero_image_url);
  // The no-photo hero: the same ink/paper/blue tint WineThumb uses, scaled up
  // to fill the whole reserved image area rather than a small icon floating
  // inside a bordered frame — a considered graphic element, not a stand-in
  // for a missing asset (DESIGN.md — Photography).
  const tint = wineTint(wine.colour);
  const initials = wineInitials(wine.producer, wine.name);
  return (
    <header className="mt-md grid gap-xl py-2xl md:grid-cols-[minmax(0,300px)_minmax(0,1fr)] md:gap-2xl md:py-3xl">
      <div className="flex flex-col items-center justify-center gap-sm">
        {heroSrc !== null ? (
          /* unoptimized, as every other hero_image_url render does
             (wine-detail-drawer, WineThumb): the URL is an absolute
             Supabase Storage one and next.config.ts declares no
             images.remotePatterns, so the optimizer would refuse it and
             the page would throw for any wine that HAS a picture. */
          <Image
            src={heroSrc}
            alt={heroAlt}
            width={300}
            height={480}
            priority
            unoptimized
            className="h-auto w-[min(62vw,240px)] object-contain drop-shadow-2xl md:w-full"
          />
        ) : (
          <div
            aria-hidden="true"
            data-wine-image-fallback="true"
            className={cn(
              "flex h-[300px] w-[132px] items-center justify-center rounded-lg md:h-[380px] md:w-[168px]",
              tint.surface,
            )}
          >
            <span className={cn("font-serif text-heading font-bold leading-none", tint.ink)}>
              {initials}
            </span>
          </div>
        )}
        {referenceNote && (
          <p className="max-w-[240px] text-center text-caption text-grey md:max-w-full">{referenceNote}</p>
        )}
        {!referenceNote && corpusImage !== null && (
          <p className="max-w-[240px] text-center text-caption text-grey md:max-w-full">
            {CORPUS_IMAGE_NOTE[corpusImage.kind]}
            {corpusImage.credit !== null && (
              <span className="block">{corpusImage.credit}</span>
            )}
          </p>
        )}
      </div>

      <div className="flex flex-col justify-center">
        <p className="text-caption uppercase text-mark">{wine.producer}</p>
        <h1 className="mt-sm font-serif text-heading-sm leading-[1.06] text-ink md:text-heading lg:text-display">
          {wineDisplayName(wine.producer, wine.name)}
        </h1>
        {wine.vintage !== null && (
          <p className="mt-xs font-serif text-heading-sm text-grey">{wine.vintage}</p>
        )}

        {facets.length > 0 && (
          <ul className="mt-md flex flex-wrap items-center gap-x-sm gap-y-xs text-body-sm text-ink-soft">
            {facets.map((facet, index) => (
              <li key={facet} className="flex items-center gap-x-sm">
                {index > 0 && <span aria-hidden="true" className="text-rule">·</span>}
                {facet}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-lg flex flex-wrap items-center gap-md">
          {profile?.ratingAvg != null && (
            <CommunityRating avg={profile.ratingAvg} count={profile.ratingCount} />
          )}
          <StockBadge count={bottleCount} />
          {wine.is_eightysixed && <StatusChip tone="urgent">86&rsquo;d</StatusChip>}
        </div>
      </div>
    </header>
  );
}

function StockBadge({ count }: { count: number }) {
  return (
    <span className="rounded-md border border-rule bg-surface px-md py-xs text-body-sm text-ink-soft">
      {count === 0 ? "None on hand" : `${count} on hand`}
    </span>
  );
}
