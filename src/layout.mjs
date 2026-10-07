// Layout (a "rig") — place INSTANCES of fixtures in shared world space.
//
// A fixture is geometry authored once in its own local frame (e.g. one heart). An instance is
// that fixture placed by a world transform (translation in mm + Euler rotation in degrees). This
// is voxeled's version of MVR's model: fixtures + placements. Because instances live in one
// shared world space, a world-space pattern automatically accounts for the real distance between
// them — 2 hearts 10 ft apart really are 10 ft apart to the pattern.
import { add, matVec, eulerMatrix } from "./vec.mjs";
import { buildScene } from "./format.mjs";
import { resolveStructure } from "./structures.mjs";
import { loadPaths, resolvePath, samplePath } from "./paths.mjs";
import { resolveSite, resolveVantages } from "./site.mjs";
import { defaultVFS } from "./vfs.mjs";

// instances: [{ name, fixtureName, fixture:{pixels,meta}, pos:[x,y,z]mm, rotDeg:[rx,ry,rz] }]
// Each instance carries its OWN resolved fixture, so a rig can mix different fixtures.
export function buildSceneFromLayout({ name, units = "mm", instances, meta = {} }) {
  const pixels = [];
  let i = 0;
  instances.forEach((inst, k) => {
    const rot = eulerMatrix(inst.rotDeg || [0, 0, 0]);
    const pos = inst.pos || [0, 0, 0];
    for (const lp of inst.fixture.pixels) {
      const p = add(matVec(rot, lp.p), pos); // world position
      const n = matVec(rot, lp.n); // rotate the emission normal (translation doesn't affect it)
      pixels.push({
        i: i++,
        inst: k, // which instance — lets fixture-space patterns re-base to local coords
        p: p.map((x) => +x.toFixed(2)),
        n: n.map((x) => +x.toFixed(4)),
        s: lp.s,
        v: lp.v,
        ...(lp.strand != null ? { strand: lp.strand } : {}), // keep the run id (ropes, importers) through the flatten
      });
    }
  });

  // Real pixel pitch (mm) so the viewer can size LEDs by spacing, not by rig extent.
  const pitches = instances.map((inst) => inst.fixture.meta?.pitchMM).filter((p) => p > 0);

  return buildScene({
    name,
    units,
    pixels,
    meta: {
      ...meta,
      pitchMM: pitches.length ? Math.min(...pitches) : undefined,
      instances: instances.map((inst) => ({
        name: inst.name,
        fixture: inst.fixtureName,
        pos: inst.pos || [0, 0, 0],
        rotDeg: inst.rotDeg || [0, 0, 0],
        ...(inst.output ? { output: inst.output } : {}),
        ...(inst.emitter ? { emitter: inst.emitter } : {}), // how this instance's LEDs emit (sim)
        ...(inst.src ? { src: inst.src } : {}),
        ...(inst.track ? { track: inst.track } : {}), // a live pose drives this instance's transform
      })),
    },
  });
}

// Placement generators — one layout entry can stand for many instances:
//   array: { count: [nx, ny, nz], spacing: [sx, sy, sz], center: false }   a matrix in the entry's frame
//   ring:  { count, radiusMM, startDeg: 0, facing: center|out|tangent|none } a circle around the entry's pos (Y up)
// `each: { … }` applies per generated instance (e.g. a rotDeg). Every expanded instance carries
// `src: { i, k }` — the layout entry index and element index — so the builder can edit the source.
//   along: { path: name|[[x,y,z]…], count, orient: tangent|none, startMM, endMM } instances spaced along a path
export function expandInstances(list, { paths = {} } = {}) {
  const out = [];
  list.forEach((inst, i) => {
    const base = inst.pos || [0, 0, 0], rotDeg = inst.rotDeg || [0, 0, 0], R = eulerMatrix(rotDeg);
    const stem = inst.name || inst.fixture;
    const { array, ring, along, each, ...rest } = inst;
    if (along) {
      const P = resolvePath(along.path, paths);
      const samples = samplePath(P, { count: along.count, spacingMM: along.spacingMM, startMM: along.startMM, endMM: along.endMM });
      samples.forEach((sm, k) => {
        // orient: the instance's +Z follows the tangent (yaw about Y, pitch about X)
        const T = sm.t;
        const rot = (along.orient || "tangent") === "tangent" ? [(-Math.asin(Math.max(-1, Math.min(1, T[1]))) * 180) / Math.PI, (Math.atan2(T[0], T[2]) * 180) / Math.PI, rotDeg[2]] : rotDeg;
        out.push({ ...rest, ...(each || {}), name: `${stem}-${k}`, pos: add(base, matVec(R, sm.p)), rotDeg: each?.rotDeg || rot.map((x) => +x.toFixed(3)), src: { i, k } });
      });
      return;
    }
    if (array) {
      const [nx = 1, ny = 1, nz = 1] = array.count || [1, 1, 1];
      const [sx = 0, sy = 0, sz = 0] = array.spacing || [0, 0, 0];
      const off = array.center ? [((nx - 1) * sx) / 2, ((ny - 1) * sy) / 2, ((nz - 1) * sz) / 2] : [0, 0, 0];
      let k = 0;
      for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++, k++) {
        const local = [x * sx - off[0], y * sy - off[1], z * sz - off[2]];
        out.push({ ...rest, ...(each || {}), name: `${stem}-${x}-${y}${nz > 1 ? `-${z}` : ""}`, pos: add(base, matVec(R, local)), rotDeg: each?.rotDeg || rotDeg, src: { i, k } });
      }
    } else if (ring) {
      const n = Math.max(1, ring.count | 0), r = ring.radiusMM || 0, start = ring.startDeg || 0, facing = ring.facing || "center";
      for (let k = 0; k < n; k++) {
        const a = start + (360 * k) / n, rad = (a * Math.PI) / 180;
        const local = [r * Math.sin(rad), 0, r * Math.cos(rad)];
        const yaw = facing === "center" ? a + 180 : facing === "out" ? a : facing === "tangent" ? a + 90 : rotDeg[1];
        out.push({ ...rest, ...(each || {}), name: `${stem}-${k}`, pos: add(base, matVec(R, local)), rotDeg: [rotDeg[0], yaw, rotDeg[2]], src: { i, k } });
      }
    } else out.push({ ...inst, src: { i } });
  });
  return out;
}

// Turn a parsed YAML layout doc into a { scene, show } using registries:
//   fixtures: { [type]: (params) => ({ pixels, meta }) }   — how to build each fixture's geometry
//   patterns: { [name]: (params) => (px,t,ctx) => [r,g,b] } — for the optional `show:` block
//
// Layout doc shape:
//   name, units
//   fixtures: { <fixtureName>: { type, params } }
//   instances: [ { fixture: <fixtureName>, name, pos:[x,y,z], rotDeg:[rx,ry,rz] } ]
//   show: { holdS, fadeS, scenes: [ { name, pattern, params } ] }   (optional)
// `vfs` is where the layout's files come from (src/vfs.mjs); default: disk relative to baseDir under Node.
export function resolveLayout(doc, { fixtures = {}, patterns = {}, baseDir = null, vfs = null } = {}) {
  const fixDefs = doc.fixtures || {};
  vfs = vfs || defaultVFS(baseDir);
  // Named paths (`paths:` — inline points or JSON files such as thread-3d's tubes.json), available
  // to `rope` fixtures (params.path: name) and `along:` generators.
  const paths = loadPaths(doc.paths, { baseDir, vfs });
  const cache = {};
  const getFixture = (fixtureName) => {
    if (cache[fixtureName]) return cache[fixtureName];
    const def = fixDefs[fixtureName];
    if (!def) throw new Error(`layout references undefined fixture "${fixtureName}"`);
    const make = fixtures[def.type];
    if (!make) throw new Error(`unknown fixture type "${def.type}" (registered: ${Object.keys(fixtures).join(", ") || "none"})`);
    return (cache[fixtureName] = make({ ...(def.params || {}), paths, baseDir, vfs })); // file params resolve through the vfs, relative to the layout
  };

  const instances = expandInstances(doc.instances || [], { paths }).map((inst, k) => {
    if (!inst.fixture) throw new Error(`instance #${k} is missing a "fixture"`);
    const def = fixDefs[inst.fixture] || {};
    // The output patch merges the fixture-level default with per-instance overrides.
    const output = def.output || inst.output ? { ...(def.output || {}), ...(inst.output || {}) } : undefined;
    const fixture = getFixture(inst.fixture);
    // Emitter profile: fixture-type default (built into the geometry) < layout `fixtures.X.emitter`
    // < per-instance `emitter` override.
    const emitterSrc = [fixture.meta?.emitter, def.emitter, inst.emitter].filter(Boolean);
    const emitter = emitterSrc.length ? Object.assign({}, ...emitterSrc) : undefined;
    return {
      name: inst.name || `${inst.fixture}-${k + 1}`,
      track: inst.track,
      fixtureName: inst.fixture,
      fixture,
      pos: inst.pos,
      rotDeg: inst.rotDeg,
      output,
      emitter,
      src: inst.src, // which layout entry (and which generated element) this came from — for the builder
    };
  });
  if (!instances.length) throw new Error("layout has no instances");

  // Structures (the sculpture's own CAD): per-fixture ones ride along with every instance
  // (parent = the instance transform); scene-level ones sit once in world space.
  const structures = [];
  instances.forEach((inst, k) => {
    // from the layout's fixture definition, plus any the fixture itself brought (a baked .vxl scene)
    for (const s of [...(fixDefs[inst.fixtureName]?.structures || []), ...(inst.fixture.meta?.structures || [])])
      structures.push({ ...resolveStructure(s, { baseDir, vfs }, { pos: inst.pos || [0, 0, 0], rotDeg: inst.rotDeg || [0, 0, 0] }, `${inst.name}:${s.name || String(s.file).replace(/^.*[\\/]/, "")}`), inst: k });
  });
  for (const s of doc.structures || []) structures.push(resolveStructure(s, { baseDir, vfs }));

  // Site context: the geo-anchor and the places a viewer can stand (360° backdrops) — src/site.mjs.
  const site = resolveSite(doc.site);
  const vantages = resolveVantages(doc.vantages, { baseDir, site, vfs });
  // Inputs: external streams that drive the piece, merged by priority/htp/ltp (src/input/index.mjs).
  const inputs = resolveInputs(doc.inputs);
  // Trackers: where things are (src/poses.mjs). An instance with `track:` follows one.
  const trackers = resolveTrackers(doc.trackers);
  // Join: may devices (wands, phones) announce themselves and be added while the show runs?
  const join = doc.join === false ? { enabled: false } : { enabled: true, fixture: doc.join?.fixture || "dot", ttlS: doc.join?.ttlS ?? 30, heightMM: doc.join?.heightMM ?? 1200, max: doc.join?.max ?? 64 };
  for (const inst of instances) if (inst.track && !trackers.some((t) => t.name === inst.track)) throw new Error(`instance "${inst.name}" tracks "${inst.track}" but there is no such tracker (trackers: ${trackers.map((t) => t.name).join(", ") || "none"})`);
  const merge = doc.merge ? { mode: doc.merge.mode || "priority", fallback: doc.merge.fallback || "show", timeoutMs: doc.merge.timeoutMs ?? 1000 } : undefined;
  // Controls: the piece's own buttons + the state it reports (Thread's pedestals) — drawn by the viewer, spoken over the bus.
  const controls = resolveControls(doc.controls);

  const scene = buildSceneFromLayout({
    name: doc.name || "layout",
    units: doc.units || "mm",
    instances,
    meta: {
      fixtureTypes: Object.fromEntries(Object.entries(fixDefs).map(([k, v]) => [k, v.type])),
      ...(structures.length ? { structures } : {}),
      ...(site ? { site } : {}),
      ...(vantages.length ? { vantages } : {}),
      ...(inputs.length ? { inputs } : {}),
      ...(trackers.length ? { trackers } : {}),
      join,
      ...(merge ? { merge } : {}),
      ...(controls ? { controls } : {}),
    },
  });

  const show = doc.show ? resolveShow(doc.show, { patterns, scene, instances, fixDefs }) : null;

  return { scene, show, resolved: instances };
}

export const INPUT_PROTOCOLS = { artnet: 6454, sacn: 5568, ddp: 4048, tcp: 9600, ws: null };
export function resolveInputs(list) {
  const seen = new Set();
  return (list || []).map((inp, i) => {
    const protocol = inp.protocol;
    if (!(protocol in INPUT_PROTOCOLS)) throw new Error(`input #${i}: protocol must be one of ${Object.keys(INPUT_PROTOCOLS).join(", ")} (got "${protocol}")`);
    const name = inp.name || protocol;
    if (seen.has(name)) throw new Error(`duplicate input name "${name}"`);
    seen.add(name);
    const out = { name, protocol, priority: inp.priority ?? 0, ...(inp.timeoutMs != null ? { timeoutMs: inp.timeoutMs } : {}) };
    if (protocol !== "ws") out.port = inp.port || INPUT_PROTOCOLS[protocol];
    if (inp.host) out.host = inp.host;
    if (protocol === "artnet" || protocol === "sacn" || protocol === "ws") out.map = inp.map || {};
    if (protocol === "sacn" && inp.universes) out.universes = inp.universes;
    return out;
  });
}

// ── the show: scenes, each a pattern or a stack of LAYERS ──────────────────────────────────
//   show:
//     holdS: 6
//     fadeS: 2.5
//     scenes:
//       - { name: rising, pattern: planeSweep, params: { speedMM: 400 } }      # one pattern everywhere
//       - name: night                                                          # layers, bottom to top
//         layers:
//           - { pattern: plasma }                                              # on: all (default)
//           - { pattern: helix, on: { space: cylinder }, blend: add }          # only where it fits
//           - { pattern: comet, on: { fixture: ropes }, blend: max, opacity: 0.8 }
// `on:` picks the pixels a layer renders: `all`, `{ fixture: name | [names] }`, `{ instance: name |
// [names] }`, `{ space: cylinder }` (every fixture providing that space). `blend:` is how the layer
// lands on what's below — over (replace, default) · add · max · multiply · screen; `opacity` scales
// it. Pixels no layer covers are black.
// Every pattern declares the coordinate spaces it reads (`pattern.needs`, src/patterns.mjs SPACES)
// and every fixture the spaces it provides (`meta.spaces`); a scene is checked against the fixtures
// it runs on: a space the fixture lacks is a WARNING (show.warnings — the pattern degrades, e.g. a
// helix on a strip is a chase) with the fix in the message, or an ERROR for a space with no
// degrade. So "helix on a flat panel" is said out loud at apply time, not discovered on the LEDs.
import { SPACES as SPACE_INFO } from "./patterns.mjs";
const BLENDS = {
  over: (a, b, o) => a + (b - a) * o,
  add: (a, b, o) => a + b * o,
  max: (a, b, o) => Math.max(a, b * o),
  multiply: (a, b, o) => a * (1 - o + b * o),
  screen: (a, b, o) => a + (1 - a) * b * o,
};
export function resolveShow(showDoc, { patterns = {}, scene, instances, fixDefs = {} } = {}) {
  const N = scene.pixels.length;
  const fixtureOf = (k) => instances[k]?.fixtureName;
  const spacesOf = (k) => instances[k]?.fixture?.meta?.spaces || [];
  // which instances a layer's `on:` selects
  function select(on, where) {
    if (on == null || on === "all") return instances.map((_, k) => k);
    const list = (x) => (Array.isArray(x) ? x.map(String) : [String(x)]);
    if (typeof on !== "object") throw new Error(`${where}: on: must be "all" or { fixture | instance | space: … }, got ${JSON.stringify(on)}`);
    let sel = instances.map((_, k) => k);
    if (on.fixture != null) { const f = list(on.fixture); for (const n of f) if (!fixDefs[n]) throw new Error(`${where}: on.fixture "${n}" is not a fixture (have: ${Object.keys(fixDefs).join(", ")})`); sel = sel.filter((k) => f.includes(fixtureOf(k))); }
    if (on.instance != null) { const f = list(on.instance); for (const n of f) if (!instances.some((i) => i.name === n)) throw new Error(`${where}: on.instance "${n}" is not an instance (have: ${instances.map((i) => i.name).join(", ")})`); sel = sel.filter((k) => f.includes(instances[k].name)); }
    if (on.space != null) { const sp = String(on.space); if (!SPACE_INFO[sp]) throw new Error(`${where}: on.space "${sp}" — spaces are ${Object.keys(SPACE_INFO).join(", ")}`); if (!SPACE_INFO[sp].always) sel = sel.filter((k) => spacesOf(k).includes(sp)); }
    return sel;
  }
  // a pattern's needs against the fixtures of the instances it runs on: one line per (pattern, fixture)
  const warnings = [];
  function check(make, patternName, sel, where, layered) {
    for (const need of make.needs || []) {
      const info = SPACE_INFO[need]; if (!info || info.always) continue;
      const missing = [...new Set(sel.filter((k) => !spacesOf(k).includes(need)).map(fixtureOf))];
      for (const fx of missing) {
        const inst = instances.find((i) => i.fixtureName === fx)?.name;
        const fix = `${layered ? "narrow the layer's" : "make it a layer with"} on: { space: ${need} } or on: { fixture: … } so it runs only where it fits (GUIDE §3.5)`;
        const msg = `${where}: "${patternName}" reads the ${need} space (${info.what}) — fixture "${fx}" (${fixDefs[fx]?.type || "?"}, e.g. instance "${inst}") doesn't provide it`;
        if (info.degrade) warnings.push(`${msg}: it degrades there (${info.degrade}); ${fix}`);
        else throw new Error(`${msg}; ${fix}`);
      }
    }
  }
  const mkLayer = (L, where, layered) => {
    const make = patterns[L.pattern];
    if (!make) throw new Error(`${where} uses unknown pattern "${L.pattern}" (have: ${Object.keys(patterns).join(", ")})`);
    const sel = select(L.on, where);
    check(make, L.pattern, sel, where, layered);
    const blend = L.blend || "over"; if (!BLENDS[blend]) throw new Error(`${where}: blend "${blend}" — blends are ${Object.keys(BLENDS).join(", ")}`);
    const opacity = L.opacity == null ? 1 : Math.max(0, Math.min(1, +L.opacity));
    const mask = new Uint8Array(N); const on = new Set(sel); for (let i = 0; i < N; i++) if (on.has(scene.pixels[i].inst || 0)) mask[i] = 1;
    return { pattern: L.pattern, render: make(L.params || {}), on: L.on == null ? "all" : L.on, blend, opacity, mask, count: mask.reduce((a, b) => a + b, 0), needs: make.needs || [] };
  };
  const scenes = (showDoc.scenes || []).map((sc, k) => {
    const name = sc.name || sc.pattern || `scene ${k + 1}`;
    if (sc.layers) {
      if (!Array.isArray(sc.layers) || !sc.layers.length) throw new Error(`scene "${name}": layers: must be a non-empty list`);
      const layers = sc.layers.map((L, j) => mkLayer(L, `scene "${name}" layer #${j + 1}`, true));
      const render = (px, t, ctx) => {
        let r = 0, g = 0, b = 0;
        for (const L of layers) {
          if (!L.mask[px.i]) continue;
          const c = L.render(px, t, ctx), f = BLENDS[L.blend], o = L.opacity;
          r = f(r, c[0], o); g = f(g, c[1], o); b = f(b, c[2], o);
        }
        return [r < 0 ? 0 : r > 1 ? 1 : r, g < 0 ? 0 : g > 1 ? 1 : g, b < 0 ? 0 : b > 1 ? 1 : b]; // blends can overshoot; a pattern's contract is 0..1
      };
      return { name, render, layers: layers.map(({ pattern, on, blend, opacity, count, needs }) => ({ pattern, on, blend, opacity, count, needs })) };
    }
    if (!sc.pattern) throw new Error(`scene "${name}" (#${k + 1}): needs a pattern: or layers:`);
    const L = mkLayer(sc, `scene "${name}"`, false);
    return { name, render: L.render, needs: L.needs };
  });
  return { scenes, holdS: showDoc.holdS ?? 4, fadeS: showDoc.fadeS ?? 2.5, warnings };
}

// controls: the physical interface of a piece, as data the viewer can draw and any bus client can
// speak. Panels of buttons send a JSON message on press/release ($button / $pressed substituted);
// a status entry names the JSON message that reports the piece's state and the fields to show.
//   controls:
//     panels:
//       - { name: pedestal A, buttons: [x, y, z], keys: { q: x, w: y, e: z },
//           message: { type: button, podpi: a, button: $button, pressed: $pressed } }
//     status: { type: status, fields: [{ label: strand X, path: states.x }, { label: pedestals, path: podpi }] }
export function resolveControls(c) {
  if (!c) return null;
  const panels = (c.panels || []).map((p, i) => {
    const buttons = (p.buttons || []).map(String);
    if (!buttons.length) throw new Error(`controls.panels[${i}]: needs a list of buttons`);
    if (!p.message || typeof p.message !== "object") throw new Error(`controls.panels[${i}]: needs a message template (an object with $button / $pressed)`);
    const keys = {};
    for (const [k, b] of Object.entries(p.keys || {})) { if (!buttons.includes(String(b))) throw new Error(`controls.panels[${i}]: key "${k}" → unknown button "${b}"`); keys[String(k).toLowerCase()] = String(b); }
    return { name: p.name || `panel ${i + 1}`, buttons, keys, message: p.message, hint: p.hint || null };
  });
  const status = c.status ? { type: c.status.type || "status", fields: (c.status.fields || []).map((f, i) => { if (!f.path) throw new Error(`controls.status.fields[${i}]: needs a path`); return { label: f.label || f.path, path: String(f.path) }; }) } : null;
  return { ...(c.title ? { title: String(c.title) } : {}), panels, status };
}

export const TRACKER_SOURCES = ["ws", "phone", "psn"];
export function resolveTrackers(list) {
  const seen = new Set();
  return (list || []).map((t, i) => {
    const source = t.source || "ws";
    if (!TRACKER_SOURCES.includes(source)) throw new Error(`tracker #${i}: source must be one of ${TRACKER_SOURCES.join(", ")} (got "${source}")`);
    const name = t.name || `${source}-${i}`;
    if (seen.has(name)) throw new Error(`duplicate tracker name "${name}"`);
    seen.add(name);
    const out = { name, source, aim: t.aim || [0, 1, 0], heightMM: t.heightMM ?? 1200 };
    if (source === "psn") { out.port = t.port || 56565; out.group = t.group ?? "236.10.10.10"; out.id = t.id ?? null; out.scaleToMM = t.scaleToMM ?? 1000; out.up = t.up || "y"; }
    return out;
  });
}

// Every file a layout refers to (layout-relative), so a hosted/static project can fetch or check
// them up front: fixture files, structures, path files, vantage images, `{ cube: dir }` for cubemaps.
export function collectFiles(doc) {
  const out = [];
  const add = (f) => { if (f && !out.includes(f)) out.push(f); };
  for (const def of Object.values(doc.fixtures || {})) { add(def.params?.file); for (const s of def.structures || []) add(s.file); }
  for (const s of doc.structures || []) add(s.file);
  for (const p of Object.values(doc.paths || {})) if (p && !Array.isArray(p)) add(p.file);
  for (const v of doc.vantages || []) { add(v.image); if (v.cube) out.push({ cube: v.cube }); }
  return out;
}

