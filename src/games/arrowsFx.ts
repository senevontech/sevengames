/* Arrows board effects, drawn on two canvases with their own animation loop (no React renders):
     under  (below the arrows): grid dots + the exit effect (wave / pulse / ink / starburst ring)
     over   (above the arrows): sparks, confetti and starburst stars
   Coordinates are the board SVG's viewBox units; the canvases sit exactly over the SVG box and
   map the viewBox the same way the SVG does (preserveAspectRatio "xMidYMid meet"). The loop
   only runs while something is moving; at rest the dots are drawn once. */

export type FxStyle = "fx:wave" | "fx:pulse" | "fx:ink" | "fx:starburst";

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  r: number;
  color: string;
  star?: boolean;
  rot?: number;
  vr?: number;
};

type Effect = { style: FxStyle; x: number; y: number; t0: number; dur: number; color: string; maxR: number };

const DUR: Record<FxStyle, number> = { "fx:wave": 1150, "fx:pulse": 850, "fx:ink": 1300, "fx:starburst": 700 };
const MAX_EFFECTS = 8;
const MAX_PARTICLES = 260;
const easeOut3 = (t: number) => 1 - Math.pow(1 - t, 3);
const easeOut5 = (t: number) => 1 - Math.pow(1 - t, 5);

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1, 7), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}

export class ArrowsFx {
  private under: CanvasRenderingContext2D;
  private over: CanvasRenderingContext2D;
  private cols = 0;
  private rows = 0;
  private cell: number;
  private dpr = 1;
  private scale = 1;
  private ox = 0;
  private oy = 0;
  private w = 0;
  private h = 0;
  private particles: Particle[] = [];
  private effects: Effect[] = [];
  private raf = 0;
  private last = 0;
  private ink = "#ffffff";

  constructor(
    private underCanvas: HTMLCanvasElement,
    private overCanvas: HTMLCanvasElement,
    cell: number,
    private calm: boolean,
    private inkOf: () => string,
  ) {
    this.under = underCanvas.getContext("2d")!;
    this.over = overCanvas.getContext("2d")!;
    this.cell = cell;
  }

  /* viewBox of the board SVG */
  private get vbX() {
    return -this.cell * 0.5;
  }
  private get vbW() {
    return this.cols * this.cell + this.cell;
  }
  private get vbH() {
    return this.rows * this.cell + this.cell;
  }

  setBoard(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.effects = [];
    this.particles = [];
    this.fit();
    this.paint(performance.now());
  }

  /** The canvases' CSS size changed (or the board did): match it at device resolution. */
  resize(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const c of [this.underCanvas, this.overCanvas]) {
      c.width = Math.max(1, Math.round(w * this.dpr));
      c.height = Math.max(1, Math.round(h * this.dpr));
    }
    this.fit();
    this.paint(performance.now());
  }

  /** Redraw at rest (e.g. after a theme change). */
  refresh() {
    if (!this.raf) this.paint(performance.now());
  }

  private fit() {
    if (!this.cols || !this.w) return;
    this.scale = Math.min(this.w / this.vbW, this.h / this.vbH);
    this.ox = (this.w - this.vbW * this.scale) / 2;
    this.oy = (this.h - this.vbH * this.scale) / 2;
  }

  private toBoard(ctx: CanvasRenderingContext2D) {
    const k = this.dpr * this.scale;
    ctx.setTransform(k, 0, 0, k, this.dpr * (this.ox - this.vbX * this.scale), this.dpr * (this.oy - this.vbX * this.scale));
  }

  clear() {
    this.effects = [];
    this.particles = [];
    this.refresh();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** Sparks flying out from a point. */
  burst(x: number, y: number, color: string, n: number, speed: number) {
    if (this.calm) return;
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const v = speed * (0.35 + Math.random() * 0.65);
      const life = 0.45 + Math.random() * 0.45;
      this.particles.push({ x, y, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v, life, max: life, r: 1.2 + Math.random() * 2.2, color });
    }
    this.trim();
    this.start();
  }

  /** The effect played where an arrow left the board. (dx, dy) = the direction it left in. */
  exit(style: FxStyle, x: number, y: number, dx: number, dy: number, color: string) {
    if (this.calm) return;
    const c = this.cell;
    const x0 = -c * 0.4;
    const y0 = -c * 0.4;
    const x1 = this.cols * c + c * 0.4;
    const y1 = this.rows * c + c * 0.4;
    const maxR = Math.max(Math.hypot(x - x0, y - y0), Math.hypot(x - x1, y - y0), Math.hypot(x - x0, y - y1), Math.hypot(x - x1, y - y1));
    const now = performance.now();
    this.effects.push({ style, x, y, t0: now, dur: DUR[style], color, maxR });
    if (this.effects.length > MAX_EFFECTS) this.effects.shift();
    if (style === "fx:starburst") {
      // stars fly back over the board, fanned around the way in
      const base = Math.atan2(-dy, -dx);
      for (let i = 0; i < 12; i++) {
        const ang = base + (i / 11 - 0.5) * Math.PI * 1.2 + (Math.random() - 0.5) * 0.15;
        const v = 140 + Math.random() * 160;
        const life = 0.7 + Math.random() * 0.4;
        this.particles.push({
          x,
          y,
          vx: Math.cos(ang) * v,
          vy: Math.sin(ang) * v,
          life,
          max: life,
          r: 4 + Math.random() * 3,
          color: i % 3 === 0 ? "#fff6c8" : color,
          star: true,
          rot: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 8,
        });
      }
      this.trim();
    }
    this.start();
  }

  private trim() {
    if (this.particles.length > MAX_PARTICLES) this.particles.splice(0, this.particles.length - MAX_PARTICLES);
  }

  private start() {
    if (this.raf) return;
    this.ink = this.inkOf();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  private tick = (now: number) => {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    for (const p of this.particles) {
      p.life -= dt;
      if (p.star) {
        p.vx *= 0.93;
        p.vy *= 0.93;
        p.rot! += p.vr! * dt;
      } else {
        p.vx *= 0.9;
        p.vy = p.vy * 0.9 + 60 * dt;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    this.effects = this.effects.filter((e) => now - e.t0 < e.dur);
    this.paint(now);
    this.raf = this.particles.length || this.effects.length ? requestAnimationFrame(this.tick) : 0;
    if (!this.raf) this.paint(now); // settle on a clean frame
  };

  private paint(now: number) {
    if (!this.raf) this.ink = this.inkOf(); // at rest: pick up theme changes
    this.paintUnder(now);
    this.paintOver();
  }

  /* ---------- below the arrows: effects + dots ---------- */
  private paintUnder(now: number) {
    const ctx = this.under;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.underCanvas.width, this.underCanvas.height);
    if (!this.cols || !this.w) return;
    this.toBoard(ctx);
    const c = this.cell;

    ctx.save();
    // clip to the board's rounded frame
    const x0 = -c * 0.4;
    const y0 = -c * 0.4;
    const bw = this.cols * c + c * 0.8;
    const bh = this.rows * c + c * 0.8;
    const r = 16;
    ctx.beginPath();
    ctx.moveTo(x0 + r, y0);
    ctx.arcTo(x0 + bw, y0, x0 + bw, y0 + bh, r);
    ctx.arcTo(x0 + bw, y0 + bh, x0, y0 + bh, r);
    ctx.arcTo(x0, y0 + bh, x0, y0, r);
    ctx.arcTo(x0, y0, x0 + bw, y0, r);
    ctx.closePath();
    ctx.clip();

    for (const e of this.effects) this.drawEffect(ctx, e, now);

    // dots: wave fronts swell and tint the dots they pass over
    const fronts: { x: number; y: number; r: number; fade: number; color: string }[] = [];
    for (const e of this.effects) {
      if (e.style !== "fx:wave" && e.style !== "fx:pulse") continue;
      const p = (now - e.t0) / e.dur;
      const rr = e.style === "fx:wave" ? e.maxR * easeOut3(p) : e.maxR * 0.9 * easeOut5(p);
      fronts.push({ x: e.x, y: e.y, r: rr, fade: 1 - p, color: e.color });
    }
    ctx.fillStyle = this.ink;
    ctx.globalAlpha = 0.13;
    ctx.beginPath();
    const lit: { x: number; y: number; lift: number; color: string }[] = [];
    const band = c * 0.55;
    for (let i = 0; i < this.cols * this.rows; i++) {
      const x = (i % this.cols) * c + c / 2;
      const y = Math.floor(i / this.cols) * c + c / 2;
      let lift = 0;
      let color = "";
      for (const f of fronts) {
        const d = (Math.hypot(x - f.x, y - f.y) - f.r) / band;
        if (d > 3 || d < -3) continue;
        const b = Math.exp(-d * d) * f.fade;
        if (b > lift) {
          lift = b;
          color = f.color;
        }
      }
      if (lift > 0.04) lit.push({ x, y, lift, color });
      else {
        ctx.moveTo(x + 1.3, y);
        ctx.arc(x, y, 1.3, 0, Math.PI * 2);
      }
    }
    ctx.fill();
    for (const d of lit) {
      ctx.globalAlpha = 0.35 + 0.65 * d.lift;
      ctx.fillStyle = d.color;
      ctx.beginPath();
      ctx.arc(d.x, d.y, 1.3 + 2.6 * d.lift, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  private drawEffect(ctx: CanvasRenderingContext2D, e: Effect, now: number) {
    const p = Math.min(1, Math.max(0, (now - e.t0) / e.dur));
    switch (e.style) {
      case "fx:wave": {
        const r = e.maxR * easeOut3(p);
        const fade = Math.pow(1 - p, 1.6);
        ctx.fillStyle = hexA(e.color, 0.08 * fade);
        ctx.beginPath();
        ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = hexA(e.color, 0.75 * fade);
        ctx.lineWidth = 0.8 + 3.4 * (1 - p);
        ctx.stroke();
        break;
      }
      case "fx:pulse": {
        const r = e.maxR * 0.9 * easeOut5(p);
        const fade = Math.pow(1 - p, 1.3);
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        // soft glow: wide faint strokes under a bright core
        for (const [w, a] of [
          [18, 0.08],
          [9, 0.18],
          [3.2, 0.9],
        ] as const) {
          ctx.strokeStyle = hexA(e.color, a * fade);
          ctx.lineWidth = w * (1 - p * 0.6);
          ctx.beginPath();
          ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (p < 0.25) {
          // flash at the edge
          const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, 40);
          g.addColorStop(0, hexA(e.color, 0.55 * (1 - p / 0.25)));
          g.addColorStop(1, hexA(e.color, 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(e.x, e.y, 40, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
        break;
      }
      case "fx:ink": {
        const fade = Math.pow(1 - p, 1.4);
        const grow = easeOut3(p);
        // three overlapping drops that bloom at slightly different rates
        for (let k = 0; k < 3; k++) {
          const ang = k * 2.1 + e.t0 * 0.001;
          const cx = e.x + Math.cos(ang) * 14 * grow;
          const cy = e.y + Math.sin(ang) * 14 * grow;
          const r = Math.max(1, e.maxR * (0.32 + k * 0.08) * grow);
          const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
          g.addColorStop(0, hexA(e.color, 0.3 * fade));
          g.addColorStop(0.7, hexA(e.color, 0.16 * fade));
          g.addColorStop(1, hexA(e.color, 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case "fx:starburst": {
        const r = e.maxR * 0.35 * easeOut3(p);
        ctx.strokeStyle = hexA(e.color, 0.6 * (1 - p));
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
    }
  }

  /* ---------- above the arrows: sparks + stars ---------- */
  private paintOver() {
    const ctx = this.over;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.overCanvas.width, this.overCanvas.height);
    if (!this.particles.length || !this.w) return;
    this.toBoard(ctx);
    for (const p of this.particles) {
      const k = p.life / p.max;
      ctx.globalAlpha = Math.min(1, k * 1.4);
      ctx.fillStyle = p.color;
      if (p.star) {
        const s = p.r * (0.5 + 0.5 * k);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot!);
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const rr = i % 2 ? s * 0.38 : s;
          const a = (i * Math.PI) / 4;
          if (i) ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
          else ctx.moveTo(rr, 0);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * (0.4 + k * 0.6), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }
}
