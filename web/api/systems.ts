import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@libsql/client";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/** Prefer Turso live DB; fallback to build-time static export. */
export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (url) {
    const client = createClient({ url, authToken });
    const rs = await client.execute(`
      SELECT s.id, s.source, COUNT(g.id) AS games
      FROM systems s
      LEFT JOIN games g ON g.system_id = s.id
      GROUP BY s.id
      ORDER BY s.id
      LIMIT 500
    `);
    const systems = rs.rows.map((row) => ({
      id: String(row.id),
      source: String(row.source),
      games: Number(row.games ?? 0),
    }));
    res.status(200).json({ systems, source: "turso" });
    return;
  }

  const staticPath = join(process.cwd(), "public", "data", "systems.json");
  if (existsSync(staticPath)) {
    const data = JSON.parse(readFileSync(staticPath, "utf8"));
    res.status(200).json({ ...data, source: "static" });
    return;
  }

  res.status(200).json({ systems: [], note: "No Turso and no public/data/systems.json" });
}
