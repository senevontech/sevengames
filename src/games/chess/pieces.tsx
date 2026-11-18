/* Chess piece artwork: one SVG per piece type, coloured by the equipped piece set. */
import type { ChessPieceSet } from "../../lib/shopCatalog";

const BASE = "M10.5 37.5 h24 a2.5 2.5 0 0 1 2.5 2.5 v2 h-29 v-2 a2.5 2.5 0 0 1 2.5-2.5z";

// body paths per piece type (1 P … 6 K), 45 × 45 view box
const BODY: Record<number, string> = {
  1: "M22.5 9.5 a5 5 0 0 0-3.4 8.7 C16.6 19.7 15 22 15 24.5 h3.6 c-.6 4.4-3.3 8.4-6.1 11 v2 h20 v-2 c-2.8-2.6-5.5-6.6-6.1-11 H30 c0-2.5-1.6-4.8-4.1-6.3 A5 5 0 0 0 22.5 9.5z",
  2: "M15 37.5 c-.4-7 1.6-11 5.8-13.8 c-3.4.2-6.4 1.4-8.4 3.7 c-1.6-3.1-.8-6.6 2.2-9.6 c2.4-2.4 3.4-5.5 3.4-8.6 l2.6 3 l1.9-4.2 c7.6 2.4 12.4 9.8 12.4 20.2 v9.3z",
  3: "M22.5 11.4 c-5.3 3.8-8.3 8.9-6.5 14 c.9 2.6 3.2 3.9 6.5 3.9 s5.6-1.3 6.5-3.9 c1.8-5.1-1.2-10.2-6.5-14z M17.2 29.6 c-.9 3.6-2.8 6.1-4.7 7.9 h20 c-1.9-1.8-3.8-4.3-4.7-7.9z",
  4: "M12 10.5 h4.2 v3 h3.8 v-3 h5 v3 h3.8 v-3 H33 v7 l-3.2 3 v11.5 l3.2 3.5 v2 H12 v-2 l3.2-3.5 V20.5 L12 17.5z",
  5: "M10 14.5 L14 30.5 H31 L35 14.5 L29.4 22.4 L28.8 12.4 L25 21.6 L22.5 10.6 L20 21.6 L16.2 12.4 L15.6 22.4z M14 30.5 c0 2.6 1.2 4.6 2.6 7 h11.8 c1.4-2.4 2.6-4.4 2.6-7z",
  6: "M13 20.5 c-3.2-4.4.2-9.6 5.4-7.6 c2 .9 3.3 2.8 4.1 4.8 c.8-2 2.1-3.9 4.1-4.8 c5.2-2 8.6 3.2 5.4 7.6 L28.8 31 H16.2z M16.2 31 c-.4 2.6-1.4 4.6-3.2 6.5 h19 c-1.8-1.9-2.8-3.9-3.2-6.5z",
};

// small details drawn in the edge colour
const DETAIL: Record<number, string> = {
  2: "M26 15.5 a1.4 1.4 0 1 1 0 .01z",
  3: "M20.6 17.4 l4.2 4.2",
  4: "M15.2 20.5 h14.6 M15.2 32 h14.6",
  6: "M22.5 4 v8 M19 7.5 h7",
};

const BALLS: Record<number, [number, number][]> = {
  3: [[22.5, 9]],
  5: [
    [10, 13.6],
    [16.2, 11.4],
    [22.5, 9.6],
    [28.8, 11.4],
    [35, 13.6],
  ],
};

export function PieceSvg({ type, white, set, className }: { type: number; white: boolean; set: ChessPieceSet; className?: string }) {
  const fill = white ? set.white : set.black;
  const edge = white ? set.whiteEdge : set.blackEdge;
  return (
    <svg
      className={className}
      viewBox="0 0 45 45"
      aria-hidden="true"
      style={{ color: edge, filter: set.glow ? `${set.glow}` : undefined }}
    >
      <g fill={fill} stroke={edge} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round">
        <path d={BODY[type]} />
        <path d={BASE} />
        {(BALLS[type] ?? []).map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={type === 5 ? 1.9 : 2.2} />
        ))}
      </g>
      {DETAIL[type] ? (
        <path d={DETAIL[type]} fill={type === 2 ? edge : "none"} stroke={edge} strokeWidth={1.5} strokeLinecap="round" />
      ) : null}
    </svg>
  );
}
