import { useEffect, useMemo, useRef, useState } from "react";
import type { GameProps } from "./index";
import ResultBanner from "./ResultBanner";

const SIZE = 8;
const MINES = 10;

type CellState = {
  mine: boolean;
  revealed: boolean;
  flagged: boolean;
  adjacent: number;
};

function buildBoard(): CellState[] {
  const cells: CellState[] = Array.from({ length: SIZE * SIZE }, () => ({
    mine: false,
    revealed: false,
    flagged: false,
    adjacent: 0,
  }));

  let placed = 0;
  while (placed < MINES) {
    const index = Math.floor(Math.random() * cells.length);
    if (!cells[index].mine) {
      cells[index].mine = true;
      placed += 1;
    }
  }

  for (let i = 0; i < cells.length; i += 1) {
    cells[i].adjacent = neighbors(i).filter((n) => cells[n].mine).length;
  }
  return cells;
}

function neighbors(index: number): number[] {
  const r = Math.floor(index / SIZE);
  const c = index % SIZE;
  const result: number[] = [];
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE) result.push(nr * SIZE + nc);
    }
  }
  return result;
}

const NUMBER_COLORS = ["", "#0a84ff", "#30d158", "#ff375f", "#5e5ce6", "#bf5af2", "#ff9f0a", "#1d1d1f", "#8e8e93"];

export default function Minesweeper({ onFinish }: GameProps) {
  const [cells, setCells] = useState<CellState[]>(buildBoard);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [status, setStatus] = useState<"playing" | "won" | "lost">("playing");
  const [flagMode, setFlagMode] = useState(false);
  const finishedRef = useRef(false);

  const revealedCount = cells.filter((cell) => cell.revealed).length;
  const safeCount = SIZE * SIZE - MINES;

  useEffect(() => {
    if (status === "won" && !finishedRef.current && startedAt) {
      finishedRef.current = true;
      onFinish(Math.max(1, Math.round((Date.now() - startedAt) / 1000)));
    }
  }, [status, startedAt, onFinish]);

  function reveal(index: number) {
    if (status !== "playing" || cells[index].revealed || cells[index].flagged) return;
    if (startedAt === null) setStartedAt(Date.now());

    const next = cells.map((cell) => ({ ...cell }));

    if (next[index].mine) {
      next.forEach((cell) => {
        if (cell.mine) cell.revealed = true;
      });
      setCells(next);
      setStatus("lost");
      return;
    }

    const stack = [index];
    while (stack.length) {
      const current = stack.pop()!;
      const cell = next[current];
      if (cell.revealed || cell.flagged) continue;
      cell.revealed = true;
      if (cell.adjacent === 0) {
        neighbors(current).forEach((n) => {
          if (!next[n].revealed && !next[n].mine) stack.push(n);
        });
      }
    }

    setCells(next);
    if (next.filter((cell) => cell.revealed).length === safeCount) {
      setStatus("won");
    }
  }

  function toggleFlag(index: number) {
    if (status !== "playing" || cells[index].revealed) return;
    if (startedAt === null) setStartedAt(Date.now());
    setCells((current) =>
      current.map((cell, i) => (i === index ? { ...cell, flagged: !cell.flagged } : cell)),
    );
  }

  function handleTap(index: number) {
    if (flagMode) toggleFlag(index);
    else reveal(index);
  }

  function reset() {
    finishedRef.current = false;
    setCells(buildBoard());
    setStartedAt(null);
    setStatus("playing");
  }

  const flags = useMemo(() => cells.filter((cell) => cell.flagged).length, [cells]);

  return (
    <div className="game-surface">
      <p className="game-status">
        {status === "playing"
          ? `Mines ${MINES - flags} · ${revealedCount}/${safeCount} cleared`
          : status === "won"
            ? "Cleared! Well played."
            : "Boom — try again."}
      </p>
      <div className="mine-grid">
        {cells.map((cell, index) => {
          const number = cell.revealed && !cell.mine && cell.adjacent > 0;
          return (
            <button
              key={index}
              type="button"
              className={`mine-cell${cell.revealed ? " revealed" : ""}${number ? ` n${cell.adjacent}` : ""}`}
              onClick={() => handleTap(index)}
              onContextMenu={(event) => {
                event.preventDefault();
                toggleFlag(index);
              }}
              aria-label={`Cell ${index + 1}${cell.revealed ? " revealed" : ""}`}
            >
              {cell.revealed ? (cell.mine ? "●" : cell.adjacent > 0 ? cell.adjacent : "") : cell.flagged ? "⚑" : ""}
            </button>
          );
        })}
      </div>
      {status !== "playing" ? (
        <ResultBanner
          outcome={status === "won" ? "win" : "lose"}
          detail={status === "won" ? "Every safe square cleared." : "You hit a mine."}
          againLabel="New board"
          onAgain={reset}
        />
      ) : null}
      {status === "playing" ? (
        <button
          type="button"
          className={`ghost-btn${flagMode ? " active" : ""}`}
          onClick={() => setFlagMode((value) => !value)}
        >
          {flagMode ? "Flagging: ON" : "Flag mode: OFF"}
        </button>
      ) : (
        <button type="button" className="primary-btn" onClick={reset}>
          New board
        </button>
      )}
    </div>
  );
}
