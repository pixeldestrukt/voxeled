// `matrix` — a flat grid of LEDs: the 8×8 / 16×16 / 8×32 panels, a strip laid in rows, a wall of
// pixels. Columns run along +X, rows up +Y, every LED facing +Z (place and rotate the instance to
// hang it). Data order is the panel's wiring: `wiring: rows` snakes along rows (row 0 left→right,
// row 1 right→left …), `wiring: columns` snakes along columns (how most flexible 8×32 panels are
// built — each column of 8, alternating up/down); `serpentine: false` for straight runs;
// `start` names the corner pixel 0 is in. `center: true` puts the origin at the panel's centre.
//
//   { type: matrix, params: { cols: 32, rows: 8, pitchMM: 10, wiring: columns, start: top-left } }
export function matrixFixture({ cols = 8, rows = 8, pitchMM = 10, colPitchMM, rowPitchMM, wiring = "rows", serpentine = true, start = "bottom-left", center = false } = {}) {
  const px = colPitchMM ?? pitchMM, py = rowPitchMM ?? pitchMM;
  if (!["rows", "columns"].includes(wiring)) throw new Error(`matrix wiring must be rows | columns (got "${wiring}")`);
  if (!/^(top|bottom)-(left|right)$/.test(start)) throw new Error(`matrix start must be top-left | top-right | bottom-left | bottom-right (got "${start}")`);
  const fromTop = start.startsWith("top"), fromRight = start.endsWith("right");
  const ox = center ? -((cols - 1) * px) / 2 : 0, oy = center ? -((rows - 1) * py) / 2 : 0;
  const pixels = [];
  const put = (c, r) => pixels.push({ i: pixels.length, p: [+(ox + c * px).toFixed(3), +(oy + r * py).toFixed(3), 0], n: [0, 0, 1], s: 0, v: rows > 1 ? +(r / (rows - 1)).toFixed(5) : 0, strand: 0 });
  // walk in wiring order from the start corner; serpentine alternates the inner direction
  const cIdx = (k) => (fromRight ? cols - 1 - k : k), rIdx = (k) => (fromTop ? rows - 1 - k : k);
  if (wiring === "rows") for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) put(cIdx(serpentine && r % 2 ? cols - 1 - k : k), rIdx(r));
  else for (let c = 0; c < cols; c++) for (let k = 0; k < rows; k++) put(cIdx(c), rIdx(serpentine && c % 2 ? rows - 1 - k : k));
  const n = pixels.length;
  pixels.forEach((p, i) => (p.s = n > 1 ? +(i / (n - 1)).toFixed(5) : 0)); // s follows the data order
  return {
    pixels,
    meta: {
      source: "matrix", pitchMM: Math.min(px, py), points: n, cols, rows, wiring, serpentine, start, widthMM: (cols - 1) * px, heightMM: (rows - 1) * py, strands: 1,
      emitter: { viewingAngleDeg: 120, sizeFrac: 0.5, coreFrac: 0.6, softness: 0.4, gain: 1.6, glow: 1.0 }, // bare 5050s on a board
    },
  };
}
