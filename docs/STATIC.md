# The static page — voxeled with no server

The viewer runs the hub **in the browser**: the same layout → scene → patterns → frames pipeline
the Node hub runs, on the same modules, fed by files kept **in the browser** (IndexedDB). Host it
anywhere that serves files — GitHub Pages, a folder on a web server, a USB stick — and:

- **author** a piece: drop a layout + models in, place and wire in the builder, see it in the
  simulator; nothing is uploaded anywhere, the project stays in that browser
- **publish** a piece: put a layout and its files next to the page and link to it — the page
  fetches them (Thread's site is this)
- **watch** a piece live: `?ws=ws://<hub>:8080/bus` merges the LAN hub's frames over the page's show

What can't run in a page: the wire. Art-Net/DDP/sACN/dan-mx out and in need UDP — that is the
LAN hub's job (`node examples/mobius-heart/run.mjs layout.yaml`), which the page can watch.

## Open it

| | |
|---|---|
| `viewer/?static=1` | the last project you opened in this browser (or the columns example) |
| `viewer/?example=site` | an example layout fetched next to the page: `columns`, `two-hearts`, `site`, `ropes`, `grid-3x3`, `facing-hearts`, `imported`, `patched` |
| `viewer/?project=https://…/thread.yaml` | a hosted project: the layout and the files it names (`collectFiles`), fetched relative to it |
| `viewer/?ws=ws://192.168.1.20:8080/bus` | live frames from a LAN hub (raw RGB or Art-Net over the socket) merged over the show |
| `viewer/` on a plain host | no `scene.json` → static mode automatically |

**P** (or the *project* button) opens the project panel: projects saved in this browser + the
examples; the files the layout refers to (drop files anywhere on the page — a `.yaml` becomes the
layout, a `*.voxeled.json` bundle opens a project, anything else is added as a file); the layout
text (apply / 💾 save); export/import a **bundle** (one JSON with the layout + every file, base64)
to move a project between browsers or host it; and the remote hub connection. The builder (**E**)
works exactly as against a hub — 💾 saves to IndexedDB instead of a file.

## Publish a piece (Thread)

Bake what's public and put it next to the page:

```bash
node examples/mobius-heart/export.mjs ../thread-3d/voxeled/thread.yaml site/thread/thread    # → thread.vxl.json (+ .glb)
```
then a layout beside it that places the baked piece and its (decimated) structure:
```yaml
# site/thread/thread.yaml
name: thread
fixtures:
  thread: { type: vxl, params: { file: thread.vxl.json } }
instances:
  - { fixture: thread, name: thread }
inputs:
  - { name: web, protocol: ws, priority: 100 }          # the page's ?ws= hub feed
show: { scenes: [{ name: chase, pattern: ribbonChase }, { name: helix, pattern: helix }] }
```
and link `viewer/?project=thread/thread.yaml&ws=wss://…`. The rope layout and the full model stay
private in thread-3d; the page only ever sees the baked pixels + the published structure.

## Hosting

`scripts/build-site.mjs` copies `viewer/`, `src/`, the example layouts/assets into `site/`
(relative imports resolve as in the repo); `.github/workflows/pages.yml` deploys it on every push
to `main` (enable Pages → *GitHub Actions* once). Any other static host works the same — it's
files. A `ws://` hub can be reached from an `http://` page, or from an `https://` page only when
the hub is `wss://` (or `localhost`): put the hub behind a TLS proxy for a hosted page.

## How it works

`viewer/local.mjs` is the in-page hub: `memoryVFS` (src/vfs.mjs) holds the project's files;
`resolveLayout({ vfs })`, `createShow`, `createHub` and `createSources` are the Node hub's modules
unchanged; structures and panoramas reach three.js as object URLs. `viewer/store.mjs` is the
IndexedDB project store + bundles. The viewer talks to either hub through one `api` object
(`getScene / control / getLayout / postLayout / inputs`), so the builder, crossfader and inputs
row don't know which one they're on. `test/static.test.mjs` runs the page against a plain static
file server in headless Chrome.
