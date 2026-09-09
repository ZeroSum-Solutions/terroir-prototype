#!/usr/bin/env node
/**
 * scripts/local/seed-demo-real-inventory.mjs
 *
 * Give the 696 REAL, photographed wines in the LOCAL SEED - Osteria Scala
 * demo tenant stock, bins and metadata, so the investor demo can run on
 * real bottles with real photography instead of the 250 synthetic
 * "Lot NNN" wines that already carry the tenant's original inventory.
 *
 * Local-only, additive-and-backfill-only:
 *   - Never touches the 250 synthetic wines or their 400 inventory rows.
 *   - Only WRITES a wine's colour/region/country when that column is
 *     currently NULL (COALESCE-guarded in the SQL itself, not just in this
 *     script's bookkeeping) -- it can never clobber a value someone set by
 *     hand or a future importer sets some other way.
 *   - Only assigns bin_id to inventory rows that currently have none.
 *   - Creates exactly one new inventory_items row per target wine, keyed by
 *     a deterministic id derived from (restaurant_id, wine_id) so a re-run
 *     upserts the SAME row instead of adding a second one.
 *   - Bin ids are likewise deterministic, derived from (restaurant_id,
 *     zone, index), so re-running never creates duplicate bins either.
 *
 * Conventions reused from the existing local seeders (read before editing):
 *   - scripts/local/seed-local.mjs        -- --confirm gate, spawns
 *     assert-local-db.sh as a subprocess for a non-bash caller.
 *   - scripts/seed-local-operational.ts   -- dry-run-by-default, deterministic
 *     `uuid(prefix, index)` ids so re-seeding upserts in place.
 *   - scripts/local/relink-demo-identities.sh -- psql + heredoc SQL,
 *     LOCAL_SUPABASE_DB_URL with the same hardcoded local default, dry run
 *     prints a plan and exits before writing anything.
 *   - scripts/local/wine-sections.mjs     -- the ONE colour -> cellar
 *     section mapping every seeder files wines under; imported here rather
 *     than re-invented, including for wines whose colour stays NULL (its
 *     documented default branch is reused as this script's own fallback).
 *   - supabase/migrations/0135_identity_resolution_on_write.sql -- this
 *     script writes `wines` directly, so it must call the idempotent
 *     `backfill_wine_identity(uuid)` repair function afterwards, exactly as
 *     scripts/seed-local-supabase.mjs does.
 *
 * Deliberate deviation from those scripts, per this task's hard safety
 * rules: this script NEVER reads, sources, or loads .env.local, even though
 * every sibling local seeder does (`dotenv.config({ path: ".env.local" })`).
 * It requires NEXT_PUBLIC_SUPABASE_URL to already be exported in the
 * process environment (for assert-local-db.sh's sake) and talks to Postgres
 * directly via `psql` -- there is no service-role key or REST round trip
 * anywhere in this file. Get the local URL without touching .env.local:
 *
 *   export NEXT_PUBLIC_SUPABASE_URL=$(npx supabase status -o json \
 *     | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).API_URL")
 *
 * Also opens ~12 bottles on a curated set of the real, recognizable wines
 * (Bollinger, Giacomo Conterno, Emidio Pepe, etc. -- see OPEN_BOTTLE_PICKS
 * below) so /cellar/reconcile shows real names instead of the tenant's
 * synthetic "Lot NNN" wines, which are the only ones its 18 pre-existing
 * "By the Glass" wine_list_items rows point at. Each pick gets both a
 * wine_list_items row (glass_pour_ml set) and an open_bottles row --
 * list_open_bottle_items (migration 0017) requires both -- and its sealed
 * inventory_items.quantity is decremented by one to stay consistent, the
 * same accounting record_pour() itself does when it opens a bottle.
 *
 * Usage:
 *   node scripts/local/seed-demo-real-inventory.mjs             # dry run
 *   node scripts/local/seed-demo-real-inventory.mjs --confirm   # write
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SECTION_NAMES, sectionNameFor } from "./wine-sections.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

// Hardcoded, not read from argv/env -- this script is not allowed to
// operate on any other tenant. See requirement #3 in the task brief.
const RESTAURANT_ID = "de100000-0000-4000-8000-000000000001";
const RESTAURANT_NAME_EXPECTED = "LOCAL SEED - Osteria Scala";

const PSQL_BIN = "/opt/homebrew/opt/postgresql@16/bin/psql";
const CONFIRM = process.argv.slice(2).includes("--confirm");

// A field separator that will never appear in wine names/producers.
const SEP = "";

// ---------------------------------------------------------------------------
// SAFETY GATES -- both must pass before a single query runs.
// ---------------------------------------------------------------------------

function assertLocalApiTarget() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    console.error(
      "seed-demo-real-inventory: refusing to run -- NEXT_PUBLIC_SUPABASE_URL is " +
        "not set in the environment.\n" +
        "This script never reads .env.local itself (hard rule for this task). Export " +
        "the local API URL yourself first, e.g.:\n" +
        "  export NEXT_PUBLIC_SUPABASE_URL=$(npx supabase status -o json | " +
        "node -pe \"JSON.parse(require('fs').readFileSync(0,'utf8')).API_URL\")",
    );
    process.exit(1);
  }
  try {
    execFileSync("bash", [path.join(__dirname, "assert-local-db.sh")], {
      cwd: REPO_ROOT,
      stdio: "inherit",
      env: process.env,
    });
  } catch {
    console.error(
      "seed-demo-real-inventory: aborting -- assert-local-db.sh refused the target.",
    );
    process.exit(1);
  }
}

// Same loopback allow-list as src/test/live-db-target.ts's isLoopbackDbUrl,
// ported inline: that module is TypeScript, this is a plain .mjs script
// with no ts-node/tsx in its own runtime path. Behaviourally identical on
// purpose -- an allow-list of loopback hostnames, not a deny-list.
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1"]);
function isLoopbackDbUrl(rawUrl) {
  let hostname;
  try {
    hostname = new URL(rawUrl).hostname;
  } catch {
    return false;
  }
  return LOOPBACK_HOSTNAMES.has(hostname.replace(/^\[|\]$/g, ""));
}

// Same default as scripts/local/relink-demo-identities.sh.
const DB_URL =
  process.env.LOCAL_SUPABASE_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:57322/postgres";

function assertLocalDbTarget() {
  if (!isLoopbackDbUrl(DB_URL)) {
    console.error(
      `seed-demo-real-inventory: REFUSING -- DB_URL is not loopback (${DB_URL}). ` +
        "This script may only touch 127.0.0.1/localhost/::1.",
    );
    process.exit(1);
  }
}

assertLocalApiTarget();
assertLocalDbTarget();

// ---------------------------------------------------------------------------
// psql helpers
// ---------------------------------------------------------------------------

/** Run a read query, return parsed rows (array of string arrays). */
function psqlRows(sql) {
  const out = execFileSync(
    PSQL_BIN,
    [DB_URL, "-X", "-q", "-t", "-A", "-F", SEP, "-v", "ON_ERROR_STOP=1"],
    { input: sql, encoding: "utf8" },
  );
  return out
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.length > 0)
    .map((line) => line.split(SEP));
}

/** Run a write/verify script, streaming psql's own (human-readable) output. */
function psqlExec(sql) {
  execFileSync(PSQL_BIN, [DB_URL, "-v", "ON_ERROR_STOP=1"], {
    input: sql,
    stdio: ["pipe", "inherit", "inherit"],
  });
}

// ---------------------------------------------------------------------------
// Text normalization for name/producer inference
// ---------------------------------------------------------------------------

function normalizeText(s) {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .toLowerCase()
    .replace(/['’]/g, "") // drop apostrophes (join letters: d'Abruzzo -> dabruzzo)
    .replace(/[^a-z0-9]+/g, " ") // any other punctuation/hyphen -> space
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// COLOUR INFERENCE
//
// Conservative policy (AGENTS.md: "a wrong value is worse than a missing
// one"): a wine's colour is set ONLY when its name/producer carries a clear,
// checkable signal -- an explicit style word, a single-colour grape, or an
// appellation that is single-colour (or overwhelmingly so) by law or by
// convention. Appellations that are genuinely mixed-colour in real life are
// deliberately left OUT of this table even though they're common in this
// cellar -- e.g. Chassagne-Montrachet is excluded on purpose: this exact
// dataset contains "Génot-Boulanger Chassagne-Montrachet 1er Cru Clos
// Saint-Jean", and Clos Saint-Jean is one of Chassagne's best-known RED
// sites, so a blanket "Montrachet family -> white" rule would misfire on
// our own data. Same reasoning excludes bare Beaune, Savigny-lès-Beaune,
// Marsannay and Saint-Aubin (all meaningfully multi-colour appellations).
// Anything that matches nothing below is left NULL -- never defaulted to
// red. Evaluated against `hay` = normalizeText(name + " " + producer).
// ---------------------------------------------------------------------------

const CHAMPAGNE_HOUSES = new Set([
  "agrapart",
  "aurelien lurquin",
  "billecart salmon",
  "bollinger",
  "chartogne taillet",
  "claude cazals",
  "crete chamberlin",
  "dom perignon",
  "egly ouriet",
  "emmanuel brochet",
  "emilien feneuil",
  "etienne calsac",
  "jacques selosse",
  "laherte freres",
  "larmandier bernier",
  "louis roederer",
  "marie courtin",
  "mousse fils",
  "olivier horiot",
  "pascal doquet",
  "philipponnat",
  "pierre baillette",
  "pierre peters",
  "pol roger",
  "savart",
  "suenen",
  "ulysse collin",
  "vincent couche",
  "vouette et sorbee",
]);

// Appellations that are single-colour (or so overwhelmingly one colour that
// a named, single-vineyard bottling is never the exception) by the real
// AOC/DOC/DOCG rule named in each comment -- not a guess.
const APPELLATION_COLOUR_RULES = [
  [/\bmeursault\b/, "white"], // Meursault AOC is white-only in practice.
  [/\bchablis\b/, "white"], // Chablis AOC is white-only (Chardonnay).
  [/\bsancerre\b/, "white"], // Mixed in reality; explicitly given as a signal in this task's own brief.
  [/\bmuscadet\b/, "white"], // Muscadet AOC is white-only (Melon de Bourgogne).
  [/\bmusigny\b/, "red"], // Musigny AND Chambolle-Musigny -- both red-only AOCs (Vogüé's ultra-rare "Musigny Blanc" exception isn't in this cellar).
  [/\bchambertin\b/, "red"], // Chambertin, Gevrey-, Charmes-, Griotte-, Latricières-Chambertin -- all red-only grand crus/AOC. (Cost tiering, below, separately prices grand cru vs. village Gevrey-Chambertin -- that split is about prestige/price, not colour, so it's NOT repeated here.)
  [/\bclos de vougeot\b/, "red"], // Grand Cru, red-only.
  [/\bechezeaux\b/, "red"], // Grand Cru, red-only.
  [/\bclos de la roche\b/, "red"], // Grand Cru, red-only.
  [/\bclos de tart\b/, "red"], // Monopole Grand Cru, red-only.
  [/\bvolnay\b/, "red"], // Volnay AOC is red-only by law.
  [/\bpommard\b/, "red"], // Pommard AOC is red-only by law.
  [/\bnuits saint georges\b/, "red"], // Nuits-Saint-Georges AOC is effectively red-only.
  [/\bvosne romanee\b/, "red"], // Vosne-Romanée AOC is red-only.
  [/\bfixin\b/, "red"], // Fixin AOC is almost entirely red.
  [/\bmorey saint denis\b/, "red"], // Morey-Saint-Denis AOC is predominantly red.
  [/\bcote de nuits villages\b/, "red"], // Côte de Nuits-Villages is predominantly red.
  [/\bfleurie\b/, "red"], // Beaujolais cru, Gamay, red-only.
  [/\bmoulin a vent\b/, "red"], // Beaujolais cru, Gamay, red-only.
  [/\bchinon\b/, "red"], // Chinon AOC is predominantly red (Cabernet Franc); no rosé/blanc word present here.
  [/\bcornas\b/, "red"], // Cornas AOC is red-only (Syrah).
  [/\bcote rotie\b/, "red"], // Côte-Rôtie AOC is red-only.
  [/\bcrozes hermitage\b/, "red"], // Crozes-Hermitage is predominantly red.
  [/\bpauillac\b/, "red"], // Pauillac AOC is red-only (Bordeaux left bank).
  [/\bhaut medoc\b/, "red"], // Haut-Médoc AOC is red-only.
  [/\bcarema\b/, "red"], // Carema DOC (Nebbiolo) is red-only -- catches Ferrando's "White Label"/"Black Label" bottling-name trap.
  [/\bbarolo\b/, "red"], // Barolo DOCG, red-only (Nebbiolo).
  [/\bbarbaresco\b/, "red"], // Barbaresco DOCG, red-only (Nebbiolo).
  [/\bbrunello\b/, "red"], // Brunello di Montalcino DOCG, red-only (Sangiovese Grosso).
  [/\bamarone\b/, "red"], // Amarone della Valpolicella, red-only.
  [/\bvalpolicella\b/, "red"], // Valpolicella DOC, red-only.
  [/\bchianti\b/, "red"], // Chianti / Chianti Classico DOCG, red-only.
  [/\bmontepulciano dabruzzo\b/, "red"], // Montepulciano d'Abruzzo DOC, red-only (the rosé form is Cerasuolo, handled separately above).

  // Proprietary cuvée names, not appellations. These three carry no
  // appellation word at all, so every rule above misses them and they fell
  // through to NULL — visible on a photo-led cellar page as a missing colour
  // dot beside 432 wines that have one. Each is red beyond argument, and each
  // pattern is specific enough that it cannot catch anything else.
  [/\b(soldera|case basse)\b/, "red"], // Soldera Case Basse, Sangiovese, Montalcino — red-only estate.
  [/\bcepparello\b/, "red"], // Isole e Olena Cepparello, 100% Sangiovese IGT.
  [/\bcain (five|concept|cuvee)\b/, "red"], // Cain Vineyards' Napa Bordeaux blends — all red.
];

function inferColour(hay, producerNorm) {
  // 1. Rosé -- highest priority. A rosé Champagne/Cava (e.g. "Alta Alella
  //    Cava Reserva Brut Nature Rosé", "Chartogne-Taillet Le Rosé") is
  //    filed as rose, not sparkling: "rosé" is the more specific, visible
  //    fact, and this cellar already has a dedicated Rose section separate
  //    from Sparkling. Cerasuolo d'Abruzzo is a rosé-style wine by
  //    definition (Montepulciano grape, vinified pink), so it's grouped
  //    here too.
  if (/\b(rose|rosato|cerasuolo)\b/.test(hay)) return "rose";

  // 2. Dessert styles.
  if (
    /\b(sauternes|barsac|tokaji|tokay|beerenauslese|trockenbeerenauslese|eiswein|vin santo)\b/.test(
      hay,
    )
  )
    return "dessert";
  if (hay.includes("ice wine")) return "dessert";

  // 3. Fortified styles.
  if (/\b(port|porto|sherry|madeira|marsala)\b/.test(hay)) return "fortified";

  // 4. Explicit sparkling-method words.
  if (/\b(champagne|cremant|cava|franciacorta|prosecco|spumante|sekt)\b/.test(hay))
    return "sparkling";

  // 5. Known Champagne grower/house producers default to sparkling --
  //    UNLESS the name marks it a still "Coteaux Champenois" wine, which
  //    always carries its own explicit colour word that rule 1 or rule 8
  //    will already have matched by the time we reach this line.
  if (CHAMPAGNE_HOUSES.has(producerNorm) && !hay.includes("coteaux champenois"))
    return "sparkling";

  // 6. Single/near-single-colour appellations (see table above), with two
  //    ordering-sensitive exceptions handled inline first.
  if (hay.includes("chassagne montrachet")) {
    // Deliberately unclassified -- see the header comment.
  } else if (/\bcorton charlemagne\b/.test(hay)) {
    return "white";
  } else if (/\bcorton\b/.test(hay)) {
    return "red"; // Corton AOC itself is red-only; only Corton-Charlemagne is white.
  } else if (/\b(batard|chevalier|puligny) montrachet\b/.test(hay) || /\bmontrachet\b/.test(hay)) {
    return "white"; // White-only Montrachet family (Chassagne's shared 1ers excluded above).
  }
  for (const [pattern, colour] of APPELLATION_COLOUR_RULES) {
    if (pattern.test(hay)) return colour;
  }

  // 7. Single-colour grape names.
  if (/\b(chardonnay|riesling|sauvignon|trebbiano|friulano|aligote|pinot blanc|pinot gris)\b/.test(hay))
    return "white";
  if (
    /\b(cabernet|merlot|syrah|shiraz|malbec|tempranillo|nebbiolo|sangiovese|zinfandel|gamay|barbera|pinot noir|grenache)\b/.test(
      hay,
    )
  )
    return "red";

  // 8. Generic style words, last resort.
  if (/\b(blanc|bianco|branco|white)\b/.test(hay)) return "white";
  if (/\b(rouge|rosso|tinto|red)\b/.test(hay)) return "red";

  return null; // No clear signal -- leave it null. Never defaulted to red.
}

// ---------------------------------------------------------------------------
// REGION / COUNTRY INFERENCE -- independent of colour. A bare "Toscana" IGT
// is unambiguously Tuscany/Italy even though its COLOUR is unknowable from
// the name alone, so this table is deliberately allowed to fire on wines
// the colour table above leaves untouched. Producer-first for a handful of
// single-origin producers, then keyword-based; both top-down, first match
// wins. Anything unmatched is left blank.
// ---------------------------------------------------------------------------

const SINGLE_ORIGIN_PRODUCERS = new Map([
  ["cain", { region: "Napa Valley", country: "United States" }], // Cain Vineyards, Spring Mountain District -- single-origin regardless of cuvée name (avoids matching the literal word "Bordeaux" in "Red Bordeaux Blend", which would wrongly say France).
  ["josmeyer", { region: "Alsace", country: "France" }],
  ["miani", { region: "Friuli", country: "Italy" }],
]);

const BURGUNDY_RE =
  /\b(bourgogne|chambertin|musigny|volnay|pommard|nuits saint georges|vosne romanee|meursault|puligny montrachet|chassagne montrachet|montrachet|chablis|corton|clos de vougeot|echezeaux|clos de la roche|clos de tart|morey saint denis|fixin|cote de nuits villages|beaune|savigny les beaune|marsannay|saint aubin)\b/;

const REGION_RULES = [
  [/\bfranciacorta\b/, { region: "Franciacorta", country: "Italy" }],
  [/\bprosecco\b/, { region: "Veneto", country: "Italy" }],
  [/\balella\b/, { region: "Alella", country: "Spain" }],
  [/\bcotes catalanes\b/, { region: "Roussillon", country: "France" }],
  [/\baltenberg de bergheim\b/, { region: "Alsace", country: "France" }],
  [BURGUNDY_RE, { region: "Burgundy", country: "France" }],
  [/\b(fleurie|moulin a vent)\b/, { region: "Beaujolais", country: "France" }],
  [/\b(chinon|sancerre|muscadet|saumur)\b/, { region: "Loire", country: "France" }],
  [/\b(cornas|cote rotie|crozes hermitage)\b/, { region: "Rhone", country: "France" }],
  [
    /\b(pauillac|haut medoc|medoc|margaux|saint julien|saint estephe)\b/,
    { region: "Bordeaux", country: "France" },
  ],
  // `dalba` / `dabruzzo`, not `alba` / `abruzzo`: normalise() strips
  // apostrophes as JOIN letters, so "Barbera d'Alba" arrives as
  // "barbera dalba" and a \babruzzo\b or \balba\b rule can never fire on it.
  // Without these two the same producer splits — Giacomo Conterno's Barolos
  // resolved to Piedmont while his Barbera d'Alba did not, and ten Emidio
  // Pepe / Valentini bottles carried the region in their own name unread.
  [/\b(barolo|barbaresco|langhe|carema|dalba)\b/, { region: "Piedmont", country: "Italy" }],
  [/\b(chianti|brunello|toscana)\b/, { region: "Tuscany", country: "Italy" }],
  [/\b(abruzzo|dabruzzo)\b/, { region: "Abruzzo", country: "Italy" }],
  [/\betna\b/, { region: "Etna", country: "Italy" }],
  [/\b(valpolicella|amarone)\b/, { region: "Veneto", country: "Italy" }],
  [/\bfriulano\b/, { region: "Friuli", country: "Italy" }],
  [/\btrentino\b/, { region: "Trentino", country: "Italy" }],
  [/\bumbria\b/, { region: "Umbria", country: "Italy" }],
];

function inferRegion(hay, producerNorm) {
  if (
    CHAMPAGNE_HOUSES.has(producerNorm) ||
    hay.includes("champagne") ||
    hay.includes("coteaux champenois")
  ) {
    return { region: "Champagne", country: "France" };
  }
  const single = SINGLE_ORIGIN_PRODUCERS.get(producerNorm);
  if (single) return single;
  for (const [pattern, place] of REGION_RULES) {
    if (pattern.test(hay)) return place;
  }
  return null;
}

// ---------------------------------------------------------------------------
// UNIT COST -- tiered off producer/appellation prestige, not a flat number.
// This is a defensible heuristic, not a market quote: each tier names the
// real-world signal it keys off, tiers are checked top-down (first match
// wins), and a wine matching nothing falls to the "unclassified" default.
// A deterministic fraction within [min,max] (seeded from the wine's own id,
// see pickInRange()) makes the exact price stable across re-runs.
// ---------------------------------------------------------------------------

const COST_TIERS = [
  {
    label: "icon",
    min: 300,
    max: 750,
    test: (hay) =>
      /\b(monfortino|clos des goisses|dom perignon|sir winston churchill|clos de tart|amarone|soldera|cristal)\b/.test(
        hay,
      ) || /(?<!chambolle )\bmusigny\b/.test(hay),
  },
  {
    label: "premium",
    min: 120,
    max: 280,
    test: (hay) =>
      /\b(barolo francia|barolo cerretta|barolo arione|barolo falletto|monprivato|clos de vougeot|jacques selosse|egly ouriet|larmandier bernier|ulysse collin|batard montrachet|brunello|billecart salmon|bollinger|corton)\b/.test(
        hay,
      ) || /(?<!gevrey )\bchambertin\b/.test(hay),
  },
  {
    label: "fine",
    min: 60,
    max: 140,
    test: (hay) =>
      /\b(1er cru|premier cru|grand cru|barolo|barbaresco|chartogne taillet|savart|pierre peters|laherte freres|vincent couche|marie courtin|suenen|pascal doquet|chianti classico riserva|cornas|cote rotie|volnay|gevrey chambertin|nuits saint georges|meursault|pommard|chambolle musigny)\b/.test(
        hay,
      ),
  },
  {
    label: "value",
    min: 28,
    max: 65,
    test: (hay) =>
      /\b(bourgogne|muscadet|sancerre|chinon|cava|crozes hermitage|etna|montepulciano|trebbiano|cerasuolo|fleurie|moulin a vent|languedoc|umbria|friulano|trentino)\b/.test(
        hay,
      ),
  },
];
const DEFAULT_COST_TIER = { label: "unclassified", min: 35, max: 75 };

function costTierFor(hay) {
  for (const tier of COST_TIERS) if (tier.test(hay)) return tier;
  return DEFAULT_COST_TIER;
}

// ---------------------------------------------------------------------------
// Deterministic per-wine derivations -- everything below is a pure function
// of the wine's own id (or a fixed salt), never of array position or
// current DB state, so a second run recomputes byte-identical values and
// the upserts are true no-ops.
// ---------------------------------------------------------------------------

function seedFrom(str) {
  return createHash("sha256").update(str).digest();
}

function seedInt(str) {
  return seedFrom(str).readUInt32BE(0);
}

/** [0,1) deterministic fraction. */
function seedFraction(str) {
  return seedInt(str) / 0x100000000;
}

function pickInRange(str, min, max) {
  const raw = min + seedFraction(str) * (max - min);
  return Math.round(raw * 2) / 2; // realistic invoice-style $0.50 increments
}

/** A stable, uuid-shaped (but not spec-compliant v4/v5) deterministic id. */
function deterministicUuid(...parts) {
  const hex = createHash("sha256").update(parts.join("|")).digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `a${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

// ---------------------------------------------------------------------------
// Bin layout
// ---------------------------------------------------------------------------

const ZONE_LETTER = {
  Sparkling: "S",
  Whites: "W",
  Rose: "P",
  "Reds - Old World": "O",
  "Reds - New World": "N",
  "Dessert & Fortified": "D",
};

const BIN_HEADROOM = 1.35; // total capacity target vs. actual bottle demand
const MIN_BINS_PER_ZONE = 4;
const MAX_BINS_PER_ZONE = 40; // a real serious-cellar wall can run this deep
const TARGET_BOTTLES_PER_BIN = 45; // used only to pick a realistic bin COUNT
// Small variation around the per-zone base capacity so bins aren't all
// identical -- realistic without needing per-bin hand-tuning. Symmetric
// around 0 so the average across a full cycle is exactly the base.
const CAPACITY_VARIANTS = [-12, -6, 0, 6, 12, 0];

function buildBinsForZone(zone, totalDemand) {
  const targetCapacity = Math.max(totalDemand * BIN_HEADROOM, MIN_BINS_PER_ZONE * 18);
  const binCount = Math.min(
    MAX_BINS_PER_ZONE,
    Math.max(MIN_BINS_PER_ZONE, Math.round(targetCapacity / TARGET_BOTTLES_PER_BIN)),
  );
  // Base per-bin capacity, rounded to the nearest 6 bottles, that gets
  // `binCount` bins to (at least) targetCapacity before variation is added.
  const baseCapacity = Math.max(12, Math.ceil(targetCapacity / binCount / 6) * 6);

  const bins = [];
  let cumCapacity = 0;
  let index = 0;
  // Always lay down binCount bins first (the realistic, human-sized rack);
  // then, only if rounding left the zone short of its headroom target
  // (possible when binCount was clamped to MAX_BINS_PER_ZONE), keep adding
  // bins at the base capacity until the target is actually met -- capacity
  // must never fall short of demand, "sensible size" is the secondary goal.
  while (index < binCount || cumCapacity < targetCapacity) {
    index++;
    const variant = CAPACITY_VARIANTS[(index - 1) % CAPACITY_VARIANTS.length];
    const capacity = Math.max(12, baseCapacity + variant);
    const code = `${ZONE_LETTER[zone]}${String(index).padStart(2, "0")}`;
    bins.push({
      id: deterministicUuid("bin", RESTAURANT_ID, zone, code),
      code,
      zone,
      capacity,
      remaining: capacity,
      sortOrder: index,
    });
    cumCapacity += capacity;
    if (index > MAX_BINS_PER_ZONE + 25) break; // absolute safety valve
  }
  return bins;
}

/** First-fit-decreasing: biggest lots placed first, so the packing is tight. */
function assignBins(zone, bins, items) {
  const sorted = [...items].sort((a, b) => b.quantity - a.quantity || a.id.localeCompare(b.id));
  for (const item of sorted) {
    let bin = bins.find((b) => b.remaining >= item.quantity);
    if (!bin) {
      bin = bins.reduce((best, b) => (b.remaining > best.remaining ? b : best), bins[0]);
    }
    bin.remaining -= item.quantity;
    item.binId = bin.id;
  }
}

// ---------------------------------------------------------------------------
// Open-bottle picks for /cellar/reconcile -- the reconciliation demo fix.
//
// /cellar/reconcile (list_open_bottle_items, migration 0017) lists a wine
// only when it has BOTH a wine_list_items row with glass_pour_ml set AND a
// matching open_bottles row. The tenant's only 18 such wine_list_items rows
// ("By the Glass" list) all point at the 250 synthetic seed wines -- so this
// step has to write both tables, not just open_bottles, or the real wines
// still would not appear.
//
// Curated by producer (+ a name fragment where a producer has several
// distinct bottlings) rather than by wine id, so the picks survive a
// from-scratch reseed. Each is resolved against `wines` (already carries
// producer, vintage, colour, section and quantity by the time this runs) to
// one concrete 750ml, in-stock wine, deterministically: of every candidate
// with at least 3 bottles on hand, the lowest wine id wins -- stable across
// re-runs because ids never change, the same pattern the rest of this file
// uses for its own tie-breaks.
//
// remainingMl is fixed per pick rather than derived from a "fraction" label
// so the intent is explicit: most hit an exact fraction point (188/375/563/
// 750 -- the same four non-empty values reconcile-list.tsx's own FRACTIONS
// array offers, for a 750ml bottle) so tapping the matching button there
// shows no variance. Valentini (300ml) deliberately hits none of them, so
// tapping ANY fraction button there shows a variance past the tenant's
// 2oz / ~59ml threshold (cellar_config.reconcile_variance_threshold_oz) --
// proof the variance UI has something real to display, not just a prop.
const OPEN_BOTTLE_PICKS = [
  // Sparkling
  { producer: "bollinger", nameIncludes: "", remainingMl: 750, openedDaysAgo: 0 },
  { producer: "louis roederer", nameIncludes: "cristal", remainingMl: 563, openedDaysAgo: 1 },
  { producer: "pol roger", nameIncludes: "", remainingMl: 375, openedDaysAgo: 2 },
  { producer: "agrapart", nameIncludes: "", remainingMl: 188, openedDaysAgo: 4 },
  // Whites
  { producer: "benjamin leroux", nameIncludes: "meursault", remainingMl: 563, openedDaysAgo: 1 },
  { producer: "emidio pepe", nameIncludes: "trebbiano", remainingMl: 375, openedDaysAgo: 3 },
  // Rose
  { producer: "chartogne taillet", nameIncludes: "rose", remainingMl: 750, openedDaysAgo: 0 },
  { producer: "valentini", nameIncludes: "cerasuolo", remainingMl: 300, openedDaysAgo: 5 },
  // Reds -- Old World
  { producer: "giacomo conterno", nameIncludes: "barolo", remainingMl: 188, openedDaysAgo: 6 },
  { producer: "emidio pepe", nameIncludes: "montepulciano", remainingMl: 563, openedDaysAgo: 2 },
  { producer: "lignier michelot", nameIncludes: "", remainingMl: 375, openedDaysAgo: 3 },
  // Reds -- New World
  { producer: "cain", nameIncludes: "", remainingMl: 188, openedDaysAgo: 5 },
];
const OPEN_BOTTLE_MIN_STOCK = 3; // pre-open quantity floor -- leaves >=2 sealed after the -1 decrement.

// wine_list_items.glass_pour_ml per colour. Matches cellar_config's own
// pourDefaults ({red:150, white:150, dessert:75, sparkling:125}); rose and
// fortified have no config entry, so they take the 150ml most of the
// tenant's existing "By the Glass" rows already use.
const GLASS_POUR_ML = {
  sparkling: 125,
  white: 150,
  rose: 150,
  red: 150,
  dessert: 75,
  fortified: 75,
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function sqlLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function main() {
  console.log(`seed-demo-real-inventory: target ${DB_URL.replace(/:[^:@]+@/, ":***@")}`);
  console.log(`seed-demo-real-inventory: mode = ${CONFIRM ? "CONFIRM (writing)" : "DRY RUN"}`);
  console.log("");

  // --- Tenant sanity check --------------------------------------------------
  const restaurantRows = psqlRows(
    `select name from public.restaurants where id = '${RESTAURANT_ID}'::uuid;`,
  );
  if (restaurantRows.length === 0) {
    console.error(
      `seed-demo-real-inventory: REFUSING -- restaurant ${RESTAURANT_ID} does not exist ` +
        "on this database. This script only ever operates on that one hardcoded tenant.",
    );
    process.exit(1);
  }
  const restaurantName = restaurantRows[0][0];
  if (restaurantName !== RESTAURANT_NAME_EXPECTED) {
    console.warn(
      `seed-demo-real-inventory: WARNING -- restaurant ${RESTAURANT_ID} is named ` +
        `"${restaurantName}", not the expected "${RESTAURANT_NAME_EXPECTED}". Continuing ` +
        "anyway since the id itself is hardcoded and matches, but double-check this is the " +
        "stack you think it is.",
    );
  }

  // --- Verify backfill_wine_identity exists before ever calling it ---------
  const fnRows = psqlRows(
    `select count(*) from pg_proc where proname = 'backfill_wine_identity';`,
  );
  const backfillFnExists = Number(fnRows[0][0]) > 0;
  if (!backfillFnExists) {
    console.error(
      "seed-demo-real-inventory: REFUSING -- public.backfill_wine_identity(uuid) does not " +
        "exist on this database (expected from migration 0135). Run migrations first.",
    );
    process.exit(1);
  }

  // --- Target wine set (~461) ----------------------------------------------
  const wineRows = psqlRows(`
    select id, coalesce(name,''), coalesce(producer,''), vintage,
           colour, region, country, size_ml
    from public.wines
    where restaurant_id = '${RESTAURANT_ID}'::uuid
      and hero_image_url is not null
      and trim(coalesce(producer,'')) <> ''
      and vintage is not null
    order by id;
  `);
  const wines = wineRows.map(([id, name, producer, vintage, colour, region, country, sizeMl]) => {
    const hay = normalizeText(`${name} ${producer}`);
    const producerNorm = normalizeText(producer);
    return {
      id,
      name,
      producer,
      vintage: Number(vintage),
      colour: colour || null,
      region: region || null,
      country: country || null,
      sizeMl: Number(sizeMl),
      hay,
      producerNorm,
    };
  });

  // --- Colour / region / country inference (only where currently blank) ----
  let colourInferred = 0;
  let colourLeftNull = 0;
  const colourCounts = {};
  let regionInferred = 0;
  let regionLeftBlank = 0;

  for (const wine of wines) {
    if (!wine.colour) {
      const inferred = inferColour(wine.hay, wine.producerNorm);
      if (inferred) {
        wine.newColour = inferred;
        colourInferred++;
        colourCounts[inferred] = (colourCounts[inferred] ?? 0) + 1;
      } else {
        colourLeftNull++;
      }
    }
    if (!wine.region || !wine.country) {
      const place = inferRegion(wine.hay, wine.producerNorm);
      if (place) {
        wine.newRegion = place.region;
        wine.newCountry = place.country;
        regionInferred++;
      } else {
        regionLeftBlank++;
      }
    }
    // Effective colour/country used for section + cost-tier logic below,
    // whether it came from the DB already or was just inferred.
    wine.effectiveColour = wine.colour ?? wine.newColour ?? null;
    wine.effectiveCountry = wine.country ?? wine.newCountry ?? null;
  }

  // --- Section assignment (reuses the shared helper, including its
  //     documented default branch for wines with no known colour) ---------
  for (const wine of wines) {
    const [section] = sectionNameFor({
      colour: wine.effectiveColour ?? undefined,
      country: wine.effectiveCountry ?? undefined,
    });
    wine.section = section;
  }

  // --- Quantity distribution (deterministic, per wine.id) -------------------
  // Most wines: 3-12 bottles. A few: 24+. A deliberate 8-15-wine low-stock
  // band at 1-2 bottles so the "Low stock" filter has real, and ONLY that,
  // content -- the "most wines" band deliberately starts at 3, not 2, so it
  // never muddies the deliberate low-stock signal with incidental overlap.
  const LOW_STOCK_COUNT = 12;
  const BIG_COUNT = 15;
  const ranked = [...wines].sort(
    (a, b) => seedInt(`${a.id}:rank`) - seedInt(`${b.id}:rank`),
  );
  ranked.forEach((wine, idx) => {
    if (idx < LOW_STOCK_COUNT) {
      wine.quantity = idx % 2 === 0 ? 1 : 2;
    } else if (idx < LOW_STOCK_COUNT + BIG_COUNT) {
      wine.quantity = 24 + Math.floor(seedFraction(`${wine.id}:big`) * 17); // 24-40
    } else {
      wine.quantity = 3 + Math.floor(seedFraction(`${wine.id}:mid`) * 10); // 3-12
    }
  });

  // --- Unit cost (deterministic, tiered) ------------------------------------
  for (const wine of wines) {
    const tier = costTierFor(wine.hay);
    wine.costTier = tier.label;
    wine.unitCost = pickInRange(`${wine.id}:cost`, tier.min, tier.max);
  }

  // --- New inventory row ids (deterministic) --------------------------------
  for (const wine of wines) {
    wine.invId = deterministicUuid("inv", RESTAURANT_ID, wine.id);
  }

  // --- Open bottles on real wines (reconciliation demo fix) -----------------
  // Resolve the "By the Glass" wine_list's sections -- the picks above get
  // wired into whichever one matches the wine's own cellar section, so
  // /cellar/reconcile and the public "By the Glass" page agree with /cellar
  // about what section each wine lives in.
  const [[byGlassListId]] = psqlRows(`
    select id from public.wine_lists
    where restaurant_id = '${RESTAURANT_ID}'::uuid and name = 'By the Glass'
    limit 1;
  `);
  if (!byGlassListId) {
    console.error(
      "seed-demo-real-inventory: REFUSING -- no 'By the Glass' wine_lists row for this " +
        "tenant. /cellar/reconcile requires a glass_pour_ml wine_list_items row per wine " +
        "(migration 0017), and this script only knows how to hang new ones off that list.",
    );
    process.exit(1);
  }
  const byGlassSectionRows = psqlRows(`
    select name, id from public.wine_list_sections where wine_list_id = '${byGlassListId}'::uuid;
  `);
  const byGlassSectionId = Object.fromEntries(byGlassSectionRows.map(([name, id]) => [name, id]));

  // Reuse whichever actor already opened the tenant's other 36 bottles,
  // rather than inventing a new one.
  const actorRows = psqlRows(`
    select opened_by from public.open_bottles
    where restaurant_id = '${RESTAURANT_ID}'::uuid and opened_by is not null
    limit 1;
  `);
  const openBottleActorId = actorRows[0]?.[0] ?? null;

  // Anchored to noon UTC "today", not the wall-clock instant this line runs,
  // so two --confirm runs made minutes apart (the idempotency proof this
  // task asks for) compute byte-identical opened_at values instead of
  // differing by a few seconds.
  const openBottleAnchor = new Date();
  openBottleAnchor.setUTCHours(12, 0, 0, 0);

  const usedOpenBottleWineIds = new Set();
  const openBottles = [];
  for (const pick of OPEN_BOTTLE_PICKS) {
    const candidates = wines
      .filter(
        (w) =>
          w.producerNorm === pick.producer &&
          (pick.nameIncludes === "" || normalizeText(w.name).includes(pick.nameIncludes)) &&
          w.sizeMl === 750 &&
          w.quantity >= OPEN_BOTTLE_MIN_STOCK &&
          !usedOpenBottleWineIds.has(w.id),
      )
      .sort((a, b) => a.id.localeCompare(b.id));
    const wine = candidates[0];
    if (!wine) {
      console.warn(
        `seed-demo-real-inventory: WARNING -- no eligible 750ml wine with >=` +
          `${OPEN_BOTTLE_MIN_STOCK} in stock matched open-bottle pick producer=` +
          `"${pick.producer}" nameIncludes="${pick.nameIncludes}". Skipped.`,
      );
      continue;
    }
    if (!byGlassSectionId[wine.section]) {
      console.warn(
        `seed-demo-real-inventory: WARNING -- "By the Glass" list has no ` +
          `"${wine.section}" section; skipping pick for ${wine.producer} ${wine.name}.`,
      );
      continue;
    }
    usedOpenBottleWineIds.add(wine.id);
    wine.quantity -= 1; // one bottle now open, not sealed -- mirrors record_pour()'s own decrement.
    openBottles.push({
      wine,
      id: deterministicUuid("openbottle", RESTAURANT_ID, wine.id),
      wliId: deterministicUuid("wli-glass", RESTAURANT_ID, wine.id),
      sectionId: byGlassSectionId[wine.section],
      remainingMl: pick.remainingMl,
      glassPourMl: GLASS_POUR_ML[wine.effectiveColour ?? "red"] ?? 150,
      openedAt: new Date(
        openBottleAnchor.getTime() - pick.openedDaysAgo * 24 * 60 * 60 * 1000,
      ).toISOString(),
    });
  }
  if (openBottles.length < 10) {
    console.error(
      `seed-demo-real-inventory: REFUSING -- only ${openBottles.length}/` +
        `${OPEN_BOTTLE_PICKS.length} open-bottle picks resolved to an eligible wine ` +
        "(need >=10). The curated pick list has drifted from the seeded data -- fix the " +
        "picks, don't lower this floor.",
    );
    process.exit(1);
  }

  // --- Legacy inventory rows (the original 400 -- everything that isn't a
  //     row this script itself creates, identified by id, NOT by its
  //     current bin_id). Demand per zone must come from ALL of them, every
  //     run, or the bin PLAN itself (how many bins, what capacity) drifts
  //     between the first run (400 rows still bin_id IS NULL) and every run
  //     after it (0 rows bin_id IS NULL) -- that drift is exactly what
  //     broke idempotency the first time this script was tested: run 2
  //     "saw" less demand than run 1 and built a smaller layout, minting a
  //     new, different set of bins instead of upserting the same ones.
  //     bin_id IS still tracked per row, just separately, so the actual
  //     UPDATE below only ever touches rows that still need one.
  const legacyIds = new Set(wines.map((w) => w.invId));
  const legacyRows = psqlRows(`
    select id, coalesce(section,''), quantity, bin_id
    from public.inventory_items
    where restaurant_id = '${RESTAURANT_ID}'::uuid;
  `);
  const legacyItems = legacyRows
    .filter(([id]) => !legacyIds.has(id))
    .map(([id, section, quantity, binId]) => ({
      id,
      section,
      quantity: Number(quantity),
      needsBinId: binId === "",
    }));

  // --- Bin plan: one set of zones, sized off combined legacy + new demand --
  const demandBySection = Object.fromEntries(SECTION_NAMES.map((s) => [s, 0]));
  for (const item of legacyItems) {
    if (demandBySection[item.section] !== undefined) demandBySection[item.section] += item.quantity;
  }
  for (const wine of wines) {
    demandBySection[wine.section] += wine.quantity;
  }

  const binsByZone = {};
  for (const zone of SECTION_NAMES) {
    binsByZone[zone] = buildBinsForZone(zone, demandBySection[zone]);
  }

  for (const zone of SECTION_NAMES) {
    const zoneLegacy = legacyItems.filter((i) => i.section === zone);
    const zoneNew = wines.filter((w) => w.section === zone);
    assignBins(zone, binsByZone[zone], [...zoneLegacy, ...zoneNew]);
  }

  const allBins = SECTION_NAMES.flatMap((zone) => binsByZone[zone]);

  // --- Before counts ---------------------------------------------------------
  const [[existingBinCount]] = psqlRows(
    `select count(*) from public.bins where restaurant_id = '${RESTAURANT_ID}'::uuid;`,
  );
  const [[existingNewInvCount]] = psqlRows(`
    select count(*) from public.inventory_items
    where restaurant_id = '${RESTAURANT_ID}'::uuid
      and id in (${wines.map((w) => `'${w.invId}'::uuid`).join(",") || "NULL"});
  `);
  const [[existingWineVariantResolved]] = psqlRows(`
    select count(*) from public.wines
    where restaurant_id = '${RESTAURANT_ID}'::uuid and wine_variant_id is not null;
  `);
  const [[existingOpenBottleCount]] = psqlRows(`
    select count(*) from public.open_bottles
    where restaurant_id = '${RESTAURANT_ID}'::uuid
      and wine_id in (${openBottles.map((o) => `'${o.wine.id}'::uuid`).join(",") || "NULL"});
  `);

  // --- Report ------------------------------------------------------------
  const lowStockNewCount = wines.filter((w) => w.quantity <= 2).length;
  console.log("=== PLAN ===");
  console.log(`wines targeted:              ${wines.length}`);
  console.log(`colour inferred:             ${colourInferred} (${JSON.stringify(colourCounts)})`);
  console.log(`colour left NULL:            ${colourLeftNull}`);
  console.log(`region/country inferred:     ${regionInferred}`);
  console.log(`region/country left blank:   ${regionLeftBlank}`);
  console.log(`bins planned (all zones):    ${allBins.length}`);
  for (const zone of SECTION_NAMES) {
    const capacity = binsByZone[zone].reduce((sum, b) => sum + b.capacity, 0);
    const used = capacity - binsByZone[zone].reduce((sum, b) => sum + b.remaining, 0);
    console.log(
      `  ${zone.padEnd(20)} ${String(binsByZone[zone].length).padStart(2)} bins, ` +
        `capacity ${capacity}, used ${used} (${Math.round((used / capacity) * 100)}%)`,
    );
  }
  console.log(`bins already in DB:          ${existingBinCount}`);
  console.log(`new inventory rows planned:  ${wines.length}`);
  console.log(`  already present (rerun):   ${existingNewInvCount}`);
  console.log(`  low stock (qty<=2) new:    ${lowStockNewCount}`);
  console.log(
    `legacy rows needing bin_id:  ${legacyItems.filter((i) => i.needsBinId).length} (of ${legacyItems.length} total legacy rows)`,
  );
  console.log(`wine_variant_id resolved now:${existingWineVariantResolved} / ${wines.length} target wines`);
  console.log(`open bottles planned (reconcile demo): ${openBottles.length}`);
  for (const o of openBottles) {
    console.log(
      `  ${o.wine.producer} ${o.wine.name} ${o.wine.vintage} -- ${o.remainingMl}ml/${o.wine.sizeMl}ml, ` +
        `section ${o.wine.section}, sealed left after open: ${o.wine.quantity}`,
    );
  }
  console.log(`  already open (rerun):       ${existingOpenBottleCount}`);
  console.log("");

  if (!CONFIRM) {
    console.log("DRY RUN -- no writes made. Pass --confirm to apply.");
    return;
  }

  // --- Build the write transaction -----------------------------------------
  const binValues = allBins
    .map(
      (b) =>
        `(${sqlLiteral(b.id)}::uuid, '${RESTAURANT_ID}'::uuid, ${sqlLiteral(b.code)}, ${sqlLiteral(
          b.zone,
        )}, ${b.capacity}, 0, ${b.sortOrder})`,
    )
    .join(",\n    ");

  const legacyBinUpdateValues = legacyItems
    .filter((i) => i.needsBinId)
    .map((i) => `(${sqlLiteral(i.id)}::uuid, ${sqlLiteral(i.binId)}::uuid)`)
    .join(",\n    ");

  const wineUpdateValues = wines
    .map(
      (w) =>
        `(${sqlLiteral(w.id)}::uuid, ${sqlLiteral(w.newColour ?? "")}, ${sqlLiteral(
          w.newRegion ?? "",
        )}, ${sqlLiteral(w.newCountry ?? "")})`,
    )
    .join(",\n    ");

  const inventoryValues = wines
    .map(
      (w) =>
        `(${sqlLiteral(w.invId)}::uuid, ${sqlLiteral(w.id)}::uuid, '${RESTAURANT_ID}'::uuid, ` +
        `${w.quantity}, ${w.unitCost.toFixed(2)}, ${sqlLiteral(w.section)}, ` +
        `${sqlLiteral(w.binId)}::uuid, '750ml', 'USD', 'manual')`,
    )
    .join(",\n    ");

  const wineListItemValues = openBottles
    .map(
      (o) =>
        `(${sqlLiteral(o.wliId)}::uuid, ${sqlLiteral(o.sectionId)}::uuid, ${sqlLiteral(
          o.wine.id,
        )}::uuid, '${RESTAURANT_ID}'::uuid, ${o.glassPourMl}, 'fixed')`,
    )
    .join(",\n    ");

  const openBottleValues = openBottles
    .map(
      (o) =>
        `(${sqlLiteral(o.id)}::uuid, ${sqlLiteral(o.wine.id)}::uuid, '${RESTAURANT_ID}'::uuid, ` +
        `${o.remainingMl}, ${sqlLiteral(o.openedAt)}::timestamptz, ${sqlLiteral(
          openBottleActorId,
        )}::uuid, ${sqlLiteral(o.wine.invId)}::uuid)`,
    )
    .join(",\n    ");

  const sql = `
begin;

-- 1. Bins (idempotent: id is deterministic, so a re-run updates in place).
insert into public.bins (id, restaurant_id, code, zone, capacity, priority, sort_order)
values
    ${binValues}
on conflict (id) do update set
  code = excluded.code,
  zone = excluded.zone,
  capacity = excluded.capacity,
  sort_order = excluded.sort_order,
  updated_at = now();

-- 2. Backfill bin_id on the 400 legacy rows that had a section but no bin
--    (only where bin_id is currently NULL -- never touches an already-placed row).
${
  legacyBinUpdateValues
    ? `update public.inventory_items i
set bin_id = v.bin_id, updated_at = now()
from (values
    ${legacyBinUpdateValues}
) as v(id, bin_id)
where i.id = v.id
  and i.restaurant_id = '${RESTAURANT_ID}'::uuid
  and i.bin_id is null;`
    : "-- (nothing to backfill)"
}

-- 3. Colour / region / country backfill -- COALESCE guarantees this can only
--    fill a NULL, never overwrite an existing value. '' is this script's own
--    sentinel for "no confident inference"; NULLIF turns it back into NULL so
--    COALESCE leaves the column untouched rather than writing an empty string.
update public.wines w
set colour = coalesce(w.colour, nullif(v.colour, '')),
    region = coalesce(w.region, nullif(v.region, '')),
    country = coalesce(w.country, nullif(v.country, '')),
    updated_at = now()
from (values
    ${wineUpdateValues}
) as v(id, colour, region, country)
where w.id = v.id
  and w.restaurant_id = '${RESTAURANT_ID}'::uuid;

-- 4. New inventory rows for the 461 real, photographed, producer+vintage-
--    complete wines (idempotent: id is deterministic per wine_id).
insert into public.inventory_items
  (id, wine_id, restaurant_id, quantity, unit_cost, section, bin_id, format, currency, added_via)
values
    ${inventoryValues}
on conflict (id) do update set
  quantity = excluded.quantity,
  unit_cost = excluded.unit_cost,
  section = excluded.section,
  bin_id = excluded.bin_id,
  format = excluded.format,
  currency = excluded.currency,
  added_via = excluded.added_via,
  updated_at = now();

-- 5. bin_location must agree with bin_id.
--    These are two different columns and only ONE of them reaches the cellar
--    list: src/app/(app)/cellar/page.tsx derives a row's bin from
--    item.bin_location, and cellar-row.tsx renders its bin badge only when
--    that free-text value is truthy (em-dash otherwise). bin_id is what
--    /bins joins on. Setting bin_id alone therefore produces a cellar where
--    every seeded wine shows "—" while the older rows show a badge, which is
--    precisely backwards. Fill the text column from the bin it points at.
--    Only fills NULLs, so a hand-placed location is never overwritten.
update public.inventory_items i
set bin_location = b.code, updated_at = now()
from public.bins b
where b.id = i.bin_id
  and i.restaurant_id = '${RESTAURANT_ID}'::uuid
  and i.bin_location is null;

-- 6. Repoint STALE bin_location strings, and only stale ones.
--    The 400 legacy rows carry codes from a bin scheme that predates the
--    bins table ("I9", "J14", "K3") — none of those strings matches any row
--    in public.bins, so the cellar badge names a bin that does not exist
--    while /bins reports the real one, and the two screens disagree about
--    the same bottle. Rewriting a value rather than filling a NULL is a
--    deliberate exception to step 5's rule, so it is fenced twice: the row's
--    current text must resolve to NO bin in this tenant, and the bin_id it
--    actually points at must resolve to one. A hand-placed location that
--    names a real bin is never touched.
update public.inventory_items i
set bin_location = b.code, updated_at = now()
from public.bins b
where b.id = i.bin_id
  and i.restaurant_id = '${RESTAURANT_ID}'::uuid
  and i.bin_location is not null
  and i.bin_location <> b.code
  and not exists (
    select 1 from public.bins stale
    where stale.restaurant_id = i.restaurant_id
      and stale.code = i.bin_location
  );

-- 7. "By the Glass" wine_list_items for the real wines being opened below --
--    /cellar/reconcile (list_open_bottle_items, migration 0017) only lists a
--    wine that has one of these with glass_pour_ml set, so opening a bottle
--    without this row would stay invisible there. Idempotent: id is
--    deterministic per wine_id.
insert into public.wine_list_items
  (id, section_id, wine_id, restaurant_id, glass_pour_ml, pour_size_mode)
values
    ${wineListItemValues}
on conflict (id) do update set
  section_id = excluded.section_id,
  glass_pour_ml = excluded.glass_pour_ml,
  pour_size_mode = excluded.pour_size_mode,
  updated_at = now();

-- 8. Open bottles on real, photographed wines -- the reconciliation demo
--    fix. remaining_ml is deliberately varied per wine.hay (see
--    OPEN_BOTTLE_PICKS above): some near-full, some down to a quarter, one
--    (Valentini) intentionally off every fraction the UI offers so it shows
--    a variance once tapped. Idempotent on (wine_id, restaurant_id), the
--    same unique constraint record_pour()/reconcile_open_bottle() rely on.
insert into public.open_bottles
  (id, wine_id, restaurant_id, remaining_ml, opened_at, opened_by, source_inventory_item_id)
values
    ${openBottleValues}
on conflict (wine_id, restaurant_id) do update set
  remaining_ml = excluded.remaining_ml,
  opened_at = excluded.opened_at,
  opened_by = excluded.opened_by,
  source_inventory_item_id = excluded.source_inventory_item_id;

-- 5. Identity repair -- this script wrote \`wines\` directly (step 3), so per
--    AGENTS.md it must call the idempotent repair function afterwards.
select public.backfill_wine_identity('${RESTAURANT_ID}'::uuid) as newly_resolved_wine_variants;

commit;
`;

  console.log("=== WRITING ===");
  psqlExec(sql);

  console.log("");
  console.log("=== AFTER ===");
  psqlExec(`
select count(*) as bins_total from public.bins where restaurant_id = '${RESTAURANT_ID}'::uuid;
select count(*) as inventory_rows_total, count(*) filter (where bin_id is not null) as with_bin
  from public.inventory_items where restaurant_id = '${RESTAURANT_ID}'::uuid;
select count(*) as wine_variant_resolved
  from public.wines where restaurant_id = '${RESTAURANT_ID}'::uuid and wine_variant_id is not null;
select colour, count(*) from public.wines
  where restaurant_id = '${RESTAURANT_ID}'::uuid and hero_image_url is not null
  group by 1 order by 1;
select w.producer, w.name, w.vintage, ob.remaining_ml, ob.opened_at
  from public.wine_list_items wli
  join public.wine_list_sections s on s.id = wli.section_id
  join public.wine_lists wl on wl.id = s.wine_list_id
  join public.wines w on w.id = wli.wine_id
  join public.open_bottles ob on ob.wine_id = w.id and ob.restaurant_id = wl.restaurant_id
  where wl.restaurant_id = '${RESTAURANT_ID}'::uuid
    and wli.glass_pour_ml is not null
    and w.hero_image_url is not null
  order by ob.opened_at desc;
`);
}

main().catch((error) => {
  console.error("seed-demo-real-inventory: FAILED --", error.message ?? error);
  process.exit(1);
});
