/*
 * Small rendering toolkit shared by the canvas arcade games (Snake, Dodge, Stack).
 *
 * Built for smoothness:
 *  - crisp canvases on high-DPI screens, capped at 2× so phones don't render 9× the pixels
 *  - a fixed particle pool (no allocations during play → no garbage-collection hitches)
 *  - glow drawn with a pre-rendered radial sprite + "lighter" blending instead of shadowBlur,
 *    which is one of the slowest canvas operations
 *  - honours "reduce motion" (no shake, fewer particles)
 */
import { capDpr } from "../lib/perf";

export const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Size a canvas for its logical size × device pixel ratio; draw in logical units afterwards. */
export function setupCanvas(canvas: HTMLCanvasElement, w: number, h: number) {
  const dpr = capDpr(2);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext("2d", { alpha: false })!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

// ---- glow sprites (cached per colour) ----
const glowCache = new Map<string, HTMLCanvasElement>();
/** A soft radial glow of the given colour, 64×64; draw it scaled where you want light. */
export function glowSprite(color: string) {
  let c = glowCache.get(color);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, color);
  grad.addColorStop(0.35, color.replace(/[\d.]+\)$/, "0.35)"));
  grad.addColorStop(1, color.replace(/[\d.]+\)$/, "0)"));
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  glowCache.set(color, c);
  return c;
}

/** Draw a glow (additive) centred at x,y with the given radius. Colour must be rgba(...). */
export function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha = 1) {
  const prevOp = ctx.globalCompositeOperation;
  const prevA = ctx.globalAlpha;
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = alpha;
  ctx.drawImage(glowSprite(color), x - r, y - r, r * 2, r * 2);
  ctx.globalCompositeOperation = prevOp;
  ctx.globalAlpha = prevA;
}

// ---- particles ----
type P = { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; g: number };

export class Particles {
  private pool: P[];
  private next = 0;
  constructor(capacity = 220) {
    this.pool = Array.from({ length: capacity }, () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 2, color: "#fff", g: 0 }));
  }

  /** Burst of `n` particles from x,y. Re-uses the oldest slots when the pool is full. */
  burst(x: number, y: number, n: number, color: string, opts: { speed?: number; size?: number; life?: number; gravity?: number; spread?: number; angle?: number } = {}) {
    const count = reducedMotion() ? Math.ceil(n / 3) : n;
    const { speed = 160, size = 3, life = 0.7, gravity = 0, spread = Math.PI * 2, angle = 0 } = opts;
    for (let i = 0; i < count; i++) {
      const p = this.pool[this.next];
      this.next = (this.next + 1) % this.pool.length;
      const a = angle - spread / 2 + Math.random() * spread;
      const v = speed * (0.35 + Math.random() * 0.65);
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * v;
      p.vy = Math.sin(a) * v;
      p.max = p.life = life * (0.6 + Math.random() * 0.4);
      p.size = size * (0.6 + Math.random() * 0.8);
      p.color = color;
      p.g = gravity;
    }
  }

  update(dt: number) {
    for (const p of this.pool) {
      if (p.life <= 0) continue;
      p.life -= dt;
      p.vy += p.g * dt;
      p.vx *= 0.985;
      p.vy *= 0.985;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    const prevOp = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = "lighter";
    for (const p of this.pool) {
      if (p.life <= 0) continue;
      const t = p.life / p.max;
      ctx.globalAlpha = t;
      ctx.fillStyle = p.color;
      const s = p.size * (0.4 + t * 0.6);
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = prevOp;
  }

  clear() {
    for (const p of this.pool) p.life = 0;
  }
}

// ---- screen shake ----
export class Shake {
  private amount = 0;
  kick(a: number) {
    if (!reducedMotion()) this.amount = Math.max(this.amount, a);
  }
  /** Apply (call after ctx.save()) and decay. */
  apply(ctx: CanvasRenderingContext2D, dt: number) {
    if (this.amount < 0.1) return;
    ctx.translate((Math.random() - 0.5) * this.amount, (Math.random() - 0.5) * this.amount);
    this.amount *= Math.pow(0.002, dt);
  }
}

/** Rounded rectangle path (fast, no allocation). */
export function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
