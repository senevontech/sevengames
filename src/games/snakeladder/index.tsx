/* Snake & Ladder: vs Senevi (1–3 Senevis), same device (2–4 players) and online (2–4).
   Online is host-authoritative like Ludo: the host rolls the dice for everyone, plays the Senevi
   seats and runs the turn timer (15 s once the last move has finished showing; on timeout it
   rolls for you; 3 timeouts in a row and Senevi takes the seat), and broadcasts the state. Other
   players only send "roll". Random matches and invites are 1-v-1; a room code takes 2–4, with
   Senevis in the seats still empty at the start. No chips: XP only (game_xp 'snakeladder'). */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Globe, RotateCcw, Users, Volume2, VolumeX } from "lucide-react";
import type { GameProps } from "../index";
import { CELLS, newGame, roll, validState, type SLMove, type SLState } from "./engine";
import SnakeLadderBoard, { moveDuration, TOKEN_PAINTS, useTokenMotion } from "./Board";
import Dice, { DICE_MS } from "./Dice";
import { isMuted, setMuted, sfx } from "./sound";
import { useAuthContext } from "../../context/AuthContext";
import { useAvatar, type AvatarChoice } from "../../lib/avatar";
import { useShop } from "../../lib/shop";
import { levelForXp, xpForLevel } from "../../lib/shopCatalog";
import { GameRoom, type RoomMsg, type RoomPeer, type RoomStatus } from "../../lib/gameRoom";
import { useCarromLobby, type LobbyApi, type Matched } from "../carrom/matchmaking";
import { OnlineMenu, RoomWaiting, SignInToPlay } from "../../components/OnlineLobby";
import PlayerAvatar from "../../components/PlayerAvatar";
import { useMatchChat } from "../../components/chat/MatchChat";
import PlayFlow from "../PlayFlow";
import ChipLine from "../../components/ChipLine";
import { senevi, seneviBotName, SeneviFace, SeneviIcon, SeneviLine, SENEVI_NAME, useSeneviProfiles } from "../../senevi/Senevi";
import "./snakeladder.css";

const GAME = "snakeladder";
const seneviName = (i: number) => seneviBotName(Math.max(1, i));
const seneviSeat = (i: number) => `sl-${i}`;

type Mode = "cpu" | "pass" | "online";
type Seat = { kind: "human" | "cpu"; name: string; clientId?: string; userId?: string; avatar?: AvatarChoice | null; timeouts?: number };

const TURN_MS = 15_000;
const CPU_DELAY = 700;
const MAX_TIMEOUTS = 3;
/** XP (no chips): vs Senevi and online; same-device games give none */
const XP = { cpu: { win: 40, loss: 10 }, online: { win: 60, loss: 15 } };

const d6 = () => 1 + Math.floor(Math.random() * 6);
const COLOUR_NAMES = ["Red", "Blue", "Green", "Yellow"];

/* ---------------- turn timer ring ---------------- */
function TurnTimer({ deadline }: { deadline: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((t) => t + 1), 250);
    return () => window.clearInterval(id);
  }, [deadline]);
  const left = Math.max(0, Math.min(TURN_MS, deadline - Date.now()));
  return (
    <span className={`sl-timer${left < 5000 ? " is-low" : ""}`} aria-label={`${Math.ceil(left / 1000)} seconds left`}>
      <svg viewBox="0 0 36 36" aria-hidden="true">
        <circle cx={18} cy={18} r={15} fill="none" strokeWidth={4} className="sl-timer-bg" />
        <circle cx={18} cy={18} r={15} fill="none" strokeWidth={4} strokeDasharray={`${(left / TURN_MS) * 94.25} 94.25`} transform="rotate(-90 18 18)" className="sl-timer-fg" />
      </svg>
      <b>{Math.ceil(left / 1000)}</b>
    </span>
  );
}

/** how long until a move's token stops (dice + walk + snake/ladder) */
const showMs = (m: SLMove | null) => (m ? moveDuration(m) : 0);

export default function SnakeLadderGame(_props: GameProps) {
  useSeneviProfiles();
  const { user } = useAuthContext();
  const { choice: myAvatar } = useAvatar(user);
  const shop = useShop();
  const meta = user?.user_metadata ?? {};
  const myName = ((meta.full_name as string | undefined) || (meta.name as string | undefined) || user?.email?.split("@")[0] || "You").slice(0, 40);

  const [screen, setScreen] = useState<"menu" | "room" | "game">("menu");
  const [menuTab, setMenuTab] = useState<Mode>("cpu");
  const [mode, setMode] = useState<Mode>("cpu");
  const [cpuPlayers, setCpuPlayers] = useState(2);
  const [passPlayers, setPassPlayers] = useState(2);
  const [roomSeats, setRoomSeats] = useState(4);
  const [st, setSt] = useState<SLState>(() => newGame(4));
  const [seats, setSeats] = useState<Seat[]>([]);
  const [deadline, setDeadline] = useState(0);
  const [xpGain, setXpGain] = useState<number | null>(null);
  const [muted, setMutedState] = useState(isMuted);
  const awarded = useRef(false);
  const motion = useTokenMotion(st);
  const { animating } = motion;

  // online
  const roomRef = useRef<GameRoom | null>(null);
  const [roomStatus, setRoomStatus] = useState<RoomStatus | null>(null);
  const [roomNote, setRoomNote] = useState<string | null>(null);
  const [peers, setPeers] = useState<RoomPeer[]>([]);
  const [matched, setMatched] = useState(false);
  const matchedRef = useRef(false);
  const [hostGone, setHostGone] = useState(false);
  const [guestWait, setGuestWait] = useState<string | null>(null);
  const hostMatch = useRef<Matched | null>(null);
  const autoStart = useRef(false);
  const lobbyRef = useRef<LobbyApi | null>(null);
  const stRef = useRef(st);
  stRef.current = st;
  const seatsRef = useRef(seats);
  seatsRef.current = seats;
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const deadlineRef = useRef(deadline);
  deadlineRef.current = deadline;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const timers = useRef<number[]>([]);
  const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms));
  const clearLater = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };
  useEffect(() => () => clearLater(), []);

  const online = mode === "online" && roomRef.current !== null;
  const isAuthority = !online || roomRef.current!.isHost;
  const mySeat = online ? seats.findIndex((x) => x.clientId === roomRef.current!.clientId) : mode === "cpu" ? 0 : -1;
  // while a token is still moving, it is still the mover's go on screen
  const shownTurn = animating && st.last ? st.last.seat : st.turn;
  const over = st.phase === "over" && !animating;
  const myTurn = !animating && st.phase === "roll" && (mode === "pass" ? seats[st.turn]?.kind === "human" : st.turn === mySeat);

  /* ----- applying a roll (authority) ----- */
  const broadcast = useCallback((s: SLState, seatList: Seat[], timeLeft: number) => {
    roomRef.current?.send("state", { st: s, seats: seatList, timeLeft });
  }, []);

  /** sounds and Senevi's reactions, timed to when the token gets there */
  const react = useCallback((next: SLState) => {
    const m = next.last;
    if (!m) return;
    const total = showMs(m);
    if (m.kind === "snake" || m.kind === "ladder") {
      const atJump = DICE_MS + 60 + (m.land - m.from) * 270;
      if (modeRef.current === "cpu") {
        const moverIsCpu = seatsRef.current[m.seat]?.kind === "cpu";
        const goodForCpu = (m.kind === "ladder") === moverIsCpu;
        later(() => senevi({ type: goodForCpu ? "cpuGood" : "playerGood" }, moverIsCpu ? seneviSeat(m.seat) : undefined), atJump);
      }
    }
    if (next.phase === "over") {
      later(() => {
        sfx.win();
        if (modeRef.current === "cpu") {
          seatsRef.current.forEach((x, i) => {
            if (x.kind === "cpu") senevi({ type: "over", result: next.winner === i ? "cpu" : next.winner === 0 ? "player" : "draw" }, seneviSeat(i));
          });
        }
      }, total);
    }
  }, []);

  const commit = useCallback(
    (next: SLState, seatList = seatsRef.current) => {
      stRef.current = next;
      setSt(next);
      react(next);
      const wait = TURN_MS + showMs(next.last);
      setDeadline(Date.now() + wait);
      if (roomRef.current?.isHost && modeRef.current === "online") broadcast(next, seatList, wait);
    },
    [broadcast, react],
  );

  const doRoll = useCallback(() => {
    const s = stRef.current;
    if (s.phase !== "roll") return;
    commit(roll(s, d6()));
  }, [commit]);

  /* ----- authority: Senevi seats and the online turn timer ----- */
  useEffect(() => {
    if (!isAuthority || screen !== "game" || st.phase !== "roll" || animating) return;
    const seat = seats[st.turn];
    if (!seat) return;
    if (seat.kind === "cpu") {
      if (mode === "cpu") senevi({ type: "think", ms: CPU_DELAY + 200 }, seneviSeat(st.turn));
      const id = window.setTimeout(doRoll, CPU_DELAY);
      return () => window.clearTimeout(id);
    }
    if (mode === "online") {
      const id = window.setTimeout(
        () => {
          const cur = stRef.current;
          if (cur.turn !== st.turn || cur.phase !== "roll") return;
          const list = seatsRef.current.map((x, i) => (i === cur.turn ? { ...x, timeouts: (x.timeouts ?? 0) + 1 } : x));
          if ((list[cur.turn].timeouts ?? 0) >= MAX_TIMEOUTS) list[cur.turn] = { ...list[cur.turn], kind: "cpu", name: `${list[cur.turn].name} (Senevi)` };
          setSeats(list);
          seatsRef.current = list;
          commit(roll(cur, d6()), list);
        },
        Math.max(0, deadline - Date.now()),
      );
      return () => window.clearTimeout(id);
    }
  }, [isAuthority, screen, st, seats, animating, mode, deadline, commit, doRoll]);

  function resetTimeouts(seat = stRef.current.turn) {
    const list = seatsRef.current;
    if (!list[seat]?.timeouts) return;
    const next = list.map((x, i) => (i === seat ? { ...x, timeouts: 0 } : x));
    setSeats(next);
    seatsRef.current = next;
  }

  function myRoll() {
    if (!myTurn) return;
    if (online && !isAuthority) roomRef.current!.send("roll", {});
    else {
      if (online) resetTimeouts();
      doRoll();
    }
  }

  /* ----- XP when a game ends (no chips) ----- */
  useEffect(() => {
    if (st.phase !== "over" || awarded.current || mode === "pass" || !user) return;
    awarded.current = true;
    const won = mySeat >= 0 && st.winner === mySeat;
    const table = mode === "online" ? XP.online : XP.cpu;
    const amount = Math.round((won ? table.win : table.loss) * (won && st.n >= 4 ? 1.25 : 1));
    setXpGain(amount);
    void shop.awardXp(GAME, amount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.phase, mode, mySeat, user]);

  /* ----- local games ----- */
  function startLocal(m: Mode, n: number) {
    clearLater();
    setMode(m);
    modeRef.current = m;
    const list: Seat[] =
      m === "cpu"
        ? Array.from({ length: n }, (_, i) => (i === 0 ? { kind: "human", name: myName, userId: user?.id, avatar: myAvatar } : { kind: "cpu", name: seneviName(i) }))
        : Array.from({ length: n }, (_, i) => ({ kind: "human", name: `Player ${i + 1}` }));
    setSeats(list);
    seatsRef.current = list;
    const s = newGame(n);
    stRef.current = s;
    setSt(s);
    awarded.current = false;
    setXpGain(null);
    if (m === "cpu") window.setTimeout(() => senevi({ type: "start" }), 600);
    setScreen("game");
  }

  /* ----- online ----- */
  const me = () => ({ userId: user?.id ?? "", name: myName, avatar: myAvatar });

  const onMessage = useCallback(
    (msg: RoomMsg) => {
      const room = roomRef.current;
      if (!room) return;
      if (msg.t === "state" && !room.isHost) {
        if (!validState(msg.st)) return;
        const s = msg.st;
        const list = Array.isArray(msg.seats) ? (msg.seats as Seat[]).slice(0, 4) : [];
        setMode("online");
        modeRef.current = "online";
        // a new game from the host
        if (s.rolls === 0 || (stRef.current.phase === "over" && s.phase !== "over")) {
          clearLater();
          awarded.current = false;
          setXpGain(null);
        }
        // (the host re-sends the same state when players come and go: react once per roll)
        const fresh = s.rolls > 0 && s.rolls !== stRef.current.rolls;
        stRef.current = s;
        setSt(s);
        if (fresh) react(s);
        setSeats(list);
        seatsRef.current = list;
        setDeadline(Date.now() + Math.max(0, Math.min(TURN_MS + 20_000, Number(msg.timeLeft) || TURN_MS)));
        setScreen("game");
        return;
      }
      if (!room.isHost || msg.t !== "roll") return;
      // host: a roll from the player whose turn it is (and only once their last move has shown)
      const s = stRef.current;
      const seat = seatsRef.current[s.turn];
      if (!seat || seat.kind !== "human" || seat.clientId !== msg.from) return;
      if (Date.now() < deadlineRef.current - TURN_MS - 150) return;
      resetTimeouts();
      doRoll();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doRoll, react],
  );
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  function hostStartOnline() {
    const room = roomRef.current;
    if (!room?.isHost) return;
    clearLater();
    const n = Number(room.settings.seats) || 2;
    const list: Seat[] = Array.from({ length: n }, (_, i) => {
      const p = room.players[i];
      return p ? { kind: "human", name: p.name, clientId: p.clientId, userId: p.userId, avatar: p.avatar, timeouts: 0 } : { kind: "cpu", name: seneviName(i) };
    });
    setMode("online");
    modeRef.current = "online";
    setSeats(list);
    seatsRef.current = list;
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
      if (typeof settings.seats === "number") setRoomSeats(settings.seats);
      const room = roomRef.current;
      if (!room) return;
      if (!room.isHost) {
        if (!list.some((p) => p.isHost) && screenRef.current === "game") setHostGone(true);
        return;
      }
      // host: players who left mid-game are played by Senevi
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
    roomRef.current = GameRoom.host(GAME, me(), n, {}, roomEvents());
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
    roomRef.current = GameRoom.join(GAME, code, me(), roomEvents());
    setScreen("room");
  }
  function leaveOnline() {
    clearLater();
    roomRef.current?.leave();
    roomRef.current = null;
    hostMatch.current = null;
    autoStart.current = false;
    setMode("cpu");
    modeRef.current = "cpu";
    setScreen("menu");
    setMenuTab("online");
  }
  useEffect(() => () => roomRef.current?.leave(), []);

  const lobby = useCarromLobby({
    enabled: GameRoom.configured && Boolean(user) && menuTab === "online",
    channel: "snakeladder-lobby",
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

  useMatchChat(mode === "online" || screen === "room" ? (roomRef.current ? `${GAME}:${roomRef.current.code}` : null) : null, {
    id: roomRef.current?.clientId ?? "",
    name: myName,
  });

  /* ================= render ================= */
  const xp = shop.xpOf(GAME);
  const lv = levelForXp(xp);
  const paints = useMemo(() => TOKEN_PAINTS.slice(0, st.n), [st.n]);

  const seatPicker = (value: number, set: (n: number) => void, options: number[], label: string, word = "players") => (
    <div className="ol-seg" role="radiogroup" aria-label={label}>
      {options.map((n) => (
        <button key={n} type="button" className={value === n ? "active" : ""} onClick={() => set(n)}>
          {n} {word}
        </button>
      ))}
    </div>
  );

  const soundBtn = (
    <button
      type="button"
      className="sl-icon-btn"
      aria-label={muted ? "Sound off" : "Sound on"}
      aria-pressed={!muted}
      onClick={() => {
        setMuted(!muted);
        setMutedState(!muted);
      }}
    >
      {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
    </button>
  );

  if (screen === "room" && roomRef.current) {
    const room = roomRef.current;
    return (
      <div className="game-surface sl-surface">
        <RoomWaiting
          status={roomStatus}
          note={roomNote}
          code={room.code}
          peers={peers}
          myId={room.clientId}
          isHost={room.isHost}
          matched={matched}
          seats={roomSeats}
          title={`Snake & Ladder · ${roomSeats} players`}
          blurb={`Empty seats are played by ${SENEVI_NAME} when the game starts.`}
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
          startLabel={peers.length < roomSeats ? `Start · ${roomSeats - peers.length} ${SENEVI_NAME}` : "Start game"}
          onStart={hostStartOnline}
          onLeave={leaveOnline}
        />
      </div>
    );
  }

  if (screen === "menu") {
    return (
      <div className="game-surface sl-surface">
        <PlayFlow
          id={GAME}
          preview={
            <div className="pf-preview sl-preview" inert>
              <SnakeLadderBoard st={st} motion={motion} turn={null} paints={paints} />
            </div>
          }
          corner={
            user ? (
              <div className="sl-xp" title={`${xp} XP`}>
                <span>Snake & Ladder level {lv}</span>
                <i style={{ width: `${lv >= 30 ? 100 : ((xp - xpForLevel(lv)) / (xpForLevel(lv + 1) - xpForLevel(lv))) * 100}%` }} />
              </div>
            ) : null
          }
          modes={[
            {
              key: "cpu",
              chips: <ChipLine kind="free" note={`Free · XP for every game`} />,
              label: `vs ${SENEVI_NAME}`,
              icon: <SeneviIcon size={17} />,
              start: () => startLocal("cpu", cpuPlayers),
              settings: (
                <div className="ol-card">
                  <p className="ol-sub">You play red and roll first.</p>
                  {seatPicker(cpuPlayers - 1, (k) => setCpuPlayers(k + 1), [1, 2, 3], `${SENEVI_NAME} opponents`, SENEVI_NAME)}
                </div>
              ),
            },
            {
              key: "pass",
              chips: <ChipLine kind="free" note="Free · friends on one device" />,
              label: "Same device",
              icon: <Users size={15} />,
              start: () => startLocal("pass", passPlayers),
              settings: (
                <div className="ol-card">
                  <p className="ol-sub">Friends on this device take turns with the dice.</p>
                  {seatPicker(passPlayers, setPassPlayers, [2, 3, 4], "Players")}
                </div>
              ),
            },
            {
              key: "online",
              chips: <ChipLine kind="free" note="Free · 2–4 players · XP for every game" />,
              label: "Online",
              icon: <Globe size={15} />,
              panel: !GameRoom.configured ? (
                <div className="ol-card">
                  <p className="ol-sub">Online play isn't available right now.</p>
                </div>
              ) : !user ? (
                <SignInToPlay what="play Snake & Ladder online" />
              ) : (
                <OnlineMenu
                  lobby={lobby}
                  guestWait={guestWait}
                  inviteLabel="a game of Snake & Ladder"
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
              ),
            },
          ]}
        />
      </div>
    );
  }

  /* ----- the game ----- */
  const turnSeat = seats[shownTurn];
  const turnName = turnSeat?.name ?? COLOUR_NAMES[shownTurn];
  const winner = st.winner;
  const winnerName = winner === null ? "" : seats[winner]?.name ?? COLOUR_NAMES[winner];
  const iWon = winner !== null && winner === mySeat;
  const last = st.last;
  const lastNote = !last
    ? ""
    : last.kind === "blocked"
      ? `needs exactly ${CELLS - last.from}`
      : last.kind === "ladder"
        ? `ladder ${last.land} → ${last.to}`
        : last.kind === "snake"
          ? `snake ${last.land} → ${last.to}`
          : `to ${last.to}`;
  const status = hostGone
    ? "The host left. This game can't go on without them."
    : over
      ? mode === "pass" || mySeat < 0
        ? `${winnerName} wins!`
        : iWon
          ? "You win!"
          : `${winnerName} wins`
      : animating
        ? `${turnName} rolled ${st.dice}${lastNote ? ` · ${lastNote}` : ""}`
        : myTurn
          ? mode === "pass"
            ? `${turnName}: tap the dice to roll`
            : "Your turn: tap the dice to roll"
          : turnSeat?.kind === "cpu"
            ? `${turnName} is rolling…`
            : `${turnName}'s turn`;

  return (
    <div className="game-surface sl-surface" style={{ "--sl-turn": paints[shownTurn]?.solid } as React.CSSProperties}>
      <ul className="sl-players">
        {seats.map((seat, i) => (
          <li
            key={i}
            className={`${i === shownTurn && !over ? "is-turn" : ""}${i === mySeat ? " is-me" : ""}${over && winner === i ? " is-winner" : ""}`}
            style={{ "--sl-c": paints[i]?.solid } as React.CSSProperties}
          >
            {mode === "cpu" && seat.kind === "cpu" ? (
              <SeneviFace size={24} seat={seneviSeat(i)} bot={Math.max(1, i)} className="sl-senevi" />
            ) : seat.userId ? (
              <PlayerAvatar id={seat.userId} name={seat.name} avatar={seat.avatar ?? null} size={22} className="lb-initial sl-av" />
            ) : seat.kind === "cpu" ? (
              <Bot size={16} className="sl-dot-icon" aria-hidden="true" />
            ) : (
              <span className="sl-dot" aria-hidden="true" />
            )}
            <span className="sl-pname">{seat.name}</span>
            <small title={`On square ${motion.animating && last?.seat === i ? last.from : st.pos[i]}`}>{motion.animating && last?.seat === i ? last.from : st.pos[i]}</small>
            {online && i === st.turn && st.phase === "roll" && !animating && seat.kind === "human" ? <TurnTimer deadline={deadline} /> : null}
          </li>
        ))}
      </ul>
      {mode === "cpu" ? (
        <div className="sl-senevi-says" aria-live="polite">
          {seats.map((x, i) => (x.kind === "cpu" ? <SeneviLine key={i} seat={seneviSeat(i)} /> : null))}
        </div>
      ) : null}

      <SnakeLadderBoard st={st} motion={motion} turn={over || hostGone ? null : shownTurn} paints={paints} />

      <div className="sl-bar">
        <Dice value={st.dice} rollId={st.rolls} color={paints[shownTurn]?.solid ?? "#888"} onClick={myTurn && !hostGone ? myRoll : undefined} label={st.dice ? `Last roll: ${st.dice}` : "Dice"} />
        <div className="sl-info">
          <p className={`sl-status${over ? " is-over" : ""}`} aria-live="polite">
            {status}
          </p>
          <p className="sl-sub">
            {over
              ? xpGain
                ? `+${xpGain} XP`
                : `Reached ${CELLS} first.`
              : st.dice
                ? `Last roll: ${st.dice}`
                : "Exact roll needed to land on 100."}
          </p>
        </div>
        {soundBtn}
      </div>

      <div className="sl-actions">
        {online ? (
          <>
            {over && roomRef.current?.isHost && !hostGone ? (
              <button type="button" className="sl-btn sl-btn-main" onClick={hostStartOnline}>
                <RotateCcw size={15} /> Play again
              </button>
            ) : over && !hostGone ? (
              <span className="sl-wait">Waiting for the host…</span>
            ) : null}
            <button type="button" className="sl-btn" onClick={leaveOnline}>
              Leave game
            </button>
          </>
        ) : (
          <>
            <button type="button" className={`sl-btn${over ? " sl-btn-main" : ""}`} onClick={() => startLocal(mode, st.n)}>
              <RotateCcw size={15} /> {over ? "Play again" : "New game"}
            </button>
            <button type="button" className="sl-btn" onClick={() => setScreen("menu")}>
              Menu
            </button>
          </>
        )}
      </div>
    </div>
  );
}
