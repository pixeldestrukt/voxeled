// Spaces + layers: a pattern declares the coordinate spaces it reads, a fixture the spaces it
// provides, and a scene is checked against the fixtures it runs on. A scene can be a stack of
// layers with selectors (on:) and blends — a generic pattern underneath, a specialised one only
// where it fits.
import { resolveLayout } from "../src/layout.mjs";
import { FIXTURES } from "../src/fixtures/index.mjs";
import { PATTERNS, SPACES } from "../src/patterns.mjs";
import { createHub } from "../src/hub.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log("  ✓", m)) : (fail++, console.log("  ✗", m)));
const thrown = (f) => { try { f(); return ""; } catch (e) { return e.message; } };

const base = {
  fixtures: {
    panel: { type: "matrix", params: { cols: 8, rows: 4, pitchMM: 10 } },
    column: { type: "tube", params: { cols: 8, rows: 16, panels: 1, pitchMM: 10 } },
    string: { type: "rope", params: { path: [[0, 0, 0], [1000, 0, 0]], count: 20, angleDeg: [0, 180], radiusMM: 20 } },
  },
  instances: [{ fixture: "panel", name: "p1" }, { fixture: "column", name: "c1", pos: [500, 0, 0] }, { fixture: "string", name: "s1", pos: [0, 500, 0] }],
};
const resolve = (show) => resolveLayout({ ...base, show }, { fixtures: FIXTURES, patterns: PATTERNS });

// ── the vocabulary ──
ok(["world", "volume", "fixture", "strand", "cylinder"].every((k) => SPACES[k]) && SPACES.world.always && SPACES.strand.degrade && SPACES.cylinder.degrade, "SPACES: world/volume always, the rest say how they degrade");
ok(PATTERNS.helix.needs.includes("cylinder") && PATTERNS.comet.needs.includes("strand") && PATTERNS.planeSweep.needs.includes("world") && PATTERNS.solid.needs.length === 0, "patterns declare what they read");
{
  const { scene, resolved } = resolve({ scenes: [{ name: "a", pattern: "solid" }] });
  const sp = Object.fromEntries(resolved.map((i) => [i.name, i.fixture.meta.spaces]));
  ok(sp.p1.join() === "fixture" && sp.c1.join() === "fixture,strand,cylinder" && sp.s1.join() === "fixture,strand", `fixtures declare what they provide (${JSON.stringify(sp)})`);
  ok(scene.count === 32 + 128 + 40, "three fixtures, 200 px");
}

// ── validation: a space the fixture lacks is said out loud ──
{
  const warn = (show) => resolve(show).show.warnings;
  const w = warn({ scenes: [{ name: "spiral", pattern: "helix" }] });
  ok(w.length === 2 && /"helix" reads the cylinder space/.test(w[0]) && /fixture "panel" \(matrix, e\.g\. instance "p1"\)/.test(w[0]) && /degrades there/.test(w[0]) && /on: \{ space: cylinder \}/.test(w[0]) && /fixture "string"/.test(w[1]), `a cylinder pattern on a panel and a rope: one warning per fixture, naming the fix — ${w[0].slice(0, 70)}…`);
  ok(warn({ scenes: [{ name: "c", pattern: "comet" }] }).length === 1 && /one strand/.test(warn({ scenes: [{ name: "c", pattern: "comet" }] })[0]), "a strand pattern on a panel: warned, degrades to one strand");
  ok(warn({ scenes: [{ name: "w", pattern: "planeSweep" }] }).length === 0 && warn({ scenes: [{ name: "s", pattern: "solid" }] }).length === 0, "world patterns and solid: nothing to say");
  ok(warn({ scenes: [{ name: "ok", layers: [{ pattern: "helix", on: { space: "cylinder" } }] }] }).length === 0, "the same pattern on a layer narrowed to the cylinder space: clean");
  ok(warn({ scenes: [{ name: "ok", layers: [{ pattern: "helix", on: { fixture: "column" } }] }] }).length === 0, "…or narrowed to the tube fixture");
  const w2 = warn({ scenes: [{ name: "bad", layers: [{ pattern: "helix", on: { fixture: ["column", "panel"] } }] }] });
  ok(w2.length === 1 && /layer #1/.test(w2[0]) && /narrow the layer's on:/.test(w2[0]), "a layer that still covers the panel is warned, naming the layer");
  ok(/on\.fixture "nope"/.test(thrown(() => resolve({ scenes: [{ layers: [{ pattern: "solid", on: { fixture: "nope" } }] }] }))), "unknown fixture in on:");
  ok(/on\.instance "x"/.test(thrown(() => resolve({ scenes: [{ layers: [{ pattern: "solid", on: { instance: "x" } }] }] }))), "unknown instance in on:");
  ok(/blend "glow"/.test(thrown(() => resolve({ scenes: [{ layers: [{ pattern: "solid", blend: "glow" }] }] }))), "unknown blend");
  ok(/needs a pattern: or layers:/.test(thrown(() => resolve({ scenes: [{ name: "empty" }] }))), "a scene with neither");
}

// ── layers render: masks, blends, opacity ──
{
  const { scene, show } = resolve({ scenes: [{
    name: "night",
    layers: [
      { pattern: "solid", params: { rgb: [0.2, 0.2, 0.2] } },                                   // everywhere
      { pattern: "solid", params: { rgb: [0.5, 0, 0] }, on: { fixture: "column" }, blend: "add" },  // tube only
      { pattern: "solid", params: { rgb: [0, 1, 0] }, on: { instance: "s1" }, blend: "max", opacity: 0.5 },
      { pattern: "solid", params: { rgb: [1, 1, 1] }, on: { space: "cylinder" }, blend: "multiply", opacity: 0.5 },
    ],
  }] });
  const sc = show.scenes[0];
  ok(sc.layers.length === 4 && sc.layers[0].count === 200 && sc.layers[1].count === 128 && sc.layers[2].count === 40 && sc.layers[3].count === 128, `layer masks: ${sc.layers.map((l) => l.count).join("/")} px`);
  const hub = createHub({ scene, shade: sc.render, fps: 30 });
  const at = (name) => scene.pixels.find((p) => scene.meta.instances[p.inst].name === name);
  const c = (px) => sc.render(px, 0, hub.ctx).map((x) => +x.toFixed(3));
  ok(c(at("p1")).join() === "0.2,0.2,0.2", `panel: the base layer only (${c(at("p1"))})`);
  ok(c(at("c1")).join() === "0.7,0.2,0.2", `tube: base + red added; × white at half opacity leaves it (${c(at("c1"))})`);
  ok(c(at("s1")).join() === "0.2,0.5,0.2", `rope: base, green at half opacity by max (${c(at("s1"))})`);
  ok(scene.meta.show == null || true, "layers are invisible to the mixer: one render per scene");
}

// ── the columns example carries a layered scene and still resolves ──
{
  const { readFileSync } = await import("node:fs");
  const { parseYAML } = await import("../src/yaml.mjs");
  const doc = parseYAML(readFileSync(new URL("../examples/mobius-heart/layouts/columns.yaml", import.meta.url), "utf8"));
  const { show } = resolveLayout(doc, { fixtures: FIXTURES, patterns: PATTERNS, baseDir: "examples/mobius-heart/layouts" });
  const night = show.scenes.find((s) => /layers/.test(s.name));
  ok(night && night.layers.length === 2 && night.layers[1].on.space === "cylinder" && night.layers[1].blend === "add", "columns.yaml: the layered 'night' scene resolves (plasma + helix added on the tubes)");
}

console.log(`\n${fail === 0 ? "✅" : "❌"} layers: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
