// The in-page hub — voxeled with no server. The same modules the Node hub runs (layout →
// scene, patterns + show mixer, sources merge) run here in the browser: files come from a
// memory VFS (dropped in, fetched from a hosted project, or restored from IndexedDB), frames go
// straight to the page, and the builder edits the layout exactly as it does through /layout.
// A remote LAN hub can still feed live frames over a WebSocket (`?ws=`), merged over the show.
import { parseYAML } from "../src/yaml.mjs";
import { stringifyYAML, yamlHeader } from "../src/yaml-emit.mjs";
import { resolveLayout, collectFiles } from "../src/layout.mjs";
import { FIXTURES } from "../src/fixtures/index.mjs";
import { PATTERNS } from "../src/patterns.mjs";
import { createShow } from "../src/mixer.mjs";
import { createHub } from "../src/hub.mjs";
import { createSources } from "../src/input/sources.mjs";
import { buildInputMap } from "../src/input/map.mjs";
import { eachArtNet, isArtNet, OP_DMX } from "../src/input/artnet-packet.mjs";
import { memoryVFS, fetchVFS, dirname, joinPath } from "../src/vfs.mjs";

export { FIXTURES, PATTERNS, parseYAML, stringifyYAML, collectFiles, memoryVFS, fetchVFS };

// project: { name, layout (YAML text), layoutDir ("layouts" — what relative paths in it are
// relative to), files: Map<name, Uint8Array> }
export function createLocalHub({ project, onFrame, onScene, fps = 30 } = {}) {
  const control = { mode: "auto", fader: 0, a: 0, b: 1 };
  const vfs = memoryVFS(project.files || new Map(), { baseDir: project.layoutDir || "" });
  const state = { doc: null, header: "", scene: null, show: null, hub: null, sources: null, remote: null };

  function build(doc) {
    const { scene, show: showCfg } = resolveLayout(doc, { fixtures: FIXTURES, patterns: PATTERNS, baseDir: project.layoutDir || "", vfs });
    const scenes = showCfg?.scenes?.length ? showCfg.scenes : [{ name: "chase", render: PATTERNS.ribbonChase() }];
    const show = createShow({ scenes, holdS: showCfg?.holdS ?? 4, fadeS: showCfg?.fadeS ?? 2.5, control });
    scene.meta.show = { scenes: show.names, single: false };
    // the viewer fetches structures / vantage imagery by url: object URLs from the memory vfs
    for (const s of scene.meta.structures || []) s.url = vfs.url(s.file);
    for (const v of scene.meta.vantages || []) { if (v.image) v.image.url = vfs.url(v.image.file); if (v.cube) for (const f of Object.values(v.cube)) f.url = vfs.url(f.file); }
    return { scene, show, shade: show.shade };
  }

  function apply(doc, { announce = true } = {}) {
    const { scene, show, shade } = build(doc); // throws → nothing changes
    state.hub?.stop();
    state.doc = doc; state.scene = scene; state.show = show;
    // the only input in a page is the remote hub (if any): priority 100 over the show
    state.sources = createSources({ N: scene.count, mode: scene.meta.merge?.mode || "priority", fallback: scene.meta.merge?.fallback || "show", timeoutMs: scene.meta.merge?.timeoutMs ?? 1000 });
    state.remoteSrc = state.sources.add("remote", { priority: 100 });
    state.remoteMap = buildInputMap((scene.meta.inputs || []).find((i) => i.protocol === "ws")?.map || {}, scene.count);
    state.hub = createHub({ scene, shade, fps, bus: { broadcast: (rgb) => onFrame?.(rgb) }, senders: [], sources: state.sources });
    state.hub.start();
    if (announce) onScene?.(scene);
  }

  const text = project.layout || "";
  state.header = yamlHeader(text);
  apply(parseYAML(text), { announce: false });

  // ── the same surface the viewer uses against a hub ─────────────────────────────
  const api = {
    kind: "local",
    get scene() { return state.scene; },
    get doc() { return state.doc; },
    vfs,
    getScene: async () => state.scene,
    control: async (params) => {
      const p = params instanceof URLSearchParams ? Object.fromEntries(params) : params || {};
      if (p.mode != null) control.mode = p.mode === "manual" ? "manual" : "auto";
      if (p.fader != null) control.fader = Math.max(0, Math.min(1, +p.fader));
      if (p.a != null) control.a = +p.a;
      if (p.b != null) control.b = +p.b;
      return { ...control };
    },
    getLayout: async () => ({
      path: joinPath(project.layoutDir || "", project.layoutName || "layout.yaml"), doc: state.doc, fixtures: Object.keys(FIXTURES), patterns: Object.keys(PATTERNS),
      instances: state.scene.meta.instances.map((i) => ({ name: i.name, fixture: i.fixture, pos: i.pos, rotDeg: i.rotDeg, src: i.src })),
    }),
    // apply live; write=true also hands the YAML back to be persisted (IndexedDB, a download…)
    postLayout: async (doc, write) => {
      try { apply(doc); } catch (e) { return { error: e.message }; }
      let written = false;
      if (write) { project.layout = stringifyYAML(doc, { header: state.header }); written = true; await project.onSave?.(project); }
      return { ok: true, written, count: state.scene.count, instances: state.scene.meta.instances.length };
    },
    inputs: async () => ({ mode: state.sources.mode, fallback: state.sources.fallback, inputs: state.remote ? [{ name: "remote", protocol: "ws", priority: 100, ...state.sources.status()[0] }] : [] }),
    // live frames from a LAN hub: raw RGB frames or Art-Net packets over its /bus
    connectRemote(url) {
      api.disconnectRemote();
      let ws;
      try { ws = new WebSocket(url); } catch (e) { return false; }
      ws.binaryType = "arraybuffer";
      ws.onmessage = (ev) => {
        if (typeof ev.data === "string") return;
        const b = new Uint8Array(ev.data);
        if (isArtNet(b)) { for (const p of eachArtNet(b)) if (p.op === OP_DMX) state.remoteSrc.writeUniverse(state.remoteMap, p.universe, p.data); }
        else state.remoteSrc.writeFrame(b);
      };
      ws.onclose = () => { if (state.remote === ws) { state.remote = null; setTimeout(() => api.connectRemote(url), 2000); } };
      state.remote = ws;
      return true;
    },
    disconnectRemote() { const w = state.remote; state.remote = null; try { w?.close(); } catch {} },
    get remoteLive() { return !!state.remote && state.remoteSrc?.live; },
    files: () => vfs.list(),
    addFile: (name, bytes) => { vfs.put(name, bytes); project.files?.set?.(name, bytes); },
    stop: () => { state.hub?.stop(); api.disconnectRemote(); },
  };
  return api;
}

// A hosted project: a layout at a URL, with its files next to it (Thread's site, the examples).
export async function loadHostedProject(layoutUrl, { fetchImpl = fetch } = {}) {
  const r = await fetchImpl(layoutUrl);
  if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${layoutUrl}`);
  const layout = await r.text();
  const doc = parseYAML(layout);
  const base = new URL(".", new URL(layoutUrl, location.href)).href;
  const vfs = await fetchVFS(base, collectFiles(doc));
  const name = decodeURIComponent(layoutUrl.split("/").pop().replace(/\.ya?ml$/, ""));
  return { name, layout, layoutName: layoutUrl.split("/").pop(), layoutDir: "", files: vfs.store, source: layoutUrl };
}
