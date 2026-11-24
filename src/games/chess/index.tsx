/* Chess: vs CPU (Easy / Medium / Hard, saved between visits), pass-and-play on one device, and
   online (room code, invites, random match) with a clock, draw offers, resign, rematch and a
   rating (supabase/chess.sql). Rules: engine.ts. CPU: ai.ts in a Web Worker. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameProps } from "../index";
import Board from "./Board";
import { PieceSvg } from "./pieces";
import {
  START_FEN,
  clone,
  fromFen,
  legalMoves,
  make,
  moveFromUci,
  outcome,
  outcomeText,
  positionKey,
  san,
  toFen,
  uci,
  type Color,
  type Move,
  type State,
} from "./engine";

/** The start screen's board (display only). */
const PREVIEW_STATE = fromFen(START_FEN);
import type { Level } from "./ai";
import { useAuthContext } from "../../context/AuthContext";
import { useAvatar } from "../../lib/avatar";
import { useShop } from "../../lib/shop";
import { chessBoardOf, chessPiecesOf, levelForXp, xpForLevel } from "../../lib/shopCatalog";
import { supabase } from "../../supabase";
import { GameRoom, randomId, type RoomMsg, type RoomPeer, type RoomStatus } from "../../lib/gameRoom";
import { useCarromLobby, type LobbyApi, type Matched } from "../carrom/matchmaking";
import { OnlineMenu, RoomWaiting, SignInToPlay } from "../../components/OnlineLobby";
import PlayFlow from "../PlayFlow";
import { Bot, Globe, Users } from "lucide-react";
import PlayerAvatar from "../../components/PlayerAvatar";
import { parseAvatar, type AvatarChoice } from "../../lib/avatar";
import "./chess.css";
import { GameShopButton } from "../gameShop";
import { useMatchChat } from "../../components/chat/MatchChat";
import { MatchRewardLine, useMatchReport } from "../../lib/matchReport";
import { matchFee, useCpuEntry, type EntryKind } from "../../lib/entries";
import { useTokens } from "../../lib/tokens";
import RoomEntry from "../../components/RoomEntry";
import { CpuEntryLine, CpuEntryToggle } from "../../components/CpuEntry";

type Mode = "cpu" | "pass" | "online";
type Result = { winner: Color | null; reason: string };
type Game = {
  s: State;
  played: { m: Move; san: string }[];
  keys: string[];
  result: Result | null;
};

const LEVELS: { id: Level; label: string }[] = [
  { id: "easy", label: "Easy" },
  { id: "medium", label: "Medium" },
  { id: "hard", label: "Hard" },
];
const CLOCKS = [3, 5, 10];
const RANDOM_CLOCK = 5;
const XP = {
  cpu: { easy: { win: 40, draw: 20, loss: 10 }, medium: { win: 80, draw: 35, loss: 15 }, hard: { win: 140, draw: 60, loss: 20 } },
  online: { win: 120, draw: 60, loss: 30 },
};

const newGame = (): Game => {
  const s = fromFen(START_FEN);
  return { s, played: [], keys: [positionKey(s)], result: null };
};

function play(g: Game, m: Move): Game {
  const s = clone(g.s);
  const text = san(s, m);
  make(s, m);
  const keys = [...g.keys, positionKey(s)];
  const o = outcome(s, keys);
  const result: Result | null = o ? { winner: o.kind === "checkmate" ? o.winner : null, reason: outcomeText[o.kind] } : g.result;
  return { s, played: [...g.played, { m, san: text }], keys, result };
}

function replay(ucis: string[]): Game {
  let g = newGame();
  for (const u of ucis) {
    const m = moveFromUci(g.s, u);
    if (!m) break;
    g = play(g, m);
  }
  return g;
}

/* ---------------- sounds ---------------- */
let actx: AudioContext | null = null;
function tone(f: number, d: number, v: number, type: OscillatorType = "triangle") {
  try {
    actx ??= new AudioContext();
    const t = actx.currentTime;
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g).connect(actx.destination);
    o.start(t);
    o.stop(t + d + 0.02);
  } catch {
    /* no audio */
  }
}
const sfx = {
  move: () => tone(420, 0.08, 0.08, "square"),
  capture: () => tone(220, 0.12, 0.12, "square"),
  check: () => tone(880, 0.16, 0.06),
  end: () => [523, 659, 784].forEach((f, i) => window.setTimeout(() => tone(f, 0.25, 0.06), i * 110)),
};

/* ---------------- CPU worker ---------------- */
function useCpu() {
  const worker = useRef<Worker | null>(null);
  const pending = useRef(new Map<number, (m: string | null) => void>());
  const seq = useRef(0);
  useEffect(() => () => worker.current?.terminate(), []);
  return useCallback((fen: string, level: Level) => {
    // started on first use (the game page's preview never needs it)
    if (!worker.current) {
      const w = new Worker(new URL("./ai.worker.ts", import.meta.url), { type: "module" });
      w.onmessage = (e: MessageEvent<{ id: number; move: string | null }>) => {
        pending.current.get(e.data.id)?.(e.data.move);
        pending.current.delete(e.data.id);
      };
      worker.current = w;
    }
    const id = ++seq.current;
    return new Promise<string | null>((resolve) => {
      pending.current.set(id, resolve);
      worker.current?.postMessage({ id, fen, level });
    });
  }, []);
}

/* ---------------- saved CPU game ---------------- */
type SavedCpu = { level: Level; color: Color; moves: string[] };
const saveKey = (uid: string | undefined) => `senevon:chess:cpu:${uid ?? "guest"}`;
function readSaved(uid: string | undefined): SavedCpu | null {
  try {
    const raw = localStorage.getItem(saveKey(uid));
    if (!raw) return null;
    const v = JSON.parse(raw) as SavedCpu;
    return v && Array.isArray(v.moves) && (v.color === 1 || v.color === -1) ? v : null;
  } catch {
    return null;
  }
}
function writeSaved(uid: string | undefined, v: SavedCpu | null) {
  try {
    if (v) localStorage.setItem(saveKey(uid), JSON.stringify(v));
    else localStorage.removeItem(saveKey(uid));
  } catch {
    /* storage unavailable */
  }
}

/* ---------------- small views ---------------- */
const fmtClock = (ms: number) => {
  const t = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

function Clock({ base, running, since }: { base: number; running: boolean; since: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => tick((t) => t + 1), 200);
    return () => window.clearInterval(id);
  }, [running]);
  const left = running ? base - (performance.now() - since) : base;
  return <span className={`ch-clock${running ? " is-on" : ""}${left < 20000 ? " is-low" : ""}`}>{fmtClock(left)}</span>;
}

const START_COUNT: Record<number, number> = { 1: 8, 2: 2, 3: 2, 4: 2, 5: 1 };
const VAL: Record<number, number> = { 1: 1, 2: 3, 3: 3, 4: 5, 5: 9 };
/** Pieces of `color` that the other side has captured, and the material balance. */
function captured(s: State, color: Color) {
  const out: number[] = [];
  let mine = 0;
  let theirs = 0;
  for (let t = 1; t <= 5; t++) {
    let n = 0;
    let m = 0;
    for (let i = 0; i < 64; i++) {
      if (s.b[i] === color * t) n++;
      if (s.b[i] === -color * t) m++;
    }
    for (let k = n; k < START_COUNT[t]; k++) out.push(t);
    mine += n * VAL[t];
    theirs += m * VAL[t];
  }
  return { pieces: out, diff: mine - theirs };
}

function PlayerBar({
  name,
  sub,
  avatar,
  color,
  s,
  clock,
  turn,
}: {
  name: string;
  sub?: string;
  avatar?: { id: string; avatar: AvatarChoice | null } | null;
  color: Color;
  s: State;
  clock?: React.ReactNode;
  turn: boolean;
}) {
  const shop = useShop();
  const set = chessPiecesOf(shop.equippedIn("chess_pieces"));
  // pieces this player has taken = the opponent's missing pieces
  const lost = captured(s, -color as Color);
  const material = captured(s, color).diff;
  return (
    <div className={`ch-player${turn ? " is-turn" : ""}`}>
      {avatar ? (
        <PlayerAvatar id={avatar.id} name={name} avatar={avatar.avatar} size={30} className="lb-initial ch-av" />
      ) : (
        <span className="ch-av ch-av-cpu" aria-hidden="true">
          {color === 1 ? "♙" : "♟"}
        </span>
      )}
      <span className="ch-pname">
        <b>{name}</b>
        {sub ? <small>{sub}</small> : null}
      </span>
      <span className="ch-taken" aria-label={`${lost.pieces.length} pieces captured`}>
        {lost.pieces.map((t, i) => (
          <PieceSvg key={i} type={t} white={color !== 1} set={set} className="ch-taken-p" />
        ))}
        {material > 0 ? <small>+{material}</small> : null}
      </span>
      {clock}
    </div>
  );
}

/* ---------------- online leaderboard ---------------- */
type LeaderRow = { user_id: string; display_name: string; avatar: unknown; rating: number; wins: number; losses: number; draws: number };
function RatingBoard({ me }: { me: string | null }) {
  const [rows, setRows] = useState<LeaderRow[] | null>(null);
  const [mine, setMine] = useState<number | null>(null);
  useEffect(() => {
    if (!supabase) return;
    void supabase
      .from("chess_leaderboard")
      .select("*")
      .order("rating", { ascending: false })
      .limit(10)
      .then(({ data }) => setRows((data as LeaderRow[]) ?? []));
    if (me)
      void supabase
        .from("chess_ratings")
        .select("rating")
        .eq("user_id", me)
        .maybeSingle()
        .then(({ data }) => setMine(data ? (data.rating as number) : 1200));
  }, [me]);
  if (!rows) return null;
  return (
    <div className="ol-card ch-rank">
      <h4>
        Top players {mine !== null ? <small>· your rating {mine}</small> : null}
      </h4>
      {rows.length === 0 ? (
        <p className="ol-sub">No rated games yet — win one online to get on the board.</p>
      ) : (
        <ol>
          {rows.map((r, i) => (
            <li key={r.user_id} className={r.user_id === me ? "is-me" : ""}>
              <span className="ch-rank-n">{i + 1}</span>
              <PlayerAvatar id={r.user_id} name={r.display_name} avatar={parseAvatar(r.avatar)} size={24} className="lb-initial" />
              <span className="ch-rank-name">{r.display_name}</span>
              <small>
                {r.wins}-{r.losses}-{r.draws}
              </small>
              <b>{r.rating}</b>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/* ================= main ================= */

type Online = {
  room: GameRoom;
  matched: boolean;
  matchId: string;
  round: number;
  myColor: Color;
  tc: number; // minutes
  opp: RoomPeer | null;
};

export default function ChessGame(_props: GameProps) {
  const { user } = useAuthContext();
  const { choice: myAvatar } = useAvatar(user);
  const shop = useShop();
  const theme = chessBoardOf(shop.equippedIn("chess_board"));
  const pieceSet = chessPiecesOf(shop.equippedIn("chess_pieces"));
  const meta = user?.user_metadata ?? {};
  const myName = ((meta.full_name as string | undefined) || (meta.name as string | undefined) || user?.email?.split("@")[0] || "You").slice(0, 40);
  const askCpu = useCpu();

  const [screen, setScreen] = useState<"menu" | "game" | "room">("menu");
  const [menuTab, setMenuTab] = useState<Mode>("cpu");
  const [mode, setMode] = useState<Mode>("cpu");
  const [level, setLevel] = useState<Level>("medium");
  const [pickColor, setPickColor] = useState<"w" | "b" | "r">("w");
  const [cpuColor, setCpuColor] = useState<Color>(-1); // the CPU's colour
  const [autoFlip, setAutoFlip] = useState(true);
  const [g, setG] = useState<Game>(newGame);
  const [thinking, setThinking] = useState(false);
  const [saved, setSaved] = useState<SavedCpu | null>(() => readSaved(undefined));
  const [xpGain, setXpGain] = useState<number | null>(null);
  const awarded = useRef(false);

  // online
  const [tc, setTc] = useState(5);
  const [online, setOnline] = useState<Online | null>(null);
  const onlineRef = useRef<Online | null>(null);
  onlineRef.current = online;
  const [roomStatus, setRoomStatus] = useState<RoomStatus | null>(null);
  const [roomNote, setRoomNote] = useState<string | null>(null);
  const [peers, setPeers] = useState<RoomPeer[]>([]);
  const [roomTc, setRoomTc] = useState(5);
  const [clocks, setClocks] = useState<{ w: number; b: number; since: number }>({ w: 0, b: 0, since: 0 });
  const clocksRef = useRef(clocks);
  clocksRef.current = clocks;
  const [drawOffer, setDrawOffer] = useState<"sent" | "received" | null>(null);
  const [rematch, setRematch] = useState<string[]>([]);
  const [guestWait, setGuestWait] = useState<string | null>(null);
  const roomRef = useRef<GameRoom | null>(null);
  const hostMatch = useRef<Matched | null>(null);
  const autoStart = useRef(false);
  const lobbyRef = useRef<LobbyApi | null>(null);
  const gRef = useRef(g);
  gRef.current = g;

  useEffect(() => setSaved(readSaved(user?.id)), [user?.id]);

  /* ----- applying moves ----- */
  const apply = useCallback((m: Move) => {
    setG((cur) => {
      if (cur.result) return cur;
      const next = play(cur, m);
      if (next.result) sfx.end();
      else if (next.played[next.played.length - 1].san.includes("+")) sfx.check();
      else if (m.captured) sfx.capture();
      else sfx.move();
      return next;
    });
  }, []);

  const moves = useMemo(() => (g.result ? [] : legalMoves(g.s)), [g]);
  const last = g.played.length ? g.played[g.played.length - 1].m : null;

  /* ----- CPU turn ----- */
  useEffect(() => {
    if (screen !== "game" || mode !== "cpu" || g.result || g.s.turn !== cpuColor) return;
    let cancelled = false;
    setThinking(true);
    const t0 = performance.now();
    void askCpu(toFen(g.s), level).then((u) => {
      const wait = Math.max(0, 380 - (performance.now() - t0));
      window.setTimeout(() => {
        if (cancelled) return;
        setThinking(false);
        const m = u ? moveFromUci(gRef.current.s, u) : null;
        if (m) apply(m);
      }, wait);
    });
    return () => {
      cancelled = true;
      setThinking(false);
    };
  }, [screen, mode, g, cpuColor, level, askCpu, apply]);

  /* ----- save the CPU game ----- */
  useEffect(() => {
    if (mode !== "cpu" || screen !== "game") return;
    const v = g.result ? null : { level, color: -cpuColor as Color, moves: g.played.map((p) => uci(p.m)) };
    writeSaved(user?.id, v);
    setSaved(v);
  }, [g, mode, screen, level, cpuColor, user?.id]);

  /* ----- XP + rating when a game ends ----- */
  const matchReport = useMatchReport("chess", () => void shop.refresh());
  // vs CPU: 1 earned chip a game, if switched on
  const cpuEntry = useCpuEntry("chess");
  const { wallet } = useTokens();
  const earnedRef = useRef(0);
  earnedRef.current = wallet?.earned ?? 0;
  const myColor: Color = mode === "online" ? online?.myColor ?? 1 : mode === "cpu" ? (-cpuColor as Color) : 1;
  useEffect(() => {
    if (!g.result || awarded.current || mode === "pass") return;
    awarded.current = true;
    const outcomeFor = g.result.winner === null ? "draw" : g.result.winner === myColor ? "win" : "loss";
    const o = onlineRef.current;
    if (mode === "online") {
      // online: the server applies XP (+100 / −40 / +30 draw) and the confirmed-win token
      if (o?.opp) {
        const opp = o.opp.userId;
        void matchReport.report(`${o.matchId}:${o.round}`, [user?.id, opp], g.result.winner === null ? [] : [g.result.winner === myColor ? user?.id : opp], g.result.winner === null);
      }
    } else if (user) {
      if (mode === "cpu") void cpuEntry.finish(outcomeFor === "loss" ? "lose" : outcomeFor);
      const amount = XP.cpu[level][outcomeFor];
      setXpGain(amount);
      void shop.awardXp("chess", amount);
    }
    if (mode === "online" && o?.opp && supabase && !g.result.reason.includes("left")) {
      void supabase.rpc("chess_report", { p_match: o.matchId, p_opponent: o.opp.userId, p_result: outcomeFor });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g.result, mode, myColor, level, user, shop]);

  /* ----- starting games ----- */
  function startCpu(resume?: SavedCpu) {
    const color: Color = resume ? resume.color : pickColor === "r" ? (Math.random() < 0.5 ? 1 : -1) : pickColor === "w" ? 1 : -1;
    if (resume) setLevel(resume.level);
    setCpuColor(-color as Color);
    setMode("cpu");
    // a resumed game keeps the entry it had; a new one pays a new entry (if switched on)
    if (resume) cpuEntry.resume();
    else void cpuEntry.open();
    setG(resume ? replay(resume.moves) : newGame());
    awarded.current = false;
    setXpGain(null);
    setScreen("game");
  }
  function startPass() {
    setMode("pass");
    setG(newGame());
    awarded.current = false;
    setXpGain(null);
    setScreen("game");
  }

  /* ----- online ----- */
  const me = () => ({ userId: user?.id ?? "", name: myName, avatar: myAvatar, chips: earnedRef.current });

  const onRoomMessage = useCallback(
    (msg: RoomMsg) => {
      const room = roomRef.current;
      if (!room) return;
      const o = onlineRef.current;
      switch (msg.t) {
        case "start": {
          const white = String(msg.white);
          const minutes = Math.max(1, Math.min(30, Number(msg.tc) || 5));
          beginOnline(room, white, minutes, String(msg.match), Number(msg.round) || 1, Math.max(0, Math.floor(Number(msg.fee) || 0)), msg.ek === "random" ? "random" : "room");
          break;
        }
        case "move": {
          if (!o) return;
          const cur = gRef.current;
          if (Number(msg.ply) !== cur.played.length || cur.result) return;
          const m = moveFromUci(cur.s, String(msg.uci));
          if (!m) return;
          const left = Number(msg.left) || 0;
          const mover: "w" | "b" = cur.s.turn === 1 ? "w" : "b";
          setClocks((c) => ({ ...c, [mover]: left, since: performance.now() }));
          apply(m);
          setDrawOffer(null);
          break;
        }
        case "resign":
          if (o) endOnline({ winner: o.myColor, reason: "Opponent resigned" });
          break;
        case "flag":
          if (o) {
            const flagged = Number(msg.color) as Color;
            endOnline({ winner: -flagged as Color, reason: flagged === o.myColor ? "You ran out of time" : "Opponent ran out of time" });
          }
          break;
        case "draw-offer":
          setDrawOffer("received");
          break;
        case "draw-reply":
          if (msg.accept === true) endOnline({ winner: null, reason: "Draw agreed" });
          else setDrawOffer(null);
          break;
        case "rematch":
          setRematch((r) => (r.includes(msg.from) ? r : [...r, msg.from]));
          break;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [apply],
  );

  function endOnline(r: Result) {
    setG((cur) => (cur.result ? cur : { ...cur, result: r }));
    sfx.end();
  }

  function beginOnline(room: GameRoom, white: string, minutes: number, matchId: string, round: number, fee = 0, kind: EntryKind = "room") {
    const opp = room.players.find((p) => p.clientId !== room.clientId) ?? null;
    const o: Online = {
      room,
      matched: onlineRef.current?.matched ?? false,
      matchId,
      round,
      myColor: white === room.clientId ? 1 : -1,
      tc: minutes,
      opp,
    };
    setOnline(o);
    onlineRef.current = o;
    setMode("online");
    setG(newGame());
    awarded.current = false;
    setXpGain(null);
    matchReport.reset();
    // the host's chip entry for this game (the server checks it)
    if (fee > 0 && opp) void matchReport.joinEntry(`${matchId}:${round}`, [user?.id, opp.userId], kind, fee);
    setDrawOffer(null);
    setRematch([]);
    setClocks({ w: minutes * 60_000, b: minutes * 60_000, since: performance.now() });
    setScreen("game");
  }

  function openRoom(match?: Matched) {
    roomRef.current?.leave();
    const minutes = match ? RANDOM_CLOCK : tc;
    hostMatch.current = match ?? null;
    autoStart.current = Boolean(match);
    setRoomTc(minutes);
    setPeers([]);
    setRoomStatus(null);
    setRoomNote(null);
    const room = GameRoom.host("chess", me(), 2, { tc: minutes }, roomEvents());
    roomRef.current = room;
    setOnline({ room, matched: Boolean(match), matchId: "", round: 0, myColor: 1, tc: minutes, opp: null });
    setScreen("room");
  }

  function joinRoom(code: string, matched = false) {
    roomRef.current?.leave();
    setPeers([]);
    setRoomStatus(null);
    setRoomNote(null);
    const room = GameRoom.join("chess", code, me(), roomEvents());
    roomRef.current = room;
    setOnline({ room, matched, matchId: "", round: 0, myColor: 1, tc: 5, opp: null });
    setScreen("room");
  }

  function hostStart(swap = false) {
    const room = roomRef.current;
    if (!room?.isHost || room.players.length < 2) return;
    const o = onlineRef.current;
    const other = room.players.find((p) => p.clientId !== room.clientId)!;
    // first game: random colours; rematch: swap
    let white: string;
    if (swap && o) white = o.myColor === 1 ? other.clientId : room.clientId;
    else white = Math.random() < 0.5 ? room.clientId : other.clientId;
    const minutes = Number(room.settings.tc) || 5;
    const match = randomId();
    const round = (o?.round ?? 0) + 1;
    // chips: 3 each in random matches (if both can), the host's pick in friend rooms
    const matched = Boolean(o?.matched);
    const kind: EntryKind = matched ? "random" : "room";
    const fee = matchFee(matched, room.settings.fee, room.players.map((p) => p.chips));
    room.send("start", { white, tc: minutes, match, round, fee, ek: kind });
    beginOnline(room, white, minutes, match, round, fee, kind);
  }

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
    onPeers: (list: RoomPeer[], settings: Record<string, unknown>) => {
      setPeers(list);
      if (typeof settings.tc === "number") setRoomTc(settings.tc);
      const room = roomRef.current;
      const o = onlineRef.current;
      // opponent left mid-game
      if (o && o.round > 0 && !list.some((p) => p.clientId !== room?.clientId)) {
        setG((cur) => (cur.result ? cur : { ...cur, result: { winner: o.myColor, reason: "Opponent left the game" } }));
        setOnline((x) => (x ? { ...x, opp: null } : x));
      }
      if (room?.isHost && autoStart.current && list.length === 2) {
        autoStart.current = false;
        window.setTimeout(() => roomRef.current === room && hostStart(), 400);
      }
    },
    onMessage: (msg: RoomMsg) => onRoomMessageRef.current(msg),
  });
  const onRoomMessageRef = useRef(onRoomMessage);
  onRoomMessageRef.current = onRoomMessage;

  // rematch: both asked → the host starts (colours swap)
  useEffect(() => {
    const room = roomRef.current;
    if (!room?.isHost || !online || peers.length < 2) return;
    if (peers.every((p) => rematch.includes(p.clientId))) {
      setRematch([]);
      hostStart(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rematch, peers]);

  function leaveOnline() {
    // leaving a game in progress is a loss (and confirms the other player's win)
    const o = onlineRef.current;
    if (o?.opp && o.matchId && !g.result && !awarded.current && screen === "game") {
      awarded.current = true;
      void matchReport.report(`${o.matchId}:${o.round}`, [user?.id, o.opp.userId], [o.opp.userId]);
    }
    roomRef.current?.leave();
    roomRef.current = null;
    hostMatch.current = null;
    autoStart.current = false;
    setOnline(null);
    setPeers([]);
    setScreen("menu");
    setMenuTab("online");
  }
  useEffect(() => () => roomRef.current?.leave(), []);

  const lobby = useCarromLobby({
    enabled: GameRoom.configured && Boolean(user) && menuTab === "online",
    channel: "chess-lobby",
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

  /* ----- my online move / clocks / flag ----- */
  function onBoardMove(m: Move) {
    if (mode === "online") {
      const o = onlineRef.current;
      if (!o || g.s.turn !== o.myColor) return;
      const side: "w" | "b" = o.myColor === 1 ? "w" : "b";
      const c = clocksRef.current;
      // the clocks start after White's first move
      const left = g.played.length === 0 ? c[side] : Math.max(0, c[side] - (performance.now() - c.since));
      o.room.send("move", { uci: uci(m), ply: g.played.length, left: Math.round(left) });
      setClocks({ ...c, [side]: left, since: performance.now() });
      setDrawOffer(null);
    }
    apply(m);
  }

  useEffect(() => {
    if (mode !== "online" || screen !== "game" || g.result || !online) return;
    const id = window.setInterval(() => {
      const c = clocksRef.current;
      const cur = gRef.current;
      if (cur.result || cur.played.length < 1) return; // the clock starts after White's first move
      const side: "w" | "b" = cur.s.turn === 1 ? "w" : "b";
      const left = c[side] - (performance.now() - c.since);
      const mine = cur.s.turn === online.myColor;
      // my own flag at 0; the opponent's after a grace period (in case they froze or dropped)
      if ((mine && left <= 0) || (!mine && left <= -2500)) {
        online.room.send("flag", { color: cur.s.turn });
        endOnline({
          winner: -cur.s.turn as Color,
          reason: mine ? "You ran out of time" : "Opponent ran out of time",
        });
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [mode, screen, g.result, online]);

  /* ================= render ================= */

  const xp = shop.xpOf("chess");
  const lv = levelForXp(xp);
  const xpBar = (
    <div className="ch-xp" title={`${xp} XP`}>
      <span>Chess level {lv}</span>
      <i style={{ width: `${lv >= 30 ? 100 : ((xp - xpForLevel(lv)) / (xpForLevel(lv + 1) - xpForLevel(lv))) * 100}%` }} />
    </div>
  );

  // stickers / emoji / phrases with the other player, in the room and during the match
  useMatchChat(online && screen !== "menu" ? `chess:${online.room.code}` : null, { id: online?.room.clientId ?? "", name: myName });

  if (screen === "room" && online) {
    const room = online.room;
    return (
      <div className="game-surface ch-surface">
        <RoomWaiting
          status={roomStatus}
          note={roomNote}
          code={room.code}
          peers={peers}
          myId={room.clientId}
          isHost={room.isHost}
          matched={online.matched}
          seats={2}
          title={`Chess · ${roomTc} min`}
          blurb={`${roomTc} minutes each. Colours are picked at random.`}
          hostSettings={
            <div className="ol-seg" role="radiogroup" aria-label="Clock">
              {CLOCKS.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={roomTc === m ? "active" : ""}
                  onClick={() => {
                    setRoomTc(m);
                    room.setMeta({ tc: m });
                  }}
                >
                  {m} min
                </button>
              ))}
            </div>
          }
          canStart={peers.length === 2}
          onStart={() => hostStart()}
          onLeave={leaveOnline}
          entry={<RoomEntry room={room} peers={peers} isHost={room.isHost} matched={online.matched} />}
        />
      </div>
    );
  }

  if (screen === "menu") {
    return (
      <div className="game-surface ch-surface">
        {/* Play → how to play → that mode's settings */}
        <PlayFlow
          id="chess"
          preview={
            <div className="pf-preview ch-preview" inert>
              <Board s={PREVIEW_STATE} moves={[]} canMove={false} flipped={false} lastMove={null} onMove={() => {}} theme={theme} pieces={pieceSet} />
            </div>
          }
          corner={user ? xpBar : null}
          homeExtra={(go) =>
            saved && saved.moves.length ? (
              <button type="button" className="pf-link" onClick={() => go(() => startCpu(saved))}>
                Resume · {LEVELS.find((l) => l.id === saved.level)?.label} · move {Math.ceil(saved.moves.length / 2)}
              </button>
            ) : null
          }
          modes={[
            {
              key: "cpu",
              label: "vs CPU",
              icon: <Bot size={15} />,
              start: () => startCpu(),
              settings: (
                <div className="ol-card">
            <p className="ol-sub">Difficulty</p>
            <div className="ol-seg" role="radiogroup" aria-label="Difficulty">
              {LEVELS.map((l) => (
                <button key={l.id} type="button" className={level === l.id ? "active" : ""} onClick={() => setLevel(l.id)}>
                  {l.label}
                </button>
              ))}
            </div>
            <p className="ol-sub">Play as</p>
            <div className="ol-seg" role="radiogroup" aria-label="Your colour">
              {(
                [
                  ["w", "White"],
                  ["b", "Black"],
                  ["r", "Random"],
                ] as const
              ).map(([id, label]) => (
                <button key={id} type="button" className={pickColor === id ? "active" : ""} onClick={() => setPickColor(id)}>
                  {label}
                </button>
              ))}
            </div>
            <CpuEntryToggle entry={cpuEntry} />
                </div>
              ),
            },
            {
              key: "pass",
              label: "2 players",
              icon: <Users size={15} />,
              start: startPass,
              settings: (
                <div className="ol-card">
            <p className="ol-sub">Two players on this device, taking turns.</p>
            <label className="ch-check">
              <input type="checkbox" checked={autoFlip} onChange={(e) => setAutoFlip(e.target.checked)} /> Turn the board after each move
            </label>
                </div>
              ),
            },
            {
              key: "online",
              label: "Online",
              icon: <Globe size={15} />,
              panel: (
          !GameRoom.configured ? (
            <div className="ol-card">
              <p className="ol-sub">Online play isn't available right now.</p>
            </div>
          ) : !user ? (
            <SignInToPlay what="play rated games online" />
          ) : (
            <OnlineMenu
              lobby={lobby}
              guestWait={guestWait}
              inviteLabel="a game of chess"
              findLabel={`Find a match · ${RANDOM_CLOCK} min`}
              settings={
                <>
                  <p className="ol-sub">Clock for rooms and invites</p>
                  <div className="ol-seg" role="radiogroup" aria-label="Clock">
                    {CLOCKS.map((m) => (
                      <button key={m} type="button" className={tc === m ? "active" : ""} onClick={() => setTc(m)}>
                        {m} min
                      </button>
                    ))}
                  </div>
                </>
              }
              onCreate={() => openRoom()}
              onJoin={(code) => joinRoom(code)}
              footer={<RatingBoard me={user.id} />}
            />
          )
              ),
            },
          ]}
        />
      </div>
    );
  }

  /* ----- the game ----- */
  const flipped = mode === "pass" ? autoFlip && g.s.turn === -1 : myColor === -1;
  const canMove = !g.result && (mode === "pass" || g.s.turn === myColor) && !thinking;
  const topColor: Color = flipped ? 1 : -1;
  const bottomColor = -topColor as Color;
  const nameOf = (c: Color) => {
    if (mode === "pass") return c === 1 ? "White" : "Black";
    if (mode === "cpu") return c === cpuColor ? "CPU" : myName;
    return c === myColor ? myName : online?.opp?.name ?? "Opponent";
  };
  const avatarOf = (c: Color) => {
    if (mode === "cpu") return c === cpuColor ? null : user ? { id: user.id, avatar: myAvatar } : null;
    if (mode === "online") return c === myColor ? { id: user?.id ?? "me", avatar: myAvatar } : online?.opp ? { id: online.opp.userId, avatar: online.opp.avatar } : null;
    return null;
  };
  const subOf = (c: Color) => (mode === "cpu" && c === cpuColor ? LEVELS.find((l) => l.id === level)?.label : mode === "pass" ? undefined : c === 1 ? "White" : "Black");
  const clockFor = (c: Color) =>
    mode === "online" ? (
      <Clock base={c === 1 ? clocks.w : clocks.b} running={!g.result && g.played.length > 0 && g.s.turn === c} since={clocks.since} />
    ) : undefined;

  const result = g.result;
  const won = result && result.winner !== null && (mode === "pass" ? true : result.winner === myColor);
  const resultTitle = !result
    ? ""
    : result.winner === null
      ? "Draw"
      : mode === "pass"
        ? `${result.winner === 1 ? "White" : "Black"} wins`
        : won
          ? "You won! 🏆"
          : "You lost";
  const iAsked = online ? rematch.includes(online.room.clientId) : false;
  const theyAsked = online?.opp ? rematch.includes(online.opp.clientId) : false;

  const status = result
    ? result.reason
    : thinking
      ? "CPU is thinking…"
      : mode === "pass"
        ? `${g.s.turn === 1 ? "White" : "Black"} to move`
        : g.s.turn === myColor
          ? "Your move"
          : mode === "online"
            ? `${online?.opp?.name ?? "Opponent"}'s move`
            : "";

  return (
    <div className="game-surface ch-surface">
      <PlayerBar name={nameOf(topColor)} sub={subOf(topColor)} avatar={avatarOf(topColor)} color={topColor} s={g.s} clock={clockFor(topColor)} turn={!result && g.s.turn === topColor} />
      <div className="ch-board-wrap">
        <Board s={g.s} moves={moves} canMove={canMove} flipped={flipped} lastMove={last} onMove={onBoardMove} theme={theme} pieces={pieceSet} />
        {drawOffer === "received" && !result ? (
          <div className="ch-toast" role="alert">
            <span>{online?.opp?.name ?? "Opponent"} offers a draw</span>
            <button
              type="button"
              className="ghost-btn"
              onClick={() => {
                online?.room.send("draw-reply", { accept: false });
                setDrawOffer(null);
              }}
            >
              No
            </button>
            <button
              type="button"
              className="primary-btn"
              onClick={() => {
                online?.room.send("draw-reply", { accept: true });
                endOnline({ winner: null, reason: "Draw agreed" });
              }}
            >
              Accept
            </button>
          </div>
        ) : null}
        {result ? (
          <div className="ch-overlay">
            <div className={`ch-card${won && mode !== "pass" ? " is-win" : result.winner !== null && mode !== "pass" ? " is-loss" : ""}`}>
              <h3>{resultTitle}</h3>
              <p>{result.reason}</p>
              {mode === "online" ? <MatchRewardLine reward={matchReport.reward} /> : xpGain ? <p className="ch-xp-gain">+{xpGain} XP</p> : null}
              {mode === "cpu" ? <CpuEntryLine entry={cpuEntry} /> : null}
              <div className="ch-actions">
                {mode === "online" ? (
                  <>
                    <button type="button" className="ghost-btn" onClick={leaveOnline}>
                      Leave
                    </button>
                    <button
                      type="button"
                      className="primary-btn"
                      disabled={!online?.opp || iAsked}
                      onClick={() => {
                        online?.room.send("rematch", {});
                        setRematch((r) => (online && !r.includes(online.room.clientId) ? [...r, online.room.clientId] : r));
                      }}
                    >
                      {!online?.opp ? "Opponent left" : iAsked ? "Waiting…" : theyAsked ? "Accept rematch" : "Rematch"}
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" className="ghost-btn" onClick={() => setScreen("menu")}>
                      Menu
                    </button>
                    <GameShopButton />
                    <button type="button" className="primary-btn" onClick={() => (mode === "cpu" ? startCpu() : startPass())}>
                      Play again
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>
      <PlayerBar
        name={nameOf(bottomColor)}
        sub={subOf(bottomColor)}
        avatar={avatarOf(bottomColor)}
        color={bottomColor}
        s={g.s}
        clock={clockFor(bottomColor)}
        turn={!result && g.s.turn === bottomColor}
      />

      <p className="ch-status" aria-live="polite">
        {status}
      </p>

      <MoveList played={g.played} />

      <div className="ch-actions">
        {mode === "online" && !result ? (
          <>
            <button
              type="button"
              className="ghost-btn"
              disabled={drawOffer === "sent" || g.played.length < 2}
              onClick={() => {
                online?.room.send("draw-offer", {});
                setDrawOffer("sent");
              }}
            >
              {drawOffer === "sent" ? "Draw offered" : "½ Offer draw"}
            </button>
            <ConfirmButton
              label="⚑ Resign"
              confirm="Resign?"
              onConfirm={() => {
                online?.room.send("resign", {});
                endOnline({ winner: -myColor as Color, reason: "You resigned" });
              }}
            />
          </>
        ) : null}
        {mode !== "online" && !result ? (
          <>
            <ConfirmButton
              label={mode === "cpu" ? "⚑ Resign" : "↺ New game"}
              confirm={mode === "cpu" ? "Resign?" : "Start over?"}
              onConfirm={() => {
                if (mode === "cpu") setG((cur) => ({ ...cur, result: { winner: cpuColor, reason: "You resigned" } }));
                else startPass();
              }}
            />
            <button type="button" className="ghost-btn" onClick={() => setScreen("menu")}>
              Menu
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}


function MoveList({ played }: { played: { san: string }[] }) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ left: ref.current.scrollWidth, behavior: "smooth" });
  }, [played.length]);
  if (!played.length) return null;
  const pairs: string[][] = [];
  for (let i = 0; i < played.length; i += 2) pairs.push([played[i].san, played[i + 1]?.san ?? ""]);
  return (
    <ol className="ch-moves" ref={ref} aria-label="Moves">
      {pairs.map(([w, b], i) => (
        <li key={i}>
          <small>{i + 1}.</small> {w} {b}
        </li>
      ))}
    </ol>
  );
}

function ConfirmButton({ label, confirm, onConfirm }: { label: string; confirm: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = window.setTimeout(() => setArmed(false), 3000);
    return () => window.clearTimeout(id);
  }, [armed]);
  return (
    <button
      type="button"
      className={`ghost-btn${armed ? " is-armed" : ""}`}
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        onConfirm();
      }}
    >
      {armed ? confirm : label}
    </button>
  );
}
