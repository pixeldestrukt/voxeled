// The GPU backend's shader side — pure, no DOM, so it can be tested in Node and the page compiles
// what it emits. Patterns stay JavaScript (the hub has no GPU; src/patterns.mjs is the truth);
// the PURE ones have a GLSL twin here, and a show's scenes are composed into ONE fragment shader:
// every pixel is a texel of an N-texel target, its attributes come from float textures (world p,
// normal, fixture-local p, s, v, strand ordinal / index / count, instance), each scene is a
// function (a pattern, or a layer stack with masks and blends), and main() crossfades the two
// decks the mixer resolved. The page reads the target back into the same N×3 frame bytes the JS
// path produces — preview == output, on either path (viewer/gpu.mjs).
//
// What stays on the JS path (and why): fire (random state stepped per frame), paint (per-pixel
// stamps), point / lantern-in-a-hand (poses), spotlight / projector (a scene-wide depth pass).
// A scene using one of them renders in JS; the mixer falls back for any frame that needs it.

const HEADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D uA0; // p.xyz, s
uniform sampler2D uA1; // n.xyz, v
uniform sampler2D uA2; // local p.xyz, inst
uniform sampler2D uA3; // strand ordinal, index along, count, pixel index
uniform ivec2 uGrid;   // the N-texel grid (width, height)
uniform float uT;
uniform int uSceneA, uSceneB;
uniform float uMix;
uniform vec3 uCentre;  // the piece's centre (sceneFrame)
uniform float uFloorR; // its floor radius
uniform float uStrands; // strand count S
out vec4 fragColor;
struct Px { vec3 p; vec3 n; vec3 lp; float s; float v; float k; float idx; float cnt; float inst; float i; };
const float PI = 3.141592653589793;
vec3 hsv(float h, float s, float v) {
  h = fract(h);
  float i = floor(h * 6.0), f = h * 6.0 - i;
  float p = v * (1.0 - s), q = v * (1.0 - s * f), t = v * (1.0 - s * (1.0 - f));
  int m = int(mod(i, 6.0));
  if (m == 0) return vec3(v, t, p); if (m == 1) return vec3(q, v, p); if (m == 2) return vec3(p, v, t);
  if (m == 3) return vec3(p, q, v); if (m == 4) return vec3(t, p, v); return vec3(v, p, q);
}
float band(float phase, float width) { float f = fract(phase); float d = min(f, 1.0 - f); return exp(-pow(d / (width * 0.5), 2.0)); }
float clamp01(float x) { return clamp(x, 0.0, 1.0); }
vec3 clamp3(vec3 c) { return clamp(c, 0.0, 1.0); }
`;

// Each twin: glsl(fn name, uniform names) → the function source; uniforms(params, info) → the
// values. `u` is an array of vec4 uniform NAMES the composer allots to this layer (up to 4).
const twin = (needUniforms, uniforms, glsl) => ({ nUniforms: needUniforms, uniforms, glsl });
const F = (x, d) => (x == null || Number.isNaN(+x) ? d : +x);

export const GLSL_PATTERNS = {
  solid: twin(1, ({ rgb = null, hue = 0, sat = 0, value = 0.85 }) => [rgb ? [...rgb.map((x) => Math.max(0, Math.min(1, +x))), 0] : [-1, hue, sat, value]],
    (fn, [u]) => `vec4 ${fn}(Px px, float t) { if (${u}.x >= 0.0) return vec4(${u}.xyz, 1.0); return vec4(hsv(${u}.y, ${u}.z, ${u}.w), 1.0); }`),
  ribbonChase: twin(1, ({ loops = 3, speed = 0.15, sat = 1 }) => [[F(loops, 3), F(speed, 0.15), F(sat, 1), 0]],
    (fn, [u]) => `vec4 ${fn}(Px px, float t) { return vec4(hsv(px.s * ${u}.x - t * ${u}.y, ${u}.z, 1.0), 1.0); }`),
  normalRGB: twin(0, () => [], (fn) => `vec4 ${fn}(Px px, float t) { return vec4((px.n + 1.0) * 0.5, 1.0); }`),
  planeSweep: twin(1, ({ speedMM = 300, spacingMM = 500, widthMM = 120, hue = 0.95 }) => [[F(speedMM, 300), F(spacingMM, 500), F(widthMM, 120), F(hue, 0.95)]],
    (fn, [u]) => `vec4 ${fn}(Px px, float t) { float uu = (px.p.y - t * ${u}.x) / ${u}.y; float f = fract(uu); float d = min(f, 1.0 - f) * ${u}.y; float b = exp(-pow(d / ${u}.z, 2.0)); return vec4(hsv(${u}.w, 0.85, clamp01(b)), 1.0); }`),
  worldWipe: twin(2, ({ axis = 0, speedMM = 700, spacingMM = 1600, widthMM = 300, space = "world", hue = 0.33 }) => [[F(axis, 0), F(speedMM, 700), F(spacingMM, 1600), F(widthMM, 300)], [space === "fixture" ? 1 : 0, F(hue, 0.33), 0, 0]],
    (fn, [u, w]) => `vec4 ${fn}(Px px, float t) { vec3 pos = ${w}.x > 0.5 ? px.lp : px.p; float x = ${u}.x < 0.5 ? pos.x : ${u}.x < 1.5 ? pos.y : pos.z; float uu = (x - t * ${u}.y) / ${u}.z; float f = fract(uu); float d = min(f, 1.0 - f) * ${u}.z; float b = exp(-pow(d / ${u}.w, 2.0)); return vec4(hsv(${w}.y, 0.9, clamp01(b)), 1.0); }`),
  helix: twin(2, ({ turns = 1, pitch = 3, speed = 0.5, width = 0.35, hue = 0.55, hueAlong = 0.25, dir = 1 }) => [[F(turns, 1), F(pitch, 3), F(speed, 0.5), F(width, 0.35)], [F(hue, 0.55), F(hueAlong, 0.25), F(dir, 1), 0]],
    (fn, [u, w]) => `vec4 ${fn}(Px px, float t) { float phase = px.v * ${u}.x + ${w}.z * px.s * ${u}.y - t * ${u}.z; return vec4(hsv(${w}.x + px.s * ${w}.y, 0.9, clamp01(band(phase, ${u}.w))), 1.0); }`),
  lantern: twin(3, ({ path = "orbit", radiusMM = null, heightMM = 1200, speed = 20, falloffMM = 4000, hue = 0.09, sat = 0.55, ambient = 0.03, gain = 2.5, lampFrom = null }, info) => {
      if (lampFrom) throw new Error("lantern in a hand (lampFrom) reads poses — JS path");
      return [[path === "eight" ? 1 : 0, radiusMM == null ? -1 : F(radiusMM, 0), F(heightMM, 1200), F(speed, 20)], [F(falloffMM, 4000), F(hue, 0.09), F(sat, 0.55), F(ambient, 0.03)], [F(gain, 2.5), 0, 0, 0]];
    },
    (fn, [u, w, g]) => `vec4 ${fn}(Px px, float t) { float R = ${u}.y < 0.0 ? uFloorR * 0.8 : ${u}.y; float a = t * ${u}.w * PI / 180.0; vec3 L = ${u}.x > 0.5 ? vec3(uCentre.x + R * sin(a), ${u}.z, uCentre.z + R * sin(2.0 * a) * 0.6) : vec3(uCentre.x + R * cos(a), ${u}.z, uCentre.z + R * sin(a)); vec3 d = L - px.p; float dist = max(length(d), 1e-6); float facing = dot(px.n, d) / dist; float fall = 1.0 / (1.0 + pow(dist / ${w}.x, 2.0)); return vec4(hsv(${w}.y, ${w}.z, clamp01(${w}.w + ${g}.x * max(0.0, facing) * fall)), 1.0); }`),
  swirl: twin(2, ({ arms = 2, spacingMM = 3000, speed = 0.25, twist = 1, wrap = 1, width = 0.4, hue = 0.72, hueSpin = 0.3 }) => [[F(arms, 2), F(spacingMM, 3000), F(speed, 0.25), F(twist, 1)], [F(wrap, 1), F(width, 0.4), F(hue, 0.72), F(hueSpin, 0.3)]],
    (fn, [u, w]) => `vec4 ${fn}(Px px, float t) { float th = atan(px.p.z - uCentre.z, px.p.x - uCentre.x) / (2.0 * PI); float r = length(vec2(px.p.x - uCentre.x, px.p.z - uCentre.z)) / ${u}.y; float phase = ${u}.x * th + r + px.s * ${u}.w + px.v * ${w}.x - t * ${u}.z; return vec4(hsv(${w}.z + th * ${w}.w, 0.85, clamp01(band(phase, ${w}.y))), 1.0); }`),
  drops: twin(2, ({ rate = 0.6, speed = 0.5, lengthS = 0.15, spin = 2, hue = 0.58, tail = 0.5 }) => [[F(rate, 0.6), F(speed, 0.5), F(lengthS, 0.15), F(spin, 2)], [F(hue, 0.58), F(tail, 0.5), 0, 0]],
    (fn, [u, w]) => `vec4 ${fn}(Px px, float t) { float k = mod(px.inst * 7919.0 + 1.0, 97.0) / 97.0; float period = 1.0 / ${u}.x; float uu = fract(t * ${u}.x + k); float head = 1.0 - uu * (1.0 + ${u}.z) * ${u}.y * period; float below = head - px.s; float along = (below >= 0.0 && below < ${u}.z) ? (1.0 - below / ${u}.z) : 0.0; float side = 0.5 + 0.5 * cos(2.0 * PI * (px.v - uu * ${u}.w)); return vec4(hsv(${w}.x, 0.8, clamp01(pow(along, 1.0 / ${w}.y) * (0.15 + 0.85 * side))), 1.0); }`),
  comet: twin(2, ({ speed = 0.1, tail = 0.12, hue = 0.55, hueStep = 0.045, ambient = 0.04, sat = 0.9 }) => [[F(speed, 0.1), F(tail, 0.12), F(hue, 0.55), F(hueStep, 0.045)], [F(ambient, 0.04), F(sat, 0.9), 0, 0]],
    (fn, [u, w]) => `vec4 ${fn}(Px px, float t) { float k = px.k, n = px.cnt; float ph = mod(mod(k * 0.37, 1.0) + t * ${u}.x * (1.0 + 0.3 * mod(k * 7.0, 5.0) / 4.0), 2.0); bool fwd = ph < 1.0; float head = fwd ? ph : 2.0 - ph; float s = n > 1.0 ? px.idx / (n - 1.0) : 0.0; float behind = fwd ? head - s : s - head; float a = ${w}.x + (behind >= 0.0 ? exp(-behind / ${u}.y) : exp(behind * 900.0)); return vec4(hsv(mod(${u}.z + k * ${u}.w, 1.0), ${w}.y, clamp01(a)), 1.0); }`),
  plasma: twin(1, ({ speed = 1, scale = 1, hueDrift = 0.03, sat = 1 }) => [[F(speed, 1), F(scale, 1), F(hueDrift, 0.03), F(sat, 1)]],
    (fn, [u]) => `vec4 ${fn}(Px px, float t) { float k = px.k, n = px.cnt; float x = (n > 1.0 ? px.idx / n : 0.0) * ${u}.y; float stag = k / max(uStrands, 1.0); float w = 0.5 + 0.5 * (sin(x * 9.0 + t * 0.55 * ${u}.x + stag * 6.28) * 0.5 + sin(x * 23.0 - t * 0.9 * ${u}.x + k * 0.7) * 0.3 + sin((x + stag) * 4.0 + t * 0.3 * ${u}.x) * 0.2); return vec4(hsv(mod(w + t * ${u}.z + stag * 0.15, 1.0), ${u}.w, 0.5 + 0.5 * w), 1.0); }`),
  strands: twin(1, ({ group = 1, sat = 0.85, value = 1, hueStep = 0.25, hue = 0.05 }) => [[F(group, 1), F(sat, 0.85), F(value, 1), F(hueStep, 0.25)], [F(hue, 0.05), 0, 0, 0]],
    (fn, [u, w]) => `vec4 ${fn}(Px px, float t) { return vec4(hsv(mod(floor(px.k / ${u}.x) * ${u}.w + ${w}.x, 1.0), ${u}.y, ${u}.z), 1.0); }`),
  testCard: twin(1, ({ cells = 8, line = 0.02, hue = 0 }) => [[F(cells, 8), F(line, 0.02), F(hue, 0), 0]],
    (fn, [u]) => `vec4 ${fn}(Px px, float t) { float cells = ${u}.x, line = ${u}.y; float uu = px.s, vv = px.v; float gu = mod(uu * cells, 1.0), gv = mod(vv * cells, 1.0), hw = line * cells / 2.0; bool grid = min(gu, 1.0 - gu) < hw || min(gv, 1.0 - gv) < hw; bool border = uu < line || uu > 1.0 - line || vv < line || vv > 1.0 - line; bool cross = (abs(uu - 0.5) < line / 2.0 && abs(vv - 0.5) < 0.12) || (abs(vv - 0.5) < line / 2.0 && abs(uu - 0.5) < 0.12); if (border || cross) return vec4(1.0); if (grid) return vec4(vec3(0.55), 1.0); int q = (uu < 0.5 ? 0 : 1) + (vv < 0.5 ? 0 : 2); float qh = q == 0 ? 0.0 : q == 1 ? 0.33 : q == 2 ? 0.62 : 0.11; return vec4(hsv(mod(${u}.z + qh, 1.0), 0.8, 0.22), 1.0); }`),
};

// The sampler is special: it reads a video texture through a mapping (src/video.mjs makeMapping).
//   u: [kind (0 uv, 1 box, 2 projector), filter (0 linear, 1 nearest), outside (0 black, 1 clamp, 2 repeat), gain]
//   w: box pos / projector eye (xyz) + widthMM | tanHalf ; g: heightMM | aspect, facing flag ; m: a mat3 of ROWS
//   (box Rᵀ, or the camera basis r,u,f) — uploaded with transpose = true, so `m * v` applies the rows
export const GLSL_SAMPLER = {
  nUniforms: 3, nMat: 1, tex: true,
  uniforms: ({ map = "uv", box = null, projector = null, filter = "linear", outside = "black", gain = 1 }, info, M) => {
    const kind = map === "box" ? 1 : map === "projector" ? 2 : 0;
    const u = [kind, filter === "nearest" ? 1 : 0, outside === "repeat" ? 2 : outside === "clamp" ? 1 : 0, F(gain, 1)];
    if (kind === 1) { const b = M.box; return { vec4: [u, [...b.pos, b.widthMM], [b.heightMM, 0, 0, 0]], mat3: M.Rt }; }
    if (kind === 2) { const c = M.cam; return { vec4: [u, [...c.eye, c.tanHalf], [c.aspect, M.projector.facing ? 1 : 0, 0, 0]], mat3: [c.r, c.u, c.f] }; }
    return { vec4: [u, [0, 0, 0, 0], [0, 0, 0, 0]], mat3: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] };
  },
  glsl: (fn, [u, w, g], mat, tex) => `vec4 ${fn}(Px px, float t) {
  vec2 uv; float kind = ${u}.x;
  if (kind < 0.5) uv = vec2(px.s, px.v);
  else if (kind < 1.5) { vec3 l = ${mat} * (px.p - ${w}.xyz); uv = vec2(l.x / ${w}.w + 0.5, 0.5 - l.y / ${g}.x); }
  else { vec3 q = ${mat} * (px.p - ${w}.xyz); float z = q.z; if (z <= 1e-3) return vec4(0.0); if (${g}.y > 0.5 && dot(px.n, normalize(${w}.xyz - px.p)) <= 0.0) return vec4(0.0); float nx = q.x / (z * ${w}.w * ${g}.x), ny = q.y / (z * ${w}.w); uv = vec2(nx * 0.5 + 0.5, 0.5 - ny * 0.5); }
  if (${u}.z > 1.5) uv = fract(uv); else if (${u}.z > 0.5) uv = clamp(uv, 0.0, 1.0); else if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
  vec3 c = texture(${tex}, uv).rgb * ${u}.w;
  return vec4(clamp3(c), 1.0);
}`,
};

const BLEND = {
  over: (a, b, o) => `${a} + (${b} - ${a}) * ${o}`,
  add: (a, b, o) => `${a} + ${b} * ${o}`,
  max: (a, b, o) => `max(${a}, ${b} * ${o})`,
  multiply: (a, b, o) => `${a} * (1.0 - ${o} + ${b} * ${o})`,
  screen: (a, b, o) => `${a} + (1.0 - ${a}) * ${b} * ${o}`,
};

// Compose a show into one fragment shader. `scenes` is what resolveShow produced, plus each scene's
// spec (pattern/params or layers) which the layout keeps as `spec`. Returns { fragment, uniforms,
// textures, masks, scenes: [{ gpu, why }] }. A scene with a pattern that has no twin is marked
// gpu: false (its function returns black) — the mixer renders those frames in JS.
export function composeShow(scenes, { video = [] } = {}) {
  const fns = [], uniforms = [], masks = [], textures = [], report = [];
  let uid = 0;
  const allot = (n) => Array.from({ length: n }, () => `u${uid++}`);
  const layerFn = (layer, sceneK, j) => {
    const name = `s${sceneK}_l${j}`;
    if (layer.pattern === "sampler") {
      const M = layer.render?.mapping; if (!M) throw new Error("sampler: no mapping on the render (resolveShow builds it)");
      const names = allot(3), mat = `m${uid++}`, tex = `tex_${layer.params.source.replace(/[^a-zA-Z0-9_]/g, "_")}`;
      const vals = GLSL_SAMPLER.uniforms(layer.params, {}, { box: M.box, Rt: M.Rt, cam: M.cam, projector: M.projector });
      names.forEach((n, i) => uniforms.push({ name: n, type: "4f", value: vals.vec4[i] }));
      uniforms.push({ name: mat, type: "mat3", value: vals.mat3 });
      if (!textures.some((x) => x.name === tex)) textures.push({ name: tex, source: layer.params.source, filter: layer.params.filter === "nearest" ? "nearest" : "linear" });
      fns.push(GLSL_SAMPLER.glsl(name, names, mat, tex));
      return name;
    }
    const tw = GLSL_PATTERNS[layer.pattern];
    if (!tw) throw new Error(`${layer.pattern}: no GLSL twin (JS path)`);
    const vals = tw.uniforms(layer.params || {}, {}); // may throw for a JS-only variant (lantern in a hand)
    const names = allot(vals.length);
    names.forEach((n, i) => uniforms.push({ name: n, type: "4f", value: vals[i] }));
    fns.push(tw.glsl(name, names));
    return name;
  };
  scenes.forEach((sc, k) => {
    try {
      let body;
      if (sc.layers) {
        const parts = (sc.full || sc.layers).map((L, j) => { // `full` carries params, masks and renders (resolveShow)
          const fn = layerFn(L, k, j);
          const maskName = L.on === "all" ? null : `mask${masks.length}`;
          if (maskName) masks.push({ name: maskName, mask: L.mask });
          const o = (+L.opacity).toFixed(4);
          return `  { ${maskName ? `if (texelFetch(${maskName}, ivec2(int(px.i) % uGrid.x, int(px.i) / uGrid.x), 0).r > 0.5)` : ""} { vec4 d = ${fn}(px, t); if (d.w > 0.5) c = ${BLEND[L.blend]("c", "d.xyz", o)}; } }`;
        });
        body = `  vec3 c = vec3(0.0);\n${parts.join("\n")}\n  return clamp3(c);`;
      } else {
        const fn = layerFn({ pattern: sc.spec.pattern, params: sc.spec.params || {}, render: sc.render.inner || sc.render, on: "all", blend: "over", opacity: 1 }, k, 0);
        body = `  vec4 d = ${fn}(px, t); return d.w > 0.5 ? d.xyz : vec3(0.0);`;
      }
      fns.push(`vec3 scene_${k}(Px px, float t) {\n${body}\n}`);
      report.push({ name: sc.name, gpu: true });
    } catch (e) {
      fns.push(`vec3 scene_${k}(Px px, float t) { return vec3(0.0); }`);
      report.push({ name: sc.name, gpu: false, why: e.message });
    }
  });
  const switchFn = `vec3 sceneAt(int k, Px px, float t) {\n${scenes.map((_, k) => `  if (k == ${k}) return scene_${k}(px, t);`).join("\n")}\n  return vec3(0.0);\n}`;
  const main = `void main() {
  ivec2 ij = ivec2(gl_FragCoord.xy);
  vec4 a0 = texelFetch(uA0, ij, 0), a1 = texelFetch(uA1, ij, 0), a2 = texelFetch(uA2, ij, 0), a3 = texelFetch(uA3, ij, 0);
  Px px = Px(a0.xyz, a1.xyz, a2.xyz, a0.w, a1.w, a3.x, a3.y, a3.z, a2.w, a3.w);
  vec3 ca = sceneAt(uSceneA, px, uT);
  vec3 c = uMix <= 0.0 ? ca : (uMix >= 1.0 ? sceneAt(uSceneB, px, uT) : mix(ca, sceneAt(uSceneB, px, uT), uMix));
  fragColor = vec4(c, 1.0);
}`;
  const decls = [...uniforms.map((u) => `uniform ${u.type === "mat3" ? "mat3" : "vec4"} ${u.name};`), ...masks.map((m) => `uniform sampler2D ${m.name};`), ...textures.map((x) => `uniform sampler2D ${x.name};`)].join("\n");
  const fragment = `${HEADER}\n${decls}\n${fns.join("\n")}\n${switchFn}\n${main}\n`;
  return { fragment, uniforms, masks, textures, scenes: report };
}

export const VERTEX = `#version 300 es
void main() { vec2 v = vec2((gl_VertexID & 1) == 1 ? 3.0 : -1.0, (gl_VertexID & 2) == 2 ? 3.0 : -1.0); gl_Position = vec4(v, 0.0, 1.0); }`;

// The N pixels as a W×H grid of texels (W = 1024 like the viewer's colour texture).
export const GRID_W = 1024;
export const gridOf = (N) => ({ width: Math.min(GRID_W, Math.max(1, N)), height: Math.max(1, Math.ceil(N / GRID_W)) });
