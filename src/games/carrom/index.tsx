/* Carrom game component — mode menu (1vCPU, 2P, 4P, online), lobby,
   and the shared game table with host-authoritative online sync. */
import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { GameProps } from "../index";
import {
  SIZE,
  SUB,
  applyLive,
  boardPoints,
  applySnapshot,
  baselineFor,
  clamp,
  makeWorld,
  minDirFor,
  placeStriker,
  resetStriker,
  rotateAboutCentre,
  viewAngleFor,
  resolveShot,
  scoreForSeat,
  settled,
  shootStriker,
  skipTurn,
  snapshotOf,
  stepPhysics,
  tickSinks,
  type LivePos,
  type Player,
  type SeatKind,
  type Seats,
  type Snap,
  type World,
} from "./engine";
import { planCpuShot, type CpuPlan } from "./cpu";
import {
  CarromFx,
  drawAim,
  drawAimPreview,
  drawBaselineGlow,
  drawBoard,
  drawCoin,
  drawPullBand,
  drawSeatLabels,
  drawSinks,
  drawStriker,
  drawTurnTimer,
  seatRingColor,
  setViewAngle,
} from "./render";
import { CarromNet, type NetStatus, type RosterEntry } from "./online";
import { useCarromLobby, type LobbyApi, type Matched } from "./matchmaking";
import { useAvatar } from "../../lib/avatar";
import PlayerAvatar from "../../components/PlayerAvatar";
import { useAuthContext } from "../../context/AuthContext";
import { carromAudio } from "./audio";
import { STRIKERS, type StrikerSkin } from "./skins";
import { matchXp, useCarromProgress } from "./progress";
import { CPU_STATS, FAIR_STATS, tierOf, type StrikerStats } from "./stats";
import CarromLocker, { LevelBar } from "./Locker";
import { BoardPreview } from "./Preview";
import "./carrom.css";

type Mode = "cpu" | "local2" | "local4" | "host2" | "host4" | "join";

type Phase =
  | "menu"
  | "locker"
  | "join-form"
  | "net-lobby"
  | "place"
  | "shooting"
  | "cpu"
  | "cpu-aim"
  | "over";

const LOCAL_MODES: Mode[] = ["cpu", "local2", "local4"];

/** Single board, or a match of boards: first to 25 points (vs CPU and local games). */
type Format = "board" | "match";
const MATCH_TARGET = 25;
const FORMAT_KEY = "senevon:carrom-format";
const readFormat = (): Format => {
  try {
    return localStorage.getItem(FORMAT_KEY) === "match" ? "match" : "board";
  } catch {
    return "board";
  }
};

/** Time each player gets to place and shoot. */
const TURN_SECONDS = 15;
const TURN_MS = TURN_SECONDS * 1000;

export default function CarromGame({ onFinish }: GameProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const worldRef = useRef<World | null>(null);
  const phaseRef = useRef<Phase>("menu");
  // valid = the aim points into the board (you can't shoot back towards your own edge)
  // flipped = you dragged TOWARDS the target (pointing), so the pull band isn't drawn
  const aimRef = useRef<{ dir: { x: number; y: number }; power: number; valid: boolean; flipped?: boolean }>({
    dir: { x: 0, y: -1 },
    power: 0.65,
    valid: true,
  });
  // Pull-back aiming: you press anywhere on the board and drag away from where you want to shoot.
  const dragRef = useRef<{ mode: "aim"; ax: number; ay: number } | null>(null);
  // Turn clock (0 = not running)
  const deadlineRef = useRef(0);
  const lastSecRef = useRef(-1);
  const timeoutRef = useRef<() => void>(() => {});
  const slidingRef = useRef(false);
  const lastScrapeRef = useRef(0);
  const cpuPlanRef = useRef<CpuPlan | null>(null);
  const shotStartRef = useRef(0);
  const finishedRef = useRef(false);
  const modeRef = useRef<Mode>("cpu");
  const mySeatRef = useRef(0);
  const netRef = useRef<CarromNet | null>(null);
  const lastPlaceRef = useRef(0);
  const finishShotRef = useRef<() => void>(() => {});
  const fireRef = useRef<(dir: { x: number; y: number }, power: number) => void>(() => {});
  const drawRef = useRef<() => void>(() => {});
  const fxRef = useRef(new CarromFx());
  const lastShotRef = useRef(0);
  const frameDtRef = useRef(0.016);
  // the striker on the table right now: upgrade tier (visual effects) and its glow colour
  const strikerTierRef = useRef(0);
  const strikerGlowRef = useRef<string | undefined>(undefined);

  const auth = useAuthContext();
  const prog = useCarromProgress(auth.user);
  const progRef = useRef(prog);
  progRef.current = prog;
  const [muted, setMuted] = useState(carromAudio.muted);
  const [reward, setReward] = useState<{ xp: number; before: number; after: number; combos: number } | null>(null);
  const [format, setFormatState] = useState<Format>(readFormat);
  const formatRef = useRef<Format>(format);
  formatRef.current = format;
  const setFormat = (f: Format) => {
    setFormatState(f);
    try {
      localStorage.setItem(FORMAT_KEY, f);
    } catch {
      /* ignore */
    }
  };
  // match score (points per colour) and the board number; `between` = a board just ended
  const matchRef = useRef({ white: 0, black: 0, board: 1 });
  const [matchScore, setMatchScore] = useState({ white: 0, black: 0, board: 1 });
  const [between, setBetween] = useState<{ text: string } | null>(null);
  // XP bookkeeping across the boards of a match, for the local player
  const tallyRef = useRef({ coins: 0, queen: false, combos: 0, streak: 0 });

  const [screen, setScreen] = useState<Phase>("menu");
  const [message, setMessage] = useState("Pick a mode.");
  const [potted, setPotted] = useState({ white: 0, black: 0 });
  const [queenText, setQueenText] = useState("in play");
  const [powerN, setPowerN] = useState(0.65);
  const [turnName, setTurnName] = useState("—");
  const [joinCode, setJoinCode] = useState("");
  const [netStatus, setNetStatus] = useState<NetStatus>("idle");
  const [netNote, setNetNote] = useState<string | null>(null);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [roomSeats, setRoomSeats] = useState<Seats>(2);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [secsLeft, setSecsLeft] = useState(TURN_SECONDS);
  const [placeT, setPlaceT] = useState(500);
  const [onlineOpen, setOnlineOpen] = useState(false);
  // invite / random match: who we're playing (shown in the room lobby) and the host's handshake
  const [matchWith, setMatchWith] = useState<{ name: string; role: "host" | "guest" } | null>(null);
  const hostMatchRef = useRef<Matched | null>(null); // host: tell this player the room code
  const autoStartRef = useRef(false); // host: start as soon as the matched player is in
  const lobbyRef = useRef<LobbyApi | null>(null);

  const setPhase = useCallback((p: Phase) => {
    phaseRef.current = p;
    // every new turn (or extra shot) starts a fresh clock
    if (p === "place") {
      deadlineRef.current = performance.now() + TURN_MS;
      lastSecRef.current = -1;
      setSecsLeft(TURN_SECONDS);
    } else {
      deadlineRef.current = 0;
    }
    setScreen(p);
  }, []);

  const queenTextOf = useCallback((world: World) => {
    const q = world.queen;
    return q.state === "board"
      ? "in play"
      : q.state === "pending"
        ? `${world.players[q.seat].name} must cover`
        : `${world.players.find((p) => p.color === q.color)?.name ?? "team"}'s queen`;
  }, []);

  /* ============ shooting + shot resolution ============ */

  const fire = useCallback(
    (dir: { x: number; y: number }, power: number) => {
      const world = worldRef.current;
      if (!world || phaseRef.current !== "place") return;
      if (world.players[world.turn].kind === "remote") return;
      const online = modeRef.current.startsWith("host") || modeRef.current === "join";
      if (online && world.turn !== mySeatRef.current) return;
      if (netRef.current && modeRef.current === "join") {
        // Online guest: the host plays the shot. Don't simulate it here too (the two would fight);
        // follow the host's live positions and its snapshot when the shot ends, as for its own shots.
        if (!world.striker.alive) return;
        netRef.current.sendShot(world.turn, world.strikerT[world.turn] ?? 500, dir, power);
        shotStartRef.current = performance.now();
        setPhase("shooting");
        return;
      }
      if (!shootStriker(world, dir, power)) return;
      shotStartRef.current = performance.now();
      setPhase("shooting");
      if (netRef.current && modeRef.current.startsWith("host")) {
        netRef.current.broadcastSnapshot(snapshotOf(world));
      }
    },
    [setPhase],
  );

  /** Adds this board's coins / queen to the local player's match tally. */
  const tallyBoard = useCallback((world: World) => {
    const myColor = world.players[mySeatRef.current]?.color;
    if (!myColor) return;
    tallyRef.current.coins += world.potted[myColor].length;
    if (world.queen.state === "owned" && world.queen.color === myColor) tallyRef.current.queen = true;
  }, []);

  /** XP for the local player at the end of a match (vs CPU and online only). */
  const awardXp = useCallback((won: boolean) => {
    const mode = modeRef.current;
    if (mode === "local2" || mode === "local4") return;
    const t = tallyRef.current;
    const xp = matchXp(t.coins, t.queen, won, t.combos);
    const res = progRef.current.addXp(xp);
    setReward({ xp, combos: t.combos, ...res });
  }, []);

  const finishShot = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    // online guest: the host decides the outcome (pots, fouls, next turn) and sends a snapshot
    if (modeRef.current === "join") return;
    const shooter = world.turn;
    const res = resolveShot(world);
    setPotted({ white: world.potted.white.length, black: world.potted.black.length });
    setQueenText(queenTextOf(world));

    // combos (local player): extra coins in one shot, and pots on back-to-back shots
    if (shooter === mySeatRef.current) {
      const t = tallyRef.current;
      if (res.ownPots > 0) {
        t.combos += res.ownPots - 1;
        t.streak += 1;
        if (t.streak >= 2) t.combos += 1;
      } else t.streak = 0;
    }

    if (res.over) {
      const winColor = world.result?.winner;
      const winSeat = world.players.find((p) => p.color === winColor);
      const winName = winSeat ? `${winSeat.name} win${winSeat.name === "You" ? "" : "s"}` : "Board over";
      const myColor = world.players[mySeatRef.current]?.color;
      tallyBoard(world);
      if (netRef.current && modeRef.current.startsWith("host")) {
        netRef.current.broadcastSnapshot(snapshotOf(world));
      }

      // a match of boards (not online): score the board, then the next one or the match result
      if (formatRef.current === "match" && LOCAL_MODES.includes(modeRef.current) && winColor) {
        const m = matchRef.current;
        const pts = boardPoints(world, m[winColor]);
        m[winColor] += pts;
        setMatchScore({ ...m });
        if (m[winColor] < MATCH_TARGET) {
          setMessage(`${winName} board ${m.board} (+${pts}).`);
          setBetween({ text: `Board ${m.board}: ${winName.toLowerCase()} +${pts}` });
          setPhase("over");
          return;
        }
        setMessage(`${winName} the match ${m.white}–${m.black}!`);
      } else {
        setMessage(`${winName}!`);
      }
      setBetween(null);
      setPhase("over");
      if (!finishedRef.current) {
        finishedRef.current = true;
        onFinish(scoreForSeat(world, mySeatRef.current) + (formatRef.current === "match" ? matchRef.current[myColor ?? "white"] * 5 : 0));
        awardXp(winColor === myColor);
      }
      return;
    }

    setMessage(res.msg + (res.extra ? " Go again!" : ""));
    if (netRef.current && modeRef.current.startsWith("host")) {
      netRef.current.broadcastSnapshot(snapshotOf(world));
    }
    const turn = world.turn;
    setTurnName(world.players[turn].name);
    setPhase(world.players[turn].kind === "cpu" ? "cpu" : "place");
  }, [onFinish, queenTextOf, setPhase, awardXp, tallyBoard]);

  /** The turn clock ran out. A shot already being pulled back is released; otherwise the turn passes. */
  const timeoutTurn = useCallback(() => {
    const world = worldRef.current;
    if (!world || phaseRef.current !== "place") return;
    const aim = aimRef.current;
    if (dragRef.current && aim.power >= 0.05 && aim.valid) {
      dragRef.current = null;
      fireRef.current(aim.dir, aim.power);
      if ((phaseRef.current as Phase) === "shooting") return; // fire() just changed it
    }
    dragRef.current = null;
    aim.power = 0;
    const name = world.players[world.turn].name;
    skipTurn(world);
    carromAudio.timeout();
    const msg = `${name} timed out.`;
    setMessage(msg);
    setQueenText(queenTextOf(world));
    setTurnName(world.players[world.turn].name);
    if (netRef.current && modeRef.current.startsWith("host")) {
      netRef.current.broadcastSnapshot(snapshotOf(world));
      netRef.current.broadcastMsg(msg);
    }
    setPhase(world.players[world.turn].kind === "cpu" ? "cpu" : "place");
  }, [queenTextOf, setPhase]);

  useEffect(() => {
    finishShotRef.current = finishShot;
    fireRef.current = fire;
    timeoutRef.current = timeoutTurn;
  }, [finishShot, fire, timeoutTurn]);

  /* ============ main loop ============ */

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      frameDtRef.current = dt;
      const world = worldRef.current;
      // A new shot was fired (by anyone: you, CPU, a remote player): play the strike animation.
      if (world && world.shotCount !== lastShotRef.current) {
        lastShotRef.current = world.shotCount;
        const st = world.striker;
        const sp = Math.hypot(st.vx, st.vy);
        if (sp > 0) fxRef.current.strike(st.x, st.y, { x: st.vx / sp, y: st.vy / sp }, Math.min(1, (sp - 420) / 1620));
      }

      if (world && phaseRef.current === "shooting") {
        acc += dt * fxRef.current.timeScale(dt);
        let guard = 0;
        while (acc >= SUB && guard < 40) {
          stepPhysics(world, SUB);
          acc -= SUB;
          guard += 1;
        }
        if (acc > SUB) acc = 0;
        if (now - shotStartRef.current > 12000) {
          for (const d of world.discs) {
            d.vx = 0;
            d.vy = 0;
          }
        }
        if (netRef.current && modeRef.current.startsWith("host")) {
          netRef.current.broadcastLive(
            world.discs
              .filter((d) => d.alive && (d.vx !== 0 || d.vy !== 0))
              .map((d) => [d.id, Math.round(d.x), Math.round(d.y)] as LivePos),
          );
        }
        // the queen or a side's last coin dropping: play it in slow motion
        for (const e of world.events) {
          if (e.type !== "pot") continue;
          const last = (e.kind === "white" || e.kind === "black") && !world.discs.some((d) => d.alive && d.kind === e.kind);
          if (e.kind === "queen" || last) fxRef.current.slowMo(0.9);
        }
        fxRef.current.strikerMass = world.striker.m;
        fxRef.current.trackStriker(world.striker, strikerTierRef.current, strikerGlowRef.current);
        fxRef.current.consume(world.events);
        // powder hiss follows how much is moving
        let moving = 0;
        for (const d of world.discs) if (d.alive) moving += Math.hypot(d.vx, d.vy);
        carromAudio.slide(moving);
        slidingRef.current = true;
        // wait for coins still dropping into pockets before resolving the shot
        if (settled(world) && world.sinks.length === 0) {
          acc = 0;
          finishShotRef.current();
        }
      } else {
        acc = 0;
        if (slidingRef.current) {
          slidingRef.current = false;
          carromAudio.slide(0);
        }
      }
      if (world) tickSinks(world, phaseRef.current === "shooting" ? dt * fxRef.current.timeScale(0) : dt);

      // turn clock
      if (world && phaseRef.current === "place" && deadlineRef.current > 0) {
        const left = deadlineRef.current - now;
        const secs = Math.max(0, Math.ceil(left / 1000));
        if (secs !== lastSecRef.current) {
          lastSecRef.current = secs;
          setSecsLeft(secs);
          if (secs > 0 && secs <= 5) carromAudio.tick(secs <= 3);
        }
        if (left <= 0) {
          deadlineRef.current = 0;
          // the host (or the local device) decides; online guests wait for the host's snapshot
          if (modeRef.current !== "join") timeoutRef.current();
        }
      }
      drawRef.current();
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  /* ============ CPU sequencing ============ */

  useEffect(() => {
    if (screen === "cpu") {
      const t1 = window.setTimeout(() => {
        const world = worldRef.current;
        if (!world || phaseRef.current !== "cpu") return;
        const plan = planCpuShot(world);
        cpuPlanRef.current = plan;
        world.strikerT[world.turn] = plan.t;
        resetStriker(world, world.turn);
        setMessage(`${world.players[world.turn].name} is aiming…`);
        setPhase("cpu-aim");
      }, 700);
      return () => window.clearTimeout(t1);
    }
    if (screen === "cpu-aim") {
      const t2 = window.setTimeout(() => {
        const world = worldRef.current;
        const plan = cpuPlanRef.current;
        cpuPlanRef.current = null;
        if (!world || !plan) return;
        placeStriker(world, world.turn, plan.t);
        if (shootStriker(world, plan.dir, plan.power)) {
          shotStartRef.current = performance.now();
          setPhase("shooting");
        }
      }, 800);
      return () => window.clearTimeout(t2);
    }
    return undefined;
  }, [screen, setPhase]);

  /* ============ local games ============ */

  /** Start a new match (or, with `nextBoard`, the next board of the current match). */
  function startLocal(mode: "cpu" | "local2" | "local4", nextBoard = false) {
    carromAudio.unlock();
    modeRef.current = mode;
    mySeatRef.current = 0;
    finishedRef.current = false;
    setReward(null);
    setBetween(null);
    netRef.current?.leave();
    netRef.current = null;
    if (nextBoard) {
      matchRef.current.board += 1;
    } else {
      matchRef.current = { white: 0, black: 0, board: 1 };
      tallyRef.current = { coins: 0, queen: false, combos: 0, streak: 0 };
    }
    setMatchScore({ ...matchRef.current });
    // your upgraded striker vs the CPU and on this device; the CPU is the same for everyone
    const mine: StrikerStats = progRef.current.strikerStats;
    const players: Array<{ name: string; kind: "human" | "cpu"; stats: StrikerStats }> =
      mode === "cpu"
        ? [
            { name: "You", kind: "human", stats: mine },
            { name: "CPU", kind: "cpu", stats: CPU_STATS },
          ]
        : mode === "local2"
          ? [
              { name: "Player 1", kind: "human", stats: mine },
              { name: "Player 2", kind: "human", stats: mine },
            ]
          : [
              { name: "P1", kind: "human", stats: mine },
              { name: "P2", kind: "human", stats: mine },
              { name: "P3", kind: "human", stats: mine },
              { name: "P4", kind: "human", stats: mine },
            ];
    const world = makeWorld({ seats: mode === "local4" ? 4 : 2, players });
    // boards of a match take turns to break
    const breaker = (matchRef.current.board - 1) % world.players.length;
    if (breaker) {
      world.turn = breaker;
      resetStriker(world, breaker);
    }
    worldRef.current = world;
    setPotted({ white: 0, black: 0 });
    setQueenText("in play");
    setPowerN(0.65);
    setTurnName(world.players[world.turn].name);
    aimRef.current = {
      dir: { ...minDirFor(world.turn, world.seats) },
      power: 0.65,
      valid: true,
    };
    const boardTag = formatRef.current === "match" ? `Board ${matchRef.current.board}. ` : "";
    setMessage(
      boardTag +
        (mode === "local4"
          ? "P1+P3 vs P2+P4. Break!"
          : mode === "local2"
            ? "Pass & play. Break!"
            : world.turn === 0
              ? "Break! Place, pull back, release."
              : "CPU breaks."),
    );
    setPhase(world.players[world.turn].kind === "cpu" ? "cpu" : "place");
  }

  /* ============ online wiring ============ */

  const netEvents = useCallback(
    () => ({
      onStatus: (status: NetStatus, note?: string) => {
        setNetStatus(status);
        setNetNote(note ?? null);
        // matched host: the room is open, send its code to the other player
        const m = hostMatchRef.current;
        const code = netRef.current?.roomCode;
        if (status === "lobby" && m && code) {
          hostMatchRef.current = null;
          lobbyRef.current?.sendGo(m, code);
        }
      },
      onRoster: (list: RosterEntry[], seats: Seats) => {
        setRoster(list);
        setRoomSeats(seats);
        const net = netRef.current;
        if (net?.isHostClient) {
          net.broadcastRoster(false);
          // matched game: start as soon as the other player is seated (the roster goes out first)
          if (autoStartRef.current && list.length >= seats) {
            autoStartRef.current = false;
            window.setTimeout(() => {
              if (netRef.current === net) startNetGameRef.current(seats);
            }, 400);
          }
        }
      },
      onStart: (cfg: { seats: Seats; players: Array<{ name: string; kind: "human" | "cpu" }> }) => {
        finishedRef.current = false;
        setReward(null);
        // a guest's seat comes from the host's roster (the host is always seat 0)
        if (modeRef.current === "join" && netRef.current) mySeatRef.current = netRef.current.mySeatIndex;
        // online: equal strikers for everyone, so upgrades never decide a match
        const players = cfg.players.map((p, i): { seat: number; name: string; kind: SeatKind; stats: StrikerStats } => ({
          seat: i,
          name: p.name,
          kind: mySeatRef.current === i ? "human" : p.kind === "cpu" ? "cpu" : "remote",
          stats: FAIR_STATS,
        }));
        matchRef.current = { white: 0, black: 0, board: 1 };
        tallyRef.current = { coins: 0, queen: false, combos: 0, streak: 0 };
        const world = makeWorld({ seats: cfg.seats, players });
        worldRef.current = world;
        setPotted({ white: 0, black: 0 });
        setQueenText("in play");
        setPowerN(0.65);
        setTurnName(world.players[0].name);
        aimRef.current = {
          dir: { ...minDirFor(0, world.seats) },
          power: 0.65,
          valid: true,
        };
        setMessage("Game on. Good luck!");
        setPhase("place");
      },
      onSnapshot: (snap: Snap) => {
        const world = worldRef.current;
        if (!world) return;
        applySnapshot(world, snap);
        setPotted({ white: world.potted.white.length, black: world.potted.black.length });
        setQueenText(queenTextOf(world));
        if (snap.winner) {
          const score = scoreForSeat(world, mySeatRef.current);
          setMessage("Match over.");
          setPhase("over");
          if (!finishedRef.current) {
            finishedRef.current = true;
            onFinish(score);
            tallyBoard(world);
            awardXp(world.players[mySeatRef.current]?.color === snap.winner);
          }
          return;
        }
        setTurnName(world.players[world.turn]?.name ?? "—");
        const kind = world.players[world.turn]?.kind;
        setPhase(kind === "human" ? "place" : "shooting");
      },
      onLive: (positions: LivePos[]) => {
        const world = worldRef.current;
        if (!world || phaseRef.current !== "shooting") return;
        applyLive(world, positions);
      },
      onMessage: (text: string) => setMessage(text),
    }),
    [onFinish, queenTextOf, setPhase, awardXp, tallyBoard],
  );

  /** `match`: an invite / random match — host for that player and start once they join. */
  function hostRoom(seats: Seats, match?: Matched) {
    carromAudio.unlock();
    netRef.current?.leave();
    finishedRef.current = false;
    setIsHost(true);
    modeRef.current = seats === 4 ? "host4" : "host2";
    mySeatRef.current = 0;
    hostMatchRef.current = match ?? null;
    autoStartRef.current = Boolean(match);
    setMatchWith(match ? { name: match.partnerName, role: "host" } : null);
    setPhase("net-lobby");
    setNetStatus("connecting");
    setNetNote(null);
    const net = CarromNet.createHost(match ? myName : "You", seats, netEvents());
    netRef.current = net;
    setRoomCode(net.roomCode);
  }

  /** `match`: joining the room of a player we matched with (code from them, not typed). */
  function joinRoom(match?: { m: Matched; code: string }) {
    carromAudio.unlock();
    netRef.current?.leave();
    finishedRef.current = false;
    setIsHost(false);
    modeRef.current = "join";
    hostMatchRef.current = null;
    autoStartRef.current = false;
    setMatchWith(match ? { name: match.m.partnerName, role: "guest" } : null);
    setPhase("net-lobby");
    setNetStatus("connecting");
    setNetNote(null);
    const net = CarromNet.createGuest(match ? myName : "You", match ? match.code : joinCode, netEvents());
    netRef.current = net;
    setRoomCode(net.roomCode);
  }

  function startNetGame(seatsOverride?: Seats) {
    const net = netRef.current;
    if (!net || !net.isHostClient) return;
    const seats = seatsOverride ?? roomSeats;
    const players: Array<{ name: string; kind: "human" | "cpu" }> = net.rosterList.map((entry) => ({
      name: entry.name,
      kind: "human",
    }));
    while (players.length < seats) players.push({ name: "CPU", kind: "cpu" });
    const cfg = { seats, players };
    net.broadcastStart(cfg);
    netEvents().onStart(cfg);
  }
  const startNetGameRef = useRef(startNetGame);
  startNetGameRef.current = startNetGame;

  /* ============ players online: invites + random match ============ */
  const meta = auth.user?.user_metadata ?? {};
  const myName = (
    (meta.full_name as string | undefined) ||
    (meta.name as string | undefined) ||
    auth.user?.email?.split("@")[0] ||
    "Player"
  ).slice(0, 40);
  const { choice: myAvatar } = useAvatar(auth.user);
  const [guestWait, setGuestWait] = useState<string | null>(null); // "joining X's table…"
  const [playersOpen, setPlayersOpen] = useState(false);
  const lobby = useCarromLobby({
    enabled: CarromNet.configured && Boolean(auth.user),
    userId: auth.user?.id ?? null,
    name: myName,
    avatar: myAvatar,
    available: screen === "menu",
    onMatched: (m) => {
      if (m.role === "host") {
        setGuestWait(null);
        hostRoom(2, m);
      } else {
        setGuestWait(m.partnerName);
      }
    },
    onGo: (m, code) => {
      setGuestWait(null);
      joinRoom({ m, code });
    },
  });
  lobbyRef.current = lobby;
  // the guest's wait ends with an error note if the host never sends the room
  useEffect(() => {
    if (lobby.note) setGuestWait(null);
  }, [lobby.note]);

  function leaveNet() {
    hostMatchRef.current = null;
    autoStartRef.current = false;
    setMatchWith(null);
    netRef.current?.leave();
    netRef.current = null;
    setRoomCode(null);
    setRoster([]);
    setNetStatus("idle");
    setNetNote(null);
    setPhase("menu");
    setMessage("Pick a mode.");
  }

  /* guest place/shot commands applied by the host */
  useEffect(() => {
    const net = netRef.current;
    if (!net || !net.isHostClient) return;
    net.onHostCommand({
      onPlace: (seat, t) => {
        const world = worldRef.current;
        if (!world || phaseRef.current !== "place" || world.turn !== seat) return;
        world.strikerT[seat] = t;
        resetStriker(world, seat);
      },
      onShot: (seat, t, dir, power) => {
        const world = worldRef.current;
        if (!world || phaseRef.current !== "place" || world.turn !== seat) return;
        world.strikerT[seat] = t;
        resetStriker(world, seat);
        if (shootStriker(world, dir, power)) {
          shotStartRef.current = performance.now();
          setPhase("shooting");
        }
      },
    });
    return () => net.onHostCommand({});
  }, [screen, setPhase]);

  /* ============ input ============ */

  const canControl = useCallback(() => {
    const world = worldRef.current;
    if (!world || phaseRef.current !== "place") return false;
    const kind = world.players[world.turn].kind;
    if (kind === "cpu" || kind === "remote") return false;
    if (modeRef.current.startsWith("host") && world.turn !== mySeatRef.current) return false;
    return true;
  }, []);

  /** Online: each player sees the board from their own seat (their baseline at the bottom). */
  const viewAngle = useCallback(() => {
    const world = worldRef.current;
    const online = modeRef.current === "join" || modeRef.current.startsWith("host");
    return world && online ? viewAngleFor(mySeatRef.current, world.seats) : 0;
  }, []);

  /** Screen point → board point (undoing the view rotation). */
  const toWorld = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const screen = {
      x: ((e.clientX - rect.left) / rect.width) * SIZE,
      y: ((e.clientY - rect.top) / rect.height) * SIZE,
    };
    return rotateAboutCentre(screen, -viewAngle());
  };

  /** Does moving the striker "right on screen" lower its baseline coordinate? (rotated views) */
  const placeFlipped = useCallback(() => {
    const world = worldRef.current;
    if (!world) return false;
    const bl = baselineFor(world.turn, world.seats);
    const along = bl.axis === "h" ? { x: 1, y: 0 } : { x: 0, y: 1 };
    const a = viewAngle();
    // on-screen direction of increasing t
    const sx = along.x * Math.cos(a) - along.y * Math.sin(a);
    const sy = along.x * Math.sin(a) + along.y * Math.cos(a);
    return bl.axis === "h" || a ? (Math.abs(sx) >= Math.abs(sy) ? sx < 0 : sy < 0) : false;
  }, [viewAngle]);

  /** Unit vector pointing into the board from the current seat. */
  const inwardOf = (world: World) => {
    const m = minDirFor(world.turn, world.seats);
    const l = Math.hypot(m.x, m.y) || 1;
    return { x: m.x / l, y: m.y / l };
  };

  function onPointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    carromAudio.unlock();
    if (!canControl()) return;
    // Press anywhere on the board, pull back away from your target, release to shoot.
    const p = toWorld(e);
    dragRef.current = { mode: "aim", ax: p.x, ay: p.y };
    aimRef.current.power = 0;
    aimRef.current.valid = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (!drag || phaseRef.current !== "place") return;
    const world = worldRef.current;
    if (!world) return;
    const p = toWorld(e);
    const dx = drag.ax - p.x;
    const dy = drag.ay - p.y;
    const pull = Math.hypot(dx, dy);
    if (pull > 20) {
      // Two ways to aim, both work: pull BACK away from the target (slingshot), or drag
      // TOWARDS it (point). A shot can never go backwards, so a pull that would aim back into
      // your own edge is read as pointing and flipped.
      let dir = { x: dx / pull, y: dy / pull };
      const inward = inwardOf(world);
      let flipped = false;
      if (dir.x * inward.x + dir.y * inward.y < 0.05 && -(dir.x * inward.x + dir.y * inward.y) > 0.05) {
        dir = { x: -dir.x, y: -dir.y };
        flipped = true;
      }
      // almost exactly sideways: tilt it just enough into the board
      const dot = dir.x * inward.x + dir.y * inward.y;
      if (dot < 0.08) {
        const nx = dir.x + inward.x * (0.08 - dot);
        const ny = dir.y + inward.y * (0.08 - dot);
        const nl = Math.hypot(nx, ny) || 1;
        dir = { x: nx / nl, y: ny / nl };
      }
      aimRef.current.dir = dir;
      aimRef.current.valid = true;
      aimRef.current.flipped = flipped;
      aimRef.current.power = clamp((pull - 30) / 380, 0.05, 1);
      setPowerN(aimRef.current.power);
    }
  }

  function onPointerUp() {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || phaseRef.current !== "place") return;
    const { dir, power, valid } = aimRef.current;
    if (power < 0.05) {
      setMessage("Drag to aim, then release.");
      return;
    }
    if (!valid) {
      aimRef.current.power = 0;
      setMessage("Aim into the board.");
      return;
    }
    fireRef.current(dir, power);
  }

  /** Move the striker along your baseline (slider, or A / D keys). */
  const moveStriker = useCallback(
    (t: number) => {
      const world = worldRef.current;
      if (!world || !canControl()) return;
      const bl = baselineFor(world.turn, world.seats);
      const c = clamp(t, bl.min, bl.max);
      placeStriker(world, world.turn, c);
      setPlaceT(c);
      const now = performance.now();
      if (now - lastScrapeRef.current > 70) {
        lastScrapeRef.current = now;
        carromAudio.scrape(world.striker.x);
      }
      if (netRef.current && modeRef.current === "join" && now - lastPlaceRef.current > 120) {
        lastPlaceRef.current = now;
        netRef.current.sendPlace(world.turn, c);
      }
    },
    [canControl],
  );

  /** Online guest: make sure the host gets the final striker position. */
  const commitPlace = useCallback(() => {
    const world = worldRef.current;
    if (world && netRef.current && modeRef.current === "join") {
      netRef.current.sendPlace(world.turn, world.strikerT[world.turn] ?? 500);
    }
  }, []);

  /* slider follows the striker whenever a turn starts; your-turn cue */
  useEffect(() => {
    const world = worldRef.current;
    if (!world || screen !== "place") return;
    setPlaceT(Math.round(world.strikerT[world.turn] ?? 500));
    if (canControl()) carromAudio.turn();
  }, [screen, turnName, canControl]);

  /* keyboard aiming */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (phaseRef.current !== "place" || !canControl()) return;
      const aim = aimRef.current;
      // While the striker slider has focus it keeps only its own movement keys (← → Home End …);
      // Space / Enter (shoot) and ↑ ↓ (power) still reach the game.
      const tgt = e.target as HTMLElement | null;
      const onSlider = tgt instanceof HTMLInputElement && tgt.type === "range";
      if (onSlider && !["ArrowUp", "ArrowDown", " ", "Enter"].includes(e.key)) return;
      if (e.key === "a" || e.key === "A" || e.key === "d" || e.key === "D") {
        const world = worldRef.current;
        if (!world) return;
        e.preventDefault();
        const step = (e.key.toLowerCase() === "a" ? -12 : 12) * (placeFlipped() ? -1 : 1);
        moveStriker((world.strikerT[world.turn] ?? 500) + step);
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const a = Math.atan2(aim.dir.y, aim.dir.x) + (e.key === "ArrowLeft" ? -0.035 : 0.035);
        aim.dir = { x: Math.cos(a), y: Math.sin(a) };
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        aim.power = clamp(aim.power + (e.key === "ArrowUp" ? 0.06 : -0.06), 0.05, 1);
        setPowerN(aim.power);
      } else if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        const world = worldRef.current;
        if (!world) return;
        const inward = minDirFor(world.turn, world.seats);
        if (aim.dir.x * inward.x + aim.dir.y * inward.y < 0) {
          aim.dir = { x: -aim.dir.x, y: -aim.dir.y };
        }
        aim.valid = true;
        fireRef.current(aim.dir, aim.power);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canControl, moveStriker, placeFlipped]);

  /* flip aim inward whenever the turn changes to a controllable seat */
  useEffect(() => {
    const world = worldRef.current;
    if (!world) return;
    const inward = minDirFor(world.turn, world.seats);
    if (aimRef.current.dir.x * inward.x + aimRef.current.dir.y * inward.y < 0) {
      aimRef.current.dir = { x: -aimRef.current.dir.x, y: -aimRef.current.dir.y };
    }
  }, [screen]);

  /* ============ drawing ============ */

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const world = worldRef.current;
    if (!canvas || !world) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const scale = canvas.width / SIZE;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = "#120a05";
    ctx.fillRect(0, 0, SIZE, SIZE);
    // online: turn the whole board so your own baseline is at the bottom
    const view = viewAngle();
    setViewAngle(view);
    if (view) {
      ctx.translate(SIZE / 2, SIZE / 2);
      ctx.rotate(view);
      ctx.translate(-SIZE / 2, -SIZE / 2);
    }
    ctx.save();
    fxRef.current.applyShake(ctx, frameDtRef.current);

    const p = progRef.current;
    const coinSet = p.coinSet;
    // Your chosen striker on your own turns (all local humans share this device); classic for CPU / remote players.
    const turnKind = world.players[world.turn]?.kind;
    const mine =
      turnKind === "human" &&
      (modeRef.current === "local2" || modeRef.current === "local4" || world.turn === mySeatRef.current);
    const skin: StrikerSkin = mine ? p.striker : STRIKERS[0];
    const turnStats = world.players[world.turn]?.stats;
    // upgrade tier effects only for your own striker
    strikerTierRef.current = mine && turnStats ? tierOf(turnStats) : 0;
    strikerGlowRef.current = skin.glow;

    drawBoard(ctx, p.board);
    const ph = phaseRef.current;
    if (ph === "place" && canControl()) {
      drawBaselineGlow(ctx, world, world.turn);
    }

    fxRef.current.drawUnder(ctx, frameDtRef.current);
    drawSinks(ctx, world, coinSet, skin);
    for (const d of world.discs) {
      if (!d.alive || d.kind === "striker") continue;
      drawCoin(ctx, d, coinSet);
    }

    const aim = aimRef.current;
    if (ph === "place" && canControl() && aim.power > 0.03) {
      drawAimPreview(ctx, world, aim.dir, aim.power, turnStats?.aim ?? 1, aim.valid);
      if (dragRef.current && !aim.flipped) drawPullBand(ctx, world.striker, aim.dir, aim.power, aim.valid);
    }
    if (ph === "cpu-aim" && cpuPlanRef.current) {
      drawAim(ctx, world.striker, cpuPlanRef.current.dir, cpuPlanRef.current.power, "rgba(180,50,40,0.85)");
    }

    if (world.striker.alive) {
      const aiming = ph === "place" && canControl();
      const pulse = aiming ? 0.5 + 0.5 * Math.sin(performance.now() / 280) : 0;
      // while you pull back to aim, the striker visibly cocks backwards
      const pull = aiming && dragRef.current?.mode === "aim" ? aim.power : 0;
      const cpuPull = ph === "cpu-aim" && cpuPlanRef.current ? cpuPlanRef.current.power : 0;
      drawStriker(
        ctx,
        world.striker,
        skin,
        seatRingColor(world.turn),
        pulse,
        ph === "place" || ph === "cpu-aim",
        pull || cpuPull,
        ph === "cpu-aim" && cpuPlanRef.current ? cpuPlanRef.current.dir : aim.dir,
        strikerTierRef.current,
      );
      if (ph === "place" && deadlineRef.current > 0) {
        drawTurnTimer(ctx, world.striker, (deadlineRef.current - performance.now()) / TURN_MS);
      }
    }
    fxRef.current.draw(ctx, frameDtRef.current);
    ctx.restore();
    const mySeat =
      modeRef.current === "join" || modeRef.current.startsWith("host") ? mySeatRef.current : null;
    drawSeatLabels(ctx, world, mySeat);
  }, [canControl, viewAngle]);

  useEffect(() => {
    drawRef.current = draw;
  }, [draw]);

  useEffect(() => () => netRef.current?.leave(), []);

  /* ============ UI ============ */

  if (screen === "menu" || screen === "join-form") {
    return (
      <div className="game-surface carrom-surface">
        {screen === "join-form" ? <p className="game-status">Join with a 4-character room code</p> : null}
        {screen === "menu" ? (
          <>
            {/* the board first, ready to play; the choices sit underneath it */}
            <BoardPreview />
            <div className="carrom-start">
              <button type="button" className="carrom-start-main" onClick={() => startLocal("cpu")}>
                <span className="carrom-start-play" aria-hidden="true">
                  ▶
                </span>
                Play vs CPU
              </button>

              <div className="carrom-format" role="radiogroup" aria-label="Match length">
                <button type="button" role="radio" aria-checked={format === "board"} className={format === "board" ? "on" : ""} onClick={() => setFormat("board")}>
                  Quick · 1 board
                </button>
                <button type="button" role="radio" aria-checked={format === "match"} className={format === "match" ? "on" : ""} onClick={() => setFormat("match")}>
                  Match · to {MATCH_TARGET}
                </button>
              </div>

              <div className="carrom-start-more" aria-label="More ways to play">
                <button type="button" className="carrom-chip-btn" onClick={() => startLocal("local2")}>
                  2P · same device
                </button>
                <button type="button" className="carrom-chip-btn" onClick={() => startLocal("local4")}>
                  4P · teams
                </button>
                <button
                  type="button"
                  className={`carrom-chip-btn${onlineOpen ? " on" : ""}`}
                  aria-expanded={onlineOpen}
                  disabled={!CarromNet.configured}
                  title={CarromNet.configured ? "Play online" : "Online play needs Supabase"}
                  onClick={() => setOnlineOpen((o) => !o)}
                >
                  Online {onlineOpen ? "▴" : "▾"}
                </button>
              </div>
              {onlineOpen ? (
                <>
                  <div className="carrom-start-more is-online">
                    <button
                      type="button"
                      className={`carrom-chip-btn carrom-chip-accent${lobby.searching ? " on" : ""}`}
                      disabled={!auth.user || !lobby.connected || Boolean(guestWait)}
                      onClick={() => (lobby.searching ? lobby.cancelSearch() : lobby.findMatch())}
                    >
                      {lobby.searching ? "Cancel search" : "Find match"}
                    </button>
                    <button
                      type="button"
                      className={`carrom-chip-btn${playersOpen ? " on" : ""}`}
                      aria-expanded={playersOpen}
                      disabled={!auth.user || !lobby.connected}
                      onClick={() => setPlayersOpen((o) => !o)}
                    >
                      Players online{lobby.connected ? ` · ${lobby.players.length}` : ""}
                    </button>
                    <button type="button" className="carrom-chip-btn" onClick={() => hostRoom(2)}>
                      Host · 2P
                    </button>
                    <button type="button" className="carrom-chip-btn" onClick={() => hostRoom(4)}>
                      Host · 4P
                    </button>
                    <button type="button" className="carrom-chip-btn" onClick={() => setPhase("join-form")}>
                      Join a room
                    </button>
                  </div>

                  {!auth.user ? (
                    <p className="carrom-mm-hint">
                      <a href={`/login?next=${encodeURIComponent(window.location.pathname)}`}>Sign in</a> to find a match or
                      invite players online.
                    </p>
                  ) : !lobby.connected ? (
                    <p className="carrom-mm-hint">Connecting to players online…</p>
                  ) : null}

                  {lobby.searching ? (
                    <div className="carrom-mm-card carrom-mm-search" role="status">
                      <span className="carrom-mm-spinner" aria-hidden="true" />
                      <span>
                        Finding an opponent… <SearchClock since={lobby.searchSince} />
                      </span>
                    </div>
                  ) : null}

                  {playersOpen && lobby.connected ? (
                    <div className="carrom-mm-card">
                      {lobby.players.length === 0 ? (
                        <p className="carrom-mm-empty">No one else is free right now. Try Find match and wait, or check back soon.</p>
                      ) : (
                        <ul className="carrom-mm-list">
                          {lobby.players.map((p) => {
                            const pending = lobby.outgoing?.to === p.key;
                            return (
                              <li key={p.key}>
                                <PlayerAvatar id={p.userId} name={p.name} avatar={p.avatar} size={30} className="lb-initial carrom-mm-av" />
                                <span className="carrom-mm-name">
                                  <b>{p.name}</b>
                                  <small>{p.status === "searching" ? "looking for a match" : "available"}</small>
                                </span>
                                {pending ? (
                                  <button type="button" className="carrom-chip-btn" onClick={lobby.cancelInvite}>
                                    Waiting… · Cancel
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    className="carrom-chip-btn carrom-chip-accent"
                                    disabled={Boolean(guestWait)}
                                    onClick={() => lobby.invite(p)}
                                  >
                                    Invite
                                  </button>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  ) : null}
                </>
              ) : null}

              {/* invites reach you anywhere on this menu, even with the Online options closed */}
              {lobby.incoming.map((inv) => (
                <div key={inv.id} className="carrom-mm-card carrom-mm-invite" role="alert">
                  <PlayerAvatar id={inv.from} name={inv.name} avatar={inv.avatar} size={34} className="lb-initial carrom-mm-av" />
                  <span className="carrom-mm-name">
                    <b>{inv.name}</b>
                    <small>wants to play carrom</small>
                  </span>
                  <button type="button" className="carrom-chip-btn carrom-chip-accent" onClick={() => lobby.accept(inv)}>
                    Accept
                  </button>
                  <button type="button" className="carrom-chip-btn" onClick={() => lobby.decline(inv)}>
                    Decline
                  </button>
                </div>
              ))}
              {guestWait ? (
                <div className="carrom-mm-card carrom-mm-search" role="status">
                  <span className="carrom-mm-spinner" aria-hidden="true" />
                  <span>Match found! Joining {guestWait}&rsquo;s table…</span>
                </div>
              ) : null}
              {lobby.note ? (
                <p className="carrom-mm-hint" role="status">
                  {lobby.note}{" "}
                  <button type="button" className="carrom-mm-dismiss" onClick={lobby.clearNote} aria-label="Dismiss">
                    ✕
                  </button>
                </p>
              ) : null}

              <button type="button" className="carrom-profile carrom-start-profile" onClick={() => setPhase("locker")}>
                <LevelBar level={prog.level} xp={prog.xp} pro={prog.pro} compact />
                <span className="carrom-profile-cta">Locker & shop ›</span>
              </button>
            </div>
          </>
        ) : (
          <form
            className="carrom-join"
            onSubmit={(e) => {
              e.preventDefault();
              joinRoom();
            }}
          >
            <input
              className="carrom-code-input"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, 4))}
              placeholder="CODE"
              maxLength={4}
              autoCapitalize="characters"
              autoComplete="off"
            />
            <button type="submit" className="primary-btn" disabled={joinCode.length !== 4}>
              Join
            </button>
            <button type="button" className="ghost-btn" onClick={() => setPhase("menu")}>
              Back
            </button>
          </form>
        )}
      </div>
    );
  }

  if (screen === "locker") {
    return (
      <div className="game-surface carrom-surface">
        <CarromLocker prog={prog} signedIn={Boolean(auth.user)} onBack={() => setPhase("menu")} />
      </div>
    );
  }

  if (screen === "net-lobby") {
    return (
      <div className="game-surface carrom-surface">
        <p className="game-status">
          {netStatus === "connecting"
            ? "Connecting…"
            : netStatus === "error"
              ? (netNote ?? "Connection error")
              : "Room lobby"}
        </p>
        {netStatus === "lobby" ? (
          <div className="carrom-lobby">
            <div className="carrom-code-box">
              <span className="carrom-code">{roomCode}</span>
              <span className="carrom-code-hint">share this code</span>
            </div>
            <ul className="carrom-roster">
              {roster.map((entry) => (
                <li key={entry.clientId}>
                  <span className="dot" style={{ background: seatRingColor(entry.seat) }} />
                  Seat {entry.seat + 1} · {entry.name}
                  {entry.isHost ? " (host)" : ""}
                </li>
              ))}
              {Array.from({ length: Math.max(0, roomSeats - roster.length) }).map((_, i) => (
                <li key={`empty-${i}`} className="empty">
                  Seat {roster.length + i + 1} · waiting…
                </li>
              ))}
            </ul>
            {matchWith ? (
              <p className="carrom-hint">
                {roster.length >= roomSeats
                  ? "Starting…"
                  : matchWith.role === "host"
                    ? `Waiting for ${matchWith.name} to join…`
                    : "Waiting for the game to start…"}
              </p>
            ) : isHost ? (
              <button type="button" className="primary-btn" onClick={() => startNetGame()}>
                Start game
                {roomSeats - roster.length > 0
                  ? ` (${roomSeats - roster.length} CPU fill${roomSeats - roster.length > 1 ? "s" : ""})`
                  : ""}
              </button>
            ) : (
              <p className="carrom-hint">Waiting for the host to start…</p>
            )}
          </div>
        ) : null}
        <button type="button" className="ghost-btn" onClick={leaveNet}>
          {netStatus === "error" ? "Back to menu" : "Leave room"}
        </button>
      </div>
    );
  }

  const world = worldRef.current;
  if (!world) {
    return (
      <div className="game-surface carrom-surface">
        <p className="game-status">Loading…</p>
      </div>
    );
  }

  const isOnline = modeRef.current.startsWith("host") || modeRef.current === "join";

  return (
    <div className="game-surface carrom-surface">
      <div className="carrom-hud">
        <div className={`carrom-chip${world.turn % 2 === 0 ? " active" : ""}`}>
          <span className="dot" style={{ background: seatRingColor(0) }} />
          White <b>{potted.white}</b>
          <small>/9</small>
        </div>
        <div className="carrom-chip queen-chip" title="The queen must be covered by a coin">
          <span className="qdot">Q</span>
          {queenText}
        </div>
        <div className={`carrom-chip${world.turn % 2 === 1 ? " active" : ""}`}>
          <span className="dot" style={{ background: seatRingColor(1) }} />
          Black <b>{potted.black}</b>
          <small>/9</small>
        </div>
      </div>

      {format === "match" && LOCAL_MODES.includes(modeRef.current) ? (
        <p className="carrom-matchbar" aria-label="Match score">
          <span>Board {matchScore.board}</span>
          <b>
            White {matchScore.white} – {matchScore.black} Black
          </b>
          <span>to {MATCH_TARGET}</span>
        </p>
      ) : null}

      <div className="carrom-statusrow">
        {(() => {
          const line =
            screen === "over" ? message : `${turnName === "You" ? "Your" : `${turnName}'s`} turn · ${message}`;
          return (
            <p className="game-status carrom-status-line" title={line} aria-live="polite">
              {line}
            </p>
          );
        })()}
        {screen === "place" ? (
          <span
            className={`carrom-timer${secsLeft <= 5 ? " warn" : ""}`}
            role="timer"
            aria-label={`${secsLeft} seconds left`}
            style={{ "--left": secsLeft / TURN_SECONDS } as React.CSSProperties}
          >
            <i aria-hidden="true" />
            {secsLeft}s
          </span>
        ) : null}
        <button
          type="button"
          className="carrom-mute"
          aria-pressed={muted}
          aria-label={muted ? "Turn sound on" : "Mute sound"}
          title={muted ? "Sound off" : "Sound on"}
          onClick={() => {
            carromAudio.unlock();
            carromAudio.setMuted(!muted);
            setMuted(!muted);
          }}
        >
          {muted ? "🔇" : "🔊"}
        </button>
      </div>

      {screen === "over" && reward ? (
        <div className="carrom-reward" role="status">
          <b>+{reward.xp} XP</b>
          {reward.combos > 0 ? <span className="carrom-combo">Combo bonus ×{reward.combos}</span> : null}
          {reward.after > reward.before ? <span className="carrom-levelup">Level up! Level {reward.after}</span> : null}
          <LevelBar level={prog.level} xp={prog.xp} pro={prog.pro} />
        </div>
      ) : null}

      <div className="carrom-stage">
        <canvas
          ref={canvasRef}
          width={1080}
          height={1080}
          aria-label="Carrom board"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      </div>

      {(() => {
        const bl = baselineFor(world.turn, world.seats);
        const controllable = screen === "place" && canControl();
        // rotated (online) view: your baseline is horizontal on screen; keep the slider matching it
        const horizontal = bl.axis === "h" || viewAngle() !== 0;
        const flip = placeFlipped();
        const toSlider = (t: number) => (flip ? bl.min + bl.max - t : t);
        return (
          <label className={`carrom-place${controllable ? "" : " is-off"}`}>
            <span className="carrom-place-end" aria-hidden="true">
              {horizontal ? "◀" : "▲"}
            </span>
            <input
              type="range"
              min={bl.min}
              max={bl.max}
              step={1}
              value={toSlider(placeT)}
              disabled={!controllable}
              aria-label="Striker position on your baseline"
              onChange={(e) => moveStriker(toSlider(Number(e.target.value)))}
              onPointerDown={() => carromAudio.unlock()}
              onPointerUp={(e) => {
                commitPlace();
                // hand the keyboard back to the game (arrows aim, Space shoots)
                e.currentTarget.blur();
              }}
              onKeyUp={commitPlace}
            />
            <span className="carrom-place-end" aria-hidden="true">
              {horizontal ? "▶" : "▼"}
            </span>
          </label>
        );
      })()}

      <div className="carrom-power">
        <div className="carrom-power-fill" style={{ width: `${Math.round(powerN * 100)}%` }} />
      </div>

      {screen === "over" ? (
        <button
          type="button"
          className="primary-btn"
          onClick={() => {
            if (isOnline) {
              leaveNet();
            } else {
              startLocal(modeRef.current as "cpu" | "local2" | "local4", Boolean(between));
            }
          }}
        >
          {isOnline ? "Back to menu" : between ? `Next board (${matchScore.board + 1})` : "Play again"}
        </button>
      ) : null}
      {screen === "over" ? (
        <button
          type="button"
          className="ghost-btn"
          onClick={() => (isOnline ? leaveNet() : between ? startLocal(modeRef.current as "cpu" | "local2" | "local4") : setPhase("locker"))}
        >
          {isOnline ? "Leave" : between ? "Restart match" : "Locker & shop"}
        </button>
      ) : (
        <button
          type="button"
          className="ghost-btn"
          onClick={() => {
            if (isOnline) leaveNet();
            else startLocal(modeRef.current as "cpu" | "local2" | "local4");
          }}
        >
          {isOnline ? "Leave match" : "Restart"}
        </button>
      )}

      <p className="carrom-hint">
        Slide to place the striker (or A / D) · drag on the board to aim (pull back like a slingshot, or point
        where you want it to go) · release to shoot · {TURN_SECONDS}s per turn · arrow keys fine-tune, space shoots
      </p>
    </div>
  );
}

/** Seconds spent searching, as m:ss. */
function SearchClock({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const secs = Math.max(0, Math.floor((now - since) / 1000));
  return (
    <span className="carrom-mm-clock">
      {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}
    </span>
  );
}
