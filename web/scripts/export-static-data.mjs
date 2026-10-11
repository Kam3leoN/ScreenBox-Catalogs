/**
 * Exporte le snapshot ../screenbox-catalogs.db → public/data/*.json
 * (browse Vercel sans Turso).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(root, "..");
const dbPath = process.env.CATALOGS_DB
  ? path.resolve(process.env.CATALOGS_DB)
  : path.join(repoRoot, "screenbox-catalogs.db");
const outDir = path.join(root, "public", "data");
const bySystemDir = path.join(outDir, "by-system");
const familyMapPath = path.join(root, "data", "system_family_map.json");

function slugify(id) {
  return id
    .trim()
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 180);
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

if (!fs.existsSync(dbPath)) {
  console.error(`[export-static-data] DB introuvable : ${dbPath}`);
  process.exit(1);
}

const SQL = await initSqlJs();
const filebuffer = fs.readFileSync(dbPath);
const db = new SQL.Database(filebuffer);

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
const systems = rows.map((row) => {
  const o = Object.fromEntries(cols.map((c, i) => [c, row[i]]));
  const id = String(o.id);
  const source = normalizeSource(String(o.source ?? ""));
  return {
    id,
    source,
    family: resolveFamily(id, familyMap),
    version: o.version == null ? null : String(o.version),
    games: Number(o.games ?? 0),
    roms: Number(o.roms ?? 0),
    slug: slugify(id),
  };
});

const metaRs = db.exec(`SELECT key, value FROM catalog_meta`);
const meta = {};
for (const row of metaRs[0]?.values ?? []) {
  meta[String(row[0])] = String(row[1]);
}

const index = {
  generatedUtc: new Date().toISOString(),
  sourceDb: path.basename(dbPath),
  meta,
  totals: {
    systems: systems.length,
    games: systems.reduce((a, s) => a + s.games, 0),
    roms: systems.reduce((a, s) => a + s.roms, 0),
  },
  systems,
};

fs.writeFileSync(path.join(outDir, "systems.json"), JSON.stringify(index));

let exported = 0;
for (const s of systems) {
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
      games: [...gamesMap.values()],
      roms,
    }),
  );
  exported++;
}

db.close();
console.log(
  `[export-static-data] OK → ${systems.length} systèmes, ${index.totals.games} jeux, ${index.totals.roms} roms (${exported} fichiers)`,
);
