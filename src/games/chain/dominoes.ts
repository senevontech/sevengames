/* Dominoes: lines of dominoes standing on an oak table, seen from above at an angle. Swipe a
   domino (or tap it) to push it over; a falling domino knocks over whatever its top reaches.
     domino — a classic black domino with pips
     giant  — taller and wider: reaches further, bridging gaps
     ball   — a steel ball: a falling domino sends it rolling into whatever is in its way
   The dominoes are drawn as real boxes: each falls by turning about its bottom edge, lit from
   the upper left, casting a shadow. */
import { Board, grain, mulberry, type BoardOpts, type BoardStatus } from "./core";
import { ballRoll, dominoClack, sparkSound } from "./sounds";

const VW = 1000;
const FLOOR_H = 1400; // table depth in units
const K = 0.78; // depth foreshortening
const ZK = 0.72; // height on screen
const TOP = 96; // room above the table for tall pieces
const VH = Math.round(TOP + FLOOR_H * K + 16);
const MARGIN = 60;

type Dom = {
  id: number;
  x: number;
  y: number;
  nx: number;
  ny: number;
  w: number;
  d: number;
  h: number;
  giant: boolean;
  state: 0 | 1 | 2; // standing, falling, down
  sgn: 1 | -1;
  t0: number;
  dur: number;
  /** stops leaning on the domino it hit */
  stop: number;
  gen: number;
  pips: [number, number];
  ivory: boolean;
  near: number[];
};
type Ball = { x: number; y: number; vx: number; vy: number; r: number; gen: number; moving: boolean };

const PIP_LAYOUT: Array<Array<[number, number]>> = [
  [],
  [[0, 0]],
  [[-0.5, -0.5], [0.5, 0.5]],
  [[-0.5, -0.5], [0, 0], [0.5, 0.5]],
  [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]],
  [[-0.5, -0.5], [0.5, -0.5], [0, 0], [-0.5, 0.5], [0.5, 0.5]],
  [[-0.5, -0.6], [0.5, -0.6], [-0.5, 0], [0.5, 0], [-0.5, 0.6], [0.5, 0.6]],
];

export class DominoSim {
  doms: Dom[] = [];
  balls: Ball[] = [];
  time = 0;
  count = 0;
  depth = 0;
  score = 0;
  tapsLeft: number;
  events: Array<{ k: "fall" | "ball" | "tap"; x: number; gen: number; big?: boolean }> = [];

  constructor(seed: number, round: number, daily: boolean, taps: number) {
    const rand = mulberry(seed);
    this.tapsLeft = taps;
    let id = 0;
    const free = (x: number, y: number, r: number) =>
      x > MARGIN && x < VW - MARGIN && y > MARGIN && y < FLOOR_H - MARGIN && this.doms.every((o) => Math.hypot(o.x - x, o.y - y) > r) && this.balls.every((b) => Math.hypot(b.x - x, b.y - y) > r + 10);
    const place = (x: number, y: number, a: number, giant: boolean) => {
      const h = giant ? 104 : 62;
      this.doms.push({
        id: id++,
        x,
        y,
        nx: Math.cos(a),
        ny: Math.sin(a),
        w: giant ? 44 : 30,
        d: giant ? 13 : 9,
        h,
        giant,
        state: 0,
        sgn: 1,
        t0: 0,
        dur: 0.3 * Math.sqrt(h / 62),
        stop: Math.PI / 2,
        gen: 0,
        pips: [Math.floor(rand() * 7), Math.floor(rand() * 7)],
        ivory: rand() < 0.22,
        near: [],
      });
    };
    let branches = 0;
    const path = (x: number, y: number, a: number, len: number) => {
      let turn = (rand() - 0.5) * 0.18;
      for (let k = 0; k < len; k++) {
        const giant = rand() < (daily ? 0.07 : 0.05 + Math.min(0.05, round * 0.004));
        const step = (giant ? 66 : 38) + rand() * 6;
        turn += (rand() - 0.5) * 0.12;
        turn = Math.max(-0.28, Math.min(0.28, turn));
        a += turn;
        let nx = x + Math.cos(a) * step;
        let ny = y + Math.sin(a) * step;
        // steer away from the edges
        if (nx < MARGIN * 2 || nx > VW - MARGIN * 2 || ny < MARGIN * 2 || ny > FLOOR_H - MARGIN * 2) {
          a += 0.5 * (rand() < 0.5 ? 1 : -1);
          nx = x + Math.cos(a) * step;
          ny = y + Math.sin(a) * step;
        }
        if (!free(nx, ny, 26)) return { x, y, a };
        x = nx;
        y = ny;
        place(x, y, a, giant);
        if (k > 2 && branches < (daily ? 4 : 2 + Math.floor(round / 3)) && rand() < 0.09) {
          branches++;
          path(x, y, a + (rand() < 0.5 ? 0.75 : -0.75), 4 + Math.floor(rand() * 6));
        }
      }
      return { x, y, a };
    };
    const paths = daily ? 6 : Math.min(7, 3 + Math.floor(round / 2));
    for (let p = 0; p < paths; p++) {
      const sx = MARGIN * 2 + rand() * (VW - MARGIN * 4);
      const sy = MARGIN * 2 + rand() * (FLOOR_H - MARGIN * 4);
      if (!free(sx, sy, 60)) continue;
      const a0 = rand() * Math.PI * 2;
      place(sx, sy, a0, false);
      const end = path(sx, sy, a0, 7 + Math.floor(rand() * (daily ? 12 : 8 + round)));
      // a steel ball waiting at some line ends
      if (rand() < 0.55) {
        const bx = end.x + Math.cos(end.a) * 58;
        const by = end.y + Math.sin(end.a) * 58;
        if (free(bx, by, 40)) this.balls.push({ x: bx, y: by, vx: 0, vy: 0, r: 15, gen: 0, moving: false });
      }
    }
    for (const a of this.doms) a.near = this.doms.filter((b) => b !== a && Math.hypot(b.x - a.x, b.y - a.y) < a.h + 50).map((b) => b.id);
  }

  get total() {
    return this.doms.length;
  }
  get busy() {
    return this.doms.some((d) => d.state === 1) || this.balls.some((b) => b.moving);
  }

  /** nearest standing domino to a point on the table */
  pick(x: number, y: number, maxD = 46) {
    let best: Dom | null = null;
    let bd = maxD;
    for (const d of this.doms) {
      if (d.state !== 0) continue;
      const dd = Math.hypot(d.x - x, d.y - y);
      if (dd < bd) {
        bd = dd;
        best = d;
      }
    }
    return best;
  }

  push(d: Dom, sgn: 1 | -1) {
    if (this.tapsLeft <= 0 || this.busy || d.state !== 0) return false;
    this.tapsLeft--;
    this.fall(d, sgn, 0);
    this.events.push({ k: "tap", x: d.x, gen: 0 });
    return true;
  }

  private fall(d: Dom, sgn: 1 | -1, gen: number) {
    d.state = 1;
    d.sgn = sgn;
    d.t0 = this.time;
    d.gen = gen;
    this.count++;
    this.depth = Math.max(this.depth, gen);
    this.score += Math.round(10 * (1 + 0.05 * gen));
  }

  /** how far over a falling domino is (radians) */
  angle(d: Dom) {
    if (d.state === 0) return 0;
    if (d.state === 2) return d.stop;
    const q = Math.min(1, (this.time - d.t0) / d.dur);
    return Math.min(d.stop, (Math.PI / 2) * Math.pow(q, 1.7));
  }

  step(h: number) {
    this.time += h;
    for (const a of this.doms) {
      if (a.state !== 1) continue;
      const phi = this.angle(a);
      const reach = a.h * Math.sin(phi);
      const fx = a.nx * a.sgn;
      const fy = a.ny * a.sgn;
      for (const id of a.near) {
        const b = this.doms[id];
        if (b.state !== 0) continue;
        const rx = b.x - a.x;
        const ry = b.y - a.y;
        const along = rx * fx + ry * fy;
        const lat = Math.abs(rx * -fy + ry * fx);
        if (along > a.d / 2 && along <= reach + b.d / 2 && lat <= (a.w + b.w) * 0.45) {
          const dot = b.nx * fx + b.ny * fy;
          this.fall(b, dot >= 0 ? 1 : -1, a.gen + 1);
          this.events.push({ k: "fall", x: b.x, gen: a.gen + 1, big: b.giant });
          // it comes to rest leaning on what it hit
          a.stop = Math.min(a.stop, Math.asin(Math.min(1, Math.max(0.2, (along - b.d / 2) / a.h))) + 0.12);
        }
      }
      for (const ball of this.balls) {
        if (ball.moving) continue;
        const rx = ball.x - a.x;
        const ry = ball.y - a.y;
        const along = rx * fx + ry * fy;
        const lat = Math.abs(rx * -fy + ry * fx);
        if (along > 0 && along <= reach + ball.r && lat <= a.w / 2 + ball.r) {
          ball.vx = fx * (a.giant ? 640 : 500);
          ball.vy = fy * (a.giant ? 640 : 500);
          ball.moving = true;
          ball.gen = a.gen + 1;
          this.events.push({ k: "ball", x: ball.x, gen: ball.gen });
        }
      }
      if (this.time - a.t0 >= a.dur || phi >= a.stop) {
        if (this.time - a.t0 >= a.dur) {
          a.state = 2;
          this.events.push({ k: "fall", x: a.x, gen: a.gen, big: a.giant });
        }
      }
    }
    for (const b of this.balls) {
      if (!b.moving) continue;
      b.x += b.vx * h;
      b.y += b.vy * h;
      const sp = Math.hypot(b.vx, b.vy);
      const ns = Math.max(0, sp - 150 * h);
      if (ns < 8) {
        b.moving = false;
        b.vx = b.vy = 0;
        continue;
      }
      b.vx *= ns / sp;
      b.vy *= ns / sp;
      if (b.x < MARGIN / 2 || b.x > VW - MARGIN / 2) (b.vx = -b.vx * 0.6), (b.x = Math.max(MARGIN / 2, Math.min(VW - MARGIN / 2, b.x)));
      if (b.y < MARGIN / 2 || b.y > FLOOR_H - MARGIN / 2) (b.vy = -b.vy * 0.6), (b.y = Math.max(MARGIN / 2, Math.min(FLOOR_H - MARGIN / 2, b.y)));
      for (const d of this.doms) {
        if (d.state !== 0) continue;
        // ball vs the domino's footprint (a thin box)
        const rx = b.x - d.x;
        const ry = b.y - d.y;
        const u = rx * d.nx + ry * d.ny;
        const v = rx * -d.ny + ry * d.nx;
        const cu = Math.max(-d.d / 2, Math.min(d.d / 2, u));
        const cv = Math.max(-d.w / 2, Math.min(d.w / 2, v));
        if ((u - cu) ** 2 + (v - cv) ** 2 < b.r * b.r) {
          const dot = (b.vx * d.nx + b.vy * d.ny) / (Math.hypot(b.vx, b.vy) || 1);
          this.fall(d, dot >= 0 ? 1 : -1, b.gen + 1);
          this.events.push({ k: "fall", x: d.x, gen: b.gen + 1, big: d.giant });
          b.vx *= 0.55;
          b.vy *= 0.55;
        }
      }
    }
  }

  /** headless: most dominoes one push can topple on this board */
  static best(seed: number, round: number) {
    const base = new DominoSim(seed, round, false, 1);
    let best = 0;
    for (let i = 0; i < base.doms.length; i++) {
      for (const sgn of [1, -1] as const) {
        const s = new DominoSim(seed, round, false, 1);
        s.push(s.doms[i], sgn);
        for (let n = 0; n < 60 * 30 && s.busy; n++) s.step(1 / 60);
        best = Math.max(best, s.count);
      }
    }
    return best;
  }
}

/* ================= drawing ================= */
type P3 = [number, number, number];
const LIGHT: P3 = (() => {
  const v: P3 = [-0.45, -0.55, 0.7];
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
})();
const VIEW: P3 = [0, ZK, K]; // toward the viewer (null direction of the projection)

export class DominoBoard extends Board {
  readonly viewW = VW;
  readonly viewH = VH;
  sim: DominoSim;
  private target: number;
  private layer: HTMLCanvasElement | null = null;

  constructor(canvas: HTMLCanvasElement, opts: BoardOpts, target: number) {
    super(canvas, opts);
    this.sim = new DominoSim(opts.seed, opts.round, opts.daily, opts.daily ? 2 : 1);
    this.target = target;
  }

  snapshot(): BoardStatus {
    const s = this.sim;
    return { count: s.count, total: s.total, target: this.target, tapsLeft: s.tapsLeft, depth: s.depth, score: s.score, busy: s.busy };
  }

  private scr(x: number, y: number, z: number): [number, number] {
    return [x, TOP + y * K - z * ZK];
  }

  /** a tap / swipe in view units: pick the domino by where it looks to be (its middle) */
  tap(x: number, y: number, dx = 0, dy = 0) {
    let best: Dom | null = null;
    let bd = 48;
    for (const d of this.sim.doms) {
      if (d.state !== 0) continue;
      const [sx, sy] = this.scr(d.x, d.y, d.h * 0.45);
      const dd = Math.hypot(sx - x, sy - y);
      if (dd < bd) {
        bd = dd;
        best = d;
      }
    }
    if (!best) return false;
    // a swipe pushes that way (screen → table: undo the foreshortening); a tap pushes it along its line
    const len = Math.hypot(dx, dy);
    let sgn: 1 | -1 = 1;
    if (len > 12) sgn = dx * best.nx + (dy / K) * best.ny >= 0 ? 1 : -1;
    if (!this.sim.push(best, sgn)) return false;
    this.input.push([this.tick, best.id, sgn]);
    this.status();
    return true;
  }

  protected onResize() {
    this.layer = null;
  }

  protected step(h: number) {
    const before = this.sim.count;
    this.sim.step(h);
    for (const e of this.sim.events) {
      const pan = (e.x / VW) * 2 - 1;
      if (e.k === "fall") dominoClack(e.gen, pan * 0.6, e.big);
      else if (e.k === "ball") ballRoll(pan * 0.6);
      else sparkSound();
    }
    if (this.sim.events.some((e) => e.k === "fall" && e.big)) this.shake = Math.max(this.shake, 4);
    this.sim.events.length = 0;
    if (this.sim.count !== before) this.status();
  }

  private buildLayer() {
    const cv = document.createElement("canvas");
    cv.width = this.canvas.width;
    cv.height = this.canvas.height;
    const c = cv.getContext("2d")!;
    c.setTransform(this.k, 0, 0, this.k, 0, 0);
    // the wall behind (dark) and the oak table
    const wall = c.createLinearGradient(0, 0, 0, TOP);
    wall.addColorStop(0, "#17130f");
    wall.addColorStop(1, "#2a2119");
    c.fillStyle = wall;
    c.fillRect(0, 0, VW, TOP);
    const y0 = TOP;
    const y1 = TOP + FLOOR_H * K;
    const oak = c.createLinearGradient(0, y0, 0, y1);
    oak.addColorStop(0, "#9a6b3c");
    oak.addColorStop(1, "#b98550");
    c.fillStyle = oak;
    c.fillRect(0, y0, VW, y1 - y0 + 16);
    // planks running away from you, with grain
    let seed = 7;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const plank = 125;
    for (let x = 0; x < VW; x += plank) {
      c.fillStyle = `rgba(${r() < 0.5 ? "60,30,10" : "255,220,170"},${0.04 + r() * 0.06})`;
      c.fillRect(x, y0, plank, y1 - y0 + 16);
      c.strokeStyle = "rgba(40,20,8,0.45)";
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(x, y0);
      c.lineTo(x, y1 + 16);
      c.stroke();
      for (let g = 0; g < 9; g++) {
        const gx = x + r() * plank;
        c.strokeStyle = `rgba(70,35,12,${0.08 + r() * 0.1})`;
        c.lineWidth = 0.6 + r() * 1.6;
        c.beginPath();
        c.moveTo(gx, y0);
        for (let yy = y0; yy <= y1 + 16; yy += 40) c.lineTo(gx + Math.sin(yy * 0.01 + g) * (2 + r() * 4), yy);
        c.stroke();
      }
    }
    c.globalAlpha = 0.07;
    c.fillStyle = c.createPattern(grain(), "repeat")!;
    c.fillRect(0, y0, VW, y1 - y0 + 16);
    c.globalAlpha = 1;
    // a lamp overhead, falling off to the far end
    const lamp = c.createRadialGradient(VW * 0.45, y0 + (y1 - y0) * 0.55, 30, VW * 0.5, y0 + (y1 - y0) * 0.55, VW * 0.95);
    lamp.addColorStop(0, "rgba(255,235,200,0.18)");
    lamp.addColorStop(1, "rgba(0,0,0,0.42)");
    c.fillStyle = lamp;
    c.fillRect(0, y0, VW, y1 - y0 + 16);
    // the table's far edge
    c.fillStyle = "rgba(0,0,0,0.5)";
    c.fillRect(0, y0, VW, 3);
    this.layer = cv;
  }

  /** the domino's 8 corners in table space (x, y, z) */
  private corners(d: Dom): P3[] {
    const phi = this.sim.angle(d);
    const s = d.sgn;
    const a0 = (s * d.d) / 2;
    const cs = Math.cos(phi);
    const sn = Math.sin(phi);
    const out: P3[] = [];
    for (const c of [0, d.h])
      for (const b of [-d.w / 2, d.w / 2])
        for (const a of [-d.d / 2, d.d / 2]) {
          const a2 = a0 + (a - a0) * cs + s * c * sn;
          const c2 = -s * (a - a0) * sn + c * cs;
          out.push([d.x + d.nx * a2 - d.ny * b, d.y + d.ny * a2 + d.nx * b, c2]);
        }
    return out;
  }

  private drawShadow(c: CanvasRenderingContext2D, pts: P3[]) {
    // cast along the light onto the table
    const flat = pts.map(([x, y, z]) => this.scr(x + z * 0.55, y + z * 0.7, 0));
    const hull = convexHull(flat);
    c.beginPath();
    hull.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.closePath();
    c.fill();
  }

  private drawDomino(c: CanvasRenderingContext2D, d: Dom) {
    const P = this.corners(d);
    // faces: indices into the corners (c, b, a bits: index = c*4 + b*2 + a)
    const faces: Array<{ idx: number[]; kind: "broad" | "side" | "end" }> = [
      { idx: [0, 2, 6, 4], kind: "broad" }, // a = −
      { idx: [1, 3, 7, 5], kind: "broad" }, // a = +
      { idx: [0, 1, 5, 4], kind: "side" }, // b = −
      { idx: [2, 3, 7, 6], kind: "side" }, // b = +
      { idx: [4, 5, 7, 6], kind: "end" }, // top
    ];
    const cx = P.reduce((s, p) => s + p[0], 0) / 8;
    const cy = P.reduce((s, p) => s + p[1], 0) / 8;
    const cz = P.reduce((s, p) => s + p[2], 0) / 8;
    const base = d.ivory ? [236, 228, 210] : [24, 24, 28];
    for (const f of faces) {
      const [p0, p1, , p3] = f.idx.map((i) => P[i]);
      const e1: P3 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
      const e2: P3 = [p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]];
      let n: P3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const fc = f.idx.reduce((s, i) => [s[0] + P[i][0] / 4, s[1] + P[i][1] / 4, s[2] + P[i][2] / 4] as P3, [0, 0, 0] as P3);
      if (n[0] * (fc[0] - cx) + n[1] * (fc[1] - cy) + n[2] * (fc[2] - cz) < 0) n = [-n[0], -n[1], -n[2]];
      const nl = Math.hypot(...n) || 1;
      n = [n[0] / nl, n[1] / nl, n[2] / nl];
      if (n[0] * VIEW[0] + n[1] * VIEW[1] + n[2] * VIEW[2] <= 0) continue;
      const lit = Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
      const shade = 0.42 + 0.58 * lit;
      // lacquer: a touch of sheen on faces turned to the lamp
      const sheen = Math.pow(lit, 8) * (d.ivory ? 30 : 70);
      const col = base.map((v) => Math.min(255, Math.round(v * shade + sheen)));
      const sp = f.idx.map((i) => this.scr(P[i][0], P[i][1], P[i][2]));
      c.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
      c.beginPath();
      sp.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
      c.closePath();
      c.fill();
      c.strokeStyle = d.ivory ? "rgba(120,100,70,0.5)" : "rgba(255,255,255,0.08)";
      c.lineWidth = 0.8;
      c.stroke();
      if (f.kind === "broad") {
        // the pips and the line across the middle, mapped onto the face
        const [q0, q1, q2, q3] = f.idx.map((i) => P[i]);
        const at = (u: number, v: number): [number, number] => {
          // u across (b), v up (c), both 0..1 on the face
          const x = q0[0] + (q1[0] - q0[0]) * u + (q3[0] - q0[0]) * v + (q2[0] - q1[0] - q3[0] + q0[0]) * u * v;
          const y = q0[1] + (q1[1] - q0[1]) * u + (q3[1] - q0[1]) * v + (q2[1] - q1[1] - q3[1] + q0[1]) * u * v;
          const z = q0[2] + (q1[2] - q0[2]) * u + (q3[2] - q0[2]) * v + (q2[2] - q1[2] - q3[2] + q0[2]) * u * v;
          return this.scr(x, y, z);
        };
        const ink = d.ivory ? "rgba(20,20,22,0.85)" : `rgba(240,236,226,${0.55 + 0.4 * lit})`;
        c.strokeStyle = ink;
        c.lineWidth = 1.4;
        const [m0x, m0y] = at(0.12, 0.5);
        const [m1x, m1y] = at(0.88, 0.5);
        c.beginPath();
        c.moveTo(m0x, m0y);
        c.lineTo(m1x, m1y);
        c.stroke();
        c.fillStyle = ink;
        const pr = d.giant ? 3.4 : 2.4;
        for (const [half, n] of [
          [0.25, d.pips[0]],
          [0.75, d.pips[1]],
        ] as const) {
          for (const [pu, pv] of PIP_LAYOUT[n]) {
            const [px, py] = at(0.5 + pu * 0.28, half + pv * 0.16);
            c.beginPath();
            c.arc(px, py, pr, 0, Math.PI * 2);
            c.fill();
          }
        }
      }
    }
  }

  private drawBall(c: CanvasRenderingContext2D, b: Ball) {
    const [sx, sy] = this.scr(b.x, b.y, b.r);
    const g = c.createRadialGradient(sx - b.r * 0.35, sy - b.r * 0.4, b.r * 0.05, sx, sy, b.r);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.2, "#e2e6ea");
    g.addColorStop(0.6, "#7f878f");
    g.addColorStop(1, "#24282c");
    c.fillStyle = g;
    c.beginPath();
    c.arc(sx, sy, b.r, 0, Math.PI * 2);
    c.fill();
    // the oak reflected on the lower half
    const w = c.createRadialGradient(sx, sy + b.r * 0.7, 0, sx, sy + b.r * 0.7, b.r * 0.7);
    w.addColorStop(0, "rgba(190,130,70,0.5)");
    w.addColorStop(1, "rgba(190,130,70,0)");
    c.fillStyle = w;
    c.beginPath();
    c.arc(sx, sy, b.r, 0, Math.PI * 2);
    c.fill();
  }

  protected render(now: number) {
    const c = this.ctx;
    if (!this.canvas.width) return;
    if (!this.layer) this.buildLayer();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(this.layer!, 0, 0);
    const s = this.sim;
    this.withView((c) => {
      // shadows first
      c.fillStyle = "rgba(30,14,4,0.32)";
      const all = s.doms.map((d) => ({ d, P: this.corners(d) }));
      for (const { P } of all) this.drawShadow(c, P);
      for (const b of s.balls) {
        const [sx, sy] = this.scr(b.x + b.r * 0.5, b.y + b.r * 0.7, 0);
        const g = c.createRadialGradient(sx, sy, 0, sx, sy, b.r * 1.3);
        g.addColorStop(0, "rgba(30,14,4,0.45)");
        g.addColorStop(1, "rgba(30,14,4,0)");
        c.fillStyle = g;
        c.beginPath();
        c.arc(sx, sy, b.r * 1.3, 0, Math.PI * 2);
        c.fill();
      }
      // far to near
      const items: Array<{ y: number; draw: () => void }> = [];
      for (const d of s.doms) items.push({ y: d.y + (d.state ? d.sgn * d.ny * d.h * 0.4 : 0), draw: () => this.drawDomino(c, d) });
      for (const b of s.balls) items.push({ y: b.y, draw: () => this.drawBall(c, b) });
      items.sort((a, b) => a.y - b.y);
      for (const it of items) it.draw();
      // ready: the standing dominoes breathe a little light
      if (s.tapsLeft > 0 && !s.busy) {
        const p = 0.5 + 0.5 * Math.sin(now / 380);
        c.fillStyle = `rgba(255,225,170,${0.06 + p * 0.06})`;
        c.fillRect(0, TOP, VW, 4);
      }
    });
  }
}

function convexHull(pts: Array<[number, number]>) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Array<[number, number]> = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Array<[number, number]> = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}
