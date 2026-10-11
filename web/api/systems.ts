import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@libsql/client";

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) {
    res.status(200).json({ systems: [], note: "TURSO_DATABASE_URL unset" });
    return;
  }

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

  res.status(200).json({ systems });
}
