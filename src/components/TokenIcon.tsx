import { useId } from "react";
import { sgPath } from "./chip/sgMark";

/**
 * The Chip (the site's currency, stored as "tokens" in the database): the Seven Game Studio
 * poker chip from public/images/chip/chip-design.png, flattened for small sizes.
 * A matte-black body, eight raised edge segments, a glowing orange LED ring and the geometric
 * SG monogram. The full 3D chip is components/chip/Chip3D.tsx; this is its icon.
 *
 * Numeric sizes render a little larger than asked (SCALE) so the chip reads next to text.
 */
export const TOKEN_COLOR = "#FF6500";
export const CHIP_LED = TOKEN_COLOR;
const SCALE = 1.15;

/* ---- static geometry (viewBox 0 0 64 64, centre 32,32) ---- */
const C = 32;
const f = (n: number) => +n.toFixed(2);
/** an annular sector: radii r0..r1, centred on angle `mid` (deg, 0 = up), `span` wide */
function sector(r0: number, r1: number, mid: number, span: number) {
  const a0 = ((mid - span / 2 - 90) * Math.PI) / 180;
  const a1 = ((mid + span / 2 - 90) * Math.PI) / 180;
  const p = (r: number, a: number) => `${f(C + r * Math.cos(a))} ${f(C + r * Math.sin(a))}`;
  return `M${p(r1, a0)}A${r1} ${r1} 0 0 1 ${p(r1, a1)}L${p(r0, a1)}A${r0} ${r0} 0 0 0 ${p(r0, a0)}Z`;
}
/** eight raised segments round the edge, a groove between each (the 3D chip uses the same layout) */
const SEGMENTS = Array.from({ length: 8 }, (_, i) => sector(23.6, 30.4, 22.5 + i * 45, 31)).join("");
const SG = sgPath(C, C, 20.5);
/* small sizes (nav pill, prices): fewer, bolder parts so it stays crisp at 14-28 px */
/** the eight glowing LED arcs between the edge blocks (as on the chip seen from above) */
const SMALL_ARCS = Array.from({ length: 8 }, (_, i) => sector(22, 27.6, i * 45, 27)).join("");
const SMALL_SG = sgPath(C, C, 29);
/** at or below this many CSS pixels the compact drawing is used */
const SMALL_AT = 30;

export default function TokenIcon({ size = 16, className = "", title }: { size?: number | string; className?: string; title?: string }) {
  const id = useId().replace(/:/g, "");
  const px = typeof size === "number" ? Math.round(size * SCALE) : size;
  const body = `chb-${id}`;
  const seg = `chs-${id}`;
  const face = `chf-${id}`;
  const small = typeof size === "number" && size * SCALE <= SMALL_AT;
  if (small) {
    return (
      <svg
        width={px}
        height={px}
        viewBox="0 0 64 64"
        className={`token-icon chip-icon is-small ${className}`.trim()}
        role={title ? "img" : undefined}
        aria-label={title}
        aria-hidden={title ? undefined : true}
        focusable="false"
      >
        <defs>
          <radialGradient id={body} cx="0.35" cy="0.3" r="0.8">
            <stop offset="0" stopColor="#34343a" />
            <stop offset="1" stopColor="#0c0c0e" />
          </radialGradient>
        </defs>
        {/* black chip, eight orange LED arcs round the edge, the SG in the middle */}
        <circle cx={C} cy={C} r="31.5" fill={`url(#${body})`} />
        <path className="chip-led" d={SMALL_ARCS} fill="#ff6a10" />
        <circle cx={C} cy={C} r="19.6" fill="#141416" />
        <path d={SMALL_SG} fill="#ff7a1a" />
      </svg>
    );
  }
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 64 64"
      preserveAspectRatio="xMidYMid meet"
      className={`token-icon chip-icon ${className}`.trim()}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <defs>
        {/* matte black, lit from the top left */}
        <radialGradient id={body} cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#2e2e33" />
          <stop offset="0.6" stopColor="#18181b" />
          <stop offset="1" stopColor="#0b0b0d" />
        </radialGradient>
        <linearGradient id={seg} x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor="#4a4a50" />
          <stop offset="0.45" stopColor="#2c2c31" />
          <stop offset="1" stopColor="#17171a" />
        </linearGradient>
        <radialGradient id={face} cx="0.4" cy="0.35" r="0.75">
          <stop offset="0" stopColor="#202024" />
          <stop offset="1" stopColor="#0e0e10" />
        </radialGradient>
      </defs>
      {/* body + bevelled rim */}
      <circle cx={C} cy={C} r="30.6" fill={`url(#${body})`} stroke="#050506" strokeWidth="1.4" />
      {/* the raised edge segments */}
      <path d={SEGMENTS} fill={`url(#${seg})`} stroke="#0a0a0b" strokeWidth="0.8" strokeLinejoin="round" />
      {/* LED ring: a soft glow under a bright core */}
      <circle className="chip-glow" cx={C} cy={C} r="21.2" fill="none" stroke={CHIP_LED} strokeOpacity="0.35" strokeWidth="5" />
      <circle className="chip-led" cx={C} cy={C} r="21.2" fill="none" stroke="#ff8a2e" strokeWidth="2.2" />
      {/* the centre inset */}
      <circle cx={C} cy={C} r="18.4" fill={`url(#${face})`} stroke="#050506" strokeWidth="1" />
      <circle cx={C} cy={C} r="17.2" fill="none" stroke="#2a2a2f" strokeWidth="0.6" />
      {/* SG monogram */}
      <path d={SG} fill="#ff7314" />
    </svg>
  );
}
