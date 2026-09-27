// Art-Net receiver — voxeled as an Art-Net node. ArtDmx (0x5000) hands each universe's channels
// to onDmx; ArtSync (0x5200) → onSync (senders that sync frames across universes); ArtPoll
// (0x2000) gets an ArtPollReply so consoles and senders discover the hub as a node.
// Packet parsing lives in artnet-packet.mjs (pure); this module owns the UDP socket.
import dgram from "node:dgram";
import os from "node:os";
import { parseArtNet, artPollReply, OP_DMX, OP_POLL, OP_SYNC } from "./artnet-packet.mjs";
export * from "./artnet-packet.mjs";

export function createArtNetInput({ port = 6454, host = "0.0.0.0", onDmx, onSync, name = "voxeled" } = {}) {
  const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
  const stats = { packets: 0, universes: new Set(), lastAt: 0, polls: 0 };
  sock.on("message", (msg, rinfo) => {
    const p = parseArtNet(msg);
    if (!p) return;
    if (p.op === OP_DMX) { stats.packets++; stats.universes.add(p.universe); stats.lastAt = Date.now(); onDmx?.(p.universe, p.data, p.seq); }
    else if (p.op === OP_SYNC) onSync?.();
    else if (p.op === OP_POLL) {
      stats.polls++;
      const ip = (Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === "IPv4" && !i.internal)?.address || "127.0.0.1").split(".").map(Number);
      sock.send(artPollReply({ ip, port, shortName: name, universes: stats.universes.size }), rinfo.port, rinfo.address);
    }
  });
  sock.bind(port, host);
  return { sock, stats, url: `udp://${host}:${port}`, close: () => { try { sock.close(); } catch {} } };
}
