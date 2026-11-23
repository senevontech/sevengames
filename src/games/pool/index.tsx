/* Eight-ball pool: vs CPU (three levels), two players on one device, and online 1-v-1.

   Every shot is simulated in full the moment it is played (engine.ts), then animated.
   Online: the shooter broadcasts the shot (direction, power, spin, cue-ball spot), every
   device simulates the same shot, and the host — who also runs the shot clock — sends the
   resulting table as the authoritative state. While someone aims, their cue is streamed
   to the other player so you watch them line up. */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { Bot, Globe, LogOut, Menu as MenuIcon, ShoppingBag, Users } from "lucide-react";
import type { GameProps } from "../index";
import { FOOT_SPOT, HEAD_X, L, MAX_POWER, R, W, ballsLeft, legalTargets, newRack, placeOk, playShot, timeoutFoul, validState, type Group, type PoolState, type Shot, type SimEvent, type Vec } from "./engine";
import { PoolView, ballCss } from "./render";
import { cpuPlan, type CpuLevel } from "./cpu";
import { clickSound, cueSound, pocketSound, railSound, winChime } from "./audio";
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
import PlayFlow from "../PlayFlow";
import "./pool.css";

type Mode = "cpu" | "pass" | "online";
/** `cue`: the cue they play with (its look; online it is shown to the other player). */
type Seat = { kind: "human" | "cpu"; name: string; clientId?: string; userId?: string; avatar?: AvatarChoice | null; cue?: string | null };
/** the CPU's cue (looks only: the CPU does not use cue stats) */
const CPU_CUE: Record<CpuLevel, string> = { easy: "pcue:house", medium: "pcue:carbon", hard: "pcue:legend" };

const TURN_MS = 40_000;
const XP = { easy: 40, medium: 60, hard: 90, loss: 15 };
const LEVELS: Array<{ key: CpuLevel; label: string }> = [
  { key: "easy", label: "Easy" },
  { key: "medium", label: "Medium" },
  { key: "hard", label: "Pro" },
];
const groupName = (g: Group | null) => (g === "solid" ? "Solids" : g === "stripe" ? "Stripes" : "Open table");

/* ---------------- settings (remembered on this device) ---------------- */
const PREF = "senevon:pool:prefs";
type Prefs = { guide: boolean; level: CpuLevel };
function readPrefs(): Prefs {
  const d: Prefs = { guide: true, level: "medium" };
  try {
    const p = JSON.parse(localStorage.getItem(PREF) || "{}");
    return { guide: p.guide !== false, level: ["easy", "medium", "hard"].includes(p.level) ? p.level : d.level };
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

function ShotClock({ deadline }: { deadline: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((t) => t + 1), 250);
    return () => window.clearInterval(id);
  }, [deadline]);
  const left = Math.max(0, deadline - Date.now());
  const pct = left / TURN_MS;
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
    const r = ref.current!.getBoundingClientRect();
    let x = (((e.clientX - r.left) / r.width) * 2 - 1) / 0.8;
    let y = (((e.clientY - r.top) / r.height) * 2 - 1) / 0.8;
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

  // canvas
  const viewRef = useRef<PoolView | null>(null);
  const [portrait, setPortrait] = useState(false);

  // online
  const roomRef = useRef<GameRoom | null>(null);
  const [roomStatus, setRoomStatus] = useState<RoomStatus | null>(null);
  const [roomNote, setRoomNote] = useState<string | null>(null);
  const [peers, setPeers] = useState<RoomPeer[]>([]);
  const [matched, setMatched] = useState(false);
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
  const isHost = !online || roomRef.current!.isHost;
  const mySeat = online ? seats.findIndex((x) => x.clientId === roomRef.current!.clientId) : mode === "cpu" ? 0 : -1;
  const turnSeat = seats[st.turn];
  const myTurn = screen === "game" && !animating && !st.over && !oppGone && (mode === "pass" ? true : st.turn === mySeat);

  /* ---------------- the canvas view ---------------- */
  const onView = useCallback((view: PoolView | null) => {
    viewRef.current = view;
    if (!view) return;
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
      legal: legalTargets(s),
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
    const targets = legalTargets(s).map((id) => s.balls[id]);
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

  const settle = useCallback(
    (next: PoolState) => {
      animRef.current = false;
      setAnimating(false);
      const s = remoteState.current && remoteState.current.shots >= next.shots ? remoteState.current : next;
      remoteState.current = null;
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
      setDeadline(Date.now() + TURN_MS);
    },
    [aimAtSomething],
  );

  const onSimEvent = useCallback((e: SimEvent) => {
    if (e.k === "cue") cueSound(e.v);
    else if (e.k === "ball") clickSound(e.v);
    else if (e.k === "rail") railSound(e.v);
    else if (e.k === "pot") pocketSound(e.v);
  }, []);

  /** Animate a shot from `from`; the host (or a local game) also decides the next state. */
  const runShot = useCallback(
    (from: PoolState, shot: Shot, cue: Vec | null) => {
      const view = viewRef.current;
      const { next, sim } = playShot(from, shot, cue, true);
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
      const plan = await cpuPlan(s, prefs.level);
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
  }, [screen, mode, animating, st, seats, prefs.level, runShot, syncAim]);

  /* ---------------- XP at the end ---------------- */
  useEffect(() => {
    if (!st.over || awarded.current || mode === "pass" || !user) return;
    awarded.current = true;
    if (mode === "online") {
      const w = st.winner !== null ? seatsRef.current[st.winner] : null;
      if (matchIdRef.current) void matchReport.report(matchIdRef.current, playersRef.current, [w?.userId ?? null]);
      return;
    }
    const won = st.winner === 0;
    const amount = won ? XP[prefs.level] : XP.loss;
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
      m === "cpu"
        ? [
            { kind: "human", name: myName, userId: user?.id, avatar: myAvatar, cue: myCueId },
            { kind: "cpu", name: `CPU · ${LEVELS.find((l) => l.key === prefs.level)!.label}`, cue: CPU_CUE[prefs.level] },
          ]
        : [
            { kind: "human", name: "Player 1" },
            { kind: "human", name: "Player 2" },
          ];
    setSeats(list);
    seatsRef.current = list;
    begin(newRack(Math.random, m === "cpu" ? (Math.random() < 0.5 ? 0 : 1) : 0));
  }

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
    setDeadline(Date.now() + TURN_MS);
    setScreen("game");
  }

  /* ---------------- online ---------------- */
  // `look` carries your cue to the other player (they see it when you aim)
  const me = () => ({ userId: user?.id ?? "", name: myName, avatar: myAvatar, look: myCueId });

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
    const s = newRack(Math.random, Math.random() < 0.5 ? 0 : 1);
    begin(s);
    room.send("state", { st: s, seats: list, mid: matchIdRef.current, timeLeft: TURN_MS });
  }

  // host: the shot clock
  useEffect(() => {
    if (!online || !isHost || screen !== "game" || st.over || animating || oppGone) return;
    const id = window.setTimeout(
      () => {
        const cur = stRef.current;
        if (cur !== st || animRef.current) return;
        const next = timeoutFoul(cur);
        roomRef.current?.send("state", { st: next, seats: seatsRef.current, mid: matchIdRef.current, timeLeft: TURN_MS });
        settle(next);
      },
      Math.max(0, deadline - Date.now()),
    );
    return () => window.clearTimeout(id);
  }, [online, isHost, screen, st, animating, deadline, oppGone, settle]);

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

  /* ---------------- input ---------------- */
  const drag = useRef<null | "aim" | "place">(null);
  const worldAt = (e: { clientX: number; clientY: number }) => {
    const cv = viewRef.current!.canvas;
    const r = cv.getBoundingClientRect();
    // the game page may scale the whole game (CSS transform): back to the canvas's own pixels
    const k = cv.offsetWidth / (r.width || 1);
    return viewRef.current!.toWorld((e.clientX - r.left) * k, (e.clientY - r.top) * k);
  };
  const aimToward = (p: Vec) => {
    const s = stRef.current;
    const cue = s.inHand && cuePlaceRef.current ? cuePlaceRef.current : s.balls[0];
    if (Math.hypot(p.x - cue.x, p.y - cue.y) < R * 0.8) return;
    aimRef.current = Math.atan2(p.y - cue.y, p.x - cue.x);
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
    if (s.inHand && Math.hypot(p.x - cue.x, p.y - cue.y) < R * 2.6) {
      drag.current = "place";
      return;
    }
    drag.current = "aim";
    aimToward(p);
  };
  const onTableMove = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (!drag.current || !myTurnRef.current) return;
    const p = worldAt(e);
    if (drag.current === "place") placeAt(p);
    else aimToward(p);
  };
  const onTableUp = () => {
    drag.current = null;
  };

  // power bar: drag to pull the cue back, let go to shoot
  const powerDrag = useRef<{ y0: number; h: number } | null>(null);
  const onPowerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (!myTurnRef.current) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const r = e.currentTarget.getBoundingClientRect();
    // pull down from wherever you touch: the cue comes back with your finger
    powerDrag.current = { y0: e.clientY, h: r.height };
  };
  const onPowerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = powerDrag.current;
    if (!d) return;
    const p = Math.max(0, Math.min(1, (e.clientY - d.y0) / (d.h * 0.85)));
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

  // fine aim wheel
  const fine = useRef<{ y: number } | null>(null);
  const [wheel, setWheel] = useState(0);
  const onFineDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (!myTurnRef.current) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    fine.current = { y: e.clientY };
  };
  const onFineMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (!fine.current) return;
    const dy = e.clientY - fine.current.y;
    fine.current.y = e.clientY;
    aimRef.current += dy * 0.0012;
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
  const preview = useMemo(() => newRack(() => 0.37), []);

  const settingsCard = (withLevel: boolean) => (
    <div className="ol-card pl-settings">
      {withLevel ? (
        <>
          <p className="ol-sub">CPU level</p>
          <div className="ol-seg" role="radiogroup" aria-label="CPU level">
            {LEVELS.map((l) => (
              <button key={l.key} type="button" className={prefs.level === l.key ? "active" : ""} onClick={() => setPrefs({ level: l.key })}>
                {l.label}
              </button>
            ))}
          </div>
        </>
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
                <span>Pool level {lv}</span>
                <i style={{ width: `${lv >= 30 ? 100 : ((xp - xpForLevel(lv)) / (xpForLevel(lv + 1) - xpForLevel(lv))) * 100}%` }} />
              </div>
            ) : null
          }
          modes={[
            { key: "cpu", label: "vs CPU", icon: <Bot size={15} />, start: () => startLocal("cpu"), settings: settingsCard(true) },
            { key: "pass", label: "Same device", icon: <Users size={15} />, start: () => startLocal("pass"), settings: settingsCard(false) },
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
  const iWon = st.over && st.winner !== null && st.winner === mySeat;
  const resultOutcome: Outcome = mode === "pass" || mySeat < 0 || iWon ? "win" : "lose";
  const winnerName = st.winner !== null ? seats[st.winner]?.name ?? `Player ${st.winner + 1}` : "";
  const shooterName = turnSeat?.name ?? "";
  const myG = st.groups[st.turn];
  let status = "";
  if (st.over) status = "";
  else if (animating) status = "";
  else if (oppGone) status = "Your opponent left";
  else if (myTurn) {
    const who = mode === "pass" ? `${shooterName} · ` : "";
    status = st.isBreak
      ? `${who}Your break: place the cue ball behind the line`
      : st.inHand
        ? `${who}Ball in hand: drag the cue ball`
        : `${who}${groupName(myG)}${myG && ballsLeft(st, st.turn).length === 0 ? " · now the 8" : ""}`;
  } else status = turnSeat?.kind === "cpu" && cpuThinking ? `${shooterName} is lining up…` : `${shooterName} to shoot`;

  const clockFor = (i: number) => (online && st.turn === i && !st.over && !animating ? <ShotClock deadline={deadline} /> : null);
  return (
    <div className={`pool-surface pool-game${portrait ? " is-portrait" : ""}`}>
      {/* players */}
      <div className="pl-hud">
        <button type="button" className="pl-tool pl-tool-sm" onClick={online ? leaveOnline : () => setScreen("menu")} aria-label={online ? "Leave game" : "Menu"} title={online ? "Leave game" : "Menu"}>
          {online ? <LogOut size={16} /> : <MenuIcon size={16} />}
        </button>
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
        {gameShop ? (
          <button type="button" className="pl-tool pl-tool-sm" onClick={gameShop.open} aria-label="Pool shop: tables and cues" title="Pool shop">
            <ShoppingBag size={16} />
          </button>
        ) : null}
      </div>

      <div className="pl-stage">
        <TableCanvas table={tableTheme} onView={onView} onPortrait={setPortrait} live={myTurn} onDown={onTableDown} onMove={onTableMove} onUp={onTableUp}>
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
                <h3 className="rb-title">{mode === "pass" || mySeat < 0 ? `${winnerName} wins!` : iWon ? "You won!" : "You lost"}</h3>
                <p className="rb-detail">{st.note ?? ""}</p>
                {mode === "online" ? <MatchRewardLine reward={matchReport.reward} /> : xpGain ? <p className="pl-xp-gain">+{xpGain} XP</p> : null}
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
                        Rack again
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
          <div className="pl-fine" onPointerDown={onFineDown} onPointerMove={onFineMove} onPointerUp={() => (fine.current = null)} onPointerCancel={() => (fine.current = null)} aria-label="Fine aim: drag up or down" style={{ backgroundPositionY: `${wheel}px` }} />
        </div>
      </div>
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

/** The table canvas (sized to its box; upright on narrow screens). */
function TableCanvas({
  table,
  balls,
  onView,
  onPortrait,
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
  onPortrait?: (p: boolean) => void;
  live?: boolean;
  onDown?: (e: RPointerEvent<HTMLCanvasElement>) => void;
  onMove?: (e: RPointerEvent<HTMLCanvasElement>) => void;
  onUp?: () => void;
  children?: ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<PoolView | null>(null);
  const cb = useRef({ onView, onPortrait });
  cb.current = { onView, onPortrait };
  useEffect(() => {
    const cv = cvRef.current!;
    const wrap = wrapRef.current!;
    const view = new PoolView(cv);
    viewRef.current = view;
    view.setTable(table);
    const fit = () => {
      const w = wrap.clientWidth;
      if (!w) return;
      const tall = w < 560;
      // the game window: what's left under the player bar (the page scales the game to fit too)
      const maxH = Math.max(280, window.innerHeight - (tall ? 118 : 150));
      const s = PoolView.fit(w, maxH, tall, tall);
      view.resize(s.w, s.h, tall, tall);
      cb.current.onPortrait?.(tall);
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
    <div ref={wrapRef} className="pl-canvas-wrap">
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
