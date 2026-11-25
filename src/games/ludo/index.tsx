/* Ludo: vs CPU (2–4 players), pass-and-play on one device, and online.
   Online is host-authoritative: the host rolls the dice, plays the CPU seats and runs the turn
   timer (15 s; on timeout it plays for you; 3 timeouts in a row and a CPU takes the seat), and
   broadcasts the state. Other players only send "roll" / "move". Random matches and invites are
   1-v-1; a room code takes 2–4 players, with CPUs in seats still empty at the start. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameProps } from "../index";
import LudoBoard, { Die, useShownTokens } from "./Board";
import { COLOR_KEYS, COLOR_NAMES, cpuPick, current, movable, move, newGame, pass, roll, type Color, type LudoState } from "./engine";
import { useAuthContext } from "../../context/AuthContext";
import { useAvatar, useAvatarUri, type AvatarChoice } from "../../lib/avatar";
import { seatPaints } from "./paint";
import { useShop } from "../../lib/shop";
import { levelForXp, ludoBoardOf, ludoDiceOf, ludoTokenOf, xpForLevel } from "../../lib/shopCatalog";
import { GameRoom, type RoomMsg, type RoomPeer, type RoomStatus } from "../../lib/gameRoom";
import { useCarromLobby, type LobbyApi, type Matched } from "../carrom/matchmaking";
import { OnlineMenu, RoomWaiting, SignInToPlay } from "../../components/OnlineLobby";
import PlayerAvatar from "../../components/PlayerAvatar";
import "./ludo.css";
import { GameShopButton } from "../gameShop";
import { useMatchChat } from "../../components/chat/MatchChat";
import { OutcomeIcon, type Outcome } from "../ResultBanner";
import "../result-banner.css";
import { MatchRewardLine, newMatchId, useMatchReport } from "../../lib/matchReport";
import { matchFee, useCpuEntry, type EntryKind } from "../../lib/entries";
import { useTokens } from "../../lib/tokens";
import RoomEntry from "../../components/RoomEntry";
import { CpuEntryLine, CpuEntryToggle } from "../../components/CpuEntry";
import PlayFlow from "../PlayFlow";
import ChipLine from "../../components/ChipLine";
import { Bot, Globe, Users } from "lucide-react";
import { senevi, SeneviFace, SeneviIcon, SeneviLine, SENEVI_NAME } from "../../senevi/Senevi";

/** vs CPU: every CPU seat is a Senevi (seat 1 "Senevi", then "Senevi II", "Senevi III"). */
const seneviName = (i: number) => (i <= 1 ? SENEVI_NAME : `${SENEVI_NAME} ${i === 2 ? "II" : "III"}`);
const seneviSeat = (i: number) => `ludo-${i}`;

type Mode = "cpu" | "pass" | "online";
/** `tint`: the player's token colour (shop slot ludo_token), shown to everyone. */
type Seat = { kind: "human" | "cpu"; name: string; clientId?: string; userId?: string; avatar?: AvatarChoice | null; tint?: string | null; timeouts?: number };

const TURN_MS = 15_000;
const CPU_DELAY = 650;
const XP = { cpu: { win: 60, loss: 15 }, online: { win: 120, loss: 30 } };
const MAX_TIMEOUTS = 3;

const d6 = () => 1 + Math.floor(Math.random() * 6);

/* ---------------- sounds ---------------- */
let actx: AudioContext | null = null;
function tone(f: number, d: number, v: number, type: OscillatorType = "triangle", delay = 0) {
  try {
    actx ??= new AudioContext();
    const t = actx.currentTime + delay;
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
  roll: () => [0, 0.06, 0.12, 0.18].forEach((d) => tone(300 + Math.random() * 300, 0.05, 0.05, "square", d)),
  move: () => tone(520, 0.07, 0.06),
  capture: () => [660, 440, 330].forEach((f, i) => tone(f, 0.12, 0.08, "sawtooth", i * 0.08)),
  home: () => [523, 784].forEach((f, i) => tone(f, 0.18, 0.07, "triangle", i * 0.1)),
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, 0.07, "triangle", i * 0.12)),
};

/* ---------------- turn timer ring ---------------- */
function TurnTimer({ deadline }: { deadline: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((t) => t + 1), 250);
    return () => window.clearInterval(id);
  }, [deadline]);
  const left = Math.max(0, deadline - Date.now());
  const pct = left / TURN_MS;
  return (
    <span className={`lu-timer${left < 5000 ? " is-low" : ""}`} aria-label={`${Math.ceil(left / 1000)} seconds left`}>
      <svg viewBox="0 0 36 36" aria-hidden="true">
        <circle cx={18} cy={18} r={15} fill="none" strokeWidth={4} className="lu-timer-bg" />
        <circle cx={18} cy={18} r={15} fill="none" strokeWidth={4} strokeDasharray={`${pct * 94.25} 94.25`} transform="rotate(-90 18 18)" className="lu-timer-fg" />
      </svg>
      <b>{Math.ceil(left / 1000)}</b>
    </span>
  );
}

export default function LudoGame(_props: GameProps) {
  const { user } = useAuthContext();
  const { choice: myAvatar } = useAvatar(user);
  const shop = useShop();
  const theme = ludoBoardOf(shop.equippedIn("ludo_board"));
  const diceStyle = ludoDiceOf(shop.equippedIn("ludo_dice"));
  // your token colour (nothing equipped = the board's seat colour)
  const myTint = ludoTokenOf(shop.equippedIn("ludo_token")) ? shop.equippedIn("ludo_token") : null;
  const meta = user?.user_metadata ?? {};
  const myName = ((meta.full_name as string | undefined) || (meta.name as string | undefined) || user?.email?.split("@")[0] || "You").slice(0, 40);

  const [screen, setScreen] = useState<"menu" | "room" | "game">("menu");
  const [menuTab, setMenuTab] = useState<Mode>("cpu");
  const [mode, setMode] = useState<Mode>("cpu");
  const [cpuPlayers, setCpuPlayers] = useState(4);
  const [passPlayers, setPassPlayers] = useState(2);
  const [roomSeats, setRoomSeats] = useState(4);
  const [st, setSt] = useState<LudoState>(() => newGame(4));
  const [seats, setSeats] = useState<Seat[]>([]);
  const [deadline, setDeadline] = useState(0);
  const [xpGain, setXpGain] = useState<number | null>(null);
  const awarded = useRef(false);
  const matchReport = useMatchReport("ludo", () => void shop.refresh());
  const { shown, animating } = useShownTokens(st);

  // online
  const roomRef = useRef<GameRoom | null>(null);
  const [roomStatus, setRoomStatus] = useState<RoomStatus | null>(null);
  const [roomNote, setRoomNote] = useState<string | null>(null);
  const [peers, setPeers] = useState<RoomPeer[]>([]);
  const peersRef = useRef<RoomPeer[]>([]);
  const [matched, setMatched] = useState(false);
  // (callbacks made when the room opened read this, not the state)
  const matchedRef = useRef(false);
  // the chip entry of the current online match, sent with every state so late joiners see it
  const entryRef = useRef<{ fee: number; kind: EntryKind }>({ fee: 0, kind: "room" });
  const { wallet } = useTokens();
  const earnedRef = useRef(0);
  earnedRef.current = wallet?.earned ?? 0;
  // vs CPU: 1 earned chip a game, if switched on
  const cpuEntry = useCpuEntry("ludo");
  const [hostGone, setHostGone] = useState(false);
  const [guestWait, setGuestWait] = useState<string | null>(null);
  const hostMatch = useRef<Matched | null>(null);
  const autoStart = useRef(false);
  const lobbyRef = useRef<LobbyApi | null>(null);
  const stRef = useRef(st);
  stRef.current = st;
  const seatsRef = useRef(seats);
  seatsRef.current = seats;

  const online = mode === "online" && roomRef.current !== null;
  const isAuthority = !online || roomRef.current!.isHost;
  const mySeat = online ? seats.findIndex((x) => x.clientId === roomRef.current!.clientId) : mode === "cpu" ? 0 : -1;
  const turnSeat = st.turn;
  const turnColor = current(st);
  const seatNow = seats[turnSeat];
  const myTurn = !animating && st.phase !== "over" && (mode === "pass" ? true : turnSeat === mySeat);
  const choices = myTurn && st.phase === "move" ? movable(st) : [];

  /* ----- applying actions (authority) ----- */
  // online: this match's id (the host makes it and sends it with every state) + who played
  const matchIdRef = useRef("");
  const playersRef = useRef<string[]>([]);
  const broadcast = useCallback((s: LudoState, seatList: Seat[], timeLeft: number) => {
    roomRef.current?.send("state", { st: s, seats: seatList, timeLeft, mid: matchIdRef.current, fee: entryRef.current.fee, ek: entryRef.current.kind });
  }, []);

  const commit = useCallback(
    (next: LudoState, seatList = seatsRef.current) => {
      const prev = stRef.current;
      if (next.last && next.last !== prev.last) {
        // Senevi (vs CPU): reacts to captures, his own and yours
        if (mode === "cpu" && next.last.captured.length) {
          const list = seatsRef.current;
          const by = prev.colors.indexOf(next.last.color);
          if (list[by]?.kind === "cpu") senevi({ type: "cpuGood" }, seneviSeat(by));
          for (const v of next.last.captured) {
            const vs = prev.colors.indexOf(v.color);
            if (list[vs]?.kind === "cpu" && list[by]?.kind === "human") senevi({ type: "playerGood" }, seneviSeat(vs));
          }
        }
        if (next.last.captured.length) sfx.capture();
        else if (next.last.to === 56) sfx.home();
        else sfx.move();
      }
      if (next.phase === "over" && prev.phase !== "over") {
        sfx.win();
        if (mode === "cpu") {
          const w = next.winner === null ? -1 : next.colors.indexOf(next.winner);
          seatsRef.current.forEach((x, i) => {
            if (x.kind === "cpu") senevi({ type: "over", result: i === w ? "cpu" : w === 0 ? "player" : "draw" }, seneviSeat(i));
          });
        }
      }
      stRef.current = next;
      setSt(next);
      const turnChanged = next.turn !== prev.turn || next.phase !== prev.phase || next.rolls !== prev.rolls;
      if (turnChanged) setDeadline(Date.now() + TURN_MS);
      if (roomRef.current?.isHost && mode === "online") broadcast(next, seatList, TURN_MS);
    },
    [broadcast, mode],
  );

  const doRoll = useCallback(() => {
    const s = stRef.current;
    if (s.phase !== "roll") return;
    sfx.roll();
    commit(roll(s, d6()));
  }, [commit]);

  const doMove = useCallback(
    (token: number) => {
      const s = stRef.current;
      if (!movable(s).includes(token)) return;
      commit(move(s, token));
    },
    [commit],
  );

  /* ----- authority: CPUs, no-move passes, single-option auto moves, online timeouts ----- */
  useEffect(() => {
    if (!isAuthority || screen !== "game" || st.phase === "over" || animating) return;
    const seat = seats[st.turn];
    if (!seat) return;
    const opts = st.phase === "move" ? movable(st) : [];
    // rolled with nothing to move: show the dice a moment, then pass
    if (st.phase === "move" && opts.length === 0) {
      const id = window.setTimeout(() => commit(pass(stRef.current)), 900);
      return () => window.clearTimeout(id);
    }
    if (seat.kind === "cpu") {
      if (mode === "cpu" && st.phase === "roll") senevi({ type: "think", ms: 900 }, seneviSeat(st.turn));
      const id = window.setTimeout(() => (st.phase === "roll" ? doRoll() : doMove(cpuPick(stRef.current))), CPU_DELAY);
      return () => window.clearTimeout(id);
    }
    // a human with only one possible move (or all tokens equivalent in the yard): play it for them
    if (st.phase === "move") {
      const s = st;
      const c = current(s);
      const same = opts.every((i) => s.tokens[c][i] === s.tokens[c][opts[0]]);
      if (opts.length === 1 || same) {
        const id = window.setTimeout(() => doMove(opts[0]), 450);
        return () => window.clearTimeout(id);
      }
    }
    // online: the turn timer
    if (mode === "online") {
      const id = window.setTimeout(
        () => {
          const cur = stRef.current;
          if (cur.turn !== st.turn || cur.phase === "over") return;
          const list = seatsRef.current.map((x, i) => (i === cur.turn ? { ...x, timeouts: (x.timeouts ?? 0) + 1 } : x));
          const tooSlow = (list[cur.turn].timeouts ?? 0) >= MAX_TIMEOUTS;
          if (tooSlow) list[cur.turn] = { ...list[cur.turn], kind: "cpu", name: `${list[cur.turn].name} (Senevi)` };
          setSeats(list);
          seatsRef.current = list;
          if (cur.phase === "roll") commit(roll(cur, d6()), list);
          else commit(move(cur, cpuPick(cur)), list);
        },
        Math.max(0, deadline - Date.now()),
      );
      return () => window.clearTimeout(id);
    }
  }, [isAuthority, screen, st, seats, animating, mode, deadline, commit, doRoll, doMove]);

  /* ----- my actions ----- */
  function myRoll() {
    if (!myTurn || st.phase !== "roll") return;
    if (online && !isAuthority) roomRef.current!.send("roll", {});
    else {
      if (online) resetTimeouts();
      doRoll();
    }
  }
  function myMove(token: number) {
    if (!myTurn || !choices.includes(token)) return;
    if (online && !isAuthority) roomRef.current!.send("move", { token });
    else {
      if (online) resetTimeouts();
      doMove(token);
    }
  }
  function resetTimeouts(seat = stRef.current.turn) {
    const list = seatsRef.current;
    if (!list[seat]?.timeouts) return;
    const next = list.map((x, i) => (i === seat ? { ...x, timeouts: 0 } : x));
    setSeats(next);
    seatsRef.current = next;
  }

  /* ----- XP when the game ends ----- */
  useEffect(() => {
    if (st.phase !== "over" || mode !== "cpu") return;
    const myColor = st.colors[0];
    void cpuEntry.finish(st.winner === myColor ? "win" : "lose");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.phase, mode]);
  useEffect(() => {
    if (st.phase !== "over" || awarded.current || mode === "pass" || !user) return;
    awarded.current = true;
    const myColor = mySeat >= 0 ? st.colors[mySeat] : null;
    const won = myColor !== null && st.winner === myColor;
    if (mode === "online") {
      // the server applies XP (+100 / −40) and the confirmed-win token
      const w = st.winner ? seats[st.colors.indexOf(st.winner)] : null;
      const winnerId = w && w.userId && playersRef.current.includes(w.userId) && !w.name.endsWith("(left)") ? w.userId : null;
      if (matchIdRef.current) void matchReport.report(matchIdRef.current, playersRef.current, [winnerId]);
      return;
    }
    const table = XP.cpu;
    const bonus = st.colors.length >= 4 && won ? 1.25 : 1;
    const amount = Math.round((won ? table.win : table.loss) * bonus);
    setXpGain(amount);
    void shop.awardXp("ludo", amount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st, mode, mySeat, user, shop]);

  /* ----- local games ----- */
  function startLocal(m: Mode, n: number) {
    setMode(m);
    const list: Seat[] =
      m === "cpu"
        ? Array.from({ length: n }, (_, i) => (i === 0 ? { kind: "human", name: myName, userId: user?.id, avatar: myAvatar, tint: myTint } : { kind: "cpu", name: seneviName(i) }))
        : Array.from({ length: n }, (_, i) => ({ kind: "human", name: `Player ${i + 1}` }));
    setSeats(list);
    seatsRef.current = list;
    // a random colour for you (seat 0) each game; the board turns so your yard is bottom-right
    const s = newGame(n, Math.floor(Math.random() * 4));
    stRef.current = s;
    setSt(s);
    awarded.current = false;
    setXpGain(null);
    if (m === "cpu") {
      void cpuEntry.open();
      window.setTimeout(() => senevi({ type: "start" }), 600);
    }
    setScreen("game");
  }

  /* ----- online ----- */
  const me = () => ({ userId: user?.id ?? "", name: myName, avatar: myAvatar, look: myTint, chips: earnedRef.current });

  const onMessage = useCallback(
    (msg: RoomMsg) => {
      const room = roomRef.current;
      if (!room) return;
      if (msg.t === "state" && !room.isHost) {
        const s = msg.st as LudoState;
        if (!s || !Array.isArray(s.tokens)) return;
        const list = (msg.seats as Seat[]) ?? [];
        setMode("online");
        if (typeof msg.mid === "string" && msg.mid !== matchIdRef.current) {
          matchIdRef.current = msg.mid.slice(0, 60);
          playersRef.current = list.filter((x) => x.kind === "human" && x.userId).map((x) => x.userId!);
          matchReport.reset();
          // the host's chip entry (the server checks it)
          const fee = Math.max(0, Math.floor(Number(msg.fee) || 0));
          if (fee > 0) void matchReport.joinEntry(matchIdRef.current, playersRef.current, msg.ek === "random" ? "random" : "room", fee);
        }
        if (stRef.current.phase === "over" && s.phase !== "over") {
          awarded.current = false;
          setXpGain(null);
        }
        stRef.current = s;
        setSt(s);
        setSeats(list);
        seatsRef.current = list;
        setDeadline(Date.now() + Math.max(0, Math.min(TURN_MS, Number(msg.timeLeft) || TURN_MS)));
        setScreen("game");
        if (s.rolls !== 0 && s.last === null && s.phase !== "roll") sfx.roll();
        return;
      }
      if (!room.isHost) return;
      // host: actions from the player whose turn it is
      const s = stRef.current;
      const seat = seatsRef.current[s.turn];
      if (!seat || seat.kind !== "human" || seat.clientId !== msg.from) return;
      if (msg.t === "roll") {
        resetTimeouts();
        doRoll();
      } else if (msg.t === "move") {
        resetTimeouts();
        doMove(Number(msg.token));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doRoll, doMove],
  );
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  function hostStartOnline() {
    const room = roomRef.current;
    if (!room?.isHost) return;
    const n = Number(room.settings.seats) || 2;
    const list: Seat[] = Array.from({ length: n }, (_, i) => {
      const p = room.players[i];
      return p ? { kind: "human", name: p.name, clientId: p.clientId, userId: p.userId, avatar: p.avatar, tint: p.look ?? null, timeouts: 0 } : { kind: "cpu", name: seneviName(i) };
    });
    setMode("online");
    setSeats(list);
    seatsRef.current = list;
    matchIdRef.current = newMatchId();
    playersRef.current = list.filter((x) => x.kind === "human" && x.userId).map((x) => x.userId!);
    matchReport.reset();
    // chips: 3 each in random matches (if all can), the host's pick in friend rooms
    const kind: EntryKind = matchedRef.current ? "random" : "room";
    const humans = room.players.slice(0, n);
    const fee = humans.length >= 2 ? matchFee(matchedRef.current, room.settings.fee, humans.map((p) => p.chips)) : 0;
    entryRef.current = { fee, kind };
    if (fee > 0) void matchReport.joinEntry(matchIdRef.current, playersRef.current, kind, fee);
    const s = newGame(n);
    stRef.current = s;
    setSt(s);
    awarded.current = false;
    setXpGain(null);
    setDeadline(Date.now() + TURN_MS);
    setScreen("game");
    broadcast(s, list, TURN_MS);
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
      peersRef.current = list;
      if (typeof settings.seats === "number") setRoomSeats(settings.seats);
      const room = roomRef.current;
      if (!room) return;
      if (!room.isHost) {
        if (!list.some((p) => p.isHost) && screenRef.current === "game") setHostGone(true);
        return;
      }
      // host: players who left mid-game become CPUs
      const present = new Set(list.map((p) => p.clientId));
      const cur = seatsRef.current;
      if (screenRef.current === "game" && cur.some((x) => x.kind === "human" && x.clientId && !present.has(x.clientId))) {
        const next = cur.map((x) => (x.kind === "human" && x.clientId && !present.has(x.clientId) ? { ...x, kind: "cpu" as const, name: `${x.name} (left)` } : x));
        setSeats(next);
        seatsRef.current = next;
        broadcast(stRef.current, next, Math.max(0, deadlineRef.current - Date.now()));
      }
      if (autoStart.current && list.length >= Number(room.settings.seats || 2)) {
        autoStart.current = false;
        window.setTimeout(() => roomRef.current === room && hostStartOnline(), 400);
      }
    },
    onMessage: (msg: RoomMsg) => onMessageRef.current(msg),
  });
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const deadlineRef = useRef(deadline);
  deadlineRef.current = deadline;

  function openRoom(match?: Matched) {
    roomRef.current?.leave();
    const n = match ? 2 : roomSeats;
    hostMatch.current = match ?? null;
    autoStart.current = Boolean(match);
    setMatched(Boolean(match));
    matchedRef.current = Boolean(match);
    setHostGone(false);
    setPeers([]);
    setRoomStatus(null);
    setRoomNote(null);
    setRoomSeats(n);
    roomRef.current = GameRoom.host("ludo", me(), n, {}, roomEvents());
    setScreen("room");
  }
  function joinRoom(code: string, wasMatched = false) {
    roomRef.current?.leave();
    setMatched(wasMatched);
    matchedRef.current = wasMatched;
    setHostGone(false);
    setPeers([]);
    setRoomStatus(null);
    setRoomNote(null);
    roomRef.current = GameRoom.join("ludo", code, me(), roomEvents());
    setScreen("room");
  }
  function leaveOnline() {
    // leaving a game in progress is a loss
    if (mode === "online" && screen === "game" && stRef.current.phase !== "over" && !awarded.current && matchIdRef.current) {
      awarded.current = true;
      void matchReport.report(matchIdRef.current, playersRef.current, []);
    }
    roomRef.current?.leave();
    roomRef.current = null;
    hostMatch.current = null;
    autoStart.current = false;
    setMode("cpu");
    setScreen("menu");
    setMenuTab("online");
  }
  useEffect(() => () => roomRef.current?.leave(), []);

  const lobby = useCarromLobby({
    enabled: GameRoom.configured && Boolean(user) && menuTab === "online",
    channel: "ludo-lobby",
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

  /* ================= render ================= */
  const xp = shop.xpOf("ludo");
  const lv = levelForXp(xp);
  const labels = useMemo(() => {
    const out: Partial<Record<Color, string>> = {};
    st.colors.forEach((c, i) => {
      if (seats[i]) out[c] = seats[i].name.slice(0, 14);
    });
    return out;
  }, [st.colors, seats]);

  // seat colours (players' own colours, clashes swapped) and pictures for the board
  const paints = useMemo(() => seatPaints(theme, st.colors, st.colors.map((_, i) => seats[i]?.tint)), [theme, st.colors, seats]);
  const avatarSeat = (i: number) => (seats[i]?.kind === "human" ? seats[i]?.avatar ?? null : null);
  const av0 = useAvatarUri(avatarSeat(0));
  const av1 = useAvatarUri(avatarSeat(1));
  const av2 = useAvatarUri(avatarSeat(2));
  const av3 = useAvatarUri(avatarSeat(3));
  const avatars = useMemo(() => {
    const out: Partial<Record<Color, string>> = {};
    [av0, av1, av2, av3].forEach((uri, i) => {
      if (uri && st.colors[i] !== undefined) out[st.colors[i]] = uri;
    });
    return out;
  }, [av0, av1, av2, av3, st.colors]);
  // menu preview: your colour and picture on the first seat
  const myUri = useAvatarUri(user ? myAvatar ?? null : null);
  const previewPaints = useMemo(() => seatPaints(theme, st.colors, [myTint]), [theme, st.colors, myTint]);
  const previewAvatars = useMemo(() => (myUri ? ({ [st.colors[0]]: myUri } as Partial<Record<Color, string>>) : {}), [myUri, st.colors]);

  const seatPicker = (value: number, set: (n: number) => void, options: number[], label: string) => (
    <div className="ol-seg" role="radiogroup" aria-label={label}>
      {options.map((n) => (
        <button key={n} type="button" className={value === n ? "active" : ""} onClick={() => set(n)}>
          {n} players
        </button>
      ))}
    </div>
  );

  // stickers / emoji / phrases with the other players, in the room and during the match
  useMatchChat(mode === "online" || screen === "room" ? (roomRef.current ? `ludo:${roomRef.current.code}` : null) : null, {
    id: roomRef.current?.clientId ?? "",
    name: myName,
  });

  if (screen === "room" && roomRef.current) {
    const room = roomRef.current;
    return (
      <div className="game-surface lu-surface">
        <RoomWaiting
          status={roomStatus}
          note={roomNote}
          code={room.code}
          peers={peers}
          myId={room.clientId}
          isHost={room.isHost}
          matched={matched}
          seats={roomSeats}
          title={`Ludo · ${roomSeats} players`}
          blurb="Empty seats are played by Senevi when the game starts."
          hostSettings={seatPicker(
            roomSeats,
            (n) => {
              setRoomSeats(n);
              room.setMeta({ seats: n });
            },
            [2, 3, 4],
            "Seats",
          )}
          canStart={peers.length >= 2 || roomSeats > 1}
          startLabel={peers.length < roomSeats ? `Start · ${roomSeats - peers.length} Senevi` : "Start game"}
          onStart={hostStartOnline}
          onLeave={leaveOnline}
          entry={<RoomEntry room={room} peers={peers} isHost={room.isHost} matched={matched} />}
        />
      </div>
    );
  }

  if (screen === "menu") {
    return (
      <div className="game-surface lu-surface">
        {/* Play → how to play → that mode's settings */}
        <PlayFlow
          id="ludo"
          preview={
            <div className="pf-preview lu-preview" inert>
              <div className="lu-board-wrap" style={{ "--lu-line": theme.line } as React.CSSProperties}>
                <LudoBoard s={st} shown={shown} theme={theme} dice={diceStyle} choices={[]} onPick={() => {}} labels={labels} paints={previewPaints} avatars={previewAvatars} live={false} />
              </div>
            </div>
          }
          corner={
            user ? (
          <div className="lu-xp" title={`${xp} XP`}>
            <span>Ludo level {lv}</span>
            <i style={{ width: `${lv >= 30 ? 100 : ((xp - xpForLevel(lv)) / (xpForLevel(lv + 1) - xpForLevel(lv))) * 100}%` }} />
          </div>
            ) : null
          }
          modes={[
            {
              key: "cpu", chips: <ChipLine kind="cpu" on={cpuEntry.enabled} />,
              label: `vs ${SENEVI_NAME}`,
              icon: <SeneviIcon size={17} />,
              start: () => startLocal("cpu", cpuPlayers),
              settings: (
                <div className="ol-card">
            <p className="ol-sub">You get a random colour, in the bottom-right corner.</p>
            {seatPicker(cpuPlayers, setCpuPlayers, [2, 3, 4], "Players")}
            <CpuEntryToggle entry={cpuEntry} />
                </div>
              ),
            },
            {
              key: "pass", chips: <ChipLine kind="free" note="Free · friends on one device" />,
              label: "Same device",
              icon: <Users size={15} />,
              start: () => startLocal("pass", passPlayers),
              settings: (
                <div className="ol-card">
            <p className="ol-sub">Friends on this device take turns.</p>
            {seatPicker(passPlayers, setPassPlayers, [2, 3, 4], "Players")}
                </div>
              ),
            },
            {
              key: "online", chips: <ChipLine kind="online" />,
              label: "Online",
              icon: <Globe size={15} />,
              panel: (
          !GameRoom.configured ? (
            <div className="ol-card">
              <p className="ol-sub">Online play isn't available right now.</p>
            </div>
          ) : !user ? (
            <SignInToPlay what="play Ludo online" />
          ) : (
            <OnlineMenu
              lobby={lobby}
              guestWait={guestWait}
              inviteLabel="a game of Ludo"
              findLabel="Find a 1-v-1 match"
              settings={
                <>
                  <p className="ol-sub">Room size (invites and random matches are 1-v-1)</p>
                  {seatPicker(roomSeats, setRoomSeats, [2, 3, 4], "Room size")}
                </>
              }
              onCreate={() => openRoom()}
              onJoin={(code) => joinRoom(code)}
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
  // turn the board so your yard (online: yours; on one device: player 1's) is bottom-right.
  // Yards go clockwise from the top-left (red, green, yellow, blue); bottom-right is corner 2.
  const viewColor = st.colors[mySeat >= 0 ? mySeat : 0] ?? 2;
  const boardRot = (2 - viewColor + 4) % 4;
  const winnerSeat = st.winner === null ? -1 : st.colors.indexOf(st.winner);
  const iWon = st.phase === "over" && winnerSeat >= 0 && winnerSeat === mySeat;
  // result card look: a win for you (or whoever won on a shared device), a loss, or neutral
  const resultOutcome: Outcome = hostGone ? "draw" : mode === "pass" || mySeat < 0 || iWon ? "win" : "lose";
  const turnName = seatNow?.name ?? COLOR_NAMES[turnColor];
  const status =
    st.phase === "over"
      ? ""
      : myTurn
        ? st.phase === "roll"
          ? mode === "pass"
            ? `${turnName}: roll!`
            : "Your turn — roll!"
          : choices.length > 1
            ? "Pick a token to move"
            : choices.length === 0
              ? "No move this time"
              : "Moving…"
        : seatNow?.kind === "cpu"
          ? `${turnName} is playing…`
          : `${turnName}'s turn`;

  return (
    <div className="game-surface lu-surface" style={{ "--lu-turn": paints[turnColor].solid } as React.CSSProperties}>
      {/* players */}
      <ul className="lu-players">
        {st.colors.map((c, i) => {
          const seat = seats[i];
          const home = st.tokens[c].filter((p) => p === 56).length;
          return (
            <li key={c} className={`${i === st.turn && st.phase !== "over" ? "is-turn" : ""}${i === mySeat ? " is-me" : ""}`} style={{ "--lu-c": paints[c].solid } as React.CSSProperties}>
              {mode === "cpu" && seat?.kind === "cpu" ? (
                <SeneviFace size={24} seat={seneviSeat(i)} className="lu-senevi" />
              ) : seat?.userId ? (
                <PlayerAvatar id={seat.userId} name={seat.name} avatar={seat.avatar ?? null} size={22} className="lb-initial lu-av" />
              ) : (
                <span className="lu-dot" aria-hidden="true" />
              )}
              <span className="lu-pname">{seat?.name ?? COLOR_NAMES[c]}</span>
              <small>{home}/4</small>
              {online && i === st.turn && st.phase !== "over" && seat?.kind === "human" ? <TurnTimer deadline={deadline} /> : null}
            </li>
          );
        })}
      </ul>
      {/* what the Senevis say: one quiet row under the players (always reserved, so nothing jumps) */}
      {mode === "cpu" ? (
        <div className="lu-senevi-says" aria-live="polite">
          {seats.map((x, i) => (x.kind === "cpu" ? <SeneviLine key={i} seat={seneviSeat(i)} /> : null))}
        </div>
      ) : null}

      <div className="lu-board-wrap" style={{ "--lu-line": theme.line } as React.CSSProperties}>
        <LudoBoard s={st} shown={shown} theme={theme} dice={diceStyle} choices={choices} onPick={myMove} labels={labels} rot={boardRot} paints={paints} avatars={avatars} />
        {st.phase === "over" || hostGone ? (
          // same flat result card as every other game (ResultBanner), with Ludo's own buttons
          <div className={`rb rb-${resultOutcome} lu-result`} role="dialog" aria-modal="false" aria-live="assertive">
            <div className="rb-card">
              <OutcomeIcon outcome={resultOutcome} />
              {hostGone ? (
                <>
                  <h3 className="rb-title">The host left</h3>
                  <p className="rb-detail">This game can't go on without them.</p>
                </>
              ) : (
                <>
                  <h3 className="rb-title">
                    {mode === "pass" || mySeat < 0 ? `${seats[winnerSeat]?.name ?? COLOR_NAMES[st.winner!]} wins!` : iWon ? "You won!" : "You lost"}
                  </h3>
                  <p className="rb-detail">
                    {mode !== "pass" && mySeat >= 0 && !iWon
                      ? `${seats[winnerSeat]?.name ?? "Someone"} got all four tokens home first.`
                      : "All four tokens home."}
                  </p>
                  {mode === "online" ? <MatchRewardLine reward={matchReport.reward} /> : xpGain ? <p className="lu-xp-gain">+{xpGain} XP</p> : null}
                  {mode === "cpu" ? <CpuEntryLine entry={cpuEntry} /> : null}
                </>
              )}
              <div className="rb-actions lu-result-actions">
                {online ? (
                  <>
                    {roomRef.current?.isHost && !hostGone ? (
                      <button type="button" className="rb-btn rb-btn-main" onClick={hostStartOnline}>
                        Play again
                      </button>
                    ) : !hostGone ? (
                      <p className="lu-result-wait">Waiting for the host…</p>
                    ) : null}
                    <button type="button" className="rb-btn rb-btn-ghost" onClick={leaveOnline}>
                      Leave
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" className="rb-btn rb-btn-main" onClick={() => startLocal(mode, st.colors.length)}>
                      Play again
                    </button>
                    <button type="button" className="rb-btn rb-btn-ghost" onClick={() => setScreen("menu")}>
                      Menu
                    </button>
                    <GameShopButton className="rb-btn rb-btn-ghost" />
                  </>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="lu-bar">
        <Die
          value={st.dice}
          rollId={st.rolls}
          style={diceStyle}
          color={paints[turnColor].solid}
          onClick={myTurn && st.phase === "roll" ? myRoll : undefined}
        />
        <p className="lu-status" aria-live="polite">
          {status}
        </p>
      </div>

      <div className="lu-actions">
        {online ? (
          <button type="button" className="ghost-btn" onClick={leaveOnline}>
            Leave game
          </button>
        ) : (
          <button
            type="button"
            className="ghost-btn"
            onClick={() => {
              if (mode === "cpu" && stRef.current.phase !== "over") cpuEntry.forfeit();
              setScreen("menu");
            }}
          >
            Menu
          </button>
        )}
      </div>
    </div>
  );
}
