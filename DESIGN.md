---
version: alpha
name: Terroir — Cellar Index
description: A wine list read like a printed index. Paper ground, ink-black structure, one printmaker blue for everything you can act on. Set in Archivo over Inter, tight-tracked, sentence case. Brown and cream are banned outright, in every mode.
colors:
  primary: "#1664EB"
  primary-hover: "#0E4FC7"
  accent: "#1664EB"
  mark: "#1664EB"
  canvas: "#F8F7EF"
  surface: "#FFFFFF"
  surface-raised: "#F5F4E9"
  surface-sunken: "#F2F1E4"
  wash: "#F7F6EC"
  ink: "#121212"
  ink-soft: "#3D3D3D"
  grey: "#686868"
  ink-disabled: "#9A9A9A"
  rule: "rgba(18, 18, 18, 0.12)"
  rule-strong: "rgba(18, 18, 18, 0.22)"
  edge: "#7A7A7A"
  focus: "#1664EB"
  seal-ink: "#FFFFFF"
  ready: "#2C774E"
  ready-wash: "#E4F0EA"
  ready-ink: "#215C3C"
  hold: "#2D6A9F"
  hold-wash: "#E3EEF6"
  hold-ink: "#22506F"
  peak-wash: "#E8EAEC"
  peak-ink: "#121212"
  risk-wash: "#F7E4E8"
  risk-ink: "#96122A"
  glass: "#FFFFFF"
  glass-edge: "rgba(18, 18, 18, 0.16)"
  shadow-card: "rgba(18, 18, 18, 0.08)"
  dark-primary: "#4A90FF"
  dark-primary-hover: "#6BA6FF"
  dark-accent: "#4A90FF"
  dark-mark: "#4A90FF"
  dark-canvas: "#121212"
  dark-surface: "#1B1B1B"
  dark-surface-raised: "#262626"
  dark-surface-sunken: "#0A0A0A"
  dark-wash: "#1F1F1F"
  dark-ink: "#F8F7EF"
  dark-ink-soft: "#CFCFCF"
  dark-grey: "#A0A0A0"
  dark-ink-disabled: "#5C5C5C"
  dark-rule: "rgba(248, 247, 239, 0.10)"
  dark-rule-strong: "rgba(248, 247, 239, 0.18)"
  dark-edge: "#8F8F8F"
  dark-focus: "#4A90FF"
  dark-ready: "#4FB07A"
  dark-ready-wash: "#0F2419"
  dark-ready-ink: "#8FD9AF"
  dark-hold: "#6BA8D6"
  dark-hold-wash: "#0D1D2A"
  dark-hold-ink: "#A9CFEA"
  dark-peak-wash: "#1F242A"
  dark-peak-ink: "#F8F7EF"
  dark-risk-wash: "#2A0A11"
  dark-risk-ink: "#F2879C"
  dark-glass: "#1B1B1B"
  dark-seal-ink: "#121212"
  dark-glass-edge: "rgba(248, 247, 239, 0.14)"
typography:
  display-family: "Archivo, Arial Black, sans-serif"
  ui-family: "Inter, ui-sans-serif, system-ui, sans-serif"
  mono-family: "Source Code Pro, ui-monospace, SFMono-Regular, monospace"
  micro: { size: "10px", line: 1.4, tracking: "0.06em", role: "non-essential microcopy only" }
  caption: { size: "11px", line: 1.5, tracking: "0.18em", case: "uppercase", weight: 600 }
  ledger: { size: "12px", line: 1.4, role: "dense metadata, timestamps, secondary figures" }
  body-sm: { size: "13px", line: 1.55 }
  control: { size: "14px", line: 1.45, role: "anything you tap, type into, or read inside a table row" }
  body: { size: "15px", line: 1.6 }
  body-lg: { size: "17px", line: 1.5, role: "wine name in a row or card; mobile primary" }
  subheading: { size: "20px", line: 1.4 }
  heading-sm: { size: "27px", line: 1.22 }
  heading: { size: "42px", line: 1.1, tracking: "-0.02em", case: "sentence" }
  display: { size: "72px", line: 1.04, tracking: "-0.025em", case: "sentence" }
rounded:
  sm: "3px"
  md: "4px"
  lg: "6px"
  card: "8px"
  pill: "6px"
spacing:
  3xs: "4px"
  2xs: "2px"
  xs: "8px"
  sm: "14px"
  md: "18px"
  lg: "24px"
  xl: "36px"
  2xl: "48px"
  3xl: "80px"
density:
  compact: { row: "48px", pad-y: "8px", type: "ledger" }
  standard: { row: "64px", pad-y: "14px", type: "control" }
  relaxed: { row: "84px", pad-y: "18px", type: "body-lg" }
layers:
  base: 0
  sticky: 10
  chrome: 20
  drag: 30
  overlay: 40
  dialog: 50
  toast: 60
motion:
  fast: "120ms"
  normal: "200ms"
  slow: "320ms"
  ease-standard: "cubic-bezier(0.2, 0, 0, 1)"
  ease-exit: "cubic-bezier(0.3, 0, 1, 1)"
chrome:
  header: "54px"
  tabbar: "64px"
  fab: "56px"
---

# Terroir — Cellar Index

Supersedes **Terroir — Nocturne** (2026-08-29). Nocturne staged a cellar at
night; the owner's review of the demo design options selected a different
concept for the investor build — **Concept A, the Cellar Index** — built
from a print reference (Fidèle Editions), Shopify's inventory-field
structure, and Uber Eats' image-led identification
(`docs/plans/2026-09-08-demo-design-options/`). This revision replaces
Nocturne's palette and type system outright rather than layering a new hue
over the old one; Nocturne's full text remains in this file's git history.

## Overview

The Cellar Index reads like a printed wine list, not a lacquered bar at
midnight. The ground is paper, not black glass. The structure is ink —
heavy, tight-tracked headings, hairline rows, sharp corners — and exactly
one hue, a printmaker blue, carries every place in the interface that is a
link, a brand mark, an active state, or a thing you are about to press.
Nothing else in the room is coloured.

This is a narrower thesis than Nocturne's, and it should be: Nocturne's
warmth-only-from-photography rule existed to keep a *dark* room honest. A
paper room does not have that problem — paper is warm by nature, so the
discipline here is different. It is not "no warmth anywhere"; it is **one
exact paper, everywhere, and nothing warmer.** The ground, every raised
surface and every wash are the same parchment hue at different lightnesses;
nothing is allowed to drift toward tan, manila or blush. "The paper and
blush law" below proves that mechanically, on every commit.

### The two rooms

**Paper** is the primary room and the one the investor demo ships in: a
sommelier or floor manager reading a wine list off a paper stock. **Ink** is
the same system with the grounds inverted — the working cellar at night, or
simply the phone's own dark-mode preference. Terroir already ships a working
theme toggle, so both rooms are specified in full; a viewer who has never
touched the toggle and one who has must see the same room.

Ink is not merely "Paper, inverted colours." It keeps Paper's exact hue
discipline — one blue, structural ink, no second colour — and swaps which
extreme plays which role: the ground becomes true ink black, the ink becomes
paper white, and the blue itself has to lighten, because Paper's `#1664EB`
measures under 4:1 on a near-black ground, and a link you can technically
find but not comfortably read is not a passing link.

## Colours

### Ground and ink

Five grounds, ascending lightness: `surface-sunken`, `wash`, `surface-raised`,
`canvas`, `surface` on Paper; the same five names, same ascending order, on
Ink, inverted. Three inks: `ink` for anything that must be read, `ink-soft`
for supporting prose, `grey` for metadata. Nothing else carries text.

`canvas` is the page — `#F8F7EF`, a single named paper. `surface` is the
brightest register, true white, for anything that sits *on* the page and
needs to read as its own sheet: an input field, a bottom sheet, a dialog.
`surface-raised` and `surface-sunken` are hover and pressed states, both
still inside the paper family, a few points either side of `canvas`. `wash`
is the palest of the five, used for table headers and quiet section
backgrounds.

Ink runs the same shape, cold: `dark-canvas` and its neighbours are a true
neutral black-to-charcoal ramp (`#121212` → `#262626`), with no hue at all —
equal red, green and blue channels on every one of them, the simplest
possible way to guarantee none of them can drift warm.

### The one colour — printmaker blue

Blue is the only hue with a job. `#1664EB` on Paper, lightened to `#4A90FF`
on Ink, it is the brand mark, the link colour, the "you are here" indicator
and the focus ring — in both rooms, at once. That collapse is deliberate.
Nocturne kept its accent role achromatic because its one hue, claret, was
overloaded across brand, primary action, urgent status and destructive
action, and a colour doing four unrelated jobs stops meaning any of them.
The Cellar Index's blue only ever does one *kind* of job — *this is where
you can act, and this is where you are* — so brand, link, active tab and
focus ring sharing a value is not overload, it is one meaning worn four ways.

**The primary button is not blue.** It is the highest-contrast neutral in
the room: an ink fill (`ink` on Paper, `dark-ink` on Ink) with the opposite
room's paper tone as its label — `#121212` on `#F8F7EF`, 17.43:1, in either
direction. This is the board's own convention ("Record a pour", "Save
count"), and it matters for the reason it mattered in Nocturne: the colour
that means "you can act here" everywhere else in the interface should not
also be the colour of the one button that means "this is the primary action,
right now." Keeping them apart is what lets blue stay quiet the rest of the
time — `primary` as a fill still needs to clear 3:1 so it is findable
wherever it is used for a secondary emphasis action, which it does at
4.55–5.18:1 on Paper and 4.85–6.34:1 on Ink.

### The mark

The utility that carries the "you are here" meaning is **`mark`**. In
Nocturne this token had to resolve to two different named colours —
champagne at night, claret by day — because champagne measured 1.26:1 on
white and could not survive the light room at all. The Cellar Index has no
such asymmetry: `mark` is `#1664EB` on Paper and `#4A90FF` on Ink, the same
blue already doing brand, link and focus duty, just lightened for the dark
ground. Because it is no longer a special case, `mark` and `dark-mark` are
ordinary scalar keys in the frontmatter above, verified by
`check-design-token-sync.mjs` exactly the way every other colour is — there
is no hand-written exception left for this one token, and no champagne
substitute was invented to fill its place. There is no champagne in this
system, and there does not need to be one.

### Status

Four states, unchanged in hue from the system this document supersedes,
because none of them competes with the brand blue and none of them is a warm
neutral:

| State | Paper ink / wash | Ink ink / wash |
|---|---|---|
| Drink now | `#215C3C` on `#E4F0EA` — 6.75:1 | `#8FD9AF` on `#0F2419` — 9.88:1 |
| Hold | `#22506F` on `#E3EEF6` — 7.29:1 | `#A9CFEA` on `#0D1D2A` — 10.44:1 |
| At peak | `#121212` on `#E8EAEC` — 15.53:1 | `#F8F7EF` on `#1F242A` — 14.54:1 |
| Window risk | `#96122A` on `#F7E4E8` — 7.12:1 | `#F2879C` on `#2A0A11` — 7.58:1 |

"Hold" keeps a muted slate-blue distinct from the brand blue — duller,
darker, never used as a fill the way `primary` is — so a status chip on a
bottle is never mistaken for a link or an active tab. That is a real tension
worth naming rather than hiding: both are, strictly, blue. If a future pass
wants more daylight between them, moving `hold` to a non-blue hue is the
fix; it was out of scope for this migration because the pairing above
already clears 4.5:1 in both rooms and nothing forced the change.

"Window risk" is the only red anywhere in the system, and it is a *status*,
never a brand colour — it does not fill a button, does not mark "you are
here", and does not appear outside the four rows above. That confinement is
what keeps it from re-becoming a second accent the way Nocturne's claret
slid into one.

There is still **no `info` hue.** An informational message takes the "at
peak" achromatic treatment; a fifth colour would dilute the one-hue thesis
to buy nothing.

### The paper and blush law

Two tests, enforced by `scripts/check-design-palette.mjs`, which exits 1 in
CI, plus the source-literal sweep that has run since Nocturne. A ban nobody
can run is a preference.

1. **Any dark neutral must be genuinely neutral.** A colour darker than
   `#404040` with real saturation in the brown-to-yellow wedge (hue 15°–60°)
   is brown, whatever shade of dark it is. Every Ink-room ground in this
   system has equal red, green and blue channels, so this test can only ever
   fire on a *future* addition — which is the point: the rule exists for the
   colour nobody has picked yet, not the ones already here.

2. **A light neutral may only be the one named paper, never a nearby one.**
   Widening Nocturne's old numeric threshold (`r − b ≤ 4`) far enough to
   admit `#F8F7EF` also admits `#F0E8E3` — a salmon-leaning off-white just
   past the old threshold's reach, one this same script's own HSL scan
   already calls cream on its own separate terms. Channel arithmetic cannot
   tell a parchment from a blush at the width these two colours actually
   differ by (nine points of red-minus-blue apart; the widened threshold
   would need fourteen to admit Paper's own ground).

   The replacement is not a wider number, it is a **narrower question**:
   what hue is this actually on? `#F8F7EF` sits at hue ≈ 53°, in the middle
   of the yellow-parchment band. `#F0E8E3` sits at hue ≈ 23°, in the
   orange-blush band — thirty degrees away, further apart in hue than the
   two colours are in any single RGB channel. The new rule tests exactly
   that: a light neutral (lighter than `#C0C0C0`) is allowed only if it is
   either a true grey (no saturation at all) or falls inside the narrow
   parchment window — hue 44°–60°, moderate saturation, high lightness.
   Outside that window, inside the same warm wedge, is exactly where tan,
   manila and blush live, and the rule rejects all three by the same test
   that admits paper.

   Verified against a scratch copy of this script with `#F0E8E3` inserted as
   a token: **rejected** — `F0E8E3: cream/blush — warm light neutral outside
   the paper band (h≈23°)`. The five paper-family tokens actually in this
   palette (`canvas`, `surface-raised`, `surface-sunken`, `wash`, and their
   Ink-room mirrors, where applicable) measure hue 44°–60° and pass.

The same script still reads every colour literal in `src/`, in HSL rather
than by channel, for the reason it always has: brown is a saturated warm
mid-tone, not a dark neutral, so the channel tests alone would wave it
through. A warm hue (15°–60°) too dark to be a colour (L < 0.72) is brown;
one too pale to be a colour (L ≥ 0.80) is cream. Printed menus, the
standalone HTML export and the brand-kit fixtures stay excluded by name,
because those carry the *client's* palette, on paper — a different paper
than this one.

There is no longer a claret rule or a champagne rule. Both existed to keep a
specific named hue from drifting toward its own danger zone (peach for
claret, tan for champagne); the Cellar Index has no claret and no champagne,
so those two tests retire along with the colours they protected, rather than
surviving as dead code guarding nothing.

## The contrast law

Unchanged from the system this document supersedes, because the law was
never about which colours were in the room:

- **Text needs 4.5:1** against the ground it actually sits on — which for a
  row means `surface-raised`, not `canvas`, because rows get hovered.
- **A control's boundary needs 3:1.** A control you cannot see is a control
  you cannot find.
- **A focus indicator needs 3:1 and must be solid.** No alpha.
- **A fill needs 3:1 against its ground** before you worry about the label
  on it.

### Load-bearing lines versus decorative rules

The same split as before, and the same test:

> **Set the line to `transparent` in DevTools. If any control, state, hit
> area, data mark or relationship becomes ambiguous, it is load-bearing. If
> nothing operational changes, it is decorative.**

- **`rule` / `dark-rule`** — decorative, alpha ink on paper
  (`rgba(18, 18, 18, 0.12)`) or alpha paper on ink
  (`rgba(248, 247, 239, 0.10)`). Row dividers, keylines a card's own surface
  already defines. Exempt under WCAG 1.4.11: forcing a hairline to 3:1 on a
  near-black ground needs an alpha high enough to read as a solid stroke,
  which is not a hairline any more, it is scaffolding.
- **`edge` / `dark-edge`** — load-bearing, solid, never alpha: `#7A7A7A` on
  Paper (3.78–4.29:1 across the five grounds), `#8F8F8F` on Ink
  (4.68–6.12:1). Input and select boundaries, unchecked checkbox and radio
  outlines, slider tracks, chart strokes, any tap target whose extent is not
  otherwise visible.

### Focus

One focus token, solid, one recipe — `2px solid` at `2px` offset, on
`:focus-visible` only, shipped as `.focus-ring`, unchanged in mechanism from
Nocturne:

- Paper: `focus` `#1664EB` — 4.55–5.18:1 across the five grounds.
- Ink: `dark-focus` `#4A90FF` — 4.85–6.34:1.

Both clear the 3:1 floor with room to spare, because the same value already
has to clear 4.5:1 as text (it is also `accent` and `mark`); a focus ring
was never going to be the binding constraint here.

`.focus-ring-inset` is unchanged — the negative-offset variant for a control
clipped by an `overflow: hidden` ancestor, such as a segmented control or a
stepper.

The codebase's two competing focus idioms recorded in the prior revision — an
outline, and `focus:ring-2 focus:ring-accent/25` at a measured 1.5–1.6:1 —
are a code-level migration this document does not resolve on its own; the
outstanding call sites still need moving to the outline.

## Typography

Archivo for display, headings and wine names. Inter for everything you
operate. Source Code Pro for bin codes.

This reverses a call Nocturne made on purpose: the previous revision retired
Archivo, alongside Bodoni Moda and Courier Prime, because a Didone's thin
hairlines irradiate on a near-black ground, and Archivo did not fit the
Source-family superfamily Nocturne was built around. Neither objection
applies here. The Cellar Index is a paper-primary system — irradiation is a
dark-ground problem — and it is not trying to be one superfamily drawn by
one foundry; it is trying to be a heavy, tight-tracked grotesque for
headings paired with a clean operational sans, which is exactly what a
print-index reference calls for. Archivo carries real weight range and
tightens well at large sizes; Inter is the safest well-hinted grotesque at
13–14px on a phone screen, which is most of what this app actually renders.

The Tailwind utility for the display face is still spelled `font-serif`,
inherited from `check-design-token-sync.mjs`'s fixed name mapping
(`display` → `--font-serif`). It is a stable identifier, not a claim about
the letterform — the same way `primary` stayed `primary` when its value
moved from claret to blue. Renaming it would mean auditing every existing
`font-serif` class reference across the codebase, which is not this
revision's job.

Heading and display tracking tightened from Nocturne's `-0.01em` /
`-0.015em` to `-0.02em` / `-0.025em` — "big, heavy, tight-tracked" is a
stated character of this concept, and Archivo's counters are open enough to
take the extra pull without the letterforms colliding.

**There is no signature face.** Ephesis is dropped outright, not replaced —
Concept A has no signature, no script flourish, nothing that reads as a
brand mark drawn by hand. The `signature` type role and its `--font-signature`
CSS variable are removed along with it, rather than left pointing at a
fallback nobody chose.

The rest of the scale — sizes, the `control` / `ledger` / `caption` roles,
the `tabular-nums` rule for prices and counts, the bypass-baseline
enforcement in `check-design-typography.mjs` — is unchanged. None of it was
about the typeface; it was about which *token* a size belongs to, and that
argument does not change when the token's font does.

### Enforcement

Unchanged mechanism:

- `check-design-token-sync.mjs` — DESIGN.md frontmatter and the CSS `@theme`
  block must agree, including the font-family heads.
- `check-design-typography.mjs` — no arbitrary `text-[…]`, no inline
  `fontSize`, no `font-mono` outside the code roles, off a fingerprinted
  baseline that can only shrink.
- `check-design-contrast.mjs` — computes the WCAG ratio of every pair named
  in this document from the frontmatter itself, now including `mark` as
  text (previously untested; it is the same value as `accent`, so it costs
  nothing to check and closes a real gap in the old contract).
- `check-design-palette.mjs` — the paper and blush law above.
- All four exposed as `pnpm check:design`.

## Spacing, rhythm and density

Unchanged: `2xs` 2, `xs` 8, `sm` 14, `md` 18, `lg` 24, `xl` 36, `2xl` 48,
`3xl` 80, `3xs` 4. Density tiers (`compact` 48px / `standard` 64px /
`relaxed` 84px) are unchanged. None of this was a colour or type-family
question.

## Rows and columns

The one typed column contract with several renderers, described in the
prior revision, is unchanged in shape. Two rules update for the new
palette:

- Separation is a decorative `rule`, never zebra striping — now alpha ink on
  paper rather than alpha bone on near-black, same reasoning: alternating
  fills produce visible banding, and a hairline reads as structure without
  it.
- Hover is a `surface-raised` fill; selection is `surface-raised` plus a 2px
  **blue** leading edge (`primary` / `dark-primary`), not claret — claret no
  longer exists in this system, and blue is the only hue left to carry a
  selection mark.

## Controls

Unchanged from the prior revision: the stepper, segmented control and
range-slider guidance are about which control exists and where, not about
colour.

Geometry sharpens again with this pass. The first Cellar Index revision only
shrank `sm`/`md`/`lg`/`card` and left `pill` at a full capsule, reasoned as
"the handful of controls where a capsule is the right shape: a search field,
a segmented tab." The board proves that reasoning wrong — Concept A has **no
capsule anywhere.** Its filter tabs are text with a blue underline, not a
pill; its search fields, buttons and the bin badge are all sharp-cornered
rectangles. A 390px screenshot pass against the board confirmed the gap:
every control that had been left on `rounded-pill` — search fields, filter
buttons, date-range chips, the "Create bin" button, section-count chips —
was the single biggest visible deviation from the reference. **Radii shrink
across the board, and `pill` stops being a capsule:**

| Token | Was | Now | Role |
|---|---|---|---|
| `sm` | 6px | **3px** | badges, small chips, the bin badge |
| `md` | 8px | **4px** | buttons, form controls |
| `lg` | 10px | **6px** | tiles, larger inputs |
| `card` | 12px | **8px** | cards, panels, modals |
| `pill` | 999px | **6px** | every control that used to be a lozenge |

`--radius-pill` is used across roughly 144 files in this codebase — search
fields, filter chips, date-range controls, the FAB and primary buttons alike
— almost all of them built on the assumption that the house shape was a
lozenge. Auditing and re-classing 144 call sites individually is not this
revision's job and is not what a token layer is for: redefining the token
itself to 6px sharpens the whole app in one edit, the same way the palette
propagated everywhere when it shipped. `rounded-pill` keeps its name only
because that many call sites already spell it that way; it no longer means
"capsule," it means "small radius," the same value as `--radius-lg`.

**This does not touch genuine circles, and it does create real fallout for a
few that were built on the wrong token.** A mic button, an avatar, a loading
dot — anything that must render as a perfect circle — uses Tailwind's
built-in `rounded-full` directly, which this revision never redefines. But
at least three existing call sites used `rounded-pill` on an equal-width/
equal-height box specifically to *get* a circle rather than a capsule, and
this change turns those into sharp-ish squares instead:
`reconcile-queue-metric.tsx`'s `h-8 w-8` icon roundel, `scan-detail-view.tsx`'s
`h-10 w-10` avatar roundel, and `cellar/loading.tsx`'s `h-8 w-8` skeleton
dot. Each needs `rounded-full` in place of `rounded-pill`, in whichever pass
next touches that file — this token-layer revision documents the fallout
rather than chasing it into files it does not own.

Any control this system adds keeps the standing spec: 44px minimum hit
bounds, a solid `edge` boundary at 3:1, the standard focus outline, and a
disabled treatment using the disabled *tokens* rather than container
opacity.

## Mobile

Unchanged in every number — the 390×844 budget, the chrome tokens, the 44px
touch floor, the bottom-sheet-for-filters rule, the container-query collapse
rule. None of it depended on which colours or fonts filled the tokens.

## Elevation and depth

Three levels, not four — **there is no glass level in the Cellar Index —
and, as of this pass, no shadow level either.**

0. **Ground** — `canvas`. The page.
1. **Card** — `surface`, a solid `rule` border, `card` radius. No shadow.
2. **Raised** — `surface-raised`. Hover and selection. No shadow change.

The prior Cellar Index revision kept `shadow-card` painting a two-layer drop
shadow (`0 1px 2px …, 0 6px 20px …` on Paper) under every card and under
`.glass`, on the reasoning that a card is "separated from the ground" by
rule plus shadow together. The board has no such thing: it is open rows and
flat panels on the paper ground, divided by hairlines, never a white card
floating with a shadow beneath it. **`--t-shadow-card` is now `none` in both
rooms.** A card's only separation from its ground is its solid `rule`
border; `.card-surface` keeps a faint inset top light in Ink
(`--t-card-highlight`, transparent on Paper) as a 1px lighting cue, but that
highlight never lifted anything off the page and is not the shadow being
removed here. `shadow-card` survives as a Tailwind utility name — a handful
of components still pair it with their own border — but it now resolves to
nothing, so the border they already carry is the only depth cue left; no
component file needed to change for this to take effect.

Nocturne's fourth level was a translucent, blurred `backdrop-filter` panel
for floating chrome — the sticky header, drawers, dialogs, toasts. Concept A
explicitly forbids glass and blur: "graphic clarity" and a blurred pane are
opposites. The `.glass` class stays, because sticky chrome still has to sit
above content, but it is now **flattened to an opaque bordered panel, with
no elevation shadow at all** — `glass` (`#FFFFFF` on Paper, `#1B1B1B` on
Ink) with a solid `glass-edge` border and nothing else, since `shadow-card`
resolves to `none`. There is no `@supports backdrop-filter` feature-detection
left in the stylesheet, because nothing left needs it.

`.dawn-gradient` is neutralised rather than deleted, because more than a
dozen files across the app still reference the class name for hero bands
(`/insights`, `/atlas`, `/cellar`, login, invite, password reset). Deleting
the rule would leave those elements with no background at all; instead the
class now resolves to a flat `canvas` fill. Concept A bans decorative
gradients outright — "warmth comes from pictures, never from paint" was
Nocturne's version of the same rule, and it holds here too, just with a
paper ground instead of a black one. The class name surviving as a flat
colour is a known seam, not a disguised fix: those call sites should rename
to whatever the flat-panel utility is once someone is in those files for
another reason.

## Layers

Unchanged: `base` 0 · `sticky` 10 · `chrome` 20 · `drag` 30 · `overlay` 40 ·
`dialog` 50 · `toast` 60.

## State

Unchanged shape, one colour swap:

| State | Ground | Ink | Boundary |
|---|---|---|---|
| Default | `surface` | `ink` | `rule` |
| Hover | `surface-raised` | `ink` | `rule-strong` |
| Pressed | `surface-sunken` | `ink` | `rule-strong` |
| Focus | unchanged | unchanged | `focus`, 2px solid, 2px offset |
| Selected | `surface-raised` | `ink` | 2px **blue** leading edge |
| Disabled | `surface` | `ink-disabled` | `rule` — never container opacity |
| Loading | `surface-sunken` skeleton | — | none, plus a live region |
| Error | `risk-wash` | `risk-ink` | `edge`, plus `aria-invalid` and a linked message |

The three known contract breaches recorded in the prior revision —
unreachable validation state on the desktop scan table, toasts announcing at
the wrong ARIA priority, dirty edits discarded without confirmation — are
code-level bugs, not colour or type questions, and this migration did not
touch them. They are still open.

## Motion

Unchanged: `fast` 120ms, `normal` 200ms, `slow` 320ms, `ease-standard` /
`ease-exit`. `prefers-reduced-motion: reduce` stays wired globally.

## Iconography

Unchanged: Lucide, 16/20/24px grid, two stroke weights (1.75 default, 2.25
active/filled), nothing at 12px, never the sole carrier of meaning.

## Photography

Unchanged in structure — mat, `label`, `bottle`, `plate` — because none of
it was about paint. Photography was always "the one place warmth is
allowed" in Nocturne, and it stays exactly that here: the paper ground and
the ink structure are both cool-neutral-to-parchment, never tinted to match
a label or a wine's colour, so a photograph's warmth reads as the
photograph's, not the interface's.

## Formatting

Unchanged: one formatting module, one restaurant locale, tabular figures,
never a bare `$`, the 100-point score and the 1–5 crowd average always
labelled apart.

## Truncation

Unchanged: anything truncated is reachable in full, and the accessible name
always carries the untruncated text.

## Print

Unchanged: print hides all chrome, drops to the Paper room (which was
already the light room, so "drop to Paper" is the room print always used),
expands truncation, prints tables as tables.

## RTL

Unchanged: not currently viable, new work uses logical properties so it
stays merely unfinished rather than becoming more expensive.

## Do's and don'ts

**Do**

- Keep blue to one job: brand, link, active state, focus, mark — never a
  fifth meaning.
- Let the primary button be ink, not blue — the neutral is the loudest thing
  in the room precisely because nothing else competes with it.
- Match a light neutral to the named paper, or don't call it a neutral.
- Use `edge`, solid, for anything a hand has to find by its boundary.
- Measure the pair before you ship the colour.

**Don't**

- Don't introduce a second colour. If a role feels like it needs one, it
  needs a shade of blue or a shade of ink, not a new hue.
- Don't widen the paper rule's numbers to let a colour in. Ask what hue it
  actually is first.
- Don't put a decorative gradient anywhere. Photography carries warmth;
  paint does not.
- Don't use `rounded-pill` to draw a circle. It is a small sharp radius now,
  the same value as `--radius-lg` — reach for `rounded-full` instead.
- Don't reach for `.glass`'s old blur. It is an opaque panel now.
- Don't set a size in `text-[Npx]`. If the role is missing, add the role.
- Don't add a fifth status colour.
