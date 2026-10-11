/**
 * Seed Turso depuis ../screenbox-catalogs.db (source locale → cloud).
 * Usage: npm run seed:turso
 *
 * Lit le SQLite par pages (évite OOM sur gros catalogues TOSEC).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import initSqlJs from "sql.js";
import { loadTursoEnv, CATALOG_SCHEMA_SQL } from "./turso-env.mjs";

const BATCH = Number(process.env.TURSO_SEED_BATCH || 150);
const PAGE = Number(process.env.TURSO_SEED_PAGE || 2000);
const MAX_RETRIES = 6;
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
console.log(`[seed-turso] lecture ${dbPath}…`);
const local = new SQL.Database(fs.readFileSync(dbPath));

async function withRetry(label, fn) {
  let last;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const wait = Math.min(30_000, 1000 * 2 ** (attempt - 1));
      console.warn(
        `[seed-turso] retry ${attempt}/${MAX_RETRIES} ${label}: ${e?.message || e} (wait ${wait}ms)`,
      );
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw last;
}

async function execSchema() {
  for (const stmt of CATALOG_SCHEMA_SQL.split(";")
    .map((s) => s.trim())
    .filter(Boolean)) {
    await withRetry(`schema:${stmt.slice(0, 40)}`, () => remote.execute(stmt));
  }
}

async function wipe() {
  // DROP est bien plus fiable que DELETE massif sur Turso.
  for (const t of ["roms", "game_types", "game_regions", "games", "systems", "catalog_meta"]) {
    await withRetry(`drop ${t}`, () => remote.execute(`DROP TABLE IF EXISTS ${t}`));
  }
}

function pageRows(sql, bind = []) {
  const stmt = local.prepare(sql);
  if (bind.length) stmt.bind(bind);
  const rows = [];
  while (stmt.step()) rows.push(stmt.get());
  stmt.free();
  return rows;
}

function countTable(table) {
  const rs = local.exec(`SELECT COUNT(*) FROM ${table}`);
  return Number(rs[0]?.values?.[0]?.[0] ?? 0);
}

async function insertPage(table, columns, rows, toArgs) {
  if (rows.length === 0) return;
  const placeholders = columns.map(() => "?").join(", ");
  const sql = `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    await withRetry(`${table}+${i}`, () =>
      remote.batch(
        chunk.map((row) => ({ sql, args: toArgs(row) })),
        "write",
      ),
    );
  }
}

async function copyPaged(table, columns, orderBy, toArgs) {
  const total = countTable(table);
  let done = 0;
  console.log(`[seed-turso] ${table}: 0/${total}`);
  for (let offset = 0; ; offset += PAGE) {
    const cols = columns.join(", ");
    const rows = pageRows(
      `SELECT ${cols} FROM ${table} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
      [PAGE, offset],
    );
    if (rows.length === 0) break;
    await insertPage(table, columns, rows, toArgs);
    done += rows.length;
    console.log(`[seed-turso] ${table}: ${done}/${total}`);
    if (rows.length < PAGE) break;
  }
  return done;
}

console.log(`[seed-turso] remote=${url.replace(/\/\/.*@/, "//***@")}`);
await wipe();
await execSchema();

await copyPaged("systems", ["id", "source", "version"], "id", (r) => [r[0], r[1], r[2]]);

// parent_game_id auto-réf. : null d’abord, puis UPDATE
await copyPaged("games", ["id", "system_id", "parent_game_id"], "id", (r) => [
  r[0],
  r[1],
  null,
]);
{
  const parents = pageRows(
    "SELECT id, parent_game_id FROM games WHERE parent_game_id IS NOT NULL ORDER BY id",
  );
  if (parents.length) {
    console.log(`[seed-turso] games parents: 0/${parents.length}`);
    for (let i = 0; i < parents.length; i += BATCH) {
      const chunk = parents.slice(i, i + BATCH);
      await withRetry(`parents+${i}`, () =>
        remote.batch(
          chunk.map((r) => ({
            sql: "UPDATE games SET parent_game_id = ? WHERE id = ?",
            args: [r[1], r[0]],
          })),
          "write",
        ),
      );
      console.log(
        `[seed-turso] games parents: ${Math.min(i + chunk.length, parents.length)}/${parents.length}`,
      );
    }
  }
}

await copyPaged("game_types", ["game_id", "type"], "game_id, type", (r) => [r[0], r[1]]);
await copyPaged("game_regions", ["game_id", "region", "name", "release"], "game_id, region", (r) => [
  r[0],
  r[1],
  r[2],
  r[3],
]);
await copyPaged("roms", ["id", "game_id", "rom", "size", "crc", "md5", "sha1"], "id", (r) => [
  r[0],
  r[1],
  r[2],
  r[3],
  r[4],
  r[5],
  r[6],
]);
await copyPaged("catalog_meta", ["key", "value"], "key", (r) => [r[0], r[1]]);
await withRetry("seeded_utc", () =>
  remote.execute({
    sql: "INSERT INTO catalog_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    args: ["seeded_utc", new Date().toISOString()],
  }),
);

const check = await remote.execute(`
  SELECT
    (SELECT COUNT(*) FROM systems) AS systems,
    (SELECT COUNT(*) FROM games) AS games,
    (SELECT COUNT(*) FROM roms) AS roms
`);
const c = check.rows[0];
console.log(`[seed-turso] OK → systems=${c.systems} games=${c.games} roms=${c.roms}`);
local.close();
