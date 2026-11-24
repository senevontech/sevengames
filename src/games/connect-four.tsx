import { useState } from "react";
import type { GameProps } from "./index";
import ResultBanner from "./ResultBanner";
import { senevi, SeneviCard } from "../senevi/Senevi";

const COLS = 7;
const ROWS = 6;
type Cell = 0 | 1 | 2; // 1 = you, 2 = CPU
type Board = Cell[][]; // [col][row], row 0 = bottom

const empty = (): Board => Array.from({ length: COLS }, () => Array<Cell>(ROWS).fill(0));
const clone = (b: Board): Board => b.map((col) => [...col]);
const full = (b: Board) => b.every((col) => !col.includes(0));

function drop(b: Board, col: number, p: Cell) {
  const row = b[col].indexOf(0);
  if (row !== -1) b[col][row] = p;
}

function wins(b: Board, p: Cell): boolean {
  const dirs = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ];
  for (let c = 0; c < COLS; c += 1) {
    for (let r = 0; r < ROWS; r += 1) {
      for (const [dc, dr] of dirs) {
        let n = 0;
        while (n < 4) {
          const cc = c + dc * n;
          const rr = r + dr * n;
          if (cc < 0 || cc >= COLS || rr < 0 || rr >= ROWS || b[cc][rr] !== p) break;
          n += 1;
        }
        if (n === 4) return true;
      }
    }
  }
  return false;
}

function cpuMove(b: Board): number {
  const open = [...Array(COLS).keys()].filter((c) => b[c].includes(0));
  const wouldWin = (c: number, p: Cell) => {
    const copy = clone(b);
    drop(copy, c, p);
    return wins(copy, p);
  };
  for (const c of open) if (wouldWin(c, 2)) return c;
  for (const c of open) if (wouldWin(c, 1)) return c;
  const pref = [3, 2, 4, 1, 5, 0, 6].filter((c) => open.includes(c));
  return pref[Math.floor(Math.random() * Math.min(2, pref.length))];
}

export default function ConnectFour({ onFinish }: GameProps) {
  const [board, setBoard] = useState<Board>(empty);
  const [moves, setMoves] = useState(0);
  const [result, setResult] = useState<null | "win" | "lose" | "draw">(null);

  function play(col: number) {
    if (result || !board[col].includes(0)) return;
    const b = clone(board);
    drop(b, col, 1);
    const mine = moves + 1;
    if (wins(b, 1)) {
      setBoard(b);
      setResult("win");
      senevi({ type: "over", result: "player" });
      onFinish(Math.max(10, 100 - mine * 2));
      return;
    }
    if (full(b)) {
      setBoard(b);
      setResult("draw");
      senevi({ type: "over", result: "draw" });
      onFinish(10);
      return;
    }
    const cpuCol = cpuMove(b);
    const blocked = (() => {
      const t = clone(b);
      drop(t, cpuCol, 1);
      return wins(t, 1);
    })();
    drop(b, cpuCol, 2);
    setBoard(b);
    setMoves(mine);
    if (wins(b, 2)) {
      setResult("lose");
      senevi({ type: "over", result: "cpu" });
      onFinish(0);
    } else if (full(b)) {
      setResult("draw");
      senevi({ type: "over", result: "draw" });
      onFinish(10);
    } else if (blocked) senevi({ type: "cpuGood" });
    else senevi({ type: "think", ms: 900 });
  }

  function reset() {
    setBoard(empty());
    setMoves(0);
    setResult(null);
    senevi({ type: "start" });
  }

  return (
    <div className="game-surface">
      <SeneviCard
        status={result === "win" ? "You win!" : result === "lose" ? "Senevi wins." : result === "draw" ? "Draw." : "Connect four in a row. You are blue."}
      />
      <div className="c4-board">
        {Array.from({ length: COLS }).map((_, c) => (
          <button
            key={c}
            type="button"
            className="c4-col"
            onClick={() => play(c)}
            aria-label={`Column ${c + 1}`}
          >
            {Array.from({ length: ROWS }).map((__, i) => {
              const r = ROWS - 1 - i;
              return <span key={r} className={`c4-cell p${board[c][r]}`} />;
            })}
          </button>
        ))}
      </div>
      {result ? (
        <ResultBanner outcome={result} detail={result === "lose" ? "Senevi connected four." : undefined} onAgain={reset} />
      ) : null}
      {result ? (
        <button type="button" className="primary-btn" onClick={reset}>
          Play again
        </button>
      ) : null}
    </div>
  );
}
