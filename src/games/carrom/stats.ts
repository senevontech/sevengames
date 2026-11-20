/* Striker stats: what each level does in the physics, what upgrades cost and when they unlock.
   The numbers here MUST match supabase/carrom.sql (_carrom_upgrade_cost / _carrom_upgrade_gate),
   which is what actually charges tokens; this file only explains and applies them. */

export type StatKey = "power" | "weight" | "aim";
export type StrikerStats = Record<StatKey, number>; // each 1..10

export const STAT_MAX = 10;
export const STATS: { key: StatKey; label: string; blurb: string }[] = [
  { key: "power", label: "Power", blurb: "Faster top speed" },
  { key: "weight", label: "Weight", blurb: "Hits harder, breaks clusters" },
  { key: "aim", label: "Aim", blurb: "Longer guide, shot preview" },
];

/** Online matches: everyone plays with the same stats so it stays fair. */
export const FAIR_STATS: StrikerStats = { power: 5, weight: 5, aim: 5 };
/** The CPU, with the same striker for every player: mid-level power and weight (about what
 *  level 6 gave before the upgrade curves were widened), so upgraded strikers out-hit it. */
export const CPU_STATS: StrikerStats = { power: 4, weight: 4, aim: 10 };
export const BASE_STATS: StrikerStats = { power: 1, weight: 1, aim: 1 };

const lerp = (lv: number, a: number, b: number) => a + ((b - a) * (Math.min(STAT_MAX, Math.max(1, lv)) - 1)) / (STAT_MAX - 1);

/** Top shot speed (board units / s): +35% from level 1 to 10, so upgrades are clearly felt. */
export const maxSpeedFor = (power: number) => lerp(power, 2040, 2750);
/** Striker mass (coins weigh 1): +45% from level 1 to 10 — heavy strikers break clusters. */
export const massFor = (weight: number) => lerp(weight, 1.7, 2.45);

/** Premium strikers (Pro or top-price skins). */
export const isPremiumStriker = (skin: { shop: { price: number; pro?: boolean } }) => Boolean(skin.shop.pro) || skin.shop.price >= 1400;

/** On this device, premium strikers play one level above their stats in power and weight. */
export const playStats = (s: StrikerStats, premium: boolean): StrikerStats =>
  premium ? { power: Math.min(STAT_MAX, s.power + 1), weight: Math.min(STAT_MAX, s.weight + 1), aim: s.aim } : s;

/** Extra seconds per turn: +2 s per upgrade tier (see tierOf) and +3 s for a premium striker. */
export const turnBonusSeconds = (s: StrikerStats, premium: boolean) => tierOf(s) * 2 + (premium ? 3 : 0);
/** Aim guide length multiplier. */
export const aimReachFor = (aim: number) => lerp(aim, 0.55, 1.6);
/** Aim 4+: shows where the first coin you hit will go. */
export const AIM_TARGET_LINE = 4;
/** Aim 7+: also shows the striker's own path after contact and its first wall bounce. */
export const AIM_FULL_PREVIEW = 7;

/** Tokens to raise a stat TO `target`. */
export const upgradeCost = (target: number) =>
  ({ 2: 80, 3: 120, 4: 180, 5: 260, 6: 360, 7: 500, 8: 700, 9: 950, 10: 1300 } as Record<number, number>)[target] ?? 0;

/** Player level needed to raise a stat TO `target` (the "high power" tiers). */
export const upgradeGate = (target: number) => (target >= 10 ? 14 : target === 9 ? 10 : target === 8 ? 7 : target === 7 ? 4 : 1);

/** Visual tier from the striker's best stat: 0 plain · 1 extra ring (4+) · 2 glow (7+) · 3 trail (10). */
export const tierOf = (s: StrikerStats) => {
  const top = Math.max(s.power, s.weight, s.aim);
  return top >= 10 ? 3 : top >= 7 ? 2 : top >= 4 ? 1 : 0;
};

export const effectiveStats = (base: StrikerStats, steps?: Partial<StrikerStats>): StrikerStats => ({
  power: Math.min(STAT_MAX, base.power + (steps?.power ?? 0)),
  weight: Math.min(STAT_MAX, base.weight + (steps?.weight ?? 0)),
  aim: Math.min(STAT_MAX, base.aim + (steps?.aim ?? 0)),
});
