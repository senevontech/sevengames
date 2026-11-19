import { useEffect, useMemo, useState } from "react";
import type { GameProps } from "./index";
import { shuffle } from "./util";

const SYMBOLS = ["🚀", "🌙", "⭐️", "🪐", "☀️", "🛰️"];

type Card = { id: number; symbol: string };

function makeDeck(): Card[] {
  return shuffle([...SYMBOLS, ...SYMBOLS]).map((symbol, index) => ({ id: index, symbol }));
}

export default function MemoryGame({ onFinish }: GameProps) {
  const [deck, setDeck] = useState<Card[]>(makeDeck);
  const [open, setOpen] = useState<number[]>([]);
  const [matched, setMatched] = useState<number[]>([]);
  const [moves, setMoves] = useState(0);
  const [finished, setFinished] = useState(false);

  const pairs = deck.length / 2;
  const matchedPairs = matched.length / 2;

  useEffect(() => {
    if (matchedPairs === pairs && pairs > 0 && !finished) {
      setFinished(true);
      onFinish(Math.max(40, 220 - moves * 8));
    }
  }, [matchedPairs, pairs, moves, finished, onFinish]);

  function flip(index: number) {
    if (finished) return;
    if (open.includes(index) || matched.includes(index) || open.length === 2) return;

    const nextOpen = [...open, index];
    setOpen(nextOpen);

    if (nextOpen.length === 2) {
      const [first, second] = nextOpen;
      setMoves((value) => value + 1);
      if (deck[first].symbol === deck[second].symbol) {
        setMatched((value) => [...value, first, second]);
        setOpen([]);
      } else {
        window.setTimeout(() => setOpen([]), 650);
      }
    }
  }

  function reset() {
    setDeck(makeDeck());
    setOpen([]);
    setMatched([]);
    setMoves(0);
    setFinished(false);
  }

  return (
    <div className="game-surface">
      <p className="game-status">
        Moves {moves} · Pairs {matchedPairs}/{pairs}
      </p>
      <div className="memory-grid">
        {deck.map((card, index) => {
          const visible = open.includes(index) || matched.includes(index);
          return (
            <button
              key={card.id}
              type="button"
              className={`memory-card${visible ? " visible" : ""}`}
              onClick={() => flip(index)}
              aria-label={visible ? `Card ${card.symbol}` : `Hidden card ${index + 1}`}
            >
              {visible ? card.symbol : ""}
            </button>
          );
        })}
      </div>
      <button type="button" className="ghost-btn" onClick={reset}>
        Restart
      </button>
    </div>
  );
}
