/* Arrows — tap an arrow to send it off the board.
   Each arrow is a bent line ending in a head. Tapped, it slides out snake-style: the head runs
   straight on in the direction it points and the body follows its own path. If another arrow sits
   in that straight line, it bumps into it and you lose a life. Clear the board to level up.
   Quick successive clears build a combo multiplier.

   Levels are generated so they are always solvable: arrows are placed one by one, each only where
   its exit line is clear of the arrows already placed — so removing them in reverse order works.

   The level reached is saved (src/lib/progress.ts), so players pick up where they left off. Running
   out of lives retries the same level; "Reset progress" goes back to level 1.

   Shop extras (src/lib/shop.tsx): arrow skins, exit effects, and hint / undo packs used once the
   free per-level hints run out. Board effects are drawn on canvases (./arrowsFx.ts) so they don't
   re-render the board. */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { GameProps } from "./index";
import { reducedMotion } from "./fx";
import { ArrowsFx, type FxStyle } from "./arrowsFx";
import type { MatchMode, Progress } from "./arrowsNet";
import { useGameProgress } from "../lib/progress";
import { useShop } from "../lib/shop";
import { useTokens } from "../lib/tokens";
import { formatTokens } from "../lib/currency";
import { BOOSTERS, fxIdOf, skinOf, type BoosterItem } from "../lib/shopCatalog";
import TokenIcon from "../components/TokenIcon";
import "./arrows.css";
import { GameShopButton } from "./gameShop";

type Dir = 0 | 1 | 2 | 3; // up, right, down, left
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];

type Arrow = { id: number; cells: number[]; dir: Dir };
type Level = { cols: number; rows: number; arrows: Arrow[] };

const CELL = 40;
const LIVES = 3;
/* Online matches (see arrowsOnline.tsx) */
const RACE_LEVEL = 6; // race board: the same mid-size board for both players
const RACE_LIVES = 3;
const INF_SIZE_LEVEL = 3; // infinite board size (10 × 14)
const INF_LIVES = 2;
const INF_START_ARROWS = 10;
/** Lives per match mode (also shown on the opponent's bar). */
export const MATCH_LIVES = { race: RACE_LIVES, infinite: INF_LIVES } as const;
const MATCH_HINTS = 2; // free hints per match, same for both (bought boosters are off online)
/** Infinite: ms between spawns, faster over time (3.2 s → 0.9 s over ~65 s). */
const spawnDelay = (elapsedMs: number) => Math.max(900, 3200 - (elapsedMs / 1000) * 35);
/** Infinite: longer arrows as the match goes on. */
const spawnMaxLen = (elapsedMs: number) => Math.min(7, 3 + Math.floor(elapsedMs / 20000));

/** Hints per level: generous early, scarce later. */
const hintsFor = (level: number) => (level <= 3 ? 3 : level <= 7 ? 2 : 1);

/* ---------------- level generation ---------------- */

function rngFrom(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

function sizeFor(level: number) {
  const cols = Math.min(13, 8 + Math.ceil(level / 2));
  const rows = Math.min(18, cols + 4);
  return { cols, rows };
}

/** How hard a level is: 0 (level 1) → 1 (level 12+). */
const hardness = (level: number) => Math.min(1, (level - 1) / 11);

/** Ids of arrows in the order they can leave, or null if the board can't be cleared. */
function solveOrder(arrows: Arrow[], cols: number, rows: number): number[] | null {
  const occ = new Int16Array(cols * rows).fill(-1);
  for (const a of arrows) for (const c of a.cells) occ[c] = a.id;
  const alive = new Set(arrows.map((a) => a.id));
  const order: number[] = [];
  const free = (a: Arrow) => {
    const head = a.cells[a.cells.length - 1];
    let x = head % cols;
    let y = Math.floor(head / cols);
    for (;;) {
      x += DX[a.dir];
      y += DY[a.dir];
      if (x < 0 || y < 0 || x >= cols || y >= rows) return true;
      const id = occ[y * cols + x];
      if (id !== -1 && id !== a.id) return false;
    }
  };
  let progress = true;
  while (alive.size && progress) {
    progress = false;
    for (const a of arrows) {
      if (!alive.has(a.id) || !free(a)) continue;
      alive.delete(a.id);
      for (const c of a.cells) occ[c] = -1;
      order.push(a.id);
      progress = true;
    }
  }
  return alive.size ? null : order;
}

/**
 * Grows one arrow from `start` over free cells of `occ` (-1 = free), straight runs more often than
 * turns (clean, maze-like lines). Returns its cells (tail → head) and head direction, or null when
 * no valid arrow fits there.
 */
function growArrow(
  occ: Int16Array,
  cols: number,
  rows: number,
  rnd: () => number,
  start: number,
  want: number,
  firstDir: Dir,
): { cells: number[]; dir: Dir } | null {
  if (occ[start] !== -1) return null;
  const cells = [start];
  let dir = firstDir;
  while (cells.length < want) {
    const cur = cells[cells.length - 1];
    const cx = cur % cols;
    const cy = Math.floor(cur / cols);
    const order: Dir[] =
      rnd() < 0.55
        ? [dir, ((dir + 1) % 4) as Dir, ((dir + 3) % 4) as Dir]
        : rnd() < 0.5
          ? [((dir + 1) % 4) as Dir, dir, ((dir + 3) % 4) as Dir]
          : [((dir + 3) % 4) as Dir, dir, ((dir + 1) % 4) as Dir];
    let moved = false;
    for (const d of order) {
      const nx = cx + DX[d];
      const ny = cy + DY[d];
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const n = ny * cols + nx;
      if (occ[n] !== -1 || cells.includes(n)) continue;
      cells.push(n);
      dir = d;
      moved = true;
      break;
    }
    if (!moved) break;
  }
  if (cells.length < 2) return null;
  const a = cells[cells.length - 2];
  const b = cells[cells.length - 1];
  const hd = (b - a === 1 ? 1 : b - a === -1 ? 3 : b - a === cols ? 2 : 0) as Dir;
  // an arrow pointing back into its own body could never leave
  let x = b % cols;
  let y = Math.floor(b / cols);
  for (;;) {
    x += DX[hd];
    y += DY[hd];
    if (x < 0 || y < 0 || x >= cols || y >= rows) break;
    if (cells.includes(y * cols + x)) return null;
  }
  return { cells, dir: hd };
}

/**
 * Packs the board with arrows. Any arrow may be placed — even one that's blocked — as long as the
 * whole board can still be cleared (checked by actually solving it). Higher levels pack tighter,
 * which means more arrows stuck behind others and longer chains to untangle.
 */
function generate(level: number, seed: number): Level {
  const { cols, rows } = sizeFor(level);
  const rnd = rngFrom(seed);
  const occ = new Int16Array(cols * rows).fill(-1);
  const arrows: Arrow[] = [];
  const h = hardness(level);
  const maxLen = Math.min(10, 5 + Math.floor(level / 2));
  const targetFill = 0.9 + h * 0.08;
  let filled = 0;

  const place = (start: number, want: number, firstDir: Dir) => {
    const g = growArrow(occ, cols, rows, rnd, start, want, firstDir);
    if (!g) return false;
    const arrow: Arrow = { id: arrows.length, cells: g.cells, dir: g.dir };
    arrows.push(arrow);
    if (!solveOrder(arrows, cols, rows)) {
      arrows.pop();
      return false;
    }
    for (const c of g.cells) occ[c] = arrow.id;
    filled += g.cells.length;
    return true;
  };

  const total = cols * rows;
  // pass 1: long, winding arrows
  for (let attempt = 0; attempt < 2500 && filled < total * targetFill * 0.8; attempt++) {
    place(Math.floor(rnd() * total), 3 + Math.floor(rnd() * (maxLen - 2)), Math.floor(rnd() * 4) as Dir);
  }
  // pass 2: pack the gaps (every free cell, every direction, short arrows)
  const freeCells: number[] = [];
  for (let i = 0; i < total; i++) if (occ[i] === -1) freeCells.push(i);
  for (let i = freeCells.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [freeCells[i], freeCells[j]] = [freeCells[j], freeCells[i]];
  }
  for (const start of freeCells) {
    if (filled >= total * targetFill) break;
    const dirs = ([0, 1, 2, 3] as Dir[]).sort(() => rnd() - 0.5);
    for (const d of dirs) if (place(start, 2 + Math.floor(rnd() * 3), d)) break;
  }
  return { cols, rows, arrows };
}

/**
 * Infinite mode: one new arrow in a free spot of a live board, placed so the board can still be
 * cleared. `alive` = arrows still on the board; `moving` = arrows sliding out right now (their
 * cells aren't free yet, but they no longer block). Null when there's no room.
 */
function spawnArrow(alive: Arrow[], moving: Arrow[], nextId: number, cols: number, rows: number, rnd: () => number, maxLen: number): Arrow | null {
  const occ = new Int16Array(cols * rows).fill(-1);
  for (const a of alive) for (const c of a.cells) occ[c] = a.id;
  for (const a of moving) for (const c of a.cells) occ[c] = a.id;
  const free: number[] = [];
  for (let i = 0; i < occ.length; i++) if (occ[i] === -1) free.push(i);
  if (free.length < 2) return null;
  for (let attempt = 0; attempt < 40; attempt++) {
    const start = free[Math.floor(rnd() * free.length)];
    const g = growArrow(occ, cols, rows, rnd, start, 2 + Math.floor(rnd() * (maxLen - 1)), Math.floor(rnd() * 4) as Dir);
    if (!g) continue;
    const arrow: Arrow = { id: nextId, cells: g.cells, dir: g.dir };
    if (solveOrder([...alive, arrow], cols, rows)) return arrow;
  }
  return null;
}

/** Infinite mode's opening board: the same few arrows for both players (same seed). */
function infiniteStart(seed: number): Level {
  const { cols, rows } = sizeFor(INF_SIZE_LEVEL);
  const rnd = rngFrom(seed);
  const arrows: Arrow[] = [];
  for (let i = 0; i < 60 && arrows.length < INF_START_ARROWS; i++) {
    const a = spawnArrow(arrows, [], arrows.length, cols, rows, rnd, 5);
    if (a) arrows.push(a);
  }
  return { cols, rows, arrows };
}

/* ---------------- look ---------------- */
/* Colours come from the equipped arrow skin (src/lib/shopCatalog.ts). Classic: plain ink arrows
   that flash their colour only while leaving; other skins tint arrows at rest too. */

/* ---------------- geometry ---------------- */

type Pt = { x: number; y: number };

/** Path the arrow travels: its body (tail → head), then straight on well past the board edge. */
function travelPath(a: Arrow, cols: number, rows: number): Pt[] {
  const pts = a.cells.map((c) => ({ x: c % cols, y: Math.floor(c / cols) }));
  const head = pts[pts.length - 1];
  const extra = Math.max(cols, rows) + a.cells.length + 2;
  for (let k = 1; k <= extra; k++) pts.push({ x: head.x + DX[a.dir] * k, y: head.y + DY[a.dir] * k });
  return pts;
}

function at(pts: Pt[], s: number): Pt {
  const i = Math.min(pts.length - 2, Math.max(0, Math.floor(s)));
  const f = Math.min(1, Math.max(0, s - i));
  return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * f, y: pts[i].y + (pts[i + 1].y - pts[i].y) * f };
}

/** The visible stretch of the path between arc positions s0..s1 (unit segments). */
function slice(pts: Pt[], s0: number, s1: number): Pt[] {
  const out = [at(pts, s0)];
  for (let i = Math.floor(s0) + 1; i < s1; i++) out.push(pts[i]);
  out.push(at(pts, s1));
  return out;
}

const px = (v: number) => v * CELL + CELL / 2;
const pathD = (seg: Pt[]) => seg.map((p, i) => `${i ? "L" : "M"}${px(p.x).toFixed(1)} ${px(p.y).toFixed(1)}`).join(" ");

/** Cells from the head to the board edge (head excluded). */
function rayLength(a: Arrow, cols: number, rows: number) {
  const head = a.cells[a.cells.length - 1];
  const x = head % cols;
  const y = Math.floor(head / cols);
  return [y, cols - 1 - x, rows - 1 - y, x][a.dir];
}

/* ---------------- sound ---------------- */

let actx: AudioContext | null = null;
function tone(freq: number, dur: number, vol: number, type: OscillatorType = "triangle", slideTo?: number, delay = 0) {
  try {
    actx ??= new AudioContext();
    if (actx.state === "suspended") void actx.resume();
    const t = actx.currentTime + delay;
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(actx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  } catch {
    /* audio unavailable */
  }
}
const sfx = {
  // pitch climbs with the combo
  out: (combo: number) => tone(480 * (1 + Math.min(combo - 1, 8) * 0.09), 0.16, 0.07, "triangle", 980 * (1 + Math.min(combo - 1, 8) * 0.09)),
  edge: () => tone(1600, 0.06, 0.025, "sine"),
  bump: () => {
    tone(170, 0.2, 0.22, "sine", 80);
    tone(95, 0.12, 0.12, "square", 60);
  },
  clear: () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.26, 0.06, "triangle", undefined, i * 0.08)),
  lose: () => [392, 330, 262, 196].forEach((f, i) => tone(f, 0.3, 0.07, "triangle", undefined, i * 0.12)),
  hint: () => tone(880, 0.12, 0.05, "sine", 1320),
};

/* ---------------- component ---------------- */

type Anim = { kind: "exit" | "bump"; t0: number; dur: number; dist: number; blocker?: number; edgeAt?: number; edgeFired?: boolean };
type Popup = { id: number; x: number; y: number; text: string; color: string; big: boolean };

const COMBO_MS = 1700;
/** Seconds to decide whether to undo the bump that cost the last life. */
const CHANCE_S = 6;

type ArrowViewProps = {
  a: Arrow;
  idx: number;
  pts: Pt[];
  color: string;
  tint: boolean;
  spawned: boolean;
  anim: Anim | undefined;
  now: number;
  blocker: boolean;
  hinted: boolean;
  onTap: (a: Arrow) => void;
};

/** One arrow. Memoised: arrows at rest don't re-render while others move. */
const ArrowView = memo(
  function ArrowView({ a, idx, pts, color, tint, spawned, anim: an, now, blocker, hinted, onTap }: ArrowViewProps) {
    const len = a.cells.length - 1;
    let off = 0;
    let fade = 1;
    if (an) {
      const t = Math.min(1, (now - an.t0) / an.dur);
      if (an.kind === "exit") {
        const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // ease in-out
        off = an.dist * (e * 0.55 + t * 0.45);
        fade = t > 0.8 ? 1 - (t - 0.8) / 0.2 : 1;
      } else {
        const k = t < 0.42 ? t / 0.42 : 1 - (t - 0.42) / 0.58;
        off = an.dist * Math.sin((Math.max(0, k) * Math.PI) / 2);
      }
    }
    const seg = slice(pts, off, off + len);
    const d = pathD(seg);
    const end = { x: px(seg[seg.length - 1].x), y: px(seg[seg.length - 1].y) };
    const prev = { x: px(seg[seg.length - 2].x), y: px(seg[seg.length - 2].y) };
    const ang = Math.atan2(end.y - prev.y, end.x - prev.x);
    const tip = { x: end.x + Math.cos(ang) * 3, y: end.y + Math.sin(ang) * 3 };
    const hs = 9.5;
    const l = { x: tip.x - Math.cos(ang - 0.5) * hs, y: tip.y - Math.sin(ang - 0.5) * hs };
    const r = { x: tip.x - Math.cos(ang + 0.5) * hs, y: tip.y - Math.sin(ang + 0.5) * hs };
    // motion trail while leaving
    const trail = an?.kind === "exit" && off > 0.2 ? pathD(slice(pts, Math.max(0, off - 2.4), off + 0.2)) : null;
    const cls = [
      "arw-arrow",
      spawned ? "is-spawn" : "",
      an?.kind === "exit" ? "is-out" : "",
      an?.kind === "bump" ? "is-bump" : "",
      blocker ? "is-blocker" : "",
      hinted ? "is-hint" : "",
    ].join(" ");
    return (
      <g
        className={cls}
        style={{ opacity: fade, color: an?.kind === "exit" || tint ? color : undefined, "--i": idx } as React.CSSProperties}
        onClick={() => onTap(a)}
        role="button"
        tabIndex={0}
        aria-label={`Arrow pointing ${["up", "right", "down", "left"][a.dir]}`}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onTap(a))}
      >
        {trail ? <path className="arw-trail" d={trail} /> : null}
        <path className="arw-hit" d={d} />
        <path className="arw-halo" d={d} />
        <path className="arw-line" d={d} pathLength={1} />
        <polygon className="arw-head" points={`${tip.x},${tip.y} ${l.x},${l.y} ${r.x},${r.y}`} />
      </g>
    );
  },
  (p, n) =>
    p.a === n.a &&
    p.pts === n.pts &&
    p.idx === n.idx &&
    p.color === n.color &&
    p.tint === n.tint &&
    p.spawned === n.spawned &&
    p.anim === n.anim &&
    p.blocker === n.blocker &&
    p.hinted === n.hinted &&
    p.onTap === n.onTap &&
    (!n.anim || p.now === n.now),
);

/** In-game booster shop: hint or undo packs. */
function BoosterPanel({ item, onClose }: { item: BoosterItem; onClose: () => void }) {
  const shop = useShop();
  const { wallet } = useTokens();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const packs = Object.entries(BOOSTERS).filter(([, b]) => b.grants === item);
  const owned = shop.state?.inventory[item] ?? 0;
  const noun = item === "arrows_hint" ? "hints" : "undos";

  async function buy(id: string) {
    setBusy(id);
    setMsg("");
    try {
      await shop.buy(id);
      setMsg(`Added! You now have more ${noun}.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="arw-overlay" role="dialog" aria-modal="true" aria-labelledby="arw-shop-title">
      <div className="arw-card arw-shop">
        <h3 id="arw-shop-title">Get {noun}</h3>
        {!shop.signedIn ? (
          <>
            <p>Sign in to buy {noun} with tokens.</p>
            <Link className="primary-btn" to="/login">
              Sign in
            </Link>
          </>
        ) : !shop.available ? (
          <p>The shop isn't open yet.</p>
        ) : (
          <>
            <p>
              You have <b>{owned}</b> {noun} · Balance{" "}
              <b>{wallet?.unlimited ? "unlimited" : formatTokens(wallet?.balance ?? 0)}</b>
            </p>
            <ul className="arw-shop-list">
              {packs.map(([id, b]) => {
                const price = shop.priceOf(id);
                return (
                  <li key={id}>
                    <span className="arw-shop-name">
                      <b>{b.name}</b>
                      <small>{b.blurb}</small>
                    </span>
                    <button type="button" className="primary-btn" disabled={busy !== null || price === null} onClick={() => void buy(id)}>
                      <TokenIcon size={14} title="tokens" /> {price === null ? "—" : formatTokens(price)}
                    </button>
                  </li>
                );
              })}
            </ul>
            {msg ? <p className="arw-shop-msg">{msg}</p> : null}
            <Link className="arw-shop-more" to="/tokens#buy">
              Get more tokens
            </Link>
          </>
        )}
        <button type="button" className="ghost-btn" onClick={onClose} autoFocus>
          Back to the game
        </button>
      </div>
    </div>
  );
}

/** Match timer: ticks on its own so the board doesn't re-render ten times a second. */
function MatchClock({ startedAt, stopped }: { startedAt: number | null; stopped: number | null }) {
  const [, setT] = useState(0);
  useEffect(() => {
    if (startedAt === null || stopped !== null) return;
    const id = window.setInterval(() => setT((t) => t + 1), 100);
    return () => window.clearInterval(id);
  }, [startedAt, stopped]);
  const ms = startedAt === null ? 0 : (stopped ?? performance.now()) - startedAt;
  return <>{(ms / 1000).toFixed(1)}s</>;
}

/** An online match (from arrowsOnline.tsx). The component is remounted for each round. */
export type MatchSetup = { mode: MatchMode; seed: number };

export type ArrowsPlayProps = GameProps & {
  match?: MatchSetup;
  /** Match: this player's progress changed. */
  onMatchProgress?: (p: Progress) => void;
  /** Match: this player's run ended (cleared the race board, or out of lives). */
  onMatchEnd?: (type: "finish" | "out", ms: number) => void;
  /** Match: the result is in (maybe the opponent finished first) — stop playing. */
  matchOver?: boolean;
  /** Shown above the HUD (the opponent's bar in a match). */
  top?: ReactNode;
  /** Shown over the board (the match result). */
  overlay?: ReactNode;
};

export function ArrowsPlay({ onFinish, match, onMatchProgress, onMatchEnd, matchOver, top, overlay }: ArrowsPlayProps) {
  const online = Boolean(match);
  const infinite = match?.mode === "infinite";
  const maxLives = !match ? LIVES : infinite ? INF_LIVES : RACE_LIVES;
  const saved = useGameProgress("arrows");
  const shop = useShop();
  const skin = skinOf(shop.arrowSkin);
  const fxStyle = fxIdOf(shop.arrowFx) as FxStyle;
  const colorOf = useCallback((a: Arrow, lv: number) => skin.palette[(a.id * 7 + lv * 3) % skin.palette.length], [skin]);

  const [level, setLevel] = useState(() => (!match ? 1 : infinite ? INF_SIZE_LEVEL : RACE_LEVEL));
  const [seed, setSeed] = useState(() => match?.seed ?? (Math.random() * 2 ** 31) | 0);
  const board = useMemo(() => (infinite ? infiniteStart(seed) : generate(level, seed)), [infinite, level, seed]);
  const { cols, rows } = board;
  // infinite mode: arrows spawned during play (ids continue after the opening board's)
  const [spawned, setSpawned] = useState<Arrow[]>([]);
  const arrows = useMemo(() => (spawned.length ? board.arrows.concat(spawned) : board.arrows), [board, spawned]);
  const pathCache = useRef(new WeakMap<Arrow, Pt[]>());
  const paths = useMemo(
    () =>
      arrows.map((a) => {
        let p = pathCache.current.get(a);
        if (!p) {
          p = travelPath(a, cols, rows);
          pathCache.current.set(a, p);
        }
        return p;
      }),
    [arrows, cols, rows],
  );

  const [removed, setRemoved] = useState<Set<number>>(() => new Set());
  const [anims, setAnims] = useState<Map<number, Anim>>(() => new Map());
  const [lives, setLives] = useState(maxLives);
  const [livesAtStart, setLivesAtStart] = useState(maxLives);
  const [score, setScore] = useState(0);
  const [shownScore, setShownScore] = useState(0);
  const [hints, setHints] = useState(() => (match ? MATCH_HINTS : hintsFor(1)));
  const [hinted, setHinted] = useState<number | null>(null);
  // "done": a match run that has ended (the result shows on top)
  const [state, setState] = useState<"play" | "cleared" | "chance" | "over" | "done">("play");
  const [combo, setCombo] = useState(0);
  const [bestCombo, setBestCombo] = useState(0);
  const [cleared, setCleared] = useState(0);
  const [intro, setIntro] = useState(true);
  const [countdown, setCountdown] = useState(match ? 3 : 0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [stoppedAt, setStoppedAt] = useState<number | null>(null);
  const [shakeKey, setShakeKey] = useState(0);
  const [brokenHeart, setBrokenHeart] = useState<number | null>(null);
  const [popups, setPopups] = useState<Popup[]>([]);
  const [confirmReset, setConfirmReset] = useState(false);
  const [panel, setPanel] = useState<BoosterItem | null>(null);
  const [undoable, setUndoable] = useState(false); // the last tap was a bump that can be taken back
  const [boostBusy, setBoostBusy] = useState(false);
  const [chanceLeft, setChanceLeft] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const [spawnTick, setSpawnTick] = useState(0);
  const [, setTick] = useState(0);

  const finished = useRef(false);
  const gone = useRef(new Set<number>()); // arrows leaving right now block nothing
  const lastClear = useRef(0);
  const popupId = useRef(0);
  const undoUsed = useRef(false); // one undo per level
  const scoreRef = useRef(0);
  scoreRef.current = score;
  const calm = useMemo(() => reducedMotion(), []);
  const touched = useRef(false); // the player has tapped: a late-arriving save mustn't swap the board
  const spawnCount = useRef(0);

  const ownedHints = online ? 0 : shop.state?.inventory.arrows_hint ?? 0;
  const ownedUndos = online ? 0 : shop.state?.inventory.arrows_undo ?? 0;
  const elapsed = () => (startedAt === null ? 0 : performance.now() - startedAt);

  /* ----- canvas effects (dots, waves, sparks): their own loop, outside React ----- */
  const stackRef = useRef<HTMLDivElement>(null);
  const underRef = useRef<HTMLCanvasElement>(null);
  const overRef = useRef<HTMLCanvasElement>(null);
  const shakeRef = useRef<HTMLDivElement>(null);
  const fx = useRef<ArrowsFx | null>(null);
  useEffect(() => {
    const stack = stackRef.current!;
    const f = new ArrowsFx(underRef.current!, overRef.current!, CELL, calm, () => getComputedStyle(stack).color);
    fx.current = f;
    const ro = new ResizeObserver(([e]) => f.resize(e.contentRect.width, e.contentRect.height));
    ro.observe(stack);
    // light / dark theme switches change the dot colour
    const mo = new MutationObserver(() => f.refresh());
    mo.observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ["data-gtheme", "data-theme"] });
    return () => {
      ro.disconnect();
      mo.disconnect();
      f.destroy();
      fx.current = null;
    };
  }, [calm]);
  useEffect(() => {
    fx.current?.setBoard(cols, rows);
  }, [board, cols, rows]);

  /* ----- board shake (restarted in place: the board must not remount) ----- */
  useEffect(() => {
    const el = shakeRef.current;
    if (!shakeKey || !el) return;
    el.classList.remove("go");
    void el.offsetWidth;
    el.classList.add("go");
  }, [shakeKey]);

  /* ----- solo: start from the saved level once it's known ----- */
  useEffect(() => {
    if (online || !saved.ready || touched.current || saved.level === level) return;
    setLevel(saved.level);
    setSeed((Math.random() * 2 ** 31) | 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the saved level arrives
  }, [saved.ready, saved.level]);

  /* ----- match: 3-2-1, then the clock starts ----- */
  useEffect(() => {
    if (!online) return;
    if (countdown <= 0) {
      setStartedAt(performance.now());
      return;
    }
    const id = window.setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => window.clearTimeout(id);
  }, [online, countdown]);

  /* ----- per board ----- */
  useEffect(() => {
    setRemoved(new Set());
    setAnims(new Map());
    setSpawned([]);
    gone.current = new Set();
    undoUsed.current = false;
    setUndoable(false);
    if (!online) setHints(hintsFor(level));
    setHinted(null);
    setState("play");
    setCombo(0);
    setIntro(!calm);
    const t = window.setTimeout(() => setIntro(false), 650 + Math.min(board.arrows.length, 40) * 22);
    return () => window.clearTimeout(t);
  }, [board, calm, level, online]);

  useEffect(() => {
    setLivesAtStart(lives);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board]);

  /* ----- score counter rolls up ----- */
  useEffect(() => {
    if (shownScore === score) return;
    const id = window.setTimeout(() => {
      setShownScore((s) => (s < score ? Math.min(score, s + Math.max(1, Math.ceil((score - s) / 6))) : score));
    }, 30);
    return () => window.clearTimeout(id);
  }, [shownScore, score]);

  /* ----- combo decays ----- */
  useEffect(() => {
    if (combo <= 1) return;
    const id = window.setTimeout(() => setCombo(0), COMBO_MS);
    return () => window.clearTimeout(id);
  }, [combo, cleared]);

  const occupancy = useCallback(() => {
    const occ = new Int16Array(cols * rows).fill(-1);
    for (const a of arrows) if (!gone.current.has(a.id)) for (const c of a.cells) occ[c] = a.id;
    return occ;
  }, [arrows, cols, rows]);

  /** Free cells ahead of the head before the first blocker (null = the way out is clear). */
  const blockOf = useCallback(
    (a: Arrow, occ: Int16Array) => {
      const head = a.cells[a.cells.length - 1];
      let x = head % cols;
      let y = Math.floor(head / cols);
      let steps = 0;
      for (;;) {
        x += DX[a.dir];
        y += DY[a.dir];
        if (x < 0 || y < 0 || x >= cols || y >= rows) return null;
        const id = occ[y * cols + x];
        if (id !== -1 && id !== a.id) return { steps, blocker: id };
        steps++;
      }
    },
    [cols, rows],
  );

  const popup = useCallback((x: number, y: number, text: string, color: string, big = false) => {
    const id = ++popupId.current;
    setPopups((p) => [...p, { id, x, y, text, color, big }]);
    window.setTimeout(() => setPopups((p) => p.filter((q) => q.id !== id)), big ? 1400 : 950);
  }, []);

  /* ----- animation clock: only while arrows are moving ----- */
  const busy = anims.size > 0;
  useEffect(() => {
    if (!busy) return;
    let raf = 0;
    const loop = (now: number) => {
      let changed = false;
      const next = new Map(anims);
      for (const [id, an] of anims) {
        const t = (now - an.t0) / an.dur;
        if (an.kind === "exit" && !an.edgeFired && an.edgeAt !== undefined && t >= an.edgeAt) {
          an.edgeFired = true;
          const a = arrows[id];
          const head = a.cells[a.cells.length - 1];
          const ray = rayLength(a, cols, rows);
          const ex = px((head % cols) + DX[a.dir] * (ray + 0.6));
          const ey = px(Math.floor(head / cols) + DY[a.dir] * (ray + 0.6));
          fx.current?.burst(ex, ey, colorOf(a, level), 14, 150);
          sfx.edge();
        }
        if (t >= 1) {
          next.delete(id);
          changed = true;
          if (an.kind === "exit") {
            setRemoved((r) => new Set(r).add(id));
            // the exit effect starts where the arrow crossed the board edge
            const a = arrows[id];
            const head = a.cells[a.cells.length - 1];
            const ray = rayLength(a, cols, rows);
            const x = px((head % cols) + DX[a.dir] * (ray + 0.5));
            const y = px(Math.floor(head / cols) + DY[a.dir] * (ray + 0.5));
            fx.current?.exit(fxStyle, x, y, DX[a.dir], DY[a.dir], colorOf(a, level));
          }
        }
      }
      if (changed) setAnims(next);
      setTick((k) => k + 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [busy, anims, arrows, cols, rows, level, colorOf, fxStyle]);

  /** A match run ended on this side: freeze the clock and tell the room. */
  const endMatchRun = useCallback(
    (type: "finish" | "out") => {
      const ms = startedAt === null ? 0 : performance.now() - startedAt;
      setStoppedAt(performance.now());
      setState("done");
      if (!finished.current) {
        finished.current = true;
        onMatchEnd?.(type, ms);
      }
    },
    [startedAt, onMatchEnd],
  );

  /* ----- board cleared ----- */
  useEffect(() => {
    if (infinite || state !== "play" || !arrows.length || removed.size !== arrows.length) return;
    sfx.clear();
    // confetti from the top of the board
    for (let i = 0; i < 6; i++) fx.current?.burst(px(Math.random() * cols), px(-0.5), skin.palette[(i * 2) % skin.palette.length], 14, 220);
    if (online) {
      endMatchRun("finish");
      return;
    }
    const bonus = 50 * level + lives * 20;
    setScore((s) => s + bonus);
    setState("cleared");
    setUndoable(false);
    saved.save(level + 1); // closing the site now resumes on the next level
  }, [removed, arrows.length, state, level, lives, cols, saved, skin, infinite, online, endMatchRun]);

  /** Solo: the run is over: show the result and report the score (once). */
  const endRun = useCallback(() => {
    setState("over");
    sfx.lose();
    if (!finished.current) {
      finished.current = true;
      onFinish(scoreRef.current);
    }
  }, [onFinish]);

  /** Out of lives (after the last heart breaks). */
  const outOfLives = useCallback(() => {
    if (online) {
      sfx.lose();
      endMatchRun("out");
    } else endRun();
  }, [online, endMatchRun, endRun]);

  /* ----- match: the result came in (maybe the opponent finished first) ----- */
  useEffect(() => {
    if (!matchOver || state === "done") return;
    setStoppedAt((s) => s ?? performance.now());
    setState("done");
    finished.current = true;
  }, [matchOver, state]);

  /* ----- match: stream progress ----- */
  const reportRef = useRef(onMatchProgress);
  reportRef.current = onMatchProgress;
  useEffect(() => {
    if (!online || startedAt === null) return;
    reportRef.current?.({ cleared: removed.size, left: arrows.length - removed.size, lives, ms: (stoppedAt ?? performance.now()) - startedAt });
  }, [online, startedAt, stoppedAt, removed.size, arrows.length, lives]);

  /* ----- last chance: undo the bump that cost the last life, or the run ends ----- */
  useEffect(() => {
    if (state !== "chance" || boostBusy) return;
    if (chanceLeft <= 0) {
      endRun();
      return;
    }
    const id = window.setTimeout(() => setChanceLeft((s) => s - 1), 1000);
    return () => window.clearTimeout(id);
  }, [state, chanceLeft, boostBusy, endRun]);

  /** Lose a life (bump, or infinite board overflow). Reads lives from a ref: timers call it too. */
  const livesRef = useRef(lives);
  livesRef.current = lives;
  const loseLife = useCallback(
    (x: number, y: number, label: string) => {
      if (livesRef.current <= 0) return;
      sfx.bump();
      setShakeKey((k) => k + 1);
      setCombo(0);
      const left = livesRef.current - 1;
      livesRef.current = left;
      setBrokenHeart(left);
      window.setTimeout(() => setBrokenHeart(null), 700);
      setLives(left);
      popup(x, y, label, "#ff5a4a");
      if (!online && !undoUsed.current) setUndoable(true);
      if (left <= 0) {
        const canUndo = !online && !undoUsed.current && ownedUndos > 0;
        window.setTimeout(() => {
          if (canUndo) {
            setChanceLeft(CHANCE_S);
            setState("chance");
          } else outOfLives();
        }, 450);
      }
    },
    [online, ownedUndos, popup, outOfLives],
  );

  /* ----- infinite: arrows keep coming, faster and longer over time ----- */
  const playing = state === "play" && !intro && countdown === 0 && startedAt !== null;
  // the latest board / lives each time the timer fires (it's armed once per spawn)
  const spawnNow = useRef(() => {});
  spawnNow.current = () => {
    const ms = elapsed();
    const rnd = rngFrom((seed ^ Math.imul(++spawnCount.current, 0x9e3779b1)) >>> 0);
    const alive = arrows.filter((a) => !gone.current.has(a.id));
    const moving = arrows.filter((a) => gone.current.has(a.id) && !removed.has(a.id));
    const a = spawnArrow(alive, moving, arrows.length, cols, rows, rnd, spawnMaxLen(ms));
    if (a) setSpawned((s) => [...s, a]);
    else loseLife(px((cols - 1) / 2), px((rows - 1) / 2), "board full!");
    setSpawnTick((t) => t + 1);
  };
  useEffect(() => {
    if (!infinite || !playing) return;
    const id = window.setTimeout(() => spawnNow.current(), spawnDelay(elapsed()));
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-armed after each spawn
  }, [infinite, playing, spawnTick]);

  function tap(a: Arrow) {
    if (state !== "play" || intro || countdown > 0 || gone.current.has(a.id) || anims.has(a.id)) return;
    touched.current = true;
    setHinted(null);
    setUndoable(false);
    const block = blockOf(a, occupancy());
    const head = a.cells[a.cells.length - 1];
    const hx = px(head % cols);
    const hy = px(Math.floor(head / cols));
    const color = colorOf(a, level);

    if (!block) {
      gone.current.add(a.id);
      const len = a.cells.length - 1;
      const ray = rayLength(a, cols, rows);
      const dist = len + ray + 2.5;
      const dur = calm ? 140 : 280 + dist * 30;
      // when (0..1) the head crosses the board edge, for the spark burst
      const edgeAt = Math.min(0.98, (ray + 0.6) / dist);
      setAnims((m) => new Map(m).set(a.id, { kind: "exit", t0: performance.now(), dur, dist, edgeAt }));
      const now = performance.now();
      const c = now - lastClear.current < COMBO_MS ? combo + 1 : 1;
      lastClear.current = now;
      setCombo(c);
      setBestCombo((b) => Math.max(b, c));
      setCleared((n) => n + 1);
      const pts = (10 + a.cells.length * 2) * c;
      setScore((s) => s + pts);
      popup(hx, hy - 6, c > 1 ? `+${pts} ×${c}` : `+${pts}`, color, c >= 3);
      fx.current?.burst(hx, hy, color, 6, 70);
      sfx.out(c);
      return;
    }

    // blocked: push up to the blocker and spring back; shake; lose a life
    setAnims((m) =>
      new Map(m).set(a.id, { kind: "bump", t0: performance.now(), dur: calm ? 200 : 440, dist: block.steps + 0.32, blocker: block.blocker }),
    );
    loseLife(hx, hy - 6, "blocked!");
  }
  // stable tap handler for the memoised arrows
  const tapRef = useRef(tap);
  tapRef.current = tap;
  const onTap = useCallback((a: Arrow) => tapRef.current(a), []);

  async function giveHint() {
    if (state !== "play" || intro || countdown > 0 || boostBusy) return;
    if (hints <= 0) {
      if (online) return;
      if (ownedHints <= 0) {
        setPanel("arrows_hint");
        return;
      }
      setBoostBusy(true);
      const ok = await shop.use("arrows_hint");
      setBoostBusy(false);
      if (!ok) return;
    } else setHints((h) => h - 1);
    const occ = occupancy();
    const free = arrows.find((a) => !gone.current.has(a.id) && !blockOf(a, occ));
    if (free) {
      setHinted(free.id);
      sfx.hint();
    }
  }

  /** Take back the last bump: the life comes back. One per level, uses an owned undo. */
  async function undo() {
    if (online || boostBusy || undoUsed.current || (!undoable && state !== "chance")) return;
    if (ownedUndos <= 0) {
      setPanel("arrows_undo");
      return;
    }
    setBoostBusy(true);
    const ok = await shop.use("arrows_undo");
    setBoostBusy(false);
    if (!ok) {
      if (state === "chance") endRun();
      return;
    }
    undoUsed.current = true;
    setUndoable(false);
    setLives((l) => Math.min(maxLives, l + 1));
    setBrokenHeart(null);
    if (state === "chance") setState("play");
    sfx.hint();
  }

  function nextLevel() {
    setLevel((l) => l + 1);
    setSeed((Math.random() * 2 ** 31) | 0);
  }

  /** New run on the current level (a fresh board, full lives, score from 0). */
  function restart() {
    touched.current = true;
    finished.current = false;
    setLives(maxLives);
    setScore(0);
    setShownScore(0);
    setCleared(0);
    setBestCombo(0);
    setSeed((Math.random() * 2 ** 31) | 0);
  }

  function resetProgress() {
    saved.reset();
    setConfirmReset(false);
    restart();
    setLevel(1);
  }

  /* ----- render ----- */
  const now = performance.now();
  const W = cols * CELL;
  const H = rows * CELL;
  const blockers = new Set<number>();
  for (const an of anims.values()) if (an.kind === "bump" && an.blocker !== undefined) blockers.add(an.blocker);
  const left = arrows.length - removed.size;
  const progress = infinite ? 0 : arrows.length ? removed.size / arrows.length : 0;
  const lost = livesAtStart - lives;
  const stars = lost <= 0 ? 3 : lost === 1 ? 2 : 1;
  const undoReady = !online && undoable && !undoUsed.current && state === "play";
  const hintCount = hints > 0 ? hints : ownedHints;
  const firstSpawn = board.arrows.length;

  return (
    <div className="game-surface arw-surface">
      {top}

      {/* HUD: one compact row */}
      <div className="arw-hud">
        <div className="arw-level" key={`lv-${level}`}>
          <small>{!match ? "Level" : infinite ? "Infinite" : "Race"}</small>
          <b>{!match ? level : infinite ? "∞" : "1"}</b>
        </div>
        <div className="arw-hud-mid">
          <div className="arw-hearts" aria-label={`${lives} lives`}>
            {Array.from({ length: maxLives }, (_, i) => (
              <i key={i} className={`arw-heart${i < lives ? " on" : ""}${brokenHeart === i ? " break" : ""}`} aria-hidden="true" />
            ))}
          </div>
          {infinite ? (
            <span className="arw-mini-stat">{left} on board</span>
          ) : (
            <div className="arw-progress" aria-label={`${removed.size} of ${arrows.length} arrows cleared`}>
              <i style={{ width: `${progress * 100}%` }} />
            </div>
          )}
        </div>
        <div className="arw-score">
          {match ? (
            <>
              <small>{infinite ? "Cleared" : "Time"}</small>
              <b>{infinite ? removed.size : <MatchClock startedAt={startedAt} stopped={stoppedAt} />}</b>
            </>
          ) : (
            <>
              <small>Score</small>
              <b>{shownScore}</b>
            </>
          )}
        </div>
      </div>

      <div className={`arw-combo${combo > 1 ? " on" : ""}`} key={`c-${combo}-${cleared}`} aria-live="polite">
        {combo > 1 ? (
          <>
            Combo <b>×{combo}</b>
            <span className="arw-combo-bar" style={{ animationDuration: `${COMBO_MS}ms` }} />
          </>
        ) : (
          <span className="arw-status">
            {countdown > 0 ? "Get ready…" : intro ? "Get ready…" : infinite ? "Keep the board clear!" : `Tap an arrow to send it out · ${left} left`}
          </span>
        )}
      </div>

      {/* Board */}
      <div className={`arw-board-wrap${state !== "play" ? " is-dim" : ""}${skin.tinted ? " arw-tinted" : ""} ${skin.className}`}>
        <div className="arw-shake" ref={shakeRef}>
          <div className="arw-stack" ref={stackRef}>
            {/* background panel + glow, behind the canvas effects */}
            <svg className="arw-bgsvg" viewBox={`${-CELL * 0.5} ${-CELL * 0.5} ${W + CELL} ${H + CELL}`} aria-hidden="true">
              <defs>
                <radialGradient id="arw-bg-glow" cx="50%" cy="40%" r="75%">
                  <stop offset="0%" stopColor="#ff8a3d" stopOpacity="0.14" />
                  <stop offset="60%" stopColor="#7c5cff" stopOpacity="0.05" />
                  <stop offset="100%" stopColor="#000" stopOpacity="0" />
                </radialGradient>
              </defs>
              <rect className="arw-bg" x={-CELL * 0.4} y={-CELL * 0.4} width={W + CELL * 0.8} height={H + CELL * 0.8} rx={16} />
              <rect className="arw-bg-glow" x={-CELL * 0.4} y={-CELL * 0.4} width={W + CELL * 0.8} height={H + CELL * 0.8} rx={16} fill="url(#arw-bg-glow)" />
            </svg>
            <canvas className="arw-fx" ref={underRef} aria-hidden="true" />
            <svg
              key={`b-${seed}`}
              className={`arw-board${intro ? " is-intro" : ""}`}
              viewBox={`${-CELL * 0.5} ${-CELL * 0.5} ${W + CELL} ${H + CELL}`}
              role="img"
              aria-label={`Arrow board, ${left} arrows left`}
            >
              <defs>
                <clipPath id="arw-clip">
                  <rect x={-CELL * 0.4} y={-CELL * 0.4} width={W + CELL * 0.8} height={H + CELL * 0.8} rx={16} />
                </clipPath>
              </defs>

              <g clipPath="url(#arw-clip)">
                {arrows.map((a, idx) =>
                  removed.has(a.id) ? null : (
                    <ArrowView
                      key={a.id}
                      a={a}
                      idx={idx}
                      pts={paths[idx]}
                      color={colorOf(a, level)}
                      tint={skin.tinted}
                      spawned={a.id >= firstSpawn}
                      anim={anims.get(a.id)}
                      now={now}
                      blocker={blockers.has(a.id)}
                      hinted={hinted === a.id}
                      onTap={onTap}
                    />
                  ),
                )}
              </g>

              {/* score pop-ups */}
              {popups.map((p) => (
                <text key={p.id} className={`arw-pop${p.big ? " big" : ""}`} x={p.x} y={p.y} fill={p.color}>
                  {p.text}
                </text>
              ))}
            </svg>
            <canvas className="arw-fx arw-fx-over" ref={overRef} aria-hidden="true" />
          </div>
        </div>

        {/* overlays */}
        {countdown > 0 ? (
          <div className="arw-overlay arw-countdown" aria-live="assertive">
            <b key={countdown}>{countdown}</b>
          </div>
        ) : null}
        {state === "cleared" ? (
          <div className="arw-overlay">
            <div className="arw-card">
              <div className="arw-stars" aria-label={`${stars} of 3 stars`}>
                {[0, 1, 2].map((i) => (
                  <i key={i} className={i < stars ? "on" : ""} style={{ animationDelay: `${0.15 + i * 0.15}s` }} />
                ))}
              </div>
              <h3>Level {level} clear!</h3>
              <p>
                Bonus <b>+{50 * level + lives * 20}</b> · Best combo ×{Math.max(1, bestCombo)}
              </p>
              <div className="arw-confirm-actions">
                <GameShopButton />
                <button type="button" className="primary-btn" onClick={nextLevel} autoFocus>
                  Next level
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {state === "chance" ? (
          <div className="arw-overlay" role="dialog" aria-modal="true" aria-labelledby="arw-chance-title">
            <div className="arw-card">
              <h3 id="arw-chance-title">Out of lives</h3>
              <p>Undo the last bump and keep going?</p>
              <div className="arw-chance-count" aria-label={`${chanceLeft} seconds left`}>
                {chanceLeft}
              </div>
              <div className="arw-confirm-actions">
                <button type="button" className="ghost-btn" onClick={endRun} disabled={boostBusy}>
                  Give up
                </button>
                <button type="button" className="primary-btn" onClick={() => void undo()} disabled={boostBusy} autoFocus>
                  ↶ Undo ({ownedUndos} left)
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {state === "over" ? (
          <div className="arw-overlay">
            <div className="arw-card">
              <h3>Out of lives</h3>
              <div className="arw-stats">
                <span>
                  <b>{score}</b>
                  <small>Score</small>
                </span>
                <span>
                  <b>{level}</b>
                  <small>Level</small>
                </span>
                <span>
                  <b>{cleared}</b>
                  <small>Arrows</small>
                </span>
                <span>
                  <b>×{Math.max(1, bestCombo)}</b>
                  <small>Combo</small>
                </span>
              </div>
              <div className="arw-confirm-actions">
                <GameShopButton />
                <button type="button" className="primary-btn" onClick={restart} autoFocus>
                  Retry level {level}
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {state === "done" && !overlay ? (
          <div className="arw-overlay">
            <div className="arw-card">
              <h3>{lives <= 0 ? "Out of lives" : "Board cleared!"}</h3>
              <p>Waiting for the result…</p>
            </div>
          </div>
        ) : null}
        {overlay}
        {confirmReset ? (
          <div className="arw-overlay" role="dialog" aria-modal="true" aria-labelledby="arw-reset-title">
            <div className="arw-card">
              <h3 id="arw-reset-title">Reset progress?</h3>
              <p>You'll go back to level 1. Your saved level can't be restored.</p>
              <div className="arw-confirm-actions">
                <button type="button" className="ghost-btn" onClick={() => setConfirmReset(false)} autoFocus>
                  Cancel
                </button>
                <button type="button" className="primary-btn arw-danger" onClick={resetProgress}>
                  Reset to level 1
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {panel ? <BoosterPanel item={panel} onClose={() => setPanel(null)} /> : null}
      </div>

      {/* actions: one compact row of icon buttons */}
      <div className="arw-actions">
        <button
          type="button"
          className="arw-act"
          disabled={state !== "play" || intro || countdown > 0 || boostBusy || (online && hints <= 0)}
          onClick={() => void giveHint()}
          title={hints > 0 ? "Hint" : ownedHints > 0 ? "Hint (uses an owned hint)" : online ? "No hints left" : "Get hints"}
          aria-label={`Hint, ${hintCount} left`}
        >
          <span aria-hidden="true">💡</span>
          <b>{hints > 0 || online ? hints : ownedHints > 0 ? ownedHints : "+"}</b>
        </button>
        {!online ? (
          <>
            <button
              type="button"
              className={`arw-act${undoReady ? " arw-undo-ready" : ""}`}
              disabled={!undoReady || boostBusy}
              onClick={() => void undo()}
              title="Undo your last bump and get the life back (1 per level)"
              aria-label={`Undo last bump, ${ownedUndos} left`}
            >
              <span aria-hidden="true">↶</span>
              <b>{undoReady && ownedUndos <= 0 ? "+" : ownedUndos}</b>
            </button>
            <button type="button" className="arw-act" onClick={restart} title="Restart level" aria-label="Restart level">
              <span aria-hidden="true">↻</span>
            </button>
            <button
              type="button"
              className="arw-act"
              disabled={level === 1 && saved.level === 1}
              onClick={() => setConfirmReset(true)}
              title="Reset progress"
              aria-label="Reset progress"
            >
              <span aria-hidden="true">⟲</span>
            </button>
          </>
        ) : null}
        <button
          type="button"
          className={`arw-act${helpOpen ? " is-on" : ""}`}
          onClick={() => setHelpOpen((o) => !o)}
          title="How to play"
          aria-label="How to play"
          aria-expanded={helpOpen}
        >
          <span aria-hidden="true">?</span>
        </button>
      </div>
      {helpOpen ? (
        <p className="game-hint arw-help">
          {infinite
            ? "Arrows keep dropping in, faster and faster. Send them out before the board fills up — a full board or a bump costs a life. Lose both lives and you lose."
            : match
              ? "Same board for both of you. Clear it first to win. A bump costs a life; lose all three and you lose the race."
              : "An arrow leaves only if nothing is in the straight line ahead of its head. Clear arrows quickly for combos — bump one and you lose a life."}
        </p>
      ) : null}
    </div>
  );
}
