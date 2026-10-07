// A raw-frame video stream into the hub: width × height × 3 bytes per frame, back to back, over
// TCP — the VJ jack-in. Anything that can write rawvideo feeds it:
//   ffmpeg -re -stream_loop -1 -i clip.mp4 -vf scale=160:90 -f rawvideo -pix_fmt rgb24 tcp://hub:7001
//   ffmpeg -f v4l2 -i /dev/video0 -vf scale=160:90 -f rawvideo -pix_fmt rgb24 tcp://hub:7001
// (TouchDesigner / Resolume: a Spout/Syphon → ffmpeg bridge, or NDI → ffmpeg.) The same frames can
// arrive on the bus: send {"type":"video","name":"feed"} on a socket, then binary frames.
import net from "node:net";

export function createVideoStream({ name, width, height, port, registry, onStatus = null }) {
  const size = width * height * 3;
  let pending = Buffer.alloc(0), clients = 0;
  function feed(chunk) { // slice whatever arrives into whole frames; the last complete one wins
    pending = pending.length ? Buffer.concat([pending, chunk]) : Buffer.from(chunk);
    let last = null;
    while (pending.length >= size) { last = pending.subarray(0, size); pending = pending.subarray(size); }
    if (last) registry.set(name, { width, height, data: new Uint8Array(last), stride: 3 });
    if (pending.length > size * 4) pending = Buffer.alloc(0); // a wedged sender: drop, don't grow
  }
  const server = port ? net.createServer((sock) => {
    clients++; onStatus?.({ name, clients, from: sock.remoteAddress });
    sock.on("data", feed); sock.on("error", () => {}); sock.on("close", () => { clients--; onStatus?.({ name, clients }); });
  }) : null;
  server?.on("error", (e) => console.warn(`video "${name}": tcp ${port}: ${e.message}`));
  server?.listen(port);
  return { name, width, height, port, size, feed: (bytes) => feed(Buffer.from(bytes.buffer ? bytes : new Uint8Array(bytes))), get clients() { return clients; }, close: () => server?.close() };
}
