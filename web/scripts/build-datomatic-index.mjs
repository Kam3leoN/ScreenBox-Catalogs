/**
 * Construit public/data/datomatic-index.json depuis les packs Dat-o-Matic
 * (même source que 1G1RNiCrRoms : hugo19941994/auto-datfile-generator).
 *
 * Usage:
 *   node scripts/build-datomatic-index.mjs [--zips-dir path]
 *   # zips attendus : no-intro.zip / no-intro_parent-clone.zip + redump.zip
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(root, "..");
const outPath = path.join(root, "public", "data", "datomatic-index.json");
const defaultZips = path.join(repoRoot, ".temp", "datomatic");

const NO_INTRO_URL =
  "https://github.com/hugo19941994/auto-datfile-generator/releases/latest/download/no-intro_parent-clone.zip";
const REDUMP_URL =
  "https://github.com/hugo19941994/auto-datfile-generator/releases/latest/download/redump.zip";

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}

function stemFromDatFileName(fileName) {
  let name = path.basename(fileName, ".dat").trim();
  // « Nintendo - Game Boy (Parent-Clone) (20260101-… ) »
  const paren = name.indexOf(" (");
  if (paren > 0) name = name.slice(0, paren).trim();
  return name;
}

function isPrimaryDatName(fileNameWithoutExt) {
  const name = fileNameWithoutExt.trim();
  if (/^Non-Redump - /i.test(name) || /^Source Code - /i.test(name)) return false;
  const paren = name.indexOf(" (");
  if (paren < 0) return true;
  const close = name.indexOf(")", paren + 2);
  if (close < 0) return false;
  const first = name.slice(paren + 2, close).trim();
  if (/^Parent-Clone$/i.test(first)) return true;
  if (first.length >= 8 && /^\d/.test(first)) return true;
  return false;
}

function parseManufacturerHardware(id) {
  const idx = id.indexOf(" - ");
  if (idx > 0) {
    return {
      manufacturer: id.slice(0, idx).trim(),
      hardware: id.slice(idx + 3).trim(),
    };
  }
  return { manufacturer: id, hardware: id };
}

function heuristicFamily(id) {
  const n = id.toLowerCase();
  if (/pinball|flipper|visual pinball|future pinball|zaccaria/.test(n)) return "Flippers";
  if (
    /play system|cps|mame|finalburn|neogeo$|neo-geo$|naomi|model [23]|atomiswave|chihiro|cave|daphne|singe|hbmame/.test(
      n,
    )
  )
    return "Arcade";
  if (
    /game boy|game gear|lynx|wonderswan|neo.?geo pocket|pokemon mini|supervision|ngp|psp|vita|nintendo ds|3ds|arduboy|game master/.test(
      n,
    )
  )
    return "Portables";
  if (
    /msx|atari st|atari.?8|vic-20|commodore|amstrad|zx spectrum|amiga|pc-88|pc-98|x68000|apple|macintosh|dos|windows|fm towns|sharp x1|thomson|oric/.test(
      n,
    )
  )
    return "Ordinateurs";
  if (
    /nintendo|sega|atari|sony|nec|pc engine|coleco|intellivision|odyssey|vectrex|channel f|saturn|mega drive|master system|32x|n64|snes|nes|sg-1000|jaguar|7800|5200|2600/.test(
      n,
    )
  )
    return "Consoles";
  return "Autres";
}

function countGamesInDat(xml) {
  // Compte les balises <game …> / <machine …> (ClrMamePro / Logiqx)
  const games = (xml.match(/<(?:game|machine)\b/gi) || []).length;
  return games;
}

function extractZip(zipPath, destDir) {
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });
  execFileSync("tar", ["-xf", zipPath, "-C", destDir], { stdio: "ignore" });
}

function walkDatFiles(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, ent.name);
      if (ent.isDirectory()) stack.push(full);
      else if (ent.isFile() && ent.name.toLowerCase().endsWith(".dat")) out.push(full);
    }
  }
  return out;
}

async function download(url, dest) {
  console.log("Downloading", url);
  const res = await fetch(url, { headers: { "User-Agent": "ScreenBox-Catalogs/1.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  console.log("  →", dest, fs.statSync(dest).size);
}

async function ensureZips(zipsDir) {
  fs.mkdirSync(zipsDir, { recursive: true });
  const ni =
    ["no-intro_parent-clone.zip", "no-intro.zip"]
      .map((n) => path.join(zipsDir, n))
      .find((p) => fs.existsSync(p)) || path.join(zipsDir, "no-intro_parent-clone.zip");
  const rd = path.join(zipsDir, "redump.zip");
  if (!fs.existsSync(ni)) await download(NO_INTRO_URL, ni);
  if (!fs.existsSync(rd)) await download(REDUMP_URL, rd);
  return { ni, rd };
}

function collectFromZip(zipPath, source) {
  const extractDir = path.join(path.dirname(zipPath), `_extract_${source.replace(/\W+/g, "")}`);
  console.log("  Extracting", path.basename(zipPath), "…");
  extractZip(zipPath, extractDir);
  const files = walkDatFiles(extractDir);
  const byStem = new Map();
  for (const file of files) {
    const base = path.basename(file, ".dat");
    if (!isPrimaryDatName(base)) continue;
    const stem = stemFromDatFileName(file);
    if (!stem || byStem.has(stem)) continue;
    let games = 0;
    try {
      games = countGamesInDat(fs.readFileSync(file, "utf8"));
    } catch {
      games = 0;
    }
    const { manufacturer, hardware } = parseManufacturerHardware(stem);
    byStem.set(stem, {
      id: stem,
      source,
      family: heuristicFamily(stem),
      manufacturer,
      hardware,
      games,
      games1g1r: games,
      roms: games,
      slug: stem,
    });
  }
  fs.rmSync(extractDir, { recursive: true, force: true });
  console.log(`  ${source}: ${byStem.size} systems`);
  return [...byStem.values()];
}

async function main() {
  const zipsDir = path.resolve(argValue("--zips-dir") || defaultZips);
  const { ni, rd } = await ensureZips(zipsDir);

  console.log("Indexing No-Intro…");
  const noIntro = collectFromZip(ni, "No-Intro");
  console.log("Indexing Redump…");
  const redump = collectFromZip(rd, "Redump");

  const systems = [...noIntro, ...redump].sort((a, b) => a.id.localeCompare(b.id, "en"));
  const payload = {
    generatedAt: new Date().toISOString(),
    source: "datomatic",
    packs: {
      noIntro: path.basename(ni),
      redump: path.basename(rd),
    },
    totals: {
      systems: systems.length,
      games: systems.reduce((a, s) => a + (s.games || 0), 0),
      roms: systems.reduce((a, s) => a + (s.roms || 0), 0),
      noIntro: noIntro.length,
      redump: redump.length,
    },
    systems,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload));
  console.log("Wrote", outPath);
  console.log(
    `  ${payload.totals.noIntro} No-Intro + ${payload.totals.redump} Redump = ${payload.totals.systems} systems, ${payload.totals.games} games`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
