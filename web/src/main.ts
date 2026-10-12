import { md5Hex } from "./md5";
import { pick1g1r } from "./oneG1r";
import "./styles.css";

const RELEASE_URL = "https://github.com/Kam3leoN/ScreenBox-Catalogs/releases/latest";
const PAGE_SIZE = 48;
const ROMS_PAGE_SIZE = 150;
const ALPHA_KEYS = [
  "Tous",
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""),
  "#",
] as const;

const FAMILY_FILTERS = ["Tous", "Arcade", "Consoles", "Portables", "Ordinateurs", "Flippers", "Autres"] as const;
/** Jeux = défaut ; Tous = tout TOSEC (magazines, firmware…). */
const CONTENT_FILTERS = ["Jeux", "Tous"] as const;
const KIND_FILTERS = ["Tous", "Commercial", "Homebrew", "Hacks", "Demos"] as const;

/**
 * Segments TOSEC (catégorie / média) — jamais Manufacturer ni Hardware.
 * On les retire de la fin de l’id avant le parse « Marque - Machine ».
 */
const TOSEC_CONTENT_SEGMENT =
  /^(Games|Demos|Homebrew|Applications?|Magazines?|Firmware|Manuals?|Multimedia|Samplers?|Catalogs?|Bonus|Coverdisks?|Coverdiscs?|Educational|Operating Systems|Compilations|Artwork|Hard Disks|Commercials?|Books|Videos?|Systems?|Various|Collections?|Sources?|Source|Docs?|Utilities|Utility|Modules?|Newsletters?|Entertainment|Miscellaneous|Misc|Design Cartridges|ROM Images|Boot Loader|Updates?|DLC|Save Disks|Homemade|Overlays?|Firmware|Bios|BIOS|CD|DVD|HD|HDD)\b/i;

type SystemRow = {
  id: string;
  source: string;
  family?: string;
  games: number;
  /** Titres uniques après regroupement 1G1R (export). */
  games1g1r?: number;
  roms: number;
  slug: string;
  /** Slugs fusionnés (ex. Games [BIN] + [ISO]). */
  slugs?: string[];
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

/** Sélection exclusive pour un groupe de chips. */
class ChipGroup {
  private selected = 0;

  constructor(
    private readonly el: HTMLElement,
    private readonly labels: readonly string[],
    defaultIndex: number,
    private readonly onChange: () => void,
  ) {
    this.selected = Math.max(0, Math.min(defaultIndex, labels.length - 1));
    this.render();
  }

  getLabel(): string {
    return this.labels[this.selected] ?? this.labels[0] ?? "";
  }

  private render(): void {
    this.el.innerHTML = "";
    this.labels.forEach((label, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip" + (i === this.selected ? " is-active" : "");
      btn.textContent = label;
      btn.setAttribute("aria-pressed", i === this.selected ? "true" : "false");
      btn.addEventListener("click", () => {
        if (this.selected === i) return;
        this.selected = i;
        this.render();
        this.onChange();
      });
      this.el.appendChild(btn);
    });
  }
}

const chipGroups = new Map<string, ChipGroup>();

/** manufacturer → set of hardware names */
let mfrHardwareIndex = new Map<string, Set<string>>();
let selectedManufacturer = "";
let selectedHardware = "";

let catalog: CatalogIndex | null = null;
let activeSystem: SystemRow | null = null;
let activeRoms: RomRow[] = [];
let filteredSystems: SystemRow[] = [];
let visibleCount = PAGE_SIZE;
/** Slugs à charger pour le système actif (fullset fusionné). */
let activeSlugs: string[] = [];
/** `games` = liste TOSEC légère ; `roms` = dumps complets No-Intro/etc. */
let activeBrowseMode: "games" | "roms" = "roms";
let romsPage = 0;
let romsFilterQuery = "";
let romsAlpha: string = "Tous";
let toastTimer = 0;

function $(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function snack(text: string): void {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    el.setAttribute("role", "status");
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el?.classList.remove("is-visible"), 2800);
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
  const input = $("q") as HTMLInputElement | null;
  return input?.value ?? "";
}

function selectedLabel(containerId: string, fallback = "Tous"): string {
  return chipGroups.get(containerId)?.getLabel() ?? fallback;
}

function isTosecNoise(id: string): boolean {
  return /Artwork|Manuals?|Magazines?|Firmware|Applications?|Samplers?|Catalogs?|Multimedia|Bonus|Coverdisk|Videos?|\bSystem\b|Various|Collections?|Newsletters?|Utilities|Docs?\b/i.test(
    id,
  );
}

/** TOSEC jouable (Contenu=Jeux) : Games / Homebrew / Demos — pas manuals, firmware, vidéos… */
function isPlayableCatalog(s: SystemRow): boolean {
  if (s.source !== "TOSEC") return true;
  const id = s.id;
  if (isTosecNoise(id)) return false;
  if (/\bHomebrew\b/i.test(id) && /\b(Games|Demos)\b/i.test(id)) return true;
  if (/(?:^| - )Games(?:$| - )/i.test(id)) return true;
  if (/(?:^| - )Demos(?:$| - )/i.test(id)) return true;
  return false;
}

type CatalogKind = "commercial" | "homebrew" | "demos" | "other";

function catalogKind(s: SystemRow): CatalogKind {
  const id = s.id;
  if (/\bHomebrew\b/i.test(id)) return "homebrew";
  if (/(?:^| - )Demos(?:$| - )/i.test(id)) return "demos";
  if (s.source !== "TOSEC") return "commercial";
  if (/(?:^| - )Games(?:$| - )/i.test(id)) return "commercial";
  return "other";
}

/** Type d’une ligne (DAT tags + heuristique nom). */
function rowKind(r: RomRow): "commercial" | "homebrew" | "hack" | "demo" | "prototype" | "other" {
  const types = r.types.map((t) => t.toLowerCase());
  const blob = `${r.game} ${r.rom}`;
  if (types.includes("hack") || /\(Hack|\[Hack/i.test(blob)) return "hack";
  if (types.includes("homebrew") || /Homebrew|\(Aftermarket/i.test(blob)) return "homebrew";
  if (types.includes("demo") || /\(Demo|\(Sample/i.test(blob)) return "demo";
  if (types.includes("prototype") || /\(Proto|\(Beta/i.test(blob)) return "prototype";
  if (types.includes("bios") || /\[BIOS\]|\(BIOS\)/i.test(blob)) return "other";
  if (types.includes("commercial") || types.length === 0) return "commercial";
  return "other";
}

function matchesKindFilter(s: SystemRow, kind: string): boolean {
  if (kind === "Tous") return true;
  const ck = catalogKind(s);
  if (kind === "Commercial") return ck === "commercial";
  if (kind === "Homebrew") return ck === "homebrew";
  if (kind === "Demos") return ck === "demos";
  if (kind === "Hacks") {
    // Les hacks vivent dans les fullsets Games (pas de DAT « Hacks » TOSEC Saturn).
    return ck === "commercial" || ck === "homebrew" || s.source !== "TOSEC";
  }
  return true;
}

function matchesRowKind(r: RomRow, kind: string): boolean {
  if (kind === "Tous") return true;
  const rk = rowKind(r);
  if (kind === "Commercial") return rk === "commercial";
  if (kind === "Homebrew") return rk === "homebrew";
  if (kind === "Hacks") return rk === "hack";
  if (kind === "Demos") return rk === "demo";
  return true;
}

/** Retire le tag média final [BIN] / [ISO] / [IMG]… pour fusionner les fullsets. */
function stripMediaFormatTag(id: string): string {
  return id.replace(/\s*-\s*\[[^\]]+\]\s*$/i, "").trim();
}

/**
 * Coupe l’id dès le premier segment de catégorie TOSEC.
 * `Nintendo Game Boy - Homebrew - Games` → `Nintendo Game Boy`
 * `Nintendo - Magazines - Club Nintendo` → `Nintendo`
 * `Nintendo - Game Boy` → inchangé (Game Boy ≠ catégorie)
 */
function stripTosecContentSuffix(id: string): string {
  const parts = stripMediaFormatTag(id)
    .split(" - ")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return stripMediaFormatTag(id);
  let cut = parts.length;
  for (let i = 0; i < parts.length; i++) {
    if (TOSEC_CONTENT_SEGMENT.test(parts[i]!)) {
      cut = i;
      break;
    }
  }
  return parts.slice(0, Math.max(1, cut)).join(" - ");
}

function splitBrandAndMachine(platform: string): { manufacturer: string; hardware: string } {
  const s = platform.trim();
  if (!s) return { manufacturer: "", hardware: "" };

  // Dat-O-Matic / No-Intro / Redump : `Manufacturer - Hardware`
  const dash = s.indexOf(" - ");
  if (dash > 0) {
    const left = s.slice(0, dash).trim();
    const right = s.slice(dash + 3).trim();
    if (left && right && !TOSEC_CONTENT_SEGMENT.test(right)) {
      return { manufacturer: left, hardware: right };
    }
  }

  // TOSEC mash : `Nintendo Game Boy` / `Nintendo 64` → premier token = marque
  const m = s.match(/^(\S+)\s+(.+)$/);
  if (m) return { manufacturer: m[1]!, hardware: m[2]! };
  return { manufacturer: s, hardware: s };
}

/**
 * Extrait Manufacturer / Hardware depuis un id DAT.
 * No-Intro/Redump : `Nintendo - Game Boy`
 * TOSEC : `Nintendo Game Boy - Video` → Nintendo / Game Boy
 */
function parseManufacturerHardware(id: string): { manufacturer: string; hardware: string } {
  const platform = stripTosecContentSuffix(id);
  return splitBrandAndMachine(platform || stripMediaFormatTag(id));
}

function rebuildMfrHardwareIndex(systems: SystemRow[]): void {
  const idx = new Map<string, Set<string>>();
  for (const s of systems) {
    const { manufacturer, hardware } = parseManufacturerHardware(s.id);
    if (!manufacturer) continue;
    let set = idx.get(manufacturer);
    if (!set) {
      set = new Set();
      idx.set(manufacturer, set);
    }
    if (hardware) set.add(hardware);
  }
  mfrHardwareIndex = idx;
}

function fillSelect(el: HTMLSelectElement, values: string[], selected: string, allLabel = "Tous"): void {
  const keep = selected && values.includes(selected) ? selected : "";
  el.innerHTML = "";
  const optAll = document.createElement("option");
  optAll.value = "";
  optAll.textContent = allLabel;
  el.appendChild(optAll);
  for (const v of values) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    el.appendChild(opt);
  }
  el.value = keep;
}

function refreshManufacturerSelect(): void {
  const el = $("manufacturerSelect") as HTMLSelectElement | null;
  if (!el) return;
  const manufacturers = [...mfrHardwareIndex.keys()].sort((a, b) => a.localeCompare(b, "fr"));
  fillSelect(el, manufacturers, selectedManufacturer);
  selectedManufacturer = el.value;
}

function refreshHardwareSelect(): void {
  const el = $("hardwareSelect") as HTMLSelectElement | null;
  if (!el) return;
  let hardwares: string[];
  if (selectedManufacturer) {
    hardwares = [...(mfrHardwareIndex.get(selectedManufacturer) ?? [])];
  } else {
    const all = new Set<string>();
    for (const set of mfrHardwareIndex.values()) {
      for (const h of set) all.add(h);
    }
    hardwares = [...all];
  }
  hardwares.sort((a, b) => a.localeCompare(b, "fr"));
  fillSelect(el, hardwares, selectedHardware);
  selectedHardware = el.value;
}

function wireMfrHardwareSelects(): void {
  const mfrEl = $("manufacturerSelect") as HTMLSelectElement | null;
  const hwEl = $("hardwareSelect") as HTMLSelectElement | null;
  mfrEl?.addEventListener("change", () => {
    selectedManufacturer = mfrEl.value;
    selectedHardware = "";
    refreshHardwareSelect();
    visibleCount = PAGE_SIZE;
    renderSystems(getSearchQuery());
  });
  hwEl?.addEventListener("change", () => {
    selectedHardware = hwEl.value;
    // Si hardware choisi sans manufacturer, remonter le fabricant unique si possible
    if (selectedHardware && !selectedManufacturer) {
      const owners: string[] = [];
      for (const [mfr, set] of mfrHardwareIndex) {
        if (set.has(selectedHardware)) owners.push(mfr);
      }
      if (owners.length === 1) {
        selectedManufacturer = owners[0]!;
        refreshManufacturerSelect();
        refreshHardwareSelect();
      }
    }
    visibleCount = PAGE_SIZE;
    renderSystems(getSearchQuery());
  });
}

function mergeGamesFullsets(systems: SystemRow[]): SystemRow[] {
  const byKey = new Map<string, SystemRow>();
  for (const s of systems) {
    const baseId = s.source === "TOSEC" ? stripMediaFormatTag(s.id) : s.id;
    const key = `${s.source}\0${baseId}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, {
        ...s,
        id: baseId,
        slug: s.slug,
        slugs: [s.slug],
      });
      continue;
    }
    prev.games += s.games;
    prev.roms += s.roms;
    // BIN/ISO se chevauchent souvent → max plutôt que somme
    prev.games1g1r = Math.max(prev.games1g1r ?? 0, s.games1g1r ?? 0);
    prev.slugs = [...(prev.slugs ?? [prev.slug]), s.slug];
    // Preferer le slug avec le plus de roms (souvent ISO > BIN)
    if (s.roms >= prev.roms) prev.slug = s.slug;
  }
  return [...byKey.values()].sort((a, b) => a.id.localeCompare(b.id, "fr"));
}

/** Site = packs 1G1R uniquement. */
function is1g1rView(): boolean {
  return true;
}

function displayGameCount(s: SystemRow): number {
  if (is1g1rView() && typeof s.games1g1r === "number" && s.games1g1r > 0) return s.games1g1r;
  return s.games;
}

function matchesFilters(s: SystemRow, query: string): boolean {
  const familySel = selectedLabel("familyFilters");
  const content = selectedLabel("contentFilters", "Jeux");
  const kind = selectedLabel("kindFilters", "Tous");
  const family = s.family || "Autres";
  const { manufacturer, hardware } = parseManufacturerHardware(s.id);

  if (selectedManufacturer && manufacturer !== selectedManufacturer) return false;
  if (selectedHardware && hardware !== selectedHardware) return false;
  if (familySel !== "Tous" && family !== familySel) return false;
  if (content === "Jeux" && !isPlayableCatalog(s)) return false;
  if (!matchesKindFilter(s, kind)) return false;

  const q = query.trim().toLowerCase();
  if (q.length === 0) return true;
  return (
    s.id.toLowerCase().includes(q) ||
    s.source.toLowerCase().includes(q) ||
    family.toLowerCase().includes(q) ||
    manufacturer.toLowerCase().includes(q) ||
    hardware.toLowerCase().includes(q)
  );
}

function initChipFilters(): void {
  const onSelect = (): void => {
    visibleCount = PAGE_SIZE;
    renderSystems(getSearchQuery());
  };

  const mounts: Array<[string, readonly string[], number]> = [
    ["familyFilters", FAMILY_FILTERS, 0],
    ["contentFilters", CONTENT_FILTERS, 0],
    ["kindFilters", KIND_FILTERS, 0],
  ];

  for (const [id, labels, def] of mounts) {
    const el = $(id);
    if (!el) continue;
    chipGroups.set(id, new ChipGroup(el, labels, def, onSelect));
  }
}

function createSystemCard(s: SystemRow): HTMLElement {
  const family = s.family || "Autres";
  const formats = (s.slugs?.length ?? 1) > 1 ? ` · ${s.slugs!.length} formats` : "";
  const { manufacturer, hardware } = parseManufacturerHardware(s.id);
  const card = document.createElement("button");
  card.type = "button";
  card.className = "system-card";
  const activeSlugsSet = new Set(activeSlugs.length ? activeSlugs : activeSystem ? [activeSystem.slug] : []);
  if (s.slugs?.some((sl) => activeSlugsSet.has(sl)) || activeSystem?.slug === s.slug) {
    card.classList.add("is-active");
  }
  const nGames = displayGameCount(s);
  card.innerHTML = `
    <div class="system-card__title">${escapeHtml(s.id)}</div>
    <div class="system-card__meta">${escapeHtml(manufacturer)} · ${escapeHtml(hardware)} · ${escapeHtml(family)}${escapeHtml(formats)}</div>
    <div class="system-card__stats">${nGames.toLocaleString("fr-FR")} jeux 1G1R</div>
  `;
  card.addEventListener("click", () => {
    void openSystem(s);
  });
  return card;
}

function renderSystems(query: string): void {
  const grid = $("systems");
  const btnMore = $("btnMore") as HTMLButtonElement | null;
  if (!grid || !catalog) return;

  const content = selectedLabel("contentFilters", "Jeux");
  let list = catalog.systems.filter((s) => matchesFilters(s, query));
  if (content === "Jeux") list = mergeGamesFullsets(list);
  filteredSystems = list;
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

  const sub = $("systemsSubtitle");
  if (sub) {
    sub.textContent = `${Math.min(visibleCount, filteredSystems.length).toLocaleString("fr-FR")} / ${filteredSystems.length.toLocaleString("fr-FR")} affichés`;
  }

  const summary = $("catalogSummary");
  if (summary && catalog) {
    const games = filteredSystems.reduce((a, s) => a + displayGameCount(s), 0);
    if (is1g1rView()) {
      summary.textContent = `${filteredSystems.length} systèmes · ${games.toLocaleString("fr-FR")} jeux 1G1R`;
    } else {
      const roms = filteredSystems.reduce((a, s) => a + s.roms, 0);
      summary.textContent = `${filteredSystems.length} systèmes · ${games.toLocaleString("fr-FR")} jeux · ${roms.toLocaleString("fr-FR")} roms`;
    }
  }

  if (activeSystem) renderRomsTable(query);
}

function showUnavailableHint(system: SystemRow, err: unknown): void {
  const body = $("romsBody");
  const gamesEmpty = $("gamesEmpty");
  const count = $("gamesCount");
  const wrap = $("romsWrap");
  const alpha = $("romsAlpha");
  const pager = $("romsPager");
  if (body) body.innerHTML = "";
  if (count) count.textContent = "";
  if (wrap) wrap.hidden = true;
  if (alpha) alpha.hidden = true;
  if (pager) pager.hidden = true;

  const fam = system.family || "Autres";
  const reason =
    system.source === "TOSEC" && fam !== "Consoles" && fam !== "Portables"
      ? `Browse web TOSEC limité aux Consoles / Portables (volume). ${system.games.toLocaleString("fr-FR")} jeux dans l’index — détail complet dans la base SQLite.`
      : system.source === "TOSEC"
        ? "Fichier détail introuvable pour ce système TOSEC."
        : `Impossible de charger le détail (${err instanceof Error ? err.message : String(err)}).`;

  if (gamesEmpty) {
    gamesEmpty.hidden = false;
    gamesEmpty.innerHTML = `${escapeHtml(reason)} Téléchargez
      <a href="${RELEASE_URL}" target="_blank" rel="noopener noreferrer">GitHub Releases</a>.`;
  }

  snack(system.source === "TOSEC" ? "TOSEC : voir GitHub Releases" : "Détail indisponible");
}

function romAlphaKey(name: string): string {
  const ch = (name.trim().charAt(0) || "").toLocaleUpperCase("fr-FR");
  return ch >= "A" && ch <= "Z" ? ch : "#";
}

function matchesSearch(r: RomRow, q: string): boolean {
  if (q.length === 0) return true;
  return (
    r.game.toLowerCase().includes(q) ||
    r.rom.toLowerCase().includes(q) ||
    (r.crc ?? "").toLowerCase().includes(q) ||
    (r.md5 ?? "").toLowerCase().includes(q) ||
    (r.sha1 ?? "").toLowerCase().includes(q) ||
    r.types.some((t) => t.toLowerCase().includes(q))
  );
}

function renderAlphaPager(searchRows: RomRow[]): void {
  const host = $("romsAlpha");
  if (!host) return;

  if (activeRoms.length === 0) {
    host.hidden = true;
    host.innerHTML = "";
    return;
  }

  const counts = new Map<string, number>();
  for (const key of ALPHA_KEYS) counts.set(key, 0);
  counts.set("Tous", searchRows.length);
  for (const r of searchRows) {
    const key = romAlphaKey(r.game);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  if (!counts.has(romsAlpha) || (romsAlpha !== "Tous" && (counts.get(romsAlpha) ?? 0) === 0)) {
    romsAlpha = "Tous";
  }

  host.hidden = false;
  host.innerHTML = "";
  for (const key of ALPHA_KEYS) {
    const n = counts.get(key) ?? 0;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "roms-alpha__btn" + (key === romsAlpha ? " is-active" : "");
    btn.disabled = key !== "Tous" && n === 0;
    btn.innerHTML =
      key === "Tous"
        ? `<span class="roms-alpha__letter">Tous</span><span class="roms-alpha__count">${n}</span>`
        : `<span class="roms-alpha__letter">${escapeHtml(key)}</span><span class="roms-alpha__count">${n}</span>`;
    btn.dataset.alpha = key;
    btn.addEventListener("click", () => {
      if (romsAlpha === key) return;
      romsAlpha = key;
      romsPage = 0;
      renderRomsTable(getSearchQuery());
      $("gamesPanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    host.appendChild(btn);
  }
}

async function fetchSystemPayload(
  slug: string,
): Promise<{ mode: "games" | "roms"; roms: RomRow[] }> {
  const res = await fetch(`/data/by-system/${encodeURIComponent(slug)}.json`);
  if (!res.ok) throw new Error(String(res.status));
  const data = (await res.json()) as { mode?: string; roms?: RomRow[] };
  const roms = Array.isArray(data.roms) ? data.roms : [];
  const mode = data.mode === "games" ? "games" : "roms";
  return { mode, roms };
}

function dedupeRoms(rows: RomRow[]): RomRow[] {
  const seen = new Set<string>();
  const out: RomRow[] = [];
  for (const r of rows) {
    const key = (r.sha1 || r.md5 || r.crc || `${r.gameId}|${r.game}|${r.rom}`).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

async function openSystem(s: SystemRow): Promise<void> {
  const panel = $("gamesPanel");
  const title = $("gamesTitle");
  const body = $("romsBody");
  const count = $("gamesCount");
  const gamesEmpty = $("gamesEmpty");
  const wrap = $("romsWrap");
  if (!panel || !title || !body) return;

  activeSystem = s;
  activeSlugs = s.slugs?.length ? [...s.slugs] : [s.slug];
  activeRoms = [];
  activeBrowseMode = "roms";
  romsPage = 0;
  romsFilterQuery = "";
  romsAlpha = "Tous";
  title.textContent = s.id;
  if (wrap) wrap.hidden = false;
  body.innerHTML = `<tr><td colspan="7">Chargement…</td></tr>`;
  if (gamesEmpty) {
    gamesEmpty.hidden = true;
    gamesEmpty.textContent = "Aucun résultat.";
  }
  if (count) count.textContent = "";
  const pager = $("romsPager");
  if (pager) pager.hidden = true;
  const alpha = $("romsAlpha");
  if (alpha) {
    alpha.hidden = true;
    alpha.innerHTML = "";
  }
  renderSystems(getSearchQuery());

  try {
    const batches = await Promise.all(
      activeSlugs.map(async (slug) => {
        try {
          return await fetchSystemPayload(slug);
        } catch {
          return { mode: "roms" as const, roms: [] as RomRow[] };
        }
      }),
    );
    const anyGames = batches.some((b) => b.mode === "games" && b.roms.length > 0);
    activeBrowseMode = anyGames ? "games" : "roms";
    activeRoms = dedupeRoms(batches.flatMap((b) => b.roms));
    if (activeRoms.length === 0) throw new Error("404");
    const romCol = $("romColHeader");
    if (romCol) romCol.textContent = activeBrowseMode === "games" ? "Fichiers" : "ROM";
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
  const pager = $("romsPager");
  const pageLabel = $("romsPageLabel");
  const btnPrev = $("romsPrev") as HTMLButtonElement | null;
  const btnNext = $("romsNext") as HTMLButtonElement | null;
  const wrap = $("romsWrap");
  if (!body || !activeSystem) return;

  const kind = selectedLabel("kindFilters", "Tous");
  const unit = is1g1rView() || activeBrowseMode === "games" ? "jeu(x)" : "ROM(s)";

  const q = query.trim().toLowerCase();
  if (q !== romsFilterQuery) {
    romsFilterQuery = q;
    romsPage = 0;
    romsAlpha = "Tous";
  }

  let baseRows = activeRoms.filter((r) => matchesSearch(r, q) && matchesRowKind(r, kind));
  if (is1g1rView()) {
    baseRows = pick1g1r(
      baseRows,
      (r: RomRow) => r.game,
      (r: RomRow) => r.regions,
    );
  }
  const searchRows = baseRows;
  renderAlphaPager(searchRows);

  const rows =
    romsAlpha === "Tous"
      ? searchRows
      : searchRows.filter((r) => romAlphaKey(r.game) === romsAlpha);

  const totalPages = Math.max(1, Math.ceil(rows.length / ROMS_PAGE_SIZE));
  if (romsPage >= totalPages) romsPage = totalPages - 1;
  if (romsPage < 0) romsPage = 0;

  const start = romsPage * ROMS_PAGE_SIZE;
  const pageRows = rows.slice(start, start + ROMS_PAGE_SIZE);

  if (wrap) wrap.hidden = false;
  body.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (const r of pageRows) {
    const tr = document.createElement("tr");
    const typeTags =
      r.types.length > 0
        ? r.types
        : activeBrowseMode === "games"
          ? [rowKind(r)]
          : [];
    tr.innerHTML = `
      <td>${escapeHtml(r.game)}</td>
      <td>${escapeHtml(r.rom)}</td>
      <td>${typeTags.map((t) => `<span class="rom-tag">${escapeHtml(t)}</span>`).join("")}</td>
      <td>${escapeHtml(r.regions.join(", "))}</td>
      <td class="mono">${escapeHtml(r.crc ?? "—")}</td>
      <td class="mono">${escapeHtml(shortHash(r.md5))}</td>
      <td class="mono">${escapeHtml(shortHash(r.sha1))}</td>
    `;
    frag.appendChild(tr);
  }
  body.appendChild(frag);

  const from = rows.length === 0 ? 0 : start + 1;
  const to = Math.min(start + pageRows.length, rows.length);
  const alphaHint = romsAlpha === "Tous" ? "" : ` · ${romsAlpha}`;
  const modeHint = is1g1rView()
    ? " · 1G1R"
    : activeBrowseMode === "games"
      ? " · liste jeux"
      : "";
  if (count) {
    count.textContent =
      rows.length === 0
        ? `0 ${unit}${alphaHint}${modeHint}`
        : `${from.toLocaleString("fr-FR")}–${to.toLocaleString("fr-FR")} / ${rows.length.toLocaleString("fr-FR")} ${unit}${alphaHint}${modeHint} · ${ROMS_PAGE_SIZE}/page`;
  }

  const showPager = rows.length > ROMS_PAGE_SIZE;
  if (pager) pager.hidden = !showPager;
  if (pageLabel) pageLabel.textContent = `Page ${romsPage + 1} / ${totalPages}`;
  if (btnPrev) btnPrev.disabled = romsPage <= 0;
  if (btnNext) btnNext.disabled = romsPage >= totalPages - 1;

  if (gamesEmpty && activeRoms.length > 0) {
    gamesEmpty.hidden = rows.length > 0;
    if (rows.length === 0) {
      gamesEmpty.textContent =
        kind !== "Tous"
          ? `Aucun ${kind.toLowerCase()} pour ce filtre.`
          : "Aucun résultat pour cette recherche.";
    }
  } else if (gamesEmpty && activeRoms.length === 0 && body.children.length === 0) {
    gamesEmpty.hidden = false;
    gamesEmpty.textContent = "Aucun résultat.";
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
  zone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      (zone as HTMLElement).click();
    }
  });
}

function wireUi(): void {
  $("btnMore")?.addEventListener("click", () => {
    visibleCount += PAGE_SIZE;
    renderSystems(getSearchQuery());
  });

  $("romsPrev")?.addEventListener("click", () => {
    if (romsPage <= 0) return;
    romsPage -= 1;
    renderRomsTable(getSearchQuery());
    $("gamesPanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("romsNext")?.addEventListener("click", () => {
    romsPage += 1;
    renderRomsTable(getSearchQuery());
    $("gamesPanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  const q = $("q");
  q?.addEventListener("input", () => {
    visibleCount = PAGE_SIZE;
    renderSystems(getSearchQuery());
  });
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
    rebuildMfrHardwareIndex(catalog.systems);
    refreshManufacturerSelect();
    refreshHardwareSelect();
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
  initChipFilters();
  wireMfrHardwareSelects();
  wireUi();
  wireDrop();
  await loadSystems();
}

void main();
