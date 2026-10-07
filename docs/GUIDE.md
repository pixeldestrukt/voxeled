# Authoring an installation with voxeled

The complete workflow: get a piece's geometry in, place it, give it a body, wire it, light it,
and hand it to other tools — with the vocabulary, the file formats, every knob, and a worked
example (the Thread sculpture). The short docs each cover one part; this is the whole thing. New here? Read [Getting started](START.md) first.

- [Concepts](#1-concepts) · [Frames & units](#2-frames-and-units) · [The layout file](#3-the-layout-file)
- [Getting geometry in](#4-getting-geometry-in) · [Structures](#5-structures--the-body-of-the-piece) · [Placing LEDs on a structure](#6-placing-leds-on-a-structure-paths-and-ropes)
- [The builder](#7-the-builder) · [Baking & export](#8-baking-and-export) · [Running](#9-running-the-hub) · [Site context](#12-site-context-the-piece-in-the-world) · [No server](#13-no-server-the-static-page) · [Moving fixtures & wands](#13-moving-fixtures-and-wands)
- [Worked example: Thread](#10-worked-example-thread) · [Gotchas](#11-gotchas)

---

## 1. Concepts

| term | what it is |
|---|---|
| **map** | every LED's real-world position (mm) **and emission normal**, grouped into fixtures and instances. voxeled's central artifact — everything else (patterns, simulator, visibility, patch) reads it. |
| **pixel** | one LED: `p` (mm), `n` (unit normal), `s`/`v` (coordinates along/across its fixture, 0→1), `inst` (which instance), `strand` (optional run id). Its index is its **data order** — pixel *i* is bytes *3i…3i+2* on the wire. |
| **fixture** | geometry authored once in its own local frame: a heart, a rope, a panel, an imported CAD piece. Built by a **fixture type** + params. |
| **instance** | a fixture placed in world space by a transform (`pos` mm, `rotDeg`). Several instances can share one fixture. |
| **layout** | the YAML file that describes an installation: paths, fixtures, instances, structures, show. **The source of truth** — hand-editable, git-diffable, watched by the hub, and what the builder edits. |
| **scene** | the resolved result of a layout: the flat pixel list + metadata (`.vxl.json`). What the hub runs and the viewer draws. |
| **structure** | the sculpture's own CAD (STL/GLB/OBJ) drawn around the LEDs — context in the viewer, an **occluder** in the simulator. Never a source of LEDs. |
| **path** | a polyline (mm) that LEDs or instances follow: a tube centreline, an edge. |
| **emitter** | how a fixture's LEDs *emit* (viewing angle, body size, diffusion…) — what the simulator renders. |
| **patch / output** | where a fixture's pixels are sent: protocol + address (Art-Net universe, DDP offset, dan-mx…). Per fixture or per instance; one installation can mix protocols. |
| **show** | the scenes (pattern + params) the hub crossfades between. |
| **tracker / pose** | where a thing *is* — a wand, a phone, a PSN tag: position + orientation, live. An instance with `track:` follows one (a **moving fixture**); patterns read poses (a lantern in someone's hand). |
| **join** | a device (a wand, a phone that scanned the QR) announcing itself while the show runs and being added live — geometry, patch, tracker — nothing else renumbered, no restart. |
| **input** | an external stream that drives pixels — Art-Net, sACN, DDP, TCP, or a page on the bus — with a priority and a timeout; several run at once and **merge** over the show. |
| **baked** | evaluated and stored as a plain list of pixels — no recipe left inside. A `.vxl.json` is baked; a `rope` or `array` in a layout is procedural. See [§8](#8-baking-and-export). |

Two modes, one artifact: **show control** plays a finished scene; the **builder** authors it — and both use the same layout file.

## 2. Frames and units

- voxeled is **millimetres**, **Y up**, right-handed. The ground grid sits at the scene's minimum Y.
- `rotDeg: [rx, ry, rz]` is Euler degrees applied **Z·Y·X** (`Rz · Ry · Rx · v`: X first). Yaw is `ry`.
  This is the convention everywhere: instances, structures, the builder gizmo, glTF export.
- File units: STL/OBJ carry none — say what they are with `scaleToMM` (1 = already mm, 1000 = metres,
  25.4 = inches). glTF is metres by spec (default ×1000). `.vxl.json` is always mm.
- **Z-up models** (Blender, most CAD): rotate the instance or structure `rotDeg: [-90, 0, 0]`
  (Z → Y). Thread's whole layout does this.
- Everything of one piece must share a frame — LEDs and their structure in particular. When a CAD
  file comes from another frame, `pos` / `rotDeg` / `scaleToMM` on its entry bring it in line
  (Thread's old chip STL was in a frame ~5.7× the aligned model's; don't mix such files).
- All file paths in a layout resolve **relative to the layout file** (fixture `file`, structures,
  paths).

## 3. The layout file

```yaml
name: my-piece
units: mm

paths:                                   # §6 — polylines LEDs / instances follow
  tube-0: { file: ../model/out/tubes.json, index: 0, scaleToMM: 1000 }
  edge:   [[0, 0, 0], [1200, 0, 0], [1200, 800, 0]]

fixtures:                                # geometry authored once
  heart:
    type: mobius-heart
    params: { panelsPerSide: 8, pitchMM: 10, twist: mobius }
    emitter: { viewingAngleDeg: 120 }    # fixture-level default (§3.3)
    output:  { protocol: artnet, host: 10.0.0.5, universe: 0, byteOrder: grb }   # fixture-level patch (§3.4)
    structures:                          # §5 — rides with every instance of this fixture
      - { file: ../assets/heart_rails.stl, opacity: 0.35 }
  rope-A: { type: rope, params: { path: tube-0, count: 600, radiusMM: 25, angleDeg: [60, 180, 300], angleFrom: spine } }
  piece:  { type: vxl,  params: { file: ../build/piece.vxl.json } }

instances:                               # placements in world space
  - { fixture: heart, name: left,  pos: [-1524, 0, 0] }
  - { fixture: heart, name: right, pos: [ 1524, 0, 0], rotDeg: [0, 180, 0], output: { universe: 4 } }
  - { fixture: heart, name: wall,  array: { count: [4, 3, 1], spacing: [600, 600, 0], center: true } }
  - { fixture: heart, name: ring,  ring:  { count: 8, radiusMM: 2500, facing: center } }
  - { fixture: heart, name: run,   along: { path: edge, count: 4, orient: tangent } }

structures:                              # scene-level: once, in world space
  - { file: ../site/scan.glb, scaleToMM: 1000, opacity: 0.2 }

show:
  holdS: 4
  fadeS: 2.5
  scenes:
    - { name: chase,        pattern: ribbonChase, params: { loops: 3, speed: 0.15 } }
    - { name: wipe (world), pattern: worldWipe,   params: { axis: 0, space: world } }
```

### 3.1 Fixture types

| type | params | what it makes |
|---|---|---|
| `mobius-heart` | `panelsPerSide`, `pitchMM`, `twist` (`mobius`\|`none`) | the parametric ribbon heart — exact positions **and** normals from the parametrization |
| `mesh` | `file`, `scaleToMM` (1), `normalSign` (`outward`\|`inward`\|`+x…-z`), `order` (`chain`\|`file`), `minTris`, `maxTris`, `emitter` | **chip-island import** of a CAD mesh whose LED chips are bodies (STL/OBJ/GLB): one LED per island, thin axis = normal, order by chaining ([§4](#4-getting-geometry-in)) |
| `vxl` | `file`, `emitter` | a **baked** `.vxl.json` (Blender/Grasshopper export, `vox import`, `export.mjs`). Brings any structures the file carries ([§8](#8-baking-and-export)) |
| `gltf` | `file`, `scaleToMM` (1000) | glTF/GLB points or mesh vertices with `NORMAL` (else estimated) |
| `matrix` | `cols`, `rows`, `pitchMM` (`colPitchMM`/`rowPitchMM`), `wiring` (`rows`\|`columns`), `serpentine`, `start` (corner of pixel 0), `center` | a **flat grid** facing +Z — 8×8/16×16/8×32 panels, strips laid in rows; the panel's wiring as data order |
| `screen` | `cols` (64), `rows` (36), `widthMM` (1600), `heightMM` (from the aspect), `emitter` | a **surface of texels** — an LED wall as an image, a projection surface, a monitor: placed like any instance, lit by the same patterns and layers (the `screen` space: `s` left→right, `v` top→bottom), one RGB per texel on the bus. The viewer draws it as one continuous plane; `viewer/screen.html?instance=<name>` shows it fullscreen for a projector; an Art-Net/DDP patch drives it as an LED wall. The JS path renders every texel each frame — keep it under ~260k texels (`layouts/screen.yaml`) |
| `tube` | `cols` (8), `rows` (32), `panels` (1), `pitchMM` (10), `seamMM`, `panelGapMM`, `diameterMM`, `wiring` (`across`\|`along`), `serpentine`, `startAngleDeg`, `clockwise` | a **flexible matrix panel rolled into a column**: the short side around (Ø = (cols·pitch + seam)/π), panels end to end along +Y from the base, radial normals, the panel's serpentine wiring as data order (`layouts/columns.yaml`) |
| `rope` | `path`, `count` **or** `pitchMM`, `radiusMM`, `angleDeg` (number or list), `angleFrom`, `twistDegPerM`, `startMM`, `endMM`, `up` | LEDs along a path, offset and wrapped around it, normals radial ([§6](#6-placing-leds-on-a-structure-paths-and-ropes)) |

Add your own in `examples/mobius-heart/fixtures.mjs` — a `(params) => { pixels, meta }` function.

### 3.2 Instance keys

`fixture` (required), `name`, `pos` `[x,y,z]` mm, `rotDeg` `[rx,ry,rz]`, `output`, `emitter`, and one
optional **generator**:

| generator | fields | result |
|---|---|---|
| `array` | `count: [nx, ny, nz]`, `spacing: [sx, sy, sz]`, `center` | a matrix in the entry's frame; names `<name>-<x>-<y>[-<z>]` |
| `ring` | `count`, `radiusMM`, `startDeg`, `facing` (`center`\|`out`\|`tangent`\|`none`) | a circle around the entry's `pos` (about Y); names `<name>-<k>` |
| `along` | `path`, `count` or `spacingMM`, `startMM`, `endMM`, `orient` (`tangent`\|`none`) | instances spaced along a path, +Z on the tangent |

`each: { … }` applies per generated instance (e.g. a `rotDeg` or `emitter`). Every expanded instance
carries `src: { i, k }` (layout entry, element) — that is how the builder maps a selection back to
the file.

### 3.3 Emitter

How the fixture's LEDs emit; the simulator (**S**) renders it. Fixture-type default < layout
`fixtures.X.emitter` < instance `emitter`, merged field-by-field.

| field | default | meaning |
|---|---|---|
| `viewingAngleDeg` | 120 | datasheet full angle at 50% intensity. Lobe = `cosθ^p`, `p = ln½ / ln cos(angle/2)`: 120° is exactly Lambertian, ~10° a spot, ~1° laser-like, ~170° a diffused rope. Dark behind. |
| `sizeFrac` | 0.9 | emitter body edge as a fraction of pitch (1 = contiguous tiles) |
| `coreFrac` | 0.5 | lit fraction of the body (the chip/lens) |
| `softness` | 0.4 | edge diffusion of the core (0 hard chip → 1 soft blob) |
| `gain` | 1.6 | emissive intensity (>1 feeds bloom) |
| `glow` | 1.0 | bloom contribution |

### 3.4 Output (the patch)

Where the pixels go. Fixture-level `output` is the default; per-instance `output` overrides
field-by-field. Without one, addressing is index-implied (pixel *i* → byte *3i*).

| field | protocols | meaning |
|---|---|---|
| `protocol` | all | `artnet` \| `ddp` \| `danmx` \| a registered custom name |
| `host`, `port` | all | target (defaults: artnet/danmx 6454, ddp 4048) |
| `byteOrder` | artnet, ddp | `rgb` \| `grb` \| `bgr` \| `rbg` \| `brg` \| `gbr` \| `rgbw` \| `grbw` |
| `universe`, `channel` | artnet | start universe (0-based) + channel (1-based); pixels roll across universes |
| `offset` | ddp | start byte offset in the receiver framebuffer |
| `startPixel` | danmx | start pixel |
| `encoding`, `colorSpace`, `transfer`, `keyframeInterval` | danmx | `raw`(default)\|`rle`\|`delta`\|`auto`; `rgb888`\|`rgb565`\|`g6r5b5`\|`rgb888_linear`; `linear`\|`gamma22`\|`srgb` |

See [interop/protocols.md](interop/protocols.md) for the protocol family.

### 3.5 Show and patterns

`show: { holdS, fadeS, scenes: [{ name, pattern, params }] }`. Patterns (`src/patterns.mjs`): `ribbonChase`
(`loops`, `speed`, `sat`), `worldWipe` (`axis`, `speedMM`, `spacingMM`, `widthMM`, `space: world|fixture`, `hue`),
`planeSweep` (`speedMM`, `spacingMM`, `widthMM`, `hue`), `normalRGB`, **cylinder/volume**: `helix` (a barber-pole spiral winding around `v` as it climbs `s`: `turns`, `pitch`, `speed`, `width`, `hue`, `hueAlong`, `dir`), `lantern` (a point light carried through the room, lighting each LED by its **normal** — near sides glow, far sides dark: `path: orbit|eight`, `radiusMM`, `heightMM`, `speed`, `falloffMM`, `ambient`), `swirl` (spiral arms over the floor about the installation's centre, climbing and wrapping each column: `arms`, `spacingMM`, `speed`, `twist`, `wrap`), `drops` (drops falling down each column on one side, spinning: `rate`, `speed`, `lengthS`, `spin`), `spotlight` (visibility from an orbiting
camera: `orbitDegPerSec`, `angleDeg`, `elevDeg`, `fovDeg`), `projector` (projection-map a texture),
**per-strand** (a rope, a rolled panel and a baked piece carry `strand` on every pixel — these are
Thread's luxpi looks, generalized): `comet` (a comet bouncing down every strand with a tail: `speed`,
`tail`, `hue`, `hueStep`, `ambient`), `plasma` (layered sine fields along each strand, staggered per
strand: `speed`, `scale`, `hueDrift`), `fire` (heat injected at LED 0 climbing each string, cooling:
`rate`, `cooling`, `seed`), `strands` (one flat colour per strand, or per `group` of strands — Thread's
three ropes per tube — so the wiring reads at a glance), `solid` (one colour: `rgb` or `hue`/`sat`/`value`).
A pattern is `(pixel, t, ctx) → [r, g, b]` over the pixel's world position/normal — add your own in
`patterns.mjs`.

**Spaces — what a pattern is written against.** Every pattern declares the coordinate spaces it
reads (`pattern.needs`; `SPACES` in `patterns.mjs`) and every fixture the spaces it provides
(`meta.spaces`); the layout checks each scene against the fixtures it runs on when it is applied:

| space | the pixel's | provided by |
|---|---|---|
| `world` | `p` (mm), `n` | everything |
| `volume` | `p` normalised to the piece's bounding box | everything |
| `fixture` | `s` / `v` along and across the fixture, `ctx.local` | panels, strips, imports (a `dot` degrades to flat) |
| `strand` | which string (`px.strand`), where along it | ropes, rolled panels, baked pieces — a fixture without strands degrades to one strand |
| `cylinder` | `v` around, `s` along, radial normals | tubes — elsewhere `v` = 0, so a `helix` is a chase, not a spiral |

So a world-space pattern is general; a cylinder-space one is specialised, and says so. A scene whose
pattern reads a space some fixture lacks still resolves — the pattern **degrades** there as the
table says — but the layout carries a **warning** naming the pattern, the fixture and the fix
(`show.warnings`; the hub prints it, the page logs `VOXELED_SHOW_WARN`). A space with no
degrade (none yet; a screen's uv will be the first) is refused outright.

**Layers — generic underneath, specialised where it fits.** A scene can be a stack instead of one
pattern:

```yaml
scenes:
  - name: night
    layers:                                                        # bottom to top
      - { pattern: plasma }                                        # on: all (default)
      - { pattern: helix, on: { space: cylinder }, blend: add }    # only on fixtures that provide the cylinder space
      - { pattern: comet, on: { fixture: ropes }, blend: max, opacity: 0.8 }
      - { pattern: solid, on: { instance: [c1, c2] }, params: { hue: 0.1 } }
```

`on:` selects the pixels a layer renders: `all`, `{ fixture: name | [names] }`, `{ instance: name |
[names] }`, `{ space: cylinder }` (every fixture providing that space). `blend:` is how it lands on
what is below — `over` (replace, the default) · `add` · `max` · `multiply` · `screen`; `opacity`
scales it. Pixels no layer covers are black. The space check is per layer, against the fixtures it
selects — so narrowing a layer's `on:` is how the warning goes away.

A page's pattern bar (or `GET /control?scene=<name|index>`, or `{ "type": "control", "scene": … }` on
the bus) **pins** a scene: the show crossfades from whatever is on to it over `fadeS`, then holds it.
`mode=auto` resumes the cycle.

### 3.6 Controls — the piece's own buttons

A piece with a physical interface (Thread's two pedestals) describes it as data, so the viewer can
draw it and any client on the bus can speak it:

```yaml
controls:
  panels:
    - { name: pedestal A, buttons: [x, y, z], keys: { q: x, w: y, e: z },
        message: { type: button, podpi: a, button: $button, pressed: $pressed } }
  status:
    type: status                                  # the JSON message that reports state
    fields: [{ label: strand X, path: states.x }, { label: pedestals, path: podpi }]
```

Each panel is a row of buttons (with keyboard keys); a press/release sends the panel's `message`
with `$button` / `$pressed` filled in — over the page's live socket (the bridge, a hub's `/bus`).
`status` names the message type that carries state back and the fields to show next to the
buttons (a dotted `path` into the message; an object shows its truthy keys). The viewer shows the
panel while a live socket is connected, with a header (`title:` in the block, default *controls*) that
folds it to one line — a phone starts folded and the keys still work; `?controls=min` starts folded
anywhere, `?controls=0` hides it. The hub relays any non-control
JSON between bus clients, so a game engine on the bus sees the presses and can answer.

### 3.7 Inputs and merge

Other tools drive the piece *through* voxeled — several at once:

```yaml
inputs:
  - { name: console, protocol: artnet, priority: 100, timeoutMs: 800, map: { strings: 12, universesPerString: 4, perUniverse: 150, stripB: doc } }
  - { name: tixl,    protocol: tcp,  priority: 80 }
  - { name: web,     protocol: ws,   priority: 10 }      # any page pushes frames or Art-Net over the bus
merge: { mode: priority, fallback: show }
```

Per pixel, the highest-priority live source wins (`htp` / `ltp` also available); a source that
stops for `timeoutMs` hands its pixels back; pixels nobody covers run the internal show. The
`map` on a universe protocol is the receiving end of the patch — see
[interop/protocols.md](interop/protocols.md#inputs-and-merge--several-streams-driving-one-piece).
The HUD's *Inputs* row and `/inputs` show what's live.

### 3.8 Video — the sampler

An image on the LEDs: a poster, a clip, a camera, a window, a raw-frame feed from ffmpeg or a VJ
tool. Declare the sources in `video:`, then use the `sampler` pattern (a scene or a layer) with a
**mapping** — the same image lands on a wall of texels, on columns standing in front of it, or on
whatever a projector's beam would hit:

```yaml
video:
  poster: { file: ../assets/poster.png }                           # a still: PNG / PPM on the hub; anything in the page
  clip:   { file: loop.mp4, fps: 24, width: 160, height: 90 }      # a video file (page); the hub takes clips as a stream
  feed:   { stream: true, width: 160, height: 90, port: 7001 }     # raw rgb24 frames over TCP, or on the bus
  cam:    { camera: true }                                         # the page's camera (a button in the project panel)
  desk:   { display: true }                                        # a window / screen capture (page, a click)
show:
  scenes:
    - { name: on the wall, layers: [{ pattern: sampler, on: { fixture: wall }, params: { source: poster, map: uv } }] }
    - { name: as a plane, pattern: sampler, params: { source: poster, map: box, box: { pos: [0, 1500, -900], widthMM: 3200, heightMM: 1800 } } }
    - { name: projected, pattern: sampler, params: { source: feed, map: projector, projector: { pos: [0, 1400, 4500], target: [0, 1400, -900], fovDeg: 40, aspect: 1.78 } } }
```

| `map` | the pixel samples the image at | reads |
|---|---|---|
| `uv` | its fixture's `s` / `v` — on a `screen` fixture that is the image, texel for texel | fixture |
| `box` | where it falls on a plane in the world: `box: { pos, rotDeg, widthMM, heightMM }`, facing +Z like a screen fixture (copy a screen's placement and the columns in front show the same picture at the same real place) | world |
| `projector` | where a pinhole projector would land it: `projector: { pos, target, fovDeg, aspect }`; faces turned away from the lens stay dark (`facing: false` to light them anyway). No occlusion — `projector` the pattern has the z-tested version | world |

`filter: linear | nearest`, `outside: black | clamp | repeat` (what lies beyond the image's edge),
`gain`, `off` (the colour where nothing lands). A source nobody has filled samples as `off` — a
dark wall means the feed is silent, not the page. Applying a layout refuses a sampler whose
`source` isn't in `video:`.

**Feeding the hub.** Stills decode once (PNG, PPM; `ffmpeg -i x.jpg x.png` for the rest). Moving
pictures reach it as a **stream** of raw frames, width × height × 3 bytes each, back to back:

```bash
ffmpeg -re -stream_loop -1 -i clip.mp4 -vf scale=160:90 -f rawvideo -pix_fmt rgb24 tcp://<hub>:7001
ffmpeg -f v4l2 -i /dev/video0 -vf scale=160:90 -f rawvideo -pix_fmt rgb24 tcp://<hub>:7001   # a camera
```
(Resolume / TouchDesigner: Spout/Syphon or NDI → ffmpeg → the same.) The bus carries them too:
send `{"type":"video","name":"feed"}` on a socket, then binary frames. The hub prints each
source's line at start. **In the page** (the static viewer), files and URLs start on their own;
the camera and a display capture start from the project panel's *video sources* row — the
browser asks once.

## 4. Getting geometry in

The principle: **bake in the tool, one baked interchange.** Every on-ramp produces the same fixture —
points + emission normals + data order + strand — and `vox check` validates it.

| you have | do this | normals · order |
|---|---|---|
| mechanical CAD with LED chips modelled as bodies (SolidWorks/Fusion/Onshape…) | export STL/OBJ/GLB → `vox import model.stl --scale 1000 -o piece.vxl.json`, or `type: mesh` directly | chip thin axis, sign by `--normal-sign` · chained nearest-neighbour (or `--order file`) |
| a Blender model | [the addon](../integrations/blender/): File ▸ Export ▸ voxeled fixture — mesh vertices / faces / islands, curves as ropes, empties | vertex/face/thin-axis/radial · object order |
| a Grasshopper definition | [the script component](../integrations/grasshopper/): points + normals + strand → `.vxl.json` | as authored (estimated if absent, flagged) |
| a Chromatik / LX rig | `vox import model.lxm --fixtures ~/Chromatik/Fixtures` ([interop/lxm.md](interop/lxm.md)) | assigned (LX stores none) · as generated |
| a glTF/GLB with points | `type: gltf` | `NORMAL` or estimated |
| a parametrization (like the heart) | write a fixture type in `fixtures.mjs` | exact |
| nothing but a structure + a photo | `paths:` + `type: rope` ([§6](#6-placing-leds-on-a-structure-paths-and-ropes)) | radial, exact |

Always run **`vox check`**: it fails a fixture without emission normals (the format requires them —
facing, visibility and the simulator depend on them) and warns about flipped normals, scrambled
order, duplicates, metre-scale units, a missing emitter, and inferred normals. Then **`vox preview`**
and press **N** to see the normals as quills.

`vox` reference:

```
vox import <mesh.stl|.obj|.glb | model.lxm> [-o out.vxl.json] [--scale <mm per unit>]
           [--normal-sign outward|inward|+x|-x|+y|-y|+z|-z] [--order chain|file] [--min-tris N] [--max-tris N]
           [--emitter '{"viewingAngleDeg":170}'] [--structure a.stl[,b.glb]] [--structure-scale N] [--fixtures <LX dir>]
vox check   <file.vxl.json>
vox preview <file.vxl.json> [--port 8080] [--pattern ribbonChase]      → the viewer (?sim=1 for the simulator)
```

## 5. Structures — the body of the piece

A structure is a plain mesh file (binary/ASCII STL, GLB/glTF, OBJ; **not** STEP — export a mesh) that
voxeled draws around the LEDs: translucent context in dots mode, an **opaque, depth-writing occluder**
in the simulator, so the steel hides LEDs behind it like the real piece. Nothing voxeled-specific
goes in the file; everything *about* it lives in the layout entry:

| field | default | meaning |
|---|---|---|
| `file` | — | relative to the layout |
| `scaleToMM` | 1 (glTF 1000) | file units → mm |
| `pos`, `rotDeg` | 0 | the mesh's own placement |
| `opacity`, `color` | 0.3, `#6b7a99` | dots-mode look |

Two scopes: **per fixture** (`fixtures.X.structures` — rides with every instance, so moving the
fixture moves its steel) and **per scene** (top-level `structures` — placed once in world space;
does *not* follow any fixture — the builder says so when such exist). A baked `.vxl` scene from
`export.mjs` carries its per-fixture structures, so `type: vxl` brings the body along ([§8](#8-baking-and-export)).
`vox import --structure` attaches a CAD file to the imported instance.

Viewer: **M** cycles translucent → **opaque** → hidden. Orbit in opaque mode to see exactly what the
armature blocks from any vantage.

## 6. Placing LEDs on a structure: paths and ropes

Thread's steel was the *input*; its LEDs were *derived* — diffused ropes zip-tied along the tubes at
angles fixed from as-built photos. That workflow is data:

**Paths** — `paths:` maps names to polylines in mm: inline `[[x,y,z], …]`, or `{ file, index | key,
scaleToMM }` loading a JSON file (a list of `{pts: […]}`, a list of point lists, or an object of
them — thread-3d's `tubes.json` and `align.json` load as-is).

**`rope`** — LEDs along a path: parallel-transport frames (T, N, B) along it; each LED sits
`radiusMM` off the axis in the direction `angleDeg` (+ `twistDegPerM · s`) around it; its emission
normal **is** that radial direction (a diffused rope emits away from the tube). `s` runs 0→1 per rope.
- `count` **or** `pitchMM` sets the LED spacing; `startMM`/`endMM` trim.
- `angleDeg` may be a **list** → several ropes on one tube, each its own `strand` (Thread: `[60, 180, 300]`).
- `angleFrom: <path>` — angle 0 points **toward** that path (Thread measures from the inboard
  direction, tube → spine). Without it, angle 0 = `up` projected ⟂ the tangent (on top of the tube),
  exactly `place_leds.py`'s construction.
- Ropes default to a diffused emitter (170°, soft body) with `diffuserMM: 26` — the rope's own
  diameter. The viewer draws every strand of a fixture whose emitter has `diffuserMM` as **one lit
  tube** through its LEDs (sim mode, **R** toggles): each ring takes its LED's colour, lit through a
  270° arc from the LED's normal with the strip's shadow at its back, dimmed as it turns away — what a
  diffused rope looks like. `diffuserMM: 0` for bare LEDs on a string. A baked piece keeps it
  (`meta.emitter`), so a `type: vxl` Thread draws as ropes too.

**`along`** — whole instances spaced along a path, +Z following the tangent (`orient: none` keeps
the entry's `rotDeg`). Example: `examples/mobius-heart/layouts/ropes.yaml`.

## 7. The builder

`npm run demo`, open the viewer, press **E** (or the *builder* button). It edits **the same layout
file** the hub loaded — no separate project format.

- **Select** — click an instance (pink box). **Move** with the gizmo (**T**) or **rotate** (**R**), 10 mm
  / 5° snaps, or type into the position / rotation fields. Every change is **applied live**: the hub
  rebuilds the scene, patterns keep running, structures follow. The status says *unsaved* until
  **💾 save layout** writes the YAML (comment header preserved). Saving matters: unsaved edits live
  only in the running hub and are lost on restart.
- **duplicate**, **delete**, **＋ add** an instance of any fixture the layout defines.
- **emitter** and **output** fields for the selected instance; tick *apply to every … instance* to
  write them to the fixture definition instead.
- **▦ make array** turns the entry into a matrix (count × spacing). Moving a generated element moves
  the whole array (its origin); rotate is disabled for elements.
- **new fixture from a file** — name, type (`mesh` / `vxl` / `gltf`), LED file, unit scale, optional
  structure file + scale → defines the fixture and places one. Rolls back if the hub rejects the file.
- The layout's directory is **watched**: editing the file in your editor reloads every open viewer.
- If the hub is **older than the page** (you changed hub code without restarting), the builder refuses
  with *"restart: Ctrl-C, npm run demo"* rather than half-working.

Keys: **E** builder · **S** sim · **B** bloom · **M** model · **N** normals · **T**/**R** gizmo · **Esc** deselect /
leave a field · **Delete** · **[ ]** crossfade · **A** auto. URL params: `?sim=1`, `?build=1&select=k`,
`?model=opaque`, `?az=<deg>&el=<deg>` (reproducible vantage), `?normals=1`. `window.voxeled` exposes
`select`, `liveTransform`, `commitTransform` for automation.

## 8. Baking and export

**Procedural** descriptions are recipes (`rope`, `array`, the heart's parametrization, a Blender
curve). **Baked** means evaluated once and stored as the plain pixel list — a `.vxl.json`. Baked files
are portable and dumb: edit the pitch and you re-bake from the source. So layouts keep recipes where
they're cheap and use `type: vxl` when geometry comes from *outside* voxeled.

- `node examples/mobius-heart/export.mjs <layout.yaml> <out-base>` bakes a whole layout → `<out>.vxl.json`
  (the scene, world space, mm) + `<out>.glb` (named point clouds with normals + a baked look, for
  Blender / TouchDesigner / three.js).
- A `.vxl.json` fixture carries geometry only. **Not** baked into it: placement (instances), patch,
  emitter (a default may be suggested) — those stay in the layout, so one baked fixture can be
  placed and wired differently in different installations.
- A baked **scene** does carry its **structures** with the transforms they rode with; `type: vxl`
  folds that placement into each structure and attaches it to the new instance — placing a baked
  piece brings its body.

## 9. Running the hub

```bash
npm run demo                                             # examples/mobius-heart/layouts/two-hearts.yaml → http://localhost:8080
node examples/mobius-heart/run.mjs path/to/layout.yaml   # any layout (VOX_LAYOUT=… also works)
VOX_PATTERN=spotlight npm run demo                       # one pattern instead of the show
ARTNET=10.0.0.5 DDP=10.0.0.6 npm run demo                # simple whole-frame senders; the layout's `output` patch drives mixed protocols
VOX_DDP_IN=4048 npm run demo                             # voxeled is a DDP Display: xLights/FPP/LedFx drive it (DDP in → any protocol out); the layout's inputs: is the full form
VOX_LISTEN=9600 npm run demo                             # TCP colour input (TiXL's VoxeledOutput)
PORT=9000 VOX_NO_QR=1 npm run demo                       # port; hide the phone QR
```

The hub prints a **QR code**: a phone on the LAN scans it for the scene picker + crossfader
(`phone.html`, the `/control` seam). Hub routes: `/scene.json`, `/bus` (WebSocket frames + control
messages), `/control`, `/layout` (GET/POST, `?write=1`), `/structure/<i>.<ext>`.

## 10. Worked example: Thread

Thread (`thread-3d`) is a ~14 m steel sculpture: three 24 mm tubes and a spine, with three ~26 mm
diffused LED ropes clipped along each member at 60°/180°/300° measured from the inboard direction,
600 LEDs per rope. Its voxeled layout lives **in its own repo** — `thread-3d/voxeled/thread.yaml` —
next to the model it references. From the aligned Blender model (metres, Z-up):

```yaml
paths:
  tube-0: { file: ../model/out/tubes.json, index: 0, scaleToMM: 1000 }   # tube centrelines
  tube-1: { file: ../model/out/tubes.json, index: 1, scaleToMM: 1000 }
  tube-2: { file: ../model/out/tubes.json, index: 2, scaleToMM: 1000 }
  spine:  { file: ../model/out/align.json, key: axis, scaleToMM: 1000 }  # the spine axis
fixtures:
  ropes-tube-0: { type: rope, params: { path: tube-0, count: 600, radiusMM: 25, angleDeg: [60, 180, 300], angleFrom: spine, up: [0, 0, 1] } }
  # … tube-1, tube-2 the same …
  ropes-spine:
    type: rope
    params: { path: spine, count: 600, radiusMM: 25, angleDeg: [60, 180, 300], angleFrom: tube-0, up: [0, 0, 1] }
    structures: [{ file: ../model/out/thread-structure.glb, scaleToMM: 1000, opacity: 0.35 }]
instances:                                    # Z-up model → voxeled's Y-up
  - { fixture: ropes-tube-0, name: tube-0, rotDeg: [-90, 0, 0] }
  # … tube-1, tube-2, spine …
```

- Rope centre = 12 mm (tube radius) + 13 mm (rope radius) = 25 mm off the axis; normals radial.
- Resolves in ~30 ms: 7,200 LEDs, 12 strands, the steel. Validated against the as-designed
  `leds_v2.f32` (position + normal per LED): on the tubes a median **5 mm** / 90% 8 mm position
  error and normals agreeing at **n·n′ = 0.998**; the spine ropes are ~37 mm off because the
  "between the arms" rule isn't modelled yet.
- Run: `node examples/mobius-heart/run.mjs ../thread-3d/voxeled/thread.yaml`. **S** for the simulator,
  **M** for the opaque steel, `VOX_DDP_IN=4048` to drive it from xLights or FPP.
- Bake it: `node examples/mobius-heart/export.mjs ../thread-3d/voxeled/thread.yaml build/thread` →
  `build/thread.vxl.json` (LEDs + the steel). Place it in any other installation: builder ▸ *new
  fixture from a file* ▸ `vxl` ▸ that file — or `fixtures: { thread: { type: vxl, params: { file: … } } }`.
  The frame comes along, already rotated.

## 11. Gotchas

- **Restart the hub after changing hub-side code** (`run.mjs`, `src/*`). Node keeps old modules; the
  browser loads new pages. The builder detects this and asks you to restart; other features may not.
- **Save before restarting.** Builder edits are applied live but live only in the hub until saved.
- **Frames.** LEDs and structure must share a frame; Z-up models need `rotDeg: [-90, 0, 0]`; STL/OBJ
  need `scaleToMM`. `vox check` warns when units look like metres.
- **STEP doesn't load** in a browser — export STL/GLB from CAD (build123d, SolidWorks, Fusion all do).
- **Inferred normals** (chip import, glTF without `NORMAL`, Grasshopper without N) are a heuristic —
  verify with **N** in the viewer; flip with `normalSign`.
- **Scene-level structures** don't move with fixtures; per-fixture ones do.
- **Data order is addressing.** Generators and importers define it (chaining, curve order, list
  order); `vox check` flags a scrambled order.

## 13. Moving fixtures and wands

A tracked instance is re-placed from its fixture-local geometry every time its tracker's pose
arrives, so everything downstream just works: world patterns sweep over the wand where it *is*,
its own LEDs are lit and patched like any fixture, it occludes in the simulator. And a pose is a
control: `lantern { lampFrom }` puts the lamp in someone's hand (columns light toward them),
`point { from }` is a torch beam (aim at a column, it lights), `paint { from }` leaves trails on
whatever is waved near.

```yaml
trackers:
  - { name: wand-1, source: phone }        # or ws (any JSON pose on the bus) or psn (PosiStageNet)
fixtures:
  wand: { type: rope, params: { path: [[0,0,0],[0,600,0]], count: 60, radiusMM: 8 }, output: { protocol: ddp, host: wand-1.local } }
instances:
  - { fixture: wand, name: wand-1, track: wand-1 }
show:
  scenes:
    - { name: lantern, pattern: lantern, params: { lampFrom: wand-1 } }
    - { name: torch,   pattern: point,   params: { from: wand-1, spreadDeg: 14 } }
    - { name: paint,   pattern: paint,   params: { from: wand-1, radiusMM: 600, decayS: 8 } }
```

**Joining live.** None of that has to be in the layout up front. While the show runs, a device
sends `{"type":"hello", id, fixture:{type, params}, output, track: true}` on the bus (or
`POST /instances`) and is appended — its pixels after everyone else's, the show clock untouched,
inputs still bound — and removed by `bye` or silence (`ttlS`). The phone page does this with one
tap: **join the piece — become a pixel**. The phone is a `dot` fixture (one pixel = its screen,
which shows the pattern's colour at wherever the phone is on the floor plan) *and* a wand. Scan
the hub's QR, tap join, drag yourself into the room, wave. `join: false` in a layout closes it;
`join: { max, ttlS, fixture }` tunes it.

Where poses come from: **the phone** (open `phone.html` — a floor plan of the piece appears; drag
yourself on it, *enable motion*, tap *face the piece = forward*, then point the phone like a wand),
**any client on the bus** (`{"type":"pose","id":"wand-1","pos":[x,y,z],"rotDeg":[rx,ry,rz]}` — an
ESP32 wand with an IMU, a camera tracker), or **PosiStageNet** (`source: psn`). Try it:
`node examples/mobius-heart/run.mjs examples/mobius-heart/layouts/wand.yaml`, scan the QR.

## 12. Site context: the piece in the world

Before a piece is built, see it *from where people will stand*. Anchor the layout to a place and
list vantages, each with a 360° backdrop:

```yaml
site: { lat: 37.7749, lon: -122.4194, headingDeg: 0 }          # origin here; the piece's −Z faces north
vantages:
  - { name: sidewalk, lat: 37.77481, lon: -122.4194, eyeHeightMM: 1600, image: photos/sidewalk-night.jpg }
  - { name: corner,   lat: 37.7750,  lon: -122.4190, eyeHeightMM: 2500, cube: streetview/corner }
```

Press **V** (or *stand*) in the viewer: the camera goes to that eye, the photo wraps around it, and
the LEDs / structures / simulator render over it at the true bearing and size. Drag to look around,
wheel to zoom, **V** again for the next vantage, then back to orbit. `S` for the simulator works
there too — the photo is dimmed so the bloom is the LEDs'.

Where the backdrop comes from, best first:
1. **A 360° photo you take at the spot, at night** (phone photo-sphere, Insta360…). Note the
   photo's compass heading (`PoseHeadingDegrees` in its metadata, or eyeball it) as `headingDeg`.
2. **Street View** — `GOOGLE_MAPS_API_KEY=… node src/cli/vox.mjs streetview <lat> <lon> -o streetview/corner`
   fetches six compass-aligned 90° faces through the official Static API and prints the
   `vantages:` line to paste (with the panorama's *true* position; Street View cars shoot from ~2.5 m).
   Daytime, and Google's terms treat it as a working preview, not an asset.
3. **Mapillary** or any other equirectangular source, as `image:`.

A photo carries no depth, so real buildings don't occlude the piece. If that matters, add a site
scan or the building's CAD as a scene-level structure (opaque in the simulator). Try it:
`node examples/mobius-heart/run.mjs examples/mobius-heart/layouts/site.yaml` (its backdrop is a
compass test pattern — north red, east green, south blue, west yellow).

## 13. No server: the static page

Everything in this guide except the wire also runs with no hub at all: open `viewer/?static=1`
from any static host and the page runs the hub itself, keeping the layout and the files you drop
in inside the browser (IndexedDB). Author there, export a bundle, publish a baked piece next to
the page, or point it at a LAN hub's `/bus` for live frames. Details: [STATIC.md](STATIC.md).

### 13.1 The public face: `?ui=bar`, embedding

The same page has a **presentation** mode for a piece's public page (dnuke.art/thread runs on it):
`?ui=bar` replaces the authoring HUD with a bar along the bottom — the show's scenes (click to pin
one, crossfading from what's on) and the view toggles (live · orbit · sim · glow · ropes · model ·
normals) — auto-orbits, and hides the floor grid. `?embed=1` is a bare canvas (no UI, no zoom/pan)
for a tile. On a phone (under 700 px) the bar folds to the scene that's on, *live* and a ☰ menu that
opens the rest and folds again after a pick, and the controls fold to their header. Both accept:

| param | |
|---|---|
| `scene=<name>` | start pinned on that scene (and don't orbit) |
| `orbit=0/1`, `zoom=1.5`, `az=`, `el=`, `cam=x,y,z&target=x,y,z` (mm) | the view; `zoom` > 1 is closer |
| `sim=1`, `bloom=0`, `ropes=0`, `normals=1`, `model=opaque/hidden`, `grid=0/1`, `bg=0c0c0c` | look |
| `ws=wss://…` | connect the live socket on load; `live=only` (bar/embed default: only what arrives is shown, dark otherwise — a dark piece means the sender is silent) or `live=merge` (over the show) |
| `controls=0`, `controls=min` | don't draw the piece's control panels / start them folded to their header (a phone's default) |
| `walk=1`, `stereo=1` | start in **walk** (first person on this screen — the VR placement without a headset; F toggles); side-by-side stereo for a cardboard viewer |
| `xrscale=0.1`, `xrdist=2` | WebXR: the piece's scale in a headset / on a phone (1 = true size; 0.1 a tabletop model) and, in VR, how far back from its centre you start (default: inside it if it is big, else just outside) |

**Walk — the demo without a headset.** *walk* (or **F**, or `?walk=1`) is first person on any screen: the eye at
1.6 m where VR would start you, WASD / arrows and the mouse (a click locks it) on a desktop; on a phone, drag to
look and the left third of the screen is a stick, *gyro* makes the phone a window on the piece (iOS asks once),
*stereo* splits the view for a cardboard viewer. `?xrdist` and `?xrscale` apply here too.

**In a headset, on a phone.** Where the browser has WebXR, the bar (and the HUD) gain **vr** and **ar**: *vr* walks the
piece at true scale — a trigger steps the show, the left stick walks, the right one snap-turns — and *ar* on a phone
stands it on the real floor: a ring follows the hit-test, a tap places the piece's floor centre there facing you, a tap
moves it. Bloom is off in XR. The iframe needs `allow="xr-spatial-tracking"`. No WebXR (an iPhone): the buttons don't appear.

**Live mode** shows a dot top-right (green: frames arriving, with the rate · amber: connected, nothing
coming · red: down, reconnecting every 2 s · blue: the server closed with code 4000, *asleep* — it
reconnects when a control button is pressed) and, in live-only mode, a banner saying which. Picking a
scene by hand leaves live mode, as on a stage.

**On your own site.** `node scripts/vendor.mjs <site>/voxeled` copies the viewer and its modules
(nothing else) into a site; a page there embeds the piece and keeps its own chrome:

```html
<iframe src="/voxeled/viewer/?project=/thread/thread.yaml&ui=bar&sim=1&zoom=1.4" allow="xr-spatial-tracking"></iframe>
```

The host page can drive it with `postMessage`: `{ voxeled: "key", key: "q", type: "keydown"|"keyup" }`
(forward the page's keys to the control panels), `{ voxeled: "scene", scene: "plasma" }`,
`{ voxeled: "connect", url }` (`url: null` disconnects).

