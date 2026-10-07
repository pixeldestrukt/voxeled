// The in-page hub — voxeled with no server. The same modules the Node hub runs (layout →
// scene, patterns + show mixer, sources merge) run here in the browser: files come from a
// memory VFS (dropped in, fetched from a hosted project, or restored from IndexedDB), frames go
// straight to the page, and the builder edits the layout exactly as it does through /layout.
// A remote LAN hub or bridge can still feed live frames over a WebSocket (`?ws=`), merged over
// the show (or replacing it: live-only), with JSON status in and JSON control (buttons) out.
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
import { createVideoRegistry } from "../src/video.mjs";
import { createPageVideo } from "./video.mjs";
import { createGPU } from "./gpu.mjs";

export { FIXTURES, PATTERNS, parseYAML, stringifyYAML, collectFiles, memoryVFS, fetchVFS };

// project: { name, layout (YAML text), layoutDir ("layouts" — what relative paths in it are
// relative to), files: Map<name, Uint8Array> }
export function createLocalHub({ project, onFrame, onScene, onMessage, fps = 30, gpu: gpuWanted = true } = {}) {
  const control = { mode: "auto", fader: 0, a: 0, b: 1 };
  const vfs = memoryVFS(project.files || new Map(), { baseDir: project.layoutDir || "" });
  const state = { doc: null, header: "", scene: null, show: null, hub: null, sources: null, remote: null, gpu: null, showCfg: null };
  // the sampler's image sources: files decode on their own, the camera / a display capture wait for a click (api.video.start)
  const videoRegistry = createVideoRegistry();
  const video = createPageVideo({ registry: videoRegistry, vfs, onStatus: (name, st, err) => onMessage?.({ type: "video-status", name, state: st, error: err }) });

  function build(doc) {
    const { scene, show: showCfg } = resolveLayout(doc, { fixtures: FIXTURES, patterns: PATTERNS, baseDir: project.layoutDir || "", vfs });
    const scenes = showCfg?.scenes?.length ? showCfg.scenes : [{ name: "chase", render: PATTERNS.ribbonChase() }];
    const show = createShow({ scenes, holdS: showCfg?.holdS ?? 4, fadeS: showCfg?.fadeS ?? 2.5, control });
    scene.meta.show = { scenes: show.names, single: false, warnings: showCfg?.warnings || [] };
    for (const w of showCfg?.warnings || []) console.warn("VOXELED_SHOW_WARN", w);
    // the viewer fetches structures / vantage imagery by url: object URLs from the memory vfs
    for (const s of scene.meta.structures || []) s.url = vfs.url(s.file);
    for (const v of scene.meta.vantages || []) { if (v.image) v.image.url = vfs.url(v.image.file); if (v.cube) for (const f of Object.values(v.cube)) f.url = vfs.url(f.file); }
    return { scene, show, shade: show.shade, showCfg };
  }

  function apply(doc, { announce = true } = {}) {
    const { scene, show, shade, showCfg } = build(doc); // throws → nothing changes
    const t0 = state.hub?.t0 ?? null; // the show clock runs on across layout edits
    state.hub?.stop();
    state.doc = doc; state.scene = scene; state.show = show;
    // the only input in a page is the remote hub (if any): priority 100 over the show
    state.fallback = scene.meta.merge?.fallback || "show";
    state.sources = createSources({ N: scene.count, mode: scene.meta.merge?.mode || "priority", fallback: state.fallback, timeoutMs: scene.meta.merge?.timeoutMs ?? 1000 });
    if (live.wanted && live.only) state.sources.setFallback("black");
    state.remoteSrc = state.sources.add("remote", { priority: 100 });
    state.remoteMap = buildInputMap((scene.meta.inputs || []).find((i) => i.protocol === "ws")?.map || {}, scene.count);
    state.hub = createHub({ scene, shade, fps, bus: { broadcast: (rgb) => onFrame?.(rgb) }, senders: [], sources: state.sources, video: videoRegistry, t0 });
    state.hub.start();
    video.sync(scene.meta.video || []);
    // the GPU backend: the show's pure scenes as one shader; scenes with JS-only patterns fall back per frame
    state.gpu?.dispose(); state.gpu = null; state.showCfg = showCfg;
    if (gpuWanted && showCfg?.scenes?.length) {
      try {
        state.gpu = createGPU({ scene, scenes: showCfg.scenes, ctx: state.hub.ctx, registry: videoRegistry });
        show.setFrameRenderer(state.gpu.render);
        const on = state.gpu.scenes.filter((x) => x.gpu).length;
        console.log("VOXELED_GPU", `${on}/${state.gpu.scenes.length}`, "scene(s) on the GPU", ...state.gpu.scenes.filter((x) => !x.gpu).map((x) => `· ${x.name}: ${x.why}`));
      } catch (e) { state.gpu = null; console.warn("VOXELED_GPU_OFF", e.message); }
    }
    if (announce) onScene?.(scene);
  }
  const nowT = () => (state.hub ? (Date.now() - state.hub.t0) / 1000 : 0);

  // ── live: a remote hub / bridge over a WebSocket ───────────────────────────────────────
  // States: off → connecting → open (no frames yet) → data; closed / error → reconnect every 2 s;
  // asleep (the server closed with 4000: idle, it will wake on a control press) → no reconnect
  // until something is sent. `only`: while a socket is wanted, pixels nobody drives go BLACK,
  // not to the show — a dark piece means the sender is silent, not the page.
  const live = { ws: null, url: "", wanted: false, only: false, state: "off", frames: 0, fps: 0, lastFrameAt: 0, timer: 0, queued: [], listeners: new Set() };
  const emit = () => { for (const f of live.listeners) { try { f(api.live); } catch {} } };
  setInterval(() => { live.fps = live.frames; live.frames = 0; if (live.wanted && live.state === "data" && Date.now() - live.lastFrameAt > 1000) { live.state = "open"; emit(); } else if (live.wanted) emit(); }, 1000);
  function setState(st) { live.state = st; emit(); }
  function connect(url) {
    disconnect(true);
    live.wanted = true; live.url = url; live.lastFrameAt = 0;
    if (live.only) state.sources.setFallback("black");
    let ws;
    try { ws = new WebSocket(url); } catch (e) { setState("error"); return false; }
    ws.binaryType = "arraybuffer"; live.ws = ws; setState("connecting");
    ws.onopen = () => { if (live.ws !== ws) return; setState("open"); for (const m of live.queued) ws.send(m); live.queued = []; };
    ws.onmessage = (ev) => {
      if (live.ws !== ws) return;
      if (typeof ev.data === "string") { let m; try { m = JSON.parse(ev.data); } catch { return; } if (m && typeof m === "object") onMessage?.(m); return; }
      const b = new Uint8Array(ev.data);
      if (b.length >= 12 && isArtNet(b)) { for (const p of eachArtNet(b)) if (p.op === OP_DMX) state.remoteSrc.writeUniverse(state.remoteMap, p.universe, p.data); }
      else state.remoteSrc.writeFrame(b);
      live.frames++; live.lastFrameAt = Date.now();
      if (live.state !== "data") setState("data");
    };
    ws.onerror = () => { if (live.ws === ws) setState("error"); };
    ws.onclose = (ev) => {
      if (live.ws !== ws) return;
      live.ws = null;
      if (!live.wanted) return;
      if (ev.code === 4000) { setState("asleep"); return; }       // the server chose to sleep: a press wakes it
      setState("closed"); live.timer = setTimeout(() => live.wanted && connect(url), 2000);
    };
    return true;
  }
  function disconnect(silent = false) {
    clearTimeout(live.timer); live.wanted = false; live.queued = [];
    const w = live.ws; live.ws = null; try { w?.close(); } catch {}
    state.sources?.setFallback(state.fallback || "show");
    if (!silent) setState("off");
  }
  // JSON to the remote (a pedestal press, a control message). Asleep or between reconnects, the
  // message is queued and the reconnect is what wakes the server.
  function send(obj) {
    const text = typeof obj === "string" ? obj : JSON.stringify(obj);
    if (live.ws && live.ws.readyState === WebSocket.OPEN) { live.ws.send(text); return true; }
    if (!live.wanted) return false;
    live.queued.push(text);
    if (!live.ws && (live.state === "asleep" || live.state === "closed")) connect(live.url);
    return true;
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
      if (p.scene != null) { const k = /^\d+$/.test(String(p.scene)) ? +p.scene : String(p.scene); try { state.show.pin(k, nowT()); } catch (e) { return { error: e.message, ...control, current: state.show.current(nowT()) }; } }
      else if (p.mode != null) control.mode = p.mode === "manual" ? "manual" : "auto";
      if (p.fader != null) control.fader = Math.max(0, Math.min(1, +p.fader));
      if (p.a != null) control.a = +p.a;
      if (p.b != null) control.b = +p.b;
      return { ...control, current: state.show.current(nowT()), scenes: state.show.names };
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
    inputs: async () => ({ mode: state.sources.mode, fallback: state.sources.fallback, inputs: live.wanted ? [{ name: "remote", protocol: "ws", priority: 100, ...state.sources.status()[0] }] : [] }),
    // live frames from a LAN hub / bridge: raw RGB frames or Art-Net packets over its socket, JSON
    // status in (onMessage), JSON out (send). `only`: black where nothing arrives, instead of the show.
    connectRemote(url, { only = false } = {}) { live.only = only; return connect(url); },
    disconnectRemote() { disconnect(); },
    send,
    onLive(f) { live.listeners.add(f); return () => live.listeners.delete(f); },
    get live() { return { wanted: live.wanted, url: live.url, state: live.state, fps: live.fps, lastFrameAt: live.lastFrameAt, receiving: live.wanted && Date.now() - live.lastFrameAt < 700, queued: live.queued.length }; },
    get remoteLive() { return live.wanted && state.remoteSrc?.live; },
    get t() { return nowT(); },
    files: () => vfs.list(),
    video: { list: () => video.list(), start: (name) => video.start(name), stop: (name) => video.stop(name), status: () => videoRegistry.status() },
    get gpu() { return state.gpu ? { on: true, scenes: state.gpu.scenes, frames: state.gpu.frames, grid: state.gpu.grid } : { on: false, scenes: [] }; },
    // the two paths against each other: max |JS − GPU| per channel (0..255) for the decks at t — the gate
    gpuCompare(t = nowT()) {
      if (!state.gpu) return null;
      const N = state.scene.count, js = new Uint8Array(N * 3), gpu = new Uint8Array(N * 3), ctx = state.hub.ctx;
      const r = state.show.resolve(t); if (!state.gpu.render(r, t, ctx, gpu)) return { t, ...r, gpu: false };
      const to255 = (x) => (x <= 0 ? 0 : x >= 1 ? 255 : (x * 255 + 0.5) | 0);
      for (let k = 0; k < N; k++) { const c = state.show.shade(state.scene.pixels[k], t, ctx); js[k * 3] = to255(c[0]); js[k * 3 + 1] = to255(c[1]); js[k * 3 + 2] = to255(c[2]); }
      let max = 0, sum = 0, worst = -1; for (let i = 0; i < N * 3; i++) { const d = Math.abs(js[i] - gpu[i]); sum += d; if (d > max) { max = d; worst = (i / 3) | 0; } }
      const at = (buf, k) => [buf[k * 3], buf[k * 3 + 1], buf[k * 3 + 2]];
      return { t, a: r.a, b: r.b, x: r.x, scene: state.show.names[r.x < 0.5 ? r.a : r.b], max, mean: sum / (N * 3), worst, worstJS: at(js, worst), worstGPU: at(gpu, worst), head: [0, 1, 2, 3].map((k) => ({ js: at(js, k), gpu: at(gpu, k) })) };
    },
    addFile: (name, bytes) => { vfs.put(name, bytes); project.files?.set?.(name, bytes); },
    stop: () => { state.hub?.stop(); disconnect(true); video.stopAll(); state.gpu?.dispose(); state.gpu = null; },
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
