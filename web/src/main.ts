async function loadSystems(): Promise<void> {
  const list = document.getElementById("systems");
  const empty = document.getElementById("systemsEmpty");
  if (!list) return;
  try {
    const res = await fetch("/api/systems");
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { systems: { id: string; source: string; games: number }[] };
    list.innerHTML = "";
    for (const s of data.systems) {
      const li = document.createElement("li");
      li.className = "list-item";
      li.textContent = `${s.id} — ${s.source} (${s.games} jeux)`;
      list.appendChild(li);
    }
    if (empty) empty.hidden = data.systems.length > 0;
  } catch {
    if (empty) empty.hidden = false;
  }
}

async function hashFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const md5 = await cryptoSubtleHex("MD5", bytes).catch(() => "(MD5 non dispo dans ce navigateur)");
  const sha1 = await cryptoSubtleHex("SHA-1", bytes);
  const crc = crc32Hex(bytes);
  return [
    `file: ${file.name}`,
    `size: ${file.size}`,
    `crc:  ${crc}`,
    `md5:  ${md5}`,
    `sha1: ${sha1}`,
  ].join("\n");
}

async function cryptoSubtleHex(algo: AlgorithmIdentifier, data: Uint8Array): Promise<string> {
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
  const zone = document.getElementById("drop");
  const out = document.getElementById("hashOut");
  if (!zone || !out) return;
  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
  });
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

document.getElementById("btnTheme")?.addEventListener("click", () => {
  document.documentElement.classList.toggle("dark");
});

wireDrop();
void loadSystems();
