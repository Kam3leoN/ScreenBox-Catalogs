import { md5Hex } from "./md5";
import "./styles.css";

type SystemRow = {
  id: string;
  source: string;
  games: number;
  roms: number;
  slug: string;
};

type CatalogIndex = {
  totals: { systems: number; games: number; roms: number };
  systems: SystemRow[];
};

type RomRow = {
  gameId: number;
  game: string;
  rom: string;
  types: string[];
  regions: string[];
  size: number | null;
  crc: string | null;
  md5: string | null;
  sha1: string | null;
};

let catalog: CatalogIndex | null = null;
let activeSystem: SystemRow | null = null;
let activeRoms: RomRow[] = [];

function $(id: string): HTMLElement | null {
  return document.getElementById(id);
}

async function loadSystems(): Promise<void> {
  const empty = $("systemsEmpty");
  const summary = $("catalogSummary");

  try {
    const res = await fetch("/data/systems.json");
    if (!res.ok) throw new Error(String(res.status));
    catalog = (await res.json()) as CatalogIndex;
    if (summary) {
      summary.textContent = `${catalog.totals.systems} systèmes · ${catalog.totals.games.toLocaleString("fr-FR")} jeux · ${catalog.totals.roms.toLocaleString("fr-FR")} roms`;
    }
    renderSystems(($("q") as HTMLInputElement | null)?.value ?? "");
    if (empty) empty.hidden = catalog.systems.length > 0;
  } catch (err) {
    if (empty) {
      empty.hidden = false;
      empty.textContent = `Catalogue statique indisponible (${err instanceof Error ? err.message : err}).`;
    }
  }
}

function renderSystems(query: string): void {
  const grid = $("systems");
  if (!grid || !catalog) return;
  const q = query.trim().toLowerCase();
  grid.innerHTML = "";

  const filtered = catalog.systems.filter(
    (s) =>
      q.length === 0 ||
      s.id.toLowerCase().includes(q) ||
      s.source.toLowerCase().includes(q),
  );

  for (const s of filtered) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "system-card" + (activeSystem?.slug === s.slug ? " is-active" : "");
    btn.innerHTML = `
      <div class="system-card__title">${escapeHtml(s.id)}</div>
      <div class="system-card__meta">${escapeHtml(s.source)}</div>
      <div class="system-card__stats">${s.games.toLocaleString("fr-FR")} jeux · ${s.roms.toLocaleString("fr-FR")} roms</div>
    `;
    btn.addEventListener("click", () => void openSystem(s));
    grid.appendChild(btn);
  }

  const empty = $("systemsEmpty");
  if (empty) empty.hidden = filtered.length > 0;

  if (activeSystem) renderRomsTable(query);
}

async function openSystem(s: SystemRow): Promise<void> {
  const panel = $("gamesPanel");
  const title = $("gamesTitle");
  const body = $("romsBody");
  const count = $("gamesCount");
  const gamesEmpty = $("gamesEmpty");
  if (!panel || !title || !body) return;

  activeSystem = s;
  panel.hidden = false;
  title.textContent = s.id;
  body.innerHTML = `<tr><td colspan="7">Chargement…</td></tr>`;
  if (gamesEmpty) gamesEmpty.hidden = true;
  if (count) count.textContent = "";
  renderSystems(($("q") as HTMLInputElement | null)?.value ?? "");

  try {
    const res = await fetch(`/data/by-system/${encodeURIComponent(s.slug)}.json`);
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { roms?: RomRow[]; games?: { name: string }[] };
    activeRoms = Array.isArray(data.roms) ? data.roms : [];
    renderRomsTable(($("q") as HTMLInputElement | null)?.value ?? "");
  } catch (err) {
    activeRoms = [];
    body.innerHTML = "";
    if (gamesEmpty) {
      gamesEmpty.hidden = false;
      gamesEmpty.textContent = `Impossible de charger les ROMs (${err instanceof Error ? err.message : err}).`;
    }
  }

  panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderRomsTable(query: string): void {
  const body = $("romsBody");
  const count = $("gamesCount");
  const gamesEmpty = $("gamesEmpty");
  if (!body || !activeSystem) return;

  const q = query.trim().toLowerCase();
  const rows = activeRoms.filter(
    (r) =>
      q.length === 0 ||
      r.game.toLowerCase().includes(q) ||
      r.rom.toLowerCase().includes(q) ||
      (r.crc ?? "").toLowerCase().includes(q) ||
      (r.md5 ?? "").toLowerCase().includes(q) ||
      (r.sha1 ?? "").toLowerCase().includes(q) ||
      r.types.some((t) => t.toLowerCase().includes(q)),
  );

  body.innerHTML = "";
  const limit = 2500;
  for (const r of rows.slice(0, limit)) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(r.game)}</td>
      <td>${escapeHtml(r.rom)}</td>
      <td>${r.types.map((t) => `<span class="chip">${escapeHtml(t)}</span>`).join("")}</td>
      <td>${escapeHtml(r.regions.join(", "))}</td>
      <td class="mono">${escapeHtml(r.crc ?? "—")}</td>
      <td class="mono">${escapeHtml(shortHash(r.md5))}</td>
      <td class="mono">${escapeHtml(shortHash(r.sha1))}</td>
    `;
    body.appendChild(tr);
  }

  if (rows.length > limit) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="7" style="opacity:.7">… +${rows.length - limit} autres (affinez la recherche)</td>`;
    body.appendChild(tr);
  }

  if (count) count.textContent = `${rows.length.toLocaleString("fr-FR")} ROM(s)`;
  if (gamesEmpty) gamesEmpty.hidden = rows.length > 0;
}

function shortHash(h: string | null): string {
  if (!h) return "—";
  return h.length > 16 ? `${h.slice(0, 8)}…${h.slice(-4)}` : h;
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function hashFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const md5 = md5Hex(bytes);
  const sha1 = await cryptoSubtleHex("SHA-1", buf);
  const crc = crc32Hex(bytes);
  return [
    `file: ${file.name}`,
    `size: ${file.size}`,
    `crc:  ${crc}`,
    `md5:  ${md5}`,
    `sha1: ${sha1}`,
  ].join("\n");
}

async function cryptoSubtleHex(algo: AlgorithmIdentifier, data: ArrayBuffer): Promise<string> {
  const dig = await crypto.subtle.digest(algo, data);
  return [...new Uint8Array(dig)].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function crc32Hex(data: Uint8Array): string {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c ^= data[i]!;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ((~c) >>> 0).toString(16).padStart(8, "0").toUpperCase();
}

function wireDrop(): void {
  const zone = $("drop");
  const out = $("hashOut");
  if (!zone || !out) return;
  zone.addEventListener("dragover", (e) => e.preventDefault());
  zone.addEventListener("drop", async (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    out.textContent = "Hash…";
    out.textContent = await hashFile(file);
  });
  zone.addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      out.textContent = "Hash…";
      out.textContent = await hashFile(file);
    };
    input.click();
  });
}

$("btnTheme")?.addEventListener("click", () => {
  document.documentElement.classList.toggle("dark");
});

$("q")?.addEventListener("input", (e) => {
  const v = (e.target as HTMLInputElement).value;
  renderSystems(v);
});

wireDrop();
void loadSystems();
