/* Eight-ball pool: vs CPU (three levels), two players on one device, and online 1-v-1.

   Every shot is simulated in full the moment it is played (engine.ts), then animated.
   Online: the shooter broadcasts the shot (direction, power, spin, cue-ball spot), every
   device simulates the same shot, and the host — who also runs the shot clock — sends the
   resulting table as the authoritative state. While someone aims, their cue is streamed
   to the other player so you watch them line up. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Bot, Globe, LogOut, Menu as MenuIcon, ShoppingBag, Timer, Users } from "lucide-react";
import type { GameProps } from "../index";
import { FOOT_SPOT, HEAD_X, L, MAX_POWER, R, W, ballsLeft, endlessTargets, legalTargets, newRack, placeOk, playEndless, playShot, timeoutFoul, validState, type Group, type PoolState, type EndlessOutcome, type Shot, type SimEvent, type Vec } from "./engine";
import { PoolView, ballCss } from "./render";
import { CPU_MAX_LEVEL, cpuPlan, cpuSkill } from "./cpu";
import { clickSound, cueSound, pocketSound, railSound, setRolling, tickSound, winChime } from "./audio";
import { useAuthContext } from "../../context/AuthContext";
import { useAvatar, type AvatarChoice } from "../../lib/avatar";
import { useShop } from "../../lib/shop";
import { POOL_CUES, cueStats, levelForXp, poolCueOf, poolTableOf, xpForLevel, type PoolCue, type PoolTableTheme } from "../../lib/shopCatalog";
import { useGameShop } from "../gameShop";
import { GameRoom, type RoomMsg, type RoomPeer, type RoomStatus } from "../../lib/gameRoom";
import { useCarromLobby, type LobbyApi, type Matched } from "../carrom/matchmaking";
import { OnlineMenu, RoomWaiting, SignInToPlay } from "../../components/OnlineLobby";
import PlayerAvatar from "../../components/PlayerAvatar";
import { useMatchChat } from "../../components/chat/MatchChat";
import { OutcomeIcon, type Outcome } from "../ResultBanner";
import "../result-banner.css";
import { MatchRewardLine, newMatchId, useMatchReport } from "../../lib/matchReport";
import { matchStake, useCpuBet } from "../../lib/bets";
import { useTokens } from "../../lib/tokens";
import RoomBet from "../../components/RoomBet";
import { CpuBetToggle, CpuBetLine } from "../../components/CpuBet";
import PlayFlow from "../PlayFlow";
import "./pool.css";

type Mode = "cpu" | "pass" | "online" | "endless";
/** `cue`: the cue they play with (its look; online it is shown to the other player). */
type Seat = { kind: "human" | "cpu"; name: string; clientId?: string; userId?: string; avatar?: AvatarChoice | null; cue?: string | null };
/** the CPU's cue (looks only: the CPU does not use cue stats) */
const cpuCue = (skill: number) => (skill < 0.34 ? "pcue:house" : skill < 0.67 ? "pcue:carbon" : "pcue:legend");
/** Pool level from XP, not capped (the CPU keeps getting stronger past the shop's level 30). */
const poolLevel = (xp: number) => Math.max(1, Math.floor((1 + Math.sqrt(1 + (4 * Math.max(0, xp)) / 50)) / 2));

/** online: the time for every shot */
const TURN_MS = 30_000;
/** vs CPU / same device: seconds per shot to choose from (0 = no clock) */
const CLOCKS = [0, 15, 30, 60] as const;
/** XP vs the CPU: a win is worth more the stronger the CPU; a loss still counts a little */
const XP = { win: (skill: number) => Math.round(40 + 60 * skill), loss: 15 };
const groupName = (g: Group | null) => (g === "solid" ? "Solids" : g === "stripe" ? "Stripes" : "Open table");

/* ---------------- Endless: solo, against the clock (offline) ----------------
   The clock runs all the time. Every ball potted scores and buys time; potting on shot after
   shot builds a combo (more points, more time). A scratch costs time. Clear the table and a
   new rack is set up, with a bonus. The run ends when the clock reaches zero. */
const ENDLESS = {
  startMs: 90_000,
  /** points per ball, times the combo (up to maxCombo) */
  ballPts: 10,
  maxCombo: 5,
  /** time per ball potted */
  ballMs: 3_000,
  /** a combo of 3 (three potting shots in a row, and every 3 after that) adds this */
  comboEvery: 3,
  comboMs: 7_000,
  scratchMs: 10_000,
  rackPts: 50,
  rackMs: 15_000,
};
type Run = { score: number; combo: number; streak: number; balls: number; rack: number; endAt: number; pausedAt: number | null; best: number; newBest: boolean };
const BEST_KEY = "senevon:pool:endless-best";
function readBest() {
  try {
    return Math.max(0, Number(localStorage.getItem(BEST_KEY)) || 0);
  } catch {
    return 0;
  }
}
function saveBest(n: number) {
  try {
    localStorage.setItem(BEST_KEY, String(n));
  } catch {
    /* not remembered */
  }
}
const endlessXp = (score: number) => Math.min(80, 10 + Math.floor(score / 20));
const freshRun = (): Run => ({ score: 0, combo: 0, streak: 0, balls: 0, rack: 1, endAt: Date.now() + ENDLESS.startMs, pausedAt: null, best: readBest(), newBest: false });
const fmtClock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/* ---------------- phones: landscape only ----------------
   On a phone the game leaves the scaled game window and fills it edge to edge, always laid out
   landscape. Held upright, the whole layer is turned a quarter (turn the phone to play). */
const isPhoneNow = () => {
  try {
    return window.matchMedia("(pointer: coarse)").matches && Math.min(window.innerWidth, window.innerHeight) < 600;
  } catch {
    return false;
  }
};
function usePhone() {
  const [phone, setPhone] = useState(isPhoneNow);
  useEffect(() => {
    const on = () => setPhone(isPhoneNow());
    window.addEventListener("resize", on);
    window.addEventListener("orientationchange", on);
    return () => {
      window.removeEventListener("resize", on);
      window.removeEventListener("orientationchange", on);
    };
  }, []);
  return phone;
}
/** Is the phone layer turned a quarter (phone held upright)? Read by every pointer handler. */
let ROTATED = false;
/** A pointer position in `el`'s own (unturned, unscaled) CSS pixels. */
function localPt(e: { clientX: number; clientY: number }, el: HTMLElement) {
  const r = el.getBoundingClientRect();
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  if (ROTATED) {
    // turned 90° clockwise: the element's x runs down the screen, its y runs right → left
    const k = w / (r.height || 1);
    return { x: (e.clientY - r.top) * k, y: (r.right - e.clientX) * k, w, h };
  }
  const k = w / (r.width || 1);
  return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k, w, h };
}

/* ---------------- settings (remembered on this device) ---------------- */
const PREF = "senevon:pool:prefs";
type Prefs = { guide: boolean; clock: number };
function readPrefs(): Prefs {
  const d: Prefs = { guide: true, clock: 30 };
  try {
    const p = JSON.parse(localStorage.getItem(PREF) || "{}");
    return {
      guide: p.guide !== false,
      clock: (CLOCKS as readonly number[]).includes(p.clock) ? p.clock : d.clock,
    };
  } catch {
    return d;
  }
}
function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREF, JSON.stringify(p));
  } catch {
    /* not remembered */
  }
}

/* ---------------- small pieces ---------------- */
function MiniBall({ id, gone = false }: { id: number; gone?: boolean }) {
  const c = ballCss(id);
  const style: CSSProperties = id > 8 ? { background: `linear-gradient(#f6f2e8 0 24%, ${c} 24% 76%, #f6f2e8 76%)` } : { background: c };
  return (
    <span className={`pl-mini${gone ? " is-gone" : ""}`} style={style} title={`${id}`}>
      <i>{id}</i>
    </span>
  );
}

function ShotClock({ deadline, total }: { deadline: number; total: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((t) => t + 1), 250);
    return () => window.clearInterval(id);
  }, [deadline]);
  const left = Math.max(0, deadline - Date.now());
  const pct = Math.min(1, left / total);
  return (
    <span className={`pl-clock${left < 10_000 ? " is-low" : ""}`} aria-label={`${Math.ceil(left / 1000)} seconds left`}>
      <svg viewBox="0 0 36 36" aria-hidden="true">
        <circle cx={18} cy={18} r={15} fill="none" strokeWidth={4} className="pl-clock-bg" />
        <circle cx={18} cy={18} r={15} fill="none" strokeWidth={4} strokeDasharray={`${pct * 94.25} 94.25`} transform="rotate(-90 18 18)" className="pl-clock-fg" />
      </svg>
      <b>{Math.ceil(left / 1000)}</b>
    </span>
  );
}

/** Where the cue tip meets the cue ball (english / follow / draw). The cue's spin stat limits
 *  how far from the centre the tip can go (the dashed ring). */
function SpinPicker({ spin, onChange, disabled, reach }: { spin: Vec; onChange: (v: Vec) => void; disabled?: boolean; reach: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const set = (e: RPointerEvent) => {
    const q = localPt(e, ref.current!);
    let x = ((q.x / q.w) * 2 - 1) / 0.8;
    let y = ((q.y / q.h) * 2 - 1) / 0.8;
    const d = Math.hypot(x, y);
    if (d > 1) {
      x /= d;
      y /= d;
    }
    onChange({ x, y });
  };
  const dot = { left: `${50 + spin.x * 40 * reach}%`, top: `${50 + spin.y * 40 * reach}%` };
  return (
    <div className="pl-spin-wrap">
      <button type="button" className="pl-tool pl-spin-btn" onClick={() => setOpen((o) => !o)} disabled={disabled} aria-label="Spin: where the cue hits the cue ball" aria-expanded={open}>
        <span className="pl-spin-ball">
          <i style={dot} />
        </span>
      </button>
      {open ? (
        <div className="pl-spin-pop" role="dialog" aria-label="Where to hit the cue ball">
          <div
            ref={ref}
            className="pl-spin-big"
            onPointerDown={(e) => {
              (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
              set(e);
            }}
            onPointerMove={(e) => e.buttons && set(e)}
          >
            <span className="pl-spin-cross" />
            <span className="pl-spin-reach" style={{ inset: `${50 - 40 * reach}%` }} />
            <i style={dot} />
          </div>
          <p>Top: follow · Bottom: draw · Sides: english</p>
          <div className="pl-spin-row">
            <button type="button" className="pl-pill" onClick={() => onChange({ x: 0, y: 0 })}>
              Centre
            </button>
            <button type="button" className="pl-pill pl-pill-main" onClick={() => setOpen(false)}>
              Done
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* =================================================================== */
export default function PoolGame(_props: GameProps) {
  const { user } = useAuthContext();
  const { choice: myAvatar } = useAvatar(user);
  const shop = useShop();
  const meta = user?.user_metadata ?? {};
  const myName = ((meta.full_name as string | undefined) || (meta.name as string | undefined) || user?.email?.split("@")[0] || "You").slice(0, 40);

  const gameShop = useGameShop();
  // the table and cue you have equipped (shop); the cue's stats change your shots
  const myTableId = shop.equippedIn("pool_table");
  const tableTheme = poolTableOf(myTableId);
  const myCueId = shop.equippedIn("pool_cue") && POOL_CUES[shop.equippedIn("pool_cue")!] ? shop.equippedIn("pool_cue") : "pcue:house";
  const myCue = poolCueOf(myCueId);
  const stats = cueStats(myCue);
  const statsRef = useRef(stats);
  statsRef.current = stats;
  // the CPU you face gets stronger as your pool level rises (guests: level 1)
  const myPoolLevel = user ? poolLevel(shop.xpOf("pool")) : 1;
  const skill = cpuSkill(myPoolLevel);
  const skillRef = useRef(skill);
  skillRef.current = skill;
  const [prefs, setPrefsState] = useState(readPrefs);
  const setPrefs = (p: Partial<Prefs>) =>
    setPrefsState((cur) => {
      const next = { ...cur, ...p };
      savePrefs(next);
      return next;
    });

  const [screen, setScreen] = useState<"menu" | "room" | "game">("menu");
  const [mode, setMode] = useState<Mode>("cpu");
  const [st, setSt] = useState<PoolState>(() => newRack());
  const stRef = useRef(st);
  stRef.current = st;
  const [seats, setSeats] = useState<Seat[]>([]);
  const seatsRef = useRef(seats);
  seatsRef.current = seats;
  const [animating, setAnimating] = useState(false);
  const animRef = useRef(false);
  const [power, setPower] = useState(0);
  const powerRef = useRef(0);
  const [spin, setSpin] = useState<Vec>({ x: 0, y: 0 });
  const spinRef = useRef(spin);
  spinRef.current = spin;
  const aimRef = useRef(0); // radians
  const [cuePlace, setCuePlace] = useState<Vec | null>(null);
  const cuePlaceRef = useRef<Vec | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [deadline, setDeadline] = useState(0);
  const deadlineRef = useRef(0);
  deadlineRef.current = deadline;
  const [xpGain, setXpGain] = useState<number | null>(null);
  const awarded = useRef(false);
  const [cpuThinking, setCpuThinking] = useState(false);
  const matchReport = useMatchReport("pool", () => void shop.refresh());
  // vs CPU: 1 earned chip on each game, if the player switched it on
  const cpuBet = useCpuBet("pool");

  // canvas
  const viewRef = useRef<PoolView | null>(null);
  useEffect(() => () => setRolling(0), []);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  // Endless: the run (score, combo, the clock)
  const [run, setRunState] = useState<Run>(freshRun);
  const runRef = useRef(run);
  const setRun = (r: Run) => {
    runRef.current = r;
    setRunState(r);
  };
  const endlessShot = useRef<EndlessOutcome | null>(null);

  // phones: landscape only (see usePhone / localPt)
  const phone = usePhone();
  const anchorRef = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [hostBox, setHostBox] = useState({ w: 0, h: 0 });

  // online
  const roomRef = useRef<GameRoom | null>(null);
  const [roomStatus, setRoomStatus] = useState<RoomStatus | null>(null);
  const [roomNote, setRoomNote] = useState<string | null>(null);
  const [peers, setPeers] = useState<RoomPeer[]>([]);
  const [matched, setMatched] = useState(false);
  // (callbacks made when the room opened read this, not the state)
  const matchedRef = useRef(false);
  const { wallet } = useTokens();
  const earnedRef = useRef(0);
  earnedRef.current = wallet?.earned ?? 0;
  const [oppGone, setOppGone] = useState(false);
  const [guestWait, setGuestWait] = useState<string | null>(null);
  const hostMatch = useRef<Matched | null>(null);
  const autoStart = useRef(false);
  const lobbyRef = useRef<LobbyApi | null>(null);
  const matchIdRef = useRef("");
  const playersRef = useRef<string[]>([]);
  const remoteState = useRef<PoolState | null>(null);
  const remoteAim = useRef<{ dir: Vec; power: number } | null>(null);
  const lastAimSent = useRef(0);
  const screenRef = useRef(screen);
  screenRef.current = screen;

  const online = mode === "online" && roomRef.current !== null;
  /** ms per shot now (0: no clock) */
  const turnMs = mode === "online" ? TURN_MS : mode === "endless" ? 0 : prefs.clock * 1000;
  const turnMsRef = useRef(turnMs);
  turnMsRef.current = turnMs;
  const isHost = !online || roomRef.current!.isHost;
  const mySeat = online ? seats.findIndex((x) => x.clientId === roomRef.current!.clientId) : mode === "cpu" || mode === "endless" ? 0 : -1;
  const turnSeat = seats[st.turn];
  const myTurn = screen === "game" && !animating && !st.over && !oppGone && (mode === "pass" ? true : st.turn === mySeat);

  /* ---------------- the canvas view ---------------- */
  const onView = useCallback((view: PoolView | null) => {
    viewRef.current = view;
    if (!view) {
      setRolling(0);
      return;
    }
    view.onRoll = setRolling;
    const s = stRef.current;
    const balls = s.balls.map((b) => ({ ...b }));
    if (s.inHand && cuePlaceRef.current) balls[0] = { id: 0, x: cuePlaceRef.current.x, y: cuePlaceRef.current.y, potted: false };
    view.setBalls(balls);
  }, []);


  // the balls on the view follow the state (and the cue ball in hand)
  useEffect(() => {
    const view = viewRef.current;
    if (!view || animRef.current) return;
    const balls = st.balls.map((b) => ({ ...b }));
    if (st.inHand && cuePlace) balls[0] = { id: 0, x: cuePlace.x, y: cuePlace.y, potted: false };
    view.setBalls(balls);
    view.inHand = st.inHand && !st.over && screen === "game" ? st.inHand : null;
    view.placeBad = Boolean(st.inHand && cuePlace && !placeOk(st, cuePlace.x, cuePlace.y));
  }, [st, cuePlace, screen]);

  const aimDir = () => ({ x: Math.cos(aimRef.current), y: Math.sin(aimRef.current) });

  // what the view draws for aiming
  const syncAim = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    const s = stRef.current;
    const seat = seatsRef.current[s.turn];
    const mine = myTurnRef.current;
    const remote = !mine && online && remoteAim.current;
    // the cue on the table is the shooter's
    view.setCue(mine && (mode !== "pass" || !seat?.cue) ? myCueObj.current : poolCueOf(seat?.cue ?? null));
    const st8 = statsRef.current;
    view.aim = {
      show: screenRef.current === "game" && !s.over && !animRef.current && (mine || Boolean(remote) || (seat?.kind === "cpu" && cpuAimShow.current)),
      dir: remote ? remoteAim.current!.dir : aimDir(),
      power: remote ? remoteAim.current!.power : powerRef.current,
      guide: mine && prefs.guide,
      legal: modeRef.current === "endless" ? endlessTargets(s) : legalTargets(s),
      reach: st8.guide,
      cuePath: st8.cuePath,
      follow: -spinRef.current.y * st8.spin,
    };
  }, [online, prefs.guide, mode]);
  const myCueObj = useRef<PoolCue>(myCue);
  myCueObj.current = myCue;
  const myTurnRef = useRef(myTurn);
  myTurnRef.current = myTurn;
  const cpuAimShow = useRef(false);
  useEffect(() => {
    syncAim();
  });

  /** point the cue at the rack (or the nearest legal ball) when a turn starts */
  const aimAtSomething = useCallback((s: PoolState, from?: Vec) => {
    const cue = from ?? s.balls[0];
    const targets = (modeRef.current === "endless" ? endlessTargets(s) : legalTargets(s)).map((id) => s.balls[id]);
    let tgt: Vec = FOOT_SPOT;
    if (!s.isBreak && targets.length) {
      tgt = targets.reduce((a, b) => (Math.hypot(a.x - cue.x, a.y - cue.y) < Math.hypot(b.x - cue.x, b.y - cue.y) ? a : b));
    }
    aimRef.current = Math.atan2(tgt.y - cue.y, tgt.x - cue.x);
  }, []);

  /* ---------------- playing a shot ---------------- */
  const sendAim = useCallback(
    (force = false) => {
      const room = roomRef.current;
      if (!room || mode !== "online" || !myTurnRef.current) return;
      const now = Date.now();
      if (!force && now - lastAimSent.current < 70) return;
      lastAimSent.current = now;
      const d = aimDir();
      room.send("aim", { d: [d.x, d.y], p: powerRef.current, c: cuePlaceRef.current ? [cuePlaceRef.current.x, cuePlaceRef.current.y] : null });
    },
    [mode],
  );

  /** Endless: score the shot that just finished (points, combo, time), and end the run if the
   *  clock has run out. Returns the state to show. */
  function scoreEndless(s: PoolState): PoolState {
    const out = endlessShot.current;
    endlessShot.current = null;
    const r = { ...runRef.current };
    const notes: string[] = [];
    if (out) {
      r.streak = out.pots > 0 && !out.scratch ? r.streak + 1 : 0;
      r.combo = Math.min(ENDLESS.maxCombo, r.streak);
      const mult = Math.max(1, r.combo);
      if (out.pots) {
        const pts = out.pots * ENDLESS.ballPts * mult;
        const ms = out.pots * ENDLESS.ballMs;
        r.score += pts;
        r.balls += out.pots;
        r.endAt += ms;
        notes.push(`+${pts} · +${ms / 1000}s`);
      }
      if (r.streak > 0 && r.streak % ENDLESS.comboEvery === 0) {
        r.endAt += ENDLESS.comboMs;
        notes.push(`${r.streak} in a row! +${ENDLESS.comboMs / 1000}s`);
      }
      if (out.scratch) {
        r.endAt -= ENDLESS.scratchMs;
        notes.push(`Scratch: −${ENDLESS.scratchMs / 1000}s`);
      }
      if (out.cleared) {
        r.score += ENDLESS.rackPts;
        r.endAt += ENDLESS.rackMs;
        r.rack += 1;
        notes.push(`Table cleared! +${ENDLESS.rackPts} · +${ENDLESS.rackMs / 1000}s`);
      }
    }
    let next: PoolState = { ...s, note: notes.length ? notes.join(" · ") : null };
    if (r.pausedAt === null && Date.now() >= r.endAt) next = finishRun(next, r);
    else setRun(r);
    return next;
  }

  /** Endless: time's up. */
  function finishRun(s: PoolState, r: Run = runRef.current): PoolState {
    const newBest = r.score > r.best;
    if (newBest) saveBest(r.score);
    setRun({ ...r, endAt: Math.min(r.endAt, Date.now()), newBest, best: Math.max(r.best, r.score) });
    tickSound(true);
    return { ...s, over: true, winner: 0, inHand: null, note: `${r.balls} ball${r.balls === 1 ? "" : "s"} · rack ${r.rack}` };
  }

  const settle = useCallback(
    (next: PoolState) => {
      animRef.current = false;
      setAnimating(false);
      let s = remoteState.current && remoteState.current.shots >= next.shots ? remoteState.current : next;
      remoteState.current = null;
      if (modeRef.current === "endless") s = scoreEndless(s);
      stRef.current = s;
      setSt(s);
      viewRef.current?.setBalls(s.balls);
      if (s.note) {
        setToast(s.note);
        window.setTimeout(() => setToast((t) => (t === s.note ? null : t)), 2600);
      }
      if (s.over) winChime();
      const place = s.inHand ? { x: s.balls[0].x, y: s.balls[0].y } : null;
      cuePlaceRef.current = place;
      setCuePlace(place);
      aimAtSomething(s, place ?? undefined);
      powerRef.current = 0;
      setPower(0);
      setSpin({ x: 0, y: 0 });
      setDeadline(Date.now() + (turnMsRef.current || TURN_MS));
    },
    [aimAtSomething],
  );

  const onSimEvent = useCallback((e: SimEvent) => {
    const pan = ((e.x / L) * 2 - 1) * 0.6;
    if (e.k === "cue") cueSound(e.v, pan);
    else if (e.k === "ball") clickSound(e.v, pan);
    else if (e.k === "rail") railSound(e.v, pan);
    else if (e.k === "pot") pocketSound(e.v, pan);
  }, []);

  /** Animate a shot from `from`; the host (or a local game) also decides the next state. */
  const runShot = useCallback(
    (from: PoolState, shot: Shot, cue: Vec | null) => {
      const view = viewRef.current;
      let out;
      if (modeRef.current === "endless") {
        out = playEndless(from, shot, cue, true);
        endlessShot.current = out;
      } else out = playShot(from, shot, cue, true);
      const { next, sim } = out;
      animRef.current = true;
      setAnimating(true);
      remoteAim.current = null;
      cpuAimShow.current = false;
      const start = from.balls.map((b) => ({ ...b }));
      if (from.inHand && cue && placeOk(from, cue.x, cue.y)) start[0] = { id: 0, x: cue.x, y: cue.y, potted: false };
      if (view) {
        view.aim = { ...view.aim, show: false };
        view.setBalls(start);
        view.playSim(sim, onSimEvent, () => settle(next));
      } else settle(next);
      const room = roomRef.current;
      if (room?.isHost && mode === "online") room.send("state", { st: next, seats: seatsRef.current, mid: matchIdRef.current, timeLeft: TURN_MS });
    },
    [mode, onSimEvent, settle],
  );

  function shoot() {
    if (!myTurnRef.current) return;
    const s = stRef.current;
    const p = powerRef.current;
    if (p < 0.02) return;
    const cue = s.inHand ? cuePlaceRef.current : null;
    if (s.inHand && (!cue || !placeOk(s, cue.x, cue.y))) {
      setToast("Put the cue ball somewhere free first");
      return;
    }
    const d = aimDir();
    const k = statsRef.current;
    const shot: Shot = { dx: d.x, dy: d.y, power: p * k.power, sx: spinRef.current.x * k.spin, sy: -spinRef.current.y * k.spin };
    roomRef.current?.send("shot", { n: s.shots, shot, cue });
    runShot(s, shot, cue);
  }

  /* ---------------- CPU ---------------- */
  useEffect(() => {
    if (screen !== "game" || mode !== "cpu" || animating || st.over) return;
    if (seats[st.turn]?.kind !== "cpu") return;
    let alive = true;
    setCpuThinking(true);
    const s = st;
    const go = async () => {
      await new Promise((r) => setTimeout(r, 650));
      const plan = await cpuPlan(s, skillRef.current);
      if (!alive || stRef.current !== s) return;
      // show the CPU lining up: place the cue ball, swing the cue round, pull back
      if (plan.cue) {
        cuePlaceRef.current = plan.cue;
        setCuePlace(plan.cue);
      }
      const target = Math.atan2(plan.shot.dy, plan.shot.dx);
      const from = aimRef.current;
      let delta = target - from;
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta < -Math.PI) delta += 2 * Math.PI;
      cpuAimShow.current = true;
      const t0 = performance.now();
      await new Promise<void>((done) => {
        const step = (now: number) => {
          if (!alive) return done();
          const q = Math.min(1, (now - t0) / 700);
          const e = 1 - (1 - q) ** 3;
          aimRef.current = from + delta * e;
          powerRef.current = q > 0.55 ? ((q - 0.55) / 0.45) * plan.shot.power : 0;
          syncAim();
          if (q < 1) requestAnimationFrame(step);
          else done();
        };
        requestAnimationFrame(step);
      });
      if (!alive || stRef.current !== s) return;
      await new Promise((r) => setTimeout(r, 180));
      if (!alive || stRef.current !== s) return;
      setCpuThinking(false);
      aimRef.current = target;
      runShot(s, plan.shot, plan.cue);
    };
    void go();
    return () => {
      alive = false;
      setCpuThinking(false);
    };
  }, [screen, mode, animating, st, seats, runShot, syncAim]);

  /* ---------------- XP at the end ---------------- */
  useEffect(() => {
    if (st.over && mode === "cpu") void cpuBet.settle(st.winner === 0 ? "win" : "lose");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.over]);
  useEffect(() => {
    if (!st.over || awarded.current || mode === "pass" || !user) return;
    awarded.current = true;
    if (mode === "online") {
      const w = st.winner !== null ? seatsRef.current[st.winner] : null;
      if (matchIdRef.current) void matchReport.report(matchIdRef.current, playersRef.current, [w?.userId ?? null]);
      return;
    }
    const won = st.winner === 0;
    const amount = mode === "endless" ? endlessXp(runRef.current.score) : won ? XP.win(skillRef.current) : XP.loss;
    setXpGain(amount);
    void shop.awardXp("pool", amount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.over]);

  /* ---------------- local games ---------------- */
  function startLocal(m: Mode) {
    roomRef.current?.leave();
    roomRef.current = null;
    setMode(m);
    const list: Seat[] =
      m === "endless"
        ? [{ kind: "human", name: myName, userId: user?.id, avatar: myAvatar, cue: myCueId }]
        : m === "cpu"
        ? [
            { kind: "human", name: myName, userId: user?.id, avatar: myAvatar, cue: myCueId },
            { kind: "cpu", name: `CPU · Lv ${myPoolLevel}`, cue: cpuCue(skill) },
          ]
        : [
            { kind: "human", name: "Player 1" },
            { kind: "human", name: "Player 2" },
          ];
    setSeats(list);
    seatsRef.current = list;
    modeRef.current = m;
    endlessShot.current = null;
    if (m === "cpu") void cpuBet.open();
    if (m === "endless") setRun(freshRun());
    begin(newRack(Math.random, m === "cpu" ? (Math.random() < 0.5 ? 0 : 1) : 0));
  }

  /** back to the menu from a local game (walking out of a CPU game loses its stake) */
  function leaveLocal() {
    if (mode === "cpu" && !stRef.current.over) cpuBet.forfeit();
    setScreen("menu");
  }

  /* ---------------- Endless: the clock ---------------- */
  // time's up (a shot that is still rolling finishes first: its balls count)
  const endlessLive = mode === "endless" && screen === "game" && !st.over;
  useEffect(() => {
    if (!endlessLive) return;
    let last = -1;
    const id = window.setInterval(() => {
      const r = runRef.current;
      if (r.pausedAt !== null) return;
      const left = r.endAt - Date.now();
      const sec = Math.ceil(left / 1000);
      if (sec !== last && sec <= 5 && sec > 0) tickSound(sec <= 2);
      last = sec;
      if (left > 0 || animRef.current) return;
      const s = finishRun(stRef.current);
      stRef.current = s;
      setSt(s);
      winChime();
    }, 200);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endlessLive]);
  // the clock stops while the page is hidden (or you're on the menu)
  useEffect(() => {
    if (!endlessLive) return;
    const pause = () => {
      const r = runRef.current;
      if (r.pausedAt === null) setRun({ ...r, pausedAt: Date.now() });
    };
    const resume = () => {
      const r = runRef.current;
      if (r.pausedAt !== null) setRun({ ...r, endAt: r.endAt + (Date.now() - r.pausedAt), pausedAt: null });
    };
    const onVis = () => (document.hidden ? pause() : resume());
    document.addEventListener("visibilitychange", onVis);
    resume();
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      pause();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endlessLive]);

  function begin(s: PoolState) {
    viewRef.current?.cancelPlayback();
    animRef.current = false;
    setAnimating(false);
    remoteState.current = null;
    stRef.current = s;
    setSt(s);
    awarded.current = false;
    setXpGain(null);
    setOppGone(false);
    setToast(null);
    const place = { x: s.balls[0].x, y: s.balls[0].y };
    cuePlaceRef.current = place;
    setCuePlace(place);
    aimAtSomething(s, place);
    powerRef.current = 0;
    setPower(0);
    setSpin({ x: 0, y: 0 });
    setDeadline(Date.now() + (turnMsRef.current || TURN_MS));
    setScreen("game");
  }

  /* ---------------- online ---------------- */
  // `look` carries your cue to the other player (they see it when you aim)
  const me = () => ({ userId: user?.id ?? "", name: myName, avatar: myAvatar, look: myCueId, chips: earnedRef.current });

  const onMessage = useCallback(
    (msg: RoomMsg) => {
      const room = roomRef.current;
      if (!room) return;
      const s = stRef.current;
      if (msg.t === "state" && !room.isHost) {
        if (!validState(msg.st)) return;
        const next = msg.st;
        const list = Array.isArray(msg.seats) ? (msg.seats as Seat[]).slice(0, 2) : seatsRef.current;
        setMode("online");
        setSeats(list);
        seatsRef.current = list;
        if (typeof msg.mid === "string" && msg.mid !== matchIdRef.current) {
          matchIdRef.current = msg.mid.slice(0, 60);
          playersRef.current = list.filter((x) => x.userId).map((x) => x.userId!);
          matchReport.reset();
          // the host's stake for this match (the server checks it)
          const stake = Math.max(0, Math.floor(Number(msg.bet) || 0));
          if (stake > 0) void matchReport.joinBet(matchIdRef.current, playersRef.current, msg.bk === "random" ? "random" : "room", stake);
          awarded.current = false;
          setXpGain(null);
          // a new rack
          begin(next);
          return;
        }
        if (next.shots < s.shots) return;
        setDeadline(Date.now() + Math.max(0, Math.min(TURN_MS, Number(msg.timeLeft) || TURN_MS)));
        if (animRef.current) remoteState.current = next;
        else if (next.shots > s.shots || screenRef.current !== "game") {
          if (screenRef.current !== "game") begin(next);
          else settle(next);
        }
        return;
      }
      const seat = seatsRef.current[s.turn];
      const fromShooter = seat?.clientId === msg.from;
      if (msg.t === "aim" && fromShooter && !animRef.current) {
        const d = Array.isArray(msg.d) ? (msg.d as number[]) : null;
        if (!d || !Number.isFinite(d[0]) || !Number.isFinite(d[1])) return;
        remoteAim.current = { dir: { x: d[0], y: d[1] }, power: Math.max(0, Math.min(1, Number(msg.p) || 0)) };
        const c = Array.isArray(msg.c) ? (msg.c as number[]) : null;
        if (s.inHand && c && Number.isFinite(c[0]) && Number.isFinite(c[1])) {
          const place = { x: c[0], y: c[1] };
          cuePlaceRef.current = place;
          setCuePlace(place);
        }
        syncAim();
        return;
      }
      if (msg.t === "shot" && fromShooter && !animRef.current) {
        if (Number(msg.n) !== s.shots) return;
        const sh = msg.shot as Shot;
        if (!sh || ![sh.dx, sh.dy, sh.power, sh.sx, sh.sy].every(Number.isFinite)) return;
        const shot: Shot = { dx: sh.dx, dy: sh.dy, power: Math.max(0, Math.min(MAX_POWER, sh.power)), sx: Math.max(-1, Math.min(1, sh.sx)), sy: Math.max(-1, Math.min(1, sh.sy)) };
        const c = msg.cue as Vec | null;
        const cue = c && Number.isFinite(c.x) && Number.isFinite(c.y) ? { x: c.x, y: c.y } : null;
        runShot(s, shot, cue);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runShot, settle, syncAim],
  );
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  function hostStartOnline() {
    const room = roomRef.current;
    if (!room?.isHost || room.players.length < 2) return;
    const list: Seat[] = room.players.slice(0, 2).map((p) => ({ kind: "human", name: p.name, clientId: p.clientId, userId: p.userId, avatar: p.avatar, cue: p.look ?? null }));
    setMode("online");
    setSeats(list);
    seatsRef.current = list;
    matchIdRef.current = newMatchId();
    playersRef.current = list.filter((x) => x.userId).map((x) => x.userId!);
    matchReport.reset();
    // the chip stake: 3 each in random matches (if both can), the host's pick in friend rooms
    const kind = matchedRef.current ? "random" : "room";
    const stake = matchStake(matchedRef.current, room.settings.bet, room.players.slice(0, 2).map((p) => p.chips));
    if (stake > 0) void matchReport.joinBet(matchIdRef.current, playersRef.current, kind, stake);
    const s = newRack(Math.random, Math.random() < 0.5 ? 0 : 1);
    begin(s);
    room.send("state", { st: s, seats: list, mid: matchIdRef.current, timeLeft: TURN_MS, bet: stake, bk: kind });
  }

  // the shot clock: online the host runs it, otherwise this device (the CPU has no clock).
  // Out of time = a foul: the other player gets ball in hand.
  const clockOn = turnMs > 0 && seats[st.turn]?.kind === "human";
  useEffect(() => {
    if (!clockOn || !isHost || screen !== "game" || st.over || animating || oppGone) return;
    const id = window.setTimeout(
      () => {
        const cur = stRef.current;
        if (cur !== st || animRef.current) return;
        const next = timeoutFoul(cur);
        if (online) roomRef.current?.send("state", { st: next, seats: seatsRef.current, mid: matchIdRef.current, timeLeft: TURN_MS });
        settle(next);
      },
      Math.max(0, deadline - Date.now()),
    );
    return () => window.clearTimeout(id);
  }, [clockOn, online, isHost, screen, st, animating, deadline, oppGone, settle]);
  // the last five seconds of your shot tick
  useEffect(() => {
    if (!clockOn || !myTurn) return;
    let last = -1;
    const id = window.setInterval(() => {
      const left = Math.ceil((deadlineRef.current - Date.now()) / 1000);
      if (left !== last && left <= 5 && left > 0) tickSound(left <= 2);
      last = left;
    }, 200);
    return () => window.clearInterval(id);
  }, [clockOn, myTurn]);

  const roomEvents = () => ({
    onStatus: (status: RoomStatus, note?: string) => {
      setRoomStatus(status);
      setRoomNote(note ?? null);
      const room = roomRef.current;
      if (status === "lobby" && room?.isHost && hostMatch.current) {
        lobbyRef.current?.sendGo(hostMatch.current, room.code);
        hostMatch.current = null;
      }
    },
    onPeers: (list: RoomPeer[]) => {
      setPeers(list);
      const room = roomRef.current;
      if (!room) return;
      // the other player left mid-game: you win
      if (screenRef.current === "game" && !stRef.current.over) {
        const present = new Set(list.map((p) => p.clientId));
        const other = seatsRef.current.find((x) => x.clientId && x.clientId !== room.clientId);
        if (other && !present.has(other.clientId!)) {
          setOppGone(true);
          const mine = seatsRef.current.findIndex((x) => x.clientId === room.clientId) as 0 | 1;
          if (!awarded.current && matchIdRef.current && user) {
            awarded.current = true;
            void matchReport.report(matchIdRef.current, playersRef.current, [user.id]);
          }
          const s = { ...stRef.current, over: true, winner: mine, note: `${other.name} left` };
          stRef.current = s;
          setSt(s);
        }
      }
      if (room.isHost && autoStart.current && list.length >= 2) {
        autoStart.current = false;
        window.setTimeout(() => roomRef.current === room && hostStartOnline(), 400);
      }
    },
    onMessage: (msg: RoomMsg) => onMessageRef.current(msg),
  });

  function openRoom(match?: Matched) {
    roomRef.current?.leave();
    hostMatch.current = match ?? null;
    autoStart.current = Boolean(match);
    setMatched(Boolean(match));
    matchedRef.current = Boolean(match);
    setOppGone(false);
    setPeers([]);
    setRoomStatus(null);
    setRoomNote(null);
    setMode("online");
    roomRef.current = GameRoom.host("pool", me(), 2, {}, roomEvents());
    setScreen("room");
  }
  function joinRoom(code: string, wasMatched = false) {
    roomRef.current?.leave();
    setMatched(wasMatched);
    matchedRef.current = wasMatched;
    setOppGone(false);
    setPeers([]);
    setRoomStatus(null);
    setRoomNote(null);
    setMode("online");
    roomRef.current = GameRoom.join("pool", code, me(), roomEvents());
    setScreen("room");
  }
  function leaveOnline() {
    if (mode === "online" && screen === "game" && !stRef.current.over && !awarded.current && matchIdRef.current) {
      awarded.current = true;
      void matchReport.report(matchIdRef.current, playersRef.current, []);
    }
    roomRef.current?.leave();
    roomRef.current = null;
    hostMatch.current = null;
    autoStart.current = false;
    setMode("cpu");
    setScreen("menu");
  }
  useEffect(() => () => roomRef.current?.leave(), []);

  const lobby = useCarromLobby({
    enabled: GameRoom.configured && Boolean(user) && screen === "menu",
    channel: "pool-lobby",
    userId: user?.id ?? null,
    name: myName,
    avatar: myAvatar,
    available: screen === "menu" && !guestWait,
    onMatched: (m) => {
      if (m.role === "host") {
        setGuestWait(null);
        openRoom(m);
      } else setGuestWait(m.partnerName);
    },
    onGo: (_m, code) => {
      setGuestWait(null);
      joinRoom(code, true);
    },
  });
  lobbyRef.current = lobby;
  useEffect(() => {
    if (lobby.note) setGuestWait(null);
  }, [lobby.note]);

  useMatchChat(mode === "online" && roomRef.current ? `pool:${roomRef.current.code}` : null, { id: roomRef.current?.clientId ?? "", name: myName });

  /* ---------------- input ----------------
     Mouse: the cue points where you point. Touch (a finger hides what it points at, and is
     coarse): a quick tap points the cue at the spot; a drag TURNS the cue — moving your finger
     round the cue ball turns it the same way, at about half the angle, and never faster than
     a slow fixed rate when you drag close to the cue ball. The fine wheel then nudges it. */
  const drag = useRef<null | "aim" | "place">(null);
  const touchAim = useRef<{ x0: number; y0: number; t0: number; last: Vec; moved: boolean } | null>(null);
  const worldAt = (e: { clientX: number; clientY: number }) => {
    // the game page may scale (or, on a phone held upright, turn) the game: back to the canvas's own pixels
    const q = localPt(e, viewRef.current!.canvas);
    return viewRef.current!.toWorld(q.x, q.y);
  };
  const cueNow = () => {
    const s = stRef.current;
    return s.inHand && cuePlaceRef.current ? cuePlaceRef.current : s.balls[0];
  };
  const aimToward = (p: Vec) => {
    const cue = cueNow();
    if (Math.hypot(p.x - cue.x, p.y - cue.y) < R * 0.8) return;
    aimRef.current = Math.atan2(p.y - cue.y, p.x - cue.x);
    syncAim();
    sendAim();
  };
  /** touch drag: turn the cue by the finger's movement around the cue ball */
  const aimTurn = (from: Vec, to: Vec) => {
    const view = viewRef.current!;
    const c = cueNow();
    const rx = to.x - c.x;
    const ry = to.y - c.y;
    const d = Math.hypot(rx, ry) || 1;
    // sideways movement (relative to the line from the cue ball), in screen pixels
    const tang = ((rx * (to.y - from.y) - ry * (to.x - from.x)) / d) * view.cssPerUnit;
    const dist = d * view.cssPerUnit;
    aimRef.current += (0.5 * tang) / Math.max(dist, 160);
    syncAim();
    sendAim();
  };
  const placeAt = (p: Vec) => {
    const s = stRef.current;
    const x = Math.max(R, Math.min((s.inHand === "kitchen" ? HEAD_X : L) - R * (s.inHand === "kitchen" ? 0 : 1), p.x));
    const y = Math.max(R, Math.min(W - R, p.y));
    const place = { x, y };
    cuePlaceRef.current = place;
    setCuePlace(place);
    sendAim();
  };
  const onTableDown = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (!myTurnRef.current || !viewRef.current) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const p = worldAt(e);
    const s = stRef.current;
    const cue = cuePlaceRef.current ?? s.balls[0];
    touchAim.current = null;
    // fingers get a bigger handle on the cue ball
    const grab = e.pointerType === "mouse" ? 2.6 : 3.6;
    if (s.inHand && Math.hypot(p.x - cue.x, p.y - cue.y) < R * grab) {
      drag.current = "place";
      return;
    }
    drag.current = "aim";
    if (e.pointerType === "mouse") aimToward(p);
    else touchAim.current = { x0: e.clientX, y0: e.clientY, t0: performance.now(), last: p, moved: false };
  };
  const onTableMove = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (!drag.current || !myTurnRef.current) return;
    const p = worldAt(e);
    if (drag.current === "place") placeAt(p);
    else if (touchAim.current) {
      const t = touchAim.current;
      if (!t.moved && Math.hypot(e.clientX - t.x0, e.clientY - t.y0) < 6) return;
      t.moved = true;
      aimTurn(t.last, p);
      t.last = p;
    } else aimToward(p);
  };
  const onTableUp = (e?: RPointerEvent<HTMLCanvasElement>) => {
    const t = touchAim.current;
    // a tap (no drag): point the cue there
    if (e && e.type === "pointerup" && t && !t.moved && performance.now() - t.t0 < 400 && myTurnRef.current) aimToward(worldAt(e));
    touchAim.current = null;
    drag.current = null;
  };

  // power bar: drag to pull the cue back, let go to shoot
  const powerDrag = useRef<{ y0: number; h: number } | null>(null);
  const onPowerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (!myTurnRef.current) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    // pull down from wherever you touch: the cue comes back with your finger
    const q = localPt(e, e.currentTarget);
    powerDrag.current = { y0: q.y, h: q.h };
  };
  const onPowerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = powerDrag.current;
    if (!d) return;
    const p = Math.max(0, Math.min(1, (localPt(e, e.currentTarget).y - d.y0) / (d.h * 0.85)));
    powerRef.current = p;
    setPower(p);
    syncAim();
    sendAim();
  };
  const onPowerUp = () => {
    if (!powerDrag.current) return;
    powerDrag.current = null;
    if (powerRef.current >= 0.02) shoot();
    else {
      powerRef.current = 0;
      setPower(0);
      syncAim();
    }
  };

  // fine aim wheel (finer still under a finger)
  const fine = useRef<{ y: number; k: number } | null>(null);
  const [wheel, setWheel] = useState(0);
  const onFineDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (!myTurnRef.current) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    fine.current = { y: localPt(e, e.currentTarget).y, k: e.pointerType === "mouse" ? 0.0012 : 0.0006 };
  };
  const onFineMove = (e: RPointerEvent<HTMLDivElement>) => {
    const f = fine.current;
    if (!f) return;
    const at = localPt(e, e.currentTarget).y;
    const dy = at - f.y;
    f.y = at;
    aimRef.current += dy * f.k;
    setWheel((w) => w + dy);
    syncAim();
    sendAim();
  };

  // keyboard: ←/→ aim (Shift: finer), ↑/↓ power, Space shoots
  useEffect(() => {
    if (screen !== "game") return;
    const onKey = (e: KeyboardEvent) => {
      if (!myTurnRef.current) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const step = e.shiftKey ? 0.0009 : 0.009;
      if (e.key === "ArrowLeft") aimRef.current -= step;
      else if (e.key === "ArrowRight") aimRef.current += step;
      else if (e.key === "ArrowUp") powerRef.current = Math.min(1, powerRef.current + 0.05);
      else if (e.key === "ArrowDown") powerRef.current = Math.max(0, powerRef.current - 0.05);
      else if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        shoot();
        return;
      } else return;
      e.preventDefault();
      setPower(powerRef.current);
      syncAim();
      sendAim();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, syncAim, sendAim]);

  /* ================= render ================= */
  const xp = shop.xpOf("pool");
  const lv = levelForXp(xp);
  const shownLevel = poolLevel(xp);
  const preview = useMemo(() => newRack(() => 0.37), []);

  // phones, in a game: the game fills the game window (out of its scaling box), landscape
  const phoneGame = phone && screen === "game";
  useLayoutEffect(() => {
    if (!phoneGame) return setHost(null);
    setHost((anchorRef.current?.closest(".gp-stage") as HTMLElement | null) ?? null);
  }, [phoneGame]);
  useEffect(() => {
    if (!host) return;
    const measure = () => setHostBox({ w: host.clientWidth, h: host.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    return () => ro.disconnect();
  }, [host]);
  // where the browser allows it (Android, full screen), hold the screen in landscape
  useEffect(() => {
    if (!phoneGame) return;
    const o = window.screen.orientation as (ScreenOrientation & { lock?: (o: string) => Promise<void> }) | undefined;
    o?.lock?.("landscape").catch(() => {});
    return () => {
      try {
        o?.unlock?.();
      } catch {
        /* not locked */
      }
    };
  }, [phoneGame]);
  const layered = phoneGame && host !== null && hostBox.w > 0;
  const rot = layered && hostBox.h > hostBox.w;
  ROTATED = rot;
  useEffect(() => () => void (ROTATED = false), []);

  const settingsCard = (withLevel: boolean) => (
    <div className="ol-card pl-settings">
      {withLevel ? (
        <p className="ol-sub pl-cpu-note">
          The CPU plays at your level: <b>Lv {myPoolLevel}</b>
          {myPoolLevel >= CPU_MAX_LEVEL ? " (full strength)" : ". Win games to level up and it gets sharper."}
        </p>
      ) : null}
      <p className="ol-sub">Shot clock</p>
      <div className="ol-seg" role="radiogroup" aria-label="Shot clock">
        {CLOCKS.map((n) => (
          <button key={n} type="button" className={prefs.clock === n ? "active" : ""} onClick={() => setPrefs({ clock: n })}>
            {n ? `${n}s` : "Off"}
          </button>
        ))}
      </div>
      <label className="pl-check">
        <input type="checkbox" checked={prefs.guide} onChange={(e) => setPrefs({ guide: e.target.checked })} /> Aiming guide
      </label>
      {withLevel ? <CpuBetToggle bet={cpuBet} /> : null}
      <CueCard cue={myCue} onShop={gameShop ? gameShop.open : undefined} />
    </div>
  );
  const endlessCard = (
    <div className="ol-card pl-settings">
      <p className="ol-sub pl-cpu-note">
        Solo, offline, against the clock. You start with {ENDLESS.startMs / 1000}s: every ball you pot adds {ENDLESS.ballMs / 1000}s, and every {ENDLESS.comboEvery} potting shots in a row add {ENDLESS.comboMs / 1000}s more (the combo also multiplies your points, up to ×{ENDLESS.maxCombo});
        a scratch costs {ENDLESS.scratchMs / 1000}s. Clear the table for a new rack and a bonus.
      </p>
      {readBest() > 0 ? (
        <p className="ol-sub">
          Your best: <b>{readBest()}</b>
        </p>
      ) : null}
      <label className="pl-check">
        <input type="checkbox" checked={prefs.guide} onChange={(e) => setPrefs({ guide: e.target.checked })} /> Aiming guide
      </label>
      <CueCard cue={myCue} onShop={gameShop ? gameShop.open : undefined} />
    </div>
  );

  if (screen === "room" && roomRef.current) {
    const room = roomRef.current;
    return (
      <div className="pool-surface">
        <RoomWaiting
          status={roomStatus}
          note={roomNote}
          code={room.code}
          peers={peers}
          myId={room.clientId}
          isHost={room.isHost}
          matched={matched}
          seats={2}
          title="Eight Ball · 1 v 1"
          blurb="The breaker is picked at random."
          canStart={peers.length >= 2}
          startLabel={peers.length < 2 ? "Waiting for a player…" : "Start game"}
          onStart={hostStartOnline}
          onLeave={leaveOnline}
          bet={<RoomBet room={room} peers={peers} isHost={room.isHost} matched={matched} />}
        />
      </div>
    );
  }

  if (screen === "menu") {
    return (
      <div className="pool-surface">
        <PlayFlow
          id="pool"
          preview={
            <div className="pf-preview pl-preview" inert>
              <TableCanvas table={tableTheme} balls={preview.balls} />
            </div>
          }
          corner={
            user ? (
              <div className="pl-xp" title={`${xp} XP`}>
                <span>Pool level {shownLevel}</span>
                <i style={{ width: `${((xp - xpForLevel(shownLevel)) / (xpForLevel(shownLevel + 1) - xpForLevel(shownLevel))) * 100}%` }} />
              </div>
            ) : null
          }
          modes={[
            { key: "cpu", label: "vs CPU", icon: <Bot size={15} />, start: () => startLocal("cpu"), settings: settingsCard(true) },
            { key: "pass", label: "Same device", icon: <Users size={15} />, start: () => startLocal("pass"), settings: settingsCard(false) },
            { key: "endless", label: "Endless", icon: <Timer size={15} />, start: () => startLocal("endless"), settings: endlessCard },
            {
              key: "online",
              label: "Online",
              icon: <Globe size={15} />,
              panel: !GameRoom.configured ? (
                <div className="ol-card">
                  <p className="ol-sub">Online play isn't available right now.</p>
                </div>
              ) : !user ? (
                <SignInToPlay what="play pool online" />
              ) : (
                <OnlineMenu lobby={lobby} guestWait={guestWait} inviteLabel="a game of pool" findLabel="Find a 1-v-1 match" onCreate={() => openRoom()} onJoin={(code) => joinRoom(code)} />
              ),
            },
          ]}
        />
      </div>
    );
  }

  /* ----- the table ----- */
  const endless = mode === "endless";
  const iWon = st.over && st.winner !== null && st.winner === mySeat;
  const resultOutcome: Outcome = endless ? (run.newBest ? "win" : "draw") : mode === "pass" || mySeat < 0 || iWon ? "win" : "lose";
  const winnerName = st.winner !== null ? seats[st.winner]?.name ?? `Player ${st.winner + 1}` : "";
  const shooterName = turnSeat?.name ?? "";
  const myG = st.groups[st.turn];
  let status = "";
  if (st.over) status = "";
  else if (animating) status = "";
  else if (oppGone) status = "Your opponent left";
  else if (endless) status = st.isBreak ? "Break · cue ball behind the line" : st.inHand ? "Ball in hand: drag the cue ball" : "";
  else if (myTurn) {
    const who = mode === "pass" ? `${shooterName} · ` : "";
    status = st.isBreak
      ? `${who}Break · cue ball behind the line`
      : st.inHand
        ? `${who}Ball in hand: drag the cue ball`
        : `${who}${groupName(myG)}${myG && ballsLeft(st, st.turn).length === 0 ? " · now the 8" : ""}`;
  } else status = turnSeat?.kind === "cpu" && cpuThinking ? `${shooterName} is lining up…` : `${shooterName} to shoot`;

  const clockFor = (i: number) => (clockOn && st.turn === i && !st.over && !animating && !oppGone ? <ShotClock deadline={deadline} total={turnMs} /> : null);
  const menuBtn = (
    <button type="button" className="pl-tool pl-tool-sm" onClick={online ? leaveOnline : leaveLocal} aria-label={online ? "Leave game" : "Menu"} title={online ? "Leave game" : "Menu"}>
      {online ? <LogOut size={16} /> : <MenuIcon size={16} />}
    </button>
  );
  const shopBtn = gameShop ? (
    <button type="button" className="pl-tool pl-tool-sm" onClick={gameShop.open} aria-label="Pool shop: tables and cues" title="Pool shop">
      <ShoppingBag size={16} />
    </button>
  ) : null;
  const fineEl = (
    <div
      className="pl-fine"
      onPointerDown={onFineDown}
      onPointerMove={onFineMove}
      onPointerUp={() => (fine.current = null)}
      onPointerCancel={() => (fine.current = null)}
      aria-label="Fine aim: drag to turn"
      style={{ backgroundPositionY: `${wheel}px` }}
    />
  );

  const game = (
    <div className={`pool-surface pool-game${layered ? " is-phone" : ""}${rot ? " is-rot" : ""}`}>
      {/* players (Endless: score, the clock, the rack) */}
      {endless ? (
        <div className="pl-hud pl-hud-endless">
          {menuBtn}
          <div className="pl-ebox">
            <small>Score</small>
            <b>{run.score}</b>
            <small className="pl-ebest">Best {Math.max(run.best, run.score)}</small>
          </div>
          <EndlessClock run={run} over={st.over} />
          <div className="pl-ebox pl-ebox-r">
            <small>Rack {run.rack}</small>
            <b className={run.combo > 1 ? "pl-combo is-on" : "pl-combo"}>×{Math.max(1, run.combo)}</b>
            <small className="pl-ebest">
              {run.balls} ball{run.balls === 1 ? "" : "s"}
            </small>
          </div>
          {shopBtn}
        </div>
      ) : (
        <div className="pl-hud">
          {menuBtn}
          {[0, 1].map((i) => {
            const seat = seats[i];
            const g = st.groups[i];
            const left = ballsLeft(st, i as 0 | 1);
            const ids = g === "solid" ? [1, 2, 3, 4, 5, 6, 7] : g === "stripe" ? [9, 10, 11, 12, 13, 14, 15] : [];
            return (
              <div key={i} className={`pl-player${st.turn === i && !st.over ? " is-turn" : ""}${i === 1 ? " is-right" : ""}`}>
                <span className="pl-av-wrap">
                  {seat?.userId ? <PlayerAvatar id={seat.userId} name={seat.name} avatar={seat.avatar ?? null} size={26} className="lb-initial pl-av" /> : <span className="pl-av pl-av-blank">{seat?.kind === "cpu" ? <Bot size={14} /> : i + 1}</span>}
                  {clockFor(i)}
                </span>
                <span className="pl-pinfo">
                  <b>{i === mySeat && mode !== "pass" ? "You" : seat?.name ?? `Player ${i + 1}`}</b>
                  <span className="pl-balls">
                    {ids.length ? ids.map((id) => <MiniBall key={id} id={id} gone={!left.includes(id)} />) : <small>{groupName(null)}</small>}
                    {g && left.length === 0 ? <MiniBall id={8} /> : null}
                  </span>
                </span>
              </div>
            );
          })}
          {shopBtn}
        </div>
      )}

      <div className="pl-stage">
        {/* phones: the fine wheel goes under the left thumb */}
        {layered ? <div className={`pl-rail pl-rail-left${myTurn ? "" : " is-off"}`}>{fineEl}</div> : null}
        <TableCanvas table={tableTheme} onView={onView} fill={layered} live={myTurn} onDown={onTableDown} onMove={onTableMove} onUp={onTableUp}>
          {status ? (
            <p className="pl-status" aria-live="polite">
              {status}
            </p>
          ) : null}
          {toast ? (
            <p className="pl-toast" role="status">
              {toast}
            </p>
          ) : null}
          {st.over ? (
            <div className={`rb rb-${resultOutcome} pl-result`} role="dialog" aria-modal="false" aria-live="assertive">
              <div className="rb-card">
                <OutcomeIcon outcome={resultOutcome} />
                <h3 className="rb-title">
                  {endless ? (run.newBest ? `New best: ${run.score}!` : `Time's up · ${run.score}`) : mode === "pass" || mySeat < 0 ? `${winnerName} wins!` : iWon ? "You won!" : "You lost"}
                </h3>
                <p className="rb-detail">{endless ? `${st.note ?? ""} · best ${run.best}` : st.note ?? ""}</p>
                {mode === "online" ? <MatchRewardLine reward={matchReport.reward} /> : xpGain ? <p className="pl-xp-gain">+{xpGain} XP</p> : null}
                {mode === "cpu" ? <CpuBetLine bet={cpuBet} /> : null}
                <div className="rb-actions pl-result-actions">
                  {online ? (
                    <>
                      {roomRef.current?.isHost && !oppGone ? (
                        <button type="button" className="rb-btn rb-btn-main" onClick={hostStartOnline}>
                          Rack again
                        </button>
                      ) : !oppGone ? (
                        <p className="pl-result-wait">Waiting for the host…</p>
                      ) : null}
                      <button type="button" className="rb-btn rb-btn-ghost" onClick={leaveOnline}>
                        Leave
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="rb-btn rb-btn-main" onClick={() => startLocal(mode)}>
                        {endless ? "Play again" : "Rack again"}
                      </button>
                      <button type="button" className="rb-btn rb-btn-ghost" onClick={() => setScreen("menu")}>
                        Menu
                      </button>
                      {gameShop ? (
                        <button type="button" className="rb-btn rb-btn-ghost" onClick={gameShop.open}>
                          Shop
                        </button>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </TableCanvas>

        {/* the cue rail: spin, power (pull down, let go), fine aim */}
        <div className={`pl-rail${myTurn ? "" : " is-off"}`} title="Drag the table to aim · ←/→ fine · ↑/↓ power · Space shoots">
          <SpinPicker spin={spin} onChange={setSpin} disabled={!myTurn} reach={stats.spin} />
          <div
            className={`pl-power${power > 0 ? " is-pulling" : ""}`}
            onPointerDown={onPowerDown}
            onPointerMove={onPowerMove}
            onPointerUp={onPowerUp}
            onPointerCancel={onPowerUp}
            role="slider"
            aria-orientation="vertical"
            aria-label="Power: pull down, let go to shoot"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(power * 100)}
          >
            <span className="pl-power-fill" style={{ height: `${power * 100}%` }} />
            <span className="pl-power-cue" style={{ transform: `translateY(${power * 70}%)` }} />
            <span className="pl-power-label">{power > 0 ? Math.round(power * 100) : "Pull"}</span>
          </div>
          {layered ? null : fineEl}
        </div>
      </div>
    </div>
  );

  if (!layered) {
    return (
      <>
        <div ref={anchorRef} hidden />
        {game}
      </>
    );
  }
  // phones: a layer over the whole game window, landscape (turned a quarter when held upright)
  const layerStyle: CSSProperties = rot
    ? { width: hostBox.h, height: hostBox.w, transform: "rotate(90deg) translateY(-100%)" }
    : { width: hostBox.w, height: hostBox.h };
  return (
    <>
      <div ref={anchorRef} hidden />
      {createPortal(
        <div className={`pl-layer${rot ? " is-rot" : ""}`} style={layerStyle}>
          {game}
        </div>,
        host!,
      )}
    </>
  );
}

/** Endless: the time left, big, with a bar (red in the last ten seconds). */
function EndlessClock({ run, over }: { run: Run; over: boolean }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (over) return;
    const id = window.setInterval(() => tick((t) => t + 1), 200);
    return () => window.clearInterval(id);
  }, [over]);
  const left = over ? 0 : Math.max(0, run.endAt - (run.pausedAt ?? Date.now()));
  const pct = Math.min(1, left / ENDLESS.startMs);
  return (
    <div className={`pl-eclock${left < 10_000 ? " is-low" : ""}`} role="timer" aria-label={`${Math.ceil(left / 1000)} seconds left`}>
      <Timer size={15} aria-hidden="true" />
      <b>{fmtClock(left)}</b>
      <i style={{ width: `${pct * 100}%` }} />
    </div>
  );
}

/** Your cue and its stats (start screen settings), with a way to the shop. */
function CueCard({ cue, onShop }: { cue: PoolCue; onShop?: () => void }) {
  return (
    <div className="pl-cuecard">
      <span className="pl-cuecard-name">
        <b>{cue.name}</b>
        <small>Your cue</small>
      </span>
      <span className="pl-cuecard-stats">
        {(["aim", "power", "spin"] as const).map((k) => (
          <span key={k}>
            <small>{k === "aim" ? "Aim" : k === "power" ? "Power" : "Spin"}</small>
            <i>
              {[1, 2, 3, 4, 5].map((n) => (
                <b key={n} className={n <= cue[k] ? "on" : ""} />
              ))}
            </i>
          </span>
        ))}
      </span>
      {onShop ? (
        <button type="button" className="pl-pill" onClick={onShop}>
          <ShoppingBag size={14} /> Cues &amp; tables
        </button>
      ) : null}
    </div>
  );
}

/** The table canvas, always landscape (sized to its box; slim rails on small screens). */
function TableCanvas({
  table,
  balls,
  onView,
  fill = false,
  live = false,
  onDown,
  onMove,
  onUp,
  children,
}: {
  table: PoolTableTheme;
  /** fixed balls (the start screen); the game sets them through the view */
  balls?: PoolState["balls"];
  onView?: (v: PoolView | null) => void;
  /** phones: fit the box it's in (width and height), not the window */
  fill?: boolean;
  live?: boolean;
  onDown?: (e: RPointerEvent<HTMLCanvasElement>) => void;
  onMove?: (e: RPointerEvent<HTMLCanvasElement>) => void;
  onUp?: (e?: RPointerEvent<HTMLCanvasElement>) => void;
  children?: ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<PoolView | null>(null);
  const cb = useRef({ onView, fill });
  cb.current = { onView, fill };
  useEffect(() => {
    const cv = cvRef.current!;
    const wrap = wrapRef.current!;
    const view = new PoolView(cv);
    viewRef.current = view;
    view.setTable(table);
    const fit = () => {
      const w = wrap.clientWidth;
      if (!w) return;
      const small = w < 760;
      // phones: the box the layout gives it; elsewhere what's left of the window under the
      // player bar (the page scales the game to fit too)
      const maxH = cb.current.fill ? wrap.clientHeight : Math.max(280, window.innerHeight - 150);
      if (!maxH) return;
      const s = PoolView.fit(w, maxH, false, small);
      view.resize(s.w, s.h, false, small);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    cb.current.onView?.(view);
    return () => {
      ro.disconnect();
      view.destroy();
      viewRef.current = null;
      cb.current.onView?.(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => viewRef.current?.setTable(table), [table]);
  useEffect(() => {
    if (balls) viewRef.current?.setBalls(balls);
  }, [balls]);
  return (
    <div ref={wrapRef} className={`pl-canvas-wrap${fill ? " is-fill" : ""}`}>
      <canvas
        ref={cvRef}
        className={`pl-canvas${live ? " is-live" : ""}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        aria-label={onDown ? "Pool table: drag to aim" : undefined}
        aria-hidden={onDown ? undefined : true}
      />
      {children}
    </div>
  );
}
