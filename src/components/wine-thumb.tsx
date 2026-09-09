import Image from "next/image";

import { cn } from "@/lib/utils";
import { wineImageReferenceNote } from "@/lib/wine-intelligence/wine-image-reference";

/**
 * A wine's picture, or a stand-in for one.
 *
 * Before this existed, a wine with no image rendered nothing at all — so a
 * cellar list was a ragged mix of rows that had a thumbnail and rows that
 * simply didn't, which reads as broken rather than as "no photo yet". A
 * stand-in every row can fall back to makes the list look deliberate, and it
 * carries real information: the producer's initials, tinted by wine colour.
 */

/**
 * Cellar Index tints by ink/paper/blue alone — the old palette borrowed the
 * status wax colours (risk/hold), which meant a white wine's stand-in used
 * the same pink wash as an "attention" chip and a sparkling one used the
 * same blue as a "hold" chip. Wine colour is not a status, so it no longer
 * shares that vocabulary: darker wines tint the paper with ink, lighter and
 * brighter ones tint it with the brand blue, and normalised/cased/spaced
 * lookup is unchanged.
 */
const TINTS: Record<string, { surface: string; ink: string }> = {
  red: { surface: "bg-ink/8", ink: "text-ink" },
  rose: { surface: "bg-ink/4", ink: "text-ink" },
  rosé: { surface: "bg-ink/4", ink: "text-ink" },
  fortified: { surface: "bg-ink/8", ink: "text-ink" },
  white: { surface: "bg-primary/8", ink: "text-ink" },
  sweet: { surface: "bg-primary/8", ink: "text-ink" },
  sparkling: { surface: "bg-primary/14", ink: "text-ink" },
};

const NEUTRAL = { surface: "bg-wash", ink: "text-ink" };

export function wineTint(colour: string | null | undefined) {
  return TINTS[colour?.trim().toLocaleLowerCase() ?? ""] ?? NEUTRAL;
}

/**
 * Up to two initials for the stand-in.
 *
 * Prefers the producer — a cellar groups by who made the wine, so "DR" for
 * Domaine Romanée is more recognisable at 36px than the wine's own name. Falls
 * back to the wine name, then to nothing rather than a meaningless glyph.
 */
export function wineInitials(producer: string | null | undefined, name: string | null | undefined): string {
  const source = (producer?.trim() || name?.trim() || "");
  if (!source) return "";
  const words = source.split(/\s+/).filter((word) => /\p{L}|\p{N}/u.test(word));
  if (words.length === 0) return "";
  const letters = words.slice(0, 2).map((word) => Array.from(word)[0] ?? "");
  return letters.join("").toLocaleUpperCase();
}

export interface WineThumbProps {
  src: string | null | undefined;
  producer: string | null | undefined;
  name: string | null | undefined;
  colour?: string | null;
  /** Rendered size in px. The image is requested at 2× for retina. */
  size: number;
  className?: string;
}

export function WineThumb({ src, producer, name, colour, size, className }: WineThumbProps) {
  const referenceNote = wineImageReferenceNote(src);
  // Sharp geometry, small radii (DESIGN.md — Controls): a thumbnail this
  // small reads as a chip, not a card, so it takes the small radius.
  const shared = cn("shrink-0 rounded-sm object-contain", className);

  if (src) {
    return (
      <Image
        src={src}
        alt={referenceNote ?? ""}
        title={referenceNote ?? undefined}
        width={size * 2}
        height={size * 2}
        unoptimized
        style={{ width: size, height: size }}
        className={shared}
      />
    );
  }

  const tint = wineTint(colour);
  const initials = wineInitials(producer, name);

  return (
    <span
      aria-hidden="true"
      data-wine-image-fallback="true"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }}
      className={cn(
        shared,
        tint.surface,
        tint.ink,
        // Confident, not apologetic: the same heavy grotesque as the
        // headings, tight-tracked rather than loosened, so a no-photo row
        // reads as a deliberate mark and not a softened placeholder.
        "flex items-center justify-center font-serif font-bold leading-none tracking-[-0.01em]",
      )}
    >
      {initials}
    </span>
  );
}
