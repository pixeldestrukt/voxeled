// The screen fixture: a surface of texels placed like any instance, lit by the same patterns and
// layers (LEDs and a video surface in one scene), carried on the bus one RGB per texel, with
// `screen` meta for the viewer's plane and screen.html's fullscreen output.
import { readFileSync } from "node:fs";
import { resolveLayout } from "../src/layout.mjs";
import { FIXTURES } from "../src/fixtures/index.mjs";
import { PATTERNS, SPACES } from "../src/patterns.mjs";
import { screenFixture, MAX_TEXELS } from "../src/fixtures/screen.mjs";
import { parseYAML } from "../src/yaml.mjs";
import { createHub } from "../src/hub.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log("  ✓", m)) : (fail++, console.log("  ✗", m)));
const thrown = (f) => { try { f(); return ""; } catch (e) { return e.message; } };

// ── geometry ──
{
  const f = screenFixture({ cols: 4, rows: 3, widthMM: 400 });
  const P = f.pixels;
  ok(P.length === 12 && f.meta.kind === "screen" && f.meta.cols === 4 && f.meta.rows === 3, "4×3 = 12 texels, kind screen");
  ok(f.meta.widthMM === 400 && f.meta.heightMM === 300 && f.meta.pitchMM === 100, "heightMM follows the aspect (300), pitch = 100");
  ok(P[0].p.join() === "-150,100,0" && P[3].p.join() === "150,100,0" && P[11].p.join() === "150,-100,0", `row-major from the TOP-LEFT, centred: ${P[0].p} … ${P[11].p}`);
  ok(P.every((p) => p.n.join() === "0,0,1"), "every texel faces +Z");
  ok(P[0].s === 0 && P[3].s === 1 && P[0].v === 0 && P[11].v === 1 && P[5].s === +(1 / 3).toFixed(5), "s runs left→right, v top→bottom (image order)");
  ok(f.meta.emitter.sizeFrac === 1 && f.meta.emitter.coreFrac === 1 && f.meta.emitter.softness === 0, "a continuous diffuse surface");
  ok(screenFixture({ cols: 4, rows: 3, widthMM: 400, heightMM: 600 }).meta.heightMM === 600, "heightMM can be forced");
  ok(/texels/.test(thrown(() => screenFixture({ cols: 1000, rows: 1000, widthMM: 1 }))) && MAX_TEXELS === 262144, "the JS path refuses a million texels, saying why");
  ok(/widthMM/.test(thrown(() => screenFixture({ widthMM: 0 }))), "widthMM must be > 0");
}

// ── spaces + the test card ──
ok(SPACES.screen && SPACES.screen.degrade && PATTERNS.testCard.needs.includes("screen"), "the screen space exists (degrades to the fixture's s/v); testCard reads it");
{
  const f = FIXTURES.screen({ cols: 41, rows: 21, widthMM: 410 });
  ok(f.meta.spaces.join() === "fixture,screen", "the screen fixture provides fixture + screen");
  const T = PATTERNS.testCard();
  const at = (c, r) => T(f.pixels[r * 41 + c], 0, {});
  ok(at(0, 0).join() === "1,1,1" && at(40, 20).join() === "1,1,1", "the border is white");
  ok(at(20, 10).join() === "1,1,1" && at(20, 8).join() === "1,1,1", "the centre cross is white");
  const q = [at(3, 3), at(37, 3), at(3, 17), at(37, 17)];
  ok(q.every((c) => Math.max(...c) > 0.1 && Math.max(...c) < 0.3) && new Set(q.map((c) => c.map((x) => x.toFixed(2)).join())).size === 4, "four quadrants, four dim tints");
  ok(f.pixels.every((p) => T(p, 0, {}).every((x) => x >= 0 && x <= 1)), "in range everywhere");
}

// ── the example: LEDs + a wall in one scene ──
{
  const doc = parseYAML(readFileSync(new URL("../examples/mobius-heart/layouts/screen.yaml", import.meta.url), "utf8"));
  const { scene, show, resolved } = resolveLayout(doc, { fixtures: FIXTURES, patterns: PATTERNS, baseDir: "examples/mobius-heart/layouts" });
  ok(scene.count === 768 * 2 + 96 * 54, `two columns + a 96×54 wall = ${scene.count} px`);
  const wall = scene.meta.instances.find((i) => i.name === "wall");
  ok(wall?.screen && wall.screen.cols === 96 && wall.screen.rows === 54 && wall.screen.widthMM === 3200 && wall.screen.heightMM === 1800, "the wall instance carries screen meta (cols, rows, mm)");
  const k = scene.meta.instances.indexOf(wall), first = scene.pixels.findIndex((p) => p.inst === k);
  ok(first === 1536 && scene.pixels.slice(first, first + 96 * 54).every((p) => p.inst === k), "the wall's texels are one contiguous run on the bus (offset 1536)");
  ok(show.scenes.length === 4 && show.warnings.length === 0, `four scenes, no space warnings (${show.warnings.join(" | ") || "clean"})`);
  const hub = createHub({ scene, shade: show.scenes[0].render, fps: 30 });
  const sweep = show.scenes[0].render, card = show.scenes[3].render;
  // the plane of light is at the same world height on a column and on the wall: world space is shared
  const yOf = (px) => px.p[1];
  const colPx = scene.pixels.find((p) => p.inst === 0 && Math.abs(yOf(p) - 800) < 6), wallPx = scene.pixels.find((p) => p.inst === k && Math.abs(yOf(p) - 800) < 20 && Math.abs(p.p[0]) < 20);
  const lum = (c) => c[0] + c[1] + c[2];
  const same = Math.abs(lum(sweep(colPx, 1.1, hub.ctx)) - lum(sweep(wallPx, 1.1, hub.ctx))) < 0.3;
  ok(colPx && wallPx && same, `planeSweep lights a column texel and a wall texel at the same height alike (${lum(sweep(colPx, 1.1, hub.ctx)).toFixed(2)} vs ${lum(sweep(wallPx, 1.1, hub.ctx)).toFixed(2)})`);
  ok(lum(card(scene.pixels[0], 0, hub.ctx)) < 0.3 && card(scene.pixels[first], 0, hub.ctx).join() === "1,1,1", "the test-card scene: columns dim, the wall's corner texel white");
  const resolvedWall = resolved.find((i) => i.name === "wall");
  ok(resolvedWall.fixture.meta.spaces.includes("screen") && !resolved[0].fixture.meta.spaces.includes("screen"), "only the wall provides the screen space");
}

console.log(`\n${fail === 0 ? "✅" : "❌"} screen: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
