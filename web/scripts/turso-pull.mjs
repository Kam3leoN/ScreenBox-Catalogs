/**
 * Charge les tables catalogue Turso dans une Database sql.js en mémoire.
 */
import { createClient } from "@libsql/client";
import initSqlJs from "sql.js";
import { loadTursoEnv, CATALOG_SCHEMA_SQL } from "./turso-env.mjs";

const PAGE = Number(process.env.TURSO_EXPORT_PAGE || 2000);

export async function pullTursoIntoSqlJs() {
  const { url, authToken } = loadTursoEnv();
  const remote = createClient({ url, authToken });
  const SQL = await initSqlJs();
  const db = new SQL.Database();

  for (const stmt of CATALOG_SCHEMA_SQL.split(";")
    .map((s) => s.trim())
    .filter(Boolean)) {
    db.run(stmt);
  }

  async function copyTable(table, columns, orderBy) {
    let offset = 0;
    let total = 0;
    const cols = columns.join(", ");
    const placeholders = columns.map(() => "?").join(", ");
    const insertSql = `INSERT INTO ${table} (${cols}) VALUES (${placeholders})`;
    for (;;) {
      const rs = await remote.execute({
        sql: `SELECT ${cols} FROM ${table} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
        args: [PAGE, offset],
      });
      if (rs.rows.length === 0) break;
      for (const row of rs.rows) {
        db.run(
          insertSql,
          columns.map((c) => row[c] ?? null),
        );
      }
      total += rs.rows.length;
      offset += rs.rows.length;
      if (total % (PAGE * 5) === 0 || rs.rows.length < PAGE) {
        console.log(`[turso-pull] ${table}: ${total}`);
      }
      if (rs.rows.length < PAGE) break;
    }
    return total;
  }

  console.log(`[turso-pull] ${url.replace(/\/\/.*@/, "//***@")}`);
  await copyTable("systems", ["id", "source", "version"], "id");
  await copyTable("games", ["id", "system_id", "parent_game_id"], "id");
  await copyTable("game_types", ["game_id", "type"], "game_id, type");
  await copyTable(
    "game_regions",
    ["game_id", "region", "name", "release"],
    "game_id, region",
  );
  await copyTable("roms", ["id", "game_id", "rom", "size", "crc", "md5", "sha1"], "id");
  await copyTable("catalog_meta", ["key", "value"], "key");
  return db;
}
