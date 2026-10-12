/**
 * 1G1R — une entrée « meilleure » par titre logique.
 * Priorité région : Europe/PAL → USA → Japan (aligné Desk / usage EU).
 */

/** Clé de regroupement (titre sans région / version / flags). */
export function groupKey1g1r(name) {
  let s = String(name || "").trim();
  if (!s) return "";

  // TOSEC : « Title v1.00 (1996)(Pub)(PAL)[!] » → couper au premier « ( »
  if (/\bv\d+\.\d+\b/i.test(s) || /\(\d{4}\)/.test(s)) {
    const i = s.indexOf(" (");
    if (i >= 0) s = s.slice(0, i);
    s = s.replace(/\s+v\d+(?:\.\d+)+\s*$/i, "").trim();
  } else {
    // No-Intro / Redump : retirer le dernier (Région)
    s = s.replace(/\s*\([^)]*\)\s*$/u, "").trim();
  }

  return s.toLowerCase();
}

/** Score : plus haut = meilleur candidat 1G1R. */
export function score1g1r(name, regions = []) {
  const n = String(name || "");
  const regs = (regions || []).map((r) => String(r).toLowerCase());
  let score = 0;

  if (/\[!\]/.test(n)) score += 1000;
  if (/\[b[^\]]*\]/i.test(n)) score -= 500;
  if (/\[tr\b/i.test(n)) score -= 200;
  if (/\(Proto|\(Beta|\[p\]/i.test(n)) score -= 300;

  const eu =
    regs.includes("europe") ||
    /\((?:Europe|PAL|EU|FR|DE|ES|IT|GB)\)/i.test(n) ||
    /\(PAL\)/i.test(n);
  const us = regs.includes("usa") || regs.includes("world") || /\((?:USA|US|World)\)/i.test(n);
  const jp = regs.includes("japan") || /\((?:Japan|JP)\)/i.test(n);

  if (eu) score += 40;
  else if (us) score += 25;
  else if (jp) score += 10;

  const vm = n.match(/\bv(\d+)\.(\d+)\b/i);
  if (vm) score += Number(vm[1]) * 100 + Number(vm[2]);

  return score;
}

/**
 * Garde une ligne par groupKey (meilleur score).
 * @param {Array} rows
 * @param {(row) => string} getName
 * @param {(row) => string[]} [getRegions]
 */
export function pick1g1r(rows, getName, getRegions = () => []) {
  const best = new Map();
  for (const row of rows) {
    const name = getName(row);
    const key = groupKey1g1r(name);
    if (!key) continue;
    const score = score1g1r(name, getRegions(row));
    const prev = best.get(key);
    if (!prev || score > prev.score || (score === prev.score && name.localeCompare(prev.name) < 0)) {
      best.set(key, { row, score, name });
    }
  }
  return [...best.values()]
    .map((x) => x.row)
    .sort((a, b) => getName(a).localeCompare(getName(b), "fr", { sensitivity: "base" }));
}

/** Nombre de titres 1G1R distincts. */
export function count1g1r(names) {
  const keys = new Set();
  for (const name of names) {
    const key = groupKey1g1r(name);
    if (key) keys.add(key);
  }
  return keys.size;
}
