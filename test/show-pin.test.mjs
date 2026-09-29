// The show's pin mode (a page's pattern bar): pin(idx|name, tNow) crossfades from whatever was
// showing to the pinned scene over fadeS, then holds it; auto/manual still work; the Node hub's
// /control and the in-page hub's control() both take `scene=`.
import { createShow } from "../src/mixer.mjs";
let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log("  ✓", m)) : (fail++, console.log("  ✗", m)));
const scenes = [["red", [1, 0, 0]], ["green", [0, 1, 0]], ["blue", [0, 0, 1]]].map(([name, c]) => ({ name, render: () => c }));
const control = { mode: "auto", fader: 0, a: 0, b: 1 };
const show = createShow({ scenes, holdS: 4, fadeS: 2, control });
const px = { p: [0, 0, 0] };
ok(show.current(0) === 0 && show.current(6.5) === 1 && show.current(13) === 2, "auto: hold 4 s, fade 2 s → scene index advances with time");
ok(show.pin("blue", 1) === 2 && control.mode === "pin" && control.pin.from === 0 && control.pin.to === 2, "pin by name from t=1: from what was showing (red), to blue");
ok(show.shade(px, 1)[0] === 1 && show.shade(px, 1)[2] === 0, "at the pin instant the old scene shows");
const mid = show.shade(px, 2);
ok(mid[0] > 0.4 && mid[0] < 0.6 && mid[2] > 0.4 && mid[2] < 0.6, `halfway through the fade both show (${mid.map((x) => x.toFixed(2)).join(",")})`);
ok(show.shade(px, 3)[2] === 1 && show.shade(px, 100)[2] === 1 && show.current(100) === 2, "after fadeS the pinned scene holds — forever, no auto-advance");
ok(show.pin(1, 100) === 1 && control.pin.from === 2 && show.shade(px, 100)[2] === 1 && show.shade(px, 102)[1] === 1, "re-pin by index: fades from the currently pinned scene");
let err = ""; try { show.pin("nope", 0); } catch (e) { err = e.message; }
ok(/no scene "nope"/.test(err) && control.pin.to === 1, "an unknown scene throws and leaves the pin alone");
control.mode = "auto";
ok(show.current(0) === 0, "back to auto: the timeline rules again");
control.mode = "manual"; control.a = 2; control.b = 0; control.fader = 1;
ok(show.shade(px, 0)[0] === 1 && show.current(0) === 0, "manual: decks + fader as before");
console.log(`\n${fail === 0 ? "✅" : "❌"} show-pin: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
