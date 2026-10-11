/**
 * Sync K3UI build artifacts into public/k3ui (same pattern as startpage).
 * Requires sibling ../K3ui built, or K3UI_ROOT.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const k3uiRoot = process.env.K3UI_ROOT
  ? path.resolve(process.env.K3UI_ROOT)
  : path.resolve(root, "..", "..", "K3ui");
const dest = path.join(root, "public", "k3ui");
const distJs = path.join(k3uiRoot, "dist", "js");
const distCss = path.join(k3uiRoot, "dist", "css");

if (!fs.existsSync(path.join(distCss, "k3ui.min.css")) || !fs.existsSync(path.join(distJs, "k3ui.min.js"))) {
  console.error(`[sync-k3ui] Build K3ui first (npm run build:ci in ${k3uiRoot})`);
  process.exit(1);
}

fs.mkdirSync(dest, { recursive: true });
fs.copyFileSync(path.join(distCss, "k3ui.min.css"), path.join(dest, "k3ui.min.css"));
for (const name of fs.readdirSync(distJs)) {
  if (!/^k3ui.*\.js$/i.test(name) || name === "k3ui.js") continue;
  fs.copyFileSync(path.join(distJs, name), path.join(dest, name));
}

let sha = "unknown";
try {
  sha = execSync("git rev-parse --short HEAD", { cwd: k3uiRoot, encoding: "utf8" }).trim();
} catch {
  /* ignore */
}
fs.writeFileSync(path.join(dest, "VERSION.txt"), `k3ui@${sha} (synced ${new Date().toISOString()})\n`);
console.log(`[sync-k3ui] OK → ${dest} (k3ui@${sha})`);
