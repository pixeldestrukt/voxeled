# voxeled — design notes

Living record of the decisions behind voxeled and the reasoning that produced them. Started from a kickoff conversation on 2026-07-07.

## Kickoff brief

- **Problem:** Volumetric LED tools are either monolithic and painful to integrate (LX Studio / Chromatik — Java patterns, awkward geometry import, no interchange) or closed and dongle-locked (MADRIX). None pair real-world-unit spatial animation with open, integration-friendly geometry + protocol interchange.
- **Done looks like:** A running hub loads a pixel-first scene (points carrying position + normal + output address), runs **one** world-space pattern, and fans **identical** frames to a WebGL preview *and* a real strip over DDP/Art-Net — preview and reality visibly match.
- **Not now:** Camera automapping, dynamic/moving-scene re-localization, full GDTF/MVR import, the Blender plugin, DAW-style UI, multiple visualizers. All roadmap — none in slice one.
- **First slice:** The spine, proven end-to-end and deliberately tiny — minimal format → hub loads it → one spatial pattern (uses XYZ so the real-world-unit value is visible) → normalized bus → WebSocket→WebGL viewer **and** DDP/Art-Net sender, on one hand-authored strip.
- **Open question:** CAD→points-with-normals (below). Riskiest *later* unknown is the **dynamic** scene — nothing in the space does live re-localization well, which is also where the differentiation lives.

## Decisions

1. **Spine = live hub + normalized pixel bus.** One process holds the scene, runs the pattern engine, and fans identical frames to every consumer. Preview and output are literally the same frames. Chosen over "format-first toolkit" and "browser-native engine" because it's the durable center for a live show and the format falls out of what the hub needs to load.
2. **Own a pixel-first scene format, import the standards.** A small, versioned, addressable-LED-tuned format (TOML/JSON) is the source of truth. Importers pull in glTF/USD (meshes) and GDTF/MVR (pro fixtures + rigs, positions already in mm). Reject GDTF as the *native* format — it's DMX-moving-light-centric and verbose for hundreds of pixels per fixture — but embrace it as an import target.
3. **3D point cloud is the native render space.** Every pixel is a positioned point with a normal; patterns are spatial functions `f(x, y, z, t) → color`. Not a 2D buffer projected onto geometry (xLights' model). Validated by MADRIX (voxels) and Chromatik ("sparse vertex shader").
4. **Real-world units (mm) throughout.** The one thing worth keeping from LX Studio: animation that reads smoothly across irregularly-spaced fixtures because motion is defined in physical space, not pixel index.
5. **DDP-first transport,** then sACN and Art-Net. DDP's offset-addressed flat framebuffer avoids 512-channel universe fragmentation and the ~44 Hz DMX refresh cap — the pragmatic winner for high pixel counts. sACN for pro/console interop (multicast + priority); Art-Net for reach.
6. **Ecosystem of small parts, not a monolith.** WebGL visualizers, Blender plugins, senders/sinks, network glue — each a client of the bus or an emitter of a scene. This is the wedge against every incumbent: integration-friendliness.
7. **Open + cross-platform, MIT, no dongle.** MADRIX's dongle/per-channel licensing and the Windows-only tools leave a wide-open lane.

## The CAD → LED-points-with-normals problem

The recurring blocker: turning a CAD model into positioned LED points *with a correct emission normal* (which way each light points). Needed so patterns can do dot-product-with-direction effects and so visualizers shade correctly.

### Why it's hard (grounded in thread-3d)

[thread-3d](https://github.com/dnewcome/thread-3d) extracts LED positions from an STL by averaging triangle centroids per LED group. It works for positions but yields **no per-LED normal** — and the LEDs ride a **swept tube**, whose triangle face normals point radially in every direction around the tube. Average them over one LED's triangle group and they **cancel toward zero**. That is the crux: sampling the raw CAD tube surface is the wrong source for "which way does the light point."

CAD exports also routinely ship **flipped/inconsistent winding**, so any surface-derived normal needs a normalize-and-repair pass regardless of source.

### The right sources for a normal

1. **The form surface, not the strip's tube.** For LEDs wrapped onto a sculpture/form, the emission normal you actually want is **outward from the form surface** at each point — raycast/nearest-face against the *form* mesh (or the medial reference), not the swept tube that carries the strip. This is the fix for the thread-3d case specifically.
2. **Blender bakes it for you (preferred authoring path).** Place LEDs with Geometry Nodes → *Distribute Points on Faces* (or instance-on-points), and each instance carries the interpolated **surface normal for free** — position *and* direction in one step, no separate solve. Bake `position + normal` into point attributes and export. This makes the Blender plugin the geometry authority.
3. **Strip gotcha:** for addressable strips the LEDs point *perpendicular to the mounting surface*, which is **not** the strip's travel direction. A curve-only import gives tangents, not emission normals — you still need the mounting surface (or an explicit "up") to get the real direction.
4. **Point-cloud fallback** (e.g. output of the camera automapper, or a surfaceless dump): estimate normals from k-nearest-neighbors (PCA, normal = smallest-eigenvector plane fit), then **orient consistently** — propagate orientation across the kNN graph, or raycast outward and flip any normal that re-enters the mesh. Standard Open3D `estimate_normals` + `orient_normals_consistent_tangent_plane`.

### Format implication

`normal` is a **first-class field on every pixel** (`position + normal + address`, minimum), carried through glTF as the standard `NORMAL` vertex attribute / USD `normals` primvar so it survives round-trips. Metadata is the first casualty of format conversion, so voxeled's own file stays the source of truth; glTF/USD are carriers.

## Interchange formats — stance

| Format | Role in voxeled |
|---|---|
| **native `.vxl`** (TOML/JSON) | Source of truth: geometry + per-output addressing + user params, co-located (Chromatik's best idea), versioned + stable. |
| **glTF / GLB** | Primary mesh interchange; `extras` + custom vertex attrs (`NORMAL`, index) carry LED metadata. Import + export. |
| **USD / USDZ** | For very large / instanced scenes — `PointInstancer` scales to millions of points with per-point attributes. |
| **GDTF** | Import target — the open fixture-definition XML standard (grandMA3, Vectorworks, Capture, Depence, BlenderDMX). Not native. |
| **MVR** | Import target — packages GDTF fixtures + placement + patch, **positions in mm**. MVR-xchange (mDNS + WebSocket) could feed *live* position updates → directly relevant to dynamic scenes. |
| **OFL JSON** | Reference model + importable data source only; its internal schema is explicitly unstable — do not build on it. |

## Protocols

| Protocol | Model | voxeled |
|---|---|---|
| **DDP** | UDP, offset into flat framebuffer, push flag, discovery. No universe fragmentation, no refresh cap. | **primary** |
| **sACN / E1.31** | UDP multicast, 512-ch universes + priority. | planned |
| **Art-Net** | UDP, 512-ch universes, broad reach. | planned |
| **OPC** | TCP, dead-simple `[channel, cmd, len, data]`. | maybe |

## Roadmap

- **Phase 0 — the spine** *(now)*: minimal `.vxl` → hub loads it → one spatial pattern → normalized bus → WebGL preview (WebSocket) + DDP/Art-Net sender, one strip. Preview == reality.
- **Phase 1 — bring your geometry**: glTF/USD import; Blender plugin baking positions + normals via Geometry Nodes; then GDTF/MVR import.
- **Phase 2 — automap**: Gray-code structured-light camera mapper (light pixels in a binary-coded sequence, detect per frame, triangulate ≥2 views → 3D; single camera → 2D). Export to native + glTF. Prior art: aaknitt/pixel_mapper, PWRFLcreative/Lightwork.
- **Phase 3 — live**: scenes & crossfades ✅, appearance simulator ✅; ahead: dynamic scenes (live re-localization via camera tracking or MVR-xchange), DAW-style channels + modulators (LFOs / envelopes / audio), the live-frame VJ jack-in (NDI).
- **Phase 4 — hosted & public**: run the hub behind a URL so an installation has an address. (a) **Public interaction**: a QR code on the piece → a phone web page (no app) on the hub's control seam (`/control` + the jack-in) — scene picks/triggers, crossfader, colour, and *spatial* input ("a wave from where you stand" — the map knows where that is); per-piece, rate-limited, moderated. Lineage: QR-driven interaction on earlier pieces, now built in. (b) **Collaborative pattern design**: patterns are pure `f(pixel, t, ctx)` and the viewer/simulator run in the browser, so collaborators author + preview against the real map in the simulator in a tab, then submit a scene; sandboxed in a Worker, versioned, previewed before it reaches an LED. Invariant: the local hub keeps driving the LEDs and falls back to its own show if the link drops — hosted is control-plane + preview + public face, never the light path.
- **Phase 5 — site context** (roadmap only): visualize an installation in place — e.g. from a Google Street View vantage. Key enabler: a **geo-anchor** in the layout (`site: { lat, lon, alt, headingDeg }`, mm frame → local ENU → WGS84) so any georeferenced backdrop aligns. Routes: (1) **panorama photo-match** — a 360° site photo or a fetched Street View panorama as an equirectangular background sphere, camera at the pano's position/heading, the piece rendered by the simulator on top, occluded by site CAD/scan structures (Street View has no supported 3D-overlay API, so the pano is a backdrop, not the widget; mind Maps Platform terms for fetched imagery); (2) **Photorealistic 3D Tiles** (Google Map Tiles API, three.js via a 3D-Tiles renderer) — fly to street level in the real city model; (3) **site scan** (photogrammetry / LiDAR GLB) as a scene-level structure — no API, best occlusion fidelity. Open questions: pano camera calibration (FOV/heading from Street View metadata), lighting/time-of-day match, and whether the hosted phone page can show the same composite for the public.

## The product — four ways a piece runs

voxeled is becoming a general LED control product. The pieces it comes from ran in four modes at
once, and the design has to hold all four without four code paths:

| mode | what runs it | what it needs from the engine |
|---|---|---|
| **ambient** — hands-off, for months | the show: scenes cycling, `holdS`/`fadeS` | a map that's right, patterns that read on the real geometry, a hub that never stops, fallback when inputs die |
| **show control** — cues, a timeline, a board | cues / timecode / OSC pinning scenes and setting params | pin + crossfade (done), params addressable by name, a clock, cue lists |
| **live VJ** — hands on, a room, a night | the crossfader, layers, modulators, video in | layers with blends, a sampler for video/NDI/screen, LFOs/audio/MIDI on params, latency under a frame or two |
| **participant** — the public touches it | buttons on the piece, a phone, a wand, a camera | `controls:`, trackers, join, inputs merged by priority, the hosted page |

The one model under all four: a **scene is a field over the world** — a function of position, normal
and the fixture's own coordinates — and every output, an LED or a texel, **samples** it. Modes
differ only in what drives the field's parameters and which scene is up.

## Patterns, video, XR — the field model

**Spaces.** A pattern is `(pixel, t, ctx) → rgb`, which is a fragment shader's shape: pure, per-sample,
attributes in. What was missing is the *vocabulary of coordinate spaces* a pattern is written
against — that is where "generalise vs specialise" actually lives:

| space | the pixel's | provided by |
|---|---|---|
| `world` | `p` (mm), `n` | everything |
| `volume` | `p` normalised to the piece's bounding box | everything |
| `fixture` | `s` / `v` along and across the fixture, `ctx.local` | panels, strips, imports |
| `strand` | which string, where along it | ropes, rolled panels, baked pieces (degrades: a fixture without strands is one strand) |
| `cylinder` | `v` around, `s` along, radial normals | tubes |

A pattern declares `needs` (src/patterns.mjs `SPACES`), a fixture declares `meta.spaces`, and the
layout checks every scene against the fixtures it runs on at apply time: *helix on a flat panel* is
said out loud — a warning naming the fixture, how the pattern degrades there, and the fix (a space
with no degrade is refused) — not a silent mess on the LEDs. ✅

**Layers.** A scene is a stack: pattern + selector (`on: all | { fixture } | { instance } | { space }`)
+ blend (over · add · max · multiply · screen) + opacity. Generic patterns underneath, specialised ones
only where they fit. This is layout-level, costs nothing per pixel beyond a mask, and is how MADRIX /
TouchDesigner people already think. ✅

**GLSL as a backend, not the language.** ✅ Patterns stay JavaScript — the hub has no GPU and JS is
the source of truth. In the page the same field runs on the GPU: the pure patterns have GLSL twins
(`src/gpu/glsl.mjs`), a show composes into one fragment shader (a function per scene, layer masks
and video sources as textures, the crossfade in main), attributes in float textures over an N-texel
target, read back into the same frame bytes (`viewer/gpu.mjs`). JS-only scenes (fire, paint, poses,
visibility) fall back per frame. The static test gates GPU against JS at ≤ 1 of 255. A JS-subset-to-
GLSL transpile is plausible later; a custom shader language is not worth it.

**Video and LEDs in one scene.** Pixels and texels are both samples of the field:
- *video into LEDs* ✅ — the `sampler` pattern (src/video.mjs): sources from a `video:` block — stills
  (PNG/PPM on the hub, anything in the page), clips / URLs / the camera / a display capture (page), raw
  rgb24 frames over TCP or the bus from ffmpeg or a VJ tool (hub) — mapped by fixture uv, a world box
  (a wall-sized plane every LED samples where it falls) or a pinhole projector (faces away dark). The
  screen example shows one poster on the wall, as a plane the columns share, and projected.
- *screens as fixtures* ✅ — a `screen` fixture is a quad with a resolution; the layer stack renders
  it per texel (the JS path, ≤ 262k texels); the simulator draws it as one continuous plane and
  `viewer/screen.html` shows it fullscreen for a projector or a monitor (NDI later). An LED wall and
  a projector surface share one spatial pattern (`layouts/screen.yaml`: a plane of light crosses the
  columns and the wall at the same real height). Big surfaces are where the GLSL backend earns its keep.

**AR / VR.** ✅ The simulator is three.js, so WebXR is the existing renderer: the mm world sits in a
group scaled to metres and placed; *vr* stands you at the piece's floor centre (a trigger steps the
show, the sticks walk and snap-turn); *ar* on a phone draws a reticle from the hit-test and a tap puts
the piece's floor centre there, facing you (`?xrscale=0.1` for a tabletop model). Bloom is off in XR.
A *walk* mode gives the same placement first person on any screen (mouse / keys, touch stick, phone
gyro, cardboard stereo) — the demo without a headset. iOS has no WebXR AR — a USDZ export is the
fallback, not done. The deeper AR use is the one Phase 2
names: the phone camera as the automapper, and later solving a projector's pose for the video half.

**Order:** spaces + validation ✅ → layers ✅ → `screen` fixture ✅ → the video sampler ✅ → the
GLSL backend in the page ✅ → WebXR VR ✅ → AR preview ✅ → modulators (LFO / audio / MIDI) on params and cue
lists for the show-control mode.

## Prior art surveyed

- **xLights** — open C++ sequencer; Model/submodel/group system; render-buffer-style maps effects onto geometry but is 2D-buffer-first; `.xmodel`/`.xsq`/`.fseq` (clean author/play split); E1.31/Art-Net/DDP/ZCPP; FPP runtime; REST automation aimed at the build pipeline. *Learn:* author/play split, controller auto-addressing, submodels/groups. *Avoid:* 2D-buffer mental model, closed C++ effects.
- **MADRIX 5** — the reference for true voxel/volumetric rendering; Patch Editor places fixtures in X/Y/Z; Art-Net/sACN/KiNET/DVI; MAS scripting. *Avoid:* Windows-only, dongle + per-channel licensing, no open interchange.
- **Jinx!** (live-leds.de) — free Windows LED-matrix tool; generators + regions + layer merge + scenes; Art-Net/sACN/TPM2/Glediator. *Learn:* compact live generator/merge model, cheap-protocol reach. *Avoid:* 2D-only, Windows-only.
- **LX Studio / Chromatik** — the right *core* (positioned 3D point cloud, spatial patterns, DAW/modular-synth UX) trapped in a monolithic Java app; `.lxf` co-locates geometry + protocol output + params (excellent), but it's LX-specific and patterns compile against the app. *Learn:* the engine model and `.lxf`'s co-location idea. *Avoid:* the monolith; ship an embeddable engine + headless server with a real API, scripting-layer patterns, and standard-format round-tripping.

Sources and the full research brief live in the project history; key format specs: gdtf.eu/gdtf/file-spec, github.com/mvrdevelopment/spec, chromatik.co/guide/custom-fixtures, manual.xlights.org.
