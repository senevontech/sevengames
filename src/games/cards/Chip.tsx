/* Casino chips (SVG): a coloured disc with edge inserts, an inner ring and the value.
   Values and colours are the same in every card game. */
import { memo } from "react";

export const CHIP_VALUES = [10, 50, 100, 500, 1000, 5000] as const;
const CHIP_COLORS: Record<number, { base: string; edge: string; text: string }> = {
  10: { base: "#f4f1ea", edge: "#2b6cb0", text: "#2b6cb0" },
  50: { base: "#c8102e", edge: "#ffffff", text: "#ffffff" },
  100: { base: "#1d7a46", edge: "#ffffff", text: "#ffffff" },
  500: { base: "#1b1b1f", edge: "#e9c46a", text: "#e9c46a" },
  1000: { base: "#6b2fb3", edge: "#ffd36b", text: "#ffffff" },
  5000: { base: "#e86a10", edge: "#1b1b1f", text: "#1b1b1f" },
};

export const shortChips = (n: number) => (n >= 1000 ? `${n % 1000 === 0 ? n / 1000 : (n / 1000).toFixed(1)}K` : String(n));

export const Chip = memo(function Chip({ value, size = 44 }: { value: number; size?: number }) {
  const c = CHIP_COLORS[value] ?? CHIP_COLORS[10];
  return (
    <svg className="chip" width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <circle cx={50} cy={50} r={48} fill={c.base} />
      {[0, 60, 120, 180, 240, 300].map((a) => (
        <rect key={a} x={44} y={2} width={12} height={16} rx={2} fill={c.edge} transform={`rotate(${a} 50 50)`} />
      ))}
      <circle cx={50} cy={50} r={34} fill="none" stroke={c.edge} strokeWidth={2.5} strokeDasharray="5 4" />
      <circle cx={50} cy={50} r={28} fill={c.base} stroke="rgba(0,0,0,0.25)" strokeWidth={1.5} />
      <text x={50} y={58} textAnchor="middle" fontFamily="system-ui, sans-serif" fontWeight={800} fontSize={value >= 1000 ? 22 : 24} fill={c.text}>
        {shortChips(value)}
      </text>
      {/* top light */}
      <ellipse cx={42} cy={30} rx={26} ry={12} fill="#fff" opacity={0.12} />
    </svg>
  );
});

/** Break an amount into chips (largest first), at most `max` chips for the picture. */
export function chipBreakdown(amount: number, max = 8) {
  const out: number[] = [];
  let left = amount;
  for (const v of [...CHIP_VALUES].reverse()) {
    while (left >= v && out.length < max) {
      out.push(v);
      left -= v;
    }
  }
  return out;
}

/** A neat stack of chips for an amount (a bet on the felt), with its value underneath. */
export function ChipStack({ amount, size = 38, label = true }: { amount: number; size?: number; label?: boolean }) {
  const chips = chipBreakdown(amount);
  return (
    <div className="chip-stack" style={{ height: size + (chips.length - 1) * 5 + (label ? 20 : 0) }}>
      {chips.map((v, i) => (
        <span key={i} className="chip-stack-chip" style={{ bottom: (label ? 20 : 0) + i * 5, zIndex: i }}>
          <Chip value={v} size={size} />
        </span>
      ))}
      {label && amount > 0 ? <b className="chip-stack-amt">{amount.toLocaleString()}</b> : null}
    </div>
  );
}
