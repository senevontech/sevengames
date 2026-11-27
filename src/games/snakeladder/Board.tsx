/* The Snake & Ladder board (SVG, 1000 × 1000 board units) and the tokens on it.
   The printed board is drawn once (memo) on its own layer; tokens live on a second SVG layer on
   top and are moved by requestAnimationFrame writing transforms straight to the DOM, so a moving
   token never re-renders or repaints the board. */
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { BOARD, CELL, CELLS, cellCenter, cellRC, walkPath, type SLMove, type SLState } from "./engine";
import { LADDER_SHAPES, SNAKE_SHAPES, ladderAt, snakeAt, type LadderShape, type Pt, type SnakeShape } from "./geometry";
import { DICE_MS } from "./Dice";
import { sfx } from "./sound";
import { isLite } from "../../lib/perf";

/* ---------------- the printed board ---------------- */

const CREAM = "#f3e7cb";
const HUES = ["#dca892", "#b9c595", "#e6c77c", "#a7bfcd"];
const INK = "#3b2a1a";
const FRAME = 26;

function tileFill(n: number) {
  if (n === 1) return "url(#sl-start)";
  if (n === CELLS) return "url(#sl-finish)";
  const { row, col } = cellRC(n);
  if ((row + col) % 2 === 0) return CREAM;
  return HUES[Math.floor((row + col) / 2 + row) % HUES.length];
}

function Ladder({ l, lite }: { l: LadderShape; lite: boolean }) {
  const [A, B] = l.climb;
  const ang = (Math.atan2(B.y - A.y, B.x - A.x) * 180) / Math.PI;
  const len = Math.hypot(B.x - A.x, B.y - A.y);
  const over = 18;
  const total = len + over * 2;
  const RAIL = 19;
  const gap = 34;
  const count = Math.max(2, Math.floor((total - 16) / gap));
  const start = (total - (count - 1) * gap) / 2;
  const rungs = Array.from({ length: count }, (_, i) => start + i * gap);
  const body = (shadow: boolean) => (
    <>
      {rungs.map((x, i) => (
        <rect key={`r${i}`} x={x - 4.5} y={-RAIL} width={9} height={RAIL * 2} rx={3} fill={shadow ? "#2a1a0c" : "url(#sl-rung)"} />
      ))}
      {[-RAIL, RAIL].map((y) => (
        <rect key={y} x={0} y={y - 6} width={total} height={12} rx={5} fill={shadow ? "#2a1a0c" : "url(#sl-rail)"} />
      ))}
    </>
  );
  return (
    <g transform={`translate(${A.x} ${A.y}) rotate(${ang}) translate(${-over} 0)`}>
      {/* the shadow falls down-right on the board */}
      <g transform={`rotate(${-ang}) translate(7 9) rotate(${ang})`} opacity={lite ? 0.18 : 0.3} filter={lite ? undefined : "url(#sl-soft)"}>
        {body(true)}
      </g>
      {body(false)}
      {/* wood grain on the rails and rung ends pegged into them */}
      {[-RAIL, RAIL].map((y) => (
        <g key={`g${y}`} stroke="#4a2a10" strokeWidth={0.9} opacity={0.45} fill="none">
          <path d={`M4 ${y - 2.5} C ${total * 0.3} ${y - 4}, ${total * 0.6} ${y - 0.5}, ${total - 4} ${y - 2.8}`} />
          <path d={`M6 ${y + 2} C ${total * 0.35} ${y + 0.6}, ${total * 0.7} ${y + 3.5}, ${total - 6} ${y + 1.6}`} />
        </g>
      ))}
      {rungs.map((x, i) => (
        <g key={`p${i}`} fill="#3d220c" opacity={0.55}>
          <circle cx={x} cy={-RAIL} r={2.1} />
          <circle cx={x} cy={RAIL} r={2.1} />
        </g>
      ))}
    </g>
  );
}

function Snake({ s, lite }: { s: SnakeShape; lite: boolean }) {
  const { look, spine, half } = s;
  const H = spine[0];
  // the body in chunks, so the dorsal markings and highlight taper with it
  const chunks: { d: string; w: number }[] = [];
  const step = 6;
  for (let i = 0; i < spine.length - 1; i += step) {
    const pts = spine.slice(i, Math.min(spine.length, i + step + 1));
    chunks.push({ d: `M${pts.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" L")}`, w: half[Math.min(half.length - 1, i + (step >> 1))] });
  }
  // the light catches the upper-left side of the body
  const lightSide = spine.map((p, i) => {
    const a = spine[Math.max(0, i - 1)];
    const b = spine[Math.min(spine.length - 1, i + 1)];
    let nx = -(b.y - a.y);
    let ny = b.x - a.x;
    const l = Math.hypot(nx, ny) || 1;
    nx /= l;
    ny /= l;
    if (nx + ny > 0) {
      nx = -nx;
      ny = -ny;
    }
    return { x: p.x + nx * half[i] * 0.42, y: p.y + ny * half[i] * 0.42 };
  });
  const lightChunks: { d: string; w: number }[] = [];
  for (let i = 0; i < lightSide.length - 1; i += step) {
    const pts = lightSide.slice(i, Math.min(lightSide.length, i + step + 1));
    lightChunks.push({ d: `M${pts.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" L")}`, w: half[Math.min(half.length - 1, i + (step >> 1))] * 0.42 });
  }
  const deg = (s.headAngle * 180) / Math.PI;
  const id = `sl-sc-${s.head}`;
  return (
    <g>
      <defs>
        <clipPath id={id}>
          <path d={s.outline} />
        </clipPath>
      </defs>
      {/* shadow */}
      <g transform="translate(6 9)" opacity={lite ? 0.16 : 0.28} filter={lite ? undefined : "url(#sl-soft)"} fill="#1d1208">
        <path d={s.outline} />
        <ellipse cx={H.x} cy={H.y} rx={27} ry={21} transform={`rotate(${deg} ${H.x} ${H.y})`} />
      </g>
      {/* body */}
      <path d={s.outline} fill={look.base} />
      <g clipPath={`url(#${id})`}>
        {/* the belly side is paler */}
        {chunks.map((c, i) => (
          <path key={`b${i}`} d={c.d} fill="none" stroke={look.belly} strokeOpacity={0.28} strokeWidth={c.w * 2} transform="translate(3 4)" strokeLinecap="round" />
        ))}
        {/* dorsal saddles */}
        {chunks.map((c, i) => (
          <path key={`d${i}`} d={c.d} fill="none" stroke={look.band} strokeOpacity={0.62} strokeWidth={c.w * 1.25} strokeDasharray={`${Math.max(3, c.w * 0.75)} ${Math.max(5, c.w * 1.05)}`} strokeLinecap="round" />
        ))}
        {lightChunks.map((c, i) => (
          <path key={`l${i}`} d={c.d} fill="none" stroke={look.light} strokeOpacity={0.5} strokeWidth={c.w} strokeLinecap="round" />
        ))}
        {/* scales over everything */}
        <rect x={0} y={0} width={BOARD} height={BOARD} fill="url(#sl-scales)" opacity={0.5} />
      </g>
      <path d={s.outline} fill="none" stroke={look.dark} strokeWidth={2} strokeLinejoin="round" />
      {/* head */}
      <g transform={`translate(${H.x} ${H.y}) rotate(${deg})`}>
        <path d="M-14 -14 C 4 -22, 26 -18, 33 -6 C 37 0, 37 0, 33 6 C 26 18, 4 22, -14 14 C -20 8, -20 -8, -14 -14 Z" fill={look.base} stroke={look.dark} strokeWidth={2} />
        <path d="M-10 -9 C 6 -16, 22 -13, 29 -4 C 20 -6, 4 -6, -10 -3 Z" fill={look.light} opacity={0.55} />
        <path d="M-14 -14 C 4 -22, 26 -18, 33 -6 C 37 0, 37 0, 33 6 C 26 18, 4 22, -14 14 C -20 8, -20 -8, -14 -14 Z" fill="url(#sl-scales)" opacity={0.45} />
        <path d="M2 -8 C 10 -10, 18 -8, 22 -4 M2 8 C 10 10, 18 8, 22 4" stroke={look.band} strokeWidth={2.2} fill="none" opacity={0.6} strokeLinecap="round" />
        {/* eyes */}
        {[-1, 1].map((k) => (
          <g key={k}>
            <ellipse cx={14} cy={k * 10.5} rx={5.4} ry={4.4} fill="#f2d34a" stroke={look.dark} strokeWidth={1.4} />
            <ellipse cx={15} cy={k * 10.5} rx={1.3} ry={3.6} fill="#120c06" />
            <circle cx={13} cy={k * 10.5 - 1.6} r={1.1} fill="#fff" opacity={0.85} />
          </g>
        ))}
        {/* nostrils */}
        <circle cx={30} cy={-3.5} r={1.3} fill={look.dark} />
        <circle cx={30} cy={3.5} r={1.3} fill={look.dark} />
        {/* forked tongue */}
        <path d="M36 0 L47 0 L53 -4.5 M47 0 L53 4.5" stroke="#b3182a" strokeWidth={2.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </g>
  );
}

const PrintedBoard = memo(function PrintedBoard({ lite }: { lite: boolean }) {
  const cells = Array.from({ length: CELLS }, (_, i) => i + 1);
  const V = -FRAME;
  const VS = BOARD + FRAME * 2;
  return (
    <svg className="sl-board" viewBox={`${V} ${V} ${VS} ${VS}`} role="img" aria-label="Snake and ladder board">
      <defs>
        {/* paper: fine grain and soft mottling, printed onto the board */}
        <filter id="sl-grain" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={2} seed={7} result="n" />
          <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.25  0 0 0 0 0.18  0 0 0 0 0.1  0 0 0 0.55 -0.12" />
        </filter>
        <filter id="sl-mottle" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.006" numOctaves={3} seed={3} result="n" />
          <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.35  0 0 0 0 0.24  0 0 0 0 0.12  0 0 0 0.9 -0.32" />
        </filter>
        <filter id="sl-soft" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
        <radialGradient id="sl-vignette" cx="50%" cy="48%" r="72%">
          <stop offset="0.6" stopColor="#5a3a18" stopOpacity="0" />
          <stop offset="1" stopColor="#5a3a18" stopOpacity="0.28" />
        </radialGradient>
        <linearGradient id="sl-start" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7fa35c" />
          <stop offset="1" stopColor="#4f7838" />
        </linearGradient>
        <linearGradient id="sl-finish" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f3d27a" />
          <stop offset="0.5" stopColor="#d9a93e" />
          <stop offset="1" stopColor="#b98422" />
        </linearGradient>
        <linearGradient id="sl-rail" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d79c5c" />
          <stop offset="0.35" stopColor="#b5793e" />
          <stop offset="0.75" stopColor="#8c5526" />
          <stop offset="1" stopColor="#5d3514" />
        </linearGradient>
        <linearGradient id="sl-rung" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#c98d50" />
          <stop offset="0.5" stopColor="#a8703a" />
          <stop offset="1" stopColor="#734419" />
        </linearGradient>
        <linearGradient id="sl-frame" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7a2e22" />
          <stop offset="0.5" stopColor="#5e2119" />
          <stop offset="1" stopColor="#431510" />
        </linearGradient>
        {/* overlapping scales */}
        <pattern id="sl-scales" width="9" height="7" patternUnits="userSpaceOnUse">
          <path d="M0 7 Q 4.5 0 9 7" fill="none" stroke="#000" strokeOpacity="0.35" strokeWidth="0.9" />
          <path d="M-4.5 3.5 Q 0 -3.5 4.5 3.5 M4.5 3.5 Q 9 -3.5 13.5 3.5" fill="none" stroke="#000" strokeOpacity="0.35" strokeWidth="0.9" />
          <path d="M1.5 6 Q 4.5 2 7.5 6" fill="none" stroke="#fff" strokeOpacity="0.18" strokeWidth="0.8" />
        </pattern>
      </defs>

      {/* frame */}
      <rect x={V} y={V} width={VS} height={VS} rx={22} fill="url(#sl-frame)" />
      <rect x={V + 7} y={V + 7} width={VS - 14} height={VS - 14} rx={16} fill="none" stroke="#d9b56a" strokeWidth={2.2} opacity={0.85} />
      <rect x={V + 12} y={V + 12} width={VS - 24} height={VS - 24} rx={12} fill="none" stroke="#d9b56a" strokeWidth={0.9} opacity={0.6} />

      {/* squares */}
      {cells.map((n) => {
        const { row, col } = cellRC(n);
        return <rect key={n} x={col * CELL} y={(9 - row) * CELL} width={CELL} height={CELL} fill={tileFill(n)} />;
      })}
      {/* a printed bevel on every square: light top-left, a shade bottom-right */}
      <path
        d={cells
          .map((n) => {
            const { row, col } = cellRC(n);
            const x = col * CELL;
            const y = (9 - row) * CELL;
            return `M${x + 2} ${y + CELL - 3} V${y + 2} H${x + CELL - 3}`;
          })
          .join(" ")}
        fill="none"
        stroke="#fff"
        strokeOpacity={0.45}
        strokeWidth={2.5}
      />
      <path
        d={cells
          .map((n) => {
            const { row, col } = cellRC(n);
            const x = col * CELL;
            const y = (9 - row) * CELL;
            return `M${x + 3} ${y + CELL - 1.5} H${x + CELL - 1.5} V${y + 3}`;
          })
          .join(" ")}
        fill="none"
        stroke="#5a3a18"
        strokeOpacity={0.22}
        strokeWidth={2.5}
      />
      {/* grid */}
      <path
        d={Array.from({ length: 11 }, (_, i) => `M${i * CELL} 0 V${BOARD} M0 ${i * CELL} H${BOARD}`).join(" ")}
        stroke={INK}
        strokeOpacity={0.4}
        strokeWidth={1.4}
      />
      <rect x={0} y={0} width={BOARD} height={BOARD} fill="none" stroke={INK} strokeWidth={4} />

      {/* start and finish marks */}
      <text x={cellCenter(1).x} y={cellCenter(1).y + 26} className="sl-tag" fill="#f6efd6">
        START
      </text>
      <g transform={`translate(${cellCenter(CELLS).x} ${cellCenter(CELLS).y + 10})`}>
        <path d="M-22 10 L-26 -12 L-12 -2 L0 -18 L12 -2 L26 -12 L22 10 Z" fill="#fff4cf" stroke="#7a5310" strokeWidth={2.2} strokeLinejoin="round" opacity={0.9} />
        <rect x={-22} y={10} width={44} height={6} rx={2} fill="#7a5310" opacity={0.85} />
      </g>

      {/* paper texture under the pieces */}
      {!lite ? (
        <>
          <rect x={0} y={0} width={BOARD} height={BOARD} filter="url(#sl-mottle)" style={{ mixBlendMode: "multiply" }} />
          <rect x={0} y={0} width={BOARD} height={BOARD} filter="url(#sl-grain)" style={{ mixBlendMode: "multiply" }} />
        </>
      ) : null}

      {LADDER_SHAPES.map((l) => (
        <Ladder key={l.foot} l={l} lite={lite} />
      ))}
      {SNAKE_SHAPES.map((s) => (
        <Snake key={s.head} s={s} lite={lite} />
      ))}

      {/* numbers on top of everything, with a paper-coloured halo so a snake never hides one */}
      <g className="sl-nums">
        {cells.map((n) => {
          const { row, col } = cellRC(n);
          const special = n === 1 || n === CELLS;
          return (
            <text key={n} x={col * CELL + 9} y={(9 - row) * CELL + 27} className={`sl-num${special ? " is-special" : ""}`}>
              {n}
            </text>
          );
        })}
      </g>
      <rect x={0} y={0} width={BOARD} height={BOARD} fill="url(#sl-vignette)" pointerEvents="none" />
    </svg>
  );
});

/* ---------------- tokens ---------------- */

export type TokenPaint = { solid: string; light: string; dark: string };

export const TOKEN_PAINTS: TokenPaint[] = [
  { solid: "#d63a2f", light: "#ff9b86", dark: "#7a120c" }, // red
  { solid: "#2f6fd1", light: "#9cc3ff", dark: "#0f2f6a" }, // blue
  { solid: "#2e9a4a", light: "#9ae0a8", dark: "#0f4a1f" }, // green
  { solid: "#e9b21f", light: "#fff0a0", dark: "#7a5404" }, // yellow
];

/** where several tokens on one square sit (offsets from its centre) */
const SPREAD: Record<number, Pt[]> = {
  1: [{ x: 0, y: 0 }],
  2: [{ x: -21, y: 4 }, { x: 21, y: 4 }],
  3: [{ x: -21, y: 12 }, { x: 21, y: 12 }, { x: 0, y: -12 }],
  4: [{ x: -20, y: -8 }, { x: 20, y: -8 }, { x: -20, y: 22 }, { x: 20, y: 22 }],
};

/** where each seat rests (centre of its square, spread when sharing) */
function restPoints(pos: number[], skip = -1): Pt[] {
  const out: Pt[] = [];
  const groups = new Map<number, number[]>();
  pos.forEach((p, i) => {
    if (i !== skip) groups.set(p, [...(groups.get(p) ?? []), i]);
  });
  for (const [sq, seats] of groups) {
    const c = cellCenter(sq);
    // a little lower than centre so the square's number stays readable
    const base = { x: c.x, y: c.y + 8 };
    const spread = SPREAD[Math.min(4, seats.length)];
    seats.forEach((seat, k) => (out[seat] = { x: base.x + spread[k].x, y: base.y + spread[k].y }));
  }
  return out;
}

/* ---- motion: one move becomes a list of timed segments ---- */

type Seg =
  | { kind: "wait"; ms: number }
  | { kind: "hop"; ms: number; a: Pt; b: Pt; onStart?: () => void }
  | { kind: "path"; ms: number; pts: Pt[]; lens: number[]; total: number; onStart?: () => void }
  | { kind: "shake"; ms: number; at: Pt; onStart?: () => void };

const HOP_MS = 230;
const HOP_GAP = 40;

function pathSeg(pts: Pt[], ms: number, onStart?: () => void): Seg {
  const lens = [0];
  for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  return { kind: "path", ms, pts, lens, total: lens[lens.length - 1] || 1, onStart };
}

function along(seg: Extract<Seg, { kind: "path" }>, u: number): Pt {
  const d = u * seg.total;
  let i = 1;
  while (i < seg.lens.length - 1 && seg.lens[i] < d) i++;
  const l0 = seg.lens[i - 1];
  const l1 = seg.lens[i];
  const k = l1 > l0 ? (d - l0) / (l1 - l0) : 0;
  const a = seg.pts[i - 1];
  const b = seg.pts[i];
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
}

/** how long a move takes to show, dice included (the host adds this to the turn timer) */
export function moveDuration(m: SLMove): number {
  return segments(m, { x: 0, y: 0 }, { x: 0, y: 0 }).reduce((t, s) => t + s.ms, 0);
}

function segments(m: SLMove, from: Pt, rest: Pt): Seg[] {
  const segs: Seg[] = [{ kind: "wait", ms: DICE_MS + 60 }];
  if (m.kind === "blocked") {
    segs.push({ kind: "shake", ms: 360, at: from, onStart: () => sfx.blocked() });
    return segs;
  }
  let cur = from;
  walkPath(m.from, m.land).forEach((sq, i) => {
    const c = cellCenter(sq);
    const next = { x: c.x, y: c.y + 8 };
    segs.push({ kind: "hop", ms: HOP_MS, a: cur, b: next, onStart: () => window.setTimeout(() => sfx.step(i), HOP_MS * 0.8) });
    segs.push({ kind: "wait", ms: HOP_GAP });
    cur = next;
  });
  if (m.kind === "snake") {
    const s = snakeAt(m.land);
    if (s) {
      const tail = s.spine[s.spine.length - 1];
      const ms = Math.round(650 + Math.hypot(s.spine[0].x - tail.x, s.spine[0].y - tail.y) * 1.1);
      segs.push({ kind: "wait", ms: 160 });
      segs.push(pathSeg([cur, ...s.spine, rest], ms, () => sfx.snake(ms)));
      return segs;
    }
  }
  if (m.kind === "ladder") {
    const l = ladderAt(m.land);
    if (l) {
      const [A, B] = l.climb;
      const ms = Math.round(450 + Math.hypot(B.x - A.x, B.y - A.y) * 0.85);
      segs.push({ kind: "wait", ms: 140 });
      segs.push(pathSeg([cur, A, B, rest], ms, () => sfx.ladder(ms)));
      return segs;
    }
  }
  // settle into its place on the square (if it shares it)
  if (Math.hypot(rest.x - cur.x, rest.y - cur.y) > 1) segs.push({ kind: "hop", ms: 140, a: cur, b: rest });
  return segs;
}

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;

type TokenEls = { root: SVGGElement | null; pawn: SVGGElement | null; shadow: SVGEllipseElement | null };

function place(el: TokenEls, p: Pt, lift = 0) {
  if (el.root) el.root.style.transform = `translate(${p.x.toFixed(2)}px, ${p.y.toFixed(2)}px)`;
  if (el.pawn) el.pawn.style.transform = lift ? `translate(0px, ${(-lift * 12).toFixed(2)}px) scale(${(1 + lift * 0.16).toFixed(3)})` : "";
  if (el.shadow) {
    el.shadow.style.transform = lift ? `translate(${(lift * 4).toFixed(2)}px, ${(lift * 6).toFixed(2)}px) scale(${(1 - lift * 0.25).toFixed(3)})` : "";
    el.shadow.style.opacity = lift ? String(0.45 - lift * 0.2) : "";
  }
}

/** Animate the tokens: walks each new move square by square, then down the snake or up the
 *  ladder. `animating` is true from the roll until the token has settled (turns wait for it). */
export function useTokenMotion(st: SLState) {
  const els = useRef<TokenEls[]>([]);
  const [animating, setAnimating] = useState(false);
  const [mover, setMover] = useState<number | null>(null);
  const lastKey = useRef<string | null>(null);
  const raf = useRef(0);
  const shown = useRef<number[]>(st.pos.slice());

  const settleAll = (pos: number[], smooth: boolean) => {
    const rest = restPoints(pos);
    els.current.forEach((el, i) => {
      if (!el?.root || !rest[i]) return;
      el.root.classList.toggle("is-settling", smooth);
      place(el, rest[i]);
    });
  };

  const running = useRef(false);
  useLayoutEffect(() => {
    const m = st.last;
    const key = m ? `${st.rolls}:${m.seat}:${m.from}:${m.to}` : null;
    // the same move again (e.g. the host re-sent the state): let a walk in progress finish
    if (m && key === lastKey.current && running.current) return;
    if (!m || key === lastKey.current) {
      // a new game, or a state with nothing new to walk: snap
      lastKey.current = key;
      cancelAnimationFrame(raf.current);
      running.current = false;
      shown.current = st.pos.slice();
      settleAll(st.pos, false);
      setAnimating(false);
      setMover(null);
      return;
    }
    lastKey.current = key;
    cancelAnimationFrame(raf.current);
    running.current = true;
    // where everyone stood before this move (a move that arrived mid-walk snaps the old one)
    const before = st.pos.slice();
    before[m.seat] = m.from;
    shown.current = before;
    settleAll(before, false);
    const restBefore = restPoints(before);
    const restAfter = restPoints(st.pos);
    // the mover walks from the centre of its square
    const c0 = cellCenter(m.from);
    const start = before.filter((p) => p === m.from).length > 1 ? restBefore[m.seat] : { x: c0.x, y: c0.y + 8 };
    const segs = segments(m, start, restAfter[m.seat]);
    const el = els.current[m.seat];
    setAnimating(true);
    setMover(m.seat);
    if (el?.root) el.root.classList.remove("is-settling");

    let i = 0;
    let t0 = performance.now();
    let started = false;
    let othersMoved = false;
    const frame = (now: number) => {
      // tokens the mover leaves behind close up once it has stepped off their square
      if (!othersMoved && i > 0 && segs[i] && segs[i].kind !== "wait") {
        othersMoved = true;
        const restOthers = restPoints(before, m.seat);
        els.current.forEach((o, k) => {
          if (k === m.seat || before[k] !== m.from || !o?.root || !restOthers[k]) return;
          o.root.classList.add("is-settling");
          place(o, restOthers[k]);
        });
      }
      let seg = segs[i];
      while (seg) {
        if (!started) {
          started = true;
          if (seg.kind !== "wait") seg.onStart?.();
        }
        const t = (now - t0) / seg.ms;
        if (t < 1) break;
        // finish this segment, move to the next
        if (seg.kind === "hop") place(el, seg.b);
        else if (seg.kind === "path") place(el, seg.pts[seg.pts.length - 1]);
        else if (seg.kind === "shake") place(el, seg.at);
        t0 += seg.ms;
        i++;
        started = false;
        seg = segs[i];
      }
      if (!seg) {
        running.current = false;
        shown.current = st.pos.slice();
        settleAll(st.pos, true);
        setAnimating(false);
        setMover(null);
        return;
      }
      const t = Math.max(0, Math.min(1, (now - t0) / seg.ms));
      if (seg.kind === "hop") {
        const e = easeInOut(t);
        place(el, { x: seg.a.x + (seg.b.x - seg.a.x) * e, y: seg.a.y + (seg.b.y - seg.a.y) * e }, Math.sin(Math.PI * t));
      } else if (seg.kind === "path") {
        place(el, along(seg, easeInOutSine(t)), 0.35);
      } else if (seg.kind === "shake") {
        place(el, { x: seg.at.x + Math.sin(t * Math.PI * 6) * 7 * (1 - t), y: seg.at.y });
      }
      raf.current = requestAnimationFrame(frame);
    };
    raf.current = requestAnimationFrame(frame);
    // (no cleanup here: a re-render must not stop the walk; a new move or unmount does)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  /** put every token on its square (a board that has just appeared) */
  const sync = () => {
    if (!running.current) settleAll(shown.current, false);
  };
  return { els, animating, mover, sync };
}

function Pawn({ paint, seat }: { paint: TokenPaint; seat: number }) {
  const g = `sl-tok-${seat}`;
  return (
    <>
      <defs>
        <radialGradient id={`${g}-base`} cx="38%" cy="32%" r="75%">
          <stop offset="0" stopColor={paint.light} />
          <stop offset="0.5" stopColor={paint.solid} />
          <stop offset="1" stopColor={paint.dark} />
        </radialGradient>
        <radialGradient id={`${g}-top`} cx="36%" cy="30%" r="80%">
          <stop offset="0" stopColor="#fff" stopOpacity="0.95" />
          <stop offset="0.25" stopColor={paint.light} />
          <stop offset="1" stopColor={paint.solid} />
        </radialGradient>
      </defs>
      {/* base disc, its rim, the neck ring and the round head of a pawn seen from above */}
      <g transform="scale(0.86)">
      <circle r={25} fill={`url(#${g}-base)`} />
      <circle r={24} fill="none" stroke={paint.dark} strokeOpacity={0.7} strokeWidth={2} />
      <circle r={17} fill="none" stroke={paint.dark} strokeOpacity={0.35} strokeWidth={3} />
      <circle r={12.5} fill={`url(#${g}-top)`} stroke={paint.dark} strokeOpacity={0.5} strokeWidth={1.2} />
      <ellipse cx={-5} cy={-6} rx={5} ry={3.2} fill="#fff" opacity={0.7} transform="rotate(-30 -5 -6)" />
      </g>
    </>
  );
}

type BoardProps = {
  st: SLState;
  motion: ReturnType<typeof useTokenMotion>;
  /** whose turn it is (that token gets a ring) */
  turn: number | null;
  paints: TokenPaint[];
};

export default function SnakeLadderBoard({ st, motion, turn, paints }: BoardProps) {
  const [lite] = useState(isLite);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => motion.sync(), []);
  const V = -FRAME;
  const VS = BOARD + FRAME * 2;
  // draw the player whose turn it is (or who is moving) on top
  const order = Array.from({ length: st.n }, (_, i) => i).sort((a, b) => (a === (motion.mover ?? turn) ? 1 : b === (motion.mover ?? turn) ? -1 : 0));
  return (
    <div className="sl-board-box">
      <PrintedBoard lite={lite} />
      <svg className="sl-tokens" viewBox={`${V} ${V} ${VS} ${VS}`} aria-hidden="true">
        {order.map((i) => (
          <g
            key={i}
            className={`sl-token${turn === i && motion.mover === null ? " is-turn" : ""}`}
            ref={(r) => {
              motion.els.current[i] = { ...(motion.els.current[i] ?? { pawn: null, shadow: null }), root: r };
            }}
          >
            <ellipse
              className="sl-token-shadow"
              cx={3}
              cy={6}
              rx={22}
              ry={19}
              fill="#1a0f05"
              opacity={0.45}
              ref={(r) => {
                motion.els.current[i] = { ...(motion.els.current[i] ?? { root: null, pawn: null }), shadow: r };
              }}
            />
            <circle className="sl-token-ring" r={29} fill="none" stroke={paints[i].solid} strokeWidth={5} />
            <g
              className="sl-token-pawn"
              ref={(r) => {
                motion.els.current[i] = { ...(motion.els.current[i] ?? { root: null, shadow: null }), pawn: r };
              }}
            >
              <Pawn paint={paints[i]} seat={i} />
            </g>
          </g>
        ))}
      </svg>
    </div>
  );
}
