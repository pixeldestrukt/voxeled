// Art-Net packets — parse ArtDmx / ArtSync / ArtPoll and build an ArtPollReply. Pure (no sockets),
// so a browser page can decode Art-Net relayed over a WebSocket; the UDP receiver is artnet.mjs.

const HEADER = [65, 114, 116, 45, 78, 101, 116, 0]; // "Art-Net\0"
const isArtNet = (b) => b.length >= 8 && HEADER.every((v, i) => b[i] === v);
const u16le = (b, o) => b[o] | (b[o + 1] << 8), u16be = (b, o) => (b[o] << 8) | b[o + 1];
export const OP_DMX = 0x5000, OP_POLL = 0x2000, OP_POLL_REPLY = 0x2100, OP_SYNC = 0x5200;

export function parseArtNet(msg) {
  if (msg.length < 12 || !isArtNet(msg)) return null;
  const op = u16le(msg, 8);
  if (op === OP_DMX) {
    if (msg.length < 18) return null;
    const universe = u16le(msg, 14) & 0x7fff, len = u16be(msg, 16);
    return { op, universe, seq: msg[12], data: msg.subarray(18, 18 + Math.min(len, msg.length - 18)) };
  }
  return { op };
}

// Every Art-Net packet in a buffer (a WebSocket relay may concatenate several).
export function* eachArtNet(buf) {
  let o = 0;
  while (o + 12 <= buf.length) {
    const p = parseArtNet(buf.subarray(o));
    if (!p) return;
    yield p;
    o += p.op === OP_DMX ? 18 + p.data.length + (p.data.length & 1) : buf.length; // only ArtDmx has a length to skip by
  }
}

export const ART_NET_HEADER = HEADER;
export { isArtNet };

// (Node only — Buffer)
export function artPollReply({ ip = [127, 0, 0, 1], port = 6454, shortName = "voxeled", longName = "voxeled hub", universes = 0 } = {}) {
  const b = Buffer.alloc(239);
  Buffer.from(HEADER).copy(b, 0); b.writeUInt16LE(OP_POLL_REPLY, 8);
  Buffer.from(ip).copy(b, 10); b.writeUInt16LE(port, 14);
  b[16] = 0; b[17] = 1;                                   // version
  b[26] = 0x70;                                           // ESTA manufacturer (unassigned)
  b.write(shortName.slice(0, 17), 26, "latin1"); b.write(longName.slice(0, 63), 44, "latin1");
  b.write(`#0001 [0000] voxeled: ${universes} universe(s) in`.slice(0, 63), 108, "latin1");
  b[172] = 0; b[173] = Math.min(4, universes) & 0xff;      // NumPorts
  for (let i = 0; i < Math.min(4, universes); i++) { b[174 + i] = 0x80; b[178 + i] = 0x80; }  // port type: output from Art-Net (DMX512), good input
  b[200] = 0x00;                                           // style: node
  return b;
}

