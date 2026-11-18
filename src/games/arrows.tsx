/* Arrows — tap an arrow to send it off the board.
   Each arrow is a bent line ending in a head. Tapped, it slides out snake-style: the head runs
   straight on in the direction it points and the body follows its own path. If another arrow sits
   in that straight line, it bumps into it and you lose a life. Clear the board to level up.
   Quick successive clears build a combo multiplier.

   Levels are generated so they are always solvable: arrows are placed one by one, each only where
   its exit line is clear of the arrows already placed — so removing them in reverse order works.

   The level reached is saved (src/lib/progress.ts), so players pick up where they left off. Running
   out of lives retries the same level; "Reset progress" goes back to level 1. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameProps } from "./index";
import { reducedMotion } from "./fx";
import { useGameProgress } from "../lib/progress";
import "./arrows.css";

type Dir = 0 | 1 | 2 | 3; // up, right, down, left
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];

type Arrow = { id: number; cells: number[]; dir: Dir };
type Level = { cols: number; rows: number; arrows: Arrow[] };

const CELL = 40;
const LIVES = 3;
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
    if (occ[start] !== -1) return false;
    const cells = [start];
    let dir = firstDir;
    while (cells.length < want) {
      const cur = cells[cells.length - 1];
      const cx = cur % cols;
      const cy = Math.floor(cur / cols);
      // straight runs more often than turns (clean, maze-like lines)
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
    if (cells.length < 2) return false;
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
      if (cells.includes(y * cols + x)) return false;
    }
    const arrow: Arrow = { id: arrows.length, cells, dir: hd };
    arrows.push(arrow);
    if (!solveOrder(arrows, cols, rows)) {
      arrows.pop();
      return false;
    }
    for (const c of cells) occ[c] = arrow.id;
    filled += cells.length;
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

/* ---------------- look ---------------- */

/** Arrows are plain ink (black / white); each one flashes its colour only while it leaves the board. */
const PALETTE = ["#ff5c5c", "#ff922b", "#f5b700", "#40c057", "#12b886", "#22b8cf", "#339af0", "#5c7cfa", "#9775fa", "#cc5de8", "#f06595"];
const colorOf = (a: Arrow, level: number) => PALETTE[(a.id * 7 + level * 3) % PALETTE.length];

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
type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; r: number; color: string };
type Popup = { id: number; x: number; y: number; text: string; color: string; big: boolean };

const COMBO_MS = 1700;

export default function ArrowsGame({ onFinish }: GameProps) {
  const saved = useGameProgress("arrows");
  const [level, setLevel] = useState(1);
  const [seed, setSeed] = useState(() => (Math.random() * 2 ** 31) | 0);
  const board = useMemo(() => generate(level, seed), [level, seed]);
  const { cols, rows, arrows } = board;

  const [removed, setRemoved] = useState<Set<number>>(() => new Set());
  const [anims, setAnims] = useState<Map<number, Anim>>(() => new Map());
  const [lives, setLives] = useState(LIVES);
  const [livesAtStart, setLivesAtStart] = useState(LIVES);
  const [score, setScore] = useState(0);
  const [shownScore, setShownScore] = useState(0);
  const [hints, setHints] = useState(hintsFor(1));
  const [hinted, setHinted] = useState<number | null>(null);
  const [state, setState] = useState<"play" | "cleared" | "over">("play");
  const [combo, setCombo] = useState(0);
  const [bestCombo, setBestCombo] = useState(0);
  const [cleared, setCleared] = useState(0);
  const [intro, setIntro] = useState(true);
  const [shakeKey, setShakeKey] = useState(0);
  const [brokenHeart, setBrokenHeart] = useState<number | null>(null);
  const [popups, setPopups] = useState<Popup[]>([]);
  const [confirmReset, setConfirmReset] = useState(false);
  const [, setTick] = useState(0);

  const finished = useRef(false);
  const gone = useRef(new Set<number>()); // arrows leaving right now block nothing
  const particles = useRef<Particle[]>([]);
  const lastClear = useRef(0);
  const popupId = useRef(0);
  const calm = useMemo(() => reducedMotion(), []);
  const touched = useRef(false); // the player has tapped: a late-arriving save mustn't swap the board

  /* ----- start from the saved level once it's known ----- */
  useEffect(() => {
    if (!saved.ready || touched.current || saved.level === level) return;
    setLevel(saved.level);
    setSeed((Math.random() * 2 ** 31) | 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the saved level arrives
  }, [saved.ready, saved.level]);

  /* ----- per level ----- */
  useEffect(() => {
    setRemoved(new Set());
    setAnims(new Map());
    gone.current = new Set();
    particles.current = [];
    setHints(hintsFor(level));
    setHinted(null);
    setState("play");
    setCombo(0);
    setIntro(!calm);
    const t = window.setTimeout(() => setIntro(false), 650 + Math.min(arrows.length, 40) * 22);
    return () => window.clearTimeout(t);
  }, [board, calm, arrows.length, level]);

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

  const burst = useCallback(
    (x: number, y: number, color: string, n: number, speed: number) => {
      if (calm) return;
      for (let i = 0; i < n; i++) {
        const ang = Math.random() * Math.PI * 2;
        const v = speed * (0.35 + Math.random() * 0.65);
        const life = 0.45 + Math.random() * 0.45;
        particles.current.push({ x, y, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v, life, max: life, r: 1.2 + Math.random() * 2.2, color });
      }
      if (particles.current.length > 260) particles.current.splice(0, particles.current.length - 260);
    },
    [calm],
  );

  const popup = useCallback((x: number, y: number, text: string, color: string, big = false) => {
    const id = ++popupId.current;
    setPopups((p) => [...p, { id, x, y, text, color, big }]);
    window.setTimeout(() => setPopups((p) => p.filter((q) => q.id !== id)), big ? 1400 : 950);
  }, []);

  /* ----- animation clock: moving arrows + particles ----- */
  const busy = anims.size > 0;
  const [particlesAlive, setParticlesAlive] = useState(false);
  useEffect(() => {
    if (!busy && !particlesAlive) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      // particles
      const ps = particles.current;
      for (const p of ps) {
        p.life -= dt;
        p.vx *= 0.9;
        p.vy = p.vy * 0.9 + 60 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      particles.current = ps.filter((p) => p.life > 0);
      // arrows
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
          burst(ex, ey, colorOf(a, level), 14, 150);
          sfx.edge();
        }
        if (t >= 1) {
          next.delete(id);
          changed = true;
          if (an.kind === "exit") setRemoved((r) => new Set(r).add(id));
        }
      }
      if (changed) setAnims(next);
      setParticlesAlive(particles.current.length > 0);
      setTick((k) => k + 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [busy, particlesAlive, anims, arrows, cols, rows, level, burst]);

  /* ----- level cleared ----- */
  useEffect(() => {
    if (state !== "play" || !arrows.length || removed.size !== arrows.length) return;
    const bonus = 50 * level + lives * 20;
    setScore((s) => s + bonus);
    setState("cleared");
    saved.save(level + 1); // closing the site now resumes on the next level
    sfx.clear();
    // confetti from the top of the board
    for (let i = 0; i < 6; i++) burst(px(Math.random() * cols), px(-0.5), PALETTE[i * 2 % PALETTE.length], 14, 220);
    setParticlesAlive(true);
  }, [removed, arrows.length, state, level, lives, burst, cols, saved]);

  function tap(a: Arrow) {
    if (state !== "play" || intro || gone.current.has(a.id) || anims.has(a.id)) return;
    touched.current = true;
    setHinted(null);
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
      burst(hx, hy, color, 6, 70);
      setParticlesAlive(true);
      sfx.out(c);
      return;
    }

    // blocked: push up to the blocker and spring back; shake; lose a life
    setAnims((m) =>
      new Map(m).set(a.id, { kind: "bump", t0: performance.now(), dur: calm ? 200 : 440, dist: block.steps + 0.32, blocker: block.blocker }),
    );
    sfx.bump();
    setShakeKey((k) => k + 1);
    setCombo(0);
    const left = lives - 1;
    setBrokenHeart(left);
    window.setTimeout(() => setBrokenHeart(null), 700);
    setLives(left);
    popup(hx, hy - 6, "blocked!", "#ff5a4a");
    if (left <= 0) {
      window.setTimeout(() => {
        setState("over");
        sfx.lose();
      }, 450);
      if (!finished.current) {
        finished.current = true;
        onFinish(score);
      }
    }
  }

  function giveHint() {
    if (hints <= 0 || state !== "play" || intro) return;
    const occ = occupancy();
    const free = arrows.find((a) => !gone.current.has(a.id) && !blockOf(a, occ));
    if (free) {
      setHinted(free.id);
      setHints((h) => h - 1);
      sfx.hint();
    }
  }

  function nextLevel() {
    setLevel((l) => l + 1);
    setSeed((Math.random() * 2 ** 31) | 0);
  }

  /** New run on the current level (a fresh board, full lives, score from 0). */
  function restart() {
    touched.current = true;
    finished.current = false;
    setLives(LIVES);
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
  const progress = arrows.length ? removed.size / arrows.length : 0;
  const lost = livesAtStart - lives;
  const stars = lost <= 0 ? 3 : lost === 1 ? 2 : 1;

  return (
    <div className="game-surface arw-surface">
      {/* HUD */}
      <div className="arw-hud">
        <div className="arw-level" key={`lv-${level}`}>
          <small>Level</small>
          <b>{level}</b>
        </div>
        <div className="arw-hud-mid">
          <div className="arw-hearts" aria-label={`${lives} lives`}>
            {Array.from({ length: LIVES }, (_, i) => (
              <i key={i} className={`arw-heart${i < lives ? " on" : ""}${brokenHeart === i ? " break" : ""}`} aria-hidden="true" />
            ))}
          </div>
          <div className="arw-progress" aria-label={`${removed.size} of ${arrows.length} arrows cleared`}>
            <i style={{ width: `${progress * 100}%` }} />
          </div>
        </div>
        <div className="arw-score">
          <small>Score</small>
          <b>{shownScore}</b>
        </div>
      </div>

      <div className={`arw-combo${combo > 1 ? " on" : ""}`} key={`c-${combo}-${cleared}`} aria-live="polite">
        {combo > 1 ? (
          <>
            Combo <b>×{combo}</b>
            <span className="arw-combo-bar" style={{ animationDuration: `${COMBO_MS}ms` }} />
          </>
        ) : (
          <span className="arw-status">{intro ? "Get ready…" : `Tap an arrow to send it out · ${left} left`}</span>
        )}
      </div>

      {/* Board */}
      <div className={`arw-board-wrap${state !== "play" ? " is-dim" : ""}`}>
        <div className={`arw-shake${shakeKey ? " go" : ""}`} key={`s-${shakeKey}`}>
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
              <radialGradient id="arw-bg-glow" cx="50%" cy="40%" r="75%">
                <stop offset="0%" stopColor="#ff8a3d" stopOpacity="0.14" />
                <stop offset="60%" stopColor="#7c5cff" stopOpacity="0.05" />
                <stop offset="100%" stopColor="#000" stopOpacity="0" />
              </radialGradient>
            </defs>
            <rect className="arw-bg" x={-CELL * 0.4} y={-CELL * 0.4} width={W + CELL * 0.8} height={H + CELL * 0.8} rx={16} />
            <rect className="arw-bg-glow" x={-CELL * 0.4} y={-CELL * 0.4} width={W + CELL * 0.8} height={H + CELL * 0.8} rx={16} fill="url(#arw-bg-glow)" />
            <g className="arw-dots">
              {Array.from({ length: cols * rows }, (_, i) => (
                <circle key={i} cx={px(i % cols)} cy={px(Math.floor(i / cols))} r={1.3} />
              ))}
            </g>

            <g clipPath="url(#arw-clip)">
              {arrows.map((a, idx) => {
                if (removed.has(a.id)) return null;
                const color = colorOf(a, level);
                const pts = travelPath(a, cols, rows);
                const len = a.cells.length - 1;
                const an = anims.get(a.id);
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
                  an?.kind === "exit" ? "is-out" : "",
                  an?.kind === "bump" ? "is-bump" : "",
                  blockers.has(a.id) ? "is-blocker" : "",
                  hinted === a.id ? "is-hint" : "",
                ].join(" ");
                return (
                  <g
                    key={a.id}
                    className={cls}
                    style={{ opacity: fade, color: an?.kind === "exit" ? color : undefined, "--i": idx } as React.CSSProperties}
                    onClick={() => tap(a)}
                    role="button"
                    tabIndex={0}
                    aria-label={`Arrow pointing ${["up", "right", "down", "left"][a.dir]}`}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), tap(a))}
                  >
                    {trail ? <path className="arw-trail" d={trail} /> : null}
                    <path className="arw-hit" d={d} />
                    <path className="arw-halo" d={d} />
                    <path className="arw-line" d={d} pathLength={1} />
                    <polygon className="arw-head" points={`${tip.x},${tip.y} ${l.x},${l.y} ${r.x},${r.y}`} />
                  </g>
                );
              })}
            </g>

            {/* sparks */}
            <g className="arw-particles">
              {particles.current.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={p.r * (0.4 + (p.life / p.max) * 0.6)} fill={p.color} opacity={Math.min(1, (p.life / p.max) * 1.4)} />
              ))}
            </g>

            {/* score pop-ups */}
            {popups.map((p) => (
              <text key={p.id} className={`arw-pop${p.big ? " big" : ""}`} x={p.x} y={p.y} fill={p.color}>
                {p.text}
              </text>
            ))}
          </svg>
        </div>

        {/* overlays */}
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
              <button type="button" className="primary-btn" onClick={nextLevel} autoFocus>
                Next level
              </button>
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
              <button type="button" className="primary-btn" onClick={restart} autoFocus>
                Retry level {level}
              </button>
            </div>
          </div>
        ) : null}
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
      </div>

      <div className="arw-actions">
        <button type="button" className="ghost-btn" disabled={hints <= 0 || state !== "play" || intro} onClick={giveHint}>
          💡 Hint ({hints})
        </button>
        <button type="button" className="ghost-btn" onClick={restart}>
          ↻ Restart level
        </button>
        <button
          type="button"
          className="ghost-btn"
          disabled={level === 1 && saved.level === 1}
          onClick={() => setConfirmReset(true)}
        >
          ⟲ Reset progress
        </button>
      </div>
      <p className="game-hint">
        An arrow leaves only if nothing is in the straight line ahead of its head. Clear arrows quickly for combos — bump
        one and you lose a life.
      </p>
    </div>
  );
}
