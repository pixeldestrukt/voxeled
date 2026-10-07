// The GPU backend (page only): the show's scenes composed into one fragment shader
// (src/gpu/glsl.mjs), every pixel a texel, attributes in float textures, the two decks crossfaded
// in the shader, the target read back into the hub's own frame bytes. Preview == output: the bytes
// are the same the JS path makes (±1 LSB of sin/exp precision). Big screens and dense video are
// what it is for; a scene using a JS-only pattern (fire, paint, a lantern in a hand, visibility)
// falls back per frame, so a show can mix both.
import { composeShow, VERTEX, gridOf } from "../src/gpu/glsl.mjs";
import { strandTable } from "../src/patterns.mjs";

export function createGPU({ scene, scenes, ctx, registry = null } = {}) {
  const N = scene.pixels.length, { width: W, height: H } = gridOf(N);
  const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(W, H) : Object.assign(document.createElement("canvas"), { width: W, height: H });
  const gl = canvas.getContext("webgl2", { antialias: false, depth: false, preserveDrawingBuffer: false, premultipliedAlpha: false });
  if (!gl) throw new Error("no WebGL2");

  // ── attribute textures ──
  const T = strandTable(ctx);
  const a0 = new Float32Array(W * H * 4), a1 = new Float32Array(W * H * 4), a2 = new Float32Array(W * H * 4), a3 = new Float32Array(W * H * 4);
  for (let i = 0; i < N; i++) {
    const px = scene.pixels[i], lp = ctx.local ? ctx.local(px) : px.p, o = i * 4;
    a0[o] = px.p[0]; a0[o + 1] = px.p[1]; a0[o + 2] = px.p[2]; a0[o + 3] = px.s || 0;
    a1[o] = px.n[0]; a1[o + 1] = px.n[1]; a1[o + 2] = px.n[2]; a1[o + 3] = px.v || 0;
    a2[o] = lp[0]; a2[o + 1] = lp[1]; a2[o + 2] = lp[2]; a2[o + 3] = px.inst || 0;
    a3[o] = T.ord[i]; a3[o + 1] = T.idx[i]; a3[o + 2] = T.counts[T.ord[i]]; a3[o + 3] = i;
  }
  // every texture is CREATED on a scratch unit: binding a new texture on whatever unit was last active would silently replace the sampler bound there
  const SCRATCH = 15, scratch = () => gl.activeTexture(gl.TEXTURE0 + SCRATCH);
  const texF = (data) => { scratch(); const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, W, H, 0, gl.RGBA, gl.FLOAT, data); nearest(); return t; };
  const nearest = () => { gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); };
  const attr = [texF(a0), texF(a1), texF(a2), texF(a3)];
  // the piece's frame (centre, floor radius) as patterns.sceneFrame computes it
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const px of scene.pixels) for (let k = 0; k < 3; k++) { if (px.p[k] < lo[k]) lo[k] = px.p[k]; if (px.p[k] > hi[k]) hi[k] = px.p[k]; }
  const centre = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2], floorR = Math.max(hi[0] - lo[0], hi[2] - lo[2]) / 2 || 1;

  // ── the program ──
  const composed = composeShow(scenes);
  const compile = (type, src) => { const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(sh); throw new Error(`shader: ${log}\n${src.split("\n").map((l, i) => `${i + 1}: ${l}`).join("\n").slice(0, 4000)}`); } return sh; };
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERTEX)); gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, composed.fragment)); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`link: ${gl.getProgramInfoLog(prog)}`);
  gl.useProgram(prog);
  const loc = (n) => gl.getUniformLocation(prog, n);
  let unit = 0;
  const bindTex = (name, tex) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(loc(name), unit); return unit++; };
  attr.forEach((t, i) => bindTex(`uA${i}`, t));
  gl.uniform2i(loc("uGrid"), W, H); gl.uniform3f(loc("uCentre"), ...centre); gl.uniform1f(loc("uFloorR"), floorR); gl.uniform1f(loc("uStrands"), T.S);
  for (const u of composed.uniforms) { if (u.type === "mat3") gl.uniformMatrix3fv(loc(u.name), true, new Float32Array(u.value.flat())); else gl.uniform4f(loc(u.name), ...u.value); }
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  for (const m of composed.masks) { // a layer's selection, one byte per texel
    const data = new Uint8Array(W * H); for (let i = 0; i < N; i++) data[i] = m.mask[i] ? 255 : 0;
    scratch(); const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, W, H, 0, gl.RED, gl.UNSIGNED_BYTE, data); nearest(); bindTex(m.name, t);
  }
  const videoTex = composed.textures.map((x) => { // a video source: uploaded when its frame changes
    scratch(); const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array(3));
    const f = x.filter === "nearest" ? gl.NEAREST : gl.LINEAR; gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return { ...x, tex: t, unit: bindTex(x.name, t), frames: -1, loaded: false };
  });
  const uT = loc("uT"), uA = loc("uSceneA"), uB = loc("uSceneB"), uMix = loc("uMix");

  // ── the target ──
  scratch(); const target = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, target); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); nearest();
  gl.bindTexture(gl.TEXTURE_2D, null); // a texture both attached and bound to a sampler unit is a feedback loop: the draw would be refused
  const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
  if (unit > SCRATCH) throw new Error(`GPU: ${unit} textures — more than this context's units`);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("framebuffer incomplete");
  gl.viewport(0, 0, W, H);
  const buf = new Uint8Array(W * H * 4);
  const gpuScene = composed.scenes.map((s) => s.gpu);

  function uploadVideo() {
    for (const v of videoTex) {
      const f = registry?.get?.(v.source); if (!f) { if (v.loaded) { v.loaded = false; } continue; }
      if (f.frames === v.frames) continue;
      gl.activeTexture(gl.TEXTURE0 + v.unit); gl.bindTexture(gl.TEXTURE_2D, v.tex);
      if (f.stride === 4) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, f.width, f.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data.buffer, f.data.byteOffset, f.data.byteLength));
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, f.width, f.height, 0, gl.RGB, gl.UNSIGNED_BYTE, f.data);
      v.frames = f.frames; v.loaded = true;
    }
  }
  // the sampler with no frame yet must read as "nothing" like the JS path: its texture stays 1×1 black
  // and the JS path returns null → transparent. The GLSL twin can't tell; so a scene whose sampler
  // has no frame renders in JS until the first frame arrives.
  const samplerReady = (k) => { const sc = scenes[k]; const layers = sc.full || [{ pattern: sc.spec?.pattern, params: sc.spec?.params }]; return layers.every((L) => L.pattern !== "sampler" || registry?.get?.(L.params?.source)); };

  let frames = 0;
  function render({ a, b, x }, t, ctx, out) {
    if (!gpuScene[a] || (x > 0 && !gpuScene[b])) return false;
    if (!samplerReady(a) || (x > 0 && !samplerReady(b))) return false;
    uploadVideo();
    gl.useProgram(prog); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.uniform1f(uT, t); gl.uniform1i(uA, a); gl.uniform1i(uB, b); gl.uniform1f(uMix, x);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!frames) { const err = gl.getError(); if (err) throw new Error(`GPU: draw error 0x${err.toString(16)}`); }
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    for (let i = 0, o = 0; i < N; i++, o += 4) { out[i * 3] = buf[o]; out[i * 3 + 1] = buf[o + 1]; out[i * 3 + 2] = buf[o + 2]; }
    frames++;
    return true;
  }
  return {
    render, scenes: composed.scenes, fragment: composed.fragment, grid: { W, H }, get frames() { return frames; },
    dispose() { try { gl.getExtension("WEBGL_lose_context")?.loseContext(); } catch {} },
  };
}
