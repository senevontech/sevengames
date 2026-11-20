import { useState } from "react";
import type { GameProps } from "./index";
import { shuffle } from "./util";
import ResultBanner from "./ResultBanner";

const WORDS = [
  "pixel", "vector", "signal", "orbit", "nebula", "quartz", "zephyr", "cipher",
  "arcade", "glitch", "kernel", "matrix", "photon", "widget", "binary", "lambda",
];

const ALPHABET = "abcdefghijklmnopqrstuvwxyz".split("");

export default function HangmanGame({ onFinish }: GameProps) {
  const [words] = useState(() => shuffle(WORDS).slice(0, 3));
  const [wordIndex, setWordIndex] = useState(0);
  const [guessed, setGuessed] = useState<string[]>([]);
  const [lives, setLives] = useState(6);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);

  const word = words[wordIndex];
  const solved = word.split("").every((letter) => guessed.includes(letter));

  function guess(letter: string) {
    if (guessed.includes(letter) || done) return;
    const nextGuessed = [...guessed, letter];
    const correct = word.includes(letter);
    const nextLives = correct ? lives : lives - 1;
    setGuessed(nextGuessed);
    setLives(nextLives);

    if (nextLives <= 0) {
      setDone(true);
      onFinish(score);
      return;
    }

    const nextSolved = word.split("").every((l) => nextGuessed.includes(l));
    if (nextSolved) {
      const earned = 50 + lives * 10;
      const nextScore = score + earned;
      setScore(nextScore);
      if (wordIndex === words.length - 1) {
        setDone(true);
        onFinish(nextScore);
      } else {
        setWordIndex(wordIndex + 1);
        setGuessed([]);
        setLives(6);
      }
    }
  }

  function reset() {
    setWordIndex(0);
    setGuessed([]);
    setLives(6);
    setScore(0);
    setDone(false);
  }

  return (
    <div className="game-surface">
      <p className="game-status">
        Word {wordIndex + 1}/{words.length} · Lives {"♥".repeat(Math.max(0, lives))}{"♡".repeat(6 - Math.max(0, lives))}
      </p>
      <p className="word-display">
        {word.split("").map((letter, index) => (
          <span key={index} className={guessed.includes(letter) ? "" : "hidden-letter"}>
            {guessed.includes(letter) ? letter : "•"}
          </span>
        ))}
      </p>
      {done && lives <= 0 ? <p className="game-hint">The word was “{word}”.</p> : null}
      <div className="keyboard">
        {ALPHABET.map((letter) => {
          const used = guessed.includes(letter);
          const inWord = used && word.includes(letter);
          return (
            <button
              key={letter}
              type="button"
              className="key-btn"
              disabled={used || done}
              style={used ? { opacity: inWord ? 0.85 : 0.3 } : undefined}
              onClick={() => guess(letter)}
            >
              {letter.toUpperCase()}
            </button>
          );
        })}
      </div>
      {done ? (
        <ResultBanner
          outcome={lives > 0 ? "win" : "lose"}
          detail={lives > 0 ? `All ${words.length} words solved · ${score} points` : `The word was “${word}”.`}
          onAgain={reset}
        />
      ) : null}
      {done ? (
        <button type="button" className="primary-btn" onClick={reset}>
          Play again
        </button>
      ) : null}
    </div>
  );
}
