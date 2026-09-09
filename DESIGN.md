---
version: alpha
name: Terroir — Obsidian Glass
description: A cellar at night, read through glass. Obsidian ground, copper light, bone display serif, and translucent panels that let the photograph behind them keep breathing. One metal (copper) for everything you can act on, one paper (bone) for the primary fill. Cool hues are banned outright, in every room.
colors:
  primary: "#141312"
  primary-hover: "#2A2724"
  accent: "#8A4419"
  mark: "#8A4419"
  canvas: "#F1EADB"
  surface: "#FAF6EC"
  surface-raised: "#E9E0CC"
  surface-sunken: "#E3D9C3"
  wash: "#EDE5D2"
  ink: "#141312"
  ink-soft: "#3F3A33"
  grey: "#5F584E"
  ink-disabled: "#9C948A"
  rule: "rgba(20, 19, 18, 0.12)"
  rule-strong: "rgba(20, 19, 18, 0.22)"
  edge: "#7A7266"
  focus: "#8A4419"
  seal-ink: "#F3EDE2"
  ready: "#2C774E"
  ready-wash: "#E4F0EA"
  ready-ink: "#215C3C"
  hold: "#A56B2A"
  hold-wash: "#F3E6CF"
  hold-ink: "#6E4512"
  peak-wash: "#E6DFD0"
  peak-ink: "#141312"
  risk-wash: "#F7E4E8"
  risk-ink: "#96122A"
  glass: "rgba(250, 246, 236, 0.72)"
  glass-edge: "rgba(20, 19, 18, 0.14)"
  shadow-card: "rgba(20, 19, 18, 0.12)"
  dark-primary: "#E8D9BF"
  dark-primary-hover: "#F0E3C9"
  dark-accent: "#D48C5A"
  dark-mark: "#D48C5A"
  dark-canvas: "#0B0B0C"
  dark-surface: "#141314"
  dark-surface-raised: "#1D1B1A"
  dark-surface-sunken: "#060606"
  dark-wash: "#171514"
  dark-ink: "#F3EDE2"
  dark-ink-soft: "#C9BFA9"
  dark-grey: "#A39C8C"
  dark-ink-disabled: "#6F695E"
  dark-rule: "rgba(232, 217, 191, 0.12)"
  dark-rule-strong: "rgba(232, 217, 191, 0.22)"
  dark-edge: "#7A7266"
  dark-focus: "#D48C5A"
  dark-ready: "#4FB07A"
  dark-ready-wash: "#0F2419"
  dark-ready-ink: "#8FD9AF"
  dark-hold: "#C99A5B"
  dark-hold-wash: "#2A2013"
  dark-hold-ink: "#E6C79C"
  dark-peak-wash: "#26211D"
  dark-peak-ink: "#F3EDE2"
  dark-risk-wash: "#2A0A11"
  dark-risk-ink: "#F2879C"
  dark-glass: "rgba(255, 255, 255, 0.07)"
  dark-seal-ink: "#0B0B0C"
  dark-glass-edge: "rgba(232, 217, 191, 0.18)"
typography:
  display-family: "Cormorant Garamond, Georgia, Times New Roman, serif"
  ui-family: "Manrope, ui-sans-serif, system-ui, sans-serif"
  mono-family: "Source Code Pro, ui-monospace, SFMono-Regular, monospace"
  micro: { size: "10px", line: 1.4, tracking: "0.06em", role: "non-essential microcopy only" }
  caption: { size: "11px", line: 1.5, tracking: "0.18em", case: "uppercase", weight: 500, role: "eyebrow — the tenant, the section, the room" }
  ledger: { size: "12px", line: 1.4, role: "dense metadata, timestamps, secondary figures" }
  body-sm: { size: "13px", line: 1.55 }
  control: { size: "14px", line: 1.45, role: "anything you tap, type into, or read inside a table row" }
  body: { size: "15px", line: 1.6 }
  body-lg: { size: "17px", line: 1.5, role: "wine name in a row or card; mobile primary — set in the serif" }
  subheading: { size: "20px", line: 1.4 }
  heading-sm: { size: "27px", line: 1.22 }
  heading: { size: "42px", line: 1.1, tracking: "-0.02em", case: "sentence" }
  display: { size: "72px", line: 1.04, tracking: "-0.025em", case: "sentence" }
rounded:
  sm: "6px"
  md: "10px"
  lg: "14px"
  card: "20px"
  pill: "999px"
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

# Terroir — Obsidian Glass — Style Reference
> a cellar at night, read through glass

**Theme:** dark (default) · light room "Bone" for print, daylight and the guest-facing list

Supersedes **Terroir — Cellar Index** (2026-09-08). The Cellar Index put the
list on paper with one printmaker blue. The owner's review of the obsidian
prototype screens (2026-09-08, five artboards, three Gemini audit passes)
selected this direction instead: a near-black canvas with copper light in it,
a bone display serif carrying every wine name, and panels that are genuinely
translucent — the photograph behind a sheet keeps going, softened, rather
than stopping at its edge. The Cellar Index's full text remains in git
history. The frontmatter above is the contract; `scripts/check-design-*.mjs`
hold `src/app/globals.css` to it.

Terroir operates in a cellar at night: the ground is obsidian (`#0B0B0C`),
never blue-black, never brown-black — a neutral so dark that the only colour
in the room comes from light on a bottle. Two things carry colour. **Copper**
(`#D48C5A` on obsidian, `#8A4419` on bone) is the metal: links, the active
tab, the "you are here" mark, focus, the meter fills. **Bone** (`#E8D9BF`)
is the paper: the primary button, the wordmark, the italic word in a
headline. Nothing else in the room is coloured. Type is a display serif for
anything named — a wine, a producer, a headline — and Manrope for everything
you operate. Surfaces are glass: a translucent fill, a 1px inset top
highlight, a hairline edge in bone at low alpha, and the content behind
them blurred, not hidden.

References: the owner's six supplied photographs (FILLVOID's copper-and-
bone poster grid; Miolo Testardi Syrah and Merlot Terroir studio bottles;
stacked corks under copper rim light; a wine-intensity glass; the Rolling
Forks Marquette pair), and two Refero Styles systems — Authkit ("frosted
glass cathedral at midnight": pill controls, inset-frost elevation, one
hairline border everywhere) and Vivid+Co ("prismatic light through
obsidian": scale carries hierarchy, weight does not).

## Tokens — Colors

Obsidian room (default). Every pair below is measured by
`scripts/check-design-contrast.mjs`, not judged by eye.

| Name | Value | Token | Role |
|------|-------|-------|------|
| Obsidian | `#0B0B0C` | `--color-canvas` | Page ground. Neutral: equal-ish channels, no blue cast, no brown cast |
| Cellar Wall | `#141314` | `--color-surface` | Opaque panel ground where glass cannot be used (print, PDF, image-heavy lists) |
| Raised Wall | `#1D1B1A` | `--color-surface-raised` | Hovered or selected row, the lit step |
| Vault | `#060606` | `--color-surface-sunken` | Wells, input insets, the ground under a sheet |
| Wash | `#171514` | `--color-wash` | Very faint warm band — behind an eyebrow strip, never a card |
| Bone Ink | `#F3EDE2` | `--color-ink` | Primary text, wine names, headline fill |
| Bone Soft | `#C9BFA9` | `--color-ink-soft` | Secondary text, lead paragraphs |
| Ash | `#A39C8C` | `--color-grey` | Metadata, placeholders, nav labels at rest (6.3:1 on the raised wall) |
| Ash Disabled | `#6F695E` | `--color-ink-disabled` | Disabled labels only |
| Copper | `#D48C5A` | `--color-accent` `--color-mark` `--color-focus` | The one metal: links, active tab, the mark, focus ring, meter fills |
| Bone | `#E8D9BF` | `--color-primary` | The primary action fill. Label on it is `seal-ink` (`#0B0B0C`) |
| Bone Lit | `#F0E3C9` | `--color-primary-hover` | Primary hover |
| Hairline | `rgba(232,217,191,0.12)` | `--color-rule` | Decorative row divider. Alpha, exempt from 1.4.11 |
| Hairline Strong | `rgba(232,217,191,0.22)` | `--color-rule-strong` | Section divider, card outline when the card is opaque |
| Edge | `#7A7266` | `--color-edge` | Load-bearing boundary — anything a hand has to find. Solid, 3.6:1, never alpha |
| Glass | `rgba(255,255,255,0.07)` | `--color-glass-white` | Glass panel fill, composed with blur in `.glass` |
| Glass Edge | `rgba(232,217,191,0.18)` | `--color-glass-edge` | Glass panel hairline |
| Ready | `#8FD9AF` on `#0F2419` | `--color-ready-ink` / `-wash` | Drink now |
| Hold | `#E6C79C` on `#2A2013` | `--color-hold-ink` / `-wash` | Hold — moved from slate blue to a warm amber so nothing in the room is cool |
| At peak | `#F3EDE2` on `#26211D` | `--color-peak-ink` / `-wash` | Achromatic; also the informational treatment |
| Window risk | `#F2879C` on `#2A0A11` | `--color-risk-ink` / `-wash` | The only red. A status, never a brand colour |

Bone room (light). Same roles, inverted: canvas `#F1EADB`, surface `#FAF6EC`,
ink `#141312`, copper darkened to `#8A4419` so it still clears 4.5:1 as text
on the sunken ground, and the primary fill flips to obsidian with a bone
label. It exists for printed lists, daylight use and the guest menu; it is
not the brand's first face.

### The cold law

The Cellar Index banned brown and cream. This system is built from them, so
that law is gone, and its replacement is the inverse: **no cool hue,
anywhere.** Enforced by `scripts/check-design-palette.mjs`:

1. Every ground and ink token (`canvas`, `surface*`, `wash`, `ink*`, `grey`,
   `edge`, `seal-ink`) is either a true neutral (saturation ≤ 0.05) or a warm
   hue in the copper–bone band (15°–60°). A blue-black or a green-grey fails.
2. Every action token (`primary`, `primary-hover`, `accent`, `mark`, `focus`)
   is copper, bone or obsidian — the same test.
3. No colour literal in `src/` may be a cool chromatic (hue 190°–290°,
   saturation > 0.15) unless it is a named token. The printmaker blue is
   gone; a stray `#1664EB` fails the build.

Status hues are exempt by name (`ready` is green, `risk` is red — they were
never neutrals), and `hold` has been moved to amber so it no longer needs
the exemption.

### The contrast law

Unchanged from the Cellar Index and still measured, not judged:
text 4.5:1 on every ground it can land on (including the raised wall, where
a hovered row sits); the primary fill and the focus ring 3:1; `edge` 3:1 and
solid; status inks 4.5:1 on their washes. Decorative `rule` is alpha and
exempt. Glass fills are alpha and therefore unmeasurable by definition —
which is why text never sits on glass alone: every glass panel composes over
a ground that already passes, and blur does not lower the ratio below what
the ground gives.

## Tokens — Typography

### Cormorant Garamond — the named face
`--font-serif` · **Substitute:** Georgia, Times New Roman ·
**Weights:** 400, 500, 600, italic 400 · **Role:** every proper noun — wine
name, producer, headline, the wordmark — and the italic word inside a
headline ("A cellar beyond *the ordinary*"). Never body copy, never a
control. Authority comes from size (42–72px at line-height 1.0–1.1) and
from the italic, not from weight: 600 is the ceiling and is rare.

### Manrope — the working face
`--font-sans` · **Substitute:** system-ui · **Weights:** 400, 500, 600 ·
**Role:** body, controls, inputs, badges, nav labels, eyebrows. 500 for a
label, 600 for the label on a filled button. Uppercase eyebrows track at
+0.18em; nothing else tracks wider than +0.02em.

### Source Code Pro — identifiers
`--font-mono` · bin codes and identifiers only. Prices, vintages, counts and
percentages are Manrope with `tabular-nums`.

### Type Scale

| Role | Size | Line Height | Letter Spacing | Token |
|------|------|-------------|----------------|-------|
| micro | 10px | 1.4 | 0.06em | `--text-micro` |
| caption | 11px | 1.5 | 0.18em, uppercase, 500 | `--text-caption` |
| ledger | 12px | 1.4 | — | `--text-ledger` |
| body-sm | 13px | 1.55 | — | `--text-body-sm` |
| control | 14px | 1.45 | — | `--text-control` |
| body | 15px | 1.6 | — | `--text-body` |
| body-lg | 17px | 1.5 | — (serif) | `--text-body-lg` |
| subheading | 20px | 1.4 | — (serif) | `--text-subheading` |
| heading-sm | 27px | 1.22 | — (serif) | `--text-heading-sm` |
| heading | 42px | 1.1 | -0.02em (serif) | `--text-heading` |
| display | 72px | 1.04 | -0.025em (serif) | `--text-display` |

The scale is unchanged from the Cellar Index so that no component migrates
a size; only the face behind `body-lg` and above changes. The typography
ratchet (`scripts/check-design-typography.mjs`) still refuses a new
`text-[Npx]`.

## Tokens — Spacing & Shapes

**Base unit:** 4px · **Density:** comfortable

### Spacing Scale
`2xs` 2 · `3xs` 4 · `xs` 8 · `sm` 14 · `md` 18 · `lg` 24 · `xl` 36 ·
`2xl` 48 · `3xl` 80 (`--spacing-*`)

### Border Radius

| Element | Value | Token |
|---------|-------|-------|
| badges, bin chips | 6px | `--radius-sm` |
| inputs, form controls | 10px | `--radius-md` |
| tiles, thumbnails | 14px | `--radius-lg` |
| cards, sheets, panels | 20px | `--radius-card` |
| buttons, chips, search, the nav dock, segmented controls | 999px | `--radius-pill` |

Every interactive element is a pill; every panel is 20px. Do not mix radius
families on one component type.

### Layout
Page max-width 1200px (`--container-page`), prose 720px. Phone-first: one
column, 16px gutters, the nav dock floating 22px above the safe area, the
header a floating glass pill rather than a bar. Section gap `xl` (36px) on a
phone, `2xl` on desktop. Card padding `md`–`lg`.

## Components

### Glass Panel (`.glass`)
Translucent fill `rgba(255,255,255,0.07)` graded to `0.04` at the bottom,
`backdrop-filter: blur(34px) saturate(1.6)`, 1px `glass-edge` border, inset
`0 1px 0 rgba(255,255,255,0.28)` top highlight, inset `0 -1px 0
rgba(0,0,0,0.4)` bottom shade, and a long soft drop `0 30px 60px -30px
rgba(0,0,0,0.9)`. Radius `card`. This is the material of every sheet,
card, dock and header. Where `backdrop-filter` is unsupported the fill
falls back to `surface` at full opacity.

### Card (`.card-surface`)
The same recipe with the blur omitted, for lists that sit on plain
obsidian where there is nothing to blur. Same edge, same top highlight.

### Primary Button
Bone fill (`primary`, graded `#F0E3C9 → #DFCDA9`), `seal-ink` label at
control size, weight 600, 52px tall, radius `pill`, inset `0 1px 0
rgba(255,255,255,0.7)` highlight. One per screen. No drop glow.

### Ghost Button
Transparent, 1px `rgba(232,217,191,0.35)` border, `ink` label at 500,
52px, pill, inset top highlight `0.18`. The secondary action beside a
primary; never filled.

### Search Field
52px pill glass, search glyph in `ink-soft`, placeholder in `grey`. Top of
every authenticated page (GLOBAL-02).

### Eyebrow
`caption` role: 11px, uppercase, +0.18em, 500, in `ink-soft` — or `accent`
when it opens a masthead. The tenant, the section name, a count.

### Masthead
Eyebrow + `heading` in the serif with one italic word in `primary` (bone),
over a 400px image band that fades into the canvas by 84%. The image is a
photograph of light on a bottle, a cork, or a pour — never an illustration,
never text.

### Index Row
Thumbnail 40×60 at radius `lg` with a `glass-edge` border; eyebrow line
(producer · vintage · region) in `grey`; name in the serif at `subheading`;
count at `body-lg` 600 right-aligned; bin chip below it. Rows separate with
`rule`, never a gap.

### Bin Chip
10px, +0.12em, `accent` text, 1px `rgba(232,217,191,0.35)` border, radius
`pill`, 3px 8px padding.

### Status Seal
`caption`-sized uppercase on its wash, radius `pill`. Four states, hues in
the colour table. A fifth would dilute the one-metal thesis to buy nothing.

### Nav Dock
68px glass pill floating 22px above the safe-area bottom, five items,
22px stroke icons, 11px labels in `grey`; the active item in `primary`
(bone). Replaces the flush tab bar. There is no floating action button:
creation is a glass circle in the header.

### Header
A 48px glass pill holding the wordmark (serif, 16px, +0.28em, uppercase,
bone), a hairline divider, the tenant name at control size, and the role as
a bone seal. A LOCAL seal appears beside it on a local stack — derived from
the connection, never from data.

### Meter
3px track in `rule-strong`, fill graded copper → bone. Body, tannin, acidity.

## Do's and Don'ts

### Do
- Put every wine name and headline in the serif, and let the italic word
  do the work a colour used to do.
- Let the photograph continue behind a sheet. If the panel hides what is
  behind it, it is not glass — lower the fill or move the panel.
- Use copper for the thing you can press and bone for the one thing you
  press most. Nothing else is coloured.
- Use `edge`, solid, for anything a hand has to find by its boundary.
- Keep the canvas neutral. Warmth comes from copper light in a photograph,
  never from tinting the black.
- Measure the pair before you ship the colour.

### Don't
- Don't introduce a cool hue. No blue link, no slate chip, no violet focus.
- Don't put a filled button beside another filled button.
- Don't draw a drop-shadow glow under a button; depth is the inset highlight
  and the long soft drop under a panel.
- Don't set text on glass over a photograph without a scrim beneath the
  panel; the ratio is only guaranteed against the ground.
- Don't use an image with text in it as a background. A wine label in a
  photograph is fine; a poster is not.
- Don't draw a status bar, a keyboard or a device frame in a screen.
- Don't set a size in `text-[Npx]`. If the role is missing, add the role.

## Surfaces

| Level | Name | Value | Purpose |
|-------|------|-------|---------|
| 0 | Obsidian | `#0B0B0C` | Page ground, full-bleed image bands fade into it |
| 1 | Glass | `rgba(255,255,255,0.07)` + blur | Every panel, sheet, dock, header |
| 2 | Cellar Wall | `#141314` | Opaque fallback panel where blur is unavailable or nothing lies behind |
| 3 | Bone | `#E8D9BF` | The primary action, the wordmark, the active nav item |

## Elevation

Depth is light, not shadow. A panel reads as raised because its top edge
catches a 1px highlight and its bottom edge falls into a 1px shade; the
long, low-alpha drop under it (`0 30px 60px -30px`) only separates it from
an image. Cards on plain obsidian carry no drop at all. A copper radial
glow (`.dawn-gradient`, `rgba(181,103,47,0.22)` fading by 65%) may sit
behind a panel to give the blur something to catch; it is the only paint in
the system and it is never a linear gradient across a surface.

## Imagery

Photography of light on glass, foil and cork: a bottle on stone under a
single key, corks rim-lit in copper, a pour. Full-bleed, cropped tight,
faded into the canvas by 84% so type never sits on a busy region. Thumbnails
are 2:3 portrait at radius `lg`, never square. The prototype's six reference
photographs live in `public/design-refs/`; they are the owner's supplied
references for the look and are not licensed for production use — replace
them with the venue's own photography before anything ships.

## Layout

Phone first. A floating header pill, a full-bleed masthead band, one search
pill, a chip row, one glass list card, and the nav dock. Desktop keeps the
same components at `--container-page` width with the dock replaced by inline
nav in the header pill. Nothing is edge-to-edge except a photograph.

## Agent Prompt Guide

Quick colour reference (obsidian room):
- text: `#F3EDE2` · secondary `#C9BFA9` · muted `#A39C8C`
- background: `#0B0B0C` (canvas) · `#141314` (opaque surface)
- glass: `rgba(255,255,255,0.07)` + `blur(34px)` · edge `rgba(232,217,191,0.18)`
- accent (copper): `#D48C5A` · primary fill (bone): `#E8D9BF` with `#0B0B0C` label
- border (load-bearing): `#7A7266` · hairline: `rgba(232,217,191,0.12)`

Example component prompts:
- **Masthead:** 400px image band (a bottle under a single key light) fading
  to `#0B0B0C` by 84%; eyebrow "OSTERIA SCALA · CELLAR · 946 WINES" in
  Manrope 11px +0.18em `#D48C5A`; headline in Cormorant Garamond 42px
  line-height 1.0 `#F3EDE2` with the last two words italic in `#E8D9BF`.
- **Index row:** 40×60 thumbnail radius 14px with `rgba(232,217,191,0.22)`
  border; eyebrow "MIOLO · 2020 · VALE DO S. FRANCISCO" 10px `#A39C8C`; name
  "Testardi Syrah" Cormorant 22px `#F3EDE2`; "×3" Manrope 17px 600 right;
  bin chip "D2" 10px `#D48C5A` in a pill hairline. Rows divided by
  `rgba(232,217,191,0.12)`.
- **Primary button:** 52px pill, fill `linear-gradient(180deg,#F0E3C9,#DFCDA9)`,
  label Manrope 15px 600 `#0B0B0C`, inset `0 1px 0 rgba(255,255,255,0.7)`.
- **Nav dock:** 68px glass pill 16px from each side, 22px above the safe
  area; five 22px stroke icons with 11px labels `#A39C8C`, active `#E8D9BF`.

## Motion Philosophy

Restrained. `fast` 120ms for state, `normal` 200ms for reveals, `slow`
320ms for a sheet, all on `ease-standard`. One orchestrated reveal per
screen (the masthead image fading up under the headline); no scattered
micro-interactions, no parallax. Reduced-motion collapses everything to 0ms.

## Similar Brands
- **Authkit** (Refero Styles) — frosted glass at midnight: pill controls,
  inset-frost elevation, one hairline border, one accent.
- **Vivid+Co** (Refero Styles) — obsidian canvas where scale carries
  hierarchy at weight 400 and the only chroma lives in the artwork.
- **FILLVOID** — the copper-light-on-black poster language behind the
  masthead crops.

## Quick Start

### CSS Custom Properties
```css
:root {
  --color-canvas: #0b0b0c; --color-surface: #141314; --color-surface-raised: #1d1b1a;
  --color-ink: #f3ede2; --color-ink-soft: #c9bfa9; --color-grey: #a39c8c;
  --color-accent: #d48c5a; --color-primary: #e8d9bf; --color-seal-ink: #0b0b0c;
  --color-edge: #7a7266; --color-rule: rgba(232, 217, 191, 0.12);
  --color-glass-white: rgba(255, 255, 255, 0.07); --color-glass-edge: rgba(232, 217, 191, 0.18);
  --font-serif: "Cormorant Garamond", Georgia, serif; --font-sans: Manrope, system-ui, sans-serif;
  --radius-sm: 6px; --radius-md: 10px; --radius-lg: 14px; --radius-card: 20px; --radius-pill: 999px;
}
```

### Tailwind v4
The live `@theme inline` block in `src/app/globals.css` is the export; it maps
every token above onto `bg-canvas`, `text-ink`, `border-rule`, `rounded-card`,
`font-serif` and friends, retinted per room by the `--t-*` runtime variables.
