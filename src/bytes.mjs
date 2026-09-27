// Byte helpers so the importers read Uint8Arrays the same way in Node and in a browser (no Buffer).
export const u8 = (x) => (x instanceof Uint8Array ? x : x instanceof ArrayBuffer ? new Uint8Array(x) : new Uint8Array(x.buffer ?? x));
export const view = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const decoders = {};
export const decode = (b, enc = "utf-8", start = 0, end = b.length) => (decoders[enc] ||= new TextDecoder(enc)).decode(b.subarray(start, end));
