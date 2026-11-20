/* Procedural, per-pixel material textures for carrom: matte plywood, frame wood, coin faces.
   Everything here is generated ONCE (per theme / per sprite size) and cached by the caller, so
   the cost is a one-off ~tens of ms, never per frame. No image files to download. */

/** Seeded 2D value noise with smooth interpolation, wrapped on a 256 lattice. */
export function makeNoise(seed: number) {
  const perm = new Uint8Array(512);
  const vals = new Float32Array(256);
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = Math.imul(s ^ (s >>> 15), 2246822519) + 0x9e3779b9) >>> 0) / 4294967296;
  for (let i = 0; i < 256; i++) {
    perm[i] = i;
    vals[i] = rnd();
  }
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = perm[i];
    perm[i] = perm[j];
    perm[j] = t;
  }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const noise = (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const X = xi & 255;
    const Y = yi & 255;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = vals[perm[perm[X] + Y]];
    const b = vals[perm[perm[X + 1] + Y]];
    const c = vals[perm[perm[X] + Y + 1]];
    const d = vals[perm[perm[X + 1] + Y + 1]];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const fbm = (x: number, y: number, oct = 3) => {
    let sum = 0;
    let amp = 0.5;
    let f = 1;
    let norm = 0;
    for (let o = 0; o < oct; o++) {
      sum += noise(x * f, y * f) * amp;
      norm += amp;
      amp *= 0.5;
      f *= 2.03;
    }
    return sum / norm;
  };
  return { noise, fbm };
}

export function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export type WoodOpts = {
  /** light (early wood) and dark (late wood / grain) colours */
  light: [string, string];
  dark: string;
  seed: number;
  /** growth bands across the texture (more = tighter figure) */
  rings?: number;
  /** how strongly the grain lines show (0..1) */
  contrast?: number;
  /** grain runs along x (true) or y */
  horizontal?: boolean;
};

/**
 * Matte wood: soft growth bands warped by low-frequency noise, long fine fibres, faint pores and
 * a gentle colour drift. Diffuse only — no sheen — so it reads like sanded, powdered plywood.
 */
export function woodCanvas(w: number, h: number, o: WoodOpts) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  const img = g.createImageData(w, h);
  const d = img.data;
  const { noise, fbm } = makeNoise(o.seed);
  const [l0, l1] = [hexRgb(o.light[0]), hexRgb(o.light[1])];
  const dk = hexRgb(o.dark);
  const rings = o.rings ?? 9;
  const k = o.contrast ?? 1;
  const horiz = o.horizontal !== false;
  let i = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // along = direction of the grain, across = perpendicular (both 0..1)
      const along = horiz ? x / w : y / h;
      const across = horiz ? y / h : x / w;
      const warp = fbm(along * 1.1, across * 2.2) * 0.9 + fbm(along * 5, across * 9, 2) * 0.18;
      const t = across * rings + warp;
      const band = Math.pow(Math.abs(Math.sin(t * Math.PI)), 6); // thin dark late-wood lines
      const soft = 0.5 + 0.5 * Math.sin(t * Math.PI * 2); // broad early/late wood shading
      const fibre = noise(along * 9, across * 520) - 0.5; // long fine streaks
      const fibre2 = noise(along * 30, across * 1400) - 0.5;
      const pore = noise(along * 260, across * 900);
      const drift = fbm(along * 2.2 + 7, across * 2.2 + 3, 2); // blotchy colour variation
      let dark = band * 0.2 + soft * 0.035 + fibre * 0.15 + fibre2 * 0.08 + (pore > 0.86 ? (pore - 0.86) * 1.6 : 0);
      dark = Math.max(0, Math.min(1, dark * k));
      const m = drift; // mix between the two light tones
      const r = l0[0] + (l1[0] - l0[0]) * m;
      const gg = l0[1] + (l1[1] - l0[1]) * m;
      const b = l0[2] + (l1[2] - l0[2]) * m;
      d[i++] = r + (dk[0] - r) * dark;
      d[i++] = gg + (dk[1] - gg) * dark;
      d[i++] = b + (dk[2] - b) * dark;
      d[i++] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/**
 * Adds fine per-pixel texture to an already painted sprite (inside its alpha): `amount` of
 * luminance noise, plus optional straight wood grain along x. Matte: never brightens past +amount.
 */
export function grainify(c: HTMLCanvasElement, seed: number, amount: number, wood = 0) {
  const g = c.getContext("2d")!;
  const w = c.width;
  const h = c.height;
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  const { noise, fbm } = makeNoise(seed);
  let i = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i += 4) {
      if (d[i + 3] < 250) continue; // leave the anti-aliased edge clean
      const u = x / w;
      const v = y / h;
      let f = (noise(x * 0.9, y * 0.9) - 0.5) * amount;
      if (wood) {
        const t = v * 7 + fbm(u * 1.5, v * 3) * 1.6;
        const band = Math.pow(Math.abs(Math.sin(t * Math.PI)), 5);
        f -= (band * 0.22 + (noise(u * 6, v * 90) - 0.5) * 0.12) * wood;
      }
      const m = 1 + f;
      d[i] = Math.min(255, d[i] * m);
      d[i + 1] = Math.min(255, d[i + 1] * m);
      d[i + 2] = Math.min(255, d[i + 2] * m);
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}
