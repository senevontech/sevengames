/* Draw a Tune: drawing the canvas. Songs live in fixed canvas units (W × H); on screen the
   canvas can be any shape (4:3 on wide screens, taller on phones), so every point is mapped to
   screen pixels separately in x and y while pens, text and rings keep their true shape.
   The canvas is transparent and sits in a soft neumorphic well that follows the site theme:
   ink is raised on light paper and glows on dark. Notes that sound ripple and bloom a wash of
   their colour into the background. */
import { capDpr } from "../../lib/perf";
import { COL, H, INSTRUMENTS, KEYS, STEPS, W, isRoot, midiOf, rowY, rowsOf, type Inst, type Song, type Stroke } from "./music";

export const PEN = [7, 12, 18];
export type Theme = "light" | "dark";
/** canvas units → screen pixels */
type Map = { sx: number; sy: number };
const sOf = (m: Map) => Math.sqrt(m.sx * m.sy);

/** ink colours per theme (the dark ones glow; the light ones are deeper so they read on paper) */
const LIGHT_INK: Record<Inst, string> = {
  piano: "#1593d8",
  bells: "#e09a00",
  strings: "#8655ee",
  bass: "#16a862",
  drums: "#ec4452",
  guitar: "#e5780e",
  sitar: "#dc2f7c",
  flute: "#0e9f92",
  synth: "#6f9c00",
  tabla: "#a35f2c",
};
export const inkOf = (i: Inst, t: Theme) => (t === "light" ? LIGHT_INK[i] : INSTRUMENTS[i].color);

function hexRgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = (hex: string, a: number) => {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
};
const lighten = (hex: string, k: number) => {
  const [r, g, b] = hexRgb(hex);
  return `rgb(${Math.round(r + (255 - r) * k)},${Math.round(g + (255 - g) * k)},${Math.round(b + (255 - b) * k)})`;
};

/** a smooth path through a stroke's points */
function trace(g: CanvasRenderingContext2D, p: number[], m: Map) {
  const X = (k: number) => p[k] * m.sx;
  const Y = (k: number) => p[k + 1] * m.sy;
  g.beginPath();
  g.moveTo(X(0), Y(0));
  if (p.length === 2) {
    g.lineTo(X(0) + 0.1, Y(0));
    return;
  }
  for (let k = 2; k + 3 < p.length; k += 2) {
    g.quadraticCurveTo(X(k), Y(k), (X(k) + X(k + 2)) / 2, (Y(k) + Y(k + 2)) / 2);
  }
  g.lineTo(X(p.length - 2), Y(p.length - 2));
}

export function drawStroke(g: CanvasRenderingContext2D, st: Stroke, theme: Theme, m: Map, alpha = 1, glow = true) {
  const col = inkOf(st.i, theme);
  const w = Math.max(2, (PEN[st.s] ?? PEN[1]) * sOf(m));
  g.save();
  g.lineCap = "round";
  g.lineJoin = "round";
  g.globalAlpha = alpha;
  trace(g, st.p, m);
  if (glow) {
    if (theme === "light") {
      // raised ink: a soft shadow below, like a bead of paint on paper
      g.shadowColor = "rgba(40,50,80,0.28)";
      g.shadowOffsetY = w * 0.35;
      g.shadowBlur = w * 0.9;
    } else {
      g.shadowColor = rgba(col, 0.85);
      g.shadowBlur = w * 1.6;
    }
  }
  g.strokeStyle = col;
  g.lineWidth = w;
  g.stroke();
  g.shadowColor = "transparent";
  g.shadowBlur = 0;
  g.shadowOffsetY = 0;
  // the glossy core
  g.strokeStyle = lighten(col, theme === "light" ? 0.45 : 0.6);
  g.lineWidth = Math.max(1, w * 0.3);
  g.stroke();
  g.restore();
}

export function drawGuides(g: CanvasRenderingContext2D, song: Song, m: Map, opts: { theme: Theme; labels: boolean; drums: string[] | null }) {
  const ink = opts.theme === "light" ? "30,36,56" : "255,255,255";
  const cw = W * m.sx;
  const ch = H * m.sy;
  const n = rowsOf(song.scale);
  g.textBaseline = "middle";
  for (let r = 0; r < n; r++) {
    const y = rowY(song.scale, r) * m.sy;
    const root = isRoot(song.scale, r);
    g.fillStyle = `rgba(${ink},${root ? 0.11 : 0.045})`;
    g.fillRect(0, y - (root ? 0.75 : 0.25), cw, root ? 1.5 : 0.5);
    if (opts.labels && root && !opts.drums && y > 26) {
      const mm = midiOf(song.scale, song.key, r);
      g.fillStyle = `rgba(${ink},0.4)`;
      g.font = "700 10px system-ui, sans-serif";
      g.fillText(`${KEYS[mm % 12]}${Math.floor(mm / 12) - 1}`, 6, y - 7);
    }
  }
  for (let s = 4; s < STEPS; s += 4) {
    const bar = s % 16 === 0;
    g.fillStyle = `rgba(${ink},${bar ? 0.12 : 0.04})`;
    g.fillRect(s * COL * m.sx - (bar ? 0.75 : 0.25), 0, bar ? 1.5 : 0.5, ch);
  }
  if (opts.labels) {
    g.fillStyle = `rgba(${ink},0.34)`;
    g.font = "800 10px system-ui, sans-serif";
    g.textBaseline = "top";
    for (let b = 0; b < STEPS / 16; b++) g.fillText(String(b + 1), b * 16 * COL * m.sx + 6, 6);
  }
  if (opts.drums) {
    const zh = ch / 4;
    g.fillStyle = opts.theme === "light" ? "rgba(236,68,82,0.06)" : "rgba(255,107,107,0.06)";
    for (let z = 0; z < 4; z += 2) g.fillRect(0, ch - (z + 1) * zh, cw, zh);
    g.fillStyle = opts.theme === "light" ? "rgba(200,50,64,0.65)" : "rgba(255,170,170,0.6)";
    g.font = "800 11px system-ui, sans-serif";
    g.textAlign = "right";
    g.textBaseline = "middle";
    opts.drums.forEach((name, z) => g.fillText(name, cw - 8, ch - (z + 0.5) * zh));
    g.textAlign = "left";
  }
}

/** a still picture of a song (gallery cards); transparent, on the card's well */
export function drawThumb(cv: HTMLCanvasElement, song: Song, theme: Theme) {
  const dpr = capDpr(2);
  const w = cv.clientWidth || 160;
  const h = Math.round((w * H) / W);
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  const g = cv.getContext("2d");
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const m = { sx: w / W, sy: h / H };
  for (const st of song.strokes) drawStroke(g, st, theme, m, 1, theme === "light");
}

type Ripple = { x: number; y: number; col: string; t: number; v: number };
export type Hover = { x: number; y: number; inst: Inst; size: 0 | 1 | 2; label: string };

export class TuneView {
  private g: CanvasRenderingContext2D;
  private cache = document.createElement("canvas");
  private dpr = 1;
  private cssW = 0;
  private cssH = 0;
  private song: Song | null = null;
  private drums: string[] | null = null;
  private ripples: Ripple[] = [];
  private raf = 0;
  theme: Theme = "dark";
  live: Stroke | null = null;
  /** where the play bar is (steps), or -1 */
  pos = -1;
  eraser: { x: number; y: number } | null = null;
  hover: Hover | null = null;
  /** mirror pen: show the flipped copy while drawing */
  mirror = false;

  constructor(private cv: HTMLCanvasElement) {
    this.g = cv.getContext("2d")!;
  }
  private get m(): Map {
    return { sx: this.cssW / W, sy: this.cssH / H };
  }
  resize(cssW: number, cssH: number) {
    if (cssW === this.cssW && cssH === this.cssH) return;
    this.dpr = capDpr(2);
    this.cssW = cssW;
    this.cssH = cssH;
    this.cv.width = Math.round(cssW * this.dpr);
    this.cv.height = Math.round(cssH * this.dpr);
    this.cv.style.width = `${cssW}px`;
    this.cv.style.height = `${cssH}px`;
    this.cache.width = this.cv.width;
    this.cache.height = this.cv.height;
    this.paintCache();
  }
  setSong(song: Song, drums: string[] | null, theme: Theme) {
    this.song = song;
    this.drums = drums;
    this.theme = theme;
    this.paintCache();
  }
  /** canvas units from a pointer position */
  toCanvas(clientX: number, clientY: number) {
    const r = this.cv.getBoundingClientRect();
    return { x: ((clientX - r.left) / r.width) * W, y: ((clientY - r.top) / r.height) * H };
  }
  hit(x: number, y: number, inst: Inst, vel: number) {
    this.ripples.push({ x, y, col: inkOf(inst, this.theme), t: performance.now(), v: vel });
    if (this.ripples.length > 140) this.ripples.splice(0, this.ripples.length - 140);
  }
  start() {
    const loop = () => {
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }
  destroy() {
    cancelAnimationFrame(this.raf);
  }

  private paintCache() {
    const g = this.cache.getContext("2d");
    if (!g || !this.song || !this.cssW) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.cache.width, this.cache.height);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const m = this.m;
    drawGuides(g, this.song, m, { theme: this.theme, labels: true, drums: this.drums });
    for (const st of this.song.strokes) drawStroke(g, st, this.theme, m);
  }

  private draw() {
    const g = this.g;
    if (!this.cssW || !this.song) return;
    const light = this.theme === "light";
    const m = this.m;
    const s = sOf(m);
    const ch = this.cssH;
    const now = performance.now();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.cv.width, this.cv.height);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ripples = this.ripples.filter((r) => now - r.t < 1400);
    // blooms: the background takes on the colour of what's playing
    g.save();
    g.globalCompositeOperation = light ? "multiply" : "lighter";
    for (const r of this.ripples) {
      const k = (now - r.t) / 1400;
      const rad = (120 + 160 * r.v + k * 80) * s;
      const a = (1 - k) * (1 - k) * (light ? 0.16 : 0.13);
      const x = r.x * m.sx, y = r.y * m.sy;
      const glow = g.createRadialGradient(x, y, 0, x, y, rad);
      glow.addColorStop(0, rgba(r.col, a));
      glow.addColorStop(1, rgba(r.col, 0));
      g.fillStyle = glow;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    g.restore();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this.cache, 0, 0);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.live) {
      drawStroke(g, this.live, this.theme, m);
      if (this.mirror) drawStroke(g, { ...this.live, p: this.live.p.map((v, k) => (k % 2 ? v : W - v)) }, this.theme, m, 0.55);
    }
    if (this.pos >= 0) {
      const x = this.pos * COL * m.sx;
      const cw = COL * m.sx;
      // the strokes light up where the bar passes
      g.save();
      g.beginPath();
      g.rect(x - cw * 1.2, 0, cw * 1.6, ch);
      g.clip();
      if (!light) g.globalCompositeOperation = "lighter";
      for (const st of this.song.strokes) drawStroke(g, st, this.theme, m, light ? 1 : 0.9);
      g.restore();
      const tail = g.createLinearGradient(x - 36, 0, x + 3, 0);
      tail.addColorStop(0, light ? "rgba(255,138,61,0)" : "rgba(255,255,255,0)");
      tail.addColorStop(1, light ? "rgba(255,138,61,0.16)" : "rgba(255,240,220,0.16)");
      g.fillStyle = tail;
      g.fillRect(x - 36, 0, 39, ch);
      g.fillStyle = light ? "#ff7a1a" : "rgba(255,246,232,0.95)";
      g.shadowColor = light ? "rgba(255,122,26,0.6)" : "rgba(255,200,140,0.9)";
      g.shadowBlur = 8;
      g.fillRect(x - 1, 0, 2, ch);
      g.shadowBlur = 0;
    }
    // rings where notes sound
    g.save();
    if (!light) g.globalCompositeOperation = "lighter";
    for (const r of this.ripples) {
      const k = (now - r.t) / 700;
      if (k >= 1) continue;
      g.strokeStyle = rgba(r.col, (1 - k) * 0.8);
      g.lineWidth = 2 * (1 - k) + 0.8;
      g.beginPath();
      g.arc(r.x * m.sx, r.y * m.sy, (10 + k * (28 + 30 * r.v)) * s, 0, Math.PI * 2);
      g.stroke();
    }
    g.restore();
    if (this.eraser) {
      g.strokeStyle = light ? "rgba(30,36,56,0.55)" : "rgba(255,255,255,0.6)";
      g.setLineDash([4, 4]);
      g.lineWidth = 1.5;
      g.beginPath();
      g.ellipse(this.eraser.x * m.sx, this.eraser.y * m.sy, ERASE_R * m.sx, ERASE_R * m.sy, 0, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
    }
    const hv = this.hover;
    if (hv && !this.live) {
      // the pen's tip and the note it would play
      const col = inkOf(hv.inst, this.theme);
      const x = hv.x * m.sx, y = hv.y * m.sy;
      g.fillStyle = rgba(col, 0.35);
      g.beginPath();
      g.arc(x, y, ((PEN[hv.size] ?? 12) / 2) * s + 2, 0, Math.PI * 2);
      g.fill();
      g.font = "800 12px system-ui, sans-serif";
      const tw = g.measureText(hv.label).width + 14;
      const lx = Math.min(this.cssW - tw - 4, x + 12);
      const ly = Math.max(4, y - 28);
      g.fillStyle = light ? "rgba(255,255,255,0.92)" : "rgba(12,14,24,0.8)";
      g.beginPath();
      g.roundRect(lx, ly, tw, 20, 10);
      g.fill();
      g.fillStyle = col;
      g.textBaseline = "middle";
      g.fillText(hv.label, lx + 7, ly + 10.5);
    }
  }
}
export const ERASE_R = 26;
