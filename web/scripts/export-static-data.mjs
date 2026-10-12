/**
 * Exporte catalogues → public/data/*.json
 * Source : CATALOGS_SOURCE=turso|local (défaut: turso si TURSO_* présents, sinon .db local).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import { count1g1r } from "../lib/one-g1r.mjs";
import { loadTursoEnv } from "./turso-env.mjs";
import { pullTursoIntoSqlJs } from "./turso-pull.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(root, "..");
const dbPath = process.env.CATALOGS_DB
  ? path.resolve(process.env.CATALOGS_DB)
  : path.join(repoRoot, "screenbox-catalogs.db");
const outDir = path.join(root, "public", "data");
const bySystemDir = path.join(outDir, "by-system");
const familyMapPath = path.join(root, "data", "system_family_map.json");

function resolveSourceMode() {
  if (process.argv.includes("--turso")) return "turso";
  if (process.argv.includes("--local")) return "local";
  const forced = (process.env.CATALOGS_SOURCE || "").toLowerCase();
  if (forced === "turso" || forced === "local") return forced;
  // Défaut : snapshot local s’il existe (build rapide) ; sinon Turso.
  if (fs.existsSync(dbPath)) return "local";
  try {
    loadTursoEnv();
    return "turso";
  } catch {
    return "local";
  }
}

const indexOnly = process.argv.includes("--index-only");
/**
 * Site Vercel : by-system hors TOSEC (ROMs complets) + TOSEC Consoles/Portables
 * jouables en mode games-only (liste légère, sans hashes par piste).
 */
const siteExport = process.argv.includes("--site");

function slugify(id) {
  return id
    .trim()
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 180);
}

/** Bruit TOSEC (pas de browse site). */
function isTosecNoiseId(id) {
  return /Artwork|Manuals?|Magazines?|Firmware|Applications?|Samplers?|Catalogs?|Multimedia|Bonus|Coverdisk/i.test(
    id,
  );
}

/** TOSEC jouable : Games / Homebrew Games|Demos / Demos. */
function isTosecPlayableBrowse(id) {
  if (isTosecNoiseId(id)) return false;
  if (/\bHomebrew\b/i.test(id) && /\b(Games|Demos)\b/i.test(id)) return true;
  if (/(?:^| - )Games(?:$| - )/i.test(id)) return true;
  if (/(?:^| - )Demos(?:$| - )/i.test(id)) return true;
  return false;
}

function normalizeSource(source) {
  const s = (source || "").trim();
  if (/no-?intro/i.test(s)) return "No-Intro";
  if (/redump/i.test(s)) return "Redump";
  if (/tosec/i.test(s)) return "TOSEC";
  if (/hbmame/i.test(s)) return "HBMAME";
  if (/^mame$/i.test(s) || /\bmame\b/i.test(s)) return "MAME";
  return s || "Autres";
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

function loadFamilyMap() {
  const map = Object.create(null);
  const candidates = [
    familyMapPath,
    path.resolve(repoRoot, "..", "ScreenBox", "Core", "Shared", "Data", "systems.json"),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(p, "utf8"));
      if (data.systems && Array.isArray(data.systems)) {
        const catMap = {
          Arcade: "Arcade",
          Handheld: "Portables",
          Console: "Consoles",
          Computer: "Ordinateurs",
          Computers: "Ordinateurs",
          Pinball: "Flippers",
        };
        for (const s of data.systems) {
          const fam = catMap[s.category] || "Autres";
          for (const k of [s.id, s.pathFolder, ...(s.aliases || [])]) {
            if (k) map[String(k)] = fam;
          }
        }
      } else {
        Object.assign(map, data);
      }
      break;
    } catch {
      /* next */
    }
  }
  return map;
}

function resolveFamily(id, familyMap) {
  if (familyMap[id]) return familyMap[id];
  const idLower = id.toLowerCase();
  for (const [k, v] of Object.entries(familyMap)) {
    const key = String(k);
    if (idLower === key.toLowerCase()) return v;
  }
  // Match pathFolder-like substrings (longest first)
  const keys = Object.keys(familyMap).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (k.length < 3) continue;
    if (idLower.includes(String(k).toLowerCase())) return familyMap[k];
  }
  return heuristicFamily(id);
}

const sourceMode = resolveSourceMode();
let db;
let sourceLabel;
if (sourceMode === "turso") {
  console.log("[export-static-data] source=turso");
  db = await pullTursoIntoSqlJs();
  sourceLabel = "turso";
} else {
  if (!fs.existsSync(dbPath)) {
    const existing = path.join(outDir, "systems.json");
    if (fs.existsSync(existing)) {
      console.warn(
        `[export-static-data] DB absente (${dbPath}) — conservation de ${existing}`,
      );
      process.exit(0);
    }
    console.error(`[export-static-data] DB introuvable : ${dbPath}`);
    process.exit(1);
  }
  console.log(`[export-static-data] source=local ${dbPath}`);
  const SQL = await initSqlJs();
  db = new SQL.Database(fs.readFileSync(dbPath));
  sourceLabel = path.basename(dbPath);
}

fs.mkdirSync(bySystemDir, { recursive: true });

const systemsRs = db.exec(`
  SELECT s.id, s.source, s.version,
         COUNT(DISTINCT g.id) AS games,
         COUNT(r.id) AS roms
  FROM systems s
  LEFT JOIN games g ON g.system_id = s.id
  LEFT JOIN roms r ON r.game_id = g.id
  GROUP BY s.id
  ORDER BY s.id
`);

const cols = systemsRs[0]?.columns ?? [];
const rows = systemsRs[0]?.values ?? [];
const familyMap = loadFamilyMap();
/** Doublons catalogue : même DAT exposé sous un second id (à ignorer). */
const EXCLUDED_SYSTEM_IDS = new Set(["Sega - Mega Drive"]);

console.log("[export-static-data] calcul 1G1R…");
const namesBySystem = new Map();
const namesRs = db.exec(`
  SELECT g.system_id,
         COALESCE(
           (SELECT name FROM game_regions gr
            WHERE gr.game_id = g.id
            ORDER BY CASE gr.region
              WHEN 'europe' THEN 0 WHEN 'world' THEN 1 WHEN 'usa' THEN 2 WHEN 'japan' THEN 3 ELSE 9 END
            LIMIT 1),
           '(game)'
         ) AS name
  FROM games g
`);
for (const [systemId, name] of namesRs[0]?.values ?? []) {
  const id = String(systemId);
  let list = namesBySystem.get(id);
  if (!list) {
    list = [];
    namesBySystem.set(id, list);
  }
  list.push(String(name ?? ""));
}

const systems = rows
  .map((row) => {
    const o = Object.fromEntries(cols.map((c, i) => [c, row[i]]));
    const id = String(o.id);
    const source = normalizeSource(String(o.source ?? ""));
    const games = Number(o.games ?? 0);
    const names = namesBySystem.get(id) ?? [];
    return {
      id,
      source,
      family: resolveFamily(id, familyMap),
      version: o.version == null ? null : String(o.version),
      games,
      games1g1r: names.length > 0 ? count1g1r(names) : 0,
      roms: Number(o.roms ?? 0),
      slug: slugify(id),
    };
  })
  .filter((s) => !EXCLUDED_SYSTEM_IDS.has(s.id));

const metaRs = db.exec(`SELECT key, value FROM catalog_meta`);
const meta = {};
for (const row of metaRs[0]?.values ?? []) {
  meta[String(row[0])] = String(row[1]);
}

const index = {
  generatedUtc: new Date().toISOString(),
  sourceDb: sourceLabel,
  meta,
  totals: {
    systems: systems.length,
    games: systems.reduce((a, s) => a + s.games, 0),
    roms: systems.reduce((a, s) => a + s.roms, 0),
  },
  systems,
};

fs.writeFileSync(path.join(outDir, "systems.json"), JSON.stringify(index));

if (indexOnly && !siteExport) {
  console.log(
    `[export-static-data] OK (index-only) → ${systems.length} systèmes, ${index.totals.games} jeux, ${index.totals.roms} roms`,
  );
  db.close();
  process.exit(0);
}

const systemsForBySystem = siteExport
  ? systems.filter((s) => {
      if (s.source !== "TOSEC") return true;
      if (!isTosecPlayableBrowse(s.id)) return false;
      const fam = s.family || "Autres";
      return fam === "Consoles" || fam === "Portables";
    })
  : systems;

let exported = 0;
let exportedGamesOnly = 0;
for (const s of systemsForBySystem) {
  const gamesOnly = siteExport && s.source === "TOSEC";

  if (gamesOnly) {
    const stmt = db.prepare(`
      SELECT g.id AS game_id,
             (SELECT name FROM game_regions gr
              WHERE gr.game_id = g.id
              ORDER BY CASE gr.region
                WHEN 'europe' THEN 0 WHEN 'world' THEN 1 WHEN 'usa' THEN 2 WHEN 'japan' THEN 3 ELSE 9 END
              LIMIT 1) AS name,
             (SELECT group_concat(type, ',') FROM game_types gt WHERE gt.game_id = g.id) AS types,
             (SELECT group_concat(region, ',') FROM game_regions gr2 WHERE gr2.game_id = g.id) AS regions,
             (SELECT COUNT(*) FROM roms r WHERE r.game_id = g.id) AS rom_count
      FROM games g
      WHERE g.system_id = ?
      ORDER BY name COLLATE NOCASE
    `);
    stmt.bind([s.id]);
    const games = [];
    const roms = [];
    while (stmt.step()) {
      const r = stmt.getAsObject();
      const gameId = Number(r.game_id);
      const gameName = r.name == null ? `(game #${gameId})` : String(r.name);
      const types = r.types ? String(r.types).split(",") : [];
      const regions = r.regions ? String(r.regions).split(",") : [];
      const romCount = Number(r.rom_count ?? 0);
      games.push({ id: gameId, name: gameName, types, regions, roms: romCount });
      // Une ligne « jeu » pour le tableau site (pas chaque piste BIN/ISO).
      roms.push({
        gameId,
        game: gameName,
        rom: romCount <= 1 ? `${romCount} fichier` : `${romCount} fichiers`,
        types,
        regions,
        size: null,
        crc: null,
        md5: null,
        sha1: null,
      });
    }
    stmt.free();
    fs.writeFileSync(
      path.join(bySystemDir, `${s.slug}.json`),
      JSON.stringify({ id: s.id, source: s.source, mode: "games", games, roms }),
    );
    exported++;
    exportedGamesOnly++;
    continue;
  }

  const stmt = db.prepare(`
    SELECT g.id AS game_id,
           (SELECT name FROM game_regions gr
            WHERE gr.game_id = g.id
            ORDER BY CASE gr.region
              WHEN 'europe' THEN 0 WHEN 'world' THEN 1 WHEN 'usa' THEN 2 WHEN 'japan' THEN 3 ELSE 9 END
            LIMIT 1) AS name,
           (SELECT group_concat(type, ',') FROM game_types gt WHERE gt.game_id = g.id) AS types,
           (SELECT group_concat(region, ',') FROM game_regions gr2 WHERE gr2.game_id = g.id) AS regions,
           r.rom AS rom,
           r.size AS size,
           r.crc AS crc,
           r.md5 AS md5,
           r.sha1 AS sha1
    FROM games g
    LEFT JOIN roms r ON r.game_id = g.id
    WHERE g.system_id = ?
    ORDER BY name COLLATE NOCASE, rom COLLATE NOCASE
  `);
  stmt.bind([s.id]);
  const gamesMap = new Map();
  const roms = [];
  while (stmt.step()) {
    const r = stmt.getAsObject();
    const gameId = Number(r.game_id);
    const gameName = r.name == null ? `(game #${gameId})` : String(r.name);
    const types = r.types ? String(r.types).split(",") : [];
    const regions = r.regions ? String(r.regions).split(",") : [];
    if (!gamesMap.has(gameId)) {
      gamesMap.set(gameId, {
        id: gameId,
        name: gameName,
        types,
        regions,
        roms: 0,
      });
    }
    if (r.rom != null) {
      gamesMap.get(gameId).roms += 1;
      roms.push({
        gameId,
        game: gameName,
        rom: String(r.rom),
        types,
        regions,
        size: r.size == null ? null : Number(r.size),
        crc: r.crc == null ? null : String(r.crc),
        md5: r.md5 == null ? null : String(r.md5),
        sha1: r.sha1 == null ? null : String(r.sha1),
      });
    }
  }
  stmt.free();

  fs.writeFileSync(
    path.join(bySystemDir, `${s.slug}.json`),
    JSON.stringify({
      id: s.id,
      source: s.source,
      mode: "roms",
      games: [...gamesMap.values()],
      roms,
    }),
  );
  exported++;
}

db.close();
const mode = siteExport ? "site" : "full";
const gamesOnlyHint = exportedGamesOnly > 0 ? `, ${exportedGamesOnly} TOSEC games-only` : "";
console.log(
  `[export-static-data] OK (${mode}) → ${systems.length} systèmes, ${index.totals.games} jeux, ${index.totals.roms} roms (${exported} by-system${gamesOnlyHint})`,
);
