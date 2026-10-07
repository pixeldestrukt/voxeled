// Mixer / show — crossfade between scenes.
//
// A "scene" is a look: a name + a render function (a pattern with its params bound). The show
// runs two scenes as A/B decks and dissolves between them by a fader x∈[0,1]. In AUTO mode it
// cycles through all scenes on a timeline (hold, then crossfade to the next); a `control` object
// lets a UI override into MANUAL mode and drive the fader directly.
import { lerp } from "./vec.mjs";

const smoothstep = (x) => {
  x = x < 0 ? 0 : x > 1 ? 1 : x;
  return x * x * (3 - 2 * x);
};

// scenes: [{ name, render(px,t,ctx)->[r,g,b] }]
// control (optional, shared/mutable): { mode:'auto'|'manual'|'pin', fader, a, b, pin }
//   auto    cycle through every scene: hold, crossfade to the next
//   manual  a UI drives the fader between decks a and b
//   pin     one scene, picked by name or index (a page's pattern bar): crossfade from whatever was
//           showing when it was pinned, then hold it — `pin(idx, tNow)` sets it up
export function createShow({ scenes, holdS = 4, fadeS = 2.5, control = null }) {
  const S = scenes.length;
  const wrap = (k) => ((k % S) + S) % S;

  // Decide which two scenes and how much blend, at time t. Deterministic in AUTO (stable within
  // a frame because all pixels share one t); read from `control` in MANUAL / PIN.
  function resolve(t) {
    if (control?.mode === "manual") {
      return { a: wrap(control.a), b: wrap(control.b), x: Math.max(0, Math.min(1, control.fader)) };
    }
    if (control?.mode === "pin" && control.pin) {
      const { from, to, at } = control.pin;
      return { a: wrap(from), b: wrap(to), x: fadeS > 0 ? smoothstep((t - at) / fadeS) : 1 };
    }
    if (S < 2) return { a: 0, b: 0, x: 0 };
    const cycle = holdS + fadeS;
    const k = Math.floor(t / cycle);
    const tt = t - k * cycle;
    const a = k % S, b = (k + 1) % S;
    const x = tt < holdS ? 0 : smoothstep((tt - holdS) / fadeS);
    return { a, b, x };
  }

  // A frame-level renderer (the page's GPU backend, viewer/gpu.mjs): given the resolved decks, it
  // fills the whole frame at once and returns true — or false, and the hub renders per pixel.
  let frameRenderer = null;
  function setFrameRenderer(f) { frameRenderer = f; }
  // The combined shade function the hub renders.
  function shade(px, t, ctx) {
    const { a, b, x } = resolve(t);
    const ca = scenes[a].render(px, t, ctx);
    if (x <= 0) return ca;
    const cb = scenes[b].render(px, t, ctx);
    if (x >= 1) return cb;
    return [lerp(ca[0], cb[0], x), lerp(ca[1], cb[1], x), lerp(ca[2], cb[2], x)];
  }
  shade.frame = (out, t, ctx) => (frameRenderer ? frameRenderer(resolve(t), t, ctx, out) : false);

  // The scene the eye sees at t (the deck with the larger share of the blend).
  const current = (t) => { const r = resolve(t); return r.x < 0.5 ? r.a : r.b; };
  // Pin scene `which` (index or name) from time tNow on: fade in from what's showing now, then hold.
  function pin(which, tNow = 0) {
    if (!control) throw new Error("pin needs a control object");
    const to = typeof which === "number" ? which : scenes.findIndex((s) => s.name === which);
    if (!(to >= 0 && to < S)) throw new Error(`no scene "${which}" (have: ${scenes.map((s) => s.name).join(", ")})`);
    const from = current(tNow);
    control.pin = { from, to, at: tNow };
    control.mode = "pin";
    return to;
  }
  return { shade, resolve, current, pin, scenes, names: scenes.map((s) => s.name), setFrameRenderer };
}
