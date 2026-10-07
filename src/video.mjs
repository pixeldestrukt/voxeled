// Video — the sampler: an image source (a poster, a video, a camera, a screen capture, a raw frame
// stream from ffmpeg / a VJ tool) sampled onto the pixels. The other half of "LEDs and video in
// one scene" (docs/DESIGN.md, the field model): pixels and texels are both samples of a field, and
// here the field is an image, mapped into the world three ways:
//   map: uv         the fixture's own s / v — on a screen fixture that is the image, pixel-perfect
//   map: box        a wall-sized plane in the world (pos / rotDeg / widthMM / heightMM, facing +Z
//                   like a screen fixture): every LED samples where it falls on it — columns in
//                   front of a wall show the same picture at the same real place
//   map: projector  a pinhole projector (pos, target, fovDeg, aspect): projection mapping — what
//                   the beam would land on, surfaces facing away dark (no occlusion: patterns.projector
//                   has the z-tested version)
// Sources live in a REGISTRY (one per hub): a frame is { width, height, data (RGB or RGBA bytes),
// stride, stamp }. The hub (Node) fills it from files and TCP/WS streams; the page from files,
// URLs, the camera and a display capture (viewer/video.mjs). A source nobody has filled samples as
// `off` (black) — a dark wall means the feed is silent, not the page.
import { matVec, eulerMatrix, transpose3, sub } from "./vec.mjs";
import { lookAt, project, facing } from "./visibility.mjs";

export function createVideoRegistry() {
  const frames = new Map(), listeners = new Set();
  return {
    set(name, frame) {
      if (!frame || !(frame.width > 0) || !(frame.height > 0) || !frame.data) throw new Error(`video "${name}": a frame is { width, height, data }`);
      const stride = frame.stride || (frame.data.length >= frame.width * frame.height * 4 ? 4 : 3);
      if (frame.data.length < frame.width * frame.height * stride) throw new Error(`video "${name}": ${frame.data.length} bytes is short for ${frame.width}×${frame.height}×${stride}`);
      const f = { width: frame.width, height: frame.height, data: frame.data, stride, stamp: frame.stamp ?? Date.now(), frames: (frames.get(name)?.frames || 0) + 1 };
      frames.set(name, f);
      for (const l of listeners) { try { l(name, f); } catch {} }
      return f;
    },
    get: (name) => frames.get(name) || null,
    has: (name) => frames.has(name),
    names: () => [...frames.keys()],
    clear: (name) => frames.delete(name),
    onFrame(f) { listeners.add(f); return () => listeners.delete(f); },
    status: () => Object.fromEntries([...frames].map(([k, f]) => [k, { width: f.width, height: f.height, frames: f.frames, ageMs: Date.now() - f.stamp }])),
  };
}

// Sample a frame at (u, v) ∈ [0,1]² (v down the image) → [r, g, b] in 0..1.
//   filter: linear (bilinear) | nearest · outside: black | clamp | repeat
export function sampleFrame(frame, u, v, { filter = "linear", outside = "black" } = {}) {
  if (!frame) return null;
  if (outside === "repeat") { u -= Math.floor(u); v -= Math.floor(v); }
  else if (outside === "clamp") { u = u < 0 ? 0 : u > 1 ? 1 : u; v = v < 0 ? 0 : v > 1 ? 1 : v; }
  else if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  const { width: W, height: H, data, stride: S } = frame;
  const x = u * W - 0.5, y = v * H - 0.5; // texel centres at +0.5
  const at = (xi, yi) => { xi = xi < 0 ? 0 : xi >= W ? W - 1 : xi; yi = yi < 0 ? 0 : yi >= H ? H - 1 : yi; const o = (yi * W + xi) * S; return o; };
  if (filter === "nearest") { const o = at(Math.round(x), Math.round(y)); return [data[o] / 255, data[o + 1] / 255, data[o + 2] / 255]; }
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const o00 = at(x0, y0), o10 = at(x0 + 1, y0), o01 = at(x0, y0 + 1), o11 = at(x0 + 1, y0 + 1);
  const out = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const top = data[o00 + c] * (1 - fx) + data[o10 + c] * fx, bot = data[o01 + c] * (1 - fx) + data[o11 + c] * fx;
    out[c] = (top * (1 - fy) + bot * fy) / 255;
  }
  return out;
}

// PPM (P6, 8-bit): the simplest image file there is — `ffmpeg -i x.jpg -frames 1 x.ppm`.
export function decodePPM(bytes) {
  let i = 0; const tok = () => { while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x0a || bytes[i] === 0x0d || bytes[i] === 0x09 || bytes[i] === 0x23)) { if (bytes[i] === 0x23) while (i < bytes.length && bytes[i] !== 0x0a) i++; else i++; } let s = ""; while (i < bytes.length && bytes[i] > 0x20) s += String.fromCharCode(bytes[i++]); return s; };
  if (tok() !== "P6") throw new Error("PPM: not a P6 file");
  const width = +tok(), height = +tok(), max = +tok(); i++; // one whitespace byte after maxval
  if (!(width > 0 && height > 0) || max !== 255) throw new Error(`PPM: ${width}×${height}, maxval ${max} — only 8-bit P6`);
  const data = bytes.subarray(i, i + width * height * 3);
  if (data.length < width * height * 3) throw new Error("PPM: truncated");
  return { width, height, data: new Uint8Array(data), stride: 3 };
}

// ── the mappings: a pixel → where it lands in the image ──────────────────────────────────
export function makeMapping({ map = "uv", box = null, projector = null } = {}) {
  if (map === "uv" || map === "screen" || map === "fixture") return { kind: "uv", uv: (px) => [px.s, px.v], needs: ["fixture"] };
  if (map === "box") {
    const b = { pos: [0, 0, 0], rotDeg: [0, 0, 0], widthMM: 1000, heightMM: null, ...(box || {}) };
    if (!(b.widthMM > 0)) throw new Error("sampler box: widthMM must be > 0");
    b.heightMM = b.heightMM > 0 ? b.heightMM : (b.widthMM * 9) / 16;
    const Rt = transpose3(eulerMatrix(b.rotDeg));
    return { kind: "box", box: b, Rt, needs: ["world"], uv: (px) => { const l = matVec(Rt, sub(px.p, b.pos)); return [l[0] / b.widthMM + 0.5, 0.5 - l[1] / b.heightMM]; } };
  }
  if (map === "projector") {
    const p = { pos: [0, 1500, 4000], target: [0, 1500, 0], fovDeg: 40, aspect: 16 / 9, facing: true, up: [0, 1, 0], ...(projector || {}) };
    const cam = lookAt({ eye: p.pos, target: p.target, fovDeg: p.fovDeg, aspect: p.aspect, up: p.up });
    return { kind: "projector", projector: p, cam, needs: ["world"], uv: (px) => { if (p.facing && facing(cam, px.p, px.n) <= 0) return null; const r = project(cam, px.p); return r.inFront ? [r.u, r.v] : null; } };
  }
  throw new Error(`sampler map: "${map}" — uv | box | projector`);
}

// The pattern: `{ pattern: sampler, params: { source: poster, map: box, box: { … } } }`.
//   source   a name from the layout's `video:` block · gain · off: the colour where nothing lands —
//            default null = nothing: transparent on a layer (what's below shows), black alone on a scene
//   filter   linear | nearest · outside black | clamp | repeat (what lies off the image's edge)
export function sampler({ source, map = "uv", box = null, projector = null, filter = "linear", outside = "black", gain = 1, off = null } = {}) {
  if (!source) throw new Error("sampler: needs a source (a name from video:)");
  const M = makeMapping({ map, box, projector });
  const fn = (px, t, ctx) => {
    const frame = ctx?.video?.get?.(source); if (!frame) return off;
    const uv = M.uv(px); if (!uv) return off;
    const c = sampleFrame(frame, uv[0], uv[1], { filter, outside }); if (!c) return off;
    return gain === 1 ? c : [Math.min(1, c[0] * gain), Math.min(1, c[1] * gain), Math.min(1, c[2] * gain)];
  };
  fn.mapping = M;
  return fn;
}
sampler.needs = (params) => makeMapping(params || {}).needs; // what it reads depends on the mapping
sampler.check = (params, { video = [] } = {}) => { // the layout checks the source exists
  const names = video.map((v) => v.name);
  if (params?.source && !names.includes(params.source)) return `sampler: source "${params.source}" is not in video: (have: ${names.join(", ") || "none — add a video: block"})`;
  return null;
};

// ── the layout's `video:` block ──────────────────────────────────────────────────────────
//   video:
//     poster: { file: ../assets/poster.png }                    # a still (PNG / PPM; the page also decodes JPEG, GIF, WebP)
//     clip:   { file: loop.mp4, fps: 24 }                       # a video file (page); the hub takes it as a stream
//     feed:   { stream: true, width: 160, height: 90, port: 7001 }   # raw RGB frames over TCP (ffmpeg) or the bus
//     cam:    { camera: true, width: 160, height: 90 }           # the page's camera (a button starts it)
//     desk:   { display: true, width: 192, height: 108 }         # a window / screen capture (page)
//     live:   { url: https://…/x.webm }                          # a URL the page can play
export function resolveVideo(v) {
  if (!v) return [];
  if (typeof v !== "object" || Array.isArray(v)) throw new Error("video: must be a map of name → source");
  return Object.entries(v).map(([name, s]) => {
    if (!s || typeof s !== "object") throw new Error(`video.${name}: give { file } | { url } | { stream: true } | { camera: true } | { display: true }`);
    const kind = s.file ? "file" : s.url ? "url" : s.stream ? "stream" : s.camera ? "camera" : s.display ? "display" : null;
    if (!kind) throw new Error(`video.${name}: give { file } | { url } | { stream: true } | { camera: true } | { display: true }`);
    const out = { name, kind, width: s.width > 0 ? s.width | 0 : null, height: s.height > 0 ? s.height | 0 : null, fps: s.fps > 0 ? +s.fps : 30 };
    if (kind === "file") out.file = String(s.file);
    if (kind === "url") out.url = String(s.url);
    if (kind === "stream") { if (!(out.width && out.height)) throw new Error(`video.${name}: a stream needs width and height (the raw frame size)`); out.port = s.port > 0 ? s.port | 0 : null; }
    return out;
  });
}
