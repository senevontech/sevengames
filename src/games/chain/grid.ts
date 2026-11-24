/* Grid: a walnut board of cups, each holding steel beads. A cup holds one bead fewer than it
   has neighbours (corners 1, edges 2, the rest 3); when it gets one more it bursts and sends a
   bead into every neighbour, which may burst in turn. Tap a cup to drop a bead in.
   The bursts go in waves (everything at capacity bursts together), so a cascade can be shown
   and counted. The board always holds fewer beads than it has links between cups, which is what
   guarantees a cascade ends. */
import { Board, grain, mulberry, roundRect, type BoardOpts, type BoardStatus } from "./core";
import { beadLand, cellBurst, sparkSound } from "./sounds";

const COLS = 6;
const ROWS = 8;
const CELL = 150;
const OX = 50;
const OY = 100;
const VW = 1000;
const VH = 1400;
const WAVE = 0.17; // seconds between waves
const EDGES = (COLS - 1) * ROWS + (ROWS - 1) * COLS;

const neighbours: number[][] = Array.from({ length: COLS * ROWS }, (_, i) => {
  const x = i % COLS;
  const y = Math.floor(i / COLS);
  const out: number[] = [];
  if (x > 0) out.push(i - 1);
  if (x < COLS - 1) out.push(i + 1);
  if (y > 0) out.push(i - COLS);
  if (y < ROWS - 1) out.push(i + COLS);
  return out;
});
const cap = (i: number) => neighbours[i].length;

export class GridSim {
  counts: number[];
  tapsLeft: number;
  count = 0; // bursts
  depth = 0; // waves
  score = 0;
  readonly total = COLS * ROWS;
  time = 0;
  private nextWave = -1;
  private wave = 0;
  /** beads in flight: from → to, starting at t */
  flights: Array<{ from: number; to: number; t: number }> = [];
  /** bursts this wave (for the flash) */
  bursts: Array<{ i: number; t: number }> = [];
  events: Array<{ k: "burst" | "land" | "tap"; i: number; depth: number }> = [];

  constructor(seed: number, round: number, daily: boolean, taps: number) {
    const rand = mulberry(seed);
    this.tapsLeft = taps;
    // fuller boards (more cups one bead short) as rounds go on
    const full = daily ? 0.5 : Math.min(0.62, 0.34 + round * 0.025);
    this.counts = Array.from({ length: COLS * ROWS }, (_, i) => (rand() < full ? cap(i) - 1 : Math.floor(rand() * cap(i))));
    // keep total + taps below the number of links, so every cascade stops
    let total = this.counts.reduce((a, b) => a + b, 0);
    while (total + taps > EDGES - 1) {
      const i = Math.floor(rand() * this.counts.length);
      if (this.counts[i] > 0) {
        this.counts[i]--;
        total--;
      }
    }
  }

  get busy() {
    return this.nextWave >= 0 || this.flights.some((f) => this.time - f.t < WAVE);
  }

  tap(i: number) {
    if (this.tapsLeft <= 0 || this.busy || i < 0 || i >= this.counts.length) return false;
    this.tapsLeft--;
    this.counts[i]++;
    this.wave = 0;
    this.events.push({ k: "tap", i, depth: 0 });
    if (this.counts[i] >= cap(i)) this.nextWave = this.time + 0.08;
    return true;
  }

  /** one wave: every cup at capacity bursts */
  private fire() {
    const hot = this.counts.map((n, i) => (n >= cap(i) ? i : -1)).filter((i) => i >= 0);
    if (!hot.length || this.count > 2000) {
      this.nextWave = -1;
      return;
    }
    this.wave++;
    this.depth = Math.max(this.depth, this.wave);
    for (const i of hot) {
      this.counts[i] -= cap(i);
      this.count++;
      this.score += Math.round(10 * (1 + 0.1 * this.wave));
      this.bursts.push({ i, t: this.time });
      this.events.push({ k: "burst", i, depth: this.wave });
      for (const j of neighbours[i]) {
        this.counts[j]++;
        this.flights.push({ from: i, to: j, t: this.time });
      }
    }
    this.nextWave = this.time + WAVE;
  }

  step(h: number) {
    this.time += h;
    if (this.nextWave >= 0 && this.time >= this.nextWave) this.fire();
    for (const f of this.flights) {
      if (this.time - f.t >= WAVE && (f as { landed?: boolean }).landed !== true) {
        (f as { landed?: boolean }).landed = true;
        this.events.push({ k: "land", i: f.to, depth: this.wave });
      }
    }
    this.flights = this.flights.filter((f) => this.time - f.t < WAVE + 0.05);
    this.bursts = this.bursts.filter((b) => this.time - b.t < 0.5);
  }

  /** headless: bursts from one bead dropped in cup i */
  static trial(counts: number[], i: number) {
    const c = counts.slice();
    c[i]++;
    let bursts = 0;
    for (let guard = 0; guard < 500; guard++) {
      const hot = c.map((n, k) => (n >= cap(k) ? k : -1)).filter((k) => k >= 0);
      if (!hot.length) break;
      for (const k of hot) {
        c[k] -= cap(k);
        bursts++;
        for (const j of neighbours[k]) c[j]++;
      }
    }
    return bursts;
  }

  /** the most bursts one bead can set off on this board */
  static best(seed: number, round: number) {
    const s = new GridSim(seed, round, false, 1);
    let best = 0;
    for (let i = 0; i < s.counts.length; i++) best = Math.max(best, GridSim.trial(s.counts, i));
    return best;
  }
}

/* ================= drawing ================= */
const cellXY = (i: number) => ({ x: OX + (i % COLS) * CELL + CELL / 2, y: OY + Math.floor(i / COLS) * CELL + CELL / 2 });
/** where the beads sit in a cup (1, 2 or 3 of them) */
const SPOTS: Array<Array<[number, number]>> = [[], [[0, 0]], [[-0.17, 0], [0.17, 0]], [[0, -0.16], [-0.17, 0.12], [0.17, 0.12]]];

export class GridBoard extends Board {
  readonly viewW = VW;
  readonly viewH = VH;
  sim: GridSim;
  private target: number;
  private layer: HTMLCanvasElement | null = null;
  private bead: HTMLCanvasElement | null = null;

  constructor(canvas: HTMLCanvasElement, opts: BoardOpts, target: number) {
    super(canvas, opts);
    this.sim = new GridSim(opts.seed, opts.round, opts.daily, opts.daily ? 3 : 1);
    this.target = target;
  }

  snapshot(): BoardStatus {
    const s = this.sim;
    return { count: s.count, total: s.total, target: this.target, tapsLeft: s.tapsLeft, depth: s.depth, score: s.score, busy: s.busy };
  }

  tap(x: number, y: number) {
    const cx = Math.floor((x - OX) / CELL);
    const cy = Math.floor((y - OY) / CELL);
    if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS) return false;
    const i = cy * COLS + cx;
    if (!this.sim.tap(i)) return false;
    this.input.push([this.tick, i]);
    this.status();
    return true;
  }

  protected onResize() {
    this.layer = null;
    this.bead = null;
  }

  protected step(h: number) {
    const before = this.sim.count;
    this.sim.step(h);
    for (const e of this.sim.events) {
      const pan = (cellXY(e.i).x / VW) * 2 - 1;
      if (e.k === "burst") {
        cellBurst(e.depth, pan * 0.6);
        this.shake = Math.max(this.shake, 2 + Math.min(8, e.depth * 0.6));
      } else if (e.k === "land") beadLand(pan * 0.6);
      else sparkSound();
    }
    this.sim.events.length = 0;
    if (this.sim.count !== before) this.status();
  }

  private buildLayer() {
    const cv = document.createElement("canvas");
    cv.width = this.canvas.width;
    cv.height = this.canvas.height;
    const c = cv.getContext("2d")!;
    c.setTransform(this.k, 0, 0, this.k, 0, 0);
    // walnut slab
    const wood = c.createLinearGradient(0, 0, VW, VH);
    wood.addColorStop(0, "#5a3a22");
    wood.addColorStop(0.5, "#3e2615");
    wood.addColorStop(1, "#4d301b");
    c.fillStyle = wood;
    roundRect(c, 0, 0, VW, VH, 44);
    c.fill();
    c.save();
    roundRect(c, 0, 0, VW, VH, 44);
    c.clip();
    let seed = 11;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 160; i++) {
      const y = r() * VH;
      c.strokeStyle = r() < 0.5 ? `rgba(20,8,2,${0.06 + r() * 0.08})` : `rgba(200,140,90,${0.03 + r() * 0.05})`;
      c.lineWidth = 0.8 + r() * 2.4;
      c.beginPath();
      c.moveTo(0, y);
      for (let x = 0; x <= VW; x += 50) c.lineTo(x, y + Math.sin(x * 0.006 + i) * (2 + r() * 5));
      c.stroke();
    }
    c.globalAlpha = 0.07;
    c.fillStyle = c.createPattern(grain(), "repeat")!;
    c.fillRect(0, 0, VW, VH);
    c.globalAlpha = 1;
    // overhead light
    const lamp = c.createRadialGradient(VW * 0.45, VH * 0.4, 0, VW / 2, VH / 2, VH * 0.7);
    lamp.addColorStop(0, "rgba(255,230,190,0.16)");
    lamp.addColorStop(1, "rgba(0,0,0,0.35)");
    c.fillStyle = lamp;
    c.fillRect(0, 0, VW, VH);
    c.restore();
    c.strokeStyle = "rgba(255,220,180,0.2)";
    c.lineWidth = 2;
    roundRect(c, 1.5, 1.5, VW - 3, VH - 3, 43);
    c.stroke();
    // turned cups
    for (let i = 0; i < COLS * ROWS; i++) {
      const { x, y } = cellXY(i);
      const R = CELL * 0.4;
      // the lip catching light
      const lip = c.createLinearGradient(x - R, y - R, x + R, y + R);
      lip.addColorStop(0, "rgba(255,220,170,0.35)");
      lip.addColorStop(1, "rgba(0,0,0,0.45)");
      c.fillStyle = lip;
      c.beginPath();
      c.arc(x, y, R + 4, 0, Math.PI * 2);
      c.fill();
      // the hollow: dark at the top edge (in shade), lighter at the bottom
      const hol = c.createRadialGradient(x + R * 0.15, y + R * 0.2, R * 0.1, x, y, R);
      hol.addColorStop(0, "#3a2414");
      hol.addColorStop(0.75, "#24150b");
      hol.addColorStop(1, "#120a05");
      c.fillStyle = hol;
      c.beginPath();
      c.arc(x, y, R, 0, Math.PI * 2);
      c.fill();
      // capacity marks: small brass pins on the rim, one per neighbour
      for (let k = 0; k < cap(i); k++) {
        const a = -Math.PI / 2 + (k / cap(i)) * Math.PI * 2;
        c.fillStyle = "rgba(214,174,96,0.75)";
        c.beginPath();
        c.arc(x + Math.cos(a) * (R + 13), y + Math.sin(a) * (R + 13), 3.2, 0, Math.PI * 2);
        c.fill();
      }
    }
    this.layer = cv;
  }

  /** a polished steel bead (drawn once) */
  private beadSprite() {
    if (this.bead) return this.bead;
    const pr = 22 * this.k;
    const size = Math.ceil(pr * 2 + 4);
    const s = document.createElement("canvas");
    s.width = s.height = size;
    const c = s.getContext("2d")!;
    const cx = size / 2;
    const g = c.createRadialGradient(cx - pr * 0.35, cx - pr * 0.4, pr * 0.05, cx, cx, pr);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.18, "#e3e7ec");
    g.addColorStop(0.55, "#8a929b");
    g.addColorStop(0.85, "#3b4046");
    g.addColorStop(1, "#1c1f22");
    c.fillStyle = g;
    c.beginPath();
    c.arc(cx, cx, pr, 0, Math.PI * 2);
    c.fill();
    // the wood reflected low on the bead
    const wr = c.createRadialGradient(cx, cx + pr * 0.7, 0, cx, cx + pr * 0.7, pr * 0.7);
    wr.addColorStop(0, "rgba(160,100,55,0.55)");
    wr.addColorStop(1, "rgba(160,100,55,0)");
    c.fillStyle = wr;
    c.beginPath();
    c.arc(cx, cx, pr, 0, Math.PI * 2);
    c.fill();
    this.bead = s;
    return s;
  }

  private drawBead(c: CanvasRenderingContext2D, x: number, y: number, lift = 0) {
    const spr = this.beadSprite();
    const d = spr.width / this.k;
    const sh = c.createRadialGradient(x + 5 + lift * 0.4, y + 7 + lift * 0.6, 2, x + 5 + lift * 0.4, y + 7 + lift * 0.6, 26 + lift * 0.3);
    sh.addColorStop(0, `rgba(0,0,0,${0.55 - Math.min(0.3, lift / 200)})`);
    sh.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = sh;
    c.beginPath();
    c.arc(x + 5 + lift * 0.4, y + 7 + lift * 0.6, 26 + lift * 0.3, 0, Math.PI * 2);
    c.fill();
    c.drawImage(spr, x - d / 2, y - d / 2 - lift, d, d);
  }

  protected render(now: number) {
    const c = this.ctx;
    if (!this.canvas.width) return;
    if (!this.layer) this.buildLayer();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(this.layer!, 0, 0);
    const s = this.sim;
    const flightsTo = new Map<number, number>();
    for (const f of s.flights) if (s.time - f.t < WAVE) flightsTo.set(f.to, (flightsTo.get(f.to) ?? 0) + 1);
    this.withView((c) => {
      const pulse = 0.5 + 0.5 * Math.sin(now / 260);
      for (let i = 0; i < s.counts.length; i++) {
        const { x, y } = cellXY(i);
        // beads still flying in aren't in the cup yet
        const n = Math.max(0, Math.min(3, s.counts[i] - (flightsTo.get(i) ?? 0)));
        // a cup one bead short glows: it's charged
        if (s.counts[i] === cap(i) - 1) {
          const g = c.createRadialGradient(x, y, 0, x, y, CELL * 0.42);
          g.addColorStop(0, `rgba(255,150,60,${0.16 + pulse * 0.12})`);
          g.addColorStop(1, "rgba(255,150,60,0)");
          c.fillStyle = g;
          c.beginPath();
          c.arc(x, y, CELL * 0.42, 0, Math.PI * 2);
          c.fill();
        }
        for (const [dx, dy] of SPOTS[n]) this.drawBead(c, x + dx * CELL, y + dy * CELL);
      }
      // beads in flight: an arc from cup to cup
      for (const f of s.flights) {
        const q = (s.time - f.t) / WAVE;
        if (q >= 1) continue;
        const a = cellXY(f.from);
        const b = cellXY(f.to);
        const e = q * q * (3 - 2 * q);
        this.drawBead(c, a.x + (b.x - a.x) * e, a.y + (b.y - a.y) * e, Math.sin(q * Math.PI) * 55);
      }
      // bursts: a flash in the cup
      c.save();
      c.globalCompositeOperation = "lighter";
      for (const b of s.bursts) {
        const q = (s.time - b.t) / 0.5;
        const { x, y } = cellXY(b.i);
        const g = c.createRadialGradient(x, y, 0, x, y, CELL * (0.4 + q * 0.5));
        g.addColorStop(0, `rgba(255,214,150,${0.7 * (1 - q)})`);
        g.addColorStop(1, "rgba(255,160,80,0)");
        c.fillStyle = g;
        c.beginPath();
        c.arc(x, y, CELL * (0.4 + q * 0.5), 0, Math.PI * 2);
        c.fill();
      }
      c.restore();
      // ready for a tap
      if (s.tapsLeft > 0 && !s.busy) {
        c.strokeStyle = `rgba(255,214,150,${0.1 + pulse * 0.12})`;
        c.lineWidth = 5;
        roundRect(c, OX - 14, OY - 14, COLS * CELL + 28, ROWS * CELL + 28, 24);
        c.stroke();
      }
    });
  }
}
