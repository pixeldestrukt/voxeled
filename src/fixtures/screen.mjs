// `screen` — a surface of TEXELS: an LED wall seen as an image, a projection surface, a monitor.
// It is a fixture like any other — placed with pos/rotDeg, lit by the same patterns and layers,
// one RGB triple per texel on the bus — so an LED piece and a video surface share one scene and
// one spatial field (docs/DESIGN.md, the field model). The viewer draws it as one continuous
// textured plane; viewer/screen.html shows it fullscreen for a projector or a monitor; a hub patch
// (Art-Net/DDP) drives it as a real LED wall.
//
//   { type: screen, params: { cols: 96, rows: 54, widthMM: 3200 } }   # heightMM follows the aspect
//
// Texels run row-major from the TOP-LEFT (image order), the surface centred on the instance's
// origin, every texel facing +Z. `s` runs 0→1 left→right and `v` 0→1 top→bottom — the `screen`
// space (SPACES in src/patterns.mjs): a pattern written against it sees the surface as an image.
// This is the JS path: every texel is rendered every frame like a pixel, so keep screens small
// (a 96×54 wall is 5,184 texels; the limit is 262,144). Large surfaces are the GPU backend's job.
export const MAX_TEXELS = 262144;

export function screenFixture({ cols = 64, rows = 36, widthMM = 1600, heightMM = null, emitter = null } = {}) {
  cols = Math.max(1, cols | 0); rows = Math.max(1, rows | 0);
  if (cols * rows > MAX_TEXELS) throw new Error(`screen: ${cols}×${rows} = ${(cols * rows).toLocaleString()} texels — the JS path renders every texel each frame; keep a screen under ${MAX_TEXELS.toLocaleString()} (a GPU backend is what makes big surfaces cheap)`);
  if (!(widthMM > 0)) throw new Error("screen: widthMM must be > 0");
  heightMM = heightMM > 0 ? heightMM : (widthMM * rows) / cols;
  const px = widthMM / cols, py = heightMM / rows; // texel pitch; the texel centre sits mid-cell
  const ox = -widthMM / 2 + px / 2, oy = heightMM / 2 - py / 2;
  const pixels = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++)
    pixels.push({ i: pixels.length, p: [+(ox + c * px).toFixed(3), +(oy - r * py).toFixed(3), 0], n: [0, 0, 1], s: cols > 1 ? +(c / (cols - 1)).toFixed(5) : 0, v: rows > 1 ? +(r / (rows - 1)).toFixed(5) : 0, strand: 0 });
  return {
    pixels,
    meta: {
      source: "screen", kind: "screen", pitchMM: Math.min(px, py), points: pixels.length, cols, rows, widthMM, heightMM, strands: 1,
      // a continuous diffuse surface: contiguous texels, no visible chip, wide view, modest glow
      emitter: { viewingAngleDeg: 170, sizeFrac: 1, coreFrac: 1, softness: 0, gain: 1.2, glow: 0.5, ...(emitter || {}) },
    },
  };
}
