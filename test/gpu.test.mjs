// The GPU backend's shader side, in Node: a show composes into one fragment shader — a function
// per scene (a pattern, or a layer stack with masks and blends), uniforms allotted per layer,
// video textures for samplers, the two decks crossfaded in main() — and scenes with JS-only
// patterns are marked for the JS path with a reason. The real compile + a JS-vs-GPU comparison
// run in headless Chrome (test/static.test.mjs).
import { readFileSync } from "node:fs";
import { composeShow, GLSL_PATTERNS, GLSL_SAMPLER, VERTEX, gridOf } from "../src/gpu/glsl.mjs";
import { resolveLayout } from "../src/layout.mjs";
import { FIXTURES } from "../src/fixtures/index.mjs";
import { PATTERNS } from "../src/patterns.mjs";
import { parseYAML } from "../src/yaml.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log("  ✓", m)) : (fail++, console.log("  ✗", m)));
const load = (name) => resolveLayout(parseYAML(readFileSync(new URL(`../examples/mobius-heart/layouts/${name}.yaml`, import.meta.url), "utf8")), { fixtures: FIXTURES, patterns: PATTERNS, baseDir: "examples/mobius-heart/layouts" });
const balanced = (src) => { let d = 0; for (const ch of src) { if (ch === "{") d++; else if (ch === "}") d--; if (d < 0) return false; } return d === 0; };

// ── twins exist for the pure patterns, and only those ──
{
  const pure = ["solid", "ribbonChase", "normalRGB", "planeSweep", "worldWipe", "helix", "lantern", "swirl", "drops", "comet", "plasma", "strands", "testCard"];
  ok(pure.every((p) => GLSL_PATTERNS[p]) && ["fire", "paint", "point", "spotlight", "projector"].every((p) => !GLSL_PATTERNS[p]), "GLSL twins: the pure patterns have one; fire / paint / point / visibility stay JS");
  ok(pure.every((p) => PATTERNS[p]) && GLSL_SAMPLER.glsl && VERTEX.includes("gl_VertexID"), "every twin names a real pattern; the sampler has its own; a fullscreen triangle vertex shader");
  for (const p of pure) { const vals = GLSL_PATTERNS[p].uniforms({}, {}); const src = GLSL_PATTERNS[p].glsl("f", vals.map((_, i) => `u${i}`)); ok(vals.every((v) => v.length === 4 && v.every((x) => Number.isFinite(x))) && /vec4 f\(Px px, float t\)/.test(src) && balanced(src), `${p}: defaults → ${vals.length} vec4 uniform(s), a vec4 f(Px, t) function`); }
  ok(gridOf(6720).width === 1024 && gridOf(6720).height === 7 && gridOf(1).width === 1 && gridOf(1).height === 1, "the N-texel grid is 1024 wide");
}

// ── columns: seven scenes, all on the GPU, the layered one with a mask ──
{
  const { show } = load("columns");
  const c = composeShow(show.scenes);
  ok(c.scenes.length === 7 && c.scenes.every((s) => s.gpu), `columns: ${c.scenes.filter((s) => s.gpu).length}/7 scenes compose`);
  ok(/vec3 scene_0\(Px px, float t\)/.test(c.fragment) && /vec3 scene_6\(/.test(c.fragment) && /vec3 sceneAt\(int k/.test(c.fragment) && /mix\(ca, sceneAt\(uSceneB/.test(c.fragment), "one shader: a function per scene, a switch, the crossfade in main()");
  ok(c.masks.length === 1 && c.masks[0].mask.length === 6144 && /texelFetch\(mask0/.test(c.fragment) && /max\(c, d\.xyz \* 0\.8000\)/.test(c.fragment) === false && /c \+ d\.xyz \* 0\.8000/.test(c.fragment), "the layered night scene: the helix layer's cylinder mask as a texture, blended with add × 0.8");
  ok(c.uniforms.length > 10 && c.uniforms.every((u) => u.type === "4f" && u.value.length === 4) && new Set(c.uniforms.map((u) => u.name)).size === c.uniforms.length, `${c.uniforms.length} vec4 uniforms, unique names`);
  ok(balanced(c.fragment) && c.fragment.startsWith("#version 300 es") && !/undefined|NaN/.test(c.fragment), "the fragment is balanced and has no undefined/NaN");
}

// ── screen: samplers (uv / box / projector) become textures + mappings ──
{
  const { show } = load("screen");
  const c = composeShow(show.scenes);
  ok(c.scenes.every((s) => s.gpu), `screen: ${c.scenes.filter((s) => s.gpu).length}/${c.scenes.length} scenes compose (samplers and the test card included)`);
  ok(c.textures.length === 1 && c.textures[0].source === "poster" && c.textures[0].name === "tex_poster" && /uniform sampler2D tex_poster/.test(c.fragment), "one video texture for the poster, shared by the three sampler scenes");
  const mats = c.uniforms.filter((u) => u.type === "mat3");
  ok(mats.length === 3 && mats.every((m) => m.value.length === 3 && m.value.every((r) => r.length === 3)), "a mat3 per sampler: identity (uv), the box's Rᵀ, the projector's basis rows");
  ok(/kind < 0\.5\) uv = vec2\(px\.s, px\.v\)/.test(c.fragment) && /vec3 q = m\d+ \* \(px\.p - u\d+\.xyz\)/.test(c.fragment), "the sampler's GLSL carries all three mappings");
}

// ── ropes (fire) and wand (poses): JS-only scenes are marked, the rest still compose ──
{
  const r = composeShow(load("ropes").show.scenes);
  const fire = r.scenes.find((s) => /fire/i.test(s.name));
  ok(fire && !fire.gpu && /no GLSL twin/.test(fire.why) && r.scenes.filter((s) => s.gpu).length >= 4, `ropes: fire stays JS ("${fire?.why}"); ${r.scenes.filter((s) => s.gpu).length}/${r.scenes.length} on the GPU`);
  ok(/vec3 scene_\d+\(Px px, float t\) \{ return vec3\(0\.0\); \}/.test(r.fragment), "a JS-only scene is a black stub in the shader (the mixer never asks the GPU for it)");
  const w = composeShow(load("wand").show.scenes);
  const held = w.scenes.find((s) => /lantern/i.test(s.name));
  ok(held && !held.gpu && /poses/.test(held.why), `wand: the lantern in a hand reads poses → JS ("${held.why}")`);
  ok(w.scenes.filter((s) => /torch|paint/i.test(s.name)).every((s) => !s.gpu), "wand: torch and paint (poses, state) → JS");
}

console.log(`\n${fail === 0 ? "✅" : "❌"} gpu: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
