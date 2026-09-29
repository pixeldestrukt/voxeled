# Getting started — your own LEDs in voxeled

voxeled shows an LED piece as it will really look, and drives it. You describe the piece once —
where every LED is, which way it points, how it's wired — in a small text file called a
**layout**, and get: a 3D preview in the browser, a **simulator** that renders the LEDs as
emitters (viewing angle, dark backsides, the frame blocking light), **patterns** that move
through the piece in real millimetres, a **builder** to place things by dragging, and (when you
run the hub next to the LEDs) Art-Net / DDP / sACN / dan-mx output plus inputs from other tools.

Nothing to install for the first part: **https://pixeldestrukt.github.io/voxeled/** runs the whole
authoring side in your browser, and the files you add stay in your browser.

1. [Five minutes: an example](#1-five-minutes-an-example)
2. [Describe your piece](#2-describe-your-piece) — strips, panels, rolled tubes, CAD, Blender
3. [Place it](#3-place-it) — instances, arrays, rings, the builder
4. [See it](#4-see-it) — simulator, the frame around the LEDs, standing at the site
5. [Light it](#5-light-it) — patterns and the show
6. [Drive real LEDs](#6-drive-real-leds) — the hub, the patch, protocols
7. [Share it](#7-share-it) — bundles, publishing a piece, your own copy of the site
8. [Troubleshooting](#8-troubleshooting)

---

## 1. Five minutes: an example

Open **https://pixeldestrukt.github.io/voxeled/viewer/?example=columns**.

- Drag to orbit, scroll to zoom. The HUD top-left says *Bus: local hub (this page)* — the show
  is being computed in your browser at 30 fps.
- **S** — the simulator. Each LED becomes a glowing body inside a diffuser tube.
- **[ ]** scrub between the two scenes, **A** back to auto-crossfade.
- **E** — the builder. Click a column, drag the arrows to move it, 💾 saves.
- **P** — the project panel: the layout text that made all this, the files it uses, and the
  list of examples (`site` has a photo backdrop and a frame; `two-hearts` a parametric ribbon;
  `ropes` LED ropes along paths).

Everything you'll do with your own piece is the same loop: edit the layout (or drag in the
builder), see it, save.

## 2. Describe your piece

A layout is YAML. The smallest useful one:

```yaml
name: my-piece
fixtures:
  panel: { type: matrix, params: { cols: 32, rows: 8, pitchMM: 10, wiring: columns, start: top-left } }
instances:
  - { fixture: panel, name: panel-1, pos: [0, 1200, 0] }
show:
  scenes:
    - { name: chase, pattern: ribbonChase }
```

In the project panel, paste it into the layout box and **apply**. That's a 256-LED 8×32 panel,
hanging 1.2 m up, running a chase in its data order.

**Units and frame.** Millimetres. Y is up. `pos` is where the fixture's origin sits;
`rotDeg: [x, y, z]` rotates it (degrees; `[0, 180, 0]` turns it around to face the other way).

**Fixtures** are the kinds of thing you have. Pick what matches:

| you have | fixture | the essentials |
|---|---|---|
| a flat panel, a matrix, a strip laid in rows | `matrix` | `cols`, `rows`, `pitchMM`, `wiring: rows\|columns` (how the data snakes), `start` corner, `serpentine`, `center` |
| a strip, string or rope along a line or a curve | `rope` | `path` (inline points `[[x,y,z], …]` or a named path), `count` or `pitchMM`; `radiusMM` + `angleDeg` if it's wrapped around a tube; normals point outward |
| a flexible panel rolled into a tube | `tube` | `cols` around, `rows` along, `panels` end to end, `pitchMM`, `seamMM` |
| a CAD model with the LED chips modelled | `mesh` | `file` (STL/OBJ/GLB), `scaleToMM`; one LED per chip body, thin axis = the LED's normal |
| positions exported from Blender / Grasshopper / another tool | `vxl` | `file` (a baked `.vxl.json`) — see the [Blender addon](../integrations/blender/) and [Grasshopper component](../integrations/grasshopper/) |
| a glTF with points/normals | `gltf` | `file`, `scaleToMM` |
| a Chromatik / LX model | `vox import model.lxm` | on the command line, then `vxl` |

Every LED gets a **position and a normal** (the direction it shines). Primitives know theirs;
CAD import derives them from the chip geometry; exports carry them. That's what makes the
simulator honest — a strip seen from behind is dark.

**Files.** Anything a layout names (`file:` for a mesh or baked fixture, structures, path
files, photos) you add to the project by dropping it on the page (or *＋ add files…*). Paths in
the layout are relative to the layout; a dropped file is found by its name, so
`file: ../models/frame.stl` just needs `frame.stl` dropped in.

Two more you'll want soon:

```yaml
paths:                                   # a curve LEDs follow (mm), or load one: { file: curve.json, scaleToMM: 1000 }
  arch: [[0, 0, 0], [500, 900, 0], [1000, 1200, 0], [1500, 900, 0], [2000, 0, 0]]
fixtures:
  string: { type: rope, params: { path: arch, pitchMM: 33 } }         # 12 mm pixels at 33 mm pitch along the arch
  frame:
    type: matrix
    params: { cols: 16, rows: 16 }
    structures: [{ file: frame.stl, opacity: 0.35 }]                # the thing it's mounted on, drawn around it (STL/GLB/OBJ)
```

The complete reference of every field is the [authoring guide](GUIDE.md) and
[FORMAT.md](FORMAT.md).

## 3. Place it

One fixture, many **instances** — that's how a piece is built:

```yaml
instances:
  - { fixture: panel, name: wall, array: { count: [4, 2, 1], spacing: [330, 90, 0] } }   # a 4×2 wall of panels
  - { fixture: string, name: arches, ring: { count: 6, radiusMM: 3000, facing: center } }  # six arches in a circle
  - { fixture: column, name: c1, pos: [2200, 0, 600] }                                    # one, by hand
```

`array`, `ring`, and `along` (instances spaced along a path) generate many placements from one
line. Or press **E** and place things by hand: click an instance, **T**/**R** to move/rotate
with the gizmo (10 mm / 5° snaps) or type numbers, duplicate, delete, ＋ add an instance of any
fixture, ▦ make array. Every edit is live; 💾 saves the layout.

## 4. See it

- **S** simulator. Each LED is rendered as an emitter with the fixture's **emitter profile**:
  `viewingAngleDeg` (120° is a bare 5050; 170° a diffused rope; 10° a spot), body size, core,
  softness, glow. Set it per fixture (`emitter: { viewingAngleDeg: 150, softness: 0.7 }`) or per
  instance; the builder's emitter row edits it live. **B** toggles bloom.
- **Structures** — the sculpture itself, the frame, the wall: a mesh file drawn around the LEDs,
  translucent in dots mode and an **opaque occluder** in the simulator, so you see what the
  steel hides from where you stand. **M** cycles translucent / opaque / hidden. Per fixture
  (rides with every instance) or once in the scene (`structures:` at the top level).
- **N** normals — a quill per LED showing where it shines. Check this first with imported
  geometry; if they point the wrong way, the `mesh` importer has `normalSign`.
- **Standing at the site.** Give the layout a place (`site: { lat, lon, headingDeg }`) and
  **vantages** — spots with a 360° photo (`image:`) or a Street View cubemap — then **V** puts
  the camera at that eye with the piece rendered over the photo at the true size and bearing.
  The `site` example shows it with a test pattern; a night 360° photo from your phone is the
  real thing.

## 5. Light it

Patterns are functions of each LED's real position (and normal), not of its index — so a wipe
crosses the gap between two panels in real time, and a spiral wraps a tube.

```yaml
show:
  holdS: 6          # seconds per scene
  fadeS: 2.5        # crossfade
  scenes:
    - { name: rising,  pattern: planeSweep, params: { speedMM: 400, spacingMM: 1200, widthMM: 250 } }
    - { name: wipe,    pattern: worldWipe,  params: { axis: 0, space: world } }
    - { name: helix,   pattern: helix,      params: { turns: 1, pitch: 3 } }
    - { name: lantern, pattern: lantern,    params: { path: eight, heightMM: 1200 } }
```

| pattern | what it does | uses |
|---|---|---|
| `ribbonChase` | a hue chase along each fixture's data order | s |
| `planeSweep` | horizontal planes of light rising through everything | world Y |
| `worldWipe` | a plane wiping along an axis — `space: world` keeps real gaps, `fixture` syncs every instance | world / local X·Y·Z |
| `helix` | a barber-pole stripe winding around a tube as it climbs (`pitch: 0` = rings) | v, s |
| `lantern` | a lamp carried through the room lights the sides facing it | normals |
| `swirl` | spiral arms over the floor about the installation's centre | world angle |
| `drops` | drops falling down one side of each column | s, v |
| `comet`, `plasma`, `fire`, `strands` | per **strand** — a comet down each rope, plasma along it, fire climbing from LED 0, one colour per strand/group (Thread's looks) | strand, s |
| `solid` | one colour everywhere | — |
| `normalRGB` | colours each LED by its normal — the map made visible | normals |
| `spotlight`, `projector` | only what a virtual camera can see; project a texture through it | visibility |

**Your own patterns.** A pattern is `(pixel, t, ctx) → [r, g, b]` in 0..1, with `pixel.p`
(mm), `pixel.n`, `pixel.s`/`pixel.v` (0→1 along/across its fixture), `pixel.inst`. Add one to
`src/patterns.mjs` and register it in `PATTERNS`; it's then available by name in any layout.
(On the hosted page that means running your own copy — see §7.)

## 6. Drive real LEDs

The browser can't send UDP. To light the piece, run the **hub** on a computer on the same
network as your controllers:

```bash
git clone https://github.com/pixeldestrukt/voxeled && cd voxeled       # Node ≥ 18, no dependencies
node examples/mobius-heart/run.mjs path/to/my-piece.yaml               # → http://localhost:8080 — the same viewer, now from the hub
```

Export your project from the page as a bundle if you built it there (P → ⬇ export), or just
keep the YAML + files in a folder — the hub reads them from disk, next to the layout.

**The patch** says where each fixture's pixels go:

```yaml
fixtures:
  panel:
    type: matrix
    params: { cols: 32, rows: 8, wiring: columns }
    output: { protocol: artnet, host: 192.168.1.50, universe: 0, byteOrder: grb }   # one node, universes roll on from 0
instances:
  - { fixture: panel, name: a }
  - { fixture: panel, name: b, pos: [330, 0, 0], output: { universe: 2 } }          # per-instance override
  - { fixture: column, name: c1, output: { protocol: ddp, host: column-1.local } }   # a WLED / ESP32 node per fixture
```

Protocols: `artnet` (universes/channels), `ddp` (offsets — WLED, FPP, Falcon…), `danmx`
(ESP32 nodes), with `sacn` on the way; details in [protocols.md](interop/protocols.md). The
preview and the wire get the identical frame, so what you see is what the LEDs do.

**Other tools driving it.** The hub also *receives*: Art-Net or sACN from a console or
sequencer, DDP from xLights/LedFx, TCP from TiXL, frames from a web page — several at once,
merged per pixel by priority with failover to the show (`inputs:` + `merge:` in the layout).
So you can keep sequencing in the tool you know and let voxeled own the map, the simulator and
the wiring.

## 7. Share it

- **A bundle** — P → ⬇ export gives one `*.voxeled.json` with the layout and every file. Anyone
  drops it on the page (or ⬆ import) and has your project; nothing goes through a server.
- **Publish a piece** — put the layout and its files on any web host (a GitHub repo works) and
  link `viewer/?project=https://…/piece.yaml`. The page fetches them next to the layout.
  Publish a *baked* `.vxl.json` if the source geometry is private.
- **Watch it live** — add `&ws=ws://<hub>:8080/bus` to see the hub's frames on the page (an
  `https` page needs `wss://`).
- **Your own copy** — fork the repo, enable Pages → *GitHub Actions*, and your patterns and
  fixtures deploy on every push ([STATIC.md](STATIC.md)).
- **On your own site** — `node scripts/vendor.mjs <site>/voxeled` drops the viewer into any static
  site; embed it with `<iframe src="/voxeled/viewer/?project=/piece/piece.yaml&ui=bar&sim=1">`.
  `?ui=bar` is the public face: a pattern bar, the view toggles, live mode with its indicator, and
  the piece's own buttons if the layout declares `controls:` ([GUIDE §13.1](GUIDE.md#131-the-public-face-uibar-embedding)).

## 8. Troubleshooting

- **"file not found: x.stl (have: …)"** — the layout names a file that isn't in the project;
  drop it on the page. The message lists what *is* there.
- **The panel is huge / tiny** — units. STL/OBJ carry none: say `scaleToMM: 1000` for metres,
  `25.4` for inches. glTF is metres and defaults to ×1000.
- **It's lying on its back** — Blender and most CAD are Z-up; voxeled is Y-up. `rotDeg: [-90, 0, 0]`.
- **Dark in the simulator** — you're looking at the backs. Orbit round, or press **N** to see
  which way the LEDs face; the `mesh` importer's `normalSign` flips them.
- **The chase runs the wrong way / jumps** — data order. `serpentine`, `start`, `wiring` on a
  matrix; `flip`-style knobs on tubes; `vox check file.vxl.json` flags scrambled orders.
- **Nothing moves after I edited the layout** — a red status in the project panel says why
  (a YAML slip, an unknown fixture type, a missing file). The last good scene keeps running.
- **The builder says the hub is stale** — you changed hub code with a hub running; restart it.
- **`ws://` won't connect from the hosted page** — an `https` page can only open `wss://` or
  `localhost`. Run the page from the hub (`http://<hub>:8080`) or proxy the hub with TLS.
- **Something else** — [open an issue](https://github.com/pixeldestrukt/voxeled/issues) with
  the layout and what you saw.
