#!/usr/bin/env node
/**
 * DESIGN.md "cold law" gate (Obsidian Glass, 2026-09-08).
 *
 * The Cellar Index banned brown and cream; Obsidian Glass is built from
 * copper and bone, so that law is gone and its inverse is enforced instead:
 * no cool hue anywhere. A blue-black canvas, a slate status chip or a violet
 * focus ring is the way a dark theme quietly stops being this one.
 *
 * Two surfaces are checked, because checking only the frontmatter is how a
 * previous palette survived an entire migration inside one component's
 * inline styles:
 *
 *   1. The DESIGN.md frontmatter palette — grounds, inks and action tokens
 *      must be true neutrals or warm (copper–bone band); status tokens are
 *      exempt by name because they were never neutrals.
 *
 *   2. Every colour literal written into src/ — a saturated cool chromatic
 *      that is not a named token fails, judged in HSL.
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

/** The copper–bone band: orange through yellow. Everything warm in this
 *  system — copper, bone, the amber hold status, the obsidian canvas's faint
 *  warmth — lives here. */
const WARM_MIN = 15;
const WARM_MAX = 60;

/** The cold band: blue through violet. Nothing in the system lives here. */
const COLD_MIN = 190;
const COLD_MAX = 290;

const NEUTRAL_SAT = 0.05;

/** Rule 1 — a ground, ink or action token is a neutral or a warm. */
function warmOrNeutralFault(hex) {
  const { h, s, l } = hsl(hex);
  if (s <= NEUTRAL_SAT) return null; // a true grey/black/white has no hue to be cool with
  if (h >= WARM_MIN && h < WARM_MAX) return null; // copper–bone band
  return `not warm or neutral — hue ${h.toFixed(1)}° is outside the copper–bone band ` +
    `(${WARM_MIN}°–${WARM_MAX}°) with real saturation (l${l.toFixed(2)} s${s.toFixed(2)})`;
}

/** Tokens the rule applies to, by bare name (the dark- twin is checked too).
 *  Status tokens (ready/hold/peak/risk) are semantic hues and exempt. */
const GOVERNED = new Set([
  "canvas", "surface", "surface-raised", "surface-sunken", "wash",
  "ink", "ink-soft", "grey", "ink-disabled", "edge", "seal-ink",
  "primary", "primary-hover", "accent", "mark", "focus",
]);

/* ── 1. The frontmatter palette ────────────────────────────────────── */

const front = readFileSync(join(root, "DESIGN.md"), "utf8").split("---")[1];
const tokens = [...front.matchAll(/^\s*([\w-]+):\s*"#([0-9A-Fa-f]{6})"/gm)].map(
  ([, name, hex]) => ({ name, hex: hex.toUpperCase() }),
);
const palette = new Set(tokens.map((t) => t.hex));

const failures = [];
for (const { name, hex } of tokens) {
  const bare = name.startsWith("dark-") ? name.slice(5) : name;
  if (!GOVERNED.has(bare)) continue;
  const fault = warmOrNeutralFault(hex);
  if (fault) failures.push(`${name} #${hex}: ${fault}`);
}

/* ── 2. Colour literals in the app's own source ────────────────────── */

function coldFault(hex) {
  const { h, s } = hsl(hex);
  if (s <= 0.15) return null; // a tinted neutral is not an accent
  if (h < COLD_MIN || h >= COLD_MAX) return null; // outside the blue–violet band
  return "cold accent — the system has one metal, and it is copper";
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
  if (/\.test\.tsx?$/.test(rel)) continue; // tests carry client-palette fixtures, not the app's own colours
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/#([0-9A-Fa-f]{6})\b/g)) {
    const hex = m[1].toUpperCase();
    scanned++;
    // A colour that IS in the palette is fine wherever it appears; the
    // frontmatter check above already judged it.
    if (palette.has(hex)) continue;
    const fault = coldFault(hex);
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
  `Palette: ${tokens.length} DESIGN.md tokens + ${scanned} source literal(s), no cool hue.`,
);
