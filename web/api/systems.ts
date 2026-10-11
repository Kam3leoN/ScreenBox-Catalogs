import type { VercelRequest, VercelResponse } from "@vercel/node";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/** Index catalogue statique (Turso abandonné — DB trop volumineuse). */
export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const staticPath = join(process.cwd(), "public", "data", "systems.json");
  if (existsSync(staticPath)) {
    const data = JSON.parse(readFileSync(staticPath, "utf8"));
    res.status(200).json({ ...data, source: "static" });
    return;
  }

  res.status(200).json({
    systems: [],
    note: "public/data/systems.json manquant — lancer npm run export:data:index",
  });
}
