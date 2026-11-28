/* Spacefall: every tunable number in one place — the ship's evolution stages, primary weapon
   tiers, enemy and boss definitions, pickups, regions and the difficulty curve. */

/** the world is a fixed 540 × 900 portrait field (scaled to the screen, never stretched) */
export const W = 540;
export const H = 900;

/* ---------------- the player's ship ---------------- */

export type StageSpec = {
  name: string;
  /** level at which this stage is reached */
  level: number;
  accent: string;
  /** engine glow colour (rgba) */
  flame: string;
  /** engine nozzles: [x, y, width] in ship units (ship faces up, centred) */
  nozzles: [number, number, number][];
  /** where the primary weapon's muzzle flashes appear */
  muzzles: [number, number][];
  /** drawn size of the ship (world units) */
  size: number;
  hp: number;
  shield: number;
  /** shield regeneration per second (after a short pause without damage) */
  regen: number;
  /** homing missiles per salvo */
  salvo: number;
  /** built-in combat drones */
  drones: number;
  /** auto mini-missiles every few seconds (advanced missile systems) */
  autoMissiles: number;
  /** special attack: 0 energy blast, 1 laser beam, 2 beam + blast */
  special: 0 | 1 | 2;
};

export const STAGES: StageSpec[] = [
  { name: "Scout", level: 1, accent: "#3ad0ff", flame: "rgba(90,200,255,1)", nozzles: [[0, 21, 8]], muzzles: [[0, -24]], size: 64, hp: 100, shield: 30, regen: 5, salvo: 2, drones: 0, autoMissiles: 0, special: 0 },
  { name: "Fighter", level: 4, accent: "#4f8cff", flame: "rgba(110,160,255,1)", nozzles: [[-6, 23, 7], [6, 23, 7]], muzzles: [[0, -27], [-21, -6], [21, -6]], size: 70, hp: 120, shield: 45, regen: 6, salvo: 2, drones: 0, autoMissiles: 0, special: 0 },
  { name: "Interceptor", level: 8, accent: "#2ee6b8", flame: "rgba(80,255,210,1)", nozzles: [[-7, 25, 7], [7, 25, 7]], muzzles: [[-8, -26], [8, -26], [-23, -6], [23, -6]], size: 78, hp: 140, shield: 70, regen: 9, salvo: 4, drones: 0, autoMissiles: 0, special: 0 },
  { name: "Heavy Assault", level: 13, accent: "#ff9a3c", flame: "rgba(255,170,80,1)", nozzles: [[-10, 28, 8], [0, 30, 9], [10, 28, 8]], muzzles: [[-12, -34], [12, -34], [-29, -8], [29, -8]], size: 88, hp: 170, shield: 90, regen: 10, salvo: 4, drones: 0, autoMissiles: 2, special: 0 },
  { name: "Elite Warship", level: 19, accent: "#b46cff", flame: "rgba(190,120,255,1)", nozzles: [[-14, 30, 8], [-5, 32, 8], [5, 32, 8], [14, 30, 8]], muzzles: [[0, -38], [-12, -32], [12, -32], [-42, -6], [42, -6]], size: 100, hp: 200, shield: 120, regen: 12, salvo: 6, drones: 1, autoMissiles: 2, special: 1 },
  { name: "Ultimate Destroyer", level: 26, accent: "#ffcc4a", flame: "rgba(255,90,110,1)", nozzles: [[-18, 32, 8], [-8, 35, 9], [0, 36, 9], [8, 35, 9], [18, 32, 8]], muzzles: [[0, -44], [-13, -36], [13, -36], [-46, -8], [46, -8]], size: 112, hp: 240, shield: 160, regen: 15, salvo: 8, drones: 2, autoMissiles: 4, special: 2 },
];

export function stageForLevel(level: number) {
  let s = 0;
  for (let i = 0; i < STAGES.length; i++) if (level >= STAGES[i].level) s = i;
  return s;
}

/** XP needed to go from `level` to the next */
export const xpToNext = (level: number) => Math.round(50 + 34 * (level - 1) + 3.2 * (level - 1) ** 2);

/* primary weapon tiers (auto fire). Each stream: x offset, angle (rad from straight up), kind */
export type ShotKind = 0 | 1 | 2 | 3 | 4 | 5; // plasma, cannon, spread, rapid energy, piercing lance, explosive shell
export type Stream = { x: number; a: number; kind: ShotKind };
export type Tier = { name: string; rate: number; dmg: number; streams: Stream[]; shells?: { rate: number; dmg: number; aoe: number } };

export const TIERS: Tier[] = [
  { name: "Plasma", rate: 0.17, dmg: 10, streams: [{ x: 0, a: 0, kind: 0 }] },
  { name: "Dual cannons", rate: 0.14, dmg: 10, streams: [{ x: -7, a: 0, kind: 1 }, { x: 7, a: 0, kind: 1 }] },
  { name: "Triple spread", rate: 0.13, dmg: 11, streams: [{ x: -7, a: 0, kind: 2 }, { x: 7, a: 0, kind: 2 }, { x: -12, a: -0.13, kind: 2 }, { x: 12, a: 0.13, kind: 2 }] },
  { name: "Rapid energy", rate: 0.085, dmg: 10, streams: [{ x: -8, a: 0, kind: 3 }, { x: 8, a: 0, kind: 3 }, { x: -16, a: -0.1, kind: 3 }, { x: 16, a: 0.1, kind: 3 }] },
  { name: "Piercing lances", rate: 0.1, dmg: 14, streams: [{ x: 0, a: 0, kind: 4 }, { x: -12, a: 0, kind: 4 }, { x: 12, a: 0, kind: 4 }, { x: -20, a: -0.14, kind: 3 }, { x: 20, a: 0.14, kind: 3 }] },
  {
    name: "Heavy shells",
    rate: 0.1,
    dmg: 15,
    streams: [{ x: 0, a: 0, kind: 4 }, { x: -12, a: 0, kind: 4 }, { x: 12, a: 0, kind: 4 }, { x: -22, a: -0.12, kind: 3 }, { x: 22, a: 0.12, kind: 3 }, { x: -28, a: -0.24, kind: 3 }, { x: 28, a: 0.24, kind: 3 }],
    shells: { rate: 0.42, dmg: 34, aoe: 46 },
  },
];
export const SHOT_SPEED = [880, 920, 940, 1050, 1150, 760];
export const SHOT_LOOK: { core: string; glow: string; w: number; len: number }[] = [
  { core: "#e8fbff", glow: "rgba(70,190,255,1)", w: 4, len: 14 },
  { core: "#fff6d8", glow: "rgba(255,190,70,1)", w: 4.5, len: 16 },
  { core: "#e6fff4", glow: "rgba(60,240,170,1)", w: 4.5, len: 16 },
  { core: "#fbe8ff", glow: "rgba(220,110,255,1)", w: 4, len: 20 },
  { core: "#ffffff", glow: "rgba(120,220,255,1)", w: 6, len: 34 },
  { core: "#fff1cf", glow: "rgba(255,140,50,1)", w: 9, len: 12 },
];

/* ---------------- enemies ---------------- */

export type EnemyKind =
  | "dart"
  | "tank"
  | "gunner"
  | "wing" // formation fighter
  | "kamikaze"
  | "rockS"
  | "rockL"
  | "rockIron"
  | "rockBoom"
  | "rockSplit"
  | "flyer"
  | "swift"
  | "brute"
  | "spitter"
  | "mine"
  | "mineProx"
  | "mineMove"
  | "mineCluster"
  | "mineMini"
  | "platform"
  | "launcher"
  | "drone"
  | "mother";

export type Size = 0 | 1 | 2 | 3; // small, medium, large, huge (explosions, drops and contact damage scale with it)

export type EnemyDef = {
  r: number;
  hp: number;
  speed: number;
  score: number;
  xp: number;
  size: Size;
  /** first level it can appear */
  from: number;
  /** spawn weight once unlocked */
  weight: number;
  /** how much "threat" it adds while alive (the director keeps the total under a cap) */
  threat: number;
  /** spawned as a group of this many */
  group?: number;
  /** "rock" | "alien" | "ship" | "mine": regions favour some families */
  family: "rock" | "alien" | "ship" | "mine";
};

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  dart: { r: 17, hp: 18, speed: 210, score: 60, xp: 5, size: 0, from: 1, weight: 10, threat: 1, family: "ship" },
  rockS: { r: 15, hp: 14, speed: 170, score: 30, xp: 3, size: 0, from: 1, weight: 8, threat: 0.6, family: "rock" },
  rockL: { r: 40, hp: 90, speed: 80, score: 120, xp: 12, size: 2, from: 1, weight: 4, threat: 2, family: "rock" },
  flyer: { r: 20, hp: 24, speed: 120, score: 80, xp: 7, size: 1, from: 2, weight: 6, threat: 1.2, family: "alien" },
  wing: { r: 16, hp: 16, speed: 230, score: 50, xp: 4, size: 0, from: 2, weight: 4, threat: 3, group: 5, family: "ship" },
  mine: { r: 18, hp: 20, speed: 0, score: 50, xp: 4, size: 1, from: 3, weight: 3, threat: 0.8, family: "mine" },
  gunner: { r: 24, hp: 55, speed: 140, score: 140, xp: 12, size: 1, from: 3, weight: 5, threat: 2, family: "ship" },
  rockSplit: { r: 36, hp: 70, speed: 95, score: 110, xp: 10, size: 2, from: 3, weight: 3, threat: 2, family: "rock" },
  kamikaze: { r: 16, hp: 16, speed: 150, score: 90, xp: 7, size: 0, from: 4, weight: 4, threat: 1.4, family: "ship" },
  swift: { r: 16, hp: 20, speed: 260, score: 90, xp: 7, size: 0, from: 4, weight: 4, threat: 1.3, family: "alien" },
  mineProx: { r: 18, hp: 26, speed: 0, score: 70, xp: 5, size: 1, from: 5, weight: 3, threat: 1, family: "mine" },
  drone: { r: 11, hp: 10, speed: 190, score: 30, xp: 3, size: 0, from: 5, weight: 3, threat: 3, group: 6, family: "ship" },
  spitter: { r: 24, hp: 50, speed: 90, score: 150, xp: 12, size: 1, from: 6, weight: 4, threat: 2, family: "alien" },
  rockIron: { r: 32, hp: 160, speed: 85, score: 160, xp: 14, size: 2, from: 6, weight: 2, threat: 2, family: "rock" },
  tank: { r: 32, hp: 160, speed: 70, score: 260, xp: 22, size: 2, from: 7, weight: 3, threat: 3, family: "ship" },
  platform: { r: 30, hp: 120, speed: 0, score: 220, xp: 18, size: 2, from: 8, weight: 2, threat: 3, family: "ship" },
  rockBoom: { r: 30, hp: 60, speed: 100, score: 130, xp: 10, size: 2, from: 8, weight: 2, threat: 1.5, family: "rock" },
  mineMove: { r: 18, hp: 30, speed: 60, score: 80, xp: 6, size: 1, from: 9, weight: 2, threat: 1.2, family: "mine" },
  brute: { r: 34, hp: 220, speed: 75, score: 300, xp: 24, size: 2, from: 11, weight: 2, threat: 3, family: "alien" },
  launcher: { r: 30, hp: 140, speed: 90, score: 280, xp: 22, size: 2, from: 12, weight: 2, threat: 3, family: "ship" },
  mineCluster: { r: 24, hp: 50, speed: 0, score: 120, xp: 9, size: 1, from: 14, weight: 2, threat: 1.6, family: "mine" },
  mineMini: { r: 9, hp: 6, speed: 0, score: 15, xp: 1, size: 0, from: 999, weight: 0, threat: 0.3, family: "mine" },
  mother: { r: 74, hp: 1500, speed: 40, score: 1500, xp: 120, size: 3, from: 9, weight: 0, threat: 8, family: "ship" },
};

export const ENEMY_KINDS = Object.keys(ENEMIES) as EnemyKind[];

/* ---------------- bosses ---------------- */

export const BOSS_NAMES = ["Armored Cruiser", "Alien Leviathan", "Dreadnought", "Cosmic Destroyer"];
/** a boss every BOSS_EVERY levels (5, 10, 15 …) */
export const BOSS_EVERY = 5;
export const BOSS_HP = [2400, 3600, 5200, 7200];

/* ---------------- pickups ---------------- */

export type PickupKind = "weapon" | "missiles" | "shield" | "repair" | "rapid" | "damage" | "invincible" | "bomb" | "drone" | "xp";
export type Rarity = 0 | 1 | 2 | 3; // common, uncommon, rare, epic

export const PICKUPS: Record<PickupKind, { label: string; glyph: string; color: string; rarity: Rarity; weight: number }> = {
  missiles: { label: "Missiles", glyph: "M", color: "#ffb347", rarity: 0, weight: 10 },
  repair: { label: "Repair", glyph: "+", color: "#5cff8a", rarity: 0, weight: 9 },
  xp: { label: "XP boost", glyph: "XP", color: "#7fe3ff", rarity: 0, weight: 7 },
  shield: { label: "Shield", glyph: "S", color: "#59d8ff", rarity: 1, weight: 6 },
  rapid: { label: "Rapid fire", glyph: "R", color: "#ff7ad9", rarity: 1, weight: 5 },
  bomb: { label: "Bomb", glyph: "B", color: "#ff5a4a", rarity: 1, weight: 5 },
  weapon: { label: "Weapon upgrade", glyph: "W", color: "#ffe14a", rarity: 2, weight: 4 },
  damage: { label: "Damage ×2", glyph: "×2", color: "#ff8a3d", rarity: 2, weight: 3 },
  drone: { label: "Combat drone", glyph: "D", color: "#a9b6ff", rarity: 2, weight: 3 },
  invincible: { label: "Invincible", glyph: "★", color: "#ffd84a", rarity: 3, weight: 1.2 },
};
export const PICKUP_KINDS = Object.keys(PICKUPS) as PickupKind[];
export const RARITY_RING = ["rgba(230,236,255,1)", "rgba(90,255,140,1)", "rgba(90,170,255,1)", "rgba(200,110,255,1)"];

/* ---------------- regions: every boss takes you somewhere new ---------------- */

export type Region = {
  name: string;
  /** background gradient (top → bottom) */
  sky: [string, string, string];
  /** nebula colours (rgba) */
  nebula: [string, string];
  planet: { a: string; b: string; ring: boolean; atmo: string } | null;
  /** family weight multipliers */
  favour: Partial<Record<EnemyDef["family"], number>>;
  dust: string;
};

export const REGIONS: Region[] = [
  { name: "Deep Space", sky: ["#02040b", "#061230", "#020510"], nebula: ["rgba(40,80,180,0.55)", "rgba(20,40,110,0.5)"], planet: { a: "#4a7bd6", b: "#0b1a3e", ring: false, atmo: "rgba(90,160,255,0.6)" }, favour: {}, dust: "rgba(170,200,255,1)" },
  { name: "Crimson Nebula", sky: ["#08020a", "#2a0a2e", "#0a0310"], nebula: ["rgba(200,50,140,0.5)", "rgba(110,40,190,0.5)"], planet: null, favour: { alien: 1.4 }, dust: "rgba(255,170,220,1)" },
  { name: "Asteroid Belt", sky: ["#050403", "#1d140c", "#070504"], nebula: ["rgba(150,100,50,0.4)", "rgba(90,70,50,0.4)"], planet: { a: "#c9884a", b: "#3a1e0a", ring: true, atmo: "rgba(255,180,110,0.45)" }, favour: { rock: 2.2, mine: 1.3 }, dust: "rgba(230,200,160,1)" },
  { name: "Gas Giant Reach", sky: ["#020608", "#0a2430", "#03080b"], nebula: ["rgba(40,160,170,0.45)", "rgba(30,90,140,0.45)"], planet: { a: "#e2b46a", b: "#4a2a12", ring: true, atmo: "rgba(255,210,140,0.5)" }, favour: { ship: 1.4 }, dust: "rgba(170,240,255,1)" },
  { name: "Alien Territory", sky: ["#020803", "#0b2a12", "#030a05"], nebula: ["rgba(60,200,90,0.45)", "rgba(120,220,60,0.35)"], planet: { a: "#7a4ad6", b: "#160a3a", ring: false, atmo: "rgba(160,110,255,0.6)" }, favour: { alien: 2.2 }, dust: "rgba(170,255,170,1)" },
  { name: "Cosmic Rift", sky: ["#07050a", "#241a08", "#0a0704"], nebula: ["rgba(255,190,60,0.4)", "rgba(220,80,60,0.4)"], planet: { a: "#d65a3a", b: "#2a0806", ring: false, atmo: "rgba(255,120,80,0.55)" }, favour: { ship: 1.3, mine: 1.4, alien: 1.2 }, dust: "rgba(255,220,150,1)" },
];

/* ---------------- difficulty: staggered so not everything rises at once ---------------- */

export function difficulty(level: number) {
  const L = Math.max(1, level);
  return {
    /** enemy health: every level */
    hp: 1 + 0.11 * (L - 1),
    /** damage they deal: every 2nd level, capped */
    dmg: 1 + Math.min(1.2, 0.07 * Math.floor(L / 2)),
    /** movement speed: odd levels, capped */
    speed: 1 + Math.min(0.55, 0.035 * Math.floor((L + 1) / 2)),
    /** firing frequency: every 2nd level (offset), capped */
    fire: 1 + Math.min(0.9, 0.06 * Math.floor(L / 2)),
    /** enemy projectile speed: every 3rd level, capped */
    shot: 1 + Math.min(0.5, 0.06 * Math.floor(L / 3)),
    /** seconds between spawns: every 3rd level (offset), floored */
    spawn: Math.max(0.42, 1.1 - 0.06 * Math.floor((L + 1) / 3)),
    /** how much threat may be on screen at once */
    threat: Math.min(34, 6 + L * 0.9),
  };
}
