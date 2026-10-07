// The video sampler: a frame registry, PNG/PPM stills for the hub, bilinear sampling, the three
// mappings (uv / box / projector), the sampler pattern on the screen example, a raw-frame TCP
// stream, and the layout's `video:` block with its validation.
import net from "node:net";
import { deflateSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { createVideoRegistry, sampleFrame, decodePPM, makeMapping, sampler, resolveVideo } from "../src/video.mjs";
import { decodePNG, decodeImage } from "../src/io/png.mjs";
import { createVideoStream } from "../src/input/video-stream.mjs";
import { resolveLayout, collectFiles } from "../src/layout.mjs";
import { FIXTURES } from "../src/fixtures/index.mjs";
import { PATTERNS } from "../src/patterns.mjs";
import { parseYAML } from "../src/yaml.mjs";
import { createHub } from "../src/hub.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log("  ✓", m)) : (fail++, console.log("  ✗", m)));
const thrown = (f) => { try { f(); return ""; } catch (e) { return e.message; } };
const near = (a, b, eps = 0.02) => Math.abs(a - b) <= eps;

// ── registry ──
{
  const R = createVideoRegistry(); let seen = 0; R.onFrame(() => seen++);
  const f = R.set("a", { width: 2, height: 1, data: new Uint8Array([255, 0, 0, 0, 255, 0]) });
  ok(f.stride === 3 && R.get("a").frames === 1 && seen === 1 && R.names().join() === "a", "set/get a 2×1 RGB frame, stride inferred, listeners told");
  R.set("a", { width: 1, height: 1, data: new Uint8Array([1, 2, 3, 4]), stride: 4 });
  ok(R.get("a").frames === 2 && R.get("a").stride === 4 && R.status().a.frames === 2, "frames count up; RGBA stride kept");
  ok(/short/.test(thrown(() => R.set("b", { width: 4, height: 4, data: new Uint8Array(3) }))), "a short buffer is refused");
}

// ── sampling ──
{
  const f = { width: 2, height: 2, stride: 3, data: new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]) }; // R G / B W
  const s = (u, v, o = {}) => sampleFrame(f, u, v, o).map((x) => +x.toFixed(2));
  ok(s(0.25, 0.25, { filter: "nearest" }).join() === "1,0,0" && s(0.75, 0.75, { filter: "nearest" }).join() === "1,1,1", "nearest: texel centres");
  ok(s(0.5, 0.25).join() === "0.5,0.5,0" && s(0.5, 0.5).join() === "0.5,0.5,0.5", "bilinear: halfway between red and green; the centre is the mean of all four");
  ok(sampleFrame(f, 1.2, 0.5) === null && s(1.2, 0.25, { outside: "clamp" }).join() === "0,1,0" && s(1.25, 0.25, { outside: "repeat" }).join() === "1,0,0", "outside: black (null) / clamp / repeat");
}

// ── stills: PPM and PNG (every filter type) ──
{
  const ppm = new TextEncoder().encode("P6\n# a comment\n2 1\n255\n"); const px = new Uint8Array([10, 20, 30, 40, 50, 60]);
  const f = decodePPM(new Uint8Array([...ppm, ...px]));
  ok(f.width === 2 && f.height === 1 && f.data.join() === "10,20,30,40,50,60", "PPM P6 with a comment decodes");
  // build a 3×5 RGB PNG whose rows use filters 0..4, then decode it back
  const W = 3, H = 5, raw = []; const img = [];
  for (let y = 0; y < H; y++) { const row = []; for (let x = 0; x < W; x++) row.push((x * 60 + y * 30) & 255, (255 - x * 40) & 255, (y * 50) & 255); img.push(row); }
  const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < H; y++) { const ft = y % 5; raw.push(ft); for (let x = 0; x < W * 3; x++) { const v = img[y][x], a = x >= 3 ? img[y][x - 3] : 0, b = y > 0 ? img[y - 1][x] : 0, c = y > 0 && x >= 3 ? img[y - 1][x - 3] : 0; raw.push((ft === 0 ? v : ft === 1 ? v - a : ft === 2 ? v - b : ft === 3 ? v - ((a + b) >> 1) : v - paeth(a, b, c)) & 255); } }
  const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return (~c) >>> 0; };
  const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4); len.writeUInt32BE(data.length); const cc = Buffer.alloc(4); cc.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, cc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.from(raw))), chunk("IEND", Buffer.alloc(0))]);
  const d = decodePNG(png);
  ok(d.width === 3 && d.height === 5 && d.data.join() === img.flat().join(), "PNG: 8-bit RGB with None/Sub/Up/Average/Paeth rows decodes exactly");
  const poster = decodeImage("poster.png", readFileSync(new URL("../examples/mobius-heart/assets/poster.png", import.meta.url)), { decodePPM });
  const at = (x, y) => [poster.data[(y * poster.width + x) * 3], poster.data[(y * poster.width + x) * 3 + 1], poster.data[(y * poster.width + x) * 3 + 2]].join();
  ok(poster.width === 192 && poster.height === 108 && at(2, 2) === "255,0,0" && at(189, 2) === "0,255,0" && at(2, 105) === "0,0,255" && at(189, 105) === "255,180,0", "the example poster: 192×108 with its four corner keys");
  ok(/PNG and PPM/.test(thrown(() => decodeImage("x.jpg", new Uint8Array(4), { decodePPM }))), "a JPEG tells you to convert (the page decodes it itself)");
}

// ── mappings ──
{
  const uv = makeMapping({ map: "uv" }); ok(uv.uv({ s: 0.3, v: 0.9 }).join() === "0.3,0.9" && uv.needs.join() === "fixture", "uv: the fixture's s/v");
  const box = makeMapping({ map: "box", box: { pos: [0, 1500, -900], widthMM: 3200, heightMM: 1800 } });
  ok(box.needs.join() === "world" && box.uv({ p: [-1600, 2400, 0] }).join() === "0,0" && box.uv({ p: [1600, 600, -900] }).join() === "1,1" && box.uv({ p: [0, 1500, 500] }).join() === "0.5,0.5", "box: a wall-sized plane — corners and centre, depth ignored");
  const rot = makeMapping({ map: "box", box: { pos: [0, 0, 0], rotDeg: [0, 90, 0], widthMM: 1000, heightMM: 1000 } });
  ok(near(rot.uv({ p: [0, 0, 500] })[0], 0) && near(rot.uv({ p: [0, 0, -500] })[0], 1), "box: rotDeg turns the plane (90° about Y: u runs along −Z)");
  const pr = makeMapping({ map: "projector", projector: { pos: [0, 1400, 4500], target: [0, 1400, -900], fovDeg: 40, aspect: 1.78 } });
  const c = pr.uv({ p: [0, 1400, -900], n: [0, 0, 1] });
  ok(pr.needs.join() === "world" && near(c[0], 0.5) && near(c[1], 0.5), "projector: the target lands at the centre of the frame");
  ok(pr.uv({ p: [0, 1400, -900], n: [0, 0, -1] }) === null && pr.uv({ p: [0, 1400, 6000], n: [0, 0, 1] }) === null, "projector: a face turned away, and a point behind the lens, get nothing");
  const up = pr.uv({ p: [0, 2400, -900], n: [0, 0, 1] }); ok(up[1] < 0.5 && near(up[0], 0.5), "projector: higher in the world = up the image (v smaller)");
  ok(/uv \| box \| projector/.test(thrown(() => makeMapping({ map: "warp" }))) && /widthMM/.test(thrown(() => makeMapping({ map: "box", box: { widthMM: 0 } }))), "bad mappings are clear errors");
}

// ── the sampler pattern + the layout block ──
{
  const list = resolveVideo({ poster: { file: "../assets/poster.png" }, feed: { stream: true, width: 160, height: 90, port: 7001, fps: 25 }, cam: { camera: true }, desk: { display: true }, live: { url: "https://x/y.webm" } });
  ok(list.length === 5 && list[0].kind === "file" && list[1].kind === "stream" && list[1].port === 7001 && list[1].fps === 25 && list[2].kind === "camera" && list[3].kind === "display" && list[4].url === "https://x/y.webm", "video: five kinds resolve");
  ok(/width and height/.test(thrown(() => resolveVideo({ f: { stream: true } }))) && /give \{ file \}/.test(thrown(() => resolveVideo({ f: { nope: 1 } }))), "a stream needs its frame size; an unknown source kind is refused");
  ok(/needs a source/.test(thrown(() => sampler({}))), "a sampler needs a source");
  const doc = parseYAML(readFileSync(new URL("../examples/mobius-heart/layouts/screen.yaml", import.meta.url), "utf8"));
  ok(collectFiles(doc).includes("../assets/poster.png"), "collectFiles lists the poster (the page fetches it next to the layout)");
  const { scene, show } = resolveLayout(doc, { fixtures: FIXTURES, patterns: PATTERNS, baseDir: "examples/mobius-heart/layouts" });
  ok(scene.meta.video?.length === 1 && scene.meta.video[0].name === "poster" && show.scenes.length === 7 && show.warnings.length === 0, `the screen example: one video source, seven scenes, no warnings (${show.warnings.join(" | ") || "clean"})`);
  ok(/source "nope" is not in video:/.test(thrown(() => resolveLayout({ ...doc, show: { scenes: [{ pattern: "sampler", params: { source: "nope" } }] } }, { fixtures: FIXTURES, patterns: PATTERNS, baseDir: "examples/mobius-heart/layouts" }))), "a sampler naming a source the layout doesn't declare is refused at apply time");
  ok(/add a video: block/.test(thrown(() => resolveLayout({ ...doc, video: undefined, show: { scenes: [{ pattern: "sampler", params: { source: "poster" } }] } }, { fixtures: FIXTURES, patterns: PATTERNS, baseDir: "examples/mobius-heart/layouts" }))), "…and says to add a video: block when there is none");
  // render with the poster loaded into a registry, as the hub does
  const video = createVideoRegistry();
  const hub = createHub({ scene, shade: show.scenes[0].render, fps: 30, video });
  const k = scene.meta.instances.findIndex((i) => i.name === "wall"), first = scene.pixels.findIndex((p) => p.inst === k);
  const onWall = show.scenes.find((s) => /poster on the wall/.test(s.name)).render, asPlane = show.scenes.find((s) => /poster as a plane/.test(s.name)).render, projected = show.scenes.find((s) => /projected/.test(s.name)).render;
  const col = (c) => c.map((x) => +x.toFixed(2)).join();
  ok(col(onWall(scene.pixels[first], 0, hub.ctx)) === col(PATTERNS.solid({ value: 0.05 })(scene.pixels[first], 0, hub.ctx)), "before the still is loaded, the sampler layer leaves the base — a dark wall means no feed");
  video.set("poster", decodeImage("poster.png", readFileSync(new URL("../examples/mobius-heart/assets/poster.png", import.meta.url)), { decodePPM }));
  const TL = scene.pixels[first], TR = scene.pixels[first + 95], BL = scene.pixels[first + 53 * 96], BR = scene.pixels[first + 54 * 96 - 1];
  ok(col(onWall(TL, 0, hub.ctx)) === "1,0,0" && col(onWall(TR, 0, hub.ctx)) === "0,1,0" && col(onWall(BL, 0, hub.ctx)) === "0,0,1" && col(onWall(BR, 0, hub.ctx)) === "1,0.71,0", "map: uv — the wall's corner texels show the poster's corner keys (image orientation kept)");
  ok(col(onWall(scene.pixels[0], 0, hub.ctx)) === col(PATTERNS.solid({ value: 0.05 })(scene.pixels[0], 0, hub.ctx)), "…and a column pixel (not on the layer) stays on the base");
  ok([TL, TR, BL, BR].every((px) => col(asPlane(px, 0, hub.ctx)) === col(onWall(px, 0, hub.ctx))), "map: box — the plane placed exactly on the wall gives the same picture as map: uv, texel for texel");
  const colPx = scene.pixels.find((p) => p.inst === 0 && Math.abs(p.p[1] - 800) < 6 && p.n[2] > 0.9);
  const planeOnCol = asPlane(colPx, 0, hub.ctx), wallMid = asPlane(scene.pixels.find((p) => p.inst === k && Math.abs(p.p[1] - 800) < 20 && Math.abs(p.p[0] - colPx.p[0]) < 20), 0, hub.ctx);
  ok(colPx && planeOnCol.some((x) => x > 0) && planeOnCol.every((x, i) => Math.abs(x - wallMid[i]) < 0.06), `map: box — a column pixel in front of the wall samples the same picture as the wall texel behind it (${col(planeOnCol)} vs ${col(wallMid)})`);
  const front = projected(scene.pixels.find((p) => p.inst === k && Math.abs(p.p[0]) < 20 && Math.abs(p.p[1] - 1400) < 20), 0, hub.ctx);
  ok(front.some((x) => x > 0), `map: projector — the wall's centre is lit from the back of the room (${col(front)})`);
  const back = scene.pixels.find((p) => p.inst === 0 && p.n[2] < -0.9);
  ok(col(projected(back, 0, hub.ctx)) === "0,0,0", "map: projector — the far side of a column, facing away from the projector, is dark");
}

// ── a raw-frame stream over TCP ──
await new Promise((resolve) => {
  const video = createVideoRegistry();
  const st = createVideoStream({ name: "feed", width: 2, height: 1, port: 0, registry: video });
  const stream = createVideoStream({ name: "feed", width: 2, height: 1, port: 17431, registry: video });
  st.close();
  const sock = net.connect(17431, "127.0.0.1", () => {
    sock.write(Buffer.from([1, 2, 3, 4, 5])); // five bytes: not a whole frame yet
    setTimeout(() => {
      ok(video.get("feed") === null, "five bytes of a six-byte frame: nothing lands yet, the bytes wait");
      sock.write(Buffer.from([6, 7, 8, 9, 10, 11, 12])); // completes one frame, then a whole second one — the last wins
      setTimeout(() => {
        ok(video.get("feed")?.frames === 1 && video.get("feed").data.join() === "7,8,9,10,11,12", "frames slice across chunks; the latest complete frame is what the sampler sees");
        stream.feed(new Uint8Array([20, 21, 22, 23, 24, 25]));
        ok(video.get("feed").frames === 2 && video.get("feed").data.join() === "20,21,22,23,24,25" && stream.clients === 1, "the same stream also takes frames handed in (the bus path); one TCP sender counted");
        sock.end(); stream.close(); resolve();
      }, 60);
    }, 60);
  });
});

console.log(`\n${fail === 0 ? "✅" : "❌"} video: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
