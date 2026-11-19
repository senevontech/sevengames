import { useEffect, useMemo, useRef, useState } from "react";
import type { GameProps } from "./index";
import { shuffle } from "./util";

const SIZE = 3;
const SOLVED = Array.from({ length: SIZE * SIZE }, (_, i) => (i + 1) % (SIZE * SIZE));

function isSolvable(tiles: number[]) {
  const flat = tiles.filter((t) => t !== 0);
  let inversions = 0;
  for (let i = 0; i < flat.length; i += 1) {
    for (let j = i + 1; j < flat.length; j += 1) {
      if (flat[i] > flat[j]) inversions += 1;
    }
  }
  // Odd grid width: solvable iff inversion count is even
  return inversions % 2 === 0;
}

function makePuzzle() {
  let tiles = shuffle(SOLVED);
  while (!isSolvable(tiles) || tiles.every((t, i) => t === SOLVED[i])) {
    tiles = shuffle(SOLVED);
  }
  return tiles;
}

export default function SlidingPuzzle({ onFinish }: GameProps) {
  const [tiles, setTiles] = useState<number[]>(makePuzzle);
  const [moves, setMoves] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [solved, setSolved] = useState(false);
  const finishedRef = useRef(false);

  useEffect(() => {
    if (!startedAt || solved) return;
    const interval = window.setInterval(() => {
      setSeconds(Math.round((Date.now() - startedAt) / 1000));
    }, 500);
    return () => window.clearInterval(interval);
  }, [startedAt, solved]);

  useEffect(() => {
    if (solved && !finishedRef.current && startedAt) {
      finishedRef.current = true;
      onFinish(Math.max(1, seconds || Math.round((Date.now() - startedAt) / 1000)));
    }
  }, [solved, startedAt, seconds, onFinish]);

  function slide(index: number) {
    if (solved) return;
    const emptyIndex = tiles.indexOf(0);
    const row = Math.floor(index / SIZE);
    const col = index % SIZE;
    const emptyRow = Math.floor(emptyIndex / SIZE);
    const emptyCol = emptyIndex % SIZE;
    const adjacent = Math.abs(row - emptyRow) + Math.abs(col - emptyCol) === 1;
    if (!adjacent) return;

    if (!startedAt) setStartedAt(Date.now());

    const next = [...tiles];
    [next[index], next[emptyIndex]] = [next[emptyIndex], next[index]];
    setTiles(next);
    setMoves((value) => value + 1);

    if (next.every((t, i) => t === SOLVED[i])) {
      setSolved(true);
      setSeconds(Math.round((Date.now() - (startedAt ?? Date.now())) / 1000));
    }
  }

  function reset() {
    finishedRef.current = false;
    setTiles(makePuzzle());
    setMoves(0);
    setStartedAt(null);
    setSeconds(0);
    setSolved(false);
  }

  const status = useMemo(() => {
    if (solved) return `Solved in ${seconds}s · ${moves} moves`;
    return startedAt ? `Moves ${moves} · ${seconds}s` : "Tap a tile next to the gap to slide it";
  }, [solved, seconds, moves, startedAt]);

  return (
    <div className="game-surface">
      <p className="game-status">{status}</p>
      <div className="slide-grid">
        {tiles.map((tile, index) => (
          <button
            key={index}
            type="button"
            className={`slide-tile${tile === 0 ? " empty" : ""}`}
            onClick={() => slide(index)}
            aria-label={tile === 0 ? "Empty slot" : `Tile ${tile}`}
          >
            {tile === 0 ? "" : tile}
          </button>
        ))}
      </div>
      <button type="button" className="ghost-btn" onClick={reset}>
        Shuffle
      </button>
    </div>
  );
}
