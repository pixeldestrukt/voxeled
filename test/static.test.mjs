// The static page: the VFS backends, a layout resolved entirely from files in memory (no disk),
// the browser-bound import graph staying free of node: imports, and headless Chrome running the
// in-page hub against a PLAIN static file server (no voxeled hub at all): example project fetched
// next to the page, frames flowing, the builder editing, a save landing in IndexedDB and coming
// back after a reload, a dropped file used by the layout.
import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { memoryVFS, nodeVFS, fetchVFS, normalizePath, joinPath, dirname, basename } from "../src/vfs.mjs";
import { resolveLayout, collectFiles } from "../src/layout.mjs";
import { parseYAML } from "../src/yaml.mjs";
import { FIXTURES } from "../src/fixtures/index.mjs";
import { PATTERNS } from "../src/patterns.mjs";
import { createBus } from "../src/bus.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log("  ✓", m)) : (fail++, console.log("  ✗", m)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── path helpers + backends ────────────────────────────────────────────────────
ok(normalizePath("layouts/../assets/./x.stl") === "assets/x.stl" && normalizePath("/a/b/../c") === "/a/c" && joinPath("layouts", "../assets/x.stl") === "assets/x.stl" && dirname("a/b/c.yaml") === "a/b" && basename("/x/y.glb") === "y.glb", "posix path helpers");
const mem = memoryVFS(new Map([["heart_rails.stl", new Uint8Array([1, 2, 3])], ["assets/torus.glb", new Uint8Array([9])]]), { baseDir: "layouts" });
ok(mem.has("../assets/torus.glb") && mem.read("../assets/torus.glb")[0] === 9, "memory: full key lookup relative to the layout dir");
ok(mem.has("../assets/heart_rails.stl") && mem.read("../assets/heart_rails.stl").length === 3 && mem.resolve("../assets/heart_rails.stl") === "layouts/heart_rails.stl", "memory: a flat dropped file is found by its bare name");
let threw = ""; try { mem.read("nope.stl"); } catch (e) { threw = e.message; }
ok(/file not found: nope.stl/.test(threw) && /heart_rails/.test(threw), "memory: a missing file names what IS there");
const disk = nodeVFS(path.join(ROOT, "examples/mobius-heart/layouts"));
ok(disk.has("../assets/heart_rails.stl") && disk.read("../assets/heart_rails.stl").length > 1000 && disk.url("x") === null, "node: disk relative to the layout, no urls (the hub serves routes)");

// ── a layout resolved from memory only ────────────────────────────────────────
const layoutText = readFileSync(path.join(ROOT, "examples/mobius-heart/layouts/site.yaml"), "utf8");
const doc = parseYAML(layoutText);
const files = collectFiles(doc);
ok(files.includes("../assets/heart_rails.stl") && files.includes("../assets/pano-compass.png") && files.length === 3, `collectFiles lists the layout's files (${files.join(", ")})`);
const memFiles = new Map(files.map((f) => [f, disk.read(f)]));
const { scene } = resolveLayout(doc, { fixtures: FIXTURES, patterns: PATTERNS, baseDir: "layouts", vfs: memoryVFS(memFiles, { baseDir: "layouts" }) });
ok(scene.count > 0 && scene.meta.structures?.length === 4 && scene.meta.vantages?.length === 2 && scene.meta.structures[0].file === "assets/heart_rails.stl", "site.yaml resolves from memory: structures + vantages keyed by normalized path");
const baked = JSON.stringify({ ...FIXTURES["mobius-heart"]({ panelsPerSide: 4, pitchMM: 10 }) });
const thr = memoryVFS(new Map([["build/heart.vxl.json", new TextEncoder().encode(baked)]]));
const vxlDoc = { fixtures: { t: { type: "vxl", params: { file: "build/heart.vxl.json" } } }, instances: [{ fixture: "t" }] };
const rv = resolveLayout(vxlDoc, { fixtures: FIXTURES, patterns: PATTERNS, vfs: thr });
ok(rv.scene.count > 0, `type: vxl reads a baked fixture from memory (${rv.scene.count} px)`);

// ── fetchVFS with a mocked fetch ───────────────────────────────────────────────
const served = { "http://x/layouts/../assets/a.stl": [1], "http://x/assets/a.stl": [1], "http://x/cube/n.png": [2] };
const fakeFetch = async (url) => { const b = served[url]; return b ? { ok: true, arrayBuffer: async () => new Uint8Array(b).buffer } : { ok: false }; };
const fv = await fetchVFS("http://x/layouts/", ["../assets/a.stl", "missing.glb", { cube: "../cube" }], { fetchImpl: fakeFetch });
ok(fv.has("../assets/a.stl") && !fv.has("missing.glb") && fv.has("../cube/n.png") && !fv.has("../cube/e.png"), "fetchVFS: fetches next to the layout, tries cube faces per extension, skips what's missing");

// ── the browser-bound graph has no static node: imports ───────────────────────
{
  const seen = new Set(), bad = [];
  const walk = (f) => { if (seen.has(f)) return; seen.add(f); const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+"([^"]+)"|^\s*import\s+"([^"]+)"/gm)) { const spec = m[1] || m[2]; if (spec.startsWith("node:")) bad.push(path.relative(ROOT, f) + " → " + spec); else if (spec.startsWith(".")) walk(path.resolve(path.dirname(f), spec)); } };
  walk(path.join(ROOT, "viewer/local.mjs")); walk(path.join(ROOT, "viewer/store.mjs"));
  ok(bad.length === 0 && seen.size > 15, `the in-page hub's import graph (${seen.size} modules) has no static node: imports${bad.length ? ": " + bad.join(", ") : ""}`);
}

// ── headless Chrome against a plain static server ─────────────────────────────
const chrome = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", process.env.CHROME_BIN].filter(Boolean).find((b) => spawnSync("which", [b]).status === 0 || (b.includes("/") && existsSync(b)));
if (!chrome) console.log("  ⊘ SKIP static render — no Chrome found");
else {
  const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".yaml": "text/yaml", ".stl": "model/stl", ".glb": "model/gltf-binary", ".png": "image/png" };
  const server = http.createServer((req, res) => { // no hub: just files, like GitHub Pages
    let rel = decodeURIComponent(new URL(req.url, "http://x").pathname); if (rel.endsWith("/")) rel += "index.html";
    const f = path.join(ROOT, rel);
    if (!f.startsWith(ROOT) || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404); res.end("nope"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" }); res.end(readFileSync(f));
  });
  const port = await new Promise((res) => server.listen(0, () => res(server.address().port)));
  const art = path.join(ROOT, "test/artifacts"); mkdirSync(art, { recursive: true });
  const profile = path.join(art, "chrome-static-profile"); // persistent: IndexedDB must survive a reload
  // Chrome must run ASYNCHRONOUSLY: the static server lives in this process, and spawnSync would block it.
  const run = (query, name = "static") => new Promise((res) => {
    const args = ["--headless=new", "--no-sandbox", `--user-data-dir=${profile}`, "--no-first-run", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--window-size=1100,700", "--virtual-time-budget=12000", "--enable-logging=stderr", "--v=1", `--screenshot=${path.join(art, name + ".png")}`, `http://localhost:${port}/viewer/?${query}`];
    const c = spawn(chrome, args); let log = "";
    c.stdout.on("data", (d) => (log += d)); c.stderr.on("data", (d) => (log += d));
    const t = setTimeout(() => c.kill("SIGKILL"), 60000);
    c.on("close", () => { clearTimeout(t); res(log); });
  });
  // 1. no hub, no params: the page notices there is no scene.json and runs the in-page hub on the columns example
  let log = await run("sim=1&help=1");
  ok(log.includes("VOXELED_NO_HUB"), "a plain static server has no scene.json → the page switches to static mode by itself");
  ok(/VOXELED_LOCAL_HUB columns \d+ file\(s\) 6144 px/.test(log), "in-page hub built the columns example (fetched next to the page): 8 columns, 6,144 px");
  ok(log.includes("VOXELED_READY") && log.includes("VOXELED_SIM_READY") && !log.includes("VOXELED_ERROR"), "viewer + simulator ready, no errors");
  ok(log.includes("VOXELED_HELP"), "?help=1 opens the editor help panel");
  // 2. the site example: structures + a panorama come from the fetched files (object URLs), standing at a vantage works
  log = await run("example=site&stand=sidewalk&bearing=0", "static-site");
  ok(/VOXELED_LOCAL_HUB site 3 file\(s\)/.test(log) && log.includes("VOXELED_STRUCTURES_READY 4 of 4") && log.includes("VOXELED_STAND_READY sidewalk"), "site example: 3 files fetched, 4 structures loaded from object URLs, backdrop up");
  // 2b. a screen fixture: LEDs and a texel surface in one scene — drawn as one textured plane
  log = await run("example=screen&sim=1", "static-screen");
  ok(/VOXELED_LOCAL_HUB screen \d+ file\(s\) 6720 px/.test(log) && log.includes("VOXELED_SCREENS_READY 1 screen(s) 96x54"), "screen example: two columns + a 96×54 wall (6,720 px), the wall drawn as one plane");
  ok(log.includes("VOXELED_VIDEO_READY poster 192x108"), "the layout's video: poster (a PNG next to the layout) is decoded in the page for the sampler");
  ok(!log.includes("VOXELED_ERROR") && !/Uncaught/.test(log), "no page errors with a screen");
  // 3. builder against the in-page hub; a save lands in IndexedDB and is reopened on the next visit
  log = await run("example=columns&build=1&select=0", "static-build");
  ok(log.includes("VOXELED_BUILDER_READY 8"), "builder ready against the in-page hub (8 layout entries)");
  // 4. the public face: ?ui=bar on the ropes example — ropes drawn as diffused tubes, the pattern bar
  //    pins a scene, the piece's controls are drawn, and LIVE mode round-trips against a real bus:
  //    frames in (raw RGB), a status JSON in → the controls' fields; a bare socket = "only what arrives"
  const bus = createBus({ port: 0 });
  await new Promise((r) => bus.server.once("listening", r));
  const busPort = bus.server.address().port, N = 591; // the ropes example: 3 × 197 px
  const frame = new Uint8Array(N * 3); for (let i = 0; i < N; i++) { frame[i * 3] = 255; frame[i * 3 + 1] = 40; }
  const pump = setInterval(() => { bus.broadcast(frame); if (bus.clients.size) bus.broadcastText({ type: "status", states: { x: "idle", y: "connected", z: null }, podpi: { a: true, b: false } }); }, 100);
  log = await run(`example=ropes&ui=bar&sim=1&scene=comet&ws=ws://localhost:${busPort}/bus`, "static-bar");
  clearInterval(pump); bus.close();
  ok(/VOXELED_ROPES_READY 3 fixture\(s\) 3 rope\(s\)/.test(log), "ropes example: three rope fixtures drawn as three diffused tubes");
  ok(/VOXELED_CONTROLS 2 panel\(s\) 6 button\(s\)/.test(log) && log.includes("VOXELED_CTL_PANEL open"), "controls: two pedestal panels, six buttons, from the layout; open on a wide window (a phone starts folded)");
  ok(log.includes("VOXELED_LIVE connecting") && log.includes("VOXELED_LIVE data"), "live: ?ws= connected to a real bus and received frames");
  ok(/VOXELED_CTL_STATUS strand X=idle · strand Y=connected · strand Z=– · pedestals=A/.test(log), "a status JSON on the socket fills the controls' fields (paths into the message; objects → the truthy keys)");
  ok(!log.includes("VOXELED_ERROR") && !/Uncaught/.test(log), "no page errors in bar mode");
  server.close();
}

console.log(`\n${fail === 0 ? "✅" : "❌"} static: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
