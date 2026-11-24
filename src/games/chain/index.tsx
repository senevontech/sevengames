/* Chain Reaction: set off one tap and watch it spread. Three boards (glass orbs, a bead grid,
   dominoes), each with a Daily board (the same for everyone; your first finished run of the day
   is your official one) and Endless (rounds with rising targets). XP, a daily streak, and
   leaderboards (supabase/chain.sql). No chips: pure play. */
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { CalendarDays, ChevronLeft, Flame, Infinity as InfinityIcon, Share2, Trophy } from "lucide-react";
import type { GameProps } from "../index";
import { supabase } from "../../supabase";
import { useAuthContext } from "../../context/AuthContext";
import { useShop } from "../../lib/shop";
import { levelForXp } from "../../lib/shopCatalog";
import PlayerAvatar from "../../components/PlayerAvatar";
import { parseAvatar } from "../../lib/avatar";
import { Board, dailySeed, dayKey, hashStr, type BoardStatus, type Variant } from "./core";
import { OrbBoard, OrbSim } from "./orbs";
import { GridBoard, GridSim } from "./grid";
import { DominoBoard, DominoSim } from "./dominoes";
import { fanfare } from "./sounds";
import "./chain.css";

type Mode = "daily" | "endless";
const META: Record<Variant, { name: string; blurb: string; how: string; emoji: string; unit: string }> = {
  orbs: { name: "Glass Orbs", blurb: "Shatter glass marbles; shards break the rest.", how: "Tap anywhere to set off a spark", emoji: "🔮", unit: "orbs" },
  grid: { name: "Bead Grid", blurb: "Overfill a cup and its beads spill into the next.", how: "Tap a cup to drop in a bead", emoji: "⚪", unit: "bursts" },
  dominoes: { name: "Dominoes", blurb: "Push one; watch the lines fall.", how: "Swipe a domino to push it (or tap it)", emoji: "🀱", unit: "dominoes" },
};

/** small drawn icons for the three boards */
function VariantIcon({ v }: { v: Variant }) {
  if (v === "orbs")
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <defs>
          <radialGradient id="cri-a" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stopColor="#ffffff" /><stop offset="0.35" stopColor="#a9d8e6" /><stop offset="1" stopColor="#3d6f7e" /></radialGradient>
          <radialGradient id="cri-b" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stopColor="#fff3d0" /><stop offset="0.4" stopColor="#e08a1e" /><stop offset="1" stopColor="#6b3a06" /></radialGradient>
          <radialGradient id="cri-c" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stopColor="#dbe8ff" /><stop offset="0.4" stopColor="#2456c9" /><stop offset="1" stopColor="#0b1f52" /></radialGradient>
        </defs>
        <circle cx="11" cy="12" r="8" fill="url(#cri-a)" />
        <circle cx="22" cy="10" r="6" fill="url(#cri-b)" />
        <circle cx="19" cy="22" r="7" fill="url(#cri-c)" />
      </svg>
    );
  if (v === "grid")
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <rect x="1" y="1" width="30" height="30" rx="7" fill="#4a2e19" />
        {[8, 16, 24].flatMap((x) => [8, 16, 24].map((y) => <circle key={`${x}${y}`} cx={x} cy={y} r="3.4" fill={(x + y) % 16 === 0 ? "#d6dbe0" : "#24150b"} stroke="#7a5233" strokeWidth="0.8" />))}
      </svg>
    );
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <g transform="rotate(-18 16 16)">
        <rect x="6" y="5" width="9" height="20" rx="1.6" fill="#1c1c20" />
        <circle cx="10.5" cy="10" r="1.3" fill="#eee" /><circle cx="10.5" cy="20" r="1.3" fill="#eee" />
      </g>
      <g transform="rotate(22 16 16)">
        <rect x="17" y="7" width="9" height="20" rx="1.6" fill="#ece4d2" />
        <circle cx="21.5" cy="12" r="1.3" fill="#222" /><circle cx="21.5" cy="22" r="1.3" fill="#222" />
      </g>
    </svg>
  );
}
const SITE = "https://games.senevon.in/game/chain-reaction";

/** endless: what share of the board's best a round asks for */
const targetShare = (v: Variant, round: number) => Math.min(v === "dominoes" ? 0.95 : 0.9, (v === "dominoes" ? 0.6 : 0.5) + 0.03 * (round - 1));

type DailyLocal = { score: number; count: number; total: number; depth: number };
const dailyKey = (v: Variant, day: string) => `senevon:chain:daily:${v}:${day}`;
const bestKey = (v: Variant) => `senevon:chain:best:${v}`;
const readJson = <T,>(k: string): T | null => {
  try {
    const s = localStorage.getItem(k);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
};
const writeJson = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* not saved */
  }
};

type BoardRow = { rank: number; user_id: string; name: string; avatar: unknown; score: number };
type BoardData = { top: BoardRow[]; me: { rank: number; score: number; of: number } | null; played: boolean; streak: number };

async function fetchBoard(variant: Variant, mode: Mode, day?: string): Promise<BoardData | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("chain_board", { p_variant: variant, p_mode: mode, p_day: day ?? null });
  if (error) return null;
  return data as BoardData;
}

/** the emoji result card for sharing */
function shareText(variant: Variant, mode: Mode, s: { count: number; total: number; depth: number; score: number; rounds?: number }, day: string) {
  const filled = mode === "daily" && s.total ? Math.round((s.count / s.total) * 10) : 0;
  const bar = mode === "daily" ? "🟧".repeat(filled) + "⬛".repeat(10 - filled) : "";
  const date = new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const lines =
    mode === "daily"
      ? [`Chain Reaction · ${META[variant].name} · ${date}`, `💥 ${s.count}${variant === "grid" ? " bursts" : `/${s.total}`} · chain ×${s.depth} · ${s.score} pts`, bar]
      : [`Chain Reaction · ${META[variant].name} · Endless`, `🔥 Round ${s.rounds} · ${s.score} pts · chain ×${s.depth}`];
  return [...lines, SITE].join("\n");
}

async function share(text: string) {
  try {
    if (navigator.share) {
      await navigator.share({ text });
      return "shared";
    }
  } catch {
    /* cancelled */
  }
  try {
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    return "failed";
  }
}

/* ---------------- the board on screen ---------------- */
function makeBoard(variant: Variant, canvas: HTMLCanvasElement, opts: ConstructorParameters<typeof OrbBoard>[1], target: number): Board {
  if (variant === "orbs") return new OrbBoard(canvas, opts, target);
  if (variant === "grid") return new GridBoard(canvas, opts, target);
  return new DominoBoard(canvas, opts, target);
}

function BoardHost({
  variant,
  seed,
  round,
  daily,
  target,
  interactive,
  onStatus,
  onDone,
  maxH,
}: {
  variant: Variant;
  seed: number;
  round: number;
  daily: boolean;
  target: number;
  interactive: boolean;
  onStatus?: (s: BoardStatus) => void;
  onDone?: (s: BoardStatus & { input: number[][] }) => void;
  maxH: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const boardRef = useRef<Board | null>(null);
  const cb = useRef({ onStatus, onDone });
  cb.current = { onStatus, onDone };
  useEffect(() => {
    const cv = cvRef.current!;
    const wrap = wrapRef.current!;
    const b = makeBoard(variant, cv, { seed, round, daily, onStatus: (s) => cb.current.onStatus?.(s), onDone: (s) => cb.current.onDone?.(s) }, target);
    boardRef.current = b;
    const fit = () => {
      const w = wrap.clientWidth;
      if (w) b.resize(w, Math.max(240, maxH));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    b.start();
    return () => {
      ro.disconnect();
      b.destroy();
      boardRef.current = null;
    };
  }, [variant, seed, round, daily, target, maxH]);

  const down = useRef<{ x: number; y: number } | null>(null);
  const onDown = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (!interactive) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    down.current = { x: e.clientX, y: e.clientY };
  };
  const onUp = (e: RPointerEvent<HTMLCanvasElement>) => {
    const b = boardRef.current;
    const d = down.current;
    down.current = null;
    if (!interactive || !b || !d) return;
    const p = b.toBoard(d.x, d.y);
    const q = b.toBoard(e.clientX, e.clientY);
    b.tap(p.x, p.y, q.x - p.x, q.y - p.y);
  };
  return (
    <div ref={wrapRef} className="cr-board">
      <canvas ref={cvRef} className={interactive ? "is-live" : ""} onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={() => (down.current = null)} aria-label={interactive ? META[variant].how : undefined} />
    </div>
  );
}

/* ---------------- leaderboard ---------------- */
function Leaders({ variant, mode, day, refreshKey }: { variant: Variant; mode: Mode; day: string; refreshKey: number }) {
  const [data, setData] = useState<BoardData | null | "loading">("loading");
  useEffect(() => {
    let live = true;
    setData("loading");
    void fetchBoard(variant, mode, mode === "daily" ? day : undefined).then((d) => live && setData(d));
    return () => {
      live = false;
    };
  }, [variant, mode, day, refreshKey]);
  if (data === "loading") return <p className="cr-lb-note">Loading the board…</p>;
  if (!data) return <p className="cr-lb-note">The leaderboard isn't available right now.</p>;
  if (!data.top.length) return <p className="cr-lb-note">{mode === "daily" ? "No one has played today's board yet. Be the first." : "No runs yet. Set the first record."}</p>;
  return (
    <ol className="cr-lb">
      {data.top.slice(0, 10).map((r) => (
        <li key={r.user_id} className={data.me && r.rank === data.me.rank && r.score === data.me.score ? "is-me" : ""}>
          <b>{r.rank}</b>
          <PlayerAvatar id={r.user_id} name={r.name} avatar={parseAvatar(r.avatar)} size={22} className="lb-initial cr-lb-av" />
          <span>{r.name}</span>
          <i>{r.score.toLocaleString()}</i>
        </li>
      ))}
      {data.me && data.me.rank > 10 ? (
        <li className="is-me">
          <b>{data.me.rank}</b>
          <span>You (of {data.me.of})</span>
          <i>{data.me.score.toLocaleString()}</i>
        </li>
      ) : null}
    </ol>
  );
}

/* =================================================================== */
export default function ChainGame(_props: GameProps) {
  const { user } = useAuthContext();
  const shop = useShop();
  const [variant, setVariant] = useState<Variant>(() => (readJson<Variant>("senevon:chain:variant") as Variant) ?? "orbs");
  const [screen, setScreen] = useState<"menu" | "play">("menu");
  const [mode, setMode] = useState<Mode>("daily");
  const [day, setDay] = useState(dayKey);
  const [round, setRound] = useState(1);
  const [seed, setSeed] = useState(0);
  const [target, setTarget] = useState(0);
  const [status, setStatus] = useState<BoardStatus | null>(null);
  const [runScore, setRunScore] = useState(0);
  const [runDepth, setRunDepth] = useState(0);
  const [result, setResult] = useState<null | { kind: "daily" | "cleared" | "over"; s: BoardStatus; official: boolean; xp: number }>(null);
  const [practice, setPractice] = useState(false);
  const [streak, setStreak] = useState(0);
  const [lbKey, setLbKey] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [vh, setVh] = useState(() => window.innerHeight);
  const [lbOpen, setLbOpen] = useState<Mode | null>(null);

  useEffect(() => writeJson("senevon:chain:variant", variant), [variant]);
  useEffect(() => {
    const on = () => setVh(window.innerHeight);
    window.addEventListener("resize", on);
    // the daily board changes at midnight (India time)
    const id = window.setInterval(() => setDay(dayKey()), 60_000);
    return () => {
      window.removeEventListener("resize", on);
      window.clearInterval(id);
    };
  }, []);

  const local = readJson<DailyLocal>(dailyKey(variant, day));
  const best = readJson<{ score: number; rounds: number }>(bestKey(variant));
  // signed in: the server knows if today's official run is done (on any device), and the streak
  const [serverPlayed, setServerPlayed] = useState(false);
  useEffect(() => {
    if (!user) return;
    let live = true;
    void fetchBoard(variant, "daily", day).then((d) => {
      if (!live || !d) return;
      setServerPlayed(d.played);
      setStreak(d.streak);
    });
    return () => {
      live = false;
    };
  }, [user, variant, day, lbKey]);
  const playedToday = Boolean(local) || serverPlayed;

  const xp = shop.xpOf("chain");
  const level = levelForXp(xp);

  /* ----- starting ----- */
  const startDaily = () => {
    setMode("daily");
    setPractice(playedToday);
    setSeed(dailySeed(variant, day));
    setRound(1);
    setTarget(0);
    setRunScore(0);
    setRunDepth(0);
    setResult(null);
    setStatus(null);
    setScreen("play");
  };
  const newEndlessRound = (r: number) => {
    const s = hashStr(`${Date.now()}:${Math.random()}:${r}`);
    // how good this board can be (simulated), so the target is always reachable
    const bestPossible = variant === "orbs" ? OrbSim.best(s, r) : variant === "grid" ? GridSim.best(s, r) : DominoSim.best(s, r);
    setSeed(s);
    setRound(r);
    setTarget(Math.max(1, Math.ceil(bestPossible * targetShare(variant, r))));
    setStatus(null);
    setResult(null);
  };
  const startEndless = () => {
    setMode("endless");
    setPractice(false);
    setRunScore(0);
    setRunDepth(0);
    newEndlessRound(1);
    setScreen("play");
  };

  /* ----- finishing ----- */
  const submit = useCallback(
    async (args: { mode: Mode; score: number; pieces: number; rounds: number; depth: number; input: number[][] }) => {
      if (!user || !supabase) return { official: false, xp: 0 };
      const { data, error } = await supabase.rpc("chain_submit", {
        p_variant: variant,
        p_mode: args.mode,
        p_day: day,
        p_score: args.score,
        p_pieces: args.pieces,
        p_rounds: args.rounds,
        p_depth: args.depth,
        p_input: args.input.slice(0, 40),
      });
      if (error || !data) return { official: false, xp: 0 };
      const r = data as { official: boolean; xp: number; streak: number };
      setStreak(r.streak);
      setLbKey((k) => k + 1);
      void shop.refresh();
      return { official: r.official, xp: r.xp };
    },
    [user, variant, day, shop],
  );

  const onDone = useCallback(
    async (s: BoardStatus & { input: number[][] }) => {
      if (mode === "daily") {
        fanfare(true);
        const official = !practice && !readJson(dailyKey(variant, day));
        if (official) writeJson(dailyKey(variant, day), { score: s.score, count: s.count, total: s.total, depth: s.depth } satisfies DailyLocal);
        setResult({ kind: "daily", s, official, xp: 0 });
        if (official) {
          const r = await submit({ mode: "daily", score: s.score, pieces: s.count, rounds: 0, depth: s.depth, input: s.input });
          setResult((cur) => (cur && cur.kind === "daily" ? { ...cur, xp: r.xp } : cur));
        }
        return;
      }
      // endless
      const total = runScore + s.score;
      const depth = Math.max(runDepth, s.depth);
      setRunScore(total);
      setRunDepth(depth);
      if (s.count >= target) {
        fanfare(true);
        setResult({ kind: "cleared", s, official: false, xp: 0 });
        window.setTimeout(() => newEndlessRound(round + 1), 1500);
        return;
      }
      fanfare(false);
      const cleared = round - 1;
      const prev = readJson<{ score: number; rounds: number }>(bestKey(variant));
      if (!prev || total > prev.score) writeJson(bestKey(variant), { score: total, rounds: cleared });
      setResult({ kind: "over", s, official: true, xp: 0 });
      const r = await submit({ mode: "endless", score: total, pieces: s.count, rounds: cleared, depth, input: s.input });
      setResult((cur) => (cur && cur.kind === "over" ? { ...cur, xp: r.xp } : cur));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, practice, variant, day, runScore, runDepth, target, round, submit],
  );

  const doShare = async (text: string) => {
    const r = await share(text);
    setNote(r === "copied" ? "Copied: paste it anywhere" : r === "shared" ? null : "Couldn't share");
    if (r === "copied") window.setTimeout(() => setNote(null), 2200);
  };

  const preview = useMemo(() => ({ seed: dailySeed(variant, day) }), [variant, day]);

  /* ================= menu ================= */
  if (screen === "menu") {
    return (
      <div className="cr-surface">
        <div className="cr-top">
          <span className="cr-top-note">{user ? "Daily board · Endless" : "Sign in to save runs and join the leaderboards"}</span>
          <span className="cr-pill" title="Days in a row with a daily board played">
            <Flame size={14} /> {streak}
          </span>
          {user ? <span className="cr-pill">Lv {level}</span> : null}
        </div>
        <div className="cr-variants" role="radiogroup" aria-label="Board">
          {(Object.keys(META) as Variant[]).map((v) => (
            <button key={v} type="button" role="radio" aria-checked={variant === v} className={`cr-variant${variant === v ? " active" : ""}`} onClick={() => setVariant(v)}>
              <span className="cr-variant-icon">
                <VariantIcon v={v} />
              </span>
              <b>{META[v].name}</b>
              <small>{META[v].blurb}</small>
            </button>
          ))}
        </div>
        <div className="cr-preview" inert>
          <BoardHost key={`${variant}-${preview.seed}`} variant={variant} seed={preview.seed} round={1} daily target={0} interactive={false} maxH={Math.min(380, vh * 0.42)} />
        </div>
        <div className="cr-modes">
          <div className="cr-mode">
            <div className="cr-mode-head">
              <CalendarDays size={18} />
              <b>Daily board</b>
              <button type="button" className="cr-icon" onClick={() => setLbOpen("daily")} aria-label="Today's leaderboard">
                <Trophy size={15} />
              </button>
            </div>
            <p>{playedToday ? (local ? `Today: ${local.score} pts · ${local.count}${variant === "grid" ? " bursts" : `/${local.total}`}` : "Played today") : "Same board for everyone. Your first run counts."}</p>
            <button type="button" className="cr-btn cr-btn-main" onClick={startDaily}>
              {playedToday ? "Practice" : "Play today's board"}
            </button>
          </div>
          <div className="cr-mode">
            <div className="cr-mode-head">
              <InfinityIcon size={18} />
              <b>Endless</b>
              <button type="button" className="cr-icon" onClick={() => setLbOpen("endless")} aria-label="Endless leaderboard">
                <Trophy size={15} />
              </button>
            </div>
            <p>{best ? `Best: ${best.score} pts · ${best.rounds} rounds` : "Clear each round's target. How far can you go?"}</p>
            <button type="button" className="cr-btn" onClick={startEndless}>
              Play endless
            </button>
          </div>
        </div>
        {lbOpen ? (
          <div className="cr-sheet" role="dialog" aria-label="Leaderboard" onClick={() => setLbOpen(null)}>
            <div className="cr-sheet-card" onClick={(e) => e.stopPropagation()}>
              <h3>
                {META[variant].name} · {lbOpen === "daily" ? "Today" : "Endless best"}
              </h3>
              <Leaders variant={variant} mode={lbOpen} day={day} refreshKey={lbKey} />
              <button type="button" className="cr-btn" onClick={() => setLbOpen(null)}>
                Close
              </button>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  /* ================= playing ================= */
  const s = status;
  const goal = mode === "endless" ? target : s?.total ?? 0;
  const pct = s && goal ? Math.min(100, (s.count / goal) * 100) : 0;
  const tip = s && s.tapsLeft > 0 && !s.busy ? (s.count === 0 ? META[variant].how : `${s.tapsLeft} more ${s.tapsLeft === 1 ? "tap" : "taps"}`) : null;
  const shareFor = (kind: "daily" | "over", st: BoardStatus) =>
    shareText(variant, kind === "daily" ? "daily" : "endless", { count: st.count, total: st.total, depth: kind === "daily" ? st.depth : runDepth, score: kind === "daily" ? st.score : runScore, rounds: round - 1 }, day);

  return (
    <div className="cr-surface cr-playing">
      <div className="cr-hud">
        <button type="button" className="cr-icon" onClick={() => setScreen("menu")} aria-label="Back to the menu">
          <ChevronLeft size={18} />
        </button>
        <div className="cr-hud-mid">
          <span className="cr-hud-title">
            {META[variant].name} · {mode === "daily" ? (practice ? "Practice" : "Daily") : `Round ${round}`}
          </span>
          <span className="cr-progress" aria-label={`${s?.count ?? 0} of ${goal}`}>
            <i style={{ width: `${pct}%` }} className={mode === "endless" && s && s.count >= target ? "is-done" : ""} />
            <em>
              {s?.count ?? 0}
              {variant === "grid" && mode === "daily" ? " bursts" : ` / ${goal}`}
              {mode === "endless" ? " target" : ""}
            </em>
          </span>
        </div>
        {s ? (
          <span className="cr-taps" aria-label={`${s.tapsLeft} taps left`}>
            {Array.from({ length: mode === "daily" ? (variant === "grid" ? 3 : 2) : 1 }, (_, i) => (
              <i key={i} className={i < s.tapsLeft ? "on" : ""} />
            ))}
          </span>
        ) : null}
        <span className="cr-score">
          <b>{(mode === "endless" ? runScore : 0) + (s?.score ?? 0)}</b>
          <small>×{s?.depth ?? 0}</small>
        </span>
      </div>
      <div className="cr-stage">
        <BoardHost
          key={`${mode}-${seed}-${round}`}
          variant={variant}
          seed={seed}
          round={round}
          daily={mode === "daily"}
          target={target}
          interactive={!result}
          onStatus={setStatus}
          onDone={(r) => void onDone(r)}
          maxH={Math.max(300, vh - 190)}
        />
        {tip ? <p className="cr-tip">{tip}</p> : null}
        {result?.kind === "cleared" ? (
          <p className="cr-toast">
            Round {round} cleared · {result.s.count} {META[variant].unit}
          </p>
        ) : null}
        {result && result.kind !== "cleared" ? (
          <div className="cr-result" role="dialog" aria-live="assertive">
            <div className="cr-result-card">
              {result.kind === "daily" ? (
                <>
                  <h3>
                    {result.s.count}
                    {variant === "grid" ? " bursts" : ` of ${result.s.total}`}
                  </h3>
                  <p className="cr-result-sub">
                    {result.s.score} pts · longest chain ×{result.s.depth}
                  </p>
                  <p className="cr-result-note">
                    {result.official ? (user ? `Official run saved${result.xp ? ` · +${result.xp} XP` : ""}` : "Today's run · sign in to be on the leaderboard") : `Practice · your official run: ${local?.score ?? "—"} pts`}
                  </p>
                  <Leaders variant={variant} mode="daily" day={day} refreshKey={lbKey} />
                </>
              ) : (
                <>
                  <h3>Run over</h3>
                  <p className="cr-result-sub">
                    Round {round} · needed {target}, got {result.s.count}
                  </p>
                  <p className="cr-result-note">
                    {runScore} pts · {round - 1} rounds cleared{result.xp ? ` · +${result.xp} XP` : ""}
                  </p>
                  <Leaders variant={variant} mode="endless" day={day} refreshKey={lbKey} />
                </>
              )}
              <div className="cr-result-actions">
                <button type="button" className="cr-btn cr-btn-main" onClick={() => void doShare(shareFor(result.kind === "daily" ? "daily" : "over", result.s))}>
                  <Share2 size={15} /> Share
                </button>
                <button type="button" className="cr-btn" onClick={result.kind === "daily" ? startDaily : startEndless}>
                  {result.kind === "daily" ? "Practice again" : "Play again"}
                </button>
                <button type="button" className="cr-btn" onClick={() => setScreen("menu")}>
                  Menu
                </button>
              </div>
              {note ? <p className="cr-result-note">{note}</p> : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
