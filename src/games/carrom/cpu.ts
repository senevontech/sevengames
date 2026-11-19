/* Carrom CPU — always hard, and the same for every player (fixed CPU_STATS striker).

   For every legal striker spot on its baseline it tries every target coin into every pocket:
   - direct shots (ghost-ball aim) and one-cushion bank shots (striker bounces off a wall first)
   - power from the board's real friction: just enough for the coin to drop, not rattle out
   - rejects blocked lines and shots where the striker would likely follow into a pocket
   - covers the queen when it must, and goes for the queen when it can cover it
   No pot available → a soft safety shot that leaves its own coins near pockets.
   A tiny human-like aim error keeps it beatable. */
import {
  BASE_MAX,
  BASE_MIN,
  COIN_R,
  DISC_E,
  FRICTION_K,
  FRICTION_LIN,
  MIN_POWER_SPEED,
  PF_MAX,
  PF_MIN,
  POCKETS,
  POCKET_R,
  STRIKER_R,
  clamp,
  dist,
  freeAlong,
  minDirFor,
  norm,
  segDist,
  strikerPos,
  type Disc,
  type Vec,
  type World,
} from "./engine";
import { BASE_STATS, massFor, maxSpeedFor } from "./stats";

export type CpuPlan = { t: number; dir: Vec; power: number };

// keep in step with engine.ts physics (friction and disc bounce are imported from it)
const WALL_E_SOFT = 0.78;
const WALL_E_HARD = 0.62;
const WALL_SLIDE = 0.97;
/** Wall restitution for a given speed into the wall (matches engine.ts wallBounce). */
const wallE = (normalSpeed: number) => WALL_E_SOFT - (WALL_E_SOFT - WALL_E_HARD) * clamp(normalSpeed / 1800, 0, 1);
/** coin speed we want when it reaches the pocket (enough to drop, far below the rattle speed) */
const ARRIVE = 170;

/** Speed needed at the start of a straight run of `d` units to still have `end` at the far end. */
function speedNeeded(d: number, end: number) {
  let v = Math.max(end, 1);
  const step = 6;
  for (let s = 0; s < d; s += step) v += (FRICTION_K + FRICTION_LIN / v) * step;
  return v;
}

function clearPath(world: World, a: Vec, b: Vec, radius: number, skip: Disc[]) {
  for (const o of world.discs) {
    if (!o.alive || o.kind === "striker" || skip.includes(o)) continue;
    if (segDist(o, a, b) < o.r + radius - 1.5) return false;
  }
  return true;
}

/** Walls the striker's centre bounces off (inset by its radius). */
const WALLS: Array<{ axis: "x" | "y"; at: number }> = [
  { axis: "x", at: PF_MIN + STRIKER_R },
  { axis: "x", at: PF_MAX - STRIKER_R },
  { axis: "y", at: PF_MIN + STRIKER_R },
  { axis: "y", at: PF_MAX - STRIKER_R },
];

/**
 * Where to hit a wall so the striker, leaving `s`, comes off it towards `g`. The cushion keeps
 * only `e` of the speed into the wall (and 97% along it), so the bounce comes off flatter than a
 * mirror: the split point along the wall is solved from that, not from a mirror image.
 */
function bankPoint(s: Vec, g: Vec, w: { axis: "x" | "y"; at: number }, e: number): Vec | null {
  const ds = w.axis === "x" ? Math.abs(w.at - s.x) : Math.abs(w.at - s.y);
  const dg = w.axis === "x" ? Math.abs(w.at - g.x) : Math.abs(w.at - g.y);
  if (ds < 4 || dg < 4) return null;
  // both points must be on the playfield side of the wall line
  const side = (v: number) => Math.sign(v - w.at);
  if (w.axis === "x" ? side(s.x) !== side(g.x) : side(s.y) !== side(g.y)) return null;
  const D = w.axis === "x" ? g.y - s.y : g.x - s.x;
  const k = WALL_SLIDE / e;
  const along = D / (1 + (k * dg) / ds);
  return w.axis === "x" ? { x: w.at, y: s.y + along } : { x: s.x + along, y: w.at };
}

/** Would a striker leaving `from` along `dir` for `len` units run into a pocket? */
function scratchRisk(from: Vec, dir: Vec, len: number) {
  const end = { x: from.x + dir.x * len, y: from.y + dir.y * len };
  return POCKETS.some((p) => segDist(p, from, end) < POCKET_R + 6);
}

type Candidate = CpuPlan & { score: number };

export function planCpuShot(world: World): CpuPlan {
  const seat = world.turn;
  const me = world.players[seat];
  const own = me.color;
  // plan with exactly the striker the engine will shoot with (shootStriker: stats ?? BASE_STATS),
  // so power is never misjudged, e.g. for CPUs filling empty seats in an online room
  const stats = me.stats ?? BASE_STATS;
  const top = maxSpeedFor(stats.power);
  const ms = massFor(stats.weight);

  const ownCoins = world.discs.filter((d) => d.alive && d.kind === own);
  const mustCover = world.queen.state === "pending" && world.queen.seat === seat;
  const queenFree = !mustCover && world.queen.state === "board" && world.queenDisc.alive;
  // Your last coin can't be pocketed while the queen is still on the board (it just comes back),
  // so with one coin left the queen is the only real target. With more, both are fair game.
  const targets: Disc[] =
    queenFree && ownCoins.length === 1 ? [world.queenDisc] : queenFree ? [...ownCoins, world.queenDisc] : [...ownCoins];

  let best: Candidate | null = null;
  const consider = (c: Candidate) => {
    if (!best || c.score > best.score) best = c;
  };

  for (let i = 0; i <= 32; i += 1) {
    const raw = BASE_MIN + ((BASE_MAX - BASE_MIN) * i) / 32;
    const t = freeAlong(world, seat, raw);
    if (Math.abs(t - raw) > 6) continue; // that spot is taken; another sample covers the free one
    const s = strikerPos(seat, world.seats, t);

    for (const coin of targets) {
      for (const p of POCKETS) {
        // the coin's own run into the pocket must be clear
        const dp = norm({ x: p.x - coin.x, y: p.y - coin.y });
        const td = dist(coin, p);
        if (!clearPath(world, coin, p, coin.r, [coin])) continue;
        let ghost = { x: coin.x - dp.x * (coin.r + STRIKER_R), y: coin.y - dp.y * (coin.r + STRIKER_R) };
        // A coin hugging a wall: the perfect contact spot is inside the wall. Use the nearest
        // spot the striker can reach; the wall keeps a near-straight hit running along it.
        const lo = PF_MIN + STRIKER_R + 1;
        const hi = PF_MAX - STRIKER_R - 1;
        if (ghost.x < lo || ghost.x > hi || ghost.y < lo || ghost.y > hi) {
          const gx = clamp(ghost.x, lo, hi);
          const gy = clamp(ghost.y, lo, hi);
          const n = norm({ x: coin.x - gx, y: coin.y - gy });
          if (n.x * dp.x + n.y * dp.y < 0.9) continue;
          ghost = { x: coin.x - n.x * (coin.r + STRIKER_R), y: coin.y - n.y * (coin.r + STRIKER_R) };
          if (ghost.x < lo - 1 || ghost.x > hi + 1 || ghost.y < lo - 1 || ghost.y > hi + 1) continue;
        }

        // coin speed needed after impact → striker speed needed at contact
        const coinStart = speedNeeded(td, ARRIVE);

        /** Score a shot along `legs`; returns the start speed it needs (or null if impossible).
         *  `e` = wall restitution assumed for a bank; `commit` = add it to the candidates. */
        const tryShot = (aimAt: Vec, path: number, bank: boolean, legs: Array<[Vec, Vec]>, e = 1, commit = true): number | null => {
          const toAim = { x: aimAt.x - s.x, y: aimAt.y - s.y };
          const L = Math.hypot(toAim.x, toAim.y);
          if (L < STRIKER_R + 6) return null;
          const dir = { x: toAim.x / L, y: toAim.y / L };
          // the last leg arrives at the ghost point: its direction sets the cut
          const [la, lb] = legs[legs.length - 1];
          const inDir = norm({ x: lb.x - la.x, y: lb.y - la.y });
          const cosCut = inDir.x * dp.x + inDir.y * dp.y;
          if (cosCut < (bank ? 0.55 : 0.3)) return null;
          // you can only shoot forwards, into the board
          const inward = norm(minDirFor(seat, world.seats));
          if (dir.x * inward.x + dir.y * inward.y < 0.08) return null;
          for (const [a, b] of legs) if (!clearPath(world, a, b, STRIKER_R, [coin])) return null;

          const transfer = (cosCut * (1 + DISC_E) * ms) / (ms + 1);
          const atContact = coinStart / Math.max(0.2, transfer);
          // a bank loses speed into the wall: work back leg by leg
          const v0 = bank
            ? speedNeeded(dist(legs[0][0], legs[0][1]), speedNeeded(dist(legs[1][0], legs[1][1]), atContact) / Math.max(0.5, e))
            : speedNeeded(path, atContact);
          if (v0 > top * 0.98) return null; // can't hit it that hard
          if (!commit) return v0;

          // where the striker goes after contact: along the tangent, at the speed it keeps
          const tang = norm({ x: inDir.x - dp.x * cosCut, y: inDir.y - dp.y * cosCut });
          const keep = atContact * Math.sqrt(Math.max(0, 1 - cosCut * cosCut));
          const slide = keep > 40 ? Math.min(700, (keep * keep) / 900) : 0;
          const scratch = slide > 0 && scratchRisk(ghost, tang, slide);

          let score =
            cosCut * 2.4 - path / 1500 - td / 1600 - (bank ? 0.9 : 0) - (scratch ? 2.5 : 0) - (v0 / top) * 0.35;
          if (coin.kind === "queen") score += 0.6;
          if (mustCover) score += 0.3;
          consider({ t, dir, power: clamp((v0 - MIN_POWER_SPEED) / (top - MIN_POWER_SPEED), 0.05, 1), score });
          return v0;
        };

        // direct
        tryShot(ghost, Math.hypot(ghost.x - s.x, ghost.y - s.y), false, [[s, ghost]]);

        // one-cushion banks. The bounce angle depends on how hard it hits the wall, which depends
        // on the power, which depends on the bounce: guess, then refine once.
        for (const w of WALLS) {
          let e = 0.7;
          let b: Vec | null = null;
          for (let pass = 0; pass < 2; pass += 1) {
            b = bankPoint(s, ghost, w, e);
            if (!b) break;
            // no banking into a pocket's mouth, and the bounce must be on the wall itself
            if (POCKETS.some((pk) => dist(pk, b!) < POCKET_R + STRIKER_R + 10) || b.x < PF_MIN || b.x > PF_MAX || b.y < PF_MIN || b.y > PF_MAX) {
              b = null;
              break;
            }
            const legs: Array<[Vec, Vec]> = [
              [s, b],
              [b, ghost],
            ];
            const path = dist(s, b) + dist(b, ghost);
            if (pass === 0) {
              const v0 = tryShot(b, path, true, legs, e, false);
              if (v0 === null) {
                b = null;
                break;
              }
              // speed into the wall: what's left after the first leg, times the angle of approach
              const leg1 = dist(s, b);
              const vAtWall = Math.max(0, v0 - (FRICTION_K * v0 + FRICTION_LIN) * (leg1 / Math.max(300, v0)));
              const ds = w.axis === "x" ? Math.abs(w.at - s.x) : Math.abs(w.at - s.y);
              e = wallE(vAtWall * (ds / Math.max(1, leg1)));
            } else {
              tryShot(b, path, true, legs, e, true);
            }
          }
        }
      }
    }
  }

  let plan: CpuPlan;
  if (best) {
    const b = best as Candidate;
    plan = { t: b.t, dir: b.dir, power: b.power };
  } else {
    plan = safetyShot(world, seat, ownCoins, top);
  }

  // Hard CPU: small aim error, an occasional slightly worse shot.
  const gauss = (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
  const err = gauss * (Math.random() < 0.06 ? 0.022 : 0.006);
  const ca = Math.cos(err);
  const sa = Math.sin(err);
  plan.dir = { x: plan.dir.x * ca - plan.dir.y * sa, y: plan.dir.x * sa + plan.dir.y * ca };
  plan.power = clamp(plan.power * (1 + gauss * 0.025), 0.05, 1);
  return plan;
}

/** No clean pot: push a coin (own first) firmly towards a pocket, straight or off one wall,
 *  so the board keeps moving. A little randomness stops it repeating a shot that didn't work. */
function safetyShot(world: World, seat: number, ownCoins: Disc[], top: number): CpuPlan {
  const inward = norm(minDirFor(seat, world.seats));
  const forward = (d: Vec) => d.x * inward.x + d.y * inward.y >= 0.08;
  // Only ever push your own coins (or the queen) towards pockets, never the opponent's.
  // With one coin left and the queen still out, that coin can't be potted yet: work the queen.
  const queen = world.queenDisc.alive && world.queen.state === "board" ? [world.queenDisc] : [];
  const lastCoin = ownCoins.length === 1 && queen.length > 0;
  const pools: Disc[][] = lastCoin ? [queen] : [ownCoins, queen];
  for (const pool of pools) {
    let best: (CpuPlan & { score: number }) | null = null;
    for (let i = 0; i <= 16; i += 1) {
      const raw = BASE_MIN + ((BASE_MAX - BASE_MIN) * i) / 16;
      const t = freeAlong(world, seat, raw);
      const s = strikerPos(seat, world.seats, t);
      for (const coin of pool) {
        // straight at it, or off one wall when the straight line is blocked / backwards
        const routes: Array<{ aim: Vec; legs: Array<[Vec, Vec]>; len: number }> = [
          { aim: coin, legs: [[s, coin]], len: dist(s, coin) },
        ];
        for (const w of WALLS) {
          const b = bankPoint(s, coin, w, 0.68);
          if (!b || b.x < PF_MIN || b.x > PF_MAX || b.y < PF_MIN || b.y > PF_MAX) continue;
          if (POCKETS.some((p) => dist(p, b) < POCKET_R + STRIKER_R + 10)) continue;
          routes.push({ aim: b, legs: [[s, b], [b, coin]], len: dist(s, b) + dist(b, coin) });
        }
        for (const r of routes) {
          const dir = norm({ x: r.aim.x - s.x, y: r.aim.y - s.y });
          if (!forward(dir)) continue;
          if (!r.legs.every(([a, b], li) => clearPath(world, a, b, STRIKER_R, li === r.legs.length - 1 ? [coin] : []))) continue;
          const last = r.legs[r.legs.length - 1];
          const push = norm({ x: last[1].x - last[0].x, y: last[1].y - last[0].y });
          const near = Math.min(...POCKETS.map((p) => segDist(p, coin, { x: coin.x + push.x * 500, y: coin.y + push.y * 500 })));
          const score = -near / 120 - r.len / 900 - (r.legs.length > 1 ? 0.4 : 0) + Math.random() * 0.3;
          // a coin packed in a cluster gets a full break; otherwise a firm push
          const crowd = world.discs.filter((o) => o.alive && o !== coin && o.kind !== "striker" && dist(o, coin) < 52).length;
          const v0 = speedNeeded(r.len, 900) / (r.legs.length > 1 ? 0.68 : 1);
          const power = crowd >= 3 ? 0.95 : clamp((v0 - MIN_POWER_SPEED) / (top - MIN_POWER_SPEED), 0.5, 0.9);
          if (!best || score > best.score) {
            best = { t, dir, power, score };
          }
        }
      }
    }
    if (best) return { t: best.t, dir: best.dir, power: best.power };
  }
  // completely boxed in: a firm shot into the board at a random angle to shake things up
  const t = freeAlong(world, seat, BASE_MIN + Math.random() * (BASE_MAX - BASE_MIN));
  const s = strikerPos(seat, world.seats, t);
  const a = (Math.random() - 0.5) * 1.2;
  const base = norm({ x: 500 - s.x, y: 500 - s.y + COIN_R * 0.3 });
  return { t, dir: { x: base.x * Math.cos(a) - base.y * Math.sin(a), y: base.x * Math.sin(a) + base.y * Math.cos(a) }, power: 0.8 };
}
