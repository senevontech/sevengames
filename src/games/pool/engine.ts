/* Eight-ball pool: table geometry, ball physics and the rules.

   Units: the playing cloth is L × W (2 : 1, a 9-ft table scaled to 2000 units), balls have
   radius R (2¼" balls). x runs from the head rail (where you break from) to the foot rail.

   Physics, per ball:
     v  — centre velocity
     u  — "rolling velocity" (R·ω in the table plane): u = v means the ball rolls cleanly;
          u = 0 is a stun shot, u against v is draw (back-spin), u ahead of v is follow.
     s  — side spin (english), as a surface speed; it bends the ball off cushions.
   While u ≠ v the cloth's sliding friction pulls them together (a solid sphere: v loses 1,
   u gains 2.5); then the ball rolls and slows by rolling resistance. Balls trade the normal
   part of their velocity on contact (near-elastic), cushions are segments with rounded
   noses at the pocket jaws, so balls can rattle in the jaws and hang on pocket lips.

   A shot is simulated start to finish in one go (fixed 1/120 s ticks, sub-stepped by speed),
   using only + − × ÷ and sqrt, so every device computes exactly the same result: the rules,
   the CPU's planning and online play all use this. */

export const L = 2000;
export const W = 1000;
export const R = 22.5;
/** the head string: you break (and place after a break scratch) from x ≤ HEAD_X */
export const HEAD_X = L / 4;
export const HEAD_SPOT = { x: HEAD_X, y: W / 2 };
export const FOOT_SPOT = { x: L * 0.75, y: W / 2 };

export type Vec = { x: number; y: number };
export type Ball = { id: number; x: number; y: number; potted: boolean };

/** dx, dy: unit aim direction; power 0..1; sx: side spin −1..1 (right +); sy: −1 draw .. +1 follow */
export type Shot = { dx: number; dy: number; power: number; sx: number; sy: number };

const G = 7720; // 9.81 m/s² in table units
const MU_SLIDE = 0.2 * G;
const MU_ROLL = 110;
export const MU_ROLL_PUBLIC = MU_ROLL;
const SPIN_Z = 420;
const E_BALL = 0.96;
const E_RAIL = 0.76;
const RAIL_SPIN = 0.4;
const ENGLISH_KICK = 0.12;
/** ball-ball friction: cut shots throw the object ball a little off the line of centres */
const MU_BALL = 0.04;
/** cue ball squirt: side spin pushes the cue ball slightly off the aim line, away from the side hit */
const SQUIRT = 0.012;
/** cushion cloth drags along the rail a little */
const RAIL_DRAG = 0.05;
const TICK = 1 / 120;
const REC_EVERY = 2; // record at 60 fps
const MAX_TIME = 40;
export const MIN_SPEED = 150;
export const MAX_SPEED = 6800;
/** The best cues hit a little harder than full power (power up to MAX_POWER). */
export const MAX_POWER = 1.15;
export const speedOf = (power: number) => MIN_SPEED + Math.max(0, Math.min(MAX_POWER, power)) * (MAX_SPEED - MIN_SPEED);
export const STRIDE = 5; // floats per ball per recorded frame: x, y, ux, uy, s

/* ---------------- table geometry ---------------- */
export type Seg = { ax: number; ay: number; bx: number; by: number };
export type Pocket = { x: number; y: number; r: number; side: boolean; aim: Vec };

const CM = 2.9 * R; // corner mouth: noses this far from the corner along each rail
const SM = 2.25 * R; // side mouth half-width

function buildCushions(): Seg[] {
  const segs: Seg[] = [];
  const add = (ax: number, ay: number, bx: number, by: number) => segs.push({ ax, ay, bx, by });
  add(CM, 0, L / 2 - SM, 0);
  add(L / 2 + SM, 0, L - CM, 0);
  add(CM, W, L / 2 - SM, W);
  add(L / 2 + SM, W, L - CM, W);
  add(0, CM, 0, W - CM);
  add(L, CM, L, W - CM);
  const jl = 1.6 * R;
  for (const [cx, cy, sx, sy] of [
    [0, 0, -1, -1],
    [L, 0, 1, -1],
    [0, W, -1, 1],
    [L, W, 1, 1],
  ]) {
    const n1x = cx - sx * CM;
    add(n1x, cy, n1x + sx * 0.8 * jl, cy + sy * 0.6 * jl);
    const n2y = cy - sy * CM;
    add(cx, n2y, cx + sx * 0.6 * jl, n2y + sy * 0.8 * jl);
  }
  for (const [y0, sy] of [
    [0, -1],
    [W, 1],
  ]) {
    add(L / 2 - SM, y0, L / 2 - SM + 0.29 * R, y0 + sy * 1.16 * R);
    add(L / 2 + SM, y0, L / 2 + SM - 0.29 * R, y0 + sy * 1.16 * R);
  }
  return segs;
}
export const CUSHIONS = buildCushions();

/** Pocket capture circles (a ball whose centre gets inside drops) and where to aim into them. */
export const POCKETS: Pocket[] = [
  { x: -0.3 * R, y: -0.3 * R, r: 1.45 * R, side: false, aim: { x: 0.25 * R, y: 0.25 * R } },
  { x: L / 2, y: -0.9 * R, r: 1.3 * R, side: true, aim: { x: L / 2, y: 0.2 * R } },
  { x: L + 0.3 * R, y: -0.3 * R, r: 1.45 * R, side: false, aim: { x: L - 0.25 * R, y: 0.25 * R } },
  { x: -0.3 * R, y: W + 0.3 * R, r: 1.45 * R, side: false, aim: { x: 0.25 * R, y: W - 0.25 * R } },
  { x: L / 2, y: W + 0.9 * R, r: 1.3 * R, side: true, aim: { x: L / 2, y: W - 0.2 * R } },
  { x: L + 0.3 * R, y: W + 0.3 * R, r: 1.45 * R, side: false, aim: { x: L - 0.25 * R, y: W - 0.25 * R } },
];

function nearestPocket(x: number, y: number) {
  let best = 0;
  let bd = Infinity;
  POCKETS.forEach((p, i) => {
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

/* ---------------- simulation ---------------- */
/** x: where along the table it happened (0..L), so sounds can be panned */
export type SimEvent = { t: number; k: "cue" | "ball" | "rail" | "pot"; v: number; id: number; x: number; pocket?: number };
export type SimResult = {
  /** first object ball the cue ball touched */
  firstHit: number | null;
  potted: Array<{ id: number; pocket: number; t: number }>;
  /** any ball touched a cushion after the cue ball's first contact */
  railAfterContact: boolean;
  final: Ball[];
  duration: number;
  /** recorded frames (only when asked): frameCount × balls × STRIDE, balls in input order */
  frames: Float32Array | null;
  frameCount: number;
  frameDt: number;
  events: SimEvent[];
};

type Body = { id: number; x: number; y: number; vx: number; vy: number; ux: number; uy: number; s: number; on: boolean };

export function simulate(balls: Ball[], shot: Shot, record: boolean): SimResult {
  const bodies: Body[] = balls.map((b) => ({ id: b.id, x: b.x, y: b.y, vx: 0, vy: 0, ux: 0, uy: 0, s: 0, on: !b.potted }));
  const n = bodies.length;
  const cue = bodies.find((b) => b.id === 0)!;
  const speed = speedOf(shot.power);
  const len = Math.sqrt(shot.dx * shot.dx + shot.dy * shot.dy) || 1;
  let dx = shot.dx / len;
  let dy = shot.dy / len;
  const sy = Math.max(-1, Math.min(1, shot.sy));
  const sx = Math.max(-1, Math.min(1, shot.sx));
  // squirt: right english sends the ball a touch left of the aim (and vice versa)
  {
    const qx = dx + SQUIRT * sx * dy;
    const qy = dy - SQUIRT * sx * dx;
    const ql = Math.sqrt(qx * qx + qy * qy);
    dx = qx / ql;
    dy = qy / ql;
  }
  cue.vx = dx * speed;
  cue.vy = dy * speed;
  // tip offset b = 0.5·sy of the radius: ω = 5·v·b / 2R → u = 2.5·b·v
  cue.ux = cue.vx * 2.5 * 0.5 * sy;
  cue.uy = cue.vy * 2.5 * 0.5 * sy;
  cue.s = speed * 2.5 * 0.5 * sx;

  const events: SimEvent[] = [{ t: 0, k: "cue", v: speed, id: 0, x: cue.x }];
  const potted: SimResult["potted"] = [];
  let firstHit: number | null = null;
  let railAfterContact = false;

  const maxTicks = Math.ceil(MAX_TIME / TICK);
  const frames: number[] | null = record ? [] : null;
  const recordFrame = () => {
    if (!frames) return;
    for (const b of bodies) frames.push(b.x, b.y, b.ux, b.uy, b.s);
  };
  recordFrame();

  let t = 0;
  let tick = 0;
  for (; tick < maxTicks; tick++) {
    // sub-steps: nobody moves more than ~0.35 R per step
    let vmax = 0;
    for (const b of bodies) {
      if (!b.on) continue;
      const sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
      if (sp > vmax) vmax = sp;
    }
    let anyMoving = vmax > 0;
    if (!anyMoving) {
      for (const b of bodies) if (b.on && (b.ux !== 0 || b.uy !== 0)) anyMoving = true;
    }
    if (!anyMoving) break;
    const sub = Math.max(1, Math.min(48, Math.ceil((vmax * TICK) / (0.35 * R))));
    const h = TICK / sub;
    for (let k = 0; k < sub; k++) {
      // friction + move
      for (const b of bodies) {
        if (!b.on) continue;
        const rx = b.vx - b.ux;
        const ry = b.vy - b.uy;
        const rel = Math.sqrt(rx * rx + ry * ry);
        if (rel > 1e-6) {
          const a = MU_SLIDE * h;
          if (rel <= 3.5 * a) {
            const fx = (5 * b.vx + 2 * b.ux) / 7;
            const fy = (5 * b.vy + 2 * b.uy) / 7;
            b.vx = b.ux = fx;
            b.vy = b.uy = fy;
          } else {
            const nx = rx / rel;
            const ny = ry / rel;
            b.vx -= nx * a;
            b.vy -= ny * a;
            b.ux += nx * 2.5 * a;
            b.uy += ny * 2.5 * a;
          }
        } else {
          const sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
          const dec = MU_ROLL * h;
          if (sp <= dec || sp < 1.5) {
            b.vx = b.vy = b.ux = b.uy = 0;
            b.s = 0;
          } else {
            const f = (sp - dec) / sp;
            b.vx *= f;
            b.vy *= f;
            b.ux = b.vx;
            b.uy = b.vy;
          }
        }
        if (b.s !== 0) {
          const ds = SPIN_Z * h;
          b.s = b.s > ds ? b.s - ds : b.s < -ds ? b.s + ds : 0;
        }
        b.x += b.vx * h;
        b.y += b.vy * h;
      }
      // ball – ball
      for (let i = 0; i < n; i++) {
        const a = bodies[i];
        if (!a.on) continue;
        for (let j = i + 1; j < n; j++) {
          const b = bodies[j];
          if (!b.on) continue;
          const ex = b.x - a.x;
          const ey = b.y - a.y;
          const d2 = ex * ex + ey * ey;
          if (d2 >= 4 * R * R) continue;
          const d = Math.sqrt(d2) || 1e-6;
          const nx = ex / d;
          const ny = ey / d;
          const vrel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
          // push apart
          const push = (2 * R - d) / 2;
          a.x -= nx * push;
          a.y -= ny * push;
          b.x += nx * push;
          b.y += ny * push;
          if (vrel <= 0) continue;
          const jmp = ((1 + E_BALL) / 2) * vrel;
          a.vx -= jmp * nx;
          a.vy -= jmp * ny;
          b.vx += jmp * nx;
          b.vy += jmp * ny;
          // throw: friction at the contact point (sliding surfaces and side spin) pushes both
          // balls sideways a little, and trades some spin; a solid sphere: slip changes by 7·J
          {
            const tx = -ny;
            const ty = nx;
            const slip = (a.vx - b.vx) * tx + (a.vy - b.vy) * ty + a.s + b.s;
            const sAbs = slip < 0 ? -slip : slip;
            if (sAbs > 1e-6) {
              let jt = MU_BALL * jmp;
              if (jt > sAbs / 7) jt = sAbs / 7;
              const sg = slip > 0 ? 1 : -1;
              a.vx -= sg * jt * tx;
              a.vy -= sg * jt * ty;
              b.vx += sg * jt * tx;
              b.vy += sg * jt * ty;
              a.s -= sg * 2.5 * jt;
              b.s -= sg * 2.5 * jt;
            }
          }
          if (firstHit === null && (a.id === 0 || b.id === 0)) firstHit = a.id === 0 ? b.id : a.id;
          if (vrel > 20) events.push({ t: t + k * h, k: "ball", v: vrel, id: a.id, x: (a.x + b.x) / 2 });
        }
      }
      // cushions
      for (const b of bodies) {
        if (!b.on) continue;
        // quick reject: well inside the cloth
        if (b.x > R + 1 && b.x < L - R - 1 && b.y > R + 1 && b.y < W - R - 1) continue;
        for (const sg of CUSHIONS) {
          const sx2 = sg.bx - sg.ax;
          const sy2 = sg.by - sg.ay;
          const l2 = sx2 * sx2 + sy2 * sy2;
          let tt = ((b.x - sg.ax) * sx2 + (b.y - sg.ay) * sy2) / l2;
          tt = tt < 0 ? 0 : tt > 1 ? 1 : tt;
          const qx = sg.ax + sx2 * tt;
          const qy = sg.ay + sy2 * tt;
          const ex = b.x - qx;
          const ey = b.y - qy;
          const d2 = ex * ex + ey * ey;
          if (d2 >= R * R) continue;
          const d = Math.sqrt(d2) || 1e-6;
          const nx = ex / d;
          const ny = ey / d;
          b.x = qx + nx * R;
          b.y = qy + ny * R;
          const vn = b.vx * nx + b.vy * ny;
          if (vn >= 0) continue;
          b.vx -= (1 + E_RAIL) * vn * nx;
          b.vy -= (1 + E_RAIL) * vn * ny;
          {
            // the cushion's cloth drags on the ball along the rail
            const vt = b.vx * -ny + b.vy * nx;
            b.vx -= RAIL_DRAG * vt * -ny;
            b.vy -= RAIL_DRAG * vt * nx;
          }
          const un = b.ux * nx + b.uy * ny;
          b.ux -= (1 + RAIL_SPIN) * un * nx;
          b.uy -= (1 + RAIL_SPIN) * un * ny;
          if (b.s !== 0) {
            // side spin kicks the ball along the cushion
            const tx = -ny;
            const ty = nx;
            const cap = 0.6 * -vn;
            let kick = ENGLISH_KICK * b.s;
            kick = kick > cap ? cap : kick < -cap ? -cap : kick;
            b.vx += tx * kick;
            b.vy += ty * kick;
            b.s *= 0.5;
          }
          if (firstHit !== null) railAfterContact = true;
          if (-vn > 25) events.push({ t: t + k * h, k: "rail", v: -vn, id: b.id, x: b.x });
        }
      }
      // pockets
      for (const b of bodies) {
        if (!b.on) continue;
        if (b.x > 2 * R && b.x < L - 2 * R && b.y > 2 * R && b.y < W - 2 * R) continue;
        let hit = -1;
        for (let p = 0; p < POCKETS.length; p++) {
          const pk = POCKETS[p];
          const ex = b.x - pk.x;
          const ey = b.y - pk.y;
          if (ex * ex + ey * ey < pk.r * pk.r) {
            hit = p;
            break;
          }
        }
        if (hit < 0 && (b.x < -1.5 * R || b.x > L + 1.5 * R || b.y < -1.5 * R || b.y > W + 1.5 * R)) hit = nearestPocket(b.x, b.y);
        if (hit < 0) continue;
        const sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
        b.on = false;
        b.vx = b.vy = b.ux = b.uy = 0;
        b.s = 0;
        b.x = POCKETS[hit].x;
        b.y = POCKETS[hit].y;
        potted.push({ id: b.id, pocket: hit, t: t + k * h });
        events.push({ t: t + k * h, k: "pot", v: sp, id: b.id, x: POCKETS[hit].x, pocket: hit });
      }
    }
    t += TICK;
    if ((tick + 1) % REC_EVERY === 0) recordFrame();
  }
  // final frame (at rest)
  if (frames && (tick % REC_EVERY !== 0 || tick === 0)) recordFrame();

  const final: Ball[] = bodies.map((b) => ({ id: b.id, x: b.x, y: b.y, potted: !b.on }));
  // keep potted balls flagged as before (balls already off the table stay off)
  balls.forEach((b, i) => {
    if (b.potted) final[i].potted = true;
  });
  const frameCount = frames ? frames.length / (n * STRIDE) : 0;
  return {
    firstHit,
    potted,
    railAfterContact,
    final,
    duration: t,
    frames: frames ? Float32Array.from(frames) : null,
    frameCount,
    frameDt: TICK * REC_EVERY,
    events,
  };
}

/* ---------------- rules ---------------- */
export type Group = "solid" | "stripe";
export const groupOf = (id: number): Group | "eight" | "cue" => (id === 0 ? "cue" : id === 8 ? "eight" : id < 8 ? "solid" : "stripe");
export const otherGroup = (g: Group): Group => (g === "solid" ? "stripe" : "solid");

export type PoolState = {
  /** ids 0 (cue) .. 15, always in id order */
  balls: Ball[];
  turn: 0 | 1;
  groups: [Group | null, Group | null];
  /** the player to shoot may place the cue ball: behind the head string (break) or anywhere */
  inHand: "kitchen" | "anywhere" | null;
  isBreak: boolean;
  /** shots taken (online: which shot a message belongs to) */
  shots: number;
  over: boolean;
  winner: 0 | 1 | null;
  /** what the last shot did, for the status line */
  note: string | null;
  foul: boolean;
};

export function newRack(rand: () => number = Math.random, breaker: 0 | 1 = 0): PoolState {
  const gap = 0.004;
  const step = 2 * R * (1 + gap);
  const slots: Vec[] = [];
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c <= r; c++) {
      slots.push({ x: FOOT_SPOT.x + r * step * (Math.sqrt(3) / 2), y: W / 2 + (c - r / 2) * step });
    }
  }
  const shuffle = <T,>(a: T[]) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  // the 8 in the middle, a solid and a stripe in the back corners, the rest at random
  const order: number[] = new Array(15).fill(0);
  order[4] = 8;
  const solids = shuffle([1, 2, 3, 4, 5, 6, 7]);
  const stripes = shuffle([9, 10, 11, 12, 13, 14, 15]);
  const flip = rand() < 0.5;
  order[10] = flip ? solids.pop()! : stripes.pop()!;
  order[14] = flip ? stripes.pop()! : solids.pop()!;
  const rest = shuffle([...solids, ...stripes]);
  for (let i = 0; i < 15; i++) if (order[i] === 0) order[i] = rest.pop()!;
  const balls: Ball[] = [{ id: 0, x: HEAD_SPOT.x, y: HEAD_SPOT.y, potted: false }];
  for (let id = 1; id <= 15; id++) {
    const s = slots[order.indexOf(id)];
    balls.push({ id, x: s.x, y: s.y, potted: false });
  }
  return { balls, turn: breaker, groups: [null, null], inHand: "kitchen", isBreak: true, shots: 0, over: false, winner: null, note: null, foul: false };
}

const remaining = (balls: Ball[], g: Group) => balls.filter((b) => !b.potted && groupOf(b.id) === g).length;

/** Balls the shooter may hit first. */
export function legalTargets(st: PoolState): number[] {
  const g = st.groups[st.turn];
  const on = st.balls.filter((b) => !b.potted && b.id !== 0);
  if (st.isBreak) return on.map((b) => b.id);
  if (!g) return on.filter((b) => b.id !== 8).map((b) => b.id);
  if (remaining(st.balls, g) === 0) return [8];
  return on.filter((b) => groupOf(b.id) === g).map((b) => b.id);
}

/** Can the cue ball go here (ball in hand)? */
export function placeOk(st: PoolState, x: number, y: number, ignore = 0) {
  if (x < R || x > L - R || y < R || y > W - R) return false;
  if (st.inHand === "kitchen" && x > HEAD_X) return false;
  return st.balls.every((b) => b.id === ignore || b.potted || (b.x - x) ** 2 + (b.y - y) ** 2 >= (2 * R + 0.5) ** 2);
}

/** Nearest free spot to (x, y) for a ball (spiral search). */
export function freeSpot(st: PoolState, x: number, y: number, kitchen = false, ignore = 0): Vec {
  const test = { ...st, inHand: kitchen ? ("kitchen" as const) : ("anywhere" as const) };
  if (placeOk(test, x, y, ignore)) return { x, y };
  for (let r = R; r < L; r += R / 2) {
    for (let a = 0; a < 24; a++) {
      const px = x + r * Math.cos((a / 24) * Math.PI * 2);
      const py = y + r * Math.sin((a / 24) * Math.PI * 2);
      if (placeOk(test, px, py, ignore)) return { x: px, y: py };
    }
  }
  return { x, y };
}

const FOULS = {
  scratch: "Foul: the cue ball went in",
  miss: "Foul: no ball was hit",
  wrong: "Foul: wrong ball hit first",
  eightFirst: "Foul: the 8 can't be hit first yet",
  rail: "Foul: no ball reached a cushion",
  time: "Foul: time ran out",
} as const;

export type ShotOutcome = { next: PoolState; sim: SimResult };

/** Play a shot from `st` (with the cue ball placed at `cue` when the shooter had it in hand). */
export function playShot(st: PoolState, shot: Shot, cue: Vec | null, record: boolean): ShotOutcome {
  const balls = st.balls.map((b) => ({ ...b }));
  if (st.inHand && cue && placeOk(st, cue.x, cue.y)) {
    balls[0] = { id: 0, x: cue.x, y: cue.y, potted: false };
  }
  const sim = simulate(balls, shot, record);
  const me = st.turn;
  const opp = (1 - me) as 0 | 1;
  const ids = sim.potted.map((p) => p.id);
  const scratch = ids.includes(0);
  const eight = ids.includes(8);
  const objects = ids.filter((id) => id !== 0 && id !== 8);
  const myG = st.groups[me];
  const clearedBefore = myG !== null && remaining(st.balls, myG) === 0;

  let foul: string | null = null;
  if (scratch) foul = FOULS.scratch;
  else if (sim.firstHit === null) foul = FOULS.miss;
  else if (!st.isBreak) {
    const fg = groupOf(sim.firstHit);
    if (myG) {
      if (clearedBefore ? fg !== "eight" : fg !== myG) foul = FOULS.wrong;
    } else if (fg === "eight") foul = FOULS.eightFirst;
    if (!foul && ids.length === 0 && !sim.railAfterContact) foul = FOULS.rail;
  }

  const next: PoolState = {
    ...st,
    balls: sim.final.map((b) => ({ ...b })),
    groups: [...st.groups] as PoolState["groups"],
    isBreak: false,
    shots: st.shots + 1,
    foul: foul !== null,
    note: foul,
  };

  if (eight && st.isBreak) {
    // 8 on the break: it comes back to the foot spot
    const tmp = { ...next, balls: next.balls.map((b) => (b.id === 8 ? { ...b, potted: true } : b)) };
    const spot = freeSpot(tmp, FOOT_SPOT.x, FOOT_SPOT.y, false, 8);
    next.balls[8] = { id: 8, x: spot.x, y: spot.y, potted: false };
  } else if (eight) {
    const won = !foul && myG !== null && clearedBefore;
    next.over = true;
    next.winner = won ? me : opp;
    next.inHand = null;
    next.note = won ? "8 ball down!" : foul ? `8 ball down on a foul` : "8 ball down too early";
    return { next, sim };
  }

  if (!foul && !st.isBreak && !myG && objects.length) {
    const g = groupOf(objects[0]) as Group;
    next.groups[me] = g;
    next.groups[opp] = otherGroup(g);
  }
  const g2 = next.groups[me];
  const keep = !foul && (st.isBreak ? objects.length > 0 : g2 !== null && objects.some((id) => groupOf(id) === g2));
  next.turn = keep ? me : opp;
  next.inHand = foul ? "anywhere" : null;
  if (scratch) {
    const spot = freeSpot({ ...next, balls: next.balls.map((b) => (b.id === 0 ? { ...b, potted: true } : b)) }, HEAD_SPOT.x, HEAD_SPOT.y);
    next.balls[0] = { id: 0, x: spot.x, y: spot.y, potted: false };
  }
  if (!foul && !next.note) {
    if (!myG && g2 && !st.isBreak) next.note = `${g2 === "solid" ? "Solids" : "Stripes"} it is`;
    else if (objects.length) next.note = null;
  }
  return { next, sim };
}

/* ---------------- Endless (solo, against the clock) ---------------- */
/** Endless: no groups, every object ball (the 8 too) counts. A scratch gives ball in hand
 *  anywhere; once every object ball is down a fresh rack is set up (break from the kitchen). */
export type EndlessOutcome = ShotOutcome & { pots: number; scratch: boolean; cleared: boolean };

export function playEndless(st: PoolState, shot: Shot, cue: Vec | null, record: boolean, rand: () => number = Math.random): EndlessOutcome {
  const balls = st.balls.map((b) => ({ ...b }));
  if (st.inHand && cue && placeOk(st, cue.x, cue.y)) balls[0] = { id: 0, x: cue.x, y: cue.y, potted: false };
  const sim = simulate(balls, shot, record);
  const ids = sim.potted.map((p) => p.id);
  const scratch = ids.includes(0);
  const pots = ids.filter((id) => id !== 0).length;
  let next: PoolState = {
    ...st,
    balls: sim.final.map((b) => ({ ...b })),
    turn: 0,
    groups: [null, null],
    isBreak: false,
    shots: st.shots + 1,
    foul: scratch,
    note: scratch ? FOULS.scratch : null,
    inHand: scratch ? "anywhere" : null,
  };
  if (scratch) {
    const spot = freeSpot({ ...next, balls: next.balls.map((b) => (b.id === 0 ? { ...b, potted: true } : b)) }, HEAD_SPOT.x, HEAD_SPOT.y);
    next.balls[0] = { id: 0, x: spot.x, y: spot.y, potted: false };
  }
  const cleared = next.balls.every((b) => b.id === 0 || b.potted);
  if (cleared) next = { ...newRack(rand, 0), shots: next.shots };
  return { next, sim, pots, scratch, cleared };
}

/** Endless: every object ball still on the table. */
export const endlessTargets = (st: PoolState) => st.balls.filter((b) => !b.potted && b.id !== 0).map((b) => b.id);

/** The shooter ran out of time: a foul, the other player gets ball in hand. */
export function timeoutFoul(st: PoolState): PoolState {
  return { ...st, turn: (1 - st.turn) as 0 | 1, inHand: "anywhere", isBreak: false, shots: st.shots + 1, foul: true, note: FOULS.time };
}

/** Balls still to pot for a player (their group, then the 8). */
export function ballsLeft(st: PoolState, seat: 0 | 1): number[] {
  const g = st.groups[seat];
  if (!g) return [];
  return st.balls.filter((b) => !b.potted && groupOf(b.id) === g).map((b) => b.id);
}

/** Sanity-check a state from the network. */
export function validState(s: unknown): s is PoolState {
  const st = s as PoolState;
  return (
    !!st &&
    Array.isArray(st.balls) &&
    st.balls.length === 16 &&
    st.balls.every((b, i) => b && b.id === i && Number.isFinite(b.x) && Number.isFinite(b.y) && typeof b.potted === "boolean") &&
    (st.turn === 0 || st.turn === 1) &&
    Array.isArray(st.groups) &&
    typeof st.shots === "number"
  );
}
