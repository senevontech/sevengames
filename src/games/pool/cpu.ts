/* The CPU player. It lists the pots it can see (object ball → pocket with clear paths, a
   cut it can make), simulates the most promising ones with the real physics, and keeps the
   shot that pots a ball and leaves the cue ball best placed for the next one. With nothing
   to pot it plays safe: a legal hit that leaves the opponent the least. Then it misses a
   little, by its level (aim and power noise). */
import { FOOT_SPOT, HEAD_X, L, MU_ROLL_PUBLIC, POCKETS, R, W, legalTargets, placeOk, playShot, speedOf, type PoolState, type Shot, type Vec } from "./engine";

export type CpuLevel = "easy" | "medium" | "hard";
export type CpuPlan = { shot: Shot; cue: Vec | null };

const LEVEL = {
  easy: { aim: 1.5, power: 0.12, top: 3, variants: 2, pick: 3 },
  medium: { aim: 0.55, power: 0.06, top: 6, variants: 4, pick: 1 },
  hard: { aim: 0.16, power: 0.03, top: 10, variants: 6, pick: 1 },
} as const;

type Cand = { cue: Vec; target: number; pocket: number; dir: Vec; cut: number; dCG: number; dTP: number; score: number };

const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);

/** Is the straight path from a to b clear of balls (a ball of radius R travelling it)? */
function clear(st: PoolState, a: Vec, b: Vec, skip: number[], cueAt: Vec) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy || 1;
  for (const ball of st.balls) {
    if (ball.potted || skip.includes(ball.id)) continue;
    const p = ball.id === 0 ? cueAt : ball;
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    const qx = a.x + dx * t;
    const qy = a.y + dy * t;
    if ((p.x - qx) ** 2 + (p.y - qy) ** 2 < (2 * R - 1) ** 2) return false;
  }
  return true;
}

/** Direct pots from `cue`, best first (heuristic: straighter and shorter is easier). */
function candidates(st: PoolState, cue: Vec): Cand[] {
  const out: Cand[] = [];
  for (const target of legalTargets(st)) {
    const t = st.balls[target];
    POCKETS.forEach((pk, pocket) => {
      const tp = { x: pk.aim.x - t.x, y: pk.aim.y - t.y };
      const dTP = Math.hypot(tp.x, tp.y);
      if (dTP < 1) return;
      const n = { x: tp.x / dTP, y: tp.y / dTP };
      // side pockets only take balls coming in fairly square
      if (pk.side && Math.abs(n.y) < 0.55) return;
      const ghost = { x: t.x - n.x * 2 * R, y: t.y - n.y * 2 * R };
      const cg = { x: ghost.x - cue.x, y: ghost.y - cue.y };
      const dCG = Math.hypot(cg.x, cg.y);
      if (dCG < 1) return;
      const dir = { x: cg.x / dCG, y: cg.y / dCG };
      const cut = dir.x * n.x + dir.y * n.y; // cos of the cut angle
      if (cut < 0.26) return;
      if (!clear(st, cue, ghost, [0, target], cue)) return;
      if (!clear(st, t, pk.aim, [target, 0], cue)) return;
      const score = (cut * cut) / (1 + (dCG + 1.6 * dTP) / 1400);
      out.push({ cue, target, pocket, dir, cut, dCG, dTP, score });
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** How good the table is for the player to shoot from `cue` (best pot's heuristic, 0..1). */
function positionValue(st: PoolState) {
  const c = candidates(st, st.balls[0]);
  return c.length ? c[0].score : 0;
}

/** Power to send the object ball `dTP` past the pocket after a `dCG` run with this cut. */
function powerFor(c: Cand, extra: number) {
  const vObj = Math.sqrt(2 * MU_ROLL_PUBLIC * (c.dTP + 3 * R)) * 1.5 + 120;
  const vCue = Math.sqrt((vObj / Math.max(0.3, c.cut)) ** 2 + 2 * MU_ROLL_PUBLIC * c.dCG) * 1.15 * extra;
  // invert speedOf
  const lo = speedOf(0);
  const hi = speedOf(1);
  return Math.max(0.05, Math.min(1, (vCue - lo) / (hi - lo)));
}

/** Where to put the cue ball with ball in hand: behind a pot, a comfortable distance back. */
function placements(st: PoolState): Vec[] {
  const out: Vec[] = [];
  for (const target of legalTargets(st)) {
    const t = st.balls[target];
    for (const pk of POCKETS) {
      const tp = { x: pk.aim.x - t.x, y: pk.aim.y - t.y };
      const d = Math.hypot(tp.x, tp.y) || 1;
      const n = { x: tp.x / d, y: tp.y / d };
      for (const [back, ang] of [
        [7, 0],
        [12, 0.3],
        [12, -0.3],
      ]) {
        const c = Math.cos(ang);
        const s = Math.sin(ang);
        const m = { x: n.x * c - n.y * s, y: n.x * s + n.y * c };
        const p = { x: t.x - n.x * 2 * R - m.x * back * R, y: t.y - n.y * 2 * R - m.y * back * R };
        if (placeOk(st, p.x, p.y)) out.push(p);
      }
    }
  }
  return out;
}

const gauss = () => {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

function withNoise(shot: Shot, level: CpuLevel): Shot {
  const lv = LEVEL[level];
  const a = (gauss() * lv.aim * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return {
    ...shot,
    dx: shot.dx * c - shot.dy * s,
    dy: shot.dx * s + shot.dy * c,
    power: Math.max(0.03, Math.min(1, shot.power * (1 + gauss() * lv.power))),
  };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** Plan the CPU's shot (async: it simulates candidates a few at a time to keep the page smooth). */
export async function cpuPlan(st: PoolState, level: CpuLevel): Promise<CpuPlan> {
  const me = st.turn;
  // the break: from the head string, straight into the head ball, hard
  if (st.isBreak) {
    const cue = { x: HEAD_X - 4 * R, y: W / 2 + (Math.random() - 0.5) * W * 0.4 };
    const dx = FOOT_SPOT.x - cue.x;
    const dy = FOOT_SPOT.y - cue.y;
    const d = Math.hypot(dx, dy);
    return { cue, shot: withNoise({ dx: dx / d, dy: dy / d, power: level === "easy" ? 0.8 : 0.97, sx: 0, sy: -0.15 }, level) };
  }
  const lv = LEVEL[level];
  const cues: Vec[] = st.inHand ? placements(st) : [st.balls[0]];
  if (st.inHand && cues.length === 0) cues.push(st.balls[0]);

  let pool: Cand[] = [];
  for (const cue of cues) pool.push(...candidates(st, cue).slice(0, 3));
  pool = pool.sort((a, b) => b.score - a.score).slice(0, lv.top);

  const variants: Array<[number, number]> = [
    [1, 0],
    [1, 0.45],
    [1, -0.45],
    [1.35, 0],
    [0.8, 0.2],
    [1.6, -0.3],
  ].slice(0, lv.variants) as Array<[number, number]>;

  type Tried = { plan: CpuPlan; value: number };
  const tried: Tried[] = [];
  let n = 0;
  const judge = (plan: CpuPlan) => {
    const { next } = playShot(st, plan.shot, plan.cue, false);
    let value: number;
    if (next.over) value = next.winner === me ? 10000 : -10000;
    else if (next.foul) value = -500;
    else if (next.turn === me) value = 1000 + 500 * positionValue(next);
    else value = -300 * positionValue(next);
    tried.push({ plan, value });
  };
  for (const c of pool) {
    for (const [extra, spin] of variants) {
      judge({ cue: st.inHand ? c.cue : null, shot: { dx: c.dir.x, dy: c.dir.y, power: powerFor(c, extra), sx: 0, sy: spin } });
      if (++n % 3 === 0) await tick();
    }
  }
  // nothing pots: play safe — a solid legal hit on each target at a couple of speeds
  if (!tried.some((t) => t.value >= 1000)) {
    const cue = st.inHand ? cues[0] : st.balls[0];
    for (const target of legalTargets(st)) {
      const t = st.balls[target];
      const dx = t.x - cue.x;
      const dy = t.y - cue.y;
      const d = Math.hypot(dx, dy) || 1;
      for (const off of [0, 0.6, -0.6]) {
        // aim a little off-centre for thinner hits
        const ox = t.x + (-dy / d) * off * R - cue.x;
        const oy = t.y + (dx / d) * off * R - cue.y;
        const od = Math.hypot(ox, oy) || 1;
        for (const power of [0.18, 0.32]) {
          judge({ cue: st.inHand ? cue : null, shot: { dx: ox / od, dy: oy / od, power, sx: 0, sy: 0 } });
          if (++n % 3 === 0) await tick();
        }
      }
    }
  }
  if (tried.length === 0) {
    // boxed in: hit towards the middle of the table
    const cue = st.balls[0];
    const dx = L / 2 - cue.x;
    const dy = W / 2 - cue.y;
    const d = Math.hypot(dx, dy) || 1;
    return { cue: st.inHand ? cue : null, shot: { dx: dx / d, dy: dy / d, power: 0.4, sx: 0, sy: 0 } };
  }
  tried.sort((a, b) => b.value - a.value);
  const choice = tried[Math.floor(Math.random() * Math.min(lv.pick, tried.length))];
  return { cue: choice.plan.cue, shot: withNoise(choice.plan.shot, level) };
}
