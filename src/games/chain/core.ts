/* Chain Reaction: what the three boards (orbs, grid, dominoes) share.
   - seeded randomness: the daily board is the same for everyone (seeded by the date in India
     time and the variant); every board's simulation uses only seeded numbers, so a run can be
     replayed from its taps;
   - a fixed-step loop on a canvas, sized to its box, with pointer mapping and screen shake. */
import { capDpr } from "../../lib/perf";

export type Variant = "orbs" | "grid" | "dominoes";
export const VARIANTS: Variant[] = ["orbs", "grid", "dominoes"];

export function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(s: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Today in India time, YYYY-MM-DD (the daily board changes at midnight IST). */
export function dayKey(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
export const dailySeed = (variant: Variant, day = dayKey()) => hashStr(`chain:${variant}:${day}`);

/** What a board reports while it plays. */
export type BoardStatus = {
  /** pieces set off so far */
  count: number;
  /** pieces on the board (orbs, cells, dominoes) */
  total: number;
  /** needed to clear the round (endless); 0 = no target (daily) */
  target: number;
  tapsLeft: number;
  /** longest chain so far (generations) */
  depth: number;
  score: number;
  /** something is still moving */
  busy: boolean;
};

export type BoardOpts = {
  seed: number;
  /** endless round (1, 2, …); daily boards use a fixed difficulty */
  round: number;
  daily: boolean;
  onStatus: (s: BoardStatus) => void;
  /** the round is over: every tap used and everything still */
  onDone: (s: BoardStatus & { input: number[][] }) => void;
};

/** A board on a canvas: subclasses provide the simulation and the drawing. */
export abstract class Board {
  protected ctx: CanvasRenderingContext2D;
  protected dpr = 1;
  /** device px per board unit */
  protected k = 1;
  /** the board's own size in units */
  abstract readonly viewW: number;
  abstract readonly viewH: number;
  protected time = 0;
  private acc = 0;
  private last = 0;
  private raf = 0;
  protected shake = 0;
  private done = false;
  /** every tap, for replays: [tick, x, y, extra…] */
  protected input: number[][] = [];
  protected tick = 0;
  protected readonly h = 1 / 120;

  constructor(
    readonly canvas: HTMLCanvasElement,
    protected opts: BoardOpts,
  ) {
    this.ctx = canvas.getContext("2d")!;
  }

  start() {
    this.status();
    const loop = (now: number) => {
      if (!this.last) this.last = now;
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.acc += dt;
      while (this.acc >= this.h) {
        this.acc -= this.h;
        this.step(this.h);
        this.time += this.h;
        this.tick++;
      }
      this.shake *= Math.pow(0.02, dt);
      this.render(now);
      this.checkDone();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
  }

  /** fit the canvas into cssW × cssH, keeping the board's shape */
  resize(cssW: number, cssH: number) {
    const s = Math.min(cssW / this.viewW, cssH / this.viewH);
    const w = Math.floor(this.viewW * s);
    const hh = Math.floor(this.viewH * s);
    this.dpr = capDpr(2.5);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(hh * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${hh}px`;
    this.k = this.canvas.width / this.viewW;
    this.onResize();
  }

  /** client point → board units (the page may scale the game with a CSS transform) */
  toBoard(clientX: number, clientY: number) {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((clientX - r.left) / r.width) * this.viewW, y: ((clientY - r.top) / r.height) * this.viewH };
  }

  protected status() {
    this.opts.onStatus(this.snapshot());
  }

  private checkDone() {
    if (this.done) return;
    const s = this.snapshot();
    if (s.tapsLeft <= 0 && !s.busy && this.input.length > 0) {
      this.done = true;
      this.opts.onDone({ ...s, input: this.input });
    }
  }

  /** draw with the board's transform (and shake) */
  protected withView(fn: (c: CanvasRenderingContext2D) => void) {
    const c = this.ctx;
    const sx = this.shake > 0.3 ? (Math.random() - 0.5) * this.shake : 0;
    const sy = this.shake > 0.3 ? (Math.random() - 0.5) * this.shake : 0;
    c.setTransform(this.k, 0, 0, this.k, sx * this.k, sy * this.k);
    fn(c);
    c.setTransform(1, 0, 0, 1, 0, 0);
  }

  protected onResize() {}
  abstract snapshot(): BoardStatus;
  /** a tap (board units); dx, dy: a swipe direction when there was one */
  abstract tap(x: number, y: number, dx?: number, dy?: number): boolean;
  protected abstract step(h: number): void;
  protected abstract render(now: number): void;
}

/* ---------------- small drawing helpers ---------------- */
export const hexRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
export const rgba = (c: [number, number, number], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
export const mix = (c: [number, number, number], d: [number, number, number], t: number): [number, number, number] => [
  Math.round(c[0] + (d[0] - c[0]) * t),
  Math.round(c[1] + (d[1] - c[1]) * t),
  Math.round(c[2] + (d[2] - c[2]) * t),
];
export const WHITE: [number, number, number] = [255, 255, 255];
export const BLACK: [number, number, number] = [0, 0, 0];

let noiseTile: HTMLCanvasElement | null = null;
/** a small tile of fine grain, for surfaces */
export function grain() {
  if (noiseTile) return noiseTile;
  noiseTile = document.createElement("canvas");
  noiseTile.width = noiseTile.height = 128;
  const x = noiseTile.getContext("2d")!;
  const img = x.createImageData(128, 128);
  for (let i = 0; i < 128 * 128; i++) {
    const v = Math.random() < 0.5 ? 0 : 255;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = Math.random() * 255;
  }
  x.putImageData(img, 0, 0);
  return noiseTile;
}

export function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
