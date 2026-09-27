// Projects in the browser — no server, no account: IndexedDB holds each project's layout text
// and its files (the models, structures, panoramas the user dropped in), so a static page keeps
// what was "uploaded" across reloads. Bundles (one JSON file, files base64) move a project
// between browsers or publish it next to the page as a hosted project.
const DB = "voxeled", STORE = "projects";
function open() {
  return new Promise((ok, err) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "name" });
    r.onsuccess = () => ok(r.result); r.onerror = () => err(r.error);
  });
}
const tx = (db, mode, fn) => new Promise((ok, err) => { const t = db.transaction(STORE, mode), s = t.objectStore(STORE); const q = fn(s); t.oncomplete = () => ok(q?.result); t.onerror = () => err(t.error); });

export async function listProjects() { const db = await open(); const all = await tx(db, "readonly", (s) => s.getAll()); db.close(); return (all || []).map((p) => ({ name: p.name, updated: p.updated, files: Object.keys(p.files || {}).length })).sort((a, b) => b.updated - a.updated); }
export async function getProject(name) {
  const db = await open(); const p = await tx(db, "readonly", (s) => s.get(name)); db.close();
  if (!p) return null;
  const files = new Map();
  for (const [k, v] of Object.entries(p.files || {})) files.set(k, new Uint8Array(v instanceof Blob ? await v.arrayBuffer() : v));
  return { name: p.name, layout: p.layout, layoutName: p.layoutName || "layout.yaml", layoutDir: p.layoutDir || "", files, updated: p.updated, source: p.source };
}
export async function putProject(p) {
  const files = {};
  for (const [k, v] of p.files || []) files[k] = new Blob([v]);
  const db = await open();
  await tx(db, "readwrite", (s) => s.put({ name: p.name, layout: p.layout, layoutName: p.layoutName, layoutDir: p.layoutDir || "", files, source: p.source || null, updated: Date.now() }));
  db.close();
}
export async function deleteProject(name) { const db = await open(); await tx(db, "readwrite", (s) => s.delete(name)); db.close(); }

// ── bundles ────────────────────────────────────────────────────────────────────
const b64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
export function exportBundle(p) {
  return JSON.stringify({ voxeledProject: 1, name: p.name, layoutName: p.layoutName || "layout.yaml", layoutDir: p.layoutDir || "", layout: p.layout, files: Object.fromEntries([...p.files].map(([k, v]) => [k, b64(v)])) });
}
export function importBundle(json) {
  const o = typeof json === "string" ? JSON.parse(json) : json;
  if (!o || o.voxeledProject !== 1 || typeof o.layout !== "string") throw new Error("not a voxeled project bundle");
  return { name: o.name || "project", layoutName: o.layoutName || "layout.yaml", layoutDir: o.layoutDir || "", layout: o.layout, files: new Map(Object.entries(o.files || {}).map(([k, v]) => [k, unb64(v)])) };
}
