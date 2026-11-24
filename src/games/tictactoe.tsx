import { useState } from "react";
import type { GameProps } from "./index";
import ResultBanner, { type Outcome } from "./ResultBanner";
import { senevi, SeneviCard } from "../senevi/Senevi";

type Cell = "X" | "O" | null;

const LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

function getWinner(cells: Cell[]): Cell {
  for (const [a, b, c] of LINES) {
    if (cells[a] && cells[a] === cells[b] && cells[a] === cells[c]) return cells[a];
  }
  return null;
}

function bestMove(cells: Cell[]): number {
  // Win if possible
  for (let i = 0; i < 9; i += 1) {
    if (!cells[i]) {
      const next = [...cells];
      next[i] = "O";
      if (getWinner(next) === "O") return i;
    }
  }
  // Block if needed
  for (let i = 0; i < 9; i += 1) {
    if (!cells[i]) {
      const next = [...cells];
      next[i] = "X";
      if (getWinner(next) === "X") return i;
    }
  }
  // Center, then corners, then edges
  if (!cells[4]) return 4;
  const corners = [0, 2, 6, 8].filter((index) => !cells[index]);
  if (corners.length) return corners[Math.floor(Math.random() * corners.length)];
  const edges = [1, 3, 5, 7].filter((index) => !cells[index]);
  if (edges.length) return edges[Math.floor(Math.random() * edges.length)];
  return -1;
}

export default function TicTacToe({ onFinish }: GameProps) {
  const [cells, setCells] = useState<Cell[]>(Array(9).fill(null));
  const [status, setStatus] = useState("Your move — you are X");
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  function play(index: number) {
    if (cells[index] || getWinner(cells)) return;

    const afterUser = [...cells];
    afterUser[index] = "X";
    if (getWinner(afterUser) === "X") {
      setCells(afterUser);
      setStatus("You win");
      setOutcome("win");
      senevi({ type: "over", result: "player" });
      onFinish(120);
      return;
    }
    if (afterUser.every(Boolean)) {
      setCells(afterUser);
      setStatus("Draw");
      setOutcome("draw");
      senevi({ type: "over", result: "draw" });
      onFinish(75);
      return;
    }

    const opponentIndex = bestMove(afterUser);
    // he blocked a line you were about to finish
    const blocked = opponentIndex >= 0 && (() => {
      const t = [...afterUser];
      t[opponentIndex] = "X";
      return getWinner(t) === "X";
    })();
    const afterOpponent = [...afterUser];
    if (opponentIndex >= 0) afterOpponent[opponentIndex] = "O";
    setCells(afterOpponent);

    if (getWinner(afterOpponent) === "O") {
      setStatus("Opponent wins");
      setOutcome("lose");
      senevi({ type: "over", result: "cpu" });
      onFinish(35);
    } else if (afterOpponent.every(Boolean)) {
      setStatus("Draw");
      setOutcome("draw");
      senevi({ type: "over", result: "draw" });
      onFinish(75);
    } else {
      if (blocked) senevi({ type: "cpuGood" });
      else senevi({ type: "think", ms: 900 });
      setStatus("Your move — you are X");
    }
  }

  function reset() {
    setCells(Array(9).fill(null));
    setStatus("Your move — you are X");
    setOutcome(null);
    senevi({ type: "start" });
  }

  return (
    <div className="game-surface">
      <SeneviCard status={status} />
      <div className="board-three">
        {cells.map((cell, index) => (
          <button
            key={index}
            type="button"
            className="cell-btn"
            onClick={() => play(index)}
            aria-label={`Cell ${index + 1}${cell ? `: ${cell}` : ""}`}
          >
            {cell}
          </button>
        ))}
      </div>
      <button type="button" className="ghost-btn" onClick={reset}>
        New round
      </button>
      {outcome ? <ResultBanner outcome={outcome} detail={outcome === "lose" ? "The opponent made three in a row." : undefined} onAgain={reset} /> : null}
    </div>
  );
}
