// Export a layout to interchange files: a binary glTF (.glb, opens in Blender/TouchDesigner/etc.)
// and the canonical resolved scene (.vxl.json). A snapshot frame is baked as vertex colours.
//
//   node examples/mobius-heart/export.mjs [layout.yaml] [out.glb] [--bare]
//   make export LAYOUT=examples/mobius-heart/layouts/grid-3x3.yaml
//
// --bare writes a PUBLISHABLE .vxl.json: the pixels (with their strands) and the emitter only — no
// structures (their file paths are yours), inputs, controls or show. A public layout next to it
// places it with `type: vxl` and declares the rest (docs/STATIC.md, "Publish a piece").
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { parseYAML } from "../../src/yaml.mjs";
import { resolveLayout } from "../../src/layout.mjs";
import { FIXTURES } from "./fixtures.mjs";
import { PATTERNS } from "../../src/patterns.mjs";
import { createShow } from "../../src/mixer.mjs";
import { createHub } from "../../src/hub.mjs";
import { sceneToGLB } from "../../src/io/gltf.mjs";
import { saveScene } from "../../src/format.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");

const argv = process.argv.slice(2), bare = argv.includes("--bare"), args = argv.filter((a) => !a.startsWith("--"));
const layoutPath = path.resolve(args[0] || path.join(HERE, "layouts/two-hearts.yaml"));
const doc = parseYAML(readFileSync(layoutPath, "utf8"));
const { scene, show } = resolveLayout(doc, { fixtures: FIXTURES, patterns: PATTERNS, baseDir: path.dirname(layoutPath) });

// Snapshot the first scene at t=0 to bake as vertex colours.
const scenes = show?.scenes?.length ? show.scenes : [{ name: "chase", render: PATTERNS.ribbonChase() }];
const shade = createShow({ scenes, control: { mode: "auto" } }).shade;
const hub = createHub({ scene, shade });
hub.renderOnce();

const glb = sceneToGLB(scene, { colors: hub.frame });

const outArg = args[1];
const base = outArg
  ? outArg.replace(/\.glb$/i, "")
  : path.join(ROOT, "build", path.basename(layoutPath, path.extname(layoutPath)));
mkdirSync(path.dirname(base + ".glb"), { recursive: true });
writeFileSync(base + ".glb", glb);
if (bare) {
  const em = scene.meta.instances[0]?.emitter;
  const pixels = scene.pixels.map(({ i, p, n, s, v, inst, strand }) => ({ i, p, n, s, v, ...(inst ? { inst } : {}), ...(strand != null ? { strand } : {}) }));
  saveScene(base + ".vxl.json", { name: scene.name, units: scene.units, count: pixels.length, pixels, meta: { source: "voxeled export --bare", pitchMM: scene.meta.pitchMM, points: pixels.length, ...(em ? { emitter: em } : {}) } });
} else saveScene(base + ".vxl.json", scene);

const rel = (p) => path.relative(process.cwd(), p);
console.log(`✓ exported "${scene.name}"`);
console.log(`  ${scene.meta.instances.length} instance(s) · ${scene.count.toLocaleString()} points`);
console.log(`  ${rel(base + ".glb")}  (${(glb.length / 1024).toFixed(0)} KB, glTF 2.0, POINTS + NORMAL + COLOR_0, metres)`);
console.log(`  ${rel(base + ".vxl.json")}  (${bare ? "bare: pixels + emitter, publishable" : "canonical voxeled scene"})`);
