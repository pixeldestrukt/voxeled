// Fixture-type registry: how a layout's `type:` becomes geometry. Shared by run.mjs (server)
// and export.mjs. Add new fixture types here — each is a (params) => { pixels, meta } function.
import { sampleHeart } from "./heart.mjs";
import { gltfToFixture } from "../io/gltf-import.mjs";
import { meshToFixture } from "../io/mesh-import.mjs";
import { ropeFixture } from "./rope.mjs";
import { tubeFixture } from "./tube.mjs";
import { matrixFixture } from "./matrix.mjs";
import { screenFixture } from "./screen.mjs";
import { add, matVec, eulerMatrix, matMul, matToEulerDeg } from "../vec.mjs";
import { defaultVFS } from "../vfs.mjs";

// Every builder gets `vfs` (and `baseDir`) from resolveLayout — files are read through it, never from disk directly.
const fsOf = (p) => p.vfs || defaultVFS(p.baseDir);

// How a fixture EMITS — the simulator's physics knobs (viewer sim mode; see docs/FORMAT.md).
//   viewingAngleDeg — datasheet full angle at 50% intensity: 120 = a typical SMD LED (Lambertian),
//                     ~10 = a spot, ~1 = laser-like, ~170 = a diffused rope/tube.
//   sizeFrac        — emitter body edge as a fraction of pixel pitch (1.0 = contiguous panel tiles)
//   coreFrac        — lit fraction of the body (the LED chip/lens within the tile)
//   softness        — edge diffusion of the lit core (0 = hard chip, 1 = soft blob)
//   gain / glow     — emissive intensity / bloom contribution
const PANEL_LED = { viewingAngleDeg: 120, sizeFrac: 1.0, coreFrac: 0.42, softness: 0.35, gain: 1.7, glow: 1.0 };
const BARE_LED = { viewingAngleDeg: 120, sizeFrac: 0.6, coreFrac: 0.6, softness: 0.5, gain: 1.6, glow: 1.0 };
const withEmitter = (f, emitter) => ({ ...f, meta: { ...(f.meta || {}), emitter } });
// The coordinate SPACES a fixture provides beyond world/volume (src/patterns.mjs SPACES): what a
// pattern may be written against on it. `fixture` = s/v + a local frame; `strand` = pixel.strand
// is meaningful; `cylinder` = v runs around a tube, s along it.
const withSpaces = (f, spaces) => ({ ...f, meta: { ...(f.meta || {}), spaces } });

export const FIXTURES = {
  // A flexible LED panel ribbon: contiguous tiles, each with a 120° SMD LED at its centre.
  "mobius-heart": (params) => withSpaces(withEmitter(sampleHeart(params), PANEL_LED), ["fixture"]),
  // Import any glTF/GLB as a fixture: LED points + normals from the file (Blender, etc.).
  //   { type: gltf, params: { file: path/to.glb } }   (path resolved from the working dir)
  gltf: (params) => withSpaces(withEmitter(gltfToFixture(fsOf(params).read(params.file), params), BARE_LED), ["fixture"]),
  // Mechanical CAD export (STL/OBJ/GLB) with each LED chip as its own body → chip-island import.
  //   { type: mesh, params: { file: model.stl, scaleToMM: 1, normalSign: outward, order: chain, maxTris: 40 } }
  mesh: (params) => withSpaces(withEmitter(meshToFixture(fsOf(params).read(params.file), { ...params, file: params.file }), params.emitter || BARE_LED), ["fixture"]),
  // LEDs along a path (a diffused rope on a tube, a strip along an edge): see src/fixtures/rope.mjs.
  //   { type: rope, params: { path: tube-1, count: 600, pitchMM: 152, radiusMM: 26, angleDeg: 60 } }
  rope: (params) => withSpaces(ropeFixture(params), ["fixture", "strand"]),
  // A flexible matrix panel rolled into a column (8×32 panels, 1–3 end to end in a diffuser tube): src/fixtures/tube.mjs.
  //   { type: tube, params: { cols: 8, rows: 32, panels: 3, pitchMM: 10, seamMM: 10 } }
  // One pixel at the origin — a phone that joined as a pixel (its screen shows the colour), a single lamp.
  // Normal +Z (out of a screen); with the phone's pose (+Y = its top edge) a flat phone faces up.
  dot: (params) => withSpaces(withEmitter({ pixels: [{ i: 0, p: [0, 0, 0], n: [0, 0, 1], s: 0, v: 0 }], meta: { source: "dot", pitchMM: params.sizeMM || 70, points: 1 } }, params.emitter || { viewingAngleDeg: 160, sizeFrac: 1, coreFrac: 0.9, softness: 0.8, gain: 1.4, glow: 1.0 }), []),
  // A flat grid (8×8, 16×16, 8×32 panels; strips laid in rows) facing +Z: src/fixtures/matrix.mjs.
  //   { type: matrix, params: { cols: 32, rows: 8, pitchMM: 10, wiring: columns } }
  matrix: (params) => withSpaces((params.emitter ? withEmitter(matrixFixture(params), params.emitter) : matrixFixture(params)), ["fixture"]),
  // A surface of texels — an LED wall as an image, a projection surface, a monitor: src/fixtures/screen.mjs.
  //   { type: screen, params: { cols: 96, rows: 54, widthMM: 3200 } }
  screen: (params) => withSpaces(screenFixture(params), ["fixture", "screen"]),
  tube: (params) => withSpaces((params.emitter ? withEmitter(tubeFixture(params), params.emitter) : tubeFixture(params)), ["fixture", "strand", "cylinder"]),
  // A baked fixture file (.vxl.json) — what the Blender addon and the Grasshopper component write,
  // or a scene from `vox import`. Must carry normals (`vox check` enforces it).
  //   { type: vxl, params: { file: piece.vxl.json } }
  vxl: (params) => {
    const fx = JSON.parse(fsOf(params).text(params.file));
    if (!Array.isArray(fx.pixels) || !fx.pixels.length) throw new Error(`${params.file}: no pixels`);
    if (fx.pixels.some((p) => !p.n)) throw new Error(`${params.file}: pixels without emission normals — run vox check`);
    // A scene exported by export.mjs carries its structures (the steel) placed by the instances
    // they rode with. Fold that placement into each entry so the baked fixture brings its steel
    // along wherever it is placed next.
    const structures = (fx.meta?.structures || []).map((s) => {
      const { parent, url, inst, ...own } = s;
      if (!parent) return own;
      const Rp = eulerMatrix(parent.rotDeg || [0, 0, 0]), Ro = eulerMatrix(own.rotDeg || [0, 0, 0]);
      return { ...own, pos: add(matVec(Rp, own.pos || [0, 0, 0]), parent.pos || [0, 0, 0]), rotDeg: matToEulerDeg(matMul(Rp, Ro)) };
    });
    // A baked SCENE (several instances) becomes one fixture: its strands stay distinct — rope 0 of
    // tube 1 is not rope 0 of tube 2 — so renumber (inst, strand) pairs as one global ordinal.
    let pixels = fx.pixels;
    if (pixels.some((p) => p.inst)) {
      const ords = new Map();
      pixels = pixels.map((p) => { const key = `${p.inst || 0}:${p.strand || 0}`; if (!ords.has(key)) ords.set(key, ords.size); const { inst, ...rest } = p; return { ...rest, strand: ords.get(key) }; });
    }
    const emitter = params.emitter || fx.meta?.emitter || (fx.meta?.instances?.[0]?.emitter) || BARE_LED;
    // spaces: what the file says, else inferred — strands if any pixel carries one, cylinder never (unknown)
    const spaces = fx.meta?.spaces || ["fixture", ...(pixels.some((p) => p.strand) ? ["strand"] : [])];
    return withSpaces(withEmitter({ pixels, meta: { ...(fx.meta || {}), instances: undefined, structures } }, emitter), spaces);
  },
};
