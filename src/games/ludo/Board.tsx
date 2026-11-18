/* The Ludo board (SVG, 15 × 15 units): yards, track, safe stars, home columns and tokens.
   Tokens hop square by square when they move; a captured token jumps back to its yard after. */
import { useEffect, useRef, useState } from "react";
import {
  COLOR_KEYS,
  HOME_CELLS,
  SAFE,
  START_SQUARES,
  TRACK_CELLS,
  YARD_ORIGINS,
  tokenPoint,
  type Color,
  type LudoState,
} from "./engine";
import type { LudoBoardTheme, LudoDiceStyle } from "../../lib/shopCatalog";

const STEP_MS = 130;

/** Token positions as shown: follows the state, but walks moves one square at a time. */
export function useShownTokens(s: LudoState) {
  const [shown, setShown] = useState(() => s.tokens.map((t) => [...t]));
  const [animating, setAnimating] = useState(false);
  const lastKey = useRef<string | null>(null);
  useEffect(() => {
    const last = s.last;
    const key = last ? `${s.rolls}:${last.color}:${last.token}:${last.from}:${last.to}` : null;
    if (!last || key === lastKey.current) {
      // nothing new to walk (a roll, a new game, or a state that arrived mid-walk): snap to it
      setShown(s.tokens.map((t) => [...t]));
      setAnimating(false);
      return;
    }
    lastKey.current = key;
    // walk from → to; captured tokens stay put until the mover lands
    const path: number[] = [];
    if (last.from === -1) path.push(0);
    else for (let p = last.from + 1; p <= last.to; p++) path.push(p);
    const before = s.tokens.map((t) => [...t]);
    before[last.color][last.token] = last.from;
    for (const c of last.captured) before[c.color][c.token] = shownRef.current[c.color]?.[c.token] ?? -1;
    setShown(before);
    setAnimating(true);
    let k = 0;
    const id = window.setInterval(() => {
      if (k < path.length) {
        const pos = path[k++];
        setShown((cur) => {
          const next = cur.map((t) => [...t]);
          next[last.color][last.token] = pos;
          return next;
        });
      } else {
        window.clearInterval(id);
        setShown(s.tokens.map((t) => [...t]));
        setAnimating(false);
      }
    }, STEP_MS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s]);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  return { shown, animating };
}

type Props = {
  s: LudoState;
  shown: number[][];
  theme: LudoBoardTheme;
  dice: LudoDiceStyle;
  /** Tokens of the current colour the player may tap (empty = none). */
  choices: number[];
  onPick: (token: number) => void;
  labels: Partial<Record<Color, string>>;
};

function Star({ x, y, color }: { x: number; y: number; color: string }) {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.16 : 0.36;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    pts.push(`${(x + Math.cos(a) * r).toFixed(3)},${(y + Math.sin(a) * r).toFixed(3)}`);
  }
  return <polygon points={pts.join(" ")} fill="none" stroke={color} strokeWidth={0.07} strokeLinejoin="round" />;
}

export default function LudoBoard({ s, shown, theme, dice, choices, onPick, labels }: Props) {
  const col = (c: number) => theme[COLOR_KEYS[c]];
  const turnColor = s.colors[s.turn];

  // stacked tokens on one square fan out a little
  const spots = new Map<string, number>();
  const placed: { c: Color; i: number; x: number; y: number }[] = [];
  for (const c of s.colors) {
    shown[c].forEach((pos, i) => {
      const [x, y] = tokenPoint(c, i, pos);
      const key = pos === -1 ? `y${c}${i}` : `${x.toFixed(2)},${y.toFixed(2)}`;
      const n = spots.get(key) ?? 0;
      spots.set(key, n + 1);
      placed.push({ c, i, x: x + (n % 2 ? 0.18 : -0.18) * Math.min(1, n), y: y + (n > 1 ? 0.18 : 0) * (n > 1 ? 1 : 0) });
    });
  }
  // tokens that can move are drawn last (on top) so they're easy to tap
  placed.sort((a, b) => Number(a.c === turnColor && choices.includes(a.i)) - Number(b.c === turnColor && choices.includes(b.i)));

  return (
    <svg className="lu-board" viewBox="0 0 15 15" role="img" aria-label="Ludo board">
      <rect x={0} y={0} width={15} height={15} rx={0.5} fill={theme.bg} />

      {/* yards */}
      {YARD_ORIGINS.map(([ox, oy], c) => (
        <g key={c} opacity={s.colors.includes(c as Color) ? 1 : 0.35}>
          <rect x={ox + 0.1} y={oy + 0.1} width={5.8} height={5.8} rx={0.45} fill={col(c)} />
          <rect x={ox + 0.9} y={oy + 0.9} width={4.2} height={4.2} rx={0.5} fill={theme.track} />
          {[0, 1, 2, 3].map((i) => {
            const [x, y] = tokenPoint(c as Color, i, -1);
            return <circle key={i} cx={x} cy={y} r={0.5} fill={col(c)} opacity={0.28} />;
          })}
          {labels[c as Color] ? (
            <text x={ox + 3} y={oy + (oy ? 5.62 : 0.68)} className="lu-yard-label" fill={theme.track}>
              {labels[c as Color]}
            </text>
          ) : null}
        </g>
      ))}

      {/* track */}
      {TRACK_CELLS.map(([x, y], i) => {
        const startOf = START_SQUARES.indexOf(i);
        return (
          <g key={i}>
            <rect x={x} y={y} width={1} height={1} fill={startOf >= 0 ? col(startOf) : theme.track} stroke={theme.line} strokeWidth={0.04} />
            {SAFE.has(i) && startOf < 0 ? <Star x={x + 0.5} y={y + 0.5} color={theme.line} /> : null}
          </g>
        );
      })}
      {/* home columns */}
      {HOME_CELLS.map((cells, c) =>
        cells.map(([x, y], k) => <rect key={`${c}-${k}`} x={x} y={y} width={1} height={1} fill={col(c)} stroke={theme.line} strokeWidth={0.04} />),
      )}
      {/* centre */}
      <polygon points="6,6 6,9 7.5,7.5" fill={col(0)} stroke={theme.line} strokeWidth={0.04} />
      <polygon points="6,6 9,6 7.5,7.5" fill={col(1)} stroke={theme.line} strokeWidth={0.04} />
      <polygon points="9,6 9,9 7.5,7.5" fill={col(2)} stroke={theme.line} strokeWidth={0.04} />
      <polygon points="6,9 9,9 7.5,7.5" fill={col(3)} stroke={theme.line} strokeWidth={0.04} />

      {/* tokens */}
      {placed.map(({ c, i, x, y }) => {
        const can = c === turnColor && choices.includes(i);
        return (
          <g
            key={`${c}-${i}`}
            className={`lu-token${can ? " can-move" : ""}`}
            style={{ transform: `translate(${x}px, ${y}px)` }}
            onClick={can ? () => onPick(i) : undefined}
            role={can ? "button" : undefined}
            aria-label={can ? `Move ${COLOR_KEYS[c]} token ${i + 1}` : undefined}
            tabIndex={can ? 0 : undefined}
            onKeyDown={can ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onPick(i)) : undefined}
          >
            {can ? <circle className="lu-token-ring" r={0.52} fill="none" stroke={col(c)} strokeWidth={0.08} /> : null}
            <ellipse cx={0} cy={0.24} rx={0.34} ry={0.12} fill="rgba(0,0,0,0.25)" />
            <circle r={0.36} fill={col(c)} stroke="#fff" strokeWidth={0.09} />
            <circle r={0.17} fill="#fff" opacity={0.85} />
            <circle r={0.11} fill={col(c)} />
            {dice.tokenShine ? <ellipse cx={-0.12} cy={-0.14} rx={0.12} ry={0.07} fill="#fff" opacity={0.7} /> : null}
          </g>
        );
      })}
    </svg>
  );
}

/** A die face with pips; tumbles when `rollId` changes. */
export function Die({ value, rollId, style, onClick, disabled, color }: { value: number; rollId: number; style: LudoDiceStyle; onClick?: () => void; disabled?: boolean; color: string }) {
  const [face, setFace] = useState(value || 1);
  const [tumbling, setTumbling] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      setFace(value || 1);
      return;
    }
    if (!value) return;
    setTumbling(true);
    let n = 0;
    const id = window.setInterval(() => {
      n++;
      if (n >= 8) {
        window.clearInterval(id);
        setFace(value);
        setTumbling(false);
      } else setFace(1 + Math.floor(Math.random() * 6));
    }, 60);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rollId]);
  const PIPS: Record<number, [number, number][]> = {
    1: [[50, 50]],
    2: [[28, 28], [72, 72]],
    3: [[28, 28], [50, 50], [72, 72]],
    4: [[28, 28], [72, 28], [28, 72], [72, 72]],
    5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
    6: [[28, 26], [72, 26], [28, 50], [72, 50], [28, 74], [72, 74]],
  };
  return (
    <button
      type="button"
      className={`lu-die${tumbling ? " is-rolling" : ""}${onClick && !disabled ? " is-ready" : ""}`}
      onClick={onClick}
      disabled={disabled || !onClick}
      aria-label={onClick && !disabled ? "Roll the dice" : `Dice shows ${value || "nothing yet"}`}
      style={{ "--lu-turn": color } as React.CSSProperties}
    >
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <rect x={4} y={4} width={92} height={92} rx={20} fill={style.face} stroke={style.edge} strokeWidth={5} />
        {PIPS[face].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={9} fill={style.pip} />
        ))}
      </svg>
    </button>
  );
}
