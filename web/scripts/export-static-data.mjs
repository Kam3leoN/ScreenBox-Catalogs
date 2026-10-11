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
           (SELECT group_concat(region || ':' || name, '|') FROM game_regions gr2 WHERE gr2.game_id = g.id) AS regions,
           (SELECT COUNT(*) FROM roms r WHERE r.game_id = g.id) AS rom_count
    FROM games g
    WHERE g.system_id = ?
    ORDER BY name COLLATE NOCASE
  `);
  stmt.bind([s.id]);
  const games = [];
  while (stmt.step()) {
    const r = stmt.getAsObject();
    games.push({
      id: Number(r.game_id),
      name: r.name == null ? `(game #${r.game_id})` : String(r.name),
      types: r.types ? String(r.types).split(",") : [],
      regions: r.regions
        ? String(r.regions).split("|").map((x) => {
            const i = x.indexOf(":");
            return i < 0 ? { region: x, name: x } : { region: x.slice(0, i), name: x.slice(i + 1) };
          })
        : [],
      roms: Number(r.rom_count ?? 0),
    });
  }
  stmt.free();

  fs.writeFileSync(
    path.join(bySystemDir, `${s.slug}.json`),
    JSON.stringify({ id: s.id, source: s.source, games }),
  );
  exported++;
}

db.close();
console.log(
  `[export-static-data] OK → ${systems.length} systèmes, ${index.totals.games} jeux, ${index.totals.roms} roms (${exported} fichiers)`,
);
