/* Call Break against three CPU players (a mode of the card table, next to Blackjack).
   The rules and the CPU live in engine.ts; this is the table. */
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ListOrdered } from "lucide-react";
import { CardDefs, PlayingCard } from "../cards/Card";
import { cardSound, winSound } from "../cards/sounds";
import { MAX_CALL, ROUNDS, collect, cpuCall, cpuPlay, dealRound, legal, placeCall, playCard, totalOf, winning, type CBState, type Seat } from "./engine";
import "../cards/cards.css";
import "./callbreak.css";

const NAMES = ["You", "CPU West", "CPU North", "CPU East"];
const SPOT = ["is-s", "is-w", "is-n", "is-e"];
const CPU_CALL_MS = 600;
const CPU_PLAY_MS = 650;
const TRICK_SHOW_MS = 1050;

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** `initial`: start from a given position (tests / previews); normally a fresh deal. */
export default function CallBreak({ onExit, initial }: { onExit: () => void; initial?: CBState }) {
  const [s, setS] = useState<CBState>(() => initial ?? dealRound(null));
  const [board, setBoard] = useState(false);

  // the CPU calls and plays; a full trick stays on the table for a moment, then goes to its winner
  useEffect(() => {
    if (s.phase === "play" && s.trick.length === 4) {
      const id = window.setTimeout(() => {
        setS((cur) => {
          const n = collect(cur);
          if (n.last?.winner === 0) winSound();
          return n;
        });
      }, TRICK_SHOW_MS);
      return () => window.clearTimeout(id);
    }
    if (s.turn === 0) return;
    if (s.phase === "call") {
      const id = window.setTimeout(() => setS((cur) => placeCall(cur, cur.turn, cpuCall(cur.hands[cur.turn]))), CPU_CALL_MS);
      return () => window.clearTimeout(id);
    }
    if (s.phase === "play") {
      const id = window.setTimeout(() => {
        setS((cur) => {
          if (cur.turn === 0 || cur.trick.length === 4) return cur;
          cardSound();
          return playCard(cur, cur.turn, cpuPlay(cur, cur.turn));
        });
      }, CPU_PLAY_MS);
      return () => window.clearTimeout(id);
    }
  }, [s]);

  const myTurn = s.phase === "play" && s.turn === 0 && s.trick.length < 4;
  const playable = useMemo(() => (myTurn ? legal(s.hands[0], s.trick) : []), [myTurn, s.hands, s.trick]);
  const hint = useMemo(() => cpuCall(s.hands[0]), [s.hands]);

  const play = (card: number) => {
    if (!playable.includes(card)) return;
    cardSound();
    setS((cur) => playCard(cur, 0, card));
  };

  const status =
    s.phase === "call"
      ? s.turn === 0
        ? "Your call: how many tricks will you take?"
        : `${NAMES[s.turn]} is calling…`
      : s.phase === "play"
        ? s.trick.length === 4
          ? `${NAMES[winningSeat(s)]} take${winningSeat(s) === 0 ? "" : "s"} the trick`
          : myTurn
            ? s.trick.length
              ? "Your turn: follow suit and beat it if you can"
              : "Your lead"
            : `${NAMES[s.turn]} to play`
        : "";

  const totals = [0, 1, 2, 3].map((i) => totalOf(s, i));
  const winner = totals.indexOf(Math.max(...totals));

  return (
    <div className="game-surface cb-surface">
      <CardDefs />
      <div className="cb-top">
        <button type="button" className="cb-pill" onClick={onExit}>
          <ChevronLeft size={15} /> Card table
        </button>
        <span className="cb-round">
          Round {Math.min(s.round, ROUNDS)} of {ROUNDS} · <span className="cb-trump">♠ trumps</span>
        </span>
        <button type="button" className="cb-pill" onClick={() => setBoard((b) => !b)} aria-expanded={board}>
          <ListOrdered size={15} /> Scores
        </button>
      </div>

      <div className="ct-table cb-table">
        <div className="ct-felt cb-felt">
          {[1, 2, 3].map((seat) => (
            <SeatPanel key={seat} seat={seat as Seat} s={s} />
          ))}

          {/* the trick in the middle, each card in front of whoever played it */}
          <div className="cb-trick" aria-label="Cards on the table">
            {s.trick.map((p) => (
              <div key={p.card} className={`cb-spot ${SPOT[p.seat]}`}>
                <PlayingCard card={p.card} />
              </div>
            ))}
            {!s.trick.length && s.phase === "play" ? <p className="ct-print cb-print">Call Break</p> : null}
          </div>

          <p className="cb-status" aria-live="polite">
            {status}
          </p>

          {/* you */}
          <div className="cb-me">
            <div className={`cb-badge${s.turn === 0 && s.phase !== "round-end" && s.phase !== "over" ? " is-turn" : ""}`}>
              <b>You</b>
              <span>
                {s.calls[0] === null ? "calling" : `${s.tricks[0]} / ${s.calls[0]}`}
              </span>
              <small>{fmt(totals[0])} pts</small>
            </div>
            <div className="cb-hand" role="group" aria-label="Your cards">
              {s.hands[0].map((c) => {
                const ok = playable.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    className={`cb-card${ok ? " is-ok" : ""}${myTurn && !ok ? " is-off" : ""}`}
                    disabled={!ok}
                    onClick={() => play(c)}
                  >
                    <PlayingCard card={c} />
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* your call */}
        {s.phase === "call" && s.turn === 0 ? (
          <div className="cb-overlay is-call" role="dialog" aria-label="Your call">
            <div className="cb-panel">
              <h3>Your call</h3>
              <p className="cb-sub">How many tricks will you take? Look at your cards below.</p>
              <div className="cb-calls">
                {Array.from({ length: MAX_CALL }, (_, i) => i + 1).map((n) => (
                  <button key={n} type="button" className={n === hint ? "is-hint" : ""} onClick={() => setS((cur) => placeCall(cur, 0, n))}>
                    {n}
                  </button>
                ))}
              </div>
              <p className="cb-sub">Suggested for this hand: {hint}</p>
            </div>
          </div>
        ) : null}

        {/* round over / game over */}
        {s.phase === "round-end" || s.phase === "over" ? (
          <div className="cb-overlay" role="dialog" aria-label={s.phase === "over" ? "Game over" : "Round over"}>
            <div className="cb-panel">
              <h3>{s.phase === "over" ? (winner === 0 ? "You win!" : `${NAMES[winner]} wins`) : `Round ${s.round} done`}</h3>
              <ScoreTable s={s} />
              <div className="cb-actions">
                {s.phase === "over" ? (
                  <>
                    <button type="button" className="cb-btn cb-btn-main" onClick={() => setS(dealRound(null))}>
                      Play again
                    </button>
                    <button type="button" className="cb-btn" onClick={onExit}>
                      Card table
                    </button>
                  </>
                ) : (
                  <button type="button" className="cb-btn cb-btn-main" onClick={() => setS((cur) => dealRound(cur))}>
                    Deal round {s.round + 1}
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {board && s.phase !== "round-end" && s.phase !== "over" ? (
          <div className="cb-overlay" role="dialog" aria-label="Scores" onClick={() => setBoard(false)}>
            <div className="cb-panel" onClick={(e) => e.stopPropagation()}>
              <h3>Scores</h3>
              <ScoreTable s={s} />
              <div className="cb-actions">
                <button type="button" className="cb-btn cb-btn-main" onClick={() => setBoard(false)}>
                  Back to the game
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

const winningSeat = (s: CBState) => winning(s.trick)!.seat;

function SeatPanel({ seat, s }: { seat: Seat; s: CBState }) {
  const left = s.hands[seat].length;
  const active = s.turn === seat && (s.phase === "call" || (s.phase === "play" && s.trick.length < 4));
  return (
    <div className={`cb-seat ${SPOT[seat]}`}>
      <div className={`cb-badge${active ? " is-turn" : ""}`}>
        <b>{NAMES[seat]}</b>
        <span>{s.calls[seat] === null ? (active ? "calling…" : "—") : `${s.tricks[seat]} / ${s.calls[seat]}`}</span>
        <small>{fmt(totalOf(s, seat))} pts</small>
      </div>
      <div className="cb-backs" aria-label={`${left} cards`}>
        {Array.from({ length: Math.min(left, 13) }, (_, i) => (
          <PlayingCard key={i} card={-1} faceUp={false} />
        ))}
      </div>
    </div>
  );
}

function ScoreTable({ s }: { s: CBState }) {
  return (
    <table className="cb-scores">
      <thead>
        <tr>
          <th>Round</th>
          {NAMES.map((n) => (
            <th key={n}>{n.replace("CPU ", "")}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {s.scores.map((r, i) => (
          <tr key={i}>
            <td>{i + 1}</td>
            {r.map((v, j) => (
              <td key={j} className={v < 0 ? "is-neg" : ""}>
                {fmt(v)}
              </td>
            ))}
          </tr>
        ))}
        {!s.scores.length ? (
          <tr>
            <td colSpan={5}>No rounds finished yet.</td>
          </tr>
        ) : null}
      </tbody>
      <tfoot>
        <tr>
          <td>Total</td>
          {[0, 1, 2, 3].map((j) => (
            <td key={j}>{fmt(totalOf(s, j))}</td>
          ))}
        </tr>
      </tfoot>
    </table>
  );
}
