/**
 * Charge web/.env.local (TURSO_*) sans dépendance dotenv.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function loadTursoEnv() {
  const envPath = path.join(webRoot, ".env.local");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i <= 0) continue;
      const key = t.slice(0, i).trim();
      let val = t.slice(i + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env) || process.env[key] === "") {
        process.env[key] = val;
      }
    }
  }
  const url = process.env.TURSO_DATABASE_URL || "";
  const authToken = process.env.TURSO_AUTH_TOKEN || "";
  if (!url) {
    throw new Error("TURSO_DATABASE_URL manquant (.env.local ou env)");
  }
  return { url, authToken: authToken || undefined, webRoot };
}

export const CATALOG_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS catalog_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS systems (
  id TEXT PRIMARY KEY NOT NULL,
  source TEXT NOT NULL,
  version TEXT
);
CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY,
  system_id TEXT NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
  parent_game_id INTEGER NULL REFERENCES games(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS game_types (
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  PRIMARY KEY (game_id, type)
);
CREATE TABLE IF NOT EXISTS game_regions (
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  region TEXT NOT NULL,
  name TEXT NOT NULL,
  release INTEGER NULL,
  PRIMARY KEY (game_id, region)
);
CREATE TABLE IF NOT EXISTS roms (
  id INTEGER PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  rom TEXT NOT NULL,
  size INTEGER NULL,
  crc TEXT NULL,
  md5 TEXT NULL,
  sha1 TEXT NULL
);
CREATE INDEX IF NOT EXISTS ix_roms_sha1 ON roms(sha1);
CREATE INDEX IF NOT EXISTS ix_roms_md5 ON roms(md5);
CREATE INDEX IF NOT EXISTS ix_roms_crc ON roms(crc);
CREATE INDEX IF NOT EXISTS ix_games_system ON games(system_id);
CREATE INDEX IF NOT EXISTS ix_roms_game ON roms(game_id);
`;
