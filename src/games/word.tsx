import { useEffect, useRef, useState } from "react";
import type { GameProps } from "./index";
import { shuffle } from "./util";

const WORDS = [
  "arcade", "signal", "focus", "pixel", "launch", "vector", "nebula", "orbit",
  "quartz", "circuit", "photon", "matrix", "kernel", "binary", "zephyr", "cipher",
];

const WORD_TIME_MS = 7000;

export default function WordGame({ onFinish }: GameProps) {
  const [deck] = useState(() => shuffle(WORDS).slice(0, 8));
  const [index, setIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [value, setValue] = useState("");
  const [deadline, setDeadline] = useState(() => Date.now() + WORD_TIME_MS);
  const [remaining, setRemaining] = useState(WORD_TIME_MS);
  const finishedRef = useRef(false);

  const finished = index >= deck.length;

  useEffect(() => {
    if (finished) return;
    const interval = window.setInterval(() => {
      const left = deadline - Date.now();
      setRemaining(Math.max(0, left));
      if (left <= 0) {
        skip(false);
      }
    }, 200);
    return () => window.clearInterval(interval);
  });

  function skip(typedIt: boolean) {
    const nextScore = score + (typedIt ? 60 : 0);
    setScore(nextScore);
    setValue("");
    if (index === deck.length - 1) {
      if (!finishedRef.current) {
        finishedRef.current = true;
        onFinish(nextScore);
      }
      setIndex(deck.length);
    } else {
      setIndex(index + 1);
      setDeadline(Date.now() + WORD_TIME_MS);
    }
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (finished || finishedRef.current) return;
    skip(value.trim().toLowerCase() === deck[index]);
  }

  function reset() {
    finishedRef.current = false;
    setIndex(0);
    setScore(0);
    setValue("");
    setDeadline(Date.now() + WORD_TIME_MS);
  }

  return (
    <div className="game-surface">
      <p className="game-status">
        Word {Math.min(index + 1, deck.length)}/{deck.length} · Score {score}
      </p>
      <h3 className="game-prompt big">{finished ? "Done" : deck[index]}</h3>
      <div className="timer-bar">
        <div
          className="timer-fill"
          style={{ width: `${Math.min(100, (remaining / WORD_TIME_MS) * 100)}%` }}
        />
      </div>
      {!finished ? (
        <form className="answer-form" onSubmit={submit}>
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            autoFocus
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Type the word"
          />
          <button className="primary-btn" type="submit">
            Enter
          </button>
        </form>
      ) : (
        <button type="button" className="primary-btn" onClick={reset}>
          Play again
        </button>
      )}
    </div>
  );
}
