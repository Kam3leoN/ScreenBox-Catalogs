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

function slugify(id) {
  return id
    .trim()
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 180);
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
const systems = rows.map((row) => {
  const o = Object.fromEntries(cols.map((c, i) => [c, row[i]]));
  return {
    id: String(o.id),
    source: String(o.source ?? ""),
    version: o.version == null ? null : String(o.version),
    games: Number(o.games ?? 0),
    roms: Number(o.roms ?? 0),
    slug: slugify(String(o.id)),
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
