/**
 * Dump Turso → ../screenbox-catalogs.db (source cloud → snapshot Git/Desk).
 * Usage: npm run export:db
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pullTursoIntoSqlJs } from "./turso-pull.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outPath = process.env.CATALOGS_DB
  ? path.resolve(process.env.CATALOGS_DB)
  : path.join(repoRoot, "screenbox-catalogs.db");

const db = await pullTursoIntoSqlJs();
db.run(
  "INSERT INTO catalog_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ["exported_utc", new Date().toISOString()],
);

const data = db.export();
fs.writeFileSync(outPath, Buffer.from(data));
const check = db.exec(`
  SELECT
    (SELECT COUNT(*) FROM systems),
    (SELECT COUNT(*) FROM games),
    (SELECT COUNT(*) FROM roms)
`);
db.close();
console.log(
  `[export-db] OK → ${outPath} systems=${check[0].values[0][0]} games=${check[0].values[0][1]} roms=${check[0].values[0][2]}`,
);
