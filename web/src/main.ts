import { md5Hex } from "./md5";
import "./styles.css";

const RELEASE_URL = "https://github.com/Kam3leoN/ScreenBox-Catalogs/releases/latest";
const PAGE_SIZE = 48;

const SOURCE_FILTERS = ["No-Intro", "TOSEC", "MAME", "HBMAME", "Redump"] as const;
const FAMILY_FILTERS = ["Arcade", "Consoles", "Portables", "Ordinateurs", "Flippers", "Autres"] as const;

type SystemRow = {
  id: string;
  source: string;
  family?: string;
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

type ChipDatum = {
  id?: string;
  text?: string;
  value?: string;
  type?: string;
  selected?: boolean;
};

type ChipInstance = {
  getData: () => ChipDatum[];
};

type K3Api = {
  Chip: {
    init: (el: string | HTMLElement, options?: Record<string, unknown>) => unknown;
    getInstance: (el: HTMLElement) => ChipInstance | null;
  };
  ThemeManager?: {
    toggle?: () => void;
    setTheme: (theme: string) => void;
    isDark: () => boolean;
    currentTheme?: string;
  };
  Snackbar?: {
    show: (opts: { text: string }) => void;
  };
};

declare global {
  interface Window {
    K?: K3Api;
  }
}

let catalog: CatalogIndex | null = null;
let activeSystem: SystemRow | null = null;
let activeRoms: RomRow[] = [];
let filteredSystems: SystemRow[] = [];
let visibleCount = PAGE_SIZE;

function $(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function waitForK(): Promise<K3Api> {
  return new Promise((resolve) => {
    const tick = (): void => {
      const k = window.K;
      if (k?.Chip?.init) {
        resolve(k);
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
  });
}

function snack(text: string): void {
  window.K?.Snackbar?.show?.({ text });
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function shortHash(h: string | null): string {
  if (!h) return "—";
  return h.length > 16 ? `${h.slice(0, 8)}…${h.slice(-4)}` : h;
}

function getSearchQuery(): string {
  const host = $("q");
  if (!host) return "";
  const input = host.querySelector("input") as HTMLInputElement | null;
  return input?.value ?? "";
}

function selectedChipTexts(containerId: string): string[] {
  const el = $(containerId);
  if (!el || !window.K?.Chip?.getInstance) return [];
  const inst = window.K.Chip.getInstance(el);
  if (!inst?.getData) return [];
  return inst
    .getData()
    .filter((c) => c.selected)
    .map((c) => (c.text || c.value || "").trim())
    .filter(Boolean);
}

function filterActive(selected: string[], all: readonly string[]): boolean {
  return selected.length > 0 && selected.length < all.length;
}

function matchesFilters(s: SystemRow, query: string): boolean {
  const sources = selectedChipTexts("sourceFilters");
  const families = selectedChipTexts("familyFilters");
  const family = s.family || "Autres";

  if (filterActive(sources, SOURCE_FILTERS) && !sources.includes(s.source)) return false;
  if (filterActive(families, FAMILY_FILTERS) && !families.includes(family)) return false;

  const q = query.trim().toLowerCase();
  if (q.length === 0) return true;
  return (
    s.id.toLowerCase().includes(q) ||
    s.source.toLowerCase().includes(q) ||
    family.toLowerCase().includes(q)
  );
}

function initFilterChips(k: K3Api): void {
  const onSelect = (): void => {
    visibleCount = PAGE_SIZE;
    renderSystems(getSearchQuery());
  };

  // Chip.init attend un HTMLElement (pas un sélecteur string — sinon .length itère les caractères).
  const sourceEl = $("sourceFilters");
  const familyEl = $("familyFilters");
  if (sourceEl) {
    k.Chip.init(sourceEl, {
      data: SOURCE_FILTERS.map((text) => ({
        id: text,
        text,
        type: "filter",
        selected: false,
      })),
      onChipSelect: onSelect,
    });
  }
  if (familyEl) {
    k.Chip.init(familyEl, {
      data: FAMILY_FILTERS.map((text) => ({
        id: text,
        text,
        type: "filter",
        selected: false,
      })),
      onChipSelect: onSelect,
    });
  }
}

function createSystemCard(s: SystemRow): HTMLElement {
  const family = s.family || "Autres";
  const col = document.createElement("div");
  col.className = "s12 m6 l3";
  const card = document.createElement("article");
  card.className = "card card--outlined card--interactive";
  if (activeSystem?.slug === s.slug) card.classList.add("is-active");
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.innerHTML = `
    <div class="card__header">
      <h3 class="card__title">${escapeHtml(s.id)}</h3>
      <p class="card__subtitle">${escapeHtml(s.source)} · ${escapeHtml(family)}</p>
    </div>
    <div class="card__content body-medium">
      ${s.games.toLocaleString("fr-FR")} jeux · ${s.roms.toLocaleString("fr-FR")} roms
    </div>
  `;
  const open = (): void => {
    void openSystem(s);
  };
  card.addEventListener("click", open);
  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open();
    }
  });
  col.appendChild(card);
  return col;
}

function renderSystems(query: string): void {
  const grid = $("systems");
  const btnMore = $("btnMore") as HTMLButtonElement | null;
  if (!grid || !catalog) return;

  filteredSystems = catalog.systems.filter((s) => matchesFilters(s, query));
  const slice = filteredSystems.slice(0, visibleCount);

  grid.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (const s of slice) frag.appendChild(createSystemCard(s));
  grid.appendChild(frag);

  const empty = $("systemsEmpty");
  if (empty) {
    empty.hidden = filteredSystems.length > 0;
    if (filteredSystems.length === 0) empty.textContent = "Aucun système pour ces filtres.";
  }

  if (btnMore) {
    btnMore.hidden = visibleCount >= filteredSystems.length;
    btnMore.textContent = `Charger plus (${Math.min(visibleCount, filteredSystems.length)} / ${filteredSystems.length})`;
  }

  const summary = $("catalogSummary");
  if (summary && catalog) {
    const games = filteredSystems.reduce((a, s) => a + s.games, 0);
    const roms = filteredSystems.reduce((a, s) => a + s.roms, 0);
    summary.textContent = `${filteredSystems.length} / ${catalog.totals.systems} systèmes · ${games.toLocaleString("fr-FR")} jeux · ${roms.toLocaleString("fr-FR")} roms`;
  }

  if (activeSystem) renderRomsTable(query);
}

function showUnavailableHint(system: SystemRow, err: unknown): void {
  const body = $("romsBody");
  const gamesEmpty = $("gamesEmpty");
  const count = $("gamesCount");
  if (body) body.innerHTML = "";
  if (count) count.textContent = "";

  const reason =
    system.source === "TOSEC"
      ? "Les systèmes TOSEC ne sont pas exportés en JSON individuels (volume trop important)."
      : `Impossible de charger les ROMs (${err instanceof Error ? err.message : String(err)}).`;

  if (gamesEmpty) {
    gamesEmpty.hidden = false;
    gamesEmpty.innerHTML = `${escapeHtml(reason)} Téléchargez la base SQLite complète depuis
      <a href="${RELEASE_URL}" target="_blank" rel="noopener noreferrer">GitHub Releases</a>.`;
  }

  snack(
    system.source === "TOSEC"
      ? "TOSEC : détail ROM via GitHub Releases"
      : "Détail ROM indisponible — voir Releases",
  );
}

async function openSystem(s: SystemRow): Promise<void> {
  const panel = $("gamesPanel");
  const title = $("gamesTitle");
  const body = $("romsBody");
  const count = $("gamesCount");
  const gamesEmpty = $("gamesEmpty");
  if (!panel || !title || !body) return;

  activeSystem = s;
  activeRoms = [];
  panel.hidden = false;
  title.textContent = s.id;
  body.innerHTML = `<tr class="table__row"><td class="table__cell" colspan="7">Chargement…</td></tr>`;
  if (gamesEmpty) {
    gamesEmpty.hidden = true;
    gamesEmpty.textContent = "Aucune ROM.";
  }
  if (count) count.textContent = "";
  renderSystems(getSearchQuery());

  try {
    const res = await fetch(`/data/by-system/${encodeURIComponent(s.slug)}.json`);
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { roms?: RomRow[] };
    activeRoms = Array.isArray(data.roms) ? data.roms : [];
    renderRomsTable(getSearchQuery());
  } catch (err) {
    activeRoms = [];
    showUnavailableHint(s, err);
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
    tr.className = "table__row";
    tr.innerHTML = `
      <td class="table__cell">${escapeHtml(r.game)}</td>
      <td class="table__cell">${escapeHtml(r.rom)}</td>
      <td class="table__cell">${r.types.map((t) => `<span class="rom-tag">${escapeHtml(t)}</span>`).join("")}</td>
      <td class="table__cell">${escapeHtml(r.regions.join(", "))}</td>
      <td class="table__cell mono">${escapeHtml(r.crc ?? "—")}</td>
      <td class="table__cell mono">${escapeHtml(shortHash(r.md5))}</td>
      <td class="table__cell mono">${escapeHtml(shortHash(r.sha1))}</td>
    `;
    body.appendChild(tr);
  }

  if (rows.length > limit) {
    const tr = document.createElement("tr");
    tr.className = "table__row";
    tr.innerHTML = `<td class="table__cell text-muted" colspan="7">… +${rows.length - limit} autres (affinez la recherche)</td>`;
    body.appendChild(tr);
  }

  if (count) count.textContent = `${rows.length.toLocaleString("fr-FR")} ROM(s)`;
  if (gamesEmpty && activeRoms.length > 0) {
    gamesEmpty.hidden = rows.length > 0;
    if (rows.length === 0) gamesEmpty.textContent = "Aucune ROM pour cette recherche.";
  } else if (gamesEmpty && activeRoms.length === 0 && body.children.length === 0) {
    gamesEmpty.hidden = false;
    gamesEmpty.textContent = "Aucune ROM.";
  }
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
  return [...new Uint8Array(dig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
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

function toggleTheme(): void {
  const tm = window.K?.ThemeManager;
  if (tm?.toggle) {
    tm.toggle();
    return;
  }
  if (tm?.setTheme && typeof tm.isDark === "function") {
    tm.setTheme(tm.isDark() ? "light" : "dark");
    return;
  }
  const html = document.documentElement;
  const next = html.getAttribute("data-theme") === "dark" ? "light" : "dark";
  html.setAttribute("data-theme", next);
}

function wireUi(): void {
  $("btnTheme")?.addEventListener("click", (e) => {
    e.preventDefault();
    toggleTheme();
  });

  $("btnMore")?.addEventListener("click", () => {
    visibleCount += PAGE_SIZE;
    renderSystems(getSearchQuery());
  });

  const q = $("q");
  q?.addEventListener("input", () => {
    visibleCount = PAGE_SIZE;
    renderSystems(getSearchQuery());
  });
  // clearable / Field may fire change
  q?.addEventListener("change", () => {
    visibleCount = PAGE_SIZE;
    renderSystems(getSearchQuery());
  });
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
    visibleCount = PAGE_SIZE;
    renderSystems(getSearchQuery());
    if (empty) empty.hidden = catalog.systems.length > 0;
  } catch (err) {
    if (empty) {
      empty.hidden = false;
      empty.textContent = `Catalogue statique indisponible (${err instanceof Error ? err.message : err}).`;
    }
  }
}

async function main(): Promise<void> {
  const k = await waitForK();
  try {
    initFilterChips(k);
  } catch (err) {
    console.error("[catalogs] Chip init failed", err);
  }
  wireUi();
  wireDrop();
  await loadSystems();
}

void main();
