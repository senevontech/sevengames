/* Carrom engine — seat-based world, physics, rules, snapshots.
   Pure TypeScript math; DOM/canvas lives in render.ts, CPU in cpu.ts. */
import { BASE_STATS, massFor, maxSpeedFor, type StrikerStats } from "./stats";

export type Seats = 2 | 4;
export type SeatColor = "white" | "black";
export type SeatKind = "human" | "cpu" | "remote";
export type Kind = "white" | "black" | "queen" | "striker";

export type Vec = { x: number; y: number };

export type Player = {
  seat: number;
  name: string;
  kind: SeatKind;
  color: SeatColor;
  /** striker stats this player shoots with (power -> top speed, weight -> mass) */
  stats: StrikerStats;
};

export type Disc = {
  id: number;
  kind: Kind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  m: number;
  alive: boolean;
  /** visual rotation (rad) and spin (rad/s): coins turn when struck off-centre or scrape a wall */
  a: number;
  w: number;
};

/** Things that happened this frame, for sounds and visual effects (consumed by the renderer). */
export type FxEvent =
  | { type: "hit"; x: number; y: number; s: number; striker: boolean }
  | { type: "wall"; x: number; y: number; s: number }
  | { type: "pot"; x: number; y: number; px: number; py: number; s: number; kind: Kind }
  | { type: "rattle"; x: number; y: number; s: number };

export type QueenPhase =
  | { state: "board" }
  | { state: "pending"; seat: number }
  | { state: "owned"; color: SeatColor };

/** A disc dropping into a pocket: carries on along (dx,dy) into the pocket centre, tips over the
 *  edge and falls into the net. `sp` is its speed when captured. */
export type Sink = {
  x: number;
  y: number;
  px: number;
  py: number;
  dx: number;
  dy: number;
  sp: number;
  kind: Kind;
  t: number;
  a: number;
  w: number;
};
export const SINK_T = 0.45;
export type Shot = { potted: Disc[]; strikerPotted: boolean; contact: boolean };

export type World = {
  seats: Seats;
  players: Player[];
  turn: number;
  discs: Disc[];
  striker: Disc;
  queenDisc: Disc;
  potted: { white: Disc[]; black: Disc[] };
  queen: QueenPhase;
  strikerT: Record<number, number>; // along-baseline coordinate per seat
  shot: Shot;
  sinks: Sink[];
  events: FxEvent[];
  shotCount: number;
  result: { winner: SeatColor } | null;
  /** coins owed after a striker foul with nothing to return; paid from the next pots */
  due: { white: number; black: number };
  /** shots in a row with no coin or queen pocketed (stalemate guard) */
  dry: number;
};

/** After this many shots in a row without a pot, the board is decided on coins left. */
export const DRY_LIMIT = 40;

/* ================= world constants (virtual board units, 1000 x 1000) ================= */

export const SIZE = 1000;
export const WALL = 28;
export const PF_MIN = WALL;
export const PF_MAX = SIZE - WALL;
export const COIN_R = 19;
export const STRIKER_R = 30;
const STRIKER_M = 1.7;
const COIN_M = 1;
export const POCKET_R = 34;
// A disc drops only once its centre is over the hole (like a real pocket): no wider capture
// ring and no pull towards the pocket. Near a pocket the frame is open (the mouth).
const POCKET_CAPTURE = POCKET_R;
const POCKET_SKIP = POCKET_R + 2;
export const POCKETS = [
  { x: WALL + 26, y: WALL + 26 },
  { x: PF_MAX - 26, y: WALL + 26 },
  { x: WALL + 26, y: PF_MAX - 26 },
  { x: PF_MAX - 26, y: PF_MAX - 26 },
];
export const BASE_MIN = 218;
export const BASE_MAX = 782;
export const BASE_OFF = 44;
// Friction: a powdered carrom board behaves mostly like constant sliding friction (mu*g), plus a
// little speed-proportional drag. Coins slow steadily and stop crisply, as on a real board:
// a full-power striker still crosses the board and rebounds, but slow coins don't creep on.
// (cpu.ts reads these, so its shot strength stays right.)
export const FRICTION_K = 0.55;
export const FRICTION_LIN = 700;
const STOP_SPEED = 12;
// Rubber-lined frame: bounces lose more energy the harder they hit.
const WALL_E_SOFT = 0.78;
const WALL_E_HARD = 0.62;
export const DISC_E = 0.93;
/** Coin-on-coin surface friction: glancing hits transfer spin and a little sideways push. */
const DISC_MU = 0.06;
/** Coins hitting a pocket's jaw faster than this can rattle out instead of dropping. */
const RATTLE_SPEED = 1650;
const SPIN_DRAG = 2.2;
export const SUB = 1 / 240;
export const MIN_POWER_SPEED = 420;
export const MAX_POWER_SPEED = 2040;

/* ================= small helpers ================= */

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
export const norm = (v: Vec): Vec => {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
};

export function segDist(p: Vec, a: Vec, b: Vec) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const l2 = abx * abx + aby * aby;
  if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2;
  t = clamp(t, 0, 1);
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
}

export const partner = (seat: number, seats: Seats) => (seats === 4 ? (seat + 2) % 4 : seat);
export const colorOfSeat = (seat: number, seats: Seats): SeatColor =>
  seats === 2 ? (seat === 0 ? "white" : "black") : seat % 2 === 0 ? "white" : "black";

/* ================= baselines ================= */

export type Baseline = { axis: "h" | "v"; at: number; min: number; max: number };

export function baselineFor(seat: number, seats: Seats): Baseline {
  if (seats === 2) {
    return seat === 0
      ? { axis: "h", at: PF_MAX - BASE_OFF, min: BASE_MIN, max: BASE_MAX }
      : { axis: "h", at: PF_MIN + BASE_OFF, min: BASE_MIN, max: BASE_MAX };
  }
  switch (seat % 4) {
    case 0:
      return { axis: "h", at: PF_MAX - BASE_OFF, min: BASE_MIN, max: BASE_MAX };
    case 1:
      return { axis: "v", at: PF_MIN + BASE_OFF, min: BASE_MIN, max: BASE_MAX };
    case 2:
      return { axis: "h", at: PF_MIN + BASE_OFF, min: BASE_MIN, max: BASE_MAX };
    default:
      return { axis: "v", at: PF_MAX - BASE_OFF, min: BASE_MIN, max: BASE_MAX };
  }
}

/**
 * Screen rotation (radians, clockwise) that brings this seat's baseline to the BOTTOM of the
 * screen. Online, every player views the board from their own side; the world itself (physics,
 * rules, sync) never rotates.
 */
export function viewAngleFor(seat: number, seats: Seats): number {
  if (seats === 2) return seat === 0 ? 0 : Math.PI;
  return [0, -Math.PI / 2, Math.PI, Math.PI / 2][seat % 4];
}

/** Rotate a point around the board centre. */
export function rotateAboutCentre(p: Vec, angle: number): Vec {
  if (!angle) return p;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const x = p.x - SIZE / 2;
  const y = p.y - SIZE / 2;
  return { x: SIZE / 2 + x * c - y * s, y: SIZE / 2 + x * s + y * c };
}

/** Direction must point into the board from this seat's baseline. */
export function minDirFor(seat: number, seats: Seats): Vec {
  if (seats === 2) return seat === 0 ? { x: 0, y: -0.05 } : { x: 0, y: 0.05 };
  switch (seat % 4) {
    case 0:
      return { x: 0, y: -0.05 };
    case 1:
      return { x: 0.05, y: 0 };
    case 2:
      return { x: 0, y: 0.05 };
    default:
      return { x: -0.05, y: 0 };
  }
}

export function strikerPos(seat: number, seats: Seats, t: number): Vec {
  const bl = baselineFor(seat, seats);
  const c = clamp(t, bl.min, bl.max);
  return bl.axis === "h" ? { x: c, y: bl.at } : { x: bl.at, y: c };
}

/* ================= world setup ================= */

let nextId = 1;
export function resetIds() {
  nextId = 1;
}

function makeCoin(kind: Kind, x: number, y: number): Disc {
  return { id: nextId++, kind, x, y, vx: 0, vy: 0, r: COIN_R, m: COIN_M, alive: true, a: Math.random() * Math.PI * 2, w: 0 };
}

export type WorldConfig = {
  seats: Seats;
  players: Array<{ name: string; kind: SeatKind; stats?: StrikerStats }>;
};

export function makeWorld(cfg: WorldConfig): World {
  resetIds();
  const players: Player[] = cfg.players.slice(0, cfg.seats).map((p, i) => ({
    seat: i,
    name: p.name,
    kind: p.kind,
    color: colorOfSeat(i, cfg.seats),
    stats: p.stats ?? BASE_STATS,
  }));

  const striker: Disc = {
    id: nextId++,
    kind: "striker",
    x: 500,
    y: PF_MAX - BASE_OFF,
    vx: 0,
    vy: 0,
    r: STRIKER_R,
    m: STRIKER_M,
    alive: true,
    a: 0,
    w: 0,
  };
  const discs: Disc[] = [striker];

  const queenDisc = makeCoin("queen", 500, 500);
  discs.push(queenDisc);

  for (let i = 0; i < 6; i += 1) {
    const a = -Math.PI / 2 + (i * Math.PI) / 3;
    discs.push(makeCoin(i % 2 === 0 ? "white" : "black", 500 + Math.cos(a) * (COIN_R * 2 + 1), 500 + Math.sin(a) * (COIN_R * 2 + 1)));
  }
  for (let i = 0; i < 12; i += 1) {
    const a = -Math.PI / 2 + Math.PI / 12 + (i * Math.PI) / 6;
    discs.push(makeCoin(i % 2 === 0 ? "white" : "black", 500 + Math.cos(a) * (COIN_R * 4 + 2), 500 + Math.sin(a) * (COIN_R * 4 + 2)));
  }

  const strikerT: Record<number, number> = {};
  for (const p of players) strikerT[p.seat] = 500;

  const world: World = {
    seats: cfg.seats,
    players,
    turn: 0,
    discs,
    striker,
    queenDisc,
    potted: { white: [], black: [] },
    queen: { state: "board" },
    strikerT,
    shot: { potted: [], strikerPotted: false, contact: false },
    sinks: [],
    events: [],
    shotCount: 0,
    result: null,
    due: { white: 0, black: 0 },
    dry: 0,
  };
  resetStriker(world, 0);
  return world;
}

function freeSpotNearCenter(world: World, r: number): Vec {
  for (let ring = 0; ring < 26; ring += 1) {
    const rad = ring * 30;
    const steps = ring === 0 ? 1 : ring * 6;
    for (let k = 0; k < steps; k += 1) {
      const a = (k / steps) * Math.PI * 2;
      const p = { x: 500 + Math.cos(a) * rad, y: 500 + Math.sin(a) * rad };
      if (p.x - r < PF_MIN || p.x + r > PF_MAX || p.y - r < PF_MIN || p.y + r > PF_MAX) continue;
      const clear = world.discs.every(
        (o) => !o.alive || o === world.striker || dist(o, p) > o.r + r + 2,
      );
      if (clear) return p;
    }
  }
  return { x: 500, y: 500 };
}

export function reviveAt(world: World, d: Disc) {
  const p = freeSpotNearCenter(world, d.r);
  d.x = p.x;
  d.y = p.y;
  d.vx = 0;
  d.vy = 0;
  d.alive = true;
}

function reviveQueen(world: World) {
  if (!world.queenDisc.alive) reviveAt(world, world.queenDisc);
  world.queen = { state: "board" };
}

/** Baseline circle rule: the striker must cover an end circle completely or not touch it at all. */
const CIRCLE_R = 17;
export function legalT(t: number) {
  for (const c of [BASE_MIN, BASE_MAX]) {
    const d = t - c;
    const inner = STRIKER_R - CIRCLE_R; // fully covering
    const outer = STRIKER_R + CIRCLE_R; // clear of it
    if (Math.abs(d) > inner && Math.abs(d) < outer) {
      const sign = d === 0 ? 1 : Math.sign(d);
      // snap to whichever legal edge is nearer
      return Math.abs(d) - inner < outer - Math.abs(d) ? c + sign * inner : c + sign * outer;
    }
  }
  return t;
}

export function freeAlong(world: World, seat: number, t: number) {
  const bl = baselineFor(seat, world.seats);
  const blocked = (c: number) => {
    if (legalT(c) !== c) return true;
    const p = strikerPos(seat, world.seats, c);
    return world.discs.some(
      (d) => d.alive && d.kind !== "striker" && dist(d, p) < d.r + STRIKER_R + 1,
    );
  };
  const c0 = clamp(legalT(clamp(t, bl.min, bl.max)), bl.min, bl.max);
  if (!blocked(c0)) return c0;
  for (let off = 4; off <= 560; off += 4) {
    if (c0 - off >= bl.min && !blocked(c0 - off)) return c0 - off;
    if (c0 + off <= bl.max && !blocked(c0 + off)) return c0 + off;
  }
  return c0;
}

export function resetStriker(world: World, seat: number) {
  const s = world.striker;
  s.alive = true;
  s.vx = 0;
  s.vy = 0;
  const bl = baselineFor(seat, world.seats);
  const c = freeAlong(world, seat, clamp(world.strikerT[seat] ?? 500, bl.min, bl.max));
  const p = strikerPos(seat, world.seats, c);
  s.x = p.x;
  s.y = p.y;
}

export function placeStriker(world: World, seat: number, t: number) {
  const bl = baselineFor(seat, world.seats);
  world.strikerT[seat] = clamp(legalT(clamp(t, bl.min, bl.max)), bl.min, bl.max);
  if (world.turn !== seat) return;
  const c = freeAlong(world, seat, world.strikerT[seat]);
  const p = strikerPos(seat, world.seats, c);
  world.striker.x = p.x;
  world.striker.y = p.y;
  world.striker.alive = true;
  world.striker.vx = 0;
  world.striker.vy = 0;
}

/* ================= physics ================= */

function pot(world: World, d: Disc, pocket: Vec) {
  const sp = Math.hypot(d.vx, d.vy);
  // direction of travel; a coin crawling in with no speed just heads for the pocket centre
  const dir = sp > 1 ? { x: d.vx / sp, y: d.vy / sp } : norm({ x: pocket.x - d.x, y: pocket.y - d.y });
  world.sinks.push({
    x: d.x,
    y: d.y,
    px: pocket.x,
    py: pocket.y,
    dx: dir.x,
    dy: dir.y,
    sp,
    kind: d.kind,
    t: SINK_T,
    a: d.a,
    w: d.w + sp * 0.01,
  });
  world.events.push({ type: "pot", x: d.x, y: d.y, px: pocket.x, py: pocket.y, s: sp, kind: d.kind });
  d.alive = false;
  d.vx = 0;
  d.vy = 0;
  d.w = 0;
  if (d.kind === "striker") {
    world.shot.strikerPotted = true;
  } else {
    world.shot.potted.push(d);
    if (d.kind === "white") world.potted.white.push(d);
    else if (d.kind === "black") world.potted.black.push(d);
  }
}

function collide(world: World, a: Disc, b: Disc) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  const min = a.r + b.r;
  if (d === 0 || d >= min) return;
  const nx = dx / d;
  const ny = dy / d;
  const invA = 1 / a.m;
  const invB = 1 / b.m;
  const invSum = invA + invB;

  const overlap = min - d;
  a.x -= nx * overlap * (invA / invSum);
  a.y -= ny * overlap * (invA / invSum);
  b.x += nx * overlap * (invB / invSum);
  b.y += ny * overlap * (invB / invSum);

  const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (vn >= 0) return;
  world.shot.contact = true;
  const j = (-(1 + DISC_E) * vn) / invSum;
  a.vx -= j * nx * invA;
  a.vy -= j * ny * invA;
  b.vx += j * nx * invB;
  b.vy += j * ny * invB;

  // Tangential (friction) impulse at the contact point, including the discs' own spin.
  // Bounded by Coulomb friction (mu * j) so it can never add energy.
  const tx = -ny;
  const ty = nx;
  const vt = (b.vx - a.vx) * tx + (b.vy - a.vy) * ty - (a.w * a.r + b.w * b.r);
  if (Math.abs(vt) > 1e-3) {
    // a uniform disc's moment of inertia is m r^2 / 2, so spin adds 2/m to the tangent inverse mass
    const kT = invSum + 2 * invA + 2 * invB;
    const jt = clamp(-vt / kT, -DISC_MU * j, DISC_MU * j);
    a.vx -= jt * tx * invA;
    a.vy -= jt * ty * invA;
    b.vx += jt * tx * invB;
    b.vy += jt * ty * invB;
    // torque from the contact impulse: both discs' spin changes by -2*jt/(m*r)
    a.w -= (2 * jt * invA) / a.r;
    b.w -= (2 * jt * invB) / b.r;
  }

  const strength = -vn;
  if (strength > 60) {
    world.events.push({
      type: "hit",
      x: a.x + nx * a.r,
      y: a.y + ny * a.r,
      s: strength,
      striker: a.kind === "striker" || b.kind === "striker",
    });
  }
}

function wallBounce(world: World, d: Disc, axis: "x" | "y") {
  const vn = axis === "x" ? d.vx : d.vy;
  const speed = Math.abs(vn);
  // harder hits lose more energy (the rubber cushion compresses)
  const e = WALL_E_SOFT - (WALL_E_SOFT - WALL_E_HARD) * clamp(speed / 1800, 0, 1);
  if (axis === "x") {
    d.vx = -d.vx * e;
    // cushion friction turns some of the sliding along the wall into spin
    d.w += (d.vy / d.r) * 0.25;
    d.vy *= 0.97;
  } else {
    d.vy = -d.vy * e;
    d.w -= (d.vx / d.r) * 0.25;
    d.vx *= 0.97;
  }
  if (speed > 80) world.events.push({ type: "wall", x: d.x, y: d.y, s: speed });
}

function wallAndPocket(world: World, d: Disc, dt: number) {
  for (const p of POCKETS) {
    const dx = p.x - d.x;
    const dy = p.y - d.y;
    const pd = Math.hypot(dx, dy);
    if (pd < POCKET_CAPTURE) {
      const sp = Math.hypot(d.vx, d.vy);
      // A very fast coin clipping the jaw (not heading into the middle) rattles back out.
      const headOn = sp > 0 ? (d.vx * dx + d.vy * dy) / (sp * Math.max(pd, 0.001)) : 1;
      if (sp > RATTLE_SPEED && pd > POCKET_R * 0.55 && headOn < 0.9) {
        const nx = -dx / (pd || 1);
        const ny = -dy / (pd || 1);
        const vn = d.vx * nx + d.vy * ny;
        d.vx = (d.vx - 2 * vn * nx) * 0.45;
        d.vy = (d.vy - 2 * vn * ny) * 0.45;
        d.x = p.x + nx * (POCKET_CAPTURE + 1);
        d.y = p.y + ny * (POCKET_CAPTURE + 1);
        d.w += (Math.random() - 0.5) * 12;
        world.events.push({ type: "rattle", x: d.x, y: d.y, s: sp });
        return;
      }
      pot(world, d, p);
      return;
    }
  }

  if (POCKETS.some((p) => dist(p, d) < POCKET_SKIP)) return;

  if (d.x - d.r < PF_MIN && d.vx < 0) {
    d.x = PF_MIN + d.r;
    wallBounce(world, d, "x");
  } else if (d.x + d.r > PF_MAX && d.vx > 0) {
    d.x = PF_MAX - d.r;
    wallBounce(world, d, "x");
  }
  if (d.y - d.r < PF_MIN && d.vy < 0) {
    d.y = PF_MIN + d.r;
    wallBounce(world, d, "y");
  } else if (d.y + d.r > PF_MAX && d.vy > 0) {
    d.y = PF_MAX - d.r;
    wallBounce(world, d, "y");
  }
}

export function stepPhysics(world: World, dt: number) {
  for (const d of world.discs) {
    if (!d.alive) continue;
    // spin turns the coin visually and decays with board friction
    if (d.w !== 0) {
      d.a += d.w * dt;
      d.w *= Math.exp(-SPIN_DRAG * dt);
      if (Math.abs(d.w) < 0.05) d.w = 0;
    }
    const oldSp = Math.hypot(d.vx, d.vy);
    if (oldSp <= 0) continue;
    let sp = oldSp * Math.exp(-FRICTION_K * dt) - FRICTION_LIN * dt;
    if (sp < STOP_SPEED) sp = 0;
    const k = sp / oldSp;
    d.vx *= k;
    d.vy *= k;
    if (sp > 0) {
      d.x += d.vx * dt;
      d.y += d.vy * dt;
    }
  }

  for (let i = 0; i < world.discs.length; i += 1) {
    for (let j = i + 1; j < world.discs.length; j += 1) {
      const a = world.discs[i];
      const b = world.discs[j];
      if (a.alive && b.alive) collide(world, a, b);
    }
  }

  for (const d of world.discs) {
    if (!d.alive) continue;
    wallAndPocket(world, d, dt);
  }
}

/** Advance the pocket-drop animations. Runs every frame (not only during physics), so a coin
 *  potted on the last moving frame of a shot still finishes falling. */
export function tickSinks(world: World, dt: number) {
  if (!world.sinks.length) return;
  for (const s of world.sinks) {
    s.t -= dt;
    s.a += s.w * dt;
  }
  world.sinks = world.sinks.filter((s) => s.t > 0);
}

export function settled(world: World) {
  return world.discs.every((d) => !d.alive || (d.vx === 0 && d.vy === 0));
}

/* ================= shooting + rules ================= */

export function shootStriker(world: World, dir: Vec, power: number) {
  const s = world.striker;
  if (!s.alive) return false;
  const d = norm(dir);
  const stats = world.players[world.turn]?.stats ?? BASE_STATS;
  const top = maxSpeedFor(stats.power);
  const sp = MIN_POWER_SPEED + clamp(power, 0.05, 1) * (top - MIN_POWER_SPEED);
  s.m = massFor(stats.weight);
  s.vx = d.x * sp;
  s.vy = d.y * sp;
  world.shot = { potted: [], strikerPotted: false, contact: false };
  world.shotCount += 1;
  return true;
}

export type ShotResult = { extra: boolean; msg: string; over: boolean; ownPots: number; foul: boolean };

function aliveCoins(world: World, color: SeatColor) {
  return world.discs.filter((d) => d.alive && d.kind === color).length;
}

export function resolveShot(world: World): ShotResult {
  const shooterSeat = world.turn;
  const shooter = world.players[shooterSeat];
  const own = shooter.color;
  const opp: SeatColor = own === "white" ? "black" : "white";
  const shot = world.shot;
  const ownPots = shot.potted.filter((d) => d.kind === own);
  const oppPots = shot.potted.filter((d) => d.kind === opp);
  const queenPot = shot.potted.some((d) => d.kind === "queen");
  let extra = false;
  let msg = "";
  let foul = false;
  const who = shooter.name;

  /** Penalty: return one of the shooter's pocketed coins, or owe it ("due") if there is none. */
  const penalty = () => {
    const back = world.potted[own].pop();
    if (back) reviveAt(world, back);
    else world.due[own] += 1;
  };

  if (shot.strikerPotted) {
    foul = true;
    msg = `Foul! ${who} sank the striker.`;
    penalty();
    if (queenPot || (world.queen.state === "pending" && world.queen.seat === shooterSeat)) {
      reviveQueen(world);
      msg += " Queen back.";
    }
  } else {
    if (!shot.contact) msg = `${who} missed. Turn passes.`;
    else if (ownPots.length) msg = ownPots.length > 1 ? `${who} sank ${ownPots.length}!` : `${who} sank one!`;
    else if (oppPots.length) msg = `${who} sank a rival coin.`;
    else msg = `${who}: no pot.`;

    if (ownPots.length) extra = true;

    if (world.queen.state === "pending" && world.queen.seat === shooterSeat) {
      if (ownPots.length) {
        world.queen = { state: "owned", color: own };
        msg += " Queen covered!";
      } else if (aliveCoins(world, own) === 0) {
        world.queen = { state: "owned", color: own };
        msg += " Queen claimed.";
      } else {
        reviveQueen(world);
        extra = false;
        msg += " Queen uncovered, back to centre.";
      }
    } else if (queenPot) {
      if (ownPots.length) {
        world.queen = { state: "owned", color: own };
        msg += " Queen covered!";
      } else {
        world.queen = { state: "pending", seat: shooterSeat };
        extra = true;
        msg += " Now cover the queen!";
      }
    }
  }

  // Sinking the opponent's LAST coin while you still have your own is a foul: it comes back,
  // plus a penalty coin of yours, and the turn passes.
  if (aliveCoins(world, opp) === 0 && aliveCoins(world, own) > 0) {
    const back = world.potted[opp].pop();
    if (back) reviveAt(world, back);
    penalty();
    foul = true;
    extra = false;
    msg = `Foul! ${who} sank the last rival coin.`;
  }

  // Pay off any owed coins from this player's pots.
  let paid = 0;
  while (world.due[own] > 0 && world.potted[own].length > 0) {
    const back = world.potted[own].pop();
    if (back) reviveAt(world, back);
    world.due[own] -= 1;
    paid += 1;
  }
  if (paid) msg += " Due paid.";

  let over = false;
  const remOwn = aliveCoins(world, own);
  const remOpp = aliveCoins(world, opp);

  // Stalemate guard: a long run with nothing pocketed (e.g. last coins pinned against the
  // cushions behind the baselines) ends the board on coins left.
  world.dry = shot.potted.length ? 0 : world.dry + 1;
  if (world.dry >= DRY_LIMIT && remOwn > 0 && remOpp > 0) {
    const winner: SeatColor =
      remOwn !== remOpp
        ? remOwn < remOpp
          ? own
          : opp
        : world.queen.state === "owned"
          ? world.queen.color
          : opp;
    world.result = { winner };
    return { extra: false, msg: `No pots in ${DRY_LIMIT} shots. Board decided on coins left.`, over: true, ownPots: 0, foul };
  }

  if (remOwn === 0 && remOpp === 0) {
    world.result = { winner: own };
    over = true;
  } else if (remOwn === 0) {
    if (world.queen.state !== "owned") {
      const back = world.potted[own].pop();
      if (back) reviveAt(world, back);
      msg += " Cover the queen first.";
    } else {
      world.result = { winner: own };
      over = true;
    }
  }

  if (!over) {
    if (extra) world.turn = world.seats === 4 ? partner(shooterSeat, 4) : shooterSeat;
    else world.turn = (shooterSeat + 1) % world.players.length;
    resetStriker(world, world.turn);
  }

  return { extra, msg, over, ownPots: foul ? 0 : ownPots.length, foul };
}

/** Points for a finished board (standard carrom scoring): the winner scores one per coin the
 *  loser still has (on the board or owed), plus 3 for the queen if the winner covered it and
 *  their match total is still under 22. */
export function boardPoints(world: World, winnerTotal: number) {
  const winner = world.result?.winner;
  if (!winner) return 0;
  const loser: SeatColor = winner === "white" ? "black" : "white";
  const left = aliveCoins(world, loser) + world.due[loser];
  const queen = world.queen.state === "owned" && world.queen.color === winner && winnerTotal < 22 ? 3 : 0;
  return Math.max(1, left + queen);
}

/** The player on turn ran out of time: no shot, the turn passes (a pending queen goes back). */
export function skipTurn(world: World) {
  const seat = world.turn;
  if (world.queen.state === "pending" && world.queen.seat === seat) reviveQueen(world);
  world.turn = (seat + 1) % world.players.length;
  resetStriker(world, world.turn);
}

/** Leaderboard score from the given seat's perspective. */
export function scoreForSeat(world: World, seat = 0): number {
  const myColor = colorOfSeat(seat, world.seats);
  const coins = world.potted[myColor].length;
  const queen = world.queen.state === "owned" && world.queen.color === myColor ? 25 : 0;
  const win = world.result && world.result.winner === myColor ? 50 : 0;
  return coins * 10 + queen + win;
}

/* ================= snapshots (online sync) ================= */

const KIND_CODE: Record<Kind, number> = { white: 0, black: 1, queen: 2, striker: 3 };
const CODE_KIND: Record<number, Kind> = { 0: "white", 1: "black", 2: "queen", 3: "striker" };

export type Snap = {
  v: 1;
  seats: Seats;
  turn: number;
  queen: ["b"] | ["p", number] | ["o", SeatColor];
  pw: number;
  pb: number;
  discs: Array<[number, number, number, number, 0 | 1]>;
  shotCount: number;
  winner: SeatColor | null;
  /** owed coins (white, black) */
  due?: [number, number];
};

export function snapshotOf(world: World): Snap {
  return {
    v: 1,
    seats: world.seats,
    turn: world.turn,
    queen:
      world.queen.state === "board"
        ? ["b"]
        : world.queen.state === "pending"
          ? ["p", world.queen.seat]
          : ["o", world.queen.color],
    pw: world.potted.white.length,
    pb: world.potted.black.length,
    discs: world.discs
      .filter((d) => d.alive)
      .map((d) => [d.id, KIND_CODE[d.kind], Math.round(d.x * 10) / 10, Math.round(d.y * 10) / 10, 1] as [number, number, number, number, 0 | 1]),
    shotCount: world.shotCount,
    winner: world.result ? world.result.winner : null,
    due: [world.due.white, world.due.black],
  };
}

export function applySnapshot(world: World, snap: Snap): World {
  const discs: Disc[] = [];
  let striker = world.striker;
  let queenDisc = world.queenDisc;
  for (const [id, code, x, y] of snap.discs) {
    const kind = CODE_KIND[code];
    const d: Disc = {
      id,
      kind,
      x,
      y,
      vx: 0,
      vy: 0,
      r: kind === "striker" ? STRIKER_R : COIN_R,
      m: kind === "striker" ? massFor((world.players[snap.turn]?.stats ?? BASE_STATS).weight) : COIN_M,
      alive: true,
      a: world.discs.find((o) => o.id === id)?.a ?? 0,
      w: 0,
    };
    if (kind === "striker") striker = d;
    if (kind === "queen") queenDisc = d;
    discs.push(d);
  }
  // rebuild potted stacks with inert discs so fouls can revive coins
  const potted = { white: [] as Disc[], black: [] as Disc[] };
  const aliveIds = new Set(snap.discs.map((row) => row[0]));
  for (const old of world.discs) {
    if (old.kind !== "white" && old.kind !== "black") continue;
    if (!aliveIds.has(old.id)) potted[old.kind].push({ ...old, alive: false, vx: 0, vy: 0 });
  }
  while (potted.white.length < snap.pw) potted.white.push(makeCoin("white", 500, 500));
  while (potted.black.length < snap.pb) potted.black.push(makeCoin("black", 500, 500));

  world.seats = snap.seats;
  world.turn = snap.turn;
  world.queen =
    snap.queen[0] === "b"
      ? { state: "board" }
      : snap.queen[0] === "p"
        ? { state: "pending", seat: snap.queen[1] }
        : { state: "owned", color: snap.queen[1] };
  world.potted = potted;
  world.discs = discs;
  world.striker = striker;
  world.queenDisc = queenDisc;
  world.shotCount = snap.shotCount;
  world.result = snap.winner ? { winner: snap.winner } : null;
  world.due = { white: snap.due?.[0] ?? 0, black: snap.due?.[1] ?? 0 };
  world.dry = 0;
  world.sinks = [];
  world.events = [];
  return world;
}

export type LivePos = [number, number, number];

export function livePositions(world: World): LivePos[] {
  return world.discs
    .filter((d) => d.alive && (d.vx !== 0 || d.vy !== 0))
    .map((d) => [d.id, Math.round(d.x), Math.round(d.y)] as LivePos);
}

export function applyLive(world: World, positions: LivePos[]) {
  for (const [id, x, y] of positions) {
    const d = world.discs.find((row) => row.id === id);
    if (d && d.alive) {
      d.x = x;
      d.y = y;
    }
  }
}
