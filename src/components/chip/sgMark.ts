/* The Seven Game Studio "SG" monogram, traced from public/images/chip/chip-design.png.
   It is built only from axis-aligned bars, so it is kept as rectangles on an 80 × 61 grid
   (x right, y down; the stroke is 8 units). The 2D chip icon draws them as one SVG path and the
   3D chip extrudes each one, so both always show exactly the same mark. */

export const SG_W = 80;
export const SG_H = 61;

/** [x0, y0, x1, y1]; the rectangles touch but never overlap */
export const SG_RECTS: ReadonlyArray<readonly [number, number, number, number]> = [
  // left glyph: a "2" over a reversed "C"
  [0, 0, 40, 8],
  [32, 8, 40, 13],
  [0, 13, 40, 21],
  [0, 21, 7, 25],
  [0, 25, 40, 33],
  [0, 38, 40, 46],
  [32, 46, 40, 53],
  [0, 53, 40, 61],
  // right glyph: the squared "G" spiral
  [43, 0, 80, 8],
  [43, 8, 51, 53],
  [43, 53, 80, 61],
  [72, 8, 80, 25],
  [59, 25, 80, 33],
  [59, 16, 66, 25],
  [59, 38, 80, 46],
  [72, 46, 80, 53],
];

/** The mark as an SVG path, `size` wide, centred on (cx, cy). */
export function sgPath(cx: number, cy: number, size: number) {
  const k = size / SG_W;
  const ox = cx - (SG_W * k) / 2;
  const oy = cy - (SG_H * k) / 2;
  const f = (n: number) => +n.toFixed(3);
  return SG_RECTS.map(([x0, y0, x1, y1]) => `M${f(ox + x0 * k)} ${f(oy + y0 * k)}H${f(ox + x1 * k)}V${f(oy + y1 * k)}H${f(ox + x0 * k)}Z`).join("");
}
