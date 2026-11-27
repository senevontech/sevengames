/* An ivory die: it tumbles, bounces and settles on the value the engine rolled. The face shown
   at rest is always `value` (the state's dice), so the die can never disagree with the game. */
import { useEffect, useRef, useState } from "react";
import { sfx } from "./sound";

/** how long the tumble lasts; tokens start moving once it has landed */
export const DICE_MS = 760;

const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[30, 30], [70, 70]],
  3: [[29, 29], [50, 50], [71, 71]],
  4: [[30, 30], [70, 30], [30, 70], [70, 70]],
  5: [[29, 29], [71, 29], [50, 50], [29, 71], [71, 71]],
  6: [[30, 27], [70, 27], [30, 50], [70, 50], [30, 73], [70, 73]],
};

function Face({ n }: { n: number }) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <radialGradient id="sl-ivory" cx="34%" cy="28%" r="85%">
          <stop offset="0" stopColor="#fffdf6" />
          <stop offset="0.55" stopColor="#f4ecd9" />
          <stop offset="1" stopColor="#d9cba8" />
        </radialGradient>
        <radialGradient id="sl-pip" cx="40%" cy="35%" r="70%">
          <stop offset="0" stopColor="#3a3330" />
          <stop offset="0.7" stopColor="#120e0c" />
          <stop offset="1" stopColor="#000" />
        </radialGradient>
        <linearGradient id="sl-die-edge" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.9" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#8a7a58" stopOpacity="0.55" />
        </linearGradient>
      </defs>
      <rect x={3} y={3} width={94} height={94} rx={22} fill="url(#sl-ivory)" />
      {/* a bevel: light top-left edge, darker bottom-right */}
      <rect x={4.5} y={4.5} width={91} height={91} rx={20.5} fill="none" stroke="url(#sl-die-edge)" strokeWidth={3} />
      <rect x={3} y={3} width={94} height={94} rx={22} fill="none" stroke="rgba(90,70,40,0.35)" strokeWidth={1.2} />
      {PIPS[n].map(([x, y], i) => (
        <g key={i}>
          {/* drilled pips: a light lip under each, the dark hollow on top */}
          <circle cx={x + 0.8} cy={y + 1.2} r={8.6} fill="rgba(255,255,255,0.75)" />
          <circle cx={x} cy={y} r={8.2} fill="url(#sl-pip)" />
          <circle cx={x - 2.4} cy={y - 2.6} r={1.8} fill="rgba(255,255,255,0.28)" />
        </g>
      ))}
    </svg>
  );
}

type Props = {
  value: number;
  /** changes on every roll (so rolling the same number again still tumbles) */
  rollId: number;
  onClick?: () => void;
  /** whose turn it is: a coloured ring round the die */
  color: string;
  label: string;
};

export default function Dice({ value, rollId, onClick, color, label }: Props) {
  const [face, setFace] = useState(value || 6);
  const [rolling, setRolling] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const shadow = useRef<HTMLDivElement>(null);
  const seen = useRef(rollId);

  useEffect(() => {
    if (rollId === seen.current) {
      setFace(value || 6);
      return;
    }
    seen.current = rollId;
    if (!value) return;
    setRolling(true);
    sfx.roll(DICE_MS);
    // the die's flight: a throw up and to the side, two bounces, a last wobble
    const fly = body.current?.animate(
      [
        { transform: "translate(0px, 0px) rotate(0deg) scale(1, 1)", easing: "cubic-bezier(.2,.7,.4,1)" },
        { transform: "translate(-14px, -34px) rotate(-170deg) scale(1.08, 0.92)", offset: 0.28, easing: "cubic-bezier(.5,0,.8,.4)" },
        { transform: "translate(6px, 0px) rotate(-300deg) scale(1.06, 0.9)", offset: 0.52, easing: "cubic-bezier(.2,.7,.4,1)" },
        { transform: "translate(4px, -12px) rotate(-345deg) scale(0.96, 1.04)", offset: 0.7, easing: "cubic-bezier(.5,0,.8,.4)" },
        { transform: "translate(0px, 0px) rotate(-362deg) scale(1.03, 0.97)", offset: 0.86 },
        { transform: "translate(0px, 0px) rotate(-360deg) scale(1, 1)" },
      ],
      { duration: DICE_MS },
    );
    const sh = shadow.current?.animate(
      [
        { transform: "scale(1)", opacity: 0.55 },
        { transform: "translateX(-10px) scale(0.6)", opacity: 0.25, offset: 0.28 },
        { transform: "translateX(5px) scale(1)", opacity: 0.55, offset: 0.52 },
        { transform: "translateX(3px) scale(0.8)", opacity: 0.4, offset: 0.7 },
        { transform: "scale(1)", opacity: 0.55 },
      ],
      { duration: DICE_MS },
    );
    // faces flick past while it tumbles (never the same twice in a row), then the real one
    let last = face;
    const flick = window.setInterval(() => {
      let f = 1 + Math.floor(Math.random() * 6);
      if (f === last) f = (f % 6) + 1;
      last = f;
      setFace(f);
    }, 85);
    const stop = window.setTimeout(() => {
      window.clearInterval(flick);
      setFace(value);
      setRolling(false);
      sfx.land();
    }, DICE_MS * 0.84);
    return () => {
      window.clearInterval(flick);
      window.clearTimeout(stop);
      fly?.cancel();
      sh?.cancel();
      setFace(value);
      setRolling(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rollId]);

  const ready = Boolean(onClick) && !rolling;
  return (
    <button
      type="button"
      className={`sl-dice${ready ? " is-ready" : ""}${rolling ? " is-rolling" : ""}`}
      onClick={ready ? onClick : undefined}
      disabled={!ready}
      aria-label={ready ? "Roll the dice" : label}
      style={{ "--sl-turn": color } as React.CSSProperties}
    >
      <div className="sl-dice-stage" ref={wrap}>
        <div className="sl-dice-shadow" ref={shadow} />
        <div className="sl-dice-body" ref={body}>
          <Face n={face} />
        </div>
      </div>
    </button>
  );
}
