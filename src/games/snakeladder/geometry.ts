/* Snake & ladder shapes in board units, shared by the board drawing and the token animation, so a
   token sliding down a snake follows exactly the body you see. */
import { cellCenter, LADDERS, SNAKES } from "./engine";

export type Pt = { x: number; y: number };

export type SnakeLook = { base: string; dark: string; light: string; belly: string; band: string };

/** Natural snake colourings (one per snake, in head order). */
const LOOKS: SnakeLook[] = [
  { base: "#5b8a2e", dark: "#2c4a14", light: "#a9cf6a", belly: "#e3e0a0", band: "#22380f" }, // grass green
  { base: "#a4572a", dark: "#5a2a10", light: "#e2a06a", belly: "#f0d2a0", band: "#4a1f0a" }, // rust
  { base: "#2f6f6a", dark: "#143634", light: "#78b7ae", belly: "#d8e8c8", band: "#0f2826" }, // teal
  { base: "#a8892a", dark: "#5a4510", light: "#e6cd72", belly: "#f4e8b8", band: "#3f2f08" }, // ochre
  { base: "#8e2d27", dark: "#4a110d", light: "#d77a62", belly: "#f0c8a8", band: "#2e0907" }, // crimson
  { base: "#4c5d34", dark: "#232c15", light: "#97a86a", belly: "#dcdcb0", band: "#1a2010" }, // olive
  { base: "#6b4a2f", dark: "#35220f", light: "#b28b62", belly: "#e8d2b0", band: "#241505" }, // brown
  { base: "#3c4f6a", dark: "#1a2536", light: "#8aa0c0", belly: "#dfe3d0", band: "#121a26" }, // slate
];

export type SnakeShape = {
  head: number;
  tail: number;
  look: SnakeLook;
  /** centre line, head (index 0) → tail */
  spine: Pt[];
  /** body half-width at each spine point */
  half: number[];
  /** body outline (closed path) */
  outline: string;
  /** direction the head faces (radians) */
  headAngle: number;
};

const SAMPLES = 72;
const BODY = 15; // half-width at the neck

function buildSnake(head: number, tail: number, index: number): SnakeShape {
  const H = cellCenter(head);
  const T = cellCenter(tail);
  const dx = T.x - H.x;
  const dy = T.y - H.y;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  // the normal (perpendicular to head → tail)
  const nx = -uy;
  const ny = ux;
  // longer snakes wind more; amplitude grows with length but stays inside a cell or so
  const waves = Math.max(1, Math.round((len / 260) * 2) / 2);
  const amp = Math.min(62, 22 + len * 0.09);
  const sign = index % 2 === 0 ? 1 : -1;
  const spine: Pt[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    // envelope: 0 at both ends so the head and tail sit on their squares' centres
    const env = Math.pow(Math.sin(Math.PI * t), 0.75);
    const w = sign * amp * env * Math.sin(Math.PI * 2 * waves * t + (index % 3) * 0.35);
    spine.push({ x: H.x + dx * t + nx * w, y: H.y + dy * t + ny * w });
  }
  // width: a short neck behind the head, full body, then a long taper to a fine tail
  const half = spine.map((_, i) => {
    const t = i / SAMPLES;
    const neck = t < 0.05 ? 0.78 + (t / 0.05) * 0.22 : 1;
    const taper = 1 - 0.88 * Math.pow(Math.max(0, t - 0.08) / 0.92, 1.35);
    return BODY * neck * taper + 1.2;
  });
  // the outline: left side down, right side back up
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i < spine.length; i++) {
    const a = spine[Math.max(0, i - 1)];
    const b = spine[Math.min(spine.length - 1, i + 1)];
    const tx = b.x - a.x;
    const ty = b.y - a.y;
    const tl = Math.hypot(tx, ty) || 1;
    const px = -ty / tl;
    const py = tx / tl;
    left.push({ x: spine[i].x + px * half[i], y: spine[i].y + py * half[i] });
    right.push({ x: spine[i].x - px * half[i], y: spine[i].y - py * half[i] });
  }
  const f = (p: Pt) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  const outline = `M${f(left[0])} ${left.slice(1).map((p) => `L${f(p)}`).join(" ")} ${right
    .reverse()
    .map((p) => `L${f(p)}`)
    .join(" ")}Z`;
  const s1 = spine[1];
  const headAngle = Math.atan2(H.y - s1.y, H.x - s1.x);
  return { head, tail, look: LOOKS[index % LOOKS.length], spine, half, outline, headAngle };
}

export const SNAKE_SHAPES: SnakeShape[] = Object.entries(SNAKES)
  .map(([h, t]) => [Number(h), t] as const)
  .sort((a, b) => a[0] - b[0])
  .map(([h, t], i) => buildSnake(h, t, i));

export const snakeAt = (head: number) => SNAKE_SHAPES.find((s) => s.head === head) ?? null;

export type LadderShape = {
  foot: number;
  top: number;
  /** rail ends (left / right), foot → top */
  rails: [Pt, Pt][];
  rungs: [Pt, Pt][];
  /** the line a token climbs */
  climb: [Pt, Pt];
};

const RAIL = 19; // half the ladder's width
const RUNG_GAP = 34;

function buildLadder(foot: number, top: number): LadderShape {
  const A = cellCenter(foot);
  const B = cellCenter(top);
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy * RAIL;
  const py = ux * RAIL;
  // the rails run a little past both squares' centres
  const over = 18;
  const a = { x: A.x - ux * over, y: A.y - uy * over };
  const b = { x: B.x + ux * over, y: B.y + uy * over };
  const rails: [Pt, Pt][] = [
    [
      { x: a.x + px, y: a.y + py },
      { x: b.x + px, y: b.y + py },
    ],
    [
      { x: a.x - px, y: a.y - py },
      { x: b.x - px, y: b.y - py },
    ],
  ];
  const rungs: [Pt, Pt][] = [];
  const total = len + over * 2;
  const count = Math.max(2, Math.floor((total - 16) / RUNG_GAP));
  const start = (total - (count - 1) * RUNG_GAP) / 2;
  for (let i = 0; i < count; i++) {
    const d = start + i * RUNG_GAP;
    const c = { x: a.x + ux * d, y: a.y + uy * d };
    rungs.push([
      { x: c.x + px, y: c.y + py },
      { x: c.x - px, y: c.y - py },
    ]);
  }
  return { foot, top, rails, rungs, climb: [A, B] };
}

export const LADDER_SHAPES: LadderShape[] = Object.entries(LADDERS).map(([f, t]) => buildLadder(Number(f), t));

export const ladderAt = (foot: number) => LADDER_SHAPES.find((l) => l.foot === foot) ?? null;
