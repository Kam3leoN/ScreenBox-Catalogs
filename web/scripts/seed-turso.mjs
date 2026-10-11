/**
 * Seed Turso depuis ../screenbox-catalogs.db (source locale → cloud).
 * Usage: npm run seed:turso
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import initSqlJs from "sql.js";
import { loadTursoEnv, CATALOG_SCHEMA_SQL } from "./turso-env.mjs";

const BATCH = Number(process.env.TURSO_SEED_BATCH || 200);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dbPath = process.env.CATALOGS_DB
  ? path.resolve(process.env.CATALOGS_DB)
  : path.join(repoRoot, "screenbox-catalogs.db");

const { url, authToken } = loadTursoEnv();
if (!fs.existsSync(dbPath)) {
  console.error(`[seed-turso] DB introuvable : ${dbPath}`);
  process.exit(1);
}

const remote = createClient({ url, authToken });
const SQL = await initSqlJs();
const local = new SQL.Database(fs.readFileSync(dbPath));

function allRows(sql) {
  const rs = local.exec(sql);
  if (!rs[0]) return { columns: [], values: [] };
  return { columns: rs[0].columns, values: rs[0].values };
}

async function execSchema() {
  for (const stmt of CATALOG_SCHEMA_SQL.split(";")
    .map((s) => s.trim())
    .filter(Boolean)) {
    await remote.execute(stmt);
  }
}

async function wipe() {
  // Ordre anti-FK
  for (const t of ["roms", "game_types", "game_regions", "games", "systems", "catalog_meta"]) {
    await remote.execute(`DELETE FROM ${t}`);
  }
}

async function insertBatched(table, columns, values, toArgs) {
  let done = 0;
  const total = values.length;
  const placeholders = columns.map(() => "?").join(", ");
  const sql = `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`;
  for (let i = 0; i < values.length; i += BATCH) {
    const chunk = values.slice(i, i + BATCH);
    await remote.batch(
      chunk.map((row) => ({ sql, args: toArgs(row) })),
      "write",
    );
    done += chunk.length;
    if (done === total || done % (BATCH * 10) === 0 || done <= BATCH) {
      console.log(`[seed-turso] ${table}: ${done}/${total}`);
    }
  }
}

console.log(`[seed-turso] local=${dbPath}`);
console.log(`[seed-turso] remote=${url.replace(/\/\/.*@/, "//***@")}`);

await execSchema();
await wipe();

const systems = allRows("SELECT id, source, version FROM systems");
await insertBatched("systems", ["id", "source", "version"], systems.values, (r) => [
  r[0],
  r[1],
  r[2],
]);

// parent_game_id est auto-référentiel : insert sans parent, puis UPDATE.
const games = allRows("SELECT id, system_id, parent_game_id FROM games");
await insertBatched("games", ["id", "system_id", "parent_game_id"], games.values, (r) => [
  r[0],
  r[1],
  null,
]);
const withParent = games.values.filter((r) => r[2] != null);
if (withParent.length) {
  console.log(`[seed-turso] games parents: 0/${withParent.length}`);
  for (let i = 0; i < withParent.length; i += BATCH) {
    const chunk = withParent.slice(i, i + BATCH);
    await remote.batch(
      chunk.map((r) => ({
        sql: "UPDATE games SET parent_game_id = ? WHERE id = ?",
        args: [r[2], r[0]],
      })),
      "write",
    );
    console.log(
      `[seed-turso] games parents: ${Math.min(i + chunk.length, withParent.length)}/${withParent.length}`,
    );
  }
}

const types = allRows("SELECT game_id, type FROM game_types");
await insertBatched("game_types", ["game_id", "type"], types.values, (r) => [r[0], r[1]]);

const regions = allRows("SELECT game_id, region, name, release FROM game_regions");
await insertBatched(
  "game_regions",
  ["game_id", "region", "name", "release"],
  regions.values,
  (r) => [r[0], r[1], r[2], r[3]],
);

const roms = allRows("SELECT id, game_id, rom, size, crc, md5, sha1 FROM roms");
await insertBatched(
  "roms",
  ["id", "game_id", "rom", "size", "crc", "md5", "sha1"],
  roms.values,
  (r) => [r[0], r[1], r[2], r[3], r[4], r[5], r[6]],
);

const meta = allRows("SELECT key, value FROM catalog_meta");
await insertBatched("catalog_meta", ["key", "value"], meta.values, (r) => [r[0], r[1]]);
await remote.execute({
  sql: "INSERT INTO catalog_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  args: ["seeded_utc", new Date().toISOString()],
});

const check = await remote.execute(`
  SELECT
    (SELECT COUNT(*) FROM systems) AS systems,
    (SELECT COUNT(*) FROM games) AS games,
    (SELECT COUNT(*) FROM roms) AS roms,
    (SELECT COUNT(*) FROM game_regions) AS regions,
    (SELECT COUNT(*) FROM game_types) AS types
`);
const c = check.rows[0];
console.log(
  `[seed-turso] OK → systems=${c.systems} games=${c.games} roms=${c.roms} regions=${c.regions} types=${c.types}`,
);
local.close();
