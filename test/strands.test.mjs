// Strand patterns + the strand plumbing they rely on: a rope fixture with three ropes carries
// distinct strands; a baked scene of several instances keeps them distinct through `type: vxl`;
// comet / plasma / fire / strands / solid are per-strand (and fire climbs); the rope's diffuser
// size reaches the emitter; `controls:` resolves; export --bare writes a publishable file.
import { PATTERNS } from "../src/patterns.mjs";
import { resolveLayout } from "../src/layout.mjs";
import { FIXTURES } from "../src/fixtures/index.mjs";
import { memoryVFS } from "../src/vfs.mjs";
import { createHub } from "../src/hub.mjs";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log("  ✓", m)) : (fail++, console.log("  ✗", m)));
const lum = (c) => Math.max(c[0], c[1], c[2]);

// two tubes, three ropes each — six strands in one scene
const doc = {
  paths: { a: [[0, 0, 0], [3000, 0, 0]], b: [[0, 0, 500], [3000, 0, 500]] },
  fixtures: { ropes: { type: "rope", params: { path: "a", count: 100, radiusMM: 25, angleDeg: [60, 180, 300] } }, ropesB: { type: "rope", params: { path: "b", count: 100, radiusMM: 25, angleDeg: [0, 120, 240], diffuserMM: 0 } } },
  instances: [{ fixture: "ropes", name: "t0" }, { fixture: "ropesB", name: "t1" }],
  controls: { panels: [{ name: "pedestal A", buttons: ["x", "y"], keys: { q: "x", w: "y" }, message: { type: "button", podpi: "a", button: "$button", pressed: "$pressed" } }], status: { fields: [{ label: "X", path: "states.x" }] } },
};
const { scene } = resolveLayout(doc, { fixtures: FIXTURES, patterns: PATTERNS });
ok(scene.count === 600 && new Set(scene.pixels.map((p) => `${p.inst}:${p.strand}`)).size === 6, "rope fixture: 3 angles → 3 strands per instance, 6 (inst,strand) pairs");
ok(scene.meta.instances[0].emitter.diffuserMM === 26 && scene.meta.instances[1].emitter.diffuserMM == null, "rope: diffuserMM 26 by default reaches the emitter; 0 leaves it out (bare LEDs)");
ok(scene.meta.controls.panels.length === 1 && scene.meta.controls.panels[0].keys.q === "x" && scene.meta.controls.status.fields[0].path === "states.x", "controls: panels + status resolve into the scene");
let err = ""; try { resolveLayout({ ...doc, controls: { panels: [{ buttons: ["x"], message: { t: 1 }, keys: { q: "z" } }] } }, { fixtures: FIXTURES, patterns: PATTERNS }); } catch (e) { err = e.message; }
ok(/unknown button "z"/.test(err), "controls: a key bound to a button that isn't there is an error");

const ctx = { scene, frame: 0 };
const S = PATTERNS.strands({ group: 1 });
const c0 = S(scene.pixels[0], 0, ctx), c1 = S(scene.pixels[100], 0, ctx), c3 = S(scene.pixels[300], 0, ctx);
ok(JSON.stringify(c0) !== JSON.stringify(c1) && JSON.stringify(c1) !== JSON.stringify(c3), "strands: a different colour per strand, across instances too");
const Sg = PATTERNS.strands({ group: 3 });
ok(JSON.stringify(Sg(scene.pixels[0], 0, ctx)) === JSON.stringify(Sg(scene.pixels[200], 0, ctx)) && JSON.stringify(Sg(scene.pixels[0], 0, ctx)) !== JSON.stringify(Sg(scene.pixels[300], 0, ctx)), "strands group:3 → one colour per tube (Thread's three ropes)");
const C = PATTERNS.comet({ speed: 0.1, tail: 0.1, ambient: 0 });
const along = scene.pixels.slice(0, 100).map((p) => lum(C(p, 5, ctx))); // t=5 → the head is mid-strand, moving forward
const head = along.indexOf(Math.max(...along));
ok(Math.max(...along) > 0.9 && head > 30 && head < 70 && along.filter((x) => x < 0.05).length > 40 && along[head - 5] > along[head - 20] && along[head - 20] > along[head + 3], `comet: a bright head at LED ${head}, a tail behind it, dark ahead`);
const along2 = scene.pixels.slice(0, 100).map((p) => lum(C(p, 8, ctx)));
ok(along2.indexOf(Math.max(...along2)) !== head, "comet: it moves");
const P = PATTERNS.plasma();
const pl = scene.pixels.slice(0, 100).map((p) => P(p, 0, ctx));
ok(pl.every((c) => lum(c) > 0) && new Set(pl.map((c) => c.map((x) => x.toFixed(2)).join())).size > 20, "plasma: lit everywhere, varying along the strand");
// fire: run it through a hub for a second of frames — heat climbs from LED 0
const F = PATTERNS.fire();
const hub = createHub({ scene, shade: F, fps: 30 });
for (let f = 0; f < 60; f++) { hub.ctx.t = f / 30; hub.ctx.frame = f; for (const px of scene.pixels) F(px, f / 30, hub.ctx); }
const heatNow = scene.pixels.slice(0, 100).map((p) => F(p, 2, hub.ctx));
ok(heatNow[0][0] > 0.3 && heatNow[0][0] >= heatNow[0][1] && heatNow[0][1] >= heatNow[0][2], `fire: LED 0 is hot and black-body coloured (${heatNow[0].map((x) => x.toFixed(2)).join(",")})`);
ok(heatNow.slice(0, 30).some((c) => c[0] > 0.1) && heatNow[99][0] < 0.02, "fire: heat has climbed the first stretch, the far end is cold (the taper, whatever the random cooling left)");
ok(PATTERNS.solid({ value: 0.85 })(scene.pixels[0], 0, ctx)[0] === 0.85 && PATTERNS.solid({ rgb: [0, 0.5, 1] })(scene.pixels[0], 0, ctx)[2] === 1, "solid: one colour");

// a baked multi-instance scene loaded back as ONE vxl fixture keeps its strands distinct
const vfs = memoryVFS(new Map([["baked.vxl.json", new TextEncoder().encode(JSON.stringify(scene))]]));
const re = resolveLayout({ fixtures: { t: { type: "vxl", params: { file: "baked.vxl.json" } } }, instances: [{ fixture: "t" }] }, { fixtures: FIXTURES, patterns: PATTERNS, vfs });
ok(re.scene.count === 600 && new Set(re.scene.pixels.map((p) => p.strand)).size === 6 && re.scene.pixels.every((p) => p.inst === 0), "type: vxl of a baked scene → strands renumbered 0..5 (not 0..2 twice), one instance");
ok(re.scene.meta.instances[0].emitter.diffuserMM === 26, "…and the baked emitter (diffuser size) rides along");

// export --bare: pixels + emitter only
const out = mkdtempSync(path.join(tmpdir(), "vox-bare-"));
execFileSync("node", ["examples/mobius-heart/export.mjs", "examples/mobius-heart/layouts/ropes.yaml", path.join(out, "r.glb"), "--bare"], { cwd: path.resolve(new URL("..", import.meta.url).pathname), stdio: "pipe" });
const bare = JSON.parse(readFileSync(path.join(out, "r.vxl.json"), "utf8"));
ok(bare.pixels.length > 0 && bare.pixels.every((p) => p.n && p.strand != null) && !bare.meta.structures && !bare.meta.instances && !bare.meta.inputs && bare.meta.emitter, `export --bare: ${bare.pixels.length} px with normals + strands, an emitter, nothing else`);

console.log(`\n${fail === 0 ? "✅" : "❌"} strands: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
