# The editor — how to work in the page

This is the help behind the **?** key in the viewer. It is the workflow: what the panels are, how
to start a new layout, add scenes, bring fixtures in, and pick or write patterns. The field-by-field
reference is the [authoring guide](GUIDE.md) and [FORMAT.md](FORMAT.md); the gentler tour is
[Getting started](START.md).

Open the editor at [pixeldestrukt.github.io/voxeled/viewer/?static=1](https://pixeldestrukt.github.io/voxeled/viewer/?static=1)
(or `viewer/` next to a running hub). Everything you make stays in **this browser** (IndexedDB) —
nothing is uploaded; *export* a bundle to move it.

## The page

| panel | opens with | what it is |
|---|---|---|
| **HUD** (top-left) | tap its title · **H** | scene name, counts, the view buttons, the crossfader. Folds to one line. |
| **project** | *project* button · **P** | the project: which one is open, the files in it, the **layout text**, bundles, a live hub. |
| **builder** | *builder* button · **E** | place things by hand: select an instance, move/rotate, duplicate, array, emitter, output patch, add instances, new fixture from a file. |
| **help** | *help* button · **?** | this, condensed. |
| the view | drag · scroll | orbit and zoom. **S** simulator, **B** bloom, **M** model, **N** normals, **R** ropes, **O** orbit, **V** stand at a vantage, **[ ]** crossfade, **A** auto. |
| **walk** | the button · **F** · `?walk=1` | first person on this screen: WASD / arrows + mouse, or drag + a stick on a phone; *gyro* and a cardboard *stereo* split. The headset demo without a headset. |
| **vr** · **ar** | the buttons (where the browser has WebXR) · **X** | walk the piece at true scale in a headset; on a phone, stand it on your floor (tap where the ring lands). `?xrscale=0.1` for a tabletop model. |

On a phone the HUD starts folded and the panels are sheets along the bottom.

A **layout** is the YAML in the project panel: fixtures (kinds of thing), instances (where they
are), structures (the piece's own CAD), paths, inputs, controls, and the **show** (scenes). The page
runs the same hub the Node server runs, so what you see is what a controller would get.

## 1. A new layout

1. *project* → **new** — name it. You get a starter layout: one 8×32 panel and two scenes.
2. Edit the layout text. **apply** runs it (an error shows under the buttons and names the field);
   **💾 save** keeps it in this browser. Save often; *save as…* forks a copy, and an example
   opened from the list is read-only until you *save as…*.
3. Or start from an **example** in the project list (columns, ropes, site…) and *save as…*.
4. Or **drop a `.yaml`** on the page: it becomes the layout. Drop a `*.voxeled.json` **bundle** to open
   a whole project someone exported.

The smallest layout that lights up:

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

Units are **millimetres**, **Y is up**; `pos` places a fixture's origin, `rotDeg: [x, y, z]` turns it.

## 2. Scenes — the show

A **scene** is a pattern with parameters, under a name. The show cycles them (`holdS` seconds each,
`fadeS` crossfade); the crossfader in the HUD scrubs between two by hand (**A** returns to auto),
and a page in `?ui=bar` mode shows them as a bar of buttons.

```yaml
show:
  holdS: 6
  fadeS: 2.5
  scenes:
    - { name: rising, pattern: planeSweep, params: { speedMM: 400, spacingMM: 1200, widthMM: 250 } }
    - { name: helix,  pattern: helix,      params: { turns: 1, pitch: 3 } }
    - { name: comet,  pattern: comet,      params: { speed: 0.12, tail: 0.15 } }
```

Add a scene = add a line, **apply**. The crossfader's A/B labels follow the scene names, and the
pattern bar (`viewer/?…&ui=bar`) lists them in order. To start a page on one: `?scene=helix`.

**Layers.** A scene can be a stack — a generic pattern under, a specialised one only where it fits:

```yaml
    - name: night
      layers:
        - { pattern: plasma }                                        # everywhere
        - { pattern: helix, on: { space: cylinder }, blend: add }    # only on tubes
        - { pattern: comet, on: { fixture: ropes }, blend: max, opacity: 0.8 }
```

`on:` is `all`, `{ fixture: … }`, `{ instance: … }` or `{ space: … }`; `blend:` is over · add · max ·
multiply · screen. Every pattern says which **space** it reads (world, volume, fixture, strand,
cylinder) and apply checks it against the fixtures: `helix` (a cylinder pattern) on a flat panel
still runs, as a chase, but the layout carries a warning with the fix — put it on a layer with
`on:`. [GUIDE §3.5](GUIDE.md#35-show-and-patterns).

## 3. Fixtures — bringing LEDs in

A fixture is a *kind* of thing; instances place it (many times, if you like). Pick the route that
matches what you have:

**Primitives — type them.** No files needed.

| you have | `type` | the essentials |
|---|---|---|
| a panel, matrix, or strip laid in rows | `matrix` | `cols`, `rows`, `pitchMM`, `wiring: rows\|columns`, `start` corner, `serpentine` |
| a strip, string or rope along a line or curve | `rope` | `path` (inline points `[[x,y,z], …]` or a named path), `count` or `pitchMM`; `radiusMM` + `angleDeg` around a tube; `diffuserMM` draws it as a lit tube |
| a flexible panel rolled into a tube | `tube` | `cols` around, `rows` along, `panels`, `pitchMM` |
| a video surface: an LED wall as an image, a projector, a monitor | `screen` | `cols`, `rows` (texels), `widthMM`; the same patterns light it; `viewer/screen.html?instance=…` is the fullscreen output (hub only) |
| one big LED / a lamp | `dot` | `sizeMM` |

**From a file — the builder.** *builder* → **new fixture from a file**: name it, choose the kind,
give the file name and the scale (mm per unit; STL in metres = 1000), **＋ create fixture & add
one**. Drop the file on the page first (or *project* → *＋ add files…*); a dropped file is found
by its bare name, so `file: ../models/frame.stl` only needs `frame.stl` dropped in.

| the file | `type` | notes |
|---|---|---|
| CAD with the LED chips modelled (STL/OBJ/GLB) | `mesh` | one LED per chip body; the thin axis is the LED's normal. Check **N**; `normalSign: -1` flips. |
| positions baked by Blender, Grasshopper, `vox import`, or `export --bare` | `vxl` | a `.vxl.json` — carries normals, strands, emitter |
| a glTF with points/normals | `gltf` | `file`, `scaleToMM` (glTF is metres) |
| a Chromatik / LX model (`.lxm`, `.lxf`) | — | `vox import model.lxm` on the command line, then `vxl` |

The same fixture is typed in the layout as `fixtures: { name: { type, params: { file, scaleToMM } } }`.

**Place it.** `instances:` lines (`pos`, `rotDeg`, or `array:` / `ring:` / `along:` to generate
many), or the builder: click an instance, **T** move / **R** rotate with the gizmo (10 mm / 5°
snaps) or type numbers, *duplicate*, *delete*, *▦ make array*, *＋ add* another instance of any
fixture.

**Its look and its wire.** The builder's **emitter** row (viewing angle, size, core, softness,
gain, glow) is what the simulator draws; the **output** row (protocol · host · port · universe ·
channel · byte order) is the patch a hub sends. Tick *apply to every … instance* to set the fixture's
default. The browser can't send UDP: to light real LEDs run the hub on a LAN computer
(`node examples/mobius-heart/run.mjs layout.yaml`), then watch it here with `?ws=ws://<hub>:8080/bus`.

**Structures.** The sculpture, frame or wall around the LEDs: `structures: [{ file: frame.glb,
scaleToMM: 1000, opacity: 0.35 }]` on a fixture (rides with every instance) or at the top level.
Translucent in dots mode, an occluder in the simulator (**M** cycles).

## 4. Patterns

A pattern is a function of each LED's **real position and normal** (and its place along its
fixture or strand), not its index — so a wipe crosses the gap between two panels in real time and a
spiral wraps a tube. Use them by name in `show:`; parameters in `params:`.

| pattern | what it does | params |
|---|---|---|
| `ribbonChase` | a hue chase along each fixture's data order | `loops`, `speed`, `sat` |
| `planeSweep` | planes of light rising through everything | `speedMM`, `spacingMM`, `widthMM`, `hue` |
| `worldWipe` | a plane wiping along an axis; `space: world` keeps the real gaps | `axis`, `speedMM`, `spacingMM`, `widthMM`, `space`, `hue` |
| `helix` | a barber-pole stripe winding around a tube as it climbs (`pitch: 0` = rings) — *cylinder* | `turns`, `pitch`, `speed`, `width`, `hue`, `hueAlong`, `dir` |
| `lantern` | a lamp carried through the room; sides facing it glow | `path: orbit\|eight`, `radiusMM`, `heightMM`, `speed`, `falloffMM`, `ambient` |
| `swirl` | spiral arms over the floor about the piece's centre | `arms`, `spacingMM`, `speed`, `twist`, `wrap` |
| `drops` | drops falling down one side of each column — *cylinder* | `rate`, `speed`, `lengthS`, `spin` |
| `comet` | a comet bouncing down every strand with a tail | `speed`, `tail`, `hue`, `hueStep`, `ambient` |
| `plasma` | layered sine fields along each strand | `speed`, `scale`, `hueDrift`, `sat` |
| `fire` | heat injected at LED 0 climbing each string | `rate`, `cooling`, `seed` |
| `strands` | one colour per strand (or per `group`) — the wiring at a glance | `group`, `hue`, `hueStep`, `sat` |
| `solid` | one colour everywhere | `rgb` or `hue`, `sat`, `value` |
| `normalRGB` | colours each LED by its normal — the map made visible | — |
| `spotlight`, `projector` | only what a virtual camera sees; project a texture through it | `orbitDegPerSec`, `angleDeg`, `elevDeg`, `fovDeg` |
| `point`, `paint` | a torch beam from a tracked wand / phone; a brush that leaves light | see [GUIDE §3.5](GUIDE.md#35-show-and-patterns) |
| `testCard` | a grid, border, centre cross and tinted quadrants on a screen — align a projector | `cells`, `line`, `hue` |
| *(GPU)* | in the page the pure patterns also run as one GPU shader (`?gpu=0` to turn it off); fire, paint, torch and visibility stay on the JS path | — |
| `sampler` | an image source on the pixels: `map: uv` (the fixture as the image), `box` (a plane in the world), `projector` (a beam) — [GUIDE §3.8](GUIDE.md#38-video--the-sampler) | `source`, `map`, `box`, `projector`, `filter`, `outside`, `gain` |

**Your own.** A pattern is code: `(pixel, t, ctx) → [r, g, b]` in 0..1, with `pixel.p` (mm),
`pixel.n`, `pixel.s` / `pixel.v` (0→1 along / across its fixture), `pixel.strand`, `pixel.inst`, and
`ctx.scene`. Add it to `src/patterns.mjs` and register it in `PATTERNS`; it is then a name any layout
can use — in the Node hub, and in the page when you host your own copy of the viewer
(`scripts/vendor.mjs`, [STATIC.md](STATIC.md)). There is no loading of pattern files at run time yet.

**Video.** Declare sources in a `video:` block — `{ file: poster.png }` (drop the file in), `{ file:
clip.mp4 }`, `{ url }`, `{ camera: true }`, `{ display: true }` — and put a `sampler` on a scene or a
layer. Stills and clips start on their own; the camera and a display capture start from the
*video sources* row in the project panel (the browser asks once). A raw-frame `stream` is for the
Node hub (ffmpeg → TCP). The `screen` example has a poster on its wall, as a plane the columns share,
and projected from the back of the room.

## 5. Keep it, share it

- **💾 save** (project panel or builder) — this browser.
- **⬇ export** — one `name.voxeled.json` bundle: the layout and every file. Drop it on another
  browser's page, or host it next to the page (`?project=/path/layout.yaml`, [STATIC.md](STATIC.md)).
- A piece's **public page**: `viewer/?project=…&ui=bar&sim=1` — the pattern bar, live mode, the piece's
  own controls ([GUIDE §13.1](GUIDE.md#131-the-public-face-uibar-embedding)).
- The layout text is plain YAML: copy it into the repo's `examples/…/layouts/` and run it with the
  Node hub to drive real LEDs ([START §6](START.md#6-drive-real-leds)).

## Troubleshooting

- **apply says ✗** — the message names the field (`fixtures.panel: …`). Indentation is two spaces;
  `{ … }` inline maps need the spaces.
- **the piece is black in the simulator** — normals point away (**N** to see them; `normalSign`),
  or a live socket is connected and the sender is silent (the *live* dot is amber).
- **a dropped file isn't found** — the layout's `file:` must end in the dropped file's name
  (`…/frame.stl` ↔ `frame.stl`); the *files* list in the project panel shows what's in.
- **nothing moves on real LEDs** — the page can't send UDP; run the hub (`run.mjs`) on the LAN.
