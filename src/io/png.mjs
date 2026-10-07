// A minimal PNG decoder for the hub (Node: zlib is built in): 8-bit greyscale / RGB / grey+alpha /
// RGBA, non-interlaced — what `ffmpeg -i x.jpg x.png`, a paint program or the Blender render
// writes. Output is packed RGB. The page doesn't need this (an <img> decodes anything).
import { inflateSync } from "node:zlib";

export function decodePNG(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (b.length < 8 || sig.some((x, i) => b[i] !== x)) throw new Error("PNG: bad signature");
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let i = 8, width = 0, height = 0, depth = 0, ctype = 0, interlace = 0; const idat = [];
  while (i + 8 <= b.length) {
    const len = dv.getUint32(i), type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    const start = i + 8, chunk = b.subarray(start, start + len); i = start + len + 4; // data, then the crc
    if (type === "IHDR") { width = dv.getUint32(start); height = dv.getUint32(start + 4); depth = chunk[8]; ctype = chunk[9]; interlace = chunk[12]; }
    else if (type === "IDAT") idat.push(chunk);
    else if (type === "IEND") break;
  }
  if (!width || !height) throw new Error("PNG: no IHDR");
  if (depth !== 8) throw new Error(`PNG: ${depth}-bit — only 8-bit images (convert: ffmpeg -i in.png -pix_fmt rgb24 out.png)`);
  if (interlace) throw new Error("PNG: interlaced — save without Adam7");
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[ctype];
  if (!channels) throw new Error(`PNG: colour type ${ctype} (palette) — save as RGB`);
  const raw = inflateSync(Buffer.concat(idat.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength))));
  const bpp = channels, stride = width * bpp, out = new Uint8Array(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const ft = raw[pos++], row = y * stride, prev = row - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[row + x - bpp] : 0, up = y > 0 ? out[prev + x] : 0, c = y > 0 && x >= bpp ? out[prev + x - bpp] : 0, v = raw[pos++];
      let r;
      if (ft === 0) r = v; else if (ft === 1) r = v + a; else if (ft === 2) r = v + up; else if (ft === 3) r = v + ((a + up) >> 1);
      else if (ft === 4) { const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c); r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? up : c); }
      else throw new Error(`PNG: filter ${ft} at row ${y}`);
      out[row + x] = r & 255;
    }
  }
  if (channels === 3) return { width, height, data: out, stride: 3 };
  const rgb = new Uint8Array(width * height * 3);
  for (let p = 0, q = 0; p < out.length; p += channels, q += 3) { if (channels === 1 || channels === 2) rgb[q] = rgb[q + 1] = rgb[q + 2] = out[p]; else { rgb[q] = out[p]; rgb[q + 1] = out[p + 1]; rgb[q + 2] = out[p + 2]; } }
  return { width, height, data: rgb, stride: 3 };
}

// An image file for the hub by extension: PNG, PPM. (JPEG and the rest: the page decodes them; for
// the hub, `ffmpeg -i x.jpg x.png`.)
export function decodeImage(name, bytes, { decodePPM }) {
  if (/\.png$/i.test(name)) return decodePNG(bytes);
  if (/\.ppm$/i.test(name)) return decodePPM(bytes);
  throw new Error(`${name}: the hub reads PNG and PPM stills (ffmpeg -i ${name} ${name.replace(/\.[^.]+$/, "")}.png); videos reach it as a stream (video: { stream: true })`);
}
