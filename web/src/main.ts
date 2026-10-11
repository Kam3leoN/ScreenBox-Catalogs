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

type GameRow = {
  id: number;
  name: string;
  types: string[];
  regions: { region: string; name: string }[];
  roms: number;
};

let catalog: CatalogIndex | null = null;

function $(id: string): HTMLElement | null {
  return document.getElementById(id);
}

async function loadSystems(): Promise<void> {
  const list = $("systems");
  const empty = $("systemsEmpty");
  const summary = $("catalogSummary");
  if (!list) return;

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
      empty.textContent = `Catalogue statique indisponible (${err instanceof Error ? err.message : err}). Relancez npm run export:data.`;
    }
  }
}

function renderSystems(query: string): void {
  const list = $("systems");
  if (!list || !catalog) return;
  const q = query.trim().toLowerCase();
  list.innerHTML = "";

  const filtered = catalog.systems.filter(
    (s) =>
      q.length === 0 ||
      s.id.toLowerCase().includes(q) ||
      s.source.toLowerCase().includes(q),
  );

  for (const s of filtered) {
    const li = document.createElement("li");
    li.className = "list-item system-row";
    li.tabIndex = 0;
    li.style.cursor = "pointer";
    li.innerHTML = `<strong>${escapeHtml(s.id)}</strong> <span style="opacity:.7">${escapeHtml(s.source)}</span> — ${s.games.toLocaleString("fr-FR")} jeux / ${s.roms.toLocaleString("fr-FR")} roms`;
    li.addEventListener("click", () => void openSystem(s));
    li.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        void openSystem(s);
      }
    });
    list.appendChild(li);
  }

  const empty = $("systemsEmpty");
  if (empty) empty.hidden = filtered.length > 0;
}

async function openSystem(s: SystemRow): Promise<void> {
  const panel = $("gamesPanel");
  const title = $("gamesTitle");
  const gamesList = $("games");
  const gamesEmpty = $("gamesEmpty");
  if (!panel || !title || !gamesList) return;

  panel.hidden = false;
  title.textContent = s.id;
  gamesList.innerHTML = "<li class=\"list-item\">Chargement…</li>";
  if (gamesEmpty) gamesEmpty.hidden = true;

  try {
    const res = await fetch(`/data/by-system/${encodeURIComponent(s.slug)}.json`);
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { games: GameRow[] };
    const q = (($("q") as HTMLInputElement | null)?.value ?? "").trim().toLowerCase();
    const games = data.games.filter(
      (g) =>
        q.length === 0 ||
        g.name.toLowerCase().includes(q) ||
        g.types.some((t) => t.toLowerCase().includes(q)),
    );
    gamesList.innerHTML = "";
    for (const g of games.slice(0, 2000)) {
      const li = document.createElement("li");
      li.className = "list-item";
      const types = g.types.length ? ` [${g.types.join(", ")}]` : "";
      li.textContent = `${g.name}${types} — ${g.roms} rom(s)`;
      gamesList.appendChild(li);
    }
    if (games.length > 2000) {
      const more = document.createElement("li");
      more.className = "list-item";
      more.style.opacity = "0.7";
      more.textContent = `… +${games.length - 2000} autres (affinez la recherche)`;
      gamesList.appendChild(more);
    }
    if (gamesEmpty) gamesEmpty.hidden = games.length > 0;
  } catch (err) {
    gamesList.innerHTML = "";
    if (gamesEmpty) {
      gamesEmpty.hidden = false;
      gamesEmpty.textContent = `Impossible de charger les jeux (${err instanceof Error ? err.message : err}).`;
    }
  }

  panel.scrollIntoView({ behavior: "smooth", block: "start" });
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
  const md5 = await cryptoSubtleHex("MD5", buf).catch(() => "(MD5 non dispo dans ce navigateur)");
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
