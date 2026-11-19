import { useEffect, useId } from "react";

/* The glint: one shared timer sweeps every token icon's glint once every few seconds (alternate
   icons a little later). An endless CSS animation did the same, but kept the browser restyling
   and repainting the SVG on every frame even while the glint sat still between sweeps. */
const GLINT_EVERY = 5500;
let glintUsers = 0;
let glintTimer = 0;
function sweepGlints() {
  if (document.hidden || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const glints = [...document.querySelectorAll<SVGElement>(".token-icon .token-glint")];
  // no animation `delay` (an animation waiting out its delay still counts as running)
  const sweep = (odd: number) =>
    glints.forEach((el, i) => {
      if (i % 2 === odd && el.isConnected) el.animate([{ transform: "translateX(0)" }, { transform: "translateX(32px)" }], { duration: 1260, easing: "ease-in-out" });
    });
  sweep(0);
  window.setTimeout(() => sweep(1), 1400);
}
function useGlintTimer() {
  useEffect(() => {
    if (glintUsers++ === 0 && typeof Element.prototype.animate === "function") glintTimer = window.setInterval(sweepGlints, GLINT_EVERY);
    return () => {
      if (--glintUsers === 0) window.clearInterval(glintTimer);
    };
  }, []);
}

/**
 * Senevon token: a filled, rounded lightning bolt in electric lime (#9EFF00), no background,
 * finished like polished metal: a lime-to-deep-green gradient body, a dark bevelled rim,
 * a bright edge highlight and a glint that sweeps across now and then.
 *
 * Numeric sizes render a little larger than asked (SCALE) so the bolt reads clearly next to
 * text; the viewBox is cropped tight around the bolt for the same reason.
 */
export const TOKEN_COLOR = "#9EFF00";
const SCALE = 1.25;

const BOLT = "M13.4 2.6 5.6 12.4c-.3.4 0 1 .5 1h5.2l-.9 7.3c-.1.6.7.9 1 .4l7.9-9.9c.3-.4 0-1-.5-1h-5.3l1-7.2c.1-.6-.7-.9-1.1-.4Z";

export default function TokenIcon({ size = 16, className = "", title }: { size?: number | string; className?: string; title?: string }) {
  const id = useId().replace(/:/g, "");
  useGlintTimer();
  const px = typeof size === "number" ? Math.round(size * SCALE) : size;
  const face = `tkf-${id}`;
  const edge = `tke-${id}`;
  const glint = `tkg-${id}`;
  const clip = `tkc-${id}`;
  return (
    <svg
      width={px}
      height={px}
      viewBox="2.5 1 19 22"
      preserveAspectRatio="xMidYMid meet"
      className={`token-icon ${className}`.trim()}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <defs>
        {/* polished lime body: bright top-left, deep green bottom-right */}
        <linearGradient id={face} x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor="#f3ffcf" />
          <stop offset="0.22" stopColor="#ccff5c" />
          <stop offset="0.48" stopColor={TOKEN_COLOR} />
          <stop offset="0.72" stopColor="#74cc00" />
          <stop offset="1" stopColor="#3b6e00" />
        </linearGradient>
        {/* highlight along the upper edges only */}
        <linearGradient id={edge} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="0.45" stopColor="#ffffff" stopOpacity="0.25" />
          <stop offset="0.6" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={glint} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.85" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <clipPath id={clip}>
          <path d={BOLT} />
        </clipPath>
      </defs>

      {/* bevelled rim: a darker outline just outside the body */}
      <path d={BOLT} fill="#2f5800" stroke="#2f5800" strokeWidth="3" strokeLinejoin="round" />
      {/* body */}
      <path d={BOLT} fill={`url(#${face})`} stroke={`url(#${face})`} strokeWidth="1.8" strokeLinejoin="round" />
      {/* edge highlight + sweeping glint, kept inside the bolt */}
      <g clipPath={`url(#${clip})`}>
        <path d={BOLT} fill="none" stroke={`url(#${edge})`} strokeWidth="1.6" strokeLinejoin="round" />
        <g transform="rotate(20 12 12)">
          <rect className="token-glint" x="-6" y="-4" width="5" height="32" fill={`url(#${glint})`} />
        </g>
      </g>
    </svg>
  );
}
