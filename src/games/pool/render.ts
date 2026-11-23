/* Drawing the pool table on a canvas.

   - The table (wood rails with sights, cushions, cloth, pockets) is drawn once into an
     offscreen layer and reused every frame.
   - Balls are real spheres: every pixel is shaded (lamp light, gloss highlight, cloth
     reflection on the rim) and looked up on the ball's own surface — so stripes and numbers
     roll with the ball (each ball keeps a 3-D orientation, turned by its spin as it moves).
   - On narrow screens the table stands upright (head rail at the bottom).
   World coordinates are the engine's (cloth 0..L × 0..W). */
import { CUSHIONS, HEAD_X, L, POCKETS, R, STRIDE, W, type Ball, type SimEvent, type SimResult, type Vec } from "./engine";
import { poolCueOf, poolTableOf, type PoolCue, type PoolTableTheme } from "../../lib/shopCatalog";

/* ---------------- looks ---------------- */
/* Looks come from the shop: table themes (POOL_TABLES) and cues (POOL_CUES). */

const BALL_RGB: Record<number, [number, number, number]> = {
  0: [247, 243, 232],
  1: [246, 190, 0],
  2: [24, 74, 186],
  3: [208, 34, 28],
  4: [86, 40, 134],
  5: [240, 104, 26],
  6: [14, 120, 62],
  7: [124, 30, 32],
  8: [22, 22, 24],
};
export const ballCss = (id: number) => {
  const [r, g, b] = BALL_RGB[id === 0 ? 0 : id === 8 ? 8 : ((id - 1) % 8) + 1] ?? BALL_RGB[0];
  return `rgb(${r},${g},${b})`;
};

const CUSH = 38; // cushion rubber width
/** cushion + rail around the cloth: slim on phones (more cloth on screen), fuller on big screens */
export const frameFor = (compact: boolean) => (compact ? 70 : 112);
const CUE_LEN = 1150;

/* ---------------- tiny 3×3 rotation helpers ---------------- */
type Mat = Float64Array; // row-major, local → world
function randomMat(): Mat {
  // random rotation: random axis + angle
  const m = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  rotate(m, Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5, Math.random() * Math.PI * 2);
  return m;
}
/** m ← Rot(axis, angle) · m */
function rotate(m: Mat, ax: number, ay: number, az: number, angle: number) {
  const len = Math.hypot(ax, ay, az);
  if (len < 1e-9 || angle === 0) return;
  const x = ax / len;
  const y = ay / len;
  const z = az / len;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  const r00 = t * x * x + c, r01 = t * x * y - s * z, r02 = t * x * z + s * y;
  const r10 = t * x * y + s * z, r11 = t * y * y + c, r12 = t * y * z - s * x;
  const r20 = t * x * z - s * y, r21 = t * y * z + s * x, r22 = t * z * z + c;
  for (let col = 0; col < 3; col++) {
    const a = m[col];
    const b = m[3 + col];
    const d = m[6 + col];
    m[col] = r00 * a + r01 * b + r02 * d;
    m[3 + col] = r10 * a + r11 * b + r12 * d;
    m[6 + col] = r20 * a + r21 * b + r22 * d;
  }
}
function orthonormalize(m: Mat) {
  // columns are the local axes in world space
  let ax = m[0], ay = m[3], az = m[6];
  let l = Math.hypot(ax, ay, az);
  ax /= l; ay /= l; az /= l;
  let bx = m[1], by = m[4], bz = m[7];
  const d = ax * bx + ay * by + az * bz;
  bx -= d * ax; by -= d * ay; bz -= d * az;
  l = Math.hypot(bx, by, bz);
  bx /= l; by /= l; bz /= l;
  const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
  m.set([ax, bx, cx, ay, by, cy, az, bz, cz]);
}

/* ---------------- number glyphs ---------------- */
const GLYPH = 64;
const glyphs = new Map<number, Uint8ClampedArray>();
function glyphOf(id: number) {
  let g = glyphs.get(id);
  if (g) return g;
  const c = document.createElement("canvas");
  c.width = c.height = GLYPH;
  const x = c.getContext("2d")!;
  x.fillStyle = "#000";
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.font = `800 ${id >= 10 ? 38 : 46}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  x.fillText(String(id), GLYPH / 2, GLYPH / 2 + 2);
  if (id === 6 || id === 9) {
    // underline 6 and 9 like real balls
    x.fillRect(GLYPH / 2 - 9, GLYPH / 2 + 20, 18, 3);
  }
  const data = x.getImageData(0, 0, GLYPH, GLYPH).data;
  g = new Uint8ClampedArray(GLYPH * GLYPH);
  for (let i = 0; i < g.length; i++) g[i] = data[i * 4 + 3];
  glyphs.set(id, g);
  return g;
}

/* ---------------- one ball, shaded per pixel ---------------- */
const SPOT_COS = Math.cos(0.5);
const SPOT_TAN = Math.tan(0.5);
const STRIPE = 0.56; // |z| above this is white on a striped ball
// light toward the upper left, in screen space (z toward the viewer is negative)
const LX = -0.42, LY = -0.55, LZ = -0.72;
const LN = Math.hypot(LX, LY, LZ);
const Lx = LX / LN, Ly = LY / LN, Lz = LZ / LN;
const HX0 = Lx, HY0 = Ly, HZ0 = Lz - 1;
const HN = Math.hypot(HX0, HY0, HZ0);
const Hx = HX0 / HN, Hy = HY0 / HN, Hz = HZ0 / HN;

function paintBall(img: ImageData, id: number, m: Mat, portrait: boolean, cloth: [number, number, number]) {
  const size = img.width;
  const c = size / 2;
  const rp = c - 1;
  const d = img.data;
  const base = BALL_RGB[id === 0 ? 0 : id === 8 ? 8 : ((id - 1) % 8) + 1];
  const striped = id > 8;
  const glyph = id === 0 ? null : glyphOf(id);
  for (let j = 0; j < size; j++) {
    const sy = (j + 0.5 - c) / rp;
    for (let i = 0; i < size; i++) {
      const sx = (i + 0.5 - c) / rp;
      const r2 = sx * sx + sy * sy;
      const o = (j * size + i) * 4;
      if (r2 >= 1.04) {
        d[o + 3] = 0;
        continue;
      }
      const rr = Math.sqrt(r2);
      const alpha = Math.max(0, Math.min(1, (1 - rr) * rp + 0.5));
      const nz = -Math.sqrt(Math.max(0, 1 - Math.min(1, r2)));
      // world normal (portrait: screen x = world y, screen y = −world x)
      const wx = portrait ? -sy : sx;
      const wy = portrait ? sx : sy;
      // local = Mᵀ · world
      const lx = m[0] * wx + m[3] * wy + m[6] * nz;
      const ly = m[1] * wx + m[4] * wy + m[7] * nz;
      const lz = m[2] * wx + m[5] * wy + m[8] * nz;
      let cr = base[0], cg = base[1], cb = base[2];
      if (striped && (lz > STRIPE || lz < -STRIPE)) {
        cr = 246; cg = 242; cb = 232;
      }
      if (glyph) {
        const ax = lx > 0 ? lx : -lx;
        if (ax > SPOT_COS) {
          // the white number disc (both sides)
          const sgn = lx > 0 ? 1 : -1;
          const u = ((sgn * ly) / ax / SPOT_TAN + 1) * 0.5;
          // seen from outside the spot: right is ±y, up is +z (image rows run down)
          const v = ((-lz / ax) / SPOT_TAN + 1) * 0.5;
          cr = 246; cg = 242; cb = 232;
          const gx = Math.min(GLYPH - 1, Math.max(0, (u * GLYPH) | 0));
          const gy = Math.min(GLYPH - 1, Math.max(0, (v * GLYPH) | 0));
          const ink = glyph[gy * GLYPH + gx] / 255;
          if (ink > 0) {
            cr = cr * (1 - ink) + 20 * ink;
            cg = cg * (1 - ink) + 20 * ink;
            cb = cb * (1 - ink) + 22 * ink;
          }
        }
      } else {
        // cue ball: two small red dots so you can see it spin
        const ax = lx > 0 ? lx : -lx;
        if (ax > 0.985) {
          cr = 196; cg = 40; cb = 40;
        }
      }
      // shading
      const ndl = sx * Lx + sy * Ly + nz * Lz;
      const diff = ndl > 0 ? ndl : 0;
      const ndh = sx * Hx + sy * Hy + nz * Hz;
      const h = ndh > 0 ? ndh : 0;
      const h2 = h * h, h4 = h2 * h2, h8 = h4 * h4, h16 = h8 * h8, h32 = h16 * h16;
      const spec = h32 * h16 * 0.95 + h8 * 0.1;
      const shade = 0.34 + 0.76 * diff;
      // cloth colour reflected on the lower rim
      const rim = r2 > 0.55 ? (r2 - 0.55) * 0.5 * (sy > -0.2 ? 1 : 0.4) : 0;
      cr = cr * shade * (1 - rim) + cloth[0] * rim + spec * 255;
      cg = cg * shade * (1 - rim) + cloth[1] * rim + spec * 255;
      cb = cb * shade * (1 - rim) + cloth[2] * rim + spec * 255;
      d[o] = cr > 255 ? 255 : cr;
      d[o + 1] = cg > 255 ? 255 : cg;
      d[o + 2] = cb > 255 ? 255 : cb;
      d[o + 3] = alpha * 255;
    }
  }
}

const hexRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/* ---------------- seeded random for the wood grain ---------------- */
function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------- the view ---------------- */
export type AimDraw = {
  /** draw the cue and guide */
  show: boolean;
  dir: Vec;
  /** 0..1 pull-back */
  power: number;
  /** show the aiming guide (ghost ball + lines) */
  guide: boolean;
  /** legal first balls (the ghost turns red on others) */
  legal: number[];
  /** how far the object ball's line reaches (the cue's aim stat) */
  reach: number;
  /** also show the cue ball's path after the hit, bent by follow / draw */
  cuePath: boolean;
  /** −1 draw … +1 follow, as the shot will be played */
  follow: number;
};

type Playback = {
  sim: SimResult;
  start: number;
  lastFrame: number;
  lastT: number;
  onEvent: (e: SimEvent) => void;
  onDone: () => void;
};

export class PoolView {
  private ctx: CanvasRenderingContext2D;
  private layer: HTMLCanvasElement | null = null;
  private k = 1; // device px per unit
  private dpr = 1;
  portrait = false;
  private table: PoolTableTheme = poolTableOf(null);
  private cue: PoolCue = poolCueOf(null);
  /** cushion + rail width (table units) */
  private F = frameFor(false);
  private balls: Ball[] = [];
  private mats: Mat[] = Array.from({ length: 16 }, randomMat);
  private sprites: Array<{ c: HTMLCanvasElement; img: ImageData; dirty: boolean }> = [];
  private spriteSize = 0;
  private play: Playback | null = null;
  private raf = 0;
  aim: AimDraw = { show: false, dir: { x: 1, y: 0 }, power: 0, guide: true, legal: [], reach: 110, cuePath: false, follow: 0 };
  /** ball in hand: highlight the cue ball (and the kitchen) */
  inHand: null | "kitchen" | "anywhere" = null;
  /** placing the cue ball: is the spot allowed */
  placeBad = false;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    const loop = (now: number) => {
      this.draw(now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
  }

  get playing() {
    return this.play !== null;
  }

  /** CSS size of the canvas for a given available width/height. */
  static fit(maxW: number, maxH: number, portrait: boolean, compact = portrait) {
    const F = frameFor(compact);
    const ow = (portrait ? W : L) + 2 * F;
    const oh = (portrait ? L : W) + 2 * F;
    const s = Math.min(maxW / ow, maxH / oh);
    return { w: Math.floor(ow * s), h: Math.floor(oh * s) };
  }

  resize(cssW: number, cssH: number, portrait: boolean, compact = portrait) {
    this.F = frameFor(compact);
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    this.dpr = dpr;
    this.portrait = portrait;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    const ow = (portrait ? W : L) + 2 * this.F;
    this.k = this.canvas.width / ow;
    this.layer = null;
    this.spriteSize = 0;
  }

  /** the cue's look */
  setCue(c: PoolCue) {
    this.cue = c;
  }

  setTable(t: PoolTableTheme) {
    if (t === this.table) return;
    this.table = t;
    this.layer = null;
    this.sprites.forEach((s) => (s.dirty = true));
  }

  setBalls(balls: Ball[]) {
    this.balls = balls.map((b) => ({ ...b }));
  }

  /** Animate a simulated shot; calls onEvent for sounds, onDone at the end. */
  playSim(sim: SimResult, onEvent: (e: SimEvent) => void, onDone: () => void) {
    this.play = { sim, start: performance.now(), lastFrame: 0, lastT: -1, onEvent, onDone };
  }

  /** Drop an animation without finishing it (a new rack). */
  cancelPlayback() {
    this.play = null;
  }

  /** Jump an animation to its end. */
  finishPlayback() {
    const p = this.play;
    if (!p) return;
    this.play = null;
    this.balls = p.sim.final.map((b) => ({ ...b }));
    p.onDone();
  }

  /* ----- coordinates ----- */
  private tx(x: number, y: number): Vec {
    const k = this.k;
    const F = this.F;
    return this.portrait ? { x: (y + F) * k, y: (L - x + F) * k } : { x: (x + F) * k, y: (y + F) * k };
  }

  /** CSS pixel (relative to the canvas) → table units. */
  toWorld(cx: number, cy: number): Vec {
    const px = (cx * this.dpr) / this.k;
    const py = (cy * this.dpr) / this.k;
    const F = this.F;
    return this.portrait ? { x: L + F - py, y: px - F } : { x: px - F, y: py - F };
  }

  /** a screen-space offset (device px) as a world vector */
  private screenVec(dx: number, dy: number): Vec {
    return this.portrait ? { x: -dy / this.k, y: dx / this.k } : { x: dx / this.k, y: dy / this.k };
  }

  private worldTransform(c: CanvasRenderingContext2D) {
    const k = this.k;
    const F = this.F;
    if (this.portrait) c.setTransform(0, -k, k, 0, F * k, (L + F) * k);
    else c.setTransform(k, 0, 0, k, F * k, F * k);
  }

  /* ----- the table layer ----- */
  private buildLayer() {
    const cv = document.createElement("canvas");
    cv.width = this.canvas.width;
    cv.height = this.canvas.height;
    const c = cv.getContext("2d")!;
    this.worldTransform(c);
    const look = this.table;
    const FRAME = this.F;
    const WOOD = FRAME - CUSH;
    const rr = Math.min(46, FRAME * 0.45);
    const rnd = mulberry(7);

    // the rails
    const fx = -FRAME, fy = -FRAME, fw = L + 2 * FRAME, fh = W + 2 * FRAME;
    const wood = c.createLinearGradient(0, fy, 0, fy + fh);
    wood.addColorStop(0, look.rail[0]);
    wood.addColorStop(0.5, look.rail[1]);
    wood.addColorStop(1, look.rail[2]);
    c.fillStyle = wood;
    roundRect(c, fx, fy, fw, fh, rr);
    c.fill();
    // grain
    c.save();
    roundRect(c, fx, fy, fw, fh, rr);
    c.clip();
    for (let i = 0; i < (look.grain ? 140 : 0); i++) {
      const y = fy + rnd() * fh;
      c.strokeStyle = rnd() < 0.5 ? `rgba(30,12,4,${0.08 + rnd() * 0.12})` : `rgba(160,90,45,${0.05 + rnd() * 0.08})`;
      c.lineWidth = 0.8 + rnd() * 2.2;
      c.beginPath();
      c.moveTo(fx, y);
      const amp = 2 + rnd() * 6;
      for (let x = fx; x <= fx + fw; x += 60) c.lineTo(x, y + Math.sin(x * 0.004 + i) * amp);
      c.stroke();
    }
    // lacquer sheen + bevel
    const sheen = c.createLinearGradient(fx, fy, fx, fy + 90);
    sheen.addColorStop(0, "rgba(255,220,180,0.22)");
    sheen.addColorStop(1, "rgba(255,220,180,0)");
    c.fillStyle = sheen;
    c.fillRect(fx, fy, fw, 90);
    c.restore();
    c.lineWidth = 5;
    c.strokeStyle = "rgba(0,0,0,0.45)";
    roundRect(c, fx + 2.5, fy + 2.5, fw - 5, fh - 5, rr - 2);
    c.stroke();
    c.lineWidth = 2.5;
    c.strokeStyle = "rgba(255,230,200,0.2)";
    roundRect(c, fx + 7, fy + 7, fw - 14, fh - 14, Math.max(4, rr - 6));
    c.stroke();

    // metal caps over the rails at every pocket (kept inside the table's outline)
    c.save();
    roundRect(c, fx, fy, fw, fh, rr);
    c.clip();
    POCKETS.forEach((p) => {
      const cr = (p.side ? 1.78 * R : 2.05 * R) + Math.min(30, WOOD * 0.62);
      const g = c.createRadialGradient(p.x - cr * 0.3, p.y - cr * 0.3, cr * 0.1, p.x, p.y, cr);
      g.addColorStop(0, look.metal[0]);
      g.addColorStop(0.7, shadeHex(look.metal[0], 0.85));
      g.addColorStop(1, look.metal[1]);
      c.fillStyle = g;
      c.beginPath();
      c.arc(p.x, p.y, cr, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = "rgba(0,0,0,0.35)";
      c.lineWidth = 2;
      c.stroke();
    });
    c.restore();

    // sights (mother-of-pearl diamonds)
    const sightOff = CUSH + WOOD * 0.5;
    const sz = Math.min(1, WOOD / 60);
    const sight = (x: number, y: number) => {
      const g = c.createRadialGradient(x - 3, y - 3, 1, x, y, 12 * sz);
      g.addColorStop(0, "#ffffff");
      g.addColorStop(0.6, look.sight);
      g.addColorStop(1, shadeHex(look.sight, 0.75));
      c.fillStyle = g;
      c.beginPath();
      c.moveTo(x, y - 11 * sz);
      c.lineTo(x + 7 * sz, y);
      c.lineTo(x, y + 11 * sz);
      c.lineTo(x - 7 * sz, y);
      c.closePath();
      c.fill();
    };
    for (let i = 1; i < 8; i++) {
      if (i === 4) continue;
      sight((L * i) / 8, -sightOff);
      sight((L * i) / 8, W + sightOff);
    }
    for (let i = 1; i < 4; i++) {
      sight(-sightOff, (W * i) / 4);
      sight(L + sightOff, (W * i) / 4);
    }

    // cloth (reaches under the cushions and into the pocket mouths)
    const cloth = c.createRadialGradient(L / 2, W / 2, 40, L / 2, W / 2, L * 0.62);
    cloth.addColorStop(0, shadeHex(look.cloth, 1.1));
    cloth.addColorStop(0.7, look.cloth);
    cloth.addColorStop(1, look.clothDark);
    c.fillStyle = cloth;
    c.fillRect(-CUSH, -CUSH, L + 2 * CUSH, W + 2 * CUSH);
    // felt nap: fine speckle
    for (let i = 0; i < 5000; i++) {
      c.fillStyle = rnd() < 0.5 ? "rgba(0,0,0,0.05)" : "rgba(255,255,255,0.035)";
      c.fillRect(rnd() * L, rnd() * W, 2 + rnd() * 3, 1.5);
    }
    // spots: foot spot and head spot
    c.fillStyle = "rgba(255,255,255,0.35)";
    c.beginPath();
    c.arc(L * 0.75, W / 2, 5, 0, Math.PI * 2);
    c.arc(HEAD_X, W / 2, 4, 0, Math.PI * 2);
    c.fill();

    // pockets: liner, hole
    POCKETS.forEach((p) => {
      const hr = p.side ? 1.78 * R : 2.05 * R;
      c.fillStyle = look.liner;
      c.beginPath();
      c.arc(p.x, p.y, hr + 9, 0, Math.PI * 2);
      c.fill();
      const lg = c.createRadialGradient(p.x, p.y, hr * 0.2, p.x, p.y, hr);
      lg.addColorStop(0, "#000");
      lg.addColorStop(0.75, "#050505");
      lg.addColorStop(1, "#262626");
      c.fillStyle = lg;
      c.beginPath();
      c.arc(p.x, p.y, hr, 0, Math.PI * 2);
      c.fill();
    });

    // cushions: one polygon per rail section, between the jaw lines
    for (const poly of cushionPolys()) {
      c.beginPath();
      poly.forEach((pt, i) => (i ? c.lineTo(pt.x, pt.y) : c.moveTo(pt.x, pt.y)));
      c.closePath();
      c.fillStyle = look.cushion;
      c.fill();
    }
    // cushion nose light + shadow cast on the cloth
    c.save();
    c.beginPath();
    c.rect(0, 0, L, W);
    c.clip();
    const edge = 26;
    const sides: Array<[number, number, number, number, number, number]> = [
      [0, 0, L, edge, 0, 1],
      [0, W - edge, L, edge, 0, -1],
      [0, 0, edge, W, 1, 0],
      [L - edge, 0, edge, W, -1, 0],
    ];
    for (const [x, y, w, h, nx, ny] of sides) {
      const g = c.createLinearGradient(nx > 0 ? 0 : nx < 0 ? L : 0, ny > 0 ? 0 : ny < 0 ? W : 0, nx > 0 ? edge : nx < 0 ? L - edge : 0, ny > 0 ? edge : ny < 0 ? W - edge : 0);
      g.addColorStop(0, "rgba(0,0,0,0.32)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = g;
      c.fillRect(x, y, w, h);
    }
    c.restore();
    c.strokeStyle = "rgba(255,255,255,0.12)";
    c.lineWidth = 2.5;
    for (const sg of CUSHIONS) {
      c.beginPath();
      c.moveTo(sg.ax, sg.ay);
      c.lineTo(sg.bx, sg.by);
      c.stroke();
    }
    // overhead lamp
    c.setTransform(1, 0, 0, 1, 0, 0);
    const lw = cv.width, lh = cv.height;
    const lamp = c.createRadialGradient(lw / 2, lh / 2, 0, lw / 2, lh / 2, Math.max(lw, lh) * 0.7);
    lamp.addColorStop(0, "rgba(255,248,225,0.10)");
    lamp.addColorStop(0.6, "rgba(255,248,225,0)");
    lamp.addColorStop(1, "rgba(0,0,0,0.25)");
    c.fillStyle = lamp;
    c.fillRect(0, 0, lw, lh);
    this.layer = cv;
  }

  /* ----- frame ----- */
  private ballSprite(i: number, id: number) {
    const size = Math.max(8, Math.ceil(2 * R * this.k) + 2);
    if (this.spriteSize !== size) {
      this.spriteSize = size;
      this.sprites = [];
    }
    let s = this.sprites[i];
    if (!s) {
      const c = document.createElement("canvas");
      c.width = c.height = size;
      s = { c, img: new ImageData(size, size), dirty: true };
      this.sprites[i] = s;
    }
    if (s.dirty) {
      paintBall(s.img, id, this.mats[i], this.portrait, hexRgb(this.table.cloth));
      s.c.getContext("2d")!.putImageData(s.img, 0, 0);
      s.dirty = false;
    }
    return s.c;
  }

  private spin(i: number, ux: number, uy: number, s: number, dt: number) {
    // rolling: ω = (u_y, −u_x, s) / R   (x right, y down, z into the table)
    const wx = uy / R;
    const wy = -ux / R;
    const wz = s / R;
    const w = Math.hypot(wx, wy, wz);
    if (w * dt < 1e-4) return;
    rotate(this.mats[i], wx, wy, wz, w * dt);
    if (Math.random() < 0.05) orthonormalize(this.mats[i]);
    const sp = this.sprites[i];
    if (sp) sp.dirty = true;
  }

  draw(now: number) {
    const ctx = this.ctx;
    if (!this.canvas.width) return;
    if (!this.layer) this.buildLayer();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.layer!, 0, 0);

    // positions now (playing back a shot, or at rest)
    const n = this.balls.length;
    const pos: Array<{ x: number; y: number; on: boolean; scale: number; fade: number }> = this.balls.map((b) => ({ x: b.x, y: b.y, on: !b.potted, scale: 1, fade: 0 }));
    const p = this.play;
    if (p) {
      // (a frame's timestamp can be a hair earlier than the moment the shot started)
      const t = Math.max(0, (now - p.start) / 1000);
      const { sim } = p;
      const fr = sim.frames!;
      const fdt = sim.frameDt;
      const last = sim.frameCount - 1;
      const f = Math.min(last, t / fdt);
      const f0 = Math.floor(f);
      const f1 = Math.min(last, f0 + 1);
      const a = f - f0;
      // turn the balls for every frame passed
      for (let k = p.lastFrame; k < f0; k++) {
        for (let i = 0; i < n; i++) {
          const o = (k * n + i) * STRIDE;
          this.spin(i, fr[o + 2], fr[o + 3], fr[o + 4], fdt);
        }
      }
      p.lastFrame = Math.max(p.lastFrame, f0);
      for (let i = 0; i < n; i++) {
        const o0 = (f0 * n + i) * STRIDE;
        const o1 = (f1 * n + i) * STRIDE;
        pos[i].x = fr[o0] + (fr[o1] - fr[o0]) * a;
        pos[i].y = fr[o0 + 1] + (fr[o1 + 1] - fr[o0 + 1]) * a;
        pos[i].on = !this.balls[i].potted;
      }
      // balls dropping into pockets
      for (const pt of sim.potted) {
        const i = this.balls.findIndex((b) => b.id === pt.id);
        if (i < 0 || t < pt.t) continue;
        const k0 = Math.max(0, Math.floor(pt.t / fdt));
        const o = (k0 * n + i) * STRIDE;
        const pk = POCKETS[pt.pocket];
        const q = Math.min(1, (t - pt.t) / 0.2);
        pos[i].x = fr[o] + (pk.x - fr[o]) * q;
        pos[i].y = fr[o + 1] + (pk.y - fr[o + 1]) * q;
        pos[i].scale = 1 - 0.3 * q;
        pos[i].fade = q;
        if (q >= 1) pos[i].on = false;
      }
      // sounds
      for (const e of sim.events) if (e.t > p.lastT && e.t <= t) p.onEvent(e);
      p.lastT = t;
      if (t >= sim.duration + 0.25) {
        this.play = null;
        this.balls = sim.final.map((b) => ({ ...b }));
        p.onDone();
      }
    }

    // kitchen while placing for the break
    if (this.inHand === "kitchen" && !this.play) {
      this.worldTransform(ctx);
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(0, 0, HEAD_X, W);
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.setLineDash([14, 12]);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(HEAD_X, 0);
      ctx.lineTo(HEAD_X, W);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // shadows
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const rpx = R * this.k;
    for (let i = 0; i < n; i++) {
      const q = pos[i];
      if (!q.on || q.fade > 0) continue;
      const s = this.tx(q.x, q.y);
      const g = ctx.createRadialGradient(s.x + rpx * 0.28, s.y + rpx * 0.36, rpx * 0.2, s.x + rpx * 0.28, s.y + rpx * 0.36, rpx * 1.25);
      g.addColorStop(0, "rgba(0,0,0,0.5)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(s.x + rpx * 0.28, s.y + rpx * 0.36, rpx * 1.25, 0, Math.PI * 2);
      ctx.fill();
    }

    // aim guide (under the balls)
    const cueI = this.balls.findIndex((b) => b.id === 0);
    const cue = cueI >= 0 ? pos[cueI] : null;
    const aiming = this.aim.show && !p && cue && cue.on;
    if (aiming && this.aim.guide) this.drawGuide(cue!, pos);

    // balls (screen pixels: the guide left the world transform set)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (let i = 0; i < n; i++) {
      const q = pos[i];
      if (!q.on) continue;
      const s = this.tx(q.x, q.y);
      const spr = this.ballSprite(i, this.balls[i].id);
      const size = spr.width * q.scale;
      ctx.globalAlpha = 1 - q.fade * 0.6;
      ctx.drawImage(spr, s.x - size / 2, s.y - size / 2, size, size);
      if (q.fade > 0) {
        ctx.fillStyle = `rgba(0,0,0,${q.fade * 0.7})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, (size / 2) * 0.98, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // ball in hand ring
    if (this.inHand && cue && !p) {
      const s = this.tx(cue.x, cue.y);
      const pulse = 0.5 + 0.5 * Math.sin(now / 240);
      ctx.strokeStyle = this.placeBad ? "rgba(255,90,80,0.95)" : `rgba(255,255,255,${0.5 + pulse * 0.4})`;
      ctx.lineWidth = Math.max(1.5, rpx * 0.12);
      ctx.setLineDash([rpx * 0.35, rpx * 0.25]);
      ctx.beginPath();
      ctx.arc(s.x, s.y, rpx * (1.5 + pulse * 0.15), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (aiming) this.drawCue(cue!);
  }

  /* ----- aiming ----- */
  private drawGuide(cue: { x: number; y: number }, pos: Array<{ x: number; y: number; on: boolean }>) {
    const ctx = this.ctx;
    const d = this.aim.dir;
    // first ball in the way (moving circle vs circles)
    let tHit = Infinity;
    let hitI = -1;
    for (let i = 0; i < pos.length; i++) {
      const b = pos[i];
      if (!b.on || this.balls[i].id === 0) continue;
      const fx = b.x - cue.x;
      const fy = b.y - cue.y;
      const along = fx * d.x + fy * d.y;
      if (along <= 0) continue;
      const perp2 = fx * fx + fy * fy - along * along;
      const rr = 4 * R * R;
      if (perp2 > rr) continue;
      const t = along - Math.sqrt(rr - perp2);
      if (t < tHit) {
        tHit = t;
        hitI = i;
      }
    }
    // first cushion
    let tRail = Infinity;
    for (let t = 0; t < 2400; t += 4) {
      const x = cue.x + d.x * t;
      const y = cue.y + d.y * t;
      if (x < R || x > L - R || y < R || y > W - R) {
        tRail = t;
        break;
      }
    }
    const ghostT = Math.min(tHit, tRail);
    const gx = cue.x + d.x * ghostT;
    const gy = cue.y + d.y * ghostT;
    this.worldTransform(ctx);
    const px = 1 / this.k; // one device pixel in units
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = Math.max(2.2 * px * this.dpr, 3);
    ctx.beginPath();
    ctx.moveTo(cue.x + d.x * R, cue.y + d.y * R);
    ctx.lineTo(gx, gy);
    ctx.stroke();
    const legal = hitI < 0 || this.aim.legal.includes(this.balls[hitI].id);
    // ghost ball
    ctx.lineWidth = Math.max(2 * px * this.dpr, 3);
    ctx.strokeStyle = legal ? "rgba(255,255,255,0.85)" : "rgba(255,90,80,0.95)";
    ctx.beginPath();
    ctx.arc(gx, gy, R, 0, Math.PI * 2);
    ctx.stroke();
    if (!legal) {
      const r = R * 0.5;
      ctx.beginPath();
      ctx.moveTo(gx - r, gy - r);
      ctx.lineTo(gx + r, gy + r);
      ctx.moveTo(gx + r, gy - r);
      ctx.lineTo(gx - r, gy + r);
      ctx.stroke();
    }
    if (hitI >= 0 && tHit <= tRail && legal) {
      const b = pos[hitI];
      let nx = b.x - gx;
      let ny = b.y - gy;
      const nl = Math.hypot(nx, ny) || 1;
      nx /= nl;
      ny /= nl;
      const cut = d.x * nx + d.y * ny;
      // object ball's line
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.beginPath();
      ctx.moveTo(b.x + nx * R, b.y + ny * R);
      const reach = this.aim.reach * (0.35 + 0.65 * cut);
      ctx.lineTo(b.x + nx * (R + reach), b.y + ny * (R + reach));
      ctx.stroke();
      // the cue ball's line: 90° off for a stun shot; with the better cues, bent by spin
      // (after the hit the ball keeps its spin: it rolls on at (5·v + 2·u) / 7)
      const f = this.aim.cuePath ? this.aim.follow * 0.5 * 2.5 : 0;
      const tx = 5 * (d.x - cut * nx) + 2 * f * d.x;
      const ty = 5 * (d.y - cut * ny) + 2 * f * d.y;
      const tl = Math.hypot(tx, ty) / 5;
      if (tl > 0.03) {
        const len = this.aim.cuePath ? 60 + this.aim.reach * 0.8 * Math.min(1, tl) : 40 + 120 * tl;
        ctx.strokeStyle = this.aim.cuePath ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.4)";
        ctx.setLineDash(this.aim.cuePath ? [10, 8] : []);
        ctx.beginPath();
        ctx.moveTo(gx, gy);
        ctx.lineTo(gx + (tx / (tl * 5)) * len, gy + (ty / (tl * 5)) * len);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    } else if (tRail < tHit) {
      // bounce off the cushion
      let rx = d.x;
      let ry = d.y;
      if (gx <= R || gx >= L - R) rx = -rx;
      if (gy <= R || gy >= W - R) ry = -ry;
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.lineTo(gx + rx * this.aim.reach * 0.7, gy + ry * this.aim.reach * 0.7);
      ctx.stroke();
    }
  }

  private drawCue(cue: { x: number; y: number }) {
    const ctx = this.ctx;
    const d = this.aim.dir;
    const pull = 10 + this.aim.power * 9 * R;
    const tip = { x: cue.x - d.x * (R + pull), y: cue.y - d.y * (R + pull) };
    // perpendicular
    const pxv = -d.y;
    const pyv = d.x;
    this.worldTransform(ctx);
    const at = (s: number) => ({ x: tip.x - d.x * s, y: tip.y - d.y * s });
    const half = (s: number) => 5 + (s / CUE_LEN) * 7.5; // radius: 10 → 25 units diameter
    const quad = (s0: number, s1: number) => {
      const a = at(s0);
      const b = at(s1);
      const h0 = half(s0);
      const h1 = half(s1);
      ctx.beginPath();
      ctx.moveTo(a.x + pxv * h0, a.y + pyv * h0);
      ctx.lineTo(b.x + pxv * h1, b.y + pyv * h1);
      ctx.lineTo(b.x - pxv * h1, b.y - pyv * h1);
      ctx.lineTo(a.x - pxv * h0, a.y - pyv * h0);
      ctx.closePath();
    };
    // shadow on the cloth
    const sh = this.screenVec(14 * this.dpr, 20 * this.dpr);
    ctx.save();
    ctx.translate(sh.x, sh.y);
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    quad(0, CUE_LEN);
    ctx.fill();
    ctx.restore();
    const band = (s0: number, s1: number, c0: string, c1: string) => {
      quad(s0, s1);
      const m = at((s0 + s1) / 2);
      const h = half((s0 + s1) / 2);
      const g = ctx.createLinearGradient(m.x + pxv * h, m.y + pyv * h, m.x - pxv * h, m.y - pyv * h);
      g.addColorStop(0, c1);
      g.addColorStop(0.35, c0);
      g.addColorStop(1, shadeHex(c0, 0.55));
      ctx.fillStyle = g;
      ctx.fill();
    };
    band(0, 5, "#3f6fb5", "#7aa3e0"); // chalked tip
    band(5, 26, "#f2eee3", "#ffffff"); // ferrule
    const cu = this.cue;
    band(26, 690, cu.shaft, shadeHex(cu.shaft, 1.15)); // shaft
    band(690, 712, cu.ring, shadeHex(cu.ring, 1.25)); // joint
    band(712, 900, cu.forearm, shadeHex(cu.forearm, 1.6)); // forearm
    // inlaid points on the forearm
    for (const side of [1, -1]) {
      const a = at(712);
      const b = at(860);
      const hb = half(860) * 0.7;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x + pxv * hb * side, b.y + pyv * hb * side);
      ctx.lineTo(b.x, b.y);
      ctx.closePath();
      ctx.fillStyle = cu.inlay;
      ctx.fill();
    }
    band(900, 1085, cu.wrap, shadeHex(cu.wrap, 2.2)); // wrap
    // wrap threads
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1.2;
    for (let s = 904; s < 1083; s += 6) {
      const m = at(s);
      const h = half(s);
      ctx.beginPath();
      ctx.moveTo(m.x + pxv * h, m.y + pyv * h);
      ctx.lineTo(m.x - pxv * h, m.y - pyv * h);
      ctx.stroke();
    }
    band(1085, 1090, cu.ring, shadeHex(cu.ring, 1.25)); // ring
    band(1090, 1140, cu.butt, shadeHex(cu.butt, 1.6)); // butt sleeve
    band(1140, CUE_LEN, "#111111", "#444444"); // bumper
  }
}

/* ---------------- helpers ---------------- */
function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function shadeHex(hex: string, f: number) {
  const [r, g, b] = hexRgb(hex);
  const cl = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${cl(r)},${cl(g)},${cl(b)})`;
}

/** The six cushion pieces as polygons: nose edge on the cloth, jaws, out to the rail. */
function cushionPolys(): Vec[][] {
  // pairs of [nose segment index, jaw segment at its start, jaw at its end]
  // CUSHIONS: 0..5 rails, 6..13 corner jaws (2 per corner: horizontal-rail nose, vertical-rail nose), 14..17 side jaws
  const out: Vec[][] = [];
  const ext = (jaw: { ax: number; ay: number; bx: number; by: number }, toY: number | null, toX: number | null): Vec => {
    // extend the jaw line from its nose out to the outer edge of the cushion band
    const dx = jaw.bx - jaw.ax;
    const dy = jaw.by - jaw.ay;
    if (toY !== null) {
      const t = (toY - jaw.ay) / dy;
      return { x: jaw.ax + dx * t, y: toY };
    }
    const t = (toX! - jaw.ax) / dx;
    return { x: toX!, y: jaw.ay + dy * t };
  };
  const C = CUSHIONS;
  // corner jaws: corner order (0,0), (L,0), (0,W), (L,W); each has [horizontal-rail jaw, vertical-rail jaw]
  const cj = (corner: number, which: 0 | 1) => C[6 + corner * 2 + which];
  const sj = (side: 0 | 1, which: 0 | 1) => C[14 + side * 2 + which];
  const top = -CUSH;
  const bot = W + CUSH;
  // top rail, left and right halves
  out.push([{ x: C[0].ax, y: 0 }, { x: C[0].bx, y: 0 }, ext(sj(0, 0), top, null), ext(cj(0, 0), top, null)]);
  out.push([{ x: C[1].ax, y: 0 }, { x: C[1].bx, y: 0 }, ext(cj(1, 0), top, null), ext(sj(0, 1), top, null)]);
  out.push([{ x: C[2].ax, y: W }, { x: C[2].bx, y: W }, ext(sj(1, 0), bot, null), ext(cj(2, 0), bot, null)]);
  out.push([{ x: C[3].ax, y: W }, { x: C[3].bx, y: W }, ext(cj(3, 0), bot, null), ext(sj(1, 1), bot, null)]);
  out.push([{ x: 0, y: C[4].ay }, { x: 0, y: C[4].by }, ext(cj(2, 1), null, -CUSH), ext(cj(0, 1), null, -CUSH)]);
  out.push([{ x: L, y: C[5].ay }, { x: L, y: C[5].by }, ext(cj(3, 1), null, L + CUSH), ext(cj(1, 1), null, L + CUSH)]);
  return out;
}
