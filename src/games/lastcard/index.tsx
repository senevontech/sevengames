/* One Card: match the colour or the symbol, use the action cards, play your last card first.
   Modes: vs Senevi (1–3 CPU), same device (2–4 players passing one phone), and online rooms
   (online.tsx, server-dealt). House rules in a settings card. No chips: XP and a level. */
import { useCallback, useEffect, useRef, useState } from "react";
import { Globe, ListChecks, LogOut, RotateCcw, Users } from "lucide-react";
import type { GameProps } from "../index";
import { senevi, SeneviFace, SeneviIcon, SeneviLine, SENEVI_NAME } from "../../senevi/Senevi";
import { useAuthContext } from "../../context/AuthContext";
import { useShop } from "../../lib/shop";
import { levelForXp, xpForLevel } from "../../lib/shopCatalog";
import PlayFlow from "../PlayFlow";
import ChipLine from "../../components/ChipLine";
import {
  DEFAULT_RULES,
  REV,
  SKIP,
  W4,
  callLast,
  canJump,
  cardOf,
  cpuMove,
  drawCard,
  newGame,
  nextSeat,
  pass,
  play,
  playable,
  scoreFor,
  topCard,
  type LCState,
  type Rules,
} from "./engine";
import { LCCard, LCDefs } from "./LCCard";
import { ColorPicker, LCTable, SwapPicker, type SeatInfo } from "./Table";
import { OnlineLobby, OnlineRoom, type LCView } from "./online";
import "./lastcard.css";

type Mode = "cpu" | "pass";
type Prefs = { opponents: number; players: number; rules: Rules };
const PREFS_KEY = "senevon:lastcard:prefs";
function readPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") as Partial<Prefs>;
    return {
      opponents: Math.min(3, Math.max(1, Number(p.opponents) || 3)),
      players: Math.min(4, Math.max(2, Number(p.players) || 2)),
      rules: { ...DEFAULT_RULES, ...(p.rules ?? {}) },
    };
  } catch {
    return { opponents: 3, players: 2, rules: DEFAULT_RULES };
  }
}

const CPU_MS = 850;
const JUMP_MS = 420;
const seneviSeat = (i: number) => `lc${i}`;
const XP_WIN = 40;
const XP_PLAY = 10;

/* ---------------- house rules (settings card) ---------------- */
const RULE_TEXT: { key: keyof Rules; label: string; blurb: string }[] = [
  { key: "stack", label: "Stack +2 / +4", blurb: "Answer a +2 with a +2 (or a +4) to pass the pile on." },
  { key: "sevenZero", label: "7 swaps · 0 passes", blurb: "A 7 swaps your hand with someone; a 0 passes every hand along." },
  { key: "jumpIn", label: "Jump-in", blurb: "Play an identical card out of turn (vs Senevi)." },
  { key: "drawUntil", label: "Draw until you can play", blurb: "Keep drawing instead of drawing one card." },
];

function RulesCard({ rules, set, allowJump }: { rules: Rules; set: (r: Rules) => void; allowJump: boolean }) {
  return (
    <div className="lc-rules">
      {RULE_TEXT.filter((r) => allowJump || r.key !== "jumpIn").map((r) => (
        <label key={r.key} className="lc-toggle">
          <input type="checkbox" checked={rules[r.key]} onChange={(e) => set({ ...rules, [r.key]: e.target.checked })} />
          <span>
            <b>{r.label}</b>
            <small>{r.blurb}</small>
          </span>
        </label>
      ))}
    </div>
  );
}

/* =================================================================== */
export default function LastCardGame(_props: GameProps) {
  const { user } = useAuthContext();
  const shop = useShop();
  const [prefs, setPrefsState] = useState<Prefs>(readPrefs);
  const setPrefs = (p: Partial<Prefs>) =>
    setPrefsState((cur) => {
      const next = { ...cur, ...p };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        /* not remembered */
      }
      return next;
    });
  const [screen, setScreen] = useState<"menu" | "local" | "online">("menu");
  const [mode, setMode] = useState<Mode>("cpu");
  const [online, setOnline] = useState<LCView | null>(null);
  const [round, setRound] = useState(0);

  const xp = shop.xpOf("lastcard");
  const level = levelForXp(xp);

  const startLocal = (m: Mode) => {
    setMode(m);
    setRound((r) => r + 1);
    setScreen("local");
  };

  if (screen === "online" && online) {
    return (
      <div className="game-surface lc-surface">
        <OnlineRoom
          initial={online}
          onLeave={() => {
            setOnline(null);
            setScreen("menu");
          }}
        />
      </div>
    );
  }

  if (screen === "local") {
    const n = mode === "cpu" ? prefs.opponents + 1 : prefs.players;
    return (
      <div className="game-surface lc-surface">
        <LocalGame
          key={round}
          mode={mode}
          n={n}
          rules={mode === "pass" ? { ...prefs.rules, jumpIn: false } : prefs.rules}
          onExit={() => setScreen("menu")}
          onAgain={() => setRound((r) => r + 1)}
          awardXp={user ? (amount) => void shop.awardXp("lastcard", amount) : null}
        />
      </div>
    );
  }

  return (
    <div className="game-surface lc-surface">
      <LCDefs />
      <PlayFlow
        id="lastcard"
        preview={
          <div className="pf-preview lc-preview" inert>
            {[3, 47, 100, 61, 104].map((c, i) => (
              <span key={c} style={{ ["--i" as string]: i - 2 }}>
                <LCCard card={c} />
              </span>
            ))}
          </div>
        }
        corner={
          // the big faded title over the cards, with the player's level under it
          <div className="lc-title" title={user ? `${xp} XP` : undefined}>
            <b>One Card</b>
            {user ? (
              <>
                <span>Level {level}</span>
                <i>
                  <i style={{ width: `${((xp - xpForLevel(level)) / (xpForLevel(level + 1) - xpForLevel(level))) * 100}%` }} />
                </i>
              </>
            ) : null}
          </div>
        }
        modes={[
          {
            key: "cpu",
            label: `vs ${SENEVI_NAME}`,
            icon: <SeneviIcon size={17} />,
            chips: <ChipLine kind="free" note={`Free · ${prefs.opponents} ${SENEVI_NAME} opponent${prefs.opponents === 1 ? "" : "s"} · XP for a win`} />,
            start: () => startLocal("cpu"),
            settings: (
              <div className="ol-card lc-settings">
                <p className="ol-sub">Opponents</p>
                <div className="lc-seg" role="radiogroup" aria-label="Opponents">
                  {[1, 2, 3].map((k) => (
                    <button key={k} type="button" role="radio" aria-checked={prefs.opponents === k} className={prefs.opponents === k ? "active" : ""} onClick={() => setPrefs({ opponents: k })}>
                      {k}
                    </button>
                  ))}
                </div>
                <p className="ol-sub">House rules</p>
                <RulesCard rules={prefs.rules} set={(rules) => setPrefs({ rules })} allowJump />
              </div>
            ),
          },
          {
            key: "pass",
            label: "Same device",
            icon: <Users size={15} />,
            chips: <ChipLine kind="free" note={`Free · ${prefs.players} players pass one device`} />,
            start: () => startLocal("pass"),
            settings: (
              <div className="ol-card lc-settings">
                <p className="ol-sub">Players</p>
                <div className="lc-seg" role="radiogroup" aria-label="Players">
                  {[2, 3, 4].map((k) => (
                    <button key={k} type="button" role="radio" aria-checked={prefs.players === k} className={prefs.players === k ? "active" : ""} onClick={() => setPrefs({ players: k })}>
                      {k}
                    </button>
                  ))}
                </div>
                <p className="ol-sub">House rules</p>
                <RulesCard rules={prefs.rules} set={(rules) => setPrefs({ rules })} allowJump={false} />
              </div>
            ),
          },
          {
            key: "online",
            label: "Online",
            icon: <Globe size={15} />,
            chips: <ChipLine kind="free" note="Free · 2–4 players · XP for every game" />,
            panel: (
              <OnlineLobby
                rules={prefs.rules}
                onSeated={(v) => {
                  setOnline(v);
                  setScreen("online");
                }}
              />
            ),
          },
        ]}
      />
    </div>
  );
}

/* ---------------- a game on this device ---------------- */
function LocalGame({ mode, n, rules, onExit, onAgain, awardXp }: { mode: Mode; n: number; rules: Rules; onExit: () => void; onAgain: () => void; awardXp: ((amount: number) => void) | null }) {
  const [s, setS] = useState<LCState>(() => newGame(n, rules, Math.floor(Math.random() * n)));
  const [pick, setPick] = useState<null | { card: number; step: "color" | "swap"; color?: number; seat: number }>(null);
  const [cover, setCover] = useState<number | null>(mode === "pass" ? s.turn : null); // same device: whose turn is hidden
  const [toast, setToast] = useState<string | null>(null);
  const isCpu = (seat: number) => mode === "cpu" && seat !== 0;
  const names = Array.from({ length: n }, (_, i) => (mode === "cpu" ? (i === 0 ? "You" : n > 2 ? `${SENEVI_NAME} ${i}` : SENEVI_NAME) : `Player ${i + 1}`));
  const viewer = mode === "cpu" ? 0 : s.turn;
  const sRef = useRef(s);
  sRef.current = s;

  const flash = useCallback((t: string) => {
    setToast(t);
    window.setTimeout(() => setToast((x) => (x === t ? null : x)), 1800);
  }, []);

  // say what happened (and let Senevi react)
  const prevSeq = useRef(s.seq);
  useEffect(() => {
    if (s.seq === prevSeq.current) return;
    prevSeq.current = s.seq;
    const a = s.last;
    if (!a) return;
    if (a.kind === "play" || a.kind === "jump") {
      const k = cardOf(a.card!);
      const who = names[a.seat];
      const victim = names[nextSeat(s, a.seat)];
      if (a.kind === "jump") flash(`${who} jumped in!`);
      if (a.count) flash(`${who} forgot “One card!”: +2`);
      else if (k.v === SKIP) flash(victim === "You" ? "You're skipped" : `${victim} is skipped`);
      else if (k.v === REV && n > 2) flash("Reverse!");
      else if (s.rules.sevenZero && k.v === 7 && a.target !== undefined) flash(`${who} swapped hands with ${names[a.target] === "You" ? "you" : names[a.target]}`);
      else if (s.rules.sevenZero && k.v === 0) flash("Every hand moves on!");
      if (mode === "cpu" && (k.v >= SKIP || k.v === W4)) {
        if (a.seat !== 0) senevi({ type: "cpuGood" }, seneviSeat(a.seat));
        else senevi({ type: "playerGood" });
      }
    } else if (a.kind === "draw" || a.kind === "penalty") {
      if (a.kind === "penalty") flash(`${names[a.seat]} ${names[a.seat] === "You" ? "take" : "takes"} ${a.count}`);
    }
    if (s.phase === "over") {
      if (mode === "cpu") {
        for (let i = 1; i < n; i++) senevi({ type: "over", result: s.winner === 0 ? "player" : s.winner === i ? "cpu" : "draw" }, seneviSeat(i));
        awardXp?.(s.winner === 0 ? XP_WIN : XP_PLAY);
      }
    }
    // same device: hide the hand until the next player is ready
    if (mode === "pass" && s.phase === "play" && a.seat !== s.turn) setCover(s.turn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.seq]);

  useEffect(() => {
    if (mode === "cpu") window.setTimeout(() => senevi({ type: "start" }), 600);
  }, [mode]);

  // Senevi plays (and, with jump-in, sometimes jumps in)
  useEffect(() => {
    if (s.phase !== "play" || pick) return;
    if (mode === "cpu" && s.rules.jumpIn) {
      for (let p = 1; p < n; p++) {
        if (p === s.turn) continue;
        const card = s.hands[p].find((c) => canJump(s, p, c));
        if (card !== undefined && Math.random() < 0.45) {
          const id = window.setTimeout(() => setS((cur) => (cur.seq === s.seq ? play(cur, p, card) : cur)), JUMP_MS);
          return () => window.clearTimeout(id);
        }
      }
    }
    if (!isCpu(s.turn)) return;
    senevi({ type: "think", ms: CPU_MS }, seneviSeat(s.turn));
    const id = window.setTimeout(() => {
      setS((cur) => {
        if (cur.seq !== s.seq || cur.phase !== "play") return cur;
        const seat = cur.turn;
        const mv = cpuMove(cur, seat);
        if (mv.kind === "play") return play(mv.callLast ? callLast(cur, seat) : cur, seat, mv.card, { color: mv.color, target: mv.target });
        if (mv.kind === "draw") return drawCard(cur, seat);
        return pass(cur, seat);
      });
    }, CPU_MS + (s.drawn !== null ? -300 : 0));
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.seq, pick]);

  const human = (seat: number) => !isCpu(seat);
  const myTurn = s.phase === "play" && s.turn === viewer && human(viewer) && cover === null;
  const playableIds = myTurn ? playable(s, viewer) : [];
  const jumpIds = mode === "cpu" && s.rules.jumpIn && cover === null ? s.hands[0].filter((c) => canJump(s, 0, c)) : [];

  const doPlay = (seat: number, card: number, color?: number, target?: number) => {
    setPick(null);
    setS((cur) => play(cur, seat, card, { color, target }));
  };
  const onPlay = (card: number) => {
    const seat = jumpIds.includes(card) ? 0 : viewer;
    if (!playableIds.includes(card) && !jumpIds.includes(card)) return;
    const k = cardOf(card);
    if (k.c === 4) return setPick({ card, step: "color", seat });
    if (s.rules.sevenZero && k.v === 7 && n > 2) return setPick({ card, step: "swap", seat });
    doPlay(seat, card);
  };

  const seats: SeatInfo[] = names.map((name, i) => ({
    name: mode === "pass" && i === viewer ? `${name} (you)` : name,
    count: s.hands[i].length,
    called: s.called[i],
    face: isCpu(i) ? <SeneviFace size={30} seat={seneviSeat(i)} className="lc-senevi" /> : undefined,
  }));

  const turnName = names[s.turn];
  const status =
    s.phase === "over"
      ? s.winner === viewer && mode === "cpu"
        ? "You win!"
        : `${names[s.winner!]} wins!`
      : cover !== null
        ? `${names[cover]}'s turn`
        : myTurn
          ? s.pending
            ? `+${s.pending} coming: stack a +2/+4 or take ${s.pending}`
            : s.drawn !== null
              ? "Play the card you drew, or keep it"
              : "Your turn: match the colour or the symbol"
          : jumpIds.length
            ? "Jump in! You hold the same card"
            : `${turnName} is playing…`;

  const winnerName = s.winner === null ? "" : mode === "cpu" && s.winner === 0 ? "You" : names[s.winner];
  const top = topCard(s);

  return (
    <div className="lc-room">
      <LCTable
        seats={seats}
        me={viewer}
        hand={s.hands[viewer]}
        turn={s.turn}
        dir={s.dir}
        top={top}
        under={s.discard.slice(-3, -1)}
        color={s.color}
        pending={s.pending}
        drawPile={s.draw.length}
        over={s.phase === "over"}
        winner={mode === "pass" ? viewer : s.winner}
        last={s.last}
        seq={s.seq}
        playableIds={playableIds}
        jumpIds={jumpIds}
        canDraw={myTurn && s.drawn === null}
        canPass={myTurn && s.drawn !== null}
        canCall={myTurn && s.hands[viewer].length === 2 && !s.called[viewer]}
        called={s.called[viewer]}
        status={status}
        hidden={cover !== null}
        onPlay={onPlay}
        onDraw={() => setS((cur) => drawCard(cur, viewer))}
        onPass={() => setS((cur) => pass(cur, viewer))}
        onCall={() => {
          setS((cur) => callLast(cur, viewer));
          flash("One card!");
        }}
        top_left={
          <button type="button" className="lc-pill" onClick={onExit}>
            <LogOut size={14} /> Menu
          </button>
        }
        top_right={
          <span className="lc-pill" title="House rules">
            <ListChecks size={14} /> {[rules.stack ? "Stack" : null, rules.sevenZero ? "7-0" : null, rules.jumpIn ? "Jump-in" : null, rules.drawUntil ? "Draw until" : null].filter(Boolean).join(" · ") || "Classic"}
          </span>
        }
        overlay={
          <>
            {mode === "cpu" ? (
              <div className="lc-lines">
                {Array.from({ length: n - 1 }, (_, k) => (
                  <SeneviLine key={k} seat={seneviSeat(k + 1)} className="lc-line" />
                ))}
              </div>
            ) : null}
            {toast ? <p className="lc-toast">{toast}</p> : null}
            {pick?.step === "color" ? (
              <ColorPicker onPick={(c) => doPlay(pick.seat, pick.card, c)} onCancel={() => setPick(null)} />
            ) : null}
            {pick?.step === "swap" ? <SwapPicker seats={seats} me={pick.seat} onPick={(t) => doPlay(pick.seat, pick.card, undefined, t)} onCancel={() => setPick(null)} /> : null}
            {cover !== null && s.phase === "play" ? (
              <div className="lc-overlay lc-cover" role="dialog" aria-label="Pass the device">
                <div className="lc-panel">
                  <h3>{names[cover]}</h3>
                  <p className="lc-sub">Pass the device to {names[cover]}. Everyone else, look away!</p>
                  <button type="button" className="lc-btn lc-btn-main" onClick={() => setCover(null)}>
                    Show my cards
                  </button>
                </div>
              </div>
            ) : null}
            {s.phase === "over" ? (
              <div className="lc-overlay" role="dialog" aria-label="Game over">
                <div className="lc-panel">
                  <h3>{winnerName === "You" ? "You win!" : `${winnerName} wins!`}</h3>
                  <p className="lc-sub">
                    {scoreFor(s)} points left in the other hands
                    {mode === "cpu" && awardXp ? ` · +${s.winner === 0 ? XP_WIN : XP_PLAY} XP` : ""}
                  </p>
                  <button type="button" className="lc-btn lc-btn-main" onClick={onAgain}>
                    <RotateCcw size={15} /> Play again
                  </button>
                  <button type="button" className="lc-btn" onClick={onExit}>
                    Menu
                  </button>
                </div>
              </div>
            ) : null}
          </>
        }
      />
    </div>
  );
}
