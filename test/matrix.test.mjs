// `matrix` — a flat panel: geometry, +Z normals, the wiring as data order (rows / columns,
// serpentine, start corner), centring, and through a layout.
import { matrixFixture } from "../src/fixtures/matrix.mjs";
import { resolveLayout } from "../src/layout.mjs";
import { FIXTURES } from "../src/fixtures/index.mjs";
import { PATTERNS } from "../src/patterns.mjs";
import { checkFixture } from "../src/io/check.mjs";
let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log("  ✓", m)) : (fail++, console.log("  ✗", m)));
const at = (f, i) => f.pixels[i].p.slice(0, 2).join(",");

const m = matrixFixture({ cols: 4, rows: 3, pitchMM: 10 });
ok(m.pixels.length === 12 && m.meta.widthMM === 30 && m.meta.heightMM === 20 && m.pixels.every((p) => p.n[2] === 1 && p.p[2] === 0), "4×3 at 10 mm: 12 px, 30×20 mm, all facing +Z");
ok(at(m, 0) === "0,0" && at(m, 3) === "30,0" && at(m, 4) === "30,10" && at(m, 7) === "0,10" && at(m, 8) === "0,20", "rows serpentine from bottom-left: row 0 →, row 1 ←, row 2 →");
const s = matrixFixture({ cols: 4, rows: 3, serpentine: false });
ok(at(s, 4) === "0,10" && at(s, 7) === "30,10", "serpentine: false → every row runs the same way");
const c = matrixFixture({ cols: 4, rows: 3, wiring: "columns", start: "top-left" });
ok(at(c, 0) === "0,20" && at(c, 2) === "0,0" && at(c, 3) === "10,0" && at(c, 5) === "10,20" && at(c, 6) === "20,20", "columns serpentine from top-left: down column 0, up column 1, down column 2 (the 8×32 panel wiring)");
const r = matrixFixture({ cols: 4, rows: 3, start: "bottom-right" });
ok(at(r, 0) === "30,0" && at(r, 3) === "0,0" && at(r, 4) === "0,10", "start bottom-right: pixel 0 at the right, row 1 comes back");
const ctr = matrixFixture({ cols: 4, rows: 3, center: true });
ok(at(ctr, 0) === "-15,-10" && at(ctr, 11) === "15,10", "center: origin at the panel's centre");
ok(m.pixels[0].s === 0 && m.pixels[11].s === 1 && m.pixels[4].v === 0.5, "s follows data order, v the row");
let threw = ""; try { matrixFixture({ wiring: "diagonal" }); } catch (e) { threw = e.message; }
ok(/rows \| columns/.test(threw), "bad wiring is a clear error");
ok(checkFixture(m).ok, "passes vox check");
const { scene } = resolveLayout({ fixtures: { panel: { type: "matrix", params: { cols: 32, rows: 8, wiring: "columns", start: "top-left" } } }, instances: [{ fixture: "panel", name: "a", pos: [0, 1000, 0] }, { fixture: "panel", name: "b", pos: [0, 1000, 0], rotDeg: [0, 180, 0] }] }, { fixtures: FIXTURES, patterns: PATTERNS });
ok(scene.count === 512 && scene.pixels[0].n[2] === 1 && scene.pixels[256].n[2] === -1, "two 8×32 panels in a layout, one turned to face −Z");
console.log(`\n${fail === 0 ? "✅" : "❌"} matrix: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
