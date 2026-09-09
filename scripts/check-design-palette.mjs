#!/usr/bin/env node
/**
 * DESIGN.md "paper and blush law" gate.
 *
 * Nocturne banned brown in prose and then drifted into it anyway, because a
 * ban nobody can run is a preference. The Cellar Index revision replaces
 * Nocturne's claret/champagne-specific rules with two general, hue-based
 * tests — there is no brand red or brand gold left in this palette to carve
 * out special cases for, so the two rules below are the whole law.
 *
 * Two surfaces are checked, because checking only the frontmatter is how a
 * Nocturne-era brown (#8B6914) and cream (#E3D9CB) survived an entire
 * palette migration inside one component's inline styles:
 *
 *   1. The DESIGN.md frontmatter palette, against the two rules in
 *      § "The paper and blush law".
 *
 *   2. Every colour literal written into src/. Channel tests are the wrong
 *      instrument here — #8B6914 is neither a dark neutral nor a light one,
 *      it is a saturated warm mid-tone — so this surface is judged in HSL,
 *      which is how "brown" and "cream" are actually defined: a warm hue
 *      that is either too dark or too pale to be a colour in its own right.
 *
 * Exit 1 on any violation so CI can hold the line.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Surfaces that are deliberately not the app's own room:
 *  - printed menus and the standalone HTML export are the CLIENT's artefact,
 *    on paper, with the client's own palette;
 *  - the brand-kit feature exists to ingest arbitrary client colours, and its
 *    fixtures are input data, not Terroir's palette;
 *  - tests carry those same fixtures.
 */
const NOT_THE_APP = [
  "src/lib/wine-list/",
  "src/lib/branding/",
  "src/app/list/",
  "src/app/api/brand-kit/",
  "src/test/",
  "src/app/globals.css", // the token layer itself, checked via DESIGN.md
];

function hsl(hex) {
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  if (d === 0) return { h: 0, s: 0, l }; // a true grey has no hue to judge
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) h = 60 * (((g - b) / d + 6) % 6);
  else if (max === g) h = 60 * ((b - r) / d + 2);
  else h = 60 * ((r - g) / d + 4);
  return { h, s, l };
}

/**
 * The brown-to-yellow danger wedge. Brown and its light-mode twin, cream, are
 * both warm hues in this band — orange through yellow — at the wrong
 * lightness. Anything outside the wedge (blue, green, red, magenta, at any
 * lightness) was never a brown/cream risk in the first place, whatever its
 * channel values look like — a saturated dark red is a maroon, not a brown,
 * and a pale pink status wash is not a cream.
 */
const WEDGE_MIN = 15;
const WEDGE_MAX = 60;

/**
 * The one warm shape this palette allows: parchment paper. Narrower than the
 * wedge on both sides, and named after the one colour it exists to describe
 * (DESIGN.md — "canvas" is #F8F7EF, hue ~53°). A hue outside this window but
 * still inside the wedge — tan, manila, blush — is rejected by the same test
 * that admits paper, rather than by a numeric channel threshold that has no
 * way to tell them apart at the widths they actually differ by.
 */
const PAPER_HUE_MIN = 44;
const PAPER_HUE_MAX = 60;
const PAPER_SAT_MAX = 0.45;
const PAPER_LIGHT_MIN = 0.85;

/** Rule 1 — a dark neutral must not be warm. Brown is a dark, warm, at-least-
 *  somewhat-saturated colour; this rejects anything in the wedge with real
 *  saturation, regardless of exactly how dark or how saturated. */
function darkNeutralFault(hex) {
  const { h, s, l } = hsl(hex);
  if (s <= 0.05) return null; // a true grey/black has no hue to be brown with
  if (h < WEDGE_MIN || h >= WEDGE_MAX) return null; // not the brown wedge at all
  return `dark neutral is brown — hue ${h.toFixed(1)}° is in the brown wedge ` +
    `(15°–60°) with real saturation (l${l.toFixed(2)} s${s.toFixed(2)})`;
}

/** Rule 2 — a light neutral must be the one named paper, or no hue at all.
 *  Cream, tan and blush are all warm hues in the same wedge as brown, just
 *  pale instead of dark; only the narrow parchment window is exempt. */
function lightNeutralFault(hex) {
  const { h, s, l } = hsl(hex);
  if (s <= 0.05) return null; // true white/grey — never a cream risk
  if (h < WEDGE_MIN || h >= WEDGE_MAX) return null; // not the brown/cream wedge
  if (h >= PAPER_HUE_MIN && h <= PAPER_HUE_MAX && s <= PAPER_SAT_MAX && l >= PAPER_LIGHT_MIN) {
    return null; // inside the parchment window
  }
  return (
    `light neutral is cream/blush — hue ${h.toFixed(1)}° is in the warm wedge ` +
    `but outside the paper band (${PAPER_HUE_MIN}°–${PAPER_HUE_MAX}°, ` +
    `s<=${PAPER_SAT_MAX}, l>=${PAPER_LIGHT_MIN}); got s${s.toFixed(2)} l${l.toFixed(2)}`
  );
}

/* ── 1. The frontmatter palette ────────────────────────────────────── */

const front = readFileSync(join(root, "DESIGN.md"), "utf8").split("---")[1];
const tokens = [...front.matchAll(/^\s*([\w-]+):\s*"#([0-9A-Fa-f]{6})"/gm)].map(
  ([, name, hex]) => ({ name, hex: hex.toUpperCase() }),
);
const palette = new Set(tokens.map((t) => t.hex));

const failures = [];
for (const { name, hex } of tokens) {
  const r = parseInt(hex.slice(0, 2), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminous = Math.max(r, parseInt(hex.slice(2, 4), 16), b);

  if (luminous < 0x40) {
    const fault = darkNeutralFault(hex);
    if (fault) failures.push(`${name} #${hex}: ${fault}`);
  } else if (luminous > 0xc0) {
    const fault = lightNeutralFault(hex);
    if (fault) failures.push(`${name} #${hex}: ${fault}`);
  }
}

/* ── 2. Colour literals in the app's own source ────────────────────── */

function warmFault(hex) {
  const { h, s, l } = hsl(hex);
  if (s <= 0.05) return null; // a neutral grey is not a brown
  if (h < 15 || h >= 60) return null; // outside the orange–yellow wedge
  if (l < 0.72 && s > 0.15) return "brown — a warm hue this dark is brown, whatever it is called";
  if (l >= 0.8) return "cream — a warm hue this pale is cream, whatever it is called";
  return null;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|css)$/.test(entry)) out.push(full);
  }
  return out;
}

let scanned = 0;
for (const file of walk(join(root, "src"))) {
  const rel = relative(root, file).split("\\").join("/");
  if (NOT_THE_APP.some((prefix) => rel.startsWith(prefix))) continue;
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/#([0-9A-Fa-f]{6})\b/g)) {
    const hex = m[1].toUpperCase();
    scanned++;
    // A colour that IS in the palette is fine wherever it appears; the
    // frontmatter check above already judged it.
    if (palette.has(hex)) continue;
    const fault = warmFault(hex);
    if (fault) {
      const line = text.slice(0, m.index).split("\n").length;
      failures.push(`${rel}:${line} #${hex}: ${fault}`);
    }
  }
}

if (failures.length) {
  console.error(`Palette: ${failures.length} violation(s)\n` + failures.map((f) => `  ${f}`).join("\n"));
  process.exit(1);
}
console.log(
  `Palette: ${tokens.length} DESIGN.md tokens + ${scanned} source literal(s), no brown, no cream.`,
);
