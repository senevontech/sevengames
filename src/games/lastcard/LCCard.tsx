/* One Card's own card design (SVG, 120 × 180), bold and flat so it reads at phone size:
   a white rim, a flat colour face with a soft lighter band, a big white symbol with a thick dark
   outline (and a flat offset shadow), small outlined symbols in two corners. Wilds are ink-black
   with a 2×2 four-colour tile. The back is deep indigo with the One Card tile mark.
   Cheap to draw: no SVG filters or gradients on the face; the card's shadow is a CSS box-shadow. */
import { memo } from "react";
import { COLOR_HEX, D2, REV, SKIP, W4, WILD, WILD_COLOR, cardName, cardOf } from "./engine";

const OUTLINE = "#16171c";
const FONT = "Poppins, system-ui, sans-serif";

/** the symbol for a value, centred on (0, 0), about `s` tall: white, outlined, with a flat shadow */
function Glyph({ v, s, outline = true }: { v: number; s: number; outline?: boolean }) {
  const sw = outline ? Math.max(2, s * 0.09) : 0;
  const shadow = outline ? s * 0.06 : 0;
  const draw = (dx: number, fill: string, stroke: string) => {
    if (v <= 9 || v === D2 || v === W4) {
      const text = v <= 9 ? String(v) : v === D2 ? "+2" : "+4";
      const size = v <= 9 ? s : s * 0.8;
      return (
        <text x={dx} y={size * 0.36 + dx} textAnchor="middle" fontSize={size} fontWeight={900} fontFamily={FONT} fill={fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" paintOrder="stroke">
          {text}
          {v === 6 || v === 9 ? <tspan fontSize={size * 0.45}>_</tspan> : null}
        </text>
      );
    }
    if (v === SKIP) {
      const r = s * 0.34;
      return (
        <g transform={`translate(${dx} ${dx})`}>
          <circle r={r} fill="none" stroke={stroke} strokeWidth={s * 0.11 + sw} />
          <path d={`M${-r * 0.68} ${r * 0.68}L${r * 0.68} ${-r * 0.68}`} stroke={stroke} strokeWidth={s * 0.11 + sw} strokeLinecap="round" />
          <circle r={r} fill="none" stroke={fill} strokeWidth={s * 0.11} />
          <path d={`M${-r * 0.68} ${r * 0.68}L${r * 0.68} ${-r * 0.68}`} stroke={fill} strokeWidth={s * 0.11} strokeLinecap="round" />
        </g>
      );
    }
    if (v === REV) {
      const r = s * 0.3;
      const w = s * 0.11;
      const d = `M${-r} ${-r * 0.1}A${r} ${r} 0 0 1 ${r * 0.75} ${-r * 0.65} M${r * 0.35} ${-r * 1.05}L${r * 0.8} ${-r * 0.62}L${r * 0.3} ${-r * 0.28} M${r} ${r * 0.1}A${r} ${r} 0 0 1 ${-r * 0.75} ${r * 0.65} M${-r * 0.35} ${r * 1.05}L${-r * 0.8} ${r * 0.62}L${-r * 0.3} ${r * 0.28}`;
      return (
        <g transform={`translate(${dx} ${dx})`} fill="none" strokeLinecap="round" strokeLinejoin="round">
          {stroke !== "none" ? <path d={d} stroke={stroke} strokeWidth={w + sw} /> : null}
          <path d={d} stroke={fill} strokeWidth={w} />
        </g>
      );
    }
    return null;
  };
  return (
    <>
      {shadow ? draw(shadow, "rgba(0,0,0,0.28)", "rgba(0,0,0,0.28)") : null}
      {draw(0, "#fff", outline ? OUTLINE : "none")}
    </>
  );
}

/** the wild's four-colour tile (2 × 2 rounded squares), centred, `s` across */
function Tile({ s, gap = 0.1 }: { s: number; gap?: number }) {
  const g = s * gap;
  const q = (s - g) / 2;
  const r = q * 0.22;
  const pos = [
    [-s / 2, -s / 2],
    [g / 2, -s / 2],
    [g / 2, g / 2],
    [-s / 2, g / 2],
  ];
  return (
    <g>
      {pos.map(([x, y], i) => (
        <rect key={i} x={x} y={y} width={q} height={q} rx={r} fill={COLOR_HEX[i]} />
      ))}
    </g>
  );
}

function Back() {
  return (
    <>
      <rect x={0} y={0} width={120} height={180} rx={12} fill="#fff" />
      <rect x={5} y={5} width={110} height={170} rx={9} fill="#1c2251" />
      <path d="M5 60 L115 20 L115 60 L5 100 Z M5 140 L115 100 L115 140 L5 180 Z" fill="#232a62" />
      <g transform="translate(60 84) rotate(-12)">
        <rect x={-30} y={-30} width={60} height={60} rx={12} fill="#111536" />
        <Tile s={44} />
      </g>
      <text x={60} y={146} textAnchor="middle" fontSize={15} fontWeight={900} letterSpacing={1} fontFamily={FONT} fill="#fff">
        ONE CARD
      </text>
    </>
  );
}

/** nothing to share any more (the face is flat); kept so pages that render it still work */
export function LCDefs() {
  return null;
}

export const LCCard = memo(function LCCard({ card, faceUp = true, className = "" }: { card: number; faceUp?: boolean; className?: string }) {
  if (!faceUp || card < 0) {
    return (
      <svg className={`lc-card ${className}`} viewBox="0 0 120 180" role="img" aria-label="Face-down card">
        <Back />
      </svg>
    );
  }
  const { c, v } = cardOf(card);
  const wild = c === WILD_COLOR;
  const face = wild ? "#1b1c22" : COLOR_HEX[c];
  return (
    <svg className={`lc-card ${className}`} viewBox="0 0 120 180" role="img" aria-label={cardName(card)}>
      <rect x={0} y={0} width={120} height={180} rx={12} fill="#fff" />
      <rect x={5} y={5} width={110} height={170} rx={9} fill={face} />
      {/* a soft lighter band across the middle */}
      <path d="M5 70 L115 50 L115 120 L5 140 Z" fill="#fff" opacity={wild ? 0.05 : 0.12} />
      <g transform="translate(60 92)">
        {wild ? (
          <>
            <Tile s={v === WILD ? 58 : 46} />
            {v === W4 ? (
              <g transform="translate(0 46)">
                <Glyph v={W4} s={30} />
              </g>
            ) : null}
          </>
        ) : (
          <Glyph v={v} s={v <= 9 ? 76 : 70} />
        )}
      </g>
      {/* corners */}
      <g transform="translate(20 25)">{wild ? v === WILD ? <Tile s={20} gap={0.14} /> : <Glyph v={W4} s={22} /> : <Glyph v={v} s={26} />}</g>
      <g transform="translate(100 155) rotate(180)">{wild ? v === WILD ? <Tile s={20} gap={0.14} /> : <Glyph v={W4} s={22} /> : <Glyph v={v} s={26} />}</g>
    </svg>
  );
});
