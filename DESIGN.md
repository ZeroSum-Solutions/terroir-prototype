---
version: alpha
name: Terroir — Claret Cellar
description: The mobile demo made production-ready. A near-black cellar, warm off-white type, muted taupe metadata, claret actions, and warm glass panels. Cormorant names the wine; Manrope operates the room. The authenticated application is dark-first while the guest list remains Bone.
colors:
  primary: "#6E1420"
  primary-hover: "#861A28"
  accent: "#6E1420"
  mark: "#6E1420"
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
  focus: "#6E1420"
  seal-ink: "#F7F2E8"
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
  dark-primary: "#C2303C"
  dark-primary-hover: "#D13A48"
  dark-accent: "#C9868C"
  dark-mark: "#C9868C"
  dark-canvas: "#0E0E0F"
  dark-surface: "#131315"
  dark-surface-raised: "#1B1013"
  dark-surface-sunken: "#090909"
  dark-wash: "#170F10"
  dark-ink: "#EFE8DC"
  dark-ink-soft: "#DED5C6"
  dark-grey: "#B4AA9C"
  dark-ink-disabled: "#756D64"
  dark-rule: "rgba(239, 232, 220, 0.12)"
  dark-rule-strong: "rgba(239, 232, 220, 0.22)"
  dark-edge: "#7A7266"
  dark-focus: "#E3ABAE"
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
  dark-glass: "rgba(239, 232, 220, 0.06)"
  dark-seal-ink: "#F7F2E8"
  dark-glass-edge: "rgba(239, 232, 220, 0.12)"
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
  md: "12px"
  lg: "16px"
  card: "18px"
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

# Terroir — Claret Cellar — Style Reference
> the mobile demo, made coherent and production-ready

**Theme:** dark "Claret Cellar" is the authenticated default (owner's call,
2026-09-13) · light "Bone" remains available in Settings · the guest-facing
list is always Bone

Supersedes **Terroir — Obsidian Glass** (2026-09-08). The owner's approved
`Terroir Mobile Demo.html` is the primary reference lock: `#0E0E0F` canvas,
warm `#EFE8DC` type, `#B4AA9C` metadata, claret controls, softly graded dark
cards, and rounded mobile sheets. The earlier photographic and glass studies
remain secondary references for material and imagery, but no longer own the
action colour. The frontmatter above is the contract;
`scripts/check-design-*.mjs` hold `src/app/globals.css` to it.

Terroir operates in a cellar at night: the ground is neutral near-black
(`#0E0E0F`), with claret allowed to tint a raised surface but never the whole
canvas. **Claret** (`#C2303C` as a fill, `#C9868C` as accessible dark-room
text) identifies action, selection, and the current place. **Warm off-white**
(`#EFE8DC`) carries primary content; muted taupe (`#B4AA9C`) carries metadata.
Type is a display serif for anything named — a wine, a producer, a headline —
and Manrope for everything you operate. Surfaces are warm glass or a subtle
`#16161A → #111113`-like dark grade, with a 1px inset highlight and hairline
edge rather than a heavy shadow.

References: the approved mobile demo (primary); the owner's six supplied
photographs (FILLVOID's copper-and-
bone poster grid; Miolo Testardi Syrah and Merlot Terroir studio bottles;
stacked corks under copper rim light; a wine-intensity glass; the Rolling
Forks Marquette pair), and two Refero Styles systems — Authkit ("frosted
glass cathedral at midnight": pill controls, inset-frost elevation, one
hairline border everywhere) and Vivid+Co ("prismatic light through
obsidian": scale carries hierarchy, weight does not).

## Tokens — Colors

Claret Cellar (dark, authenticated default). Every pair below is measured by
`scripts/check-design-contrast.mjs`, not judged by eye.

| Name | Value | Token | Role |
|------|-------|-------|------|
| Cellar Black | `#0E0E0F` | `--color-canvas` | Page ground. Neutral and almost black, matching the demo |
| Cellar Wall | `#131315` | `--color-surface` | Opaque panel ground where glass cannot be used |
| Raised Claret Wall | `#1B1013` | `--color-surface-raised` | Hovered or selected row, tinted without becoming a red card |
| Vault | `#090909` | `--color-surface-sunken` | Wells, input insets, the ground under a sheet |
| Wash | `#170F10` | `--color-wash` | Very faint claret band behind an eyebrow strip |
| Warm Ink | `#EFE8DC` | `--color-ink` | Primary text, wine names, headline fill |
| Warm Soft | `#DED5C6` | `--color-ink-soft` | Secondary text, lead paragraphs |
| Taupe | `#B4AA9C` | `--color-grey` | Metadata, placeholders, nav labels at rest |
| Taupe Disabled | `#756D64` | `--color-ink-disabled` | Disabled labels only |
| Claret | `#C2303C` | `--color-primary` | Accessible filled action; shade toward demo claret at its lower edge |
| Claret Lit | `#D13A48` | `--color-primary-hover` | Primary hover |
| Claret Ink | `#C9868C` | `--color-accent` `--color-mark` | Links, active tab, selected state, and data emphasis |
| Claret Focus | `#E3ABAE` | `--color-focus` | Solid keyboard focus indicator |
| Hairline | `rgba(239,232,220,0.12)` | `--color-rule` | Decorative row divider. Alpha, exempt from 1.4.11 |
| Hairline Strong | `rgba(239,232,220,0.22)` | `--color-rule-strong` | Section divider, card outline when the card is opaque |
| Edge | `#7A7266` | `--color-edge` | Load-bearing boundary — anything a hand has to find. Solid, 3.6:1, never alpha |
| Glass | `rgba(239,232,220,0.06)` | `--color-glass-white` | Warm glass panel fill, composed with blur in `.glass` |
| Glass Edge | `rgba(239,232,220,0.12)` | `--color-glass-edge` | Warm glass panel hairline |
| Ready | `#8FD9AF` on `#0F2419` | `--color-ready-ink` / `-wash` | Drink now |
| Hold | `#E6C79C` on `#2A2013` | `--color-hold-ink` / `-wash` | Hold — moved from slate blue to a warm amber so nothing in the room is cool |
| At peak | `#F3EDE2` on `#26211D` | `--color-peak-ink` / `-wash` | Achromatic; also the informational treatment |
| Window risk | `#F2879C` on `#2A0A11` | `--color-risk-ink` / `-wash` | Critical status; brighter and cooler than brand claret |

Bone room (light). Canvas `#F1EADB`, surface `#FAF6EC`, ink `#141312`, and
claret darkened to `#6E1420` so it clears 4.5:1 as text on every ground. It
remains the room of the printed list and guest menu and is available as an
explicit authenticated-app preference; it is not the first-visit default.

### The palette law

The Cellar Index banned brown and cream. This system is built from them, so
that law is gone, and its replacement is the inverse: **no cool hue,
anywhere outside semantic status.** Enforced by `scripts/check-design-palette.mjs`:

1. Every ground and ink token (`canvas`, `surface*`, `wash`, `ink*`, `grey`,
   `edge`, `seal-ink`) is either a true neutral, a warm hue, or the narrow
   claret band (335° through 15°). A blue-black or green-grey fails.
2. Every action token (`primary`, `primary-hover`, `accent`, `mark`, `focus`)
   is claret, with dark-room text/focus lightened until it clears contrast.
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
| inputs, form controls | 12px | `--radius-md` |
| tiles, thumbnails | 16px | `--radius-lg` |
| cards, panels | 18px | `--radius-card` |
| buttons, chips, search, the nav dock, segmented controls | 999px | `--radius-pill` |

Cards follow the demo's 18px family; compact controls use 12px, thumbnails
16px, pills remain fully rounded, and bottom sheets use a 28px top radius.
Do not mix radius families on one component type.

### Layout
Page max-width 1200px (`--container-page`), prose 720px. Phone-first: one
column, 16px gutters, the nav dock floating 22px above the safe area, the
header a floating glass pill rather than a bar. Section gap `xl` (36px) on a
phone, `2xl` on desktop. Card padding `md`–`lg`.

## Components

### Glass Panel (`.glass`)
Translucent warm fill `rgba(239,232,220,0.06)` graded toward transparent,
`backdrop-filter: blur(34px) saturate(1.6)`, 1px `glass-edge` border, inset
`0 1px 0 rgba(255,255,255,0.28)` top highlight, inset `0 -1px 0
rgba(0,0,0,0.4)` bottom shade, and a long soft drop `0 30px 60px -30px
rgba(0,0,0,0.9)`. Radius `card`. This is the material of every sheet,
card, dock and header. Where `backdrop-filter` is unsupported the fill
falls back to `surface` at full opacity.

### Card (`.card-surface`)
The same recipe with the blur omitted, for lists that sit on plain
cellar black where there is nothing to blur. Its surface grades subtly from
`surface` toward `surface-sunken`, matching the mobile demo without reading
as a decorative gradient. Same edge, same top highlight.

### Primary Button
Claret fill (`primary`, optionally graded toward the demo's `#6E1420` at
its lower edge), warm `seal-ink` label at
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
Eyebrow + `heading` in the serif with restrained claret emphasis,
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
the colour table. A fifth would weaken the status vocabulary to buy nothing.

### Nav Dock
68px glass pill floating 22px above the safe-area bottom, five items,
22px stroke icons, 11px labels in `grey`; the active item in `accent`
(light claret). Replaces the flush tab bar. There is no floating action button:
creation is a glass circle in the header.

### Header
A 48px glass pill holding the wordmark (serif, 16px, +0.28em, uppercase,
warm ink), a hairline divider, the tenant name at control size, and the role
as a claret seal. A LOCAL seal appears beside it on a local stack — derived from
the connection, never from data.

### Meter
3px track in `rule-strong`, fill graded deep claret → light claret. Body,
tannin, acidity.

## Do's and Don'ts

### Do
- Put every wine name and headline in the serif, and let the italic word
  do the work a colour used to do.
- Let the photograph continue behind a sheet. If the panel hides what is
  behind it, it is not glass — lower the fill or move the panel.
- Use claret for action and selection. Preserve green, amber, neutral and red
  only for their existing semantic status roles.
- Use `edge`, solid, for anything a hand has to find by its boundary.
- Keep the canvas neutral. Claret may tint a raised surface, never the page.
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
| 0 | Cellar Black | `#0E0E0F` | Page ground, full-bleed image bands fade into it |
| 1 | Glass | `rgba(239,232,220,0.06)` + blur | Every panel, sheet, dock, header |
| 2 | Cellar Wall | `#131315` | Opaque fallback panel where blur is unavailable or nothing lies behind |
| 3 | Claret | `#C2303C` | The primary action; light claret marks the active nav item |

## Elevation

Depth is light, not shadow. A panel reads as raised because its top edge
catches a 1px highlight and its bottom edge falls into a 1px shade; the
long, low-alpha drop under it (`0 30px 60px -30px`) only separates it from
an image. Cards on plain cellar black carry no drop at all. A claret radial
glow (`.dawn-gradient`, `rgba(163,35,48,0.22)` fading by 65%) may sit
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

Quick colour reference (Claret Cellar):
- text: `#EFE8DC` · secondary `#DED5C6` · muted `#B4AA9C`
- background: `#0E0E0F` (canvas) · `#131315` (opaque surface)
- glass: `rgba(239,232,220,0.06)` + `blur(34px)` · edge `rgba(239,232,220,0.12)`
- accent: `#C9868C` · primary fill: `#C2303C` with `#F7F2E8` label
- border (load-bearing): `#7A7266` · hairline: `rgba(232,217,191,0.12)`

Example component prompts:
- **Masthead:** 400px image band (a bottle under a single key light) fading
  to `#0E0E0F` by 84%; eyebrow "OSTERIA SCALA · CELLAR · 946 WINES" in
  Manrope 11px +0.18em `#C9868C`; headline in Cormorant Garamond 42px
  line-height 1.0 `#EFE8DC`.
- **Index row:** 40×60 thumbnail radius 16px with `rgba(239,232,220,0.22)`
  border; eyebrow "MIOLO · 2020 · VALE DO S. FRANCISCO" 10px `#B4AA9C`; name
  "Testardi Syrah" Cormorant 22px `#EFE8DC`; "×3" Manrope 17px 600 right;
  bin chip "D2" 10px `#C9868C` in a pill hairline. Rows divided by
  `rgba(239,232,220,0.12)`.
- **Primary button:** 52px pill, fill `linear-gradient(180deg,#C2303C,#6E1420)`,
  label Manrope 15px 600 `#F7F2E8`, inset `0 1px 0 rgba(255,255,255,0.12)`.
- **Nav dock:** 68px glass pill 16px from each side, 22px above the safe
  area; five 22px stroke icons with 11px labels `#B4AA9C`, active `#C9868C`.

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
  --color-canvas: #0e0e0f; --color-surface: #131315; --color-surface-raised: #1b1013;
  --color-ink: #efe8dc; --color-ink-soft: #ded5c6; --color-grey: #b4aa9c;
  --color-accent: #c9868c; --color-primary: #c2303c; --color-seal-ink: #f7f2e8;
  --color-edge: #7a7266; --color-rule: rgba(239, 232, 220, 0.12);
  --color-glass-white: rgba(239, 232, 220, 0.06); --color-glass-edge: rgba(239, 232, 220, 0.12);
  --font-serif: "Cormorant Garamond", Georgia, serif; --font-sans: Manrope, system-ui, sans-serif;
  --radius-sm: 6px; --radius-md: 12px; --radius-lg: 16px; --radius-card: 18px; --radius-pill: 999px;
}
```

### Tailwind v4
The live `@theme inline` block in `src/app/globals.css` is the export; it maps
every token above onto `bg-canvas`, `text-ink`, `border-rule`, `rounded-card`,
`font-serif` and friends, retinted per room by the `--t-*` runtime variables.
