/* A realistic playing card (SVG, 250 × 350): corner indices, the classic pip layouts, original
   face-card panels, a patterned back and a 3D flip. Shared by every card game.
   Cards are numbers 0–51: rank = c % 13 (0 = A, 1–9 = 2–10, 10 = J, 11 = Q, 12 = K),
   suit = floor(c / 13) (0 ♠, 1 ♥, 2 ♦, 3 ♣) — the same numbering as supabase/cards.sql. */
import { memo, type CSSProperties } from "react";
import "./cards.css";

export const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;
export const SUIT_NAMES = ["spades", "hearts", "diamonds", "clubs"] as const;
const RED = "#c8102e";
const BLACK = "#1b1b1f";

export const rankOf = (c: number) => c % 13;
export const suitOf = (c: number) => Math.floor(c / 13);
export const isRed = (c: number) => suitOf(c) === 1 || suitOf(c) === 2;
export const cardLabel = (c: number) => (c < 0 ? "Face-down card" : `${RANKS[rankOf(c)]} of ${SUIT_NAMES[suitOf(c)]}`);

/** Suit symbols drawn in a 100 × 100 box centred on (50, 50). */
const SUIT_PATHS = [
  // spade
  "M50 6C42 22 14 36 14 58c0 13 10 22 22 22 6 0 11-2 14-6-1 8-4 14-10 20h20c-6-6-9-12-10-20 3 4 8 6 14 6 12 0 22-9 22-22C86 36 58 22 50 6Z",
  // heart
  "M50 90C44 83 10 60 10 34 10 20 21 10 33 10c8 0 14 4 17 11 3-7 9-11 17-11 12 0 23 10 23 24 0 26-34 49-40 56Z",
  // diamond
  "M50 4 82 50 50 96 18 50Z",
  // club
  "M50 8c-12 0-21 9-21 20 0 5 2 9 4 12-3-2-7-3-11-3C10 37 2 46 2 57s8 20 20 20c9 0 16-5 19-12-1 11-5 18-11 25h40c-6-7-10-14-11-25 3 7 10 12 19 12 12 0 20-9 20-20s-8-20-20-20c-4 0-8 1-11 3 2-3 4-7 4-12 0-11-9-20-21-20Z",
];

export function SuitIcon({ suit, size = 100, x = 0, y = 0, flip = false, fill }: { suit: number; size?: number; x?: number; y?: number; flip?: boolean; fill?: string }) {
  const s = size / 100;
  return (
    <path
      d={SUIT_PATHS[suit]}
      fill={fill ?? (suit === 1 || suit === 2 ? RED : BLACK)}
      transform={`translate(${x - size / 2} ${y - size / 2}) scale(${s})${flip ? " rotate(180 50 50)" : ""}`}
    />
  );
}

/* Pip positions for 2–10 on the 250 × 350 face (x, y); pips below the middle are drawn upside down. */
const C = [78, 125, 172];
const PIPS: Record<number, [number, number][]> = {
  2: [[C[1], 78], [C[1], 272]],
  3: [[C[1], 78], [C[1], 175], [C[1], 272]],
  4: [[C[0], 78], [C[2], 78], [C[0], 272], [C[2], 272]],
  5: [[C[0], 78], [C[2], 78], [C[1], 175], [C[0], 272], [C[2], 272]],
  6: [[C[0], 78], [C[2], 78], [C[0], 175], [C[2], 175], [C[0], 272], [C[2], 272]],
  7: [[C[0], 78], [C[2], 78], [C[1], 126], [C[0], 175], [C[2], 175], [C[0], 272], [C[2], 272]],
  8: [[C[0], 78], [C[2], 78], [C[1], 126], [C[0], 175], [C[2], 175], [C[1], 224], [C[0], 272], [C[2], 272]],
  9: [[C[0], 78], [C[2], 78], [C[0], 143], [C[2], 143], [C[1], 175], [C[0], 207], [C[2], 207], [C[0], 272], [C[2], 272]],
  10: [[C[0], 78], [C[2], 78], [C[1], 110], [C[0], 143], [C[2], 143], [C[0], 207], [C[2], 207], [C[1], 240], [C[0], 272], [C[2], 272]],
};

/** Shared gradients / patterns: rendered once per page by <CardDefs />. */
export function CardDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="cd-paper" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fffdf8" />
          <stop offset="1" stopColor="#f1ece1" />
        </linearGradient>
        <filter id="cd-grain" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4" result="n" />
          <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.45  0 0 0 0 0.4  0 0 0 0 0.3  0 0 0 0.06 0" />
          <feComposite in2="SourceGraphic" operator="in" />
        </filter>
        <pattern id="cd-back-pattern" width="22" height="22" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="22" height="22" fill="#9c1c2b" />
          <path d="M0 11h22M11 0v22" stroke="#c63546" strokeWidth="2.2" />
          <circle cx="11" cy="11" r="3" fill="#e9c46a" />
        </pattern>
        <linearGradient id="cd-face-panel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fbf3df" />
          <stop offset="1" stopColor="#f3e3bb" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/* An original court-card panel: a framed portrait medallion with the suit and an emblem
   (crown, tiara or plume), mirrored top-to-bottom like a traditional double-ended card. */
function CourtPanel({ rank, suit }: { rank: number; suit: number }) {
  const ink = suit === 1 || suit === 2 ? RED : BLACK;
  const accent = suit === 1 || suit === 2 ? "#1d4e9e" : "#c8102e";
  const gold = "#d9a520";
  const half = (
    <g>
      {/* medallion */}
      <circle cx={125} cy={128} r={44} fill="#fff" stroke={ink} strokeWidth={3} />
      <circle cx={125} cy={128} r={36} fill="none" stroke={gold} strokeWidth={2} strokeDasharray="4 3" />
      <text x={125} y={146} textAnchor="middle" fontFamily="Georgia, 'Times New Roman', serif" fontWeight={700} fontSize={50} fill={ink}>
        {RANKS[rank]}
      </text>
      {/* emblem above the medallion */}
      {rank === 12 ? (
        <path d="M95 82 103 60 114 74 125 54 136 74 147 60 155 82Z" fill={gold} stroke={ink} strokeWidth={2} />
      ) : rank === 11 ? (
        <path d="M100 82c4-12 12-18 25-18s21 6 25 18c-8-4-16-6-25-6s-17 2-25 6Z" fill={gold} stroke={ink} strokeWidth={2} />
      ) : (
        <path d="M118 82c-6-14 2-26 18-30-6 8-6 16-2 30Z" fill={accent} stroke={ink} strokeWidth={2} />
      )}
      {/* small suits flanking */}
      <SuitIcon suit={suit} size={26} x={88} y={186} />
      <SuitIcon suit={suit} size={26} x={162} y={186} />
    </g>
  );
  return (
    <g>
      <rect x={46} y={40} width={158} height={270} rx={10} fill="url(#cd-face-panel)" stroke={ink} strokeWidth={2.5} />
      <rect x={53} y={47} width={144} height={256} rx={7} fill="none" stroke={accent} strokeWidth={1.5} />
      <line x1={53} y1={175} x2={197} y2={175} stroke={accent} strokeWidth={1.5} />
      <clipPath id={`cd-court-${rank}-${suit}`}>
        <rect x={53} y={47} width={144} height={128} />
      </clipPath>
      <g clipPath={`url(#cd-court-${rank}-${suit})`}>{half}</g>
      <g transform="rotate(180 125 175)" clipPath={`url(#cd-court-${rank}-${suit})`}>{half}</g>
    </g>
  );
}

function Face({ card }: { card: number }) {
  const rank = rankOf(card);
  const suit = suitOf(card);
  const ink = isRed(card) ? RED : BLACK;
  const label = RANKS[rank];
  const corner = (
    <g>
      <text x={24} y={52} textAnchor="middle" fontFamily="Georgia, 'Times New Roman', serif" fontWeight={700} fontSize={label === "10" ? 38 : 44} letterSpacing={label === "10" ? -3 : 0} fill={ink}>
        {label}
      </text>
      <SuitIcon suit={suit} size={30} x={24} y={76} />
    </g>
  );
  return (
    <g>
      <rect x={1.5} y={1.5} width={247} height={347} rx={16} fill="url(#cd-paper)" stroke="#cfc7b6" strokeWidth={3} />
      <rect x={1.5} y={1.5} width={247} height={347} rx={16} filter="url(#cd-grain)" />
      {corner}
      <g transform="rotate(180 125 175)">{corner}</g>
      {rank === 0 ? (
        // ace: one large ornamented pip
        <g>
          <SuitIcon suit={suit} size={suit === 0 ? 130 : 104} x={125} y={175} />
          {suit === 0 ? <circle cx={125} cy={172} r={9} fill="#fffdf8" /> : null}
        </g>
      ) : rank >= 10 ? (
        <CourtPanel rank={rank} suit={suit} />
      ) : (
        PIPS[rank + 1].map(([x, y], i) => <SuitIcon key={i} suit={suit} size={50} x={x} y={y} flip={y > 175} />)
      )}
    </g>
  );
}

function Back() {
  return (
    <g>
      <rect x={1.5} y={1.5} width={247} height={347} rx={16} fill="#fffdf8" stroke="#cfc7b6" strokeWidth={3} />
      <rect x={14} y={14} width={222} height={322} rx={10} fill="url(#cd-back-pattern)" />
      <rect x={14} y={14} width={222} height={322} rx={10} fill="none" stroke="#6e0f1c" strokeWidth={3} />
      <rect x={24} y={24} width={202} height={302} rx={7} fill="none" stroke="#e9c46a" strokeWidth={2} />
      {/* centre medallion: an original "S" monogram */}
      <circle cx={125} cy={175} r={34} fill="#9c1c2b" stroke="#e9c46a" strokeWidth={3} />
      <text x={125} y={190} textAnchor="middle" fontFamily="Georgia, 'Times New Roman', serif" fontWeight={700} fontSize={42} fill="#e9c46a">
        S
      </text>
    </g>
  );
}

/**
 * A card. `card` < 0 or `faceUp={false}` shows the back; changing `faceUp` flips it in 3D.
 * `deal` (with an optional `delay` in ms) plays the slide-in from the shoe.
 */
export const PlayingCard = memo(function PlayingCard({
  card,
  faceUp = true,
  deal = false,
  delay = 0,
  className = "",
  style,
}: {
  card: number;
  faceUp?: boolean;
  deal?: boolean;
  delay?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const up = faceUp && card >= 0;
  return (
    <div
      className={`cd${up ? " is-up" : ""}${deal ? " is-dealt" : ""} ${className}`}
      style={{ ...style, animationDelay: deal ? `${delay}ms` : undefined }}
      role="img"
      aria-label={up ? cardLabel(card) : "Face-down card"}
    >
      <div className="cd-inner">
        <svg className="cd-side cd-front" viewBox="0 0 250 350" aria-hidden="true">
          {card >= 0 ? <Face card={card} /> : <Back />}
        </svg>
        <svg className="cd-side cd-back" viewBox="0 0 250 350" aria-hidden="true">
          <Back />
        </svg>
      </div>
    </div>
  );
});
