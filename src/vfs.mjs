// VFS — where a layout's files come from. The same layout resolves on the hub (Node, files on
// disk next to the layout) and in a static page (files the user dropped in, kept in the browser;
// or files fetched from a URL next to a hosted layout). Every reader in the pipeline — paths,
// structures, vantages, fixture builders — takes a `vfs` and never touches the filesystem itself.
//
//   vfs.resolve(rel) → the canonical key for a layout-relative file   (Node: absolute path)
//   vfs.has(rel) / vfs.read(rel) → Uint8Array / vfs.text(rel)
//   vfs.url(rel) → something a browser can fetch (an object URL), or null on the hub (it serves routes)
//
// Path helpers are posix-only and dependency-free so this module loads in a browser; the Node
// backend is imported only when running under Node.
let nodeFs = null, nodePath = null;
if (typeof process !== "undefined" && process.versions?.node) { nodeFs = await import("node:fs"); nodePath = await import("node:path"); }

export function normalizePath(p) {
  const abs = p.startsWith("/"), out = [];
  for (const seg of p.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") { if (out.length && out[out.length - 1] !== "..") out.pop(); else if (!abs) out.push(".."); }
    else out.push(seg);
  }
  return (abs ? "/" : "") + out.join("/");
}
export const joinPath = (base, rel) => (rel.startsWith("/") ? normalizePath(rel) : normalizePath((base ? base + "/" : "") + rel));
export const basename = (p) => p.replace(/\/+$/, "").split("/").pop();
export const dirname = (p) => { const s = p.replace(/\/+$/, ""); const i = s.lastIndexOf("/"); return i < 0 ? "" : i === 0 ? "/" : s.slice(0, i); };
export const extname = (p) => (basename(p).match(/\.(\w+)$/)?.[1] || "").toLowerCase();

const td = new TextDecoder();

// Files on disk (the hub, the CLI, tests). Relative names resolve against baseDir.
export function nodeVFS(baseDir = null) {
  if (!nodeFs) throw new Error("nodeVFS needs Node");
  const root = nodePath.resolve(baseDir || process.cwd());
  const resolve = (rel) => nodePath.resolve(root, rel);
  return {
    kind: "node", root, resolve,
    has: (rel) => nodeFs.existsSync(resolve(rel)),
    read: (rel) => { const f = resolve(rel); if (!nodeFs.existsSync(f)) throw new Error(`file not found: ${rel} (relative to ${root})`); return new Uint8Array(nodeFs.readFileSync(f)); },
    text: (rel) => td.decode(nodeVFS(root).read(rel)),
    url: () => null,
  };
}

// Files in memory (a browser project: dropped files; a fetched project). Keys are normalized
// paths. A file referenced as `../assets/x.stl` is found by its full key first, then by its bare
// name — dropped files are flat, layouts aren't.
export function memoryVFS(files = new Map(), { baseDir = "" } = {}) {
  const store = new Map();
  const urls = new Map();
  const put = (name, bytes) => { store.set(normalizePath(name), bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)); urls.delete(normalizePath(name)); };
  for (const [k, v] of files instanceof Map ? files : Object.entries(files)) put(k, v);
  const find = (rel) => { const key = joinPath(baseDir, rel); if (store.has(key)) return key; const b = basename(rel); for (const k of store.keys()) if (basename(k) === b) return k; return null; };
  const vfs = {
    kind: "memory", root: baseDir, store, put,
    resolve: (rel) => find(rel) || joinPath(baseDir, rel),
    has: (rel) => find(rel) != null,
    read: (rel) => { const k = find(rel); if (k == null) throw new Error(`file not found: ${rel} (have: ${[...store.keys()].join(", ") || "none"})`); return store.get(k); },
    text: (rel) => td.decode(vfs.read(rel)),
    url: (rel) => {
      const k = find(rel); if (k == null) return null;
      if (!urls.has(k)) { if (typeof URL === "undefined" || !URL.createObjectURL) return null; urls.set(k, URL.createObjectURL(new Blob([store.get(k)]))); }
      return urls.get(k);
    },
    list: () => [...store.keys()],
    remove: (name) => { const k = normalizePath(name); store.delete(k); urls.delete(k); },
  };
  return vfs;
}

// The right backend for the environment: disk under Node, memory in a browser.
export const defaultVFS = (baseDir) => (nodeFs ? nodeVFS(baseDir) : memoryVFS(new Map(), { baseDir: baseDir || "" }));

// Fetch a hosted project's files (relative to baseUrl) into a memory VFS. `names` are the
// layout-relative files (see collectFiles in layout.mjs); a `{ cube: dir }` entry tries each face
// with each extension. Missing files are skipped (the layout reports them precisely later).
export async function fetchVFS(baseUrl, names, { fetchImpl = globalThis.fetch } = {}) {
  const vfs = memoryVFS();
  const base = baseUrl.endsWith("/") ? baseUrl : baseUrl + "/";
  const get = async (rel) => { try { const r = await fetchImpl(new URL(rel, base).href); if (r.ok) vfs.put(rel, new Uint8Array(await r.arrayBuffer())); } catch {} };
  for (const n of names) {
    if (typeof n === "string") await get(n);
    else if (n.cube) for (const f of ["n", "e", "s", "w", "u", "d"]) for (const e of ["jpg", "png", "webp", "jpeg"]) { const rel = `${n.cube}/${f}.${e}`; await get(rel); if (vfs.has(rel)) break; }
  }
  return vfs;
}
