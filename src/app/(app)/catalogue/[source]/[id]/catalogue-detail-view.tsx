import Image from "next/image";
import { ExternalLink } from "lucide-react";
import {
  AxisBar,
  CommunityRating,
  DetailHero,
  Fact,
  Section,
  StatStrip,
} from "@/components/detail-sections";
import { wineInitials, wineTint } from "@/components/wine-thumb";
import { CORPUS_IMAGE_NOTE } from "@/lib/wine-intelligence/corpus-image";
import { catalogueWineTitle } from "@/lib/wine-display-name";
import type {
  CorpusRead,
  XWinesProfile,
} from "@/lib/wine-intelligence/xwines-profile";
import { CatalogueAddButton, type CatalogueAddPayload } from "./catalogue-add-button";

// P1 slice 2b — the catalogue detail view (program plan D4: "catalogue rows
// get a detail view rendered from canonical facts; add is one action on it").
//
// Until P2's canonical facts layer lands, this renders what the interim
// contract can honestly show: the reference identity, plus any X-Wines
// features an ACCEPTED P0 link stands behind — and it says out loud what it
// does not know. A catalogue wine has no tenant facts (stock, bins, pricing,
// vintage-specific detail) BY DEFINITION, and an unlinked one has no taste
// data either; both absences are stated rather than left as suspicious blank
// space, because a blank section reads as "this wine has nothing", which is
// a claim nobody verified.

export type CatalogueDetailViewProps = {
  identity: {
    lwinId: string | null;
    xwinesWineId: number | null;
    name: string;
    producer: string | null;
    region: string | null;
    country: string | null;
    colour: string | null;
    type: string | null;
    varietal: string | null;
  };
  profile: CorpusRead<XWinesProfile | null>;
  /** Present exactly when an LWIN identity backs an add — never provisional. */
  addPayload: CatalogueAddPayload | null;
};

export function CatalogueDetailView({
  identity,
  profile: profileRead,
  addPayload,
}: CatalogueDetailViewProps) {
  const profile = profileRead.status === "ok" ? profileRead.value : null;

  const title = catalogueWineTitle(identity.producer, identity.name);
  const image = profile?.image ?? null;
  const imageAlt = image === null || image.kind === "label" ? title : CORPUS_IMAGE_NOTE[image.kind];

  // Region and country open the eyebrow; style and grape carry the one-line
  // metadata row under the name.
  const meta = [
    profile?.type ?? identity.type ?? identity.colour,
    identity.varietal,
  ].filter((value): value is string => Boolean(value));

  const tint = wineTint(identity.colour ?? profile?.type ?? null);

  const hero =
    image !== null ? (
      /* unoptimized for the same reason every corpus image render is:
         next.config.ts declares no images.remotePatterns, so the optimizer
         would refuse the Storage URL outright. */
      <Image
        src={image.url}
        alt={imageAlt}
        fill
        priority
        unoptimized
        sizes="100vw"
        className="object-contain p-lg"
      />
    ) : (
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          aria-hidden="true"
          data-wine-image-fallback="true"
          className={`flex h-[210px] w-[140px] items-center justify-center rounded-lg border border-glass-edge md:h-[264px] md:w-[176px] ${tint.surface}`}
        >
          {/* The size token is concatenated outside cn(): the tint's colour
              and the scale's size read as one tailwind-merge group. */}
          <span className={`font-serif text-heading font-normal leading-none ${tint.ink}`}>
            {wineInitials(identity.producer, identity.name)}
          </span>
        </div>
      </div>
    );

  return (
    <div className="bg-canvas">
      <div className="mx-auto max-w-[1100px] pb-3xl">
        <DetailHero image={hero} back={{ href: "/cellar", label: "The cellar" }}>
          <p className="text-caption font-medium uppercase tracking-[0.18em] text-accent">
            {[identity.producer, identity.region, identity.country]
              .filter(Boolean)
              .join(" · ") || "From the catalogue"}
          </p>
          <h1 className="mt-xs font-serif text-heading font-normal leading-[1.02] tracking-[-0.02em] text-ink">
            {title}
          </h1>
          {meta.length > 0 && (
            <p className="mt-sm text-body-sm text-ink-soft">{meta.join(" · ")}</p>
          )}
          {/* Every corpus picture is captioned in VISIBLE text, exactly as the
              cellar detail page does: only a "label" kind is this wine's own
              label, and an uncaptioned stand-in at hero size is a visual claim
              the corpus never made. */}
          {image !== null && (
            <p className="mt-sm text-ledger text-grey">
              {CORPUS_IMAGE_NOTE[image.kind]}
              {image.credit !== null && <span className="block">{image.credit}</span>}
            </p>
          )}

          {/* The reference identity, on display: which corpora stand behind
              this page is the claim everything below rests on. */}
          <ul className="mt-md flex flex-wrap gap-xs" aria-label="Reference identity">
            {identity.lwinId !== null && (
              <li className="rounded-pill border border-rule-strong px-sm py-2xs text-ledger text-grey">
                LWIN {identity.lwinId}
              </li>
            )}
            {(identity.xwinesWineId !== null || profile !== null) && (
              <li className="rounded-pill border border-rule-strong px-sm py-2xs text-ledger text-grey">
                X-Wines
              </li>
            )}
          </ul>

          <StatStrip
            items={[
              { label: "In your cellar", value: "Not stocked" },
              {
                label: "Community",
                value:
                  profile?.ratingAvg != null ? (
                    <CommunityRating avg={profile.ratingAvg} count={profile.ratingCount} />
                  ) : null,
              },
            ]}
          />

          {addPayload !== null ? (
            /* The one action on the page, pinned in a glass rail at the foot
               of a phone and flowing back into the sheet at md: `contents`
               drops the rail from layout rather than duplicating the button
               into two places a screen reader would both find. The right edge
               stops short of the speed-dial FAB, which is fixed in the same
               band on this route (fab.tsx does not hide on /catalogue). */
            <div
              className="glass fixed left-md right-[calc(var(--chrome-fab)+var(--spacing-md)*2)] z-[var(--z-sticky)] flex rounded-pill p-2xs md:mt-lg md:contents"
              style={{
                bottom:
                  "calc(var(--chrome-tabbar-total) + var(--spacing-md) + var(--spacing-md))",
              }}
            >
              <CatalogueAddButton payload={addPayload} />
            </div>
          ) : (
            <p className="mt-lg text-body-sm text-grey">
              This wine can&rsquo;t be added to your cellar yet — no LWIN
              identity is linked to it, and adding it under a guessed one
              would put a wrong wine in your records.
            </p>
          )}
        </DetailHero>

        {profileRead.status === "unavailable" && (
          <p className="card-surface mt-xl rounded-card px-lg py-md text-body-sm text-grey">
            The reference corpus couldn&rsquo;t be reached, so the taste
            structure, grapes and pairings linked to this wine aren&rsquo;t
            shown. That&rsquo;s a problem at our end rather than a gap in the
            reference — try again shortly.
          </p>
        )}
        {profileRead.status === "ok" && profileRead.value === null && (
          <p className="card-surface mt-xl rounded-card px-lg py-md text-body-sm text-grey">
            No linked X-Wines entry yet, so taste structure, grapes, pairings
            and community ratings are unknown for this wine — unknown, not
            blank: nobody has verified them either way.
          </p>
        )}

        {profile && (profile.body || profile.acidity) && (
          <Section title="What does this wine taste like?">
            <div className="grid gap-xl md:grid-cols-[minmax(0,1fr)_minmax(0,280px)]">
              <div className="flex flex-col gap-lg">
                {profile.body && <AxisBar axis={profile.body} />}
                {profile.acidity && <AxisBar axis={profile.acidity} />}
              </div>
              <p className="text-body-sm text-grey">
                Structure for{" "}
                <span className="text-ink-soft">{profile.matchedName}</span>{" "}
                from the X-Wines reference corpus. It describes body and acidity
                only — tannin and sweetness aren&rsquo;t recorded, so they
                aren&rsquo;t shown.
              </p>
            </div>
          </Section>
        )}

        {profile && profile.pairings.length > 0 && (
          <Section title="Food that goes well with this wine">
            <ul className="flex flex-wrap gap-sm">
              {profile.pairings.map((pairing) => (
                <li
                  key={pairing}
                  className="rounded-pill border border-rule-strong px-md py-xs text-body-sm text-ink-soft"
                >
                  {pairing}
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="Facts about the wine">
          <dl className="card-surface grid gap-0 rounded-card px-lg py-xs sm:grid-cols-2 sm:gap-x-2xl">
            <Fact label="Producer" value={identity.producer} />
            <Fact label="Grapes" value={profile?.grapes.join(", ") || identity.varietal} />
            <Fact
              label="Region"
              value={[identity.region, identity.country].filter(Boolean).join(", ") || null}
            />
            <Fact label="Style" value={profile?.elaborate ?? profile?.type ?? identity.type} />
            <Fact
              label="Alcohol"
              value={profile?.abv != null ? `${profile.abv}%` : null}
            />
            {profile?.website && (
              <Fact
                label="Winery"
                value={
                  <a
                    href={profile.website}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-xs text-accent hover:underline"
                  >
                    {profile.matchedWinery ?? identity.producer}
                    <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
                  </a>
                }
              />
            )}
          </dl>
        </Section>

        <Section title="Not in your cellar">
          <p className="text-body-sm text-grey">
            This is a catalogue wine — stock, bins, pricing and vintage-specific
            details exist only for wines in your cellar, so none are shown here.
            {addPayload !== null && " Add it and they start accruing."}
          </p>
        </Section>
      </div>
    </div>
  );
}
