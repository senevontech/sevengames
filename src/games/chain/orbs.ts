/* Orbs: glass marbles drifting on a slate tray. A tap sets off a spark; an orb it touches
   shatters into shards, the shards fly out and shatter more orbs.
     glass  — clear glass, shatters into 6 shards
     big    — a heavy smoked orb: splits into two smaller orbs that fly apart (more to burst)
     amber  — volatile: goes off in a blast that shatters everything close by
     comet  — cobalt: fires a fast bolt that bounces off the walls, piercing what it meets
   The simulation (OrbSim) is plain numbers and seeded, so it runs headless too (to find how
   good a board can be, for the endless targets). */
import { BLACK, Board, WHITE, grain, hexRgb, mix, mulberry, rgba, roundRect, type BoardOpts, type BoardStatus } from "./core";
import { blastSound, boltSound, glassBurst, sparkSound } from "./sounds";

const VW = 1000;
const VH = 1400;
const RIM = 34; // tray rim

type OrbType = "glass" | "big" | "amber" | "comet";
type Orb = { id: number; type: OrbType; x: number; y: number; vx: number; vy: number; r: number; alive: boolean; at: number; gen: number };
type Shard = { x: number; y: number; vx: number; vy: number; life: number; gen: number; rot: number; vr: number; type: OrbType; size: number };
type Blast = { x: number; y: number; r: number; max: number; t: number; dur: number; gen: number; kind: "spark" | "amber" };
type Bolt = { x: number; y: number; vx: number; vy: number; life: number; gen: number; bounces: number; hits: number; trail: number[] };
export type OrbEvent = { k: "burst" | "blast" | "bolt" | "spark"; x: number; y: number; gen: number; type?: OrbType };

const LOOK: Record<OrbType, { color: string; glow: string; r: number }> = {
  glass: { color: "#a9d8e6", glow: "#d9f4ff", r: 30 },
  big: { color: "#6d5a86", glow: "#c7b5ea", r: 46 },
  amber: { color: "#e08a1e", glow: "#ffd27a", r: 31 },
  comet: { color: "#2456c9", glow: "#8fd0ff", r: 28 },
};

export class OrbSim {
  orbs: Orb[] = [];
  shards: Shard[] = [];
  blasts: Blast[] = [];
  bolts: Bolt[] = [];
  time = 0;
  count = 0;
  depth = 0;
  score = 0;
  total = 0;
  tapsLeft: number;
  lastPop = -1;
  private nextId = 0;
  private rand: () => number;
  events: OrbEvent[] = [];

  constructor(seed: number, round: number, daily: boolean, taps: number) {
    this.rand = mulberry(seed);
    this.tapsLeft = taps;
    const n = daily ? 40 : Math.min(56, 22 + round * 2);
    const mixW = daily ? [0.58, 0.12, 0.15, 0.15] : [0.62 - Math.min(0.2, round * 0.015), 0.1 + Math.min(0.06, round * 0.004), 0.14, 0.14];
    let tries = 0;
    while (this.orbs.length < n && tries++ < 5000) {
      const u = this.rand();
      const type: OrbType = u < mixW[0] ? "glass" : u < mixW[0] + mixW[1] ? "big" : u < mixW[0] + mixW[1] + mixW[2] ? "amber" : "comet";
      const r = LOOK[type].r;
      const x = RIM + r + 8 + this.rand() * (VW - 2 * (RIM + r + 8));
      const y = RIM + r + 8 + this.rand() * (VH - 2 * (RIM + r + 8));
      if (this.orbs.some((o) => Math.hypot(o.x - x, o.y - y) < o.r + r + 16)) continue;
      const a = this.rand() * Math.PI * 2;
      const sp = 14 + this.rand() * (daily ? 30 : 24 + round * 2);
      this.orbs.push({ id: this.nextId++, type, x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r, alive: true, at: -1, gen: 0 });
    }
    this.total = this.orbs.length + this.orbs.filter((o) => o.type === "big").length * 2;
  }

  get busy() {
    return this.shards.length > 0 || this.blasts.length > 0 || this.bolts.length > 0 || this.orbs.some((o) => o.alive && o.at >= 0) || (this.lastPop >= 0 && this.time - this.lastPop < 0.35);
  }

  tap(x: number, y: number) {
    if (this.tapsLeft <= 0 || this.busy) return false;
    this.tapsLeft--;
    this.blasts.push({ x, y, r: 0, max: 70, t: 0, dur: 0.22, gen: 0, kind: "spark" });
    this.events.push({ k: "spark", x, y, gen: 0 });
    return true;
  }

  private queue(o: Orb, gen: number, delay: number) {
    if (!o.alive || o.at >= 0) return;
    o.at = this.time + delay;
    o.gen = gen;
  }

  private burst(o: Orb) {
    o.alive = false;
    o.at = -1;
    this.count++;
    this.lastPop = this.time;
    this.depth = Math.max(this.depth, o.gen);
    this.score += Math.round(10 * (1 + 0.2 * o.gen));
    this.events.push({ k: "burst", x: o.x, y: o.y, gen: o.gen, type: o.type });
    const g = o.gen + 1;
    const shards = o.type === "glass" ? 6 : o.type === "big" ? 4 : o.type === "amber" ? 4 : 3;
    const base = this.rand() * Math.PI * 2;
    for (let i = 0; i < shards; i++) {
      const a = base + (i / shards) * Math.PI * 2 + (this.rand() - 0.5) * 0.5;
      const sp = 250 + this.rand() * 150;
      this.shards.push({ x: o.x, y: o.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.6 + this.rand() * 0.25, gen: g, rot: this.rand() * 6.3, vr: (this.rand() - 0.5) * 22, type: o.type, size: 7 + this.rand() * 7 });
    }
    if (o.type === "big") {
      // two smaller orbs fly apart
      const a = this.rand() * Math.PI * 2;
      for (const s of [1, -1]) {
        const r = 24;
        this.orbs.push({ id: this.nextId++, type: "glass", x: o.x + Math.cos(a) * 26 * s, y: o.y + Math.sin(a) * 26 * s, vx: Math.cos(a) * 230 * s, vy: Math.sin(a) * 230 * s, r, alive: true, at: -1, gen: g });
      }
    } else if (o.type === "amber") {
      this.blasts.push({ x: o.x, y: o.y, r: 0, max: 150, t: 0, dur: 0.3, gen: g, kind: "amber" });
      this.events.push({ k: "blast", x: o.x, y: o.y, gen: g });
    } else if (o.type === "comet") {
      const a = this.rand() * Math.PI * 2;
      this.bolts.push({ x: o.x, y: o.y, vx: Math.cos(a) * 1350, vy: Math.sin(a) * 1350, life: 1.4, gen: g, bounces: 0, hits: 0, trail: [] });
      this.events.push({ k: "bolt", x: o.x, y: o.y, gen: g });
    }
  }

  step(h: number) {
    this.time += h;
    const lo = RIM;
    const hiX = VW - RIM;
    const hiY = VH - RIM;
    // orbs drift; the small orbs from a split slow down
    for (const o of this.orbs) {
      if (!o.alive) continue;
      o.x += o.vx * h;
      o.y += o.vy * h;
      const sp = Math.hypot(o.vx, o.vy);
      if (sp > 60) {
        const f = Math.max(60, sp - 260 * h) / sp;
        o.vx *= f;
        o.vy *= f;
      }
      if (o.x < lo + o.r) (o.x = lo + o.r), (o.vx = Math.abs(o.vx));
      if (o.x > hiX - o.r) (o.x = hiX - o.r), (o.vx = -Math.abs(o.vx));
      if (o.y < lo + o.r) (o.y = lo + o.r), (o.vy = Math.abs(o.vy));
      if (o.y > hiY - o.r) (o.y = hiY - o.r), (o.vy = -Math.abs(o.vy));
      if (o.at >= 0 && this.time >= o.at) this.burst(o);
    }
    // spark and blasts grow and catch orbs
    for (let i = this.blasts.length - 1; i >= 0; i--) {
      const b = this.blasts[i];
      b.t += h;
      const q = Math.min(1, b.t / b.dur);
      b.r = b.max * (1 - (1 - q) * (1 - q));
      for (const o of this.orbs) {
        if (!o.alive || o.at >= 0) continue;
        if (Math.hypot(o.x - b.x, o.y - b.y) < b.r + o.r * 0.6) this.queue(o, b.gen, 0.02);
      }
      if (b.t >= b.dur + 0.25) this.blasts.splice(i, 1);
    }
    // shards fly, slow, and break what they hit
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const s = this.shards[i];
      s.x += s.vx * h;
      s.y += s.vy * h;
      const drag = 1 - 1.9 * h;
      s.vx *= drag;
      s.vy *= drag;
      s.rot += s.vr * h;
      s.life -= h;
      if (s.x < lo || s.x > hiX) (s.vx *= -0.45), (s.x = Math.max(lo, Math.min(hiX, s.x)));
      if (s.y < lo || s.y > hiY) (s.vy *= -0.45), (s.y = Math.max(lo, Math.min(hiY, s.y)));
      let hit = false;
      if (Math.hypot(s.vx, s.vy) > 90) {
        for (const o of this.orbs) {
          if (!o.alive || o.at >= 0) continue;
          const dx = o.x - s.x;
          const dy = o.y - s.y;
          if (dx * dx + dy * dy < o.r * o.r) {
            this.queue(o, s.gen, 0.015);
            hit = true;
            break;
          }
        }
      }
      if (hit || s.life <= 0) this.shards.splice(i, 1);
    }
    // bolts streak, bounce twice, pierce up to five orbs
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.x += b.vx * h;
      b.y += b.vy * h;
      b.life -= h;
      b.trail.push(b.x, b.y);
      if (b.trail.length > 28) b.trail.splice(0, 2);
      if (b.x < lo || b.x > hiX) (b.vx = -b.vx), (b.x = Math.max(lo, Math.min(hiX, b.x))), b.bounces++;
      if (b.y < lo || b.y > hiY) (b.vy = -b.vy), (b.y = Math.max(lo, Math.min(hiY, b.y))), b.bounces++;
      for (const o of this.orbs) {
        if (!o.alive || o.at >= 0) continue;
        if (Math.hypot(o.x - b.x, o.y - b.y) < o.r + 6) {
          this.queue(o, b.gen, 0.01);
          b.hits++;
        }
      }
      if (b.life <= 0 || b.bounces > 2 || b.hits >= 5) this.bolts.splice(i, 1);
    }
  }

  /** headless: how many orbs a tap at (x, y) right away would burst */
  static trial(seed: number, round: number, x: number, y: number) {
    const s = new OrbSim(seed, round, false, 1);
    s.tap(x, y);
    let n = 0;
    while ((s.busy || n < 2) && n < 120 * 12) {
      s.step(1 / 60);
      n++;
    }
    return s.count;
  }

  /** the best of a grid of taps at the start (endless targets) */
  static best(seed: number, round: number) {
    let best = 0;
    for (let gx = 0; gx < 5; gx++)
      for (let gy = 0; gy < 7; gy++) best = Math.max(best, OrbSim.trial(seed, round, RIM + 80 + gx * ((VW - 2 * RIM - 160) / 4), RIM + 80 + gy * ((VH - 2 * RIM - 160) / 6)));
    return best;
  }
}

/* ================= drawing ================= */
type Glow = { x: number; y: number; t: number; color: [number, number, number]; big: boolean };

export class OrbBoard extends Board {
  readonly viewW = VW;
  readonly viewH = VH;
  sim: OrbSim;
  private target: number;
  private sprites = new Map<string, HTMLCanvasElement>();
  private layer: HTMLCanvasElement | null = null;
  private glows: Glow[] = [];

  constructor(canvas: HTMLCanvasElement, opts: BoardOpts, target: number) {
    super(canvas, opts);
    this.sim = new OrbSim(opts.seed, opts.round, opts.daily, opts.daily ? 2 : 1);
    this.target = target;
  }

  snapshot(): BoardStatus {
    const s = this.sim;
    return { count: s.count, total: s.total, target: this.target, tapsLeft: s.tapsLeft, depth: s.depth, score: s.score, busy: s.busy };
  }

  tap(x: number, y: number) {
    if (!this.sim.tap(x, y)) return false;
    this.input.push([this.tick, Math.round(x), Math.round(y)]);
    this.status();
    return true;
  }

  protected onResize() {
    this.layer = null;
    this.sprites.clear();
  }

  protected step(h: number) {
    const before = this.sim.count;
    this.sim.step(h);
    for (const e of this.sim.events) {
      const pan = (e.x / VW) * 2 - 1;
      if (e.k === "burst") {
        glassBurst(e.gen, pan * 0.7, e.type === "big");
        this.glows.push({ x: e.x, y: e.y, t: 0, color: hexRgb(LOOK[e.type!].glow), big: false });
        this.shake = Math.max(this.shake, 2 + Math.min(10, e.gen));
      } else if (e.k === "blast") {
        blastSound(e.gen, pan * 0.7);
        this.glows.push({ x: e.x, y: e.y, t: 0, color: hexRgb("#ffb347"), big: true });
        this.shake = Math.max(this.shake, 14);
      } else if (e.k === "bolt") boltSound(pan * 0.7);
      else if (e.k === "spark") sparkSound();
    }
    this.sim.events.length = 0;
    for (const g of this.glows) g.t += h;
    this.glows = this.glows.filter((g) => g.t < (g.big ? 0.9 : 0.6));
    if (this.sim.count !== before) this.status();
  }

  /* ----- the tray ----- */
  private buildLayer() {
    const cv = document.createElement("canvas");
    cv.width = this.canvas.width;
    cv.height = this.canvas.height;
    const c = cv.getContext("2d")!;
    c.setTransform(this.k, 0, 0, this.k, 0, 0);
    // rim: dark anodised metal
    const rim = c.createLinearGradient(0, 0, 0, VH);
    rim.addColorStop(0, "#3a3f46");
    rim.addColorStop(1, "#1b1e22");
    c.fillStyle = rim;
    roundRect(c, 0, 0, VW, VH, 40);
    c.fill();
    c.strokeStyle = "rgba(255,255,255,0.18)";
    c.lineWidth = 2;
    roundRect(c, 1.5, 1.5, VW - 3, VH - 3, 39);
    c.stroke();
    // slate floor, lit from above
    const floor = c.createRadialGradient(VW * 0.45, VH * 0.4, 60, VW / 2, VH / 2, VH * 0.75);
    floor.addColorStop(0, "#3b4249");
    floor.addColorStop(0.6, "#262b31");
    floor.addColorStop(1, "#15181c");
    c.fillStyle = floor;
    roundRect(c, RIM, RIM, VW - 2 * RIM, VH - 2 * RIM, 18);
    c.fill();
    c.save();
    roundRect(c, RIM, RIM, VW - 2 * RIM, VH - 2 * RIM, 18);
    c.clip();
    c.globalAlpha = 0.09;
    c.fillStyle = c.createPattern(grain(), "repeat")!;
    c.fillRect(0, 0, VW, VH);
    c.globalAlpha = 1;
    // inner shadow under the rim
    const sh = 30;
    for (const [x0, y0, x1, y1] of [
      [RIM, RIM, RIM, RIM + sh],
      [RIM, VH - RIM, RIM, VH - RIM - sh],
      [RIM, RIM, RIM + sh, RIM],
      [VW - RIM, RIM, VW - RIM - sh, RIM],
    ]) {
      const g = c.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, "rgba(0,0,0,0.55)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = g;
      c.fillRect(RIM, RIM, VW - 2 * RIM, VH - 2 * RIM);
    }
    c.restore();
    this.layer = cv;
  }

  /** a glass marble, drawn once per type and size */
  private sprite(type: OrbType, r: number) {
    const key = `${type}:${Math.round(r)}`;
    let s = this.sprites.get(key);
    if (s) return s;
    const pr = r * this.k;
    const size = Math.ceil(pr * 2 + 4);
    s = document.createElement("canvas");
    s.width = s.height = size;
    const c = s.getContext("2d")!;
    const cx = size / 2;
    const col = hexRgb(LOOK[type].color);
    const glow = hexRgb(LOOK[type].glow);
    // body: light comes through the glass, deep colour at the edges
    const body = c.createRadialGradient(cx - pr * 0.3, cx - pr * 0.35, pr * 0.05, cx, cx, pr);
    body.addColorStop(0, rgba(mix(col, WHITE, 0.55), 0.92));
    body.addColorStop(0.55, rgba(col, 0.82));
    body.addColorStop(0.9, rgba(mix(col, BLACK, 0.45), 0.95));
    body.addColorStop(1, rgba(mix(col, BLACK, 0.65), 1));
    c.fillStyle = body;
    c.beginPath();
    c.arc(cx, cx, pr, 0, Math.PI * 2);
    c.fill();
    // inner glow (amber and comet burn inside)
    if (type === "amber" || type === "comet") {
      const core = c.createRadialGradient(cx + pr * 0.08, cx + pr * 0.1, 0, cx, cx, pr * 0.7);
      core.addColorStop(0, rgba(glow, 0.95));
      core.addColorStop(0.5, rgba(glow, 0.35));
      core.addColorStop(1, rgba(glow, 0));
      c.fillStyle = core;
      c.beginPath();
      c.arc(cx, cx, pr * 0.8, 0, Math.PI * 2);
      c.fill();
    }
    // a twist of colour inside clear glass
    if (type === "glass" || type === "big") {
      c.save();
      c.beginPath();
      c.arc(cx, cx, pr * 0.92, 0, Math.PI * 2);
      c.clip();
      c.strokeStyle = rgba(mix(col, WHITE, 0.4), 0.35);
      c.lineWidth = pr * 0.18;
      c.beginPath();
      c.moveTo(cx - pr * 0.8, cx + pr * 0.3);
      c.bezierCurveTo(cx - pr * 0.2, cx - pr * 0.6, cx + pr * 0.2, cx + pr * 0.7, cx + pr * 0.85, cx - pr * 0.2);
      c.stroke();
      c.restore();
    }
    // light focused through the ball: a bright crescent on the far side
    const caus = c.createRadialGradient(cx + pr * 0.38, cx + pr * 0.45, 0, cx + pr * 0.38, cx + pr * 0.45, pr * 0.55);
    caus.addColorStop(0, rgba(mix(glow, WHITE, 0.5), 0.55));
    caus.addColorStop(1, rgba(glow, 0));
    c.fillStyle = caus;
    c.beginPath();
    c.arc(cx, cx, pr, 0, Math.PI * 2);
    c.fill();
    // rim
    c.strokeStyle = rgba(mix(col, BLACK, 0.6), 0.6);
    c.lineWidth = Math.max(1, pr * 0.06);
    c.beginPath();
    c.arc(cx, cx, pr - c.lineWidth / 2, 0, Math.PI * 2);
    c.stroke();
    // reflections: the lamp (soft rectangle) and a sharp glint
    c.save();
    c.translate(cx - pr * 0.36, cx - pr * 0.42);
    c.rotate(-0.6);
    const spec = c.createRadialGradient(0, 0, 0, 0, 0, pr * 0.34);
    spec.addColorStop(0, "rgba(255,255,255,0.95)");
    spec.addColorStop(0.5, "rgba(255,255,255,0.45)");
    spec.addColorStop(1, "rgba(255,255,255,0)");
    c.scale(1, 0.55);
    c.fillStyle = spec;
    c.beginPath();
    c.arc(0, 0, pr * 0.34, 0, Math.PI * 2);
    c.fill();
    c.restore();
    c.fillStyle = "rgba(255,255,255,0.9)";
    c.beginPath();
    c.arc(cx - pr * 0.42, cx - pr * 0.5, Math.max(0.8, pr * 0.07), 0, Math.PI * 2);
    c.fill();
    this.sprites.set(key, s);
    return s;
  }

  protected render(now: number) {
    const c = this.ctx;
    if (!this.canvas.width) return;
    if (!this.layer) this.buildLayer();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(this.layer!, 0, 0);
    const s = this.sim;
    this.withView((c) => {
      // light of recent bursts on the floor
      c.save();
      c.globalCompositeOperation = "lighter";
      for (const g of this.glows) {
        const life = g.big ? 0.9 : 0.6;
        const q = 1 - g.t / life;
        const rr = (g.big ? 260 : 120) * (0.6 + 0.4 * (1 - q));
        const gr = c.createRadialGradient(g.x, g.y, 0, g.x, g.y, rr);
        gr.addColorStop(0, rgba(g.color, 0.45 * q));
        gr.addColorStop(1, rgba(g.color, 0));
        c.fillStyle = gr;
        c.beginPath();
        c.arc(g.x, g.y, rr, 0, Math.PI * 2);
        c.fill();
      }
      c.restore();
      // shadows, with light focused through the glass inside them
      for (const o of s.orbs) {
        if (!o.alive) continue;
        const ox = o.x + o.r * 0.28;
        const oy = o.y + o.r * 0.36;
        const g = c.createRadialGradient(ox, oy, o.r * 0.2, ox, oy, o.r * 1.25);
        g.addColorStop(0, "rgba(0,0,0,0.55)");
        g.addColorStop(1, "rgba(0,0,0,0)");
        c.fillStyle = g;
        c.beginPath();
        c.arc(ox, oy, o.r * 1.25, 0, Math.PI * 2);
        c.fill();
        const cs = c.createRadialGradient(o.x + o.r * 0.5, o.y + o.r * 0.62, 0, o.x + o.r * 0.5, o.y + o.r * 0.62, o.r * 0.45);
        cs.addColorStop(0, rgba(hexRgb(LOOK[o.type].glow), 0.4));
        cs.addColorStop(1, rgba(hexRgb(LOOK[o.type].glow), 0));
        c.fillStyle = cs;
        c.beginPath();
        c.arc(o.x + o.r * 0.5, o.y + o.r * 0.62, o.r * 0.45, 0, Math.PI * 2);
        c.fill();
      }
      // orbs (about to go: a flash)
      for (const o of s.orbs) {
        if (!o.alive) continue;
        const spr = this.sprite(o.type, o.r);
        const d = (spr.width / this.k);
        c.drawImage(spr, o.x - d / 2, o.y - d / 2, d, d);
        if (o.at >= 0) {
          c.fillStyle = "rgba(255,255,255,0.6)";
          c.beginPath();
          c.arc(o.x, o.y, o.r, 0, Math.PI * 2);
          c.fill();
        }
      }
      // shards: thin glass slivers
      for (const sh of s.shards) {
        const col = hexRgb(LOOK[sh.type].color);
        const a = Math.min(1, sh.life * 2);
        c.save();
        c.translate(sh.x, sh.y);
        c.rotate(sh.rot);
        c.fillStyle = rgba(mix(col, WHITE, 0.35), 0.8 * a);
        c.beginPath();
        c.moveTo(-sh.size, -sh.size * 0.25);
        c.lineTo(sh.size, 0);
        c.lineTo(-sh.size * 0.5, sh.size * 0.4);
        c.closePath();
        c.fill();
        c.strokeStyle = `rgba(255,255,255,${0.7 * a})`;
        c.lineWidth = 1.2;
        c.stroke();
        c.restore();
      }
      c.save();
      c.globalCompositeOperation = "lighter";
      // blasts and the spark
      for (const b of s.blasts) {
        const q = Math.min(1, b.t / (b.dur + 0.25));
        const col = b.kind === "spark" ? hexRgb("#fff1c4") : hexRgb("#ffab3d");
        const g = c.createRadialGradient(b.x, b.y, 0, b.x, b.y, Math.max(1, b.r));
        g.addColorStop(0, rgba(col, 0.85 * (1 - q)));
        g.addColorStop(0.7, rgba(col, 0.35 * (1 - q)));
        g.addColorStop(1, rgba(col, 0));
        c.fillStyle = g;
        c.beginPath();
        c.arc(b.x, b.y, Math.max(1, b.r), 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = rgba(col, 0.6 * (1 - q));
        c.lineWidth = 3;
        c.beginPath();
        c.arc(b.x, b.y, Math.max(1, b.r), 0, Math.PI * 2);
        c.stroke();
      }
      // bolts: bright streaks
      for (const b of s.bolts) {
        const t = b.trail;
        for (let i = 2; i < t.length; i += 2) {
          const a = i / t.length;
          c.strokeStyle = `rgba(150,215,255,${a * 0.9})`;
          c.lineWidth = 2 + a * 5;
          c.beginPath();
          c.moveTo(t[i - 2], t[i - 1]);
          c.lineTo(t[i], t[i + 1]);
          c.stroke();
        }
        const g = c.createRadialGradient(b.x, b.y, 0, b.x, b.y, 22);
        g.addColorStop(0, "rgba(255,255,255,0.95)");
        g.addColorStop(1, "rgba(120,200,255,0)");
        c.fillStyle = g;
        c.beginPath();
        c.arc(b.x, b.y, 22, 0, Math.PI * 2);
        c.fill();
      }
      c.restore();
      // ready: a soft pulse inviting a tap
      if (s.tapsLeft > 0 && !s.busy) {
        const p = 0.5 + 0.5 * Math.sin(now / 400);
        c.strokeStyle = `rgba(255,236,190,${0.08 + p * 0.1})`;
        c.lineWidth = 6;
        roundRect(c, RIM + 6, RIM + 6, VW - 2 * RIM - 12, VH - 2 * RIM - 12, 14);
        c.stroke();
      }
    });
  }
}
