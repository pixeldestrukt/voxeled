// The page's video sources (the layout's `video:` block) → the sampler's frame registry
// (src/video.mjs). A still decodes once; a clip, a URL, the camera or a display capture is drawn
// into a small canvas `fps` times a second and read back — the sampler then reads bytes, the same
// as on the hub. Sizes are the SAMPLING size (what the LEDs see), not the source's: 160×90 is
// plenty for a wall of LEDs and cheap to read back.
//   file    a project file (dropped in / next to the layout): an image (PNG/JPEG/GIF/WebP) or a video (MP4/WebM)
//   url     a video or image URL the page can load (CORS permitting)
//   camera  getUserMedia — the browser asks once; `start(name)` from a button
//   display getDisplayMedia — a window / screen capture; needs a click (`start(name)`)
//   stream  hub-only (raw frames over TCP / the bus); the page shows it black unless a hub relays it
export function createPageVideo({ registry, vfs, onStatus = null } = {}) {
  const live = new Map(); // name → { spec, el, canvas, ctx2d, timer, state, error }
  const say = (name, state, error = null) => { const e = live.get(name); if (e) { e.state = state; e.error = error; } onStatus?.(name, state, error); };
  const isVideoFile = (f) => /\.(mp4|webm|mov|m4v|ogv)$/i.test(f || "");

  function pump(e) { // copy the element into the sampling canvas and hand the bytes to the registry
    const { spec, el, canvas, ctx2d } = e;
    if (el.readyState < 2 && !(el instanceof HTMLImageElement)) return;
    try { ctx2d.drawImage(el, 0, 0, canvas.width, canvas.height); } catch { return; }
    const img = ctx2d.getImageData(0, 0, canvas.width, canvas.height);
    registry.set(spec.name, { width: canvas.width, height: canvas.height, data: img.data, stride: 4 });
    if (e.state !== "live") { say(spec.name, "live"); console.log("VOXELED_VIDEO_READY", spec.name, canvas.width + "x" + canvas.height); }
  }
  const mkCanvas = (w, h) => { const c = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h }); return [c, c.getContext("2d", { willReadFrequently: true })]; };

  async function still(e, blobOrUrl) {
    const bmp = await createImageBitmap(blobOrUrl instanceof Blob ? blobOrUrl : await (await fetch(blobOrUrl)).blob());
    const w = e.spec.width || Math.min(bmp.width, 512), h = e.spec.height || Math.round((bmp.height * w) / bmp.width);
    const [canvas, ctx2d] = mkCanvas(w, h); e.canvas = canvas; e.ctx2d = ctx2d; e.el = bmp;
    ctx2d.drawImage(bmp, 0, 0, w, h);
    registry.set(e.spec.name, { width: w, height: h, data: ctx2d.getImageData(0, 0, w, h).data, stride: 4 });
    say(e.spec.name, "live"); console.log("VOXELED_VIDEO_READY", e.spec.name, w + "x" + h);
  }
  function playing(e, src, { stream = null } = {}) {
    const v = document.createElement("video"); v.muted = true; v.loop = true; v.playsInline = true; v.autoplay = true; v.crossOrigin = "anonymous";
    if (stream) v.srcObject = stream; else v.src = src;
    const w = e.spec.width || 160, h = e.spec.height || 90;
    const [canvas, ctx2d] = mkCanvas(w, h); e.canvas = canvas; e.ctx2d = ctx2d; e.el = v;
    v.onerror = () => say(e.spec.name, "error", "can't play"); v.onloadeddata = () => say(e.spec.name, "playing");
    v.play().catch(() => {}); // autoplay is fine for a muted element
    e.timer = setInterval(() => pump(e), 1000 / (e.spec.fps || 30));
  }
  async function start(name) { // camera / display need a user's click; files and urls start themselves
    const e = live.get(name); if (!e) throw new Error(`no video source "${name}"`);
    const { spec } = e;
    try {
      if (spec.kind === "file") {
        const bytes = vfs.read(spec.file); const blob = new Blob([bytes]);
        if (isVideoFile(spec.file)) playing(e, URL.createObjectURL(blob)); else await still(e, blob);
      } else if (spec.kind === "url") {
        if (/\.(png|jpe?g|gif|webp|bmp|ppm)(\?|$)/i.test(spec.url)) await still(e, spec.url); else playing(e, spec.url);
      } else if (spec.kind === "camera") {
        const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 360 } }, audio: false }); e.stream = s; playing(e, null, { stream: s });
      } else if (spec.kind === "display") {
        const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }); e.stream = s; playing(e, null, { stream: s });
        s.getVideoTracks()[0].onended = () => { stop(name); say(name, "stopped"); };
      } else say(name, "hub-only");
    } catch (err) { say(name, "error", err.message); console.warn("VOXELED_VIDEO_ERROR", name, err.message); }
  }
  function stop(name) {
    const e = live.get(name); if (!e) return;
    clearInterval(e.timer); e.timer = 0;
    try { e.el?.pause?.(); if (e.el?.src?.startsWith("blob:")) URL.revokeObjectURL(e.el.src); } catch {}
    for (const t of e.stream?.getTracks?.() || []) t.stop();
    e.el = null; e.stream = null; registry.clear(name); say(name, "off");
  }
  // the layout changed: keep sources whose spec is unchanged (a playing camera survives an edit)
  function sync(list = []) {
    const want = new Map(list.map((s) => [s.name, s]));
    for (const [name, e] of live) if (!want.has(name) || JSON.stringify(want.get(name)) !== JSON.stringify(e.spec)) { stop(name); live.delete(name); }
    for (const spec of list) if (!live.has(spec.name)) {
      live.set(spec.name, { spec, el: null, timer: 0, state: "off", error: null });
      if (spec.kind === "file" || spec.kind === "url") start(spec.name); // no gesture needed
      else say(spec.name, spec.kind === "stream" ? "hub-only" : "ready");
    }
  }
  return {
    sync, start, stop,
    list: () => [...live.values()].map((e) => ({ ...e.spec, state: e.state, error: e.error, ...(registry.get(e.spec.name) ? { frames: registry.get(e.spec.name).frames } : {}) })),
    stopAll: () => { for (const name of [...live.keys()]) stop(name); live.clear(); },
  };
}
