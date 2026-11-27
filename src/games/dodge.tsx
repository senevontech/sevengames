import { useEffect, useRef, useState } from "react";
import type { GameProps } from "./index";
import { Particles, Shake, glow, reducedMotion, setupCanvas } from "./fx";
import { isLite } from "../lib/perf";

/*
 * Dodge: pilot a ship through a meteor shower and the creatures that live in it. The ship's
 * blaster fires on its own; steer to aim. Meteors and creatures come in types, some tougher than
 * others, and new ones show up the longer you last. One hit ends the run (unless a shield takes it).
 * Score = 10 per second survived + 5 per near miss + points per kill (quick kills chain a combo)
 * + 25 per power-up.
 *
 * Weapon upgrades: destroyed foes sometimes drop a capsule (tough ones more often, and one is
 * guaranteed if none has dropped for a while):
 *   P  power     damage per shot (4 levels; the bolts change colour)
 *   W  rows      laser streams: 2 → 3 → 4 → 5 → 7, fanning out
 *   R  rate      fire rate (5 levels)
 *   ★  special   mega laser beam · homing missiles · shield (absorbs one hit) · nova blast
 * Foes get tougher with time, so the upgrades keep pace instead of trivialising the run.
 *
 * Built for slow phones: every meteor / creature / planet / capsule body, the ship, the nebula and
 * the vignette are drawn once into offscreen canvases and only copied (drawImage) each frame;
 * glows use the shared glow sprite (no shadowBlur); fixed pools for foes, shots, missiles,
 * capsules and particles. Lite mode and "reduce motion" drop the per-shot glows and trails.
 */

const W = 320;
const H = 460;
const SHIP_Y = H - 58;
const SHIP_W = 34;
const SHIP_H = 40;
const MAX_FOES = 40;
const MAX_SHOTS = 128;
const MAX_MISSILES = 24;
const MAX_DROPS = 8;
const SHOT_SPEED = 560;
const COMBO_WINDOW = 1.6;

/* ---------------- weapon upgrades ---------------- */
/** damage per shot, by power level */
const POWER = [1, 1.5, 2.1, 2.8];
/** seconds between volleys, by fire-rate level */
const RATE = [0.2, 0.17, 0.145, 0.122, 0.1];
/** laser rows: [x offset from the ship, angle in radians from straight up] per stream */
const ROWS: [number, number][][] = [
  [[-9, 0], [9, 0]],
  [[-10, 0], [0, 0], [10, 0]],
  [[-9, 0], [9, 0], [-13, -0.14], [13, 0.14]],
  [[-10, 0], [0, 0], [10, 0], [-13, -0.15], [13, 0.15]],
  [[-10, 0], [0, 0], [10, 0], [-13, -0.13], [13, 0.13], [-16, -0.28], [16, 0.28]],
];
/** what a bolt looks like at each power level */
const SHOT_LOOK = [
  { core: "#fff3c4", glow: "rgba(255,140,60,0.9)", w: 3, len: 12 },
  { core: "#ffe3e3", glow: "rgba(255,70,70,0.9)", w: 3.6, len: 14 },
  { core: "#ffe8fb", glow: "rgba(255,70,210,0.9)", w: 4.2, len: 16 },
  { core: "#eef8ff", glow: "rgba(90,180,255,0.95)", w: 5, len: 18 },
];
const LASER_TIME = 5;
const LASER_DPS = 16;
const MISSILE_TIME = 8;
const MISSILE_EVERY = 0.45;
const MISSILE_DMG = 3;
/** a capsule is guaranteed after this long without one */
const DROP_PITY = 15;

type DropKind = "power" | "rows" | "rate" | "special";
const DROP_LOOK: Record<DropKind, { letter: string; color: string; glow: string }> = {
  power: { letter: "P", color: "#ff5a4a", glow: "rgba(255,90,70,0.9)" },
  rows: { letter: "W", color: "#3d9bff", glow: "rgba(80,170,255,0.9)" },
  rate: { letter: "R", color: "#2fe07a", glow: "rgba(80,255,140,0.9)" },
  special: { letter: "★", color: "#b45cff", glow: "rgba(200,120,255,0.9)" },
};
const DROP_KINDS = Object.keys(DROP_LOOK) as DropKind[];

type Kind = "pebble" | "rock" | "boulder" | "comet" | "jelly" | "stinger" | "eye";
type KindDef = {
  r: [number, number];
  hp: number;
  pts: number;
  v: [number, number];
  /** seconds into the run before this type starts showing up */
  from: number;
  weight: number;
  /** explosion colour */
  boom: string;
  /** chance of dropping a power-up capsule */
  drop: number;
};
const KINDS: Record<Kind, KindDef> = {
  pebble: { r: [8, 11], hp: 1, pts: 10, v: [170, 230], from: 0, weight: 3, boom: "rgba(255,150,80,1)", drop: 0.03 },
  rock: { r: [13, 18], hp: 2, pts: 20, v: [130, 180], from: 0, weight: 4, boom: "rgba(255,120,70,1)", drop: 0.06 },
  jelly: { r: [15, 17], hp: 3, pts: 40, v: [85, 115], from: 10, weight: 1.6, boom: "rgba(255,110,220,1)", drop: 0.14 },
  boulder: { r: [23, 28], hp: 6, pts: 60, v: [75, 100], from: 15, weight: 1.4, boom: "rgba(255,170,90,1)", drop: 0.22 },
  comet: { r: [9, 12], hp: 1, pts: 25, v: [310, 370], from: 25, weight: 1.2, boom: "rgba(140,220,255,1)", drop: 0.08 },
  stinger: { r: [13, 14], hp: 4, pts: 60, v: [105, 125], from: 30, weight: 1.1, boom: "rgba(150,255,120,1)", drop: 0.16 },
  eye: { r: [25, 27], hp: 12, pts: 120, v: [52, 62], from: 45, weight: 0.6, boom: "rgba(200,120,255,1)", drop: 0.6 },
};
const KIND_LIST = Object.keys(KINDS) as Kind[];

type Foe = {
  alive: boolean;
  kind: Kind;
  x: number;
  y: number;
  x0: number;
  r: number;
  v: number;
  vx: number;
  rot: number;
  spin: number;
  hp: number;
  maxHp: number;
  flash: number;
  age: number;
  variant: number;
  grazed: boolean;
};
type Shot = { alive: boolean; x: number; y: number; vx: number; vy: number; dmg: number; look: number };
type Missile = { alive: boolean; x: number; y: number; vx: number; vy: number; age: number };
type Drop = { alive: boolean; kind: DropKind; x: number; y: number; age: number };
type Star = { x: number; y: number; z: number };
type Ring = { x: number; y: number; t: number; r: number; color: string };
type Blast = { x: number; y: number; t: number; life: number; r: number; color: string };
type Popup = { x: number; y: number; t: number; text: string; color: string };
type Banner = { text: string; sub: string; color: string; t: number };
type Planet = { img: number; x: number; y: number; v: number };

/* ---------------- sprites (drawn once) ---------------- */
const SPR = 2; // sprites are drawn at 2× for crisp scaling
function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = Math.ceil(w * SPR);
  c.height = Math.ceil(h * SPR);
  const g = c.getContext("2d")!;
  g.scale(SPR, SPR);
  return [c, g] as const;
}

/** A cratered rock, radius 32, lit from the top left. */
function rockSprite(base: [number, number, number], dark: [number, number, number], icy = false) {
  const R = 32;
  const [c, g] = canvas(R * 2 + 4, R * 2 + 4);
  g.translate(R + 2, R + 2);
  const n = 11;
  const radii = Array.from({ length: n }, () => 0.78 + Math.random() * 0.22);
  g.beginPath();
  radii.forEach((k, i) => {
    const a = (i / n) * Math.PI * 2;
    if (i) g.lineTo(Math.cos(a) * R * k, Math.sin(a) * R * k);
    else g.moveTo(Math.cos(a) * R * k, Math.sin(a) * R * k);
  });
  g.closePath();
  const body = g.createRadialGradient(-R * 0.35, -R * 0.4, 2, 0, 0, R * 1.05);
  body.addColorStop(0, `rgb(${base.map((v) => Math.min(255, v + 60)).join(",")})`);
  body.addColorStop(0.55, `rgb(${base.join(",")})`);
  body.addColorStop(1, `rgb(${dark.join(",")})`);
  g.fillStyle = body;
  g.fill();
  g.save();
  g.clip();
  // craters: a dark bowl with a light lower rim
  const craters = 3 + Math.floor(Math.random() * 3);
  for (let i = 0; i < craters; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.random() * R * 0.55;
    const cr = R * (0.12 + Math.random() * 0.16);
    const x = Math.cos(a) * d;
    const y = Math.sin(a) * d;
    g.fillStyle = `rgba(${dark.join(",")},0.75)`;
    g.beginPath();
    g.arc(x, y, cr, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = icy ? "rgba(230,250,255,0.55)" : "rgba(255,220,180,0.35)";
    g.lineWidth = 1.4;
    g.beginPath();
    g.arc(x, y, cr, 0.2, Math.PI - 0.2);
    g.stroke();
  }
  // fine surface grain
  for (let i = 0; i < 40; i++) {
    g.fillStyle = Math.random() < 0.5 ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.12)";
    g.fillRect((Math.random() - 0.5) * R * 2, (Math.random() - 0.5) * R * 2, 1.5, 1.5);
  }
  // rim light on the bottom right, shade on the far side
  const rim = g.createLinearGradient(-R, -R, R, R);
  rim.addColorStop(0, "rgba(255,255,255,0.18)");
  rim.addColorStop(0.5, "rgba(0,0,0,0)");
  rim.addColorStop(1, "rgba(0,0,0,0.35)");
  g.fillStyle = rim;
  g.fillRect(-R, -R, R * 2, R * 2);
  g.restore();
  if (icy) {
    g.strokeStyle = "rgba(220,250,255,0.7)";
    g.lineWidth = 1.5;
    g.stroke();
  }
  return c;
}

function jellySprite() {
  const R = 32;
  const [c, g] = canvas(R * 2 + 4, R * 2 + 4);
  g.translate(R + 2, R + 2);
  // dome
  g.beginPath();
  g.moveTo(-R, 4);
  g.bezierCurveTo(-R, -R * 1.15, R, -R * 1.15, R, 4);
  g.quadraticCurveTo(R * 0.66, 12, R * 0.33, 4);
  g.quadraticCurveTo(0, 12, -R * 0.33, 4);
  g.quadraticCurveTo(-R * 0.66, 12, -R, 4);
  g.closePath();
  const body = g.createRadialGradient(-8, -16, 2, 0, -6, R * 1.1);
  body.addColorStop(0, "rgba(255,220,250,0.98)");
  body.addColorStop(0.45, "rgba(255,90,210,0.92)");
  body.addColorStop(1, "rgba(130,20,140,0.95)");
  g.fillStyle = body;
  g.fill();
  // spots and eyes
  g.fillStyle = "rgba(255,255,255,0.35)";
  for (const [x, y, r] of [[-14, -14, 4], [10, -20, 3], [16, -6, 2.5]] as const) {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = "#2a0630";
  for (const x of [-8, 8]) {
    g.beginPath();
    g.ellipse(x, -4, 3.4, 4.6, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = "#fff";
  for (const x of [-7, 9]) {
    g.beginPath();
    g.arc(x, -6, 1.3, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

function stingerSprite() {
  const R = 32;
  const [c, g] = canvas(R * 2 + 4, R * 2 + 4);
  g.translate(R + 2, R + 2);
  // body: armoured beetle seen from above, stinger pointing down at the ship
  g.beginPath();
  g.moveTo(0, R);
  g.lineTo(9, 10);
  g.quadraticCurveTo(20, -4, 12, -22);
  g.quadraticCurveTo(0, -30, -12, -22);
  g.quadraticCurveTo(-20, -4, -9, 10);
  g.closePath();
  const body = g.createLinearGradient(-20, 0, 20, 0);
  body.addColorStop(0, "#1f6b1a");
  body.addColorStop(0.5, "#9dff6a");
  body.addColorStop(1, "#1f6b1a");
  g.fillStyle = body;
  g.fill();
  g.strokeStyle = "rgba(10,40,10,0.8)";
  g.lineWidth = 1.5;
  for (const y of [-12, -2, 8]) {
    g.beginPath();
    g.moveTo(-13 + Math.abs(y) * 0.1, y);
    g.quadraticCurveTo(0, y + 4, 13 - Math.abs(y) * 0.1, y);
    g.stroke();
  }
  // eyes
  g.fillStyle = "#ff3b3b";
  for (const x of [-5, 5]) {
    g.beginPath();
    g.arc(x, -20, 2.6, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

function eyeSprite() {
  const R = 32;
  const [c, g] = canvas(R * 2 + 4, R * 2 + 4);
  g.translate(R + 2, R + 2);
  // fleshy purple orb with veins; the iris is drawn live so it can follow the ship
  const body = g.createRadialGradient(-10, -12, 3, 0, 0, R);
  body.addColorStop(0, "#f2d9ff");
  body.addColorStop(0.5, "#a24bd8");
  body.addColorStop(1, "#3a0d57");
  g.fillStyle = body;
  g.beginPath();
  g.arc(0, 0, R, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "rgba(255,80,120,0.55)";
  g.lineWidth = 1.2;
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.3;
    g.beginPath();
    g.moveTo(Math.cos(a) * R * 0.95, Math.sin(a) * R * 0.95);
    g.quadraticCurveTo(Math.cos(a + 0.3) * R * 0.75, Math.sin(a + 0.3) * R * 0.75, Math.cos(a) * R * 0.55, Math.sin(a) * R * 0.55);
    g.stroke();
  }
  // sclera
  g.fillStyle = "#fff8f0";
  g.beginPath();
  g.ellipse(0, 2, R * 0.55, R * 0.42, 0, 0, Math.PI * 2);
  g.fill();
  return c;
}

function shipSprite() {
  const w = SHIP_W + 16;
  const h = SHIP_H + 6;
  const [c, g] = canvas(w, h);
  g.translate(w / 2, h / 2);
  const hw = SHIP_W / 2;
  const hh = SHIP_H / 2;
  // wings
  g.beginPath();
  g.moveTo(-4, -2);
  g.lineTo(-hw - 6, hh - 4);
  g.lineTo(-hw + 2, hh);
  g.lineTo(-5, hh - 8);
  g.closePath();
  g.moveTo(4, -2);
  g.lineTo(hw + 6, hh - 4);
  g.lineTo(hw - 2, hh);
  g.lineTo(5, hh - 8);
  g.closePath();
  const wing = g.createLinearGradient(-hw, 0, hw, 0);
  wing.addColorStop(0, "#2a56c9");
  wing.addColorStop(0.5, "#7fb6ff");
  wing.addColorStop(1, "#2a56c9");
  g.fillStyle = wing;
  g.fill();
  // panel lines on the wings
  g.strokeStyle = "rgba(10,30,90,0.55)";
  g.lineWidth = 0.7;
  g.beginPath();
  g.moveTo(-6, 2);
  g.lineTo(-hw - 1, hh - 4);
  g.moveTo(6, 2);
  g.lineTo(hw + 1, hh - 4);
  g.stroke();
  // wing tips
  g.fillStyle = "#ff5a5a";
  g.fillRect(-hw - 6, hh - 6, 4, 3);
  g.fillRect(hw + 2, hh - 6, 4, 3);
  // hull
  g.beginPath();
  g.moveTo(0, -hh);
  g.quadraticCurveTo(8, -hh + 12, 7, hh - 4);
  g.lineTo(0, hh);
  g.lineTo(-7, hh - 4);
  g.quadraticCurveTo(-8, -hh + 12, 0, -hh);
  g.closePath();
  const hull = g.createLinearGradient(-8, 0, 8, 0);
  hull.addColorStop(0, "#9fb4d6");
  hull.addColorStop(0.45, "#ffffff");
  hull.addColorStop(1, "#6f86ad");
  g.fillStyle = hull;
  g.fill();
  g.strokeStyle = "rgba(20,40,80,0.5)";
  g.lineWidth = 0.8;
  g.stroke();
  // nose stripe
  g.fillStyle = "#ff5a5a";
  g.beginPath();
  g.moveTo(0, -hh + 2);
  g.quadraticCurveTo(3, -hh + 7, 2.5, -hh + 11);
  g.lineTo(-2.5, -hh + 11);
  g.quadraticCurveTo(-3, -hh + 7, 0, -hh + 2);
  g.fill();
  // cockpit
  const glass = g.createLinearGradient(0, -12, 0, 2);
  glass.addColorStop(0, "#8ff3ff");
  glass.addColorStop(1, "#0b3c7a");
  g.fillStyle = glass;
  g.beginPath();
  g.ellipse(0, -5, 3.6, 7.5, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "rgba(255,255,255,0.8)";
  g.beginPath();
  g.ellipse(-1.2, -8, 1, 2.6, 0, 0, Math.PI * 2);
  g.fill();
  // cannons
  g.fillStyle = "#c8d6ee";
  g.fillRect(-10, -4, 2, 9);
  g.fillRect(8, -4, 2, 9);
  return c;
}

/** Nebula clouds on a dark sky, H tall, seamless top to bottom (it scrolls). */
function nebulaSprite() {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d", { alpha: false })!;
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#04050d");
  sky.addColorStop(0.5, "#090a1f");
  sky.addColorStop(1, "#04050d");
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);
  const clouds: [number, number, number, string][] = [
    [60, 90, 150, "rgba(120,40,170,0.30)"],
    [250, 170, 130, "rgba(30,90,200,0.26)"],
    [140, 330, 170, "rgba(200,40,110,0.20)"],
    [290, 410, 110, "rgba(40,150,190,0.20)"],
    [30, 250, 90, "rgba(70,60,200,0.22)"],
    [200, 40, 80, "rgba(255,120,60,0.10)"],
  ];
  for (const [x, y, r, col] of clouds) {
    for (const dy of [-H, 0, H]) {
      const grad = g.createRadialGradient(x, y + dy, 0, x, y + dy, r);
      grad.addColorStop(0, col);
      grad.addColorStop(1, col.replace(/[\d.]+\)$/, "0)"));
      g.fillStyle = grad;
      g.fillRect(x - r, y + dy - r, r * 2, r * 2);
    }
  }
  // faint far stars baked in, a few of them tinted
  for (let i = 0; i < 110; i++) {
    const tint = Math.random();
    const rgb = tint < 0.15 ? "255,210,170" : tint < 0.3 ? "170,200,255" : "210,220,255";
    g.fillStyle = `rgba(${rgb},${0.15 + Math.random() * 0.4})`;
    g.fillRect(Math.random() * W, Math.random() * H, 1, 1);
  }
  return c;
}

/** A distant planet (radius R) with cloud bands, lit from the top left, optionally ringed. */
function planetSprite(R: number, light: string, base: string, dark: string, band: string, ring: boolean) {
  const pad = ring ? R * 0.85 : 6;
  const [c, g] = canvas(R * 2 + pad * 2, R * 2 + pad * 2);
  g.translate(R + pad, R + pad);
  const tilt = -0.35;
  const ringHalf = (front: boolean) => {
    g.save();
    g.rotate(tilt);
    for (const [rx, ry, lw, col] of [
      [R * 1.72, R * 0.4, R * 0.14, "rgba(230,205,170,0.45)"],
      [R * 1.48, R * 0.34, R * 0.05, "rgba(255,240,215,0.5)"],
    ] as const) {
      g.beginPath();
      g.ellipse(0, 0, rx, ry, 0, front ? 0 : Math.PI, front ? Math.PI : Math.PI * 2);
      g.lineWidth = lw;
      g.strokeStyle = col;
      g.stroke();
    }
    g.restore();
  };
  if (ring) ringHalf(false); // the far side, behind the planet
  const body = g.createRadialGradient(-R * 0.4, -R * 0.45, R * 0.1, 0, 0, R);
  body.addColorStop(0, light);
  body.addColorStop(0.55, base);
  body.addColorStop(1, dark);
  g.fillStyle = body;
  g.beginPath();
  g.arc(0, 0, R, 0, Math.PI * 2);
  g.fill();
  g.save();
  g.clip();
  g.rotate(tilt);
  for (let i = 0; i < 7; i++) {
    const y = -R + (i + 0.5) * ((R * 2) / 7) + (Math.random() - 0.5) * 6;
    g.fillStyle = band.replace(/[\d.]+\)$/, `${0.12 + Math.random() * 0.2})`);
    g.beginPath();
    g.ellipse(0, y, R * 1.3, R * (0.05 + Math.random() * 0.06), 0, 0, Math.PI * 2);
    g.fill();
  }
  g.rotate(-tilt);
  // night side
  const shade = g.createLinearGradient(-R, -R, R, R);
  shade.addColorStop(0, "rgba(0,0,0,0)");
  shade.addColorStop(0.55, "rgba(0,0,0,0.15)");
  shade.addColorStop(1, "rgba(0,0,10,0.75)");
  g.fillStyle = shade;
  g.fillRect(-R, -R, R * 2, R * 2);
  g.restore();
  // thin atmosphere
  g.strokeStyle = light.replace(/^rgb\(/, "rgba(").replace(/\)$/, ",0.35)");
  g.lineWidth = 1.5;
  g.beginPath();
  g.arc(0, 0, R - 0.5, Math.PI * 0.85, Math.PI * 1.75);
  g.stroke();
  if (ring) ringHalf(true); // the near side, in front
  return c;
}

/** A power-up capsule: a glossy hexagon with its letter. 30 × 30. */
function dropSprite(kind: DropKind) {
  const { letter, color } = DROP_LOOK[kind];
  const S = 30;
  const [c, g] = canvas(S, S);
  g.translate(S / 2, S / 2);
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + (i * Math.PI) / 3;
    if (i) g.lineTo(Math.cos(a) * 12.5, Math.sin(a) * 12.5);
    else g.moveTo(Math.cos(a) * 12.5, Math.sin(a) * 12.5);
  }
  g.closePath();
  const body = g.createLinearGradient(0, -13, 0, 13);
  body.addColorStop(0, "#ffffff");
  body.addColorStop(0.3, color);
  body.addColorStop(1, "#14082a");
  g.fillStyle = body;
  g.fill();
  g.lineWidth = 1.6;
  g.strokeStyle = "rgba(255,255,255,0.9)";
  g.stroke();
  g.font = "900 13px Inter, system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineWidth = 3;
  g.strokeStyle = "rgba(0,0,0,0.55)";
  g.strokeText(letter, 0, 1);
  g.fillStyle = "#fff";
  g.fillText(letter, 0, 1);
  return c;
}

/** Darkened edges, drawn on top of the scene. */
function vignetteSprite() {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, H * 0.72);
  grad.addColorStop(0, "rgba(0,0,8,0)");
  grad.addColorStop(1, "rgba(0,0,8,0.6)");
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  return c;
}

type Sprites = {
  rock: HTMLCanvasElement[];
  ember: HTMLCanvasElement[];
  ice: HTMLCanvasElement[];
  jelly: HTMLCanvasElement;
  stinger: HTMLCanvasElement;
  eye: HTMLCanvasElement;
  ship: HTMLCanvasElement;
  nebula: HTMLCanvasElement;
  planets: HTMLCanvasElement[];
  drops: Record<DropKind, HTMLCanvasElement>;
  vignette: HTMLCanvasElement;
};
let sprites: Sprites | null = null;
function getSprites(): Sprites {
  if (sprites) return sprites;
  sprites = {
    rock: Array.from({ length: 5 }, () => rockSprite([150, 110, 95], [45, 30, 32])),
    ember: Array.from({ length: 4 }, () => rockSprite([215, 95, 60], [70, 20, 25])),
    ice: Array.from({ length: 3 }, () => rockSprite([150, 210, 240], [30, 70, 120], true)),
    jelly: jellySprite(),
    stinger: stingerSprite(),
    eye: eyeSprite(),
    ship: shipSprite(),
    nebula: nebulaSprite(),
    planets: [
      planetSprite(58, "rgb(255,214,160)", "rgb(214,128,70)", "rgb(70,30,30)", "rgba(120,50,30,0.3)", true),
      planetSprite(34, "rgb(190,235,255)", "rgb(70,140,210)", "rgb(15,30,70)", "rgba(220,245,255,0.3)", false),
      planetSprite(46, "rgb(225,200,255)", "rgb(130,80,190)", "rgb(30,15,60)", "rgba(255,200,255,0.3)", true),
    ],
    drops: Object.fromEntries(DROP_KINDS.map((k) => [k, dropSprite(k)])) as Record<DropKind, HTMLCanvasElement>,
    vignette: vignetteSprite(),
  };
  return sprites;
}

function pickKind(t: number): Kind {
  const open = KIND_LIST.filter((k) => t >= KINDS[k].from);
  const total = open.reduce((n, k) => n + KINDS[k].weight, 0);
  let x = Math.random() * total;
  for (const k of open) {
    x -= KINDS[k].weight;
    if (x <= 0) return k;
  }
  return "rock";
}

function weighted<T>(list: [T, number][]): T {
  const total = list.reduce((n, [, w]) => n + w, 0);
  let x = Math.random() * total;
  for (const [v, w] of list) {
    x -= w;
    if (x <= 0) return v;
  }
  return list[list.length - 1][0];
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export default function DodgeGame({ onFinish }: GameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [running, setRunning] = useState(false);
  const [over, setOver] = useState(false);
  const [score, setScore] = useState(0);
  const [kills, setKills] = useState(0);
  const [level, setLevel] = useState(1);
  const st = useRef({
    px: W / 2,
    vx: 0,
    target: null as number | null,
    left: false,
    right: false,
    foes: Array.from({ length: MAX_FOES }, () => ({ alive: false }) as Foe),
    shots: Array.from({ length: MAX_SHOTS }, () => ({ alive: false, x: 0, y: 0, vx: 0, vy: 0, dmg: 1, look: 0 }) as Shot),
    shotNext: 0,
    missiles: Array.from({ length: MAX_MISSILES }, () => ({ alive: false, x: 0, y: 0, vx: 0, vy: 0, age: 0 }) as Missile),
    missileNext: 0,
    drops: Array.from({ length: MAX_DROPS }, () => ({ alive: false, kind: "power", x: 0, y: 0, age: 0 }) as Drop),
    t: 0,
    spawn: 0,
    fire: 0,
    muzzle: 0,
    bonus: 0,
    kills: 0,
    chain: 0,
    lastKill: -10,
    running: false,
    dead: false,
    flash: 0,
    scroll: 0,
    // weapon
    pow: 0,
    rows: 0,
    rate: 0,
    laser: 0,
    missileT: 0,
    missileFire: 0,
    shield: false,
    invuln: 0,
    dropClock: 0,
    banner: null as Banner | null,
    // scenery and effects
    planet: { img: 0, x: 250, y: 110, v: 7 } as Planet,
    stars: [] as Star[],
    rings: [] as Ring[],
    blasts: [] as Blast[],
    parts: new Particles(420),
    shake: new Shake(),
    popups: [] as Popup[],
  });

  function start() {
    const s = st.current;
    s.px = W / 2;
    s.vx = 0;
    s.target = null;
    s.foes.forEach((f) => (f.alive = false));
    s.shots.forEach((b) => (b.alive = false));
    s.missiles.forEach((m) => (m.alive = false));
    s.drops.forEach((d) => (d.alive = false));
    s.t = 0;
    s.spawn = 0.5;
    s.fire = 0.3;
    s.bonus = 0;
    s.kills = 0;
    s.chain = 0;
    s.lastKill = -10;
    s.dead = false;
    s.flash = 0;
    s.pow = 0;
    s.rows = 0;
    s.rate = 0;
    s.laser = 0;
    s.missileT = 0;
    s.missileFire = 0;
    s.shield = false;
    s.invuln = 0;
    s.dropClock = DROP_PITY - 7; // the first capsule comes early
    s.banner = null;
    s.popups = [];
    s.rings = [];
    s.blasts = [];
    s.parts.clear();
    s.running = true;
    setScore(0);
    setKills(0);
    setLevel(1);
    setOver(false);
    setRunning(true);
  }

  useEffect(() => {
    const set = (e: KeyboardEvent, v: boolean) => {
      if (e.key === "ArrowLeft" || e.key === "a") st.current.left = v;
      if (e.key === "ArrowRight" || e.key === "d") st.current.right = v;
      if (v && (e.key === "ArrowLeft" || e.key === "ArrowRight") && st.current.running) e.preventDefault();
      if (v) st.current.target = null;
    };
    const down = (e: KeyboardEvent) => set(e, true);
    const up = (e: KeyboardEvent) => set(e, false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  useEffect(() => {
    const cv = canvasRef.current!;
    const ctx = setupCanvas(cv, W, H);
    const s = st.current;
    const calm = reducedMotion();
    const light = calm || isLite(); // fewer per-frame extras on slow phones
    const spr = getSprites();
    if (!s.stars.length) s.stars = Array.from({ length: 60 }, () => ({ x: Math.random() * W, y: Math.random() * H, z: 0.25 + Math.random() * 0.75 }));

    const weaponLevel = () => 1 + s.pow + s.rows + s.rate;
    const spawnFoe = (speedUp: number) => {
      const f = s.foes.find((q) => !q.alive);
      if (!f) return;
      const kind = pickKind(s.t);
      const d = KINDS[kind];
      const r = rand(d.r[0], d.r[1]);
      const x = rand(r + 4, W - r - 4);
      // foes toughen with time, so the weapon upgrades keep pace rather than run away
      const hp = (d.hp + (kind === "eye" || kind === "boulder" ? Math.floor(s.t / 60) : 0)) * (1 + s.t / 90);
      Object.assign(f, {
        alive: true,
        kind,
        x,
        x0: x,
        y: -r - 6,
        r,
        v: rand(d.v[0], d.v[1]) * (kind === "comet" ? 1 : speedUp),
        vx: kind === "comet" ? rand(-40, 40) : 0,
        rot: Math.random() * 6,
        spin: kind === "stinger" || kind === "jelly" || kind === "eye" ? 0 : rand(-2.5, 2.5),
        hp,
        maxHp: hp,
        flash: 0,
        age: 0,
        variant: Math.floor(Math.random() * 5),
        grazed: false,
      });
    };

    const blast = (x: number, y: number, r: number, color: string, life = 0.4) => {
      if (s.blasts.length < 24) s.blasts.push({ x, y, t: 0, life, r, color });
    };

    const spawnDrop = (x: number, y: number) => {
      const d = s.drops.find((q) => !q.alive);
      if (!d) return;
      const opts: [DropKind, number][] = [];
      if (s.pow < POWER.length - 1) opts.push(["power", 3]);
      if (s.rows < ROWS.length - 1) opts.push(["rows", 3]);
      if (s.rate < RATE.length - 1) opts.push(["rate", 3]);
      opts.push(["special", opts.length ? 1.7 : 4]);
      Object.assign(d, { alive: true, kind: weighted(opts), x: Math.max(16, Math.min(W - 16, x)), y, age: 0 });
      s.dropClock = 0;
    };

    const killFoe = (f: Foe) => {
      f.alive = false;
      const d = KINDS[f.kind];
      s.chain = s.t - s.lastKill < COMBO_WINDOW ? s.chain + 1 : 1;
      s.lastKill = s.t;
      const mult = Math.min(4, 1 + Math.floor((s.chain - 1) / 3));
      const pts = d.pts * mult;
      s.bonus += pts;
      s.kills++;
      setKills(s.kills);
      s.popups.push({ x: f.x, y: f.y, t: 0, text: mult > 1 ? `+${pts} ×${mult}` : `+${pts}`, color: mult > 1 ? "#ffd84a" : "#ffffff" });
      const big = f.r > 20;
      // fireball + sparks + (for rocks) tumbling debris
      blast(f.x, f.y, f.r * (big ? 2.6 : 2), d.boom, big ? 0.5 : 0.35);
      s.parts.burst(f.x, f.y, big ? 34 : 18, d.boom, { speed: big ? 230 : 170, life: 0.7, size: big ? 4 : 3 });
      s.parts.burst(f.x, f.y, big ? 14 : 7, "rgba(255,255,230,1)", { speed: big ? 320 : 240, life: 0.35, size: 1.6 });
      if (f.kind === "pebble" || f.kind === "rock" || f.kind === "boulder" || f.kind === "comet") {
        s.parts.burst(f.x, f.y, big ? 12 : 6, f.kind === "comet" ? "rgba(170,220,255,1)" : "rgba(150,110,95,1)", { speed: 120, life: 0.9, size: big ? 5 : 4, gravity: 140 });
      }
      if (s.rings.length < 10) s.rings.push({ x: f.x, y: f.y, t: 0, r: f.r * (big ? 3 : 2.2), color: d.boom });
      if (big) {
        s.shake.kick(f.kind === "eye" ? 9 : 6);
        if (!calm) s.flash = Math.max(s.flash, f.kind === "eye" ? 0.35 : 0.18);
      }
      // fully upgraded: only specials are left to drop, so half as many
      const maxed = s.pow === POWER.length - 1 && s.rows === ROWS.length - 1 && s.rate === RATE.length - 1;
      if (s.running && (Math.random() < d.drop * (maxed ? 0.5 : 1) || s.dropClock > DROP_PITY * (maxed ? 2 : 1))) spawnDrop(f.x, f.y);
    };

    /** Damage a foe; returns true when it was destroyed. */
    const hurt = (f: Foe, amount: number) => {
      f.hp -= amount;
      f.flash = 0.08;
      if (f.hp <= 0) {
        killFoe(f);
        return true;
      }
      return false;
    };

    const announce = (text: string, sub: string, color: string) => {
      s.banner = { text, sub, color, t: 0 };
    };

    const nova = () => {
      s.rings.push({ x: s.px, y: SHIP_Y, t: 0, r: H * 1.1, color: "rgba(220,170,255,1)" });
      blast(s.px, SHIP_Y, 120, "rgba(210,150,255,1)", 0.6);
      s.parts.burst(s.px, SHIP_Y, 60, "rgba(220,170,255,1)", { speed: 420, life: 0.8, size: 3 });
      for (const f of s.foes) if (f.alive && f.y > -f.r) hurt(f, 10);
      s.shake.kick(12);
      if (!calm) s.flash = Math.max(s.flash, 0.45);
    };

    const collect = (d: Drop) => {
      d.alive = false;
      s.bonus += 25;
      const look = DROP_LOOK[d.kind];
      s.parts.burst(s.px, SHIP_Y, 26, look.glow, { speed: 200, life: 0.55, size: 3 });
      s.rings.push({ x: s.px, y: SHIP_Y, t: 0, r: 46, color: look.glow });
      // a stat that maxed out while its capsule was falling: points instead
      const maxedOut = (text: string) => {
        s.bonus += 50;
        announce(text, "+50", look.color);
      };
      if (d.kind === "power") {
        if (s.pow >= POWER.length - 1) return maxedOut("MAX POWER");
        s.pow++;
        announce("POWER UP", `damage level ${s.pow + 1}/${POWER.length}`, look.color);
      } else if (d.kind === "rows") {
        if (s.rows >= ROWS.length - 1) return maxedOut("MAX ROWS");
        s.rows++;
        announce("LASER ROWS", `${ROWS[s.rows].length} streams`, look.color);
      } else if (d.kind === "rate") {
        if (s.rate >= RATE.length - 1) return maxedOut("MAX FIRE RATE");
        s.rate++;
        announce("FIRE RATE UP", `level ${s.rate + 1}/${RATE.length}`, look.color);
      } else {
        const special = weighted<"laser" | "missiles" | "shield" | "nova">([
          ["laser", 3],
          ["missiles", 3],
          ["shield", s.shield ? 0 : 2.5],
          ["nova", 1.5],
        ]);
        if (special === "laser") {
          s.laser = LASER_TIME;
          announce("MEGA LASER", `${LASER_TIME} seconds`, "#ff7ad9");
        } else if (special === "missiles") {
          s.missileT = MISSILE_TIME;
          s.missileFire = 0;
          announce("HOMING MISSILES", `${MISSILE_TIME} seconds`, "#ffb347");
        } else if (special === "shield") {
          s.shield = true;
          announce("SHIELD", "blocks one hit", "#7df9ff");
        } else {
          announce("NOVA BLAST", "", "#d8a6ff");
          nova();
        }
      }
      setLevel(weaponLevel());
    };

    const fireVolley = () => {
      const dmg = POWER[s.pow];
      for (const [ox, a] of ROWS[s.rows]) {
        const b = s.shots[s.shotNext];
        s.shotNext = (s.shotNext + 1) % MAX_SHOTS;
        b.alive = true;
        b.x = s.px + ox;
        b.y = SHIP_Y - 6 + Math.abs(ox) * 0.3;
        b.vx = Math.sin(a) * SHOT_SPEED;
        b.vy = -Math.cos(a) * SHOT_SPEED;
        b.dmg = dmg;
        b.look = s.pow;
      }
      s.muzzle = 0.06;
    };

    const fireMissiles = () => {
      for (const side of [-1, 1]) {
        const m = s.missiles[s.missileNext];
        s.missileNext = (s.missileNext + 1) % MAX_MISSILES;
        Object.assign(m, { alive: true, x: s.px + side * 14, y: SHIP_Y + 2, vx: side * 140, vy: -90, age: 0 });
      }
    };

    let raf = 0;
    let last = performance.now();
    let shownScore = -1;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const speedUp = 1 + s.t * 0.03;

      if (s.running) {
        s.t += dt;
        s.spawn -= dt;
        s.dropClock += dt;
        s.invuln = Math.max(0, s.invuln - dt);
        // smooth steering: keys accelerate, drag eases toward the finger
        if (s.target !== null) s.vx = (s.target - s.px) * 12;
        else {
          const want = (s.right ? 1 : 0) - (s.left ? 1 : 0);
          s.vx += (want * 330 - s.vx) * Math.min(1, dt * 12);
        }
        s.px = Math.max(SHIP_W / 2, Math.min(W - SHIP_W / 2, s.px + s.vx * dt));

        if (s.spawn <= 0) {
          spawnFoe(speedUp);
          s.spawn = Math.max(0.22, 0.7 - s.t * 0.01);
        }

        // auto blaster
        s.fire -= dt;
        if (s.fire <= 0) {
          s.fire += RATE[s.rate];
          fireVolley();
        }
        s.muzzle -= dt;

        for (const b of s.shots) {
          if (!b.alive) continue;
          b.x += b.vx * dt;
          b.y += b.vy * dt;
          if (b.y < -16 || b.x < -16 || b.x > W + 16) b.alive = false;
        }

        // specials
        if (s.laser > 0) {
          s.laser = Math.max(0, s.laser - dt);
          if (s.laser === 0) setLevel(weaponLevel());
        }
        if (s.missileT > 0) {
          s.missileT = Math.max(0, s.missileT - dt);
          s.missileFire -= dt;
          if (s.missileFire <= 0 && s.missileT > 0) {
            s.missileFire = MISSILE_EVERY;
            fireMissiles();
          }
        }

        // homing missiles: steer toward the nearest foe ahead
        for (const m of s.missiles) {
          if (!m.alive) continue;
          m.age += dt;
          let best: Foe | null = null;
          let bestD = Infinity;
          for (const f of s.foes) {
            if (!f.alive || f.y > m.y + 30 || f.y < -f.r) continue;
            const dd = (f.x - m.x) ** 2 + (f.y - m.y) ** 2;
            if (dd < bestD) {
              bestD = dd;
              best = f;
            }
          }
          const speed = Math.min(430, Math.hypot(m.vx, m.vy) + 650 * dt);
          let ang = Math.atan2(m.vy, m.vx);
          const want = best ? Math.atan2(best.y - m.y, best.x - m.x) : -Math.PI / 2;
          let diff = want - ang;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          ang += Math.max(-7 * dt, Math.min(7 * dt, diff));
          m.vx = Math.cos(ang) * speed;
          m.vy = Math.sin(ang) * speed;
          m.x += m.vx * dt;
          m.y += m.vy * dt;
          if (!light && Math.random() < 0.8) s.parts.burst(m.x - m.vx * 0.02, m.y - m.vy * 0.02, 1, "rgba(255,150,60,1)", { speed: 30, life: 0.35, size: 2.5 });
          if (m.age > 3 || m.y < -20 || m.x < -20 || m.x > W + 20 || m.y > H + 20) {
            m.alive = false;
            continue;
          }
          for (const f of s.foes) {
            if (!f.alive) continue;
            if ((f.x - m.x) ** 2 + (f.y - m.y) ** 2 < (f.r + 4) ** 2) {
              m.alive = false;
              blast(m.x, m.y, 26, "rgba(255,170,70,1)", 0.3);
              s.parts.burst(m.x, m.y, 10, "rgba(255,190,90,1)", { speed: 160, life: 0.4, size: 2.5 });
              hurt(f, MISSILE_DMG);
              // splash
              for (const o of s.foes) {
                if (o.alive && o !== f && (o.x - m.x) ** 2 + (o.y - m.y) ** 2 < (o.r + 26) ** 2) hurt(o, 1.2);
              }
              break;
            }
          }
        }

        for (const f of s.foes) {
          if (!f.alive) continue;
          f.age += dt;
          f.flash = Math.max(0, f.flash - dt);
          f.y += f.v * dt;
          f.rot += f.spin * dt;
          if (f.kind === "jelly") f.x = f.x0 + Math.sin(f.age * 2.2) * 34;
          else if (f.kind === "stinger") f.x += Math.max(-60, Math.min(60, (s.px - f.x) * 0.9)) * dt;
          else if (f.kind === "comet") f.x += f.vx * dt;
          f.x = Math.max(f.r, Math.min(W - f.r, f.x));
          if (f.kind === "comet" && !calm && Math.random() < 0.5) {
            s.parts.burst(f.x, f.y - f.r * 0.6, 1, "rgba(150,220,255,1)", { speed: 40, life: 0.45, size: 3, angle: -Math.PI / 2, spread: 0.5 });
          }
          if (f.y - f.r > H) {
            f.alive = false;
            continue;
          }

          // the mega laser: a beam straight up from the ship, through everything in its path
          if (s.laser > 0 && f.y < SHIP_Y && Math.abs(f.x - s.px) < f.r + 7) {
            if (Math.random() < 0.35) s.parts.burst(s.px, f.y + f.r * 0.5, 2, "rgba(255,150,230,1)", { speed: 140, life: 0.3, size: 2, angle: Math.PI / 2, spread: 2.2 });
            if (hurt(f, LASER_DPS * dt)) continue;
          }

          // shots
          for (const b of s.shots) {
            if (!b.alive) continue;
            const dx = b.x - f.x;
            const dy = b.y - f.y;
            if (dx * dx + dy * dy < (f.r + 3) * (f.r + 3)) {
              b.alive = false;
              s.parts.burst(b.x, b.y + 2, 4, SHOT_LOOK[b.look].glow.replace(/[\d.]+\)$/, "1)"), { speed: 110, life: 0.25, size: 2, angle: -Math.PI / 2, spread: 1.6 });
              if (hurt(f, b.dmg)) break;
            }
          }
          if (!f.alive) continue;

          // the ship (body approximated by a circle)
          const dx = f.x - s.px;
          const dy = f.y - (SHIP_Y + 4);
          const d = Math.hypot(dx, dy);
          if (d < f.r * 0.85 + 12 && s.invuln <= 0) {
            if (s.shield) {
              // the shield takes the hit: it pops, the foe is destroyed, a moment of safety
              s.shield = false;
              s.invuln = 1.2;
              s.rings.push({ x: s.px, y: SHIP_Y, t: 0, r: 70, color: "rgba(125,249,255,1)" });
              s.parts.burst(s.px, SHIP_Y, 40, "rgba(125,249,255,1)", { speed: 260, life: 0.6, size: 3 });
              s.shake.kick(10);
              killFoe(f);
              announce("SHIELD DOWN", "", "#7df9ff");
              continue;
            }
            s.running = false;
            s.dead = true;
            blast(s.px, SHIP_Y, 90, "rgba(255,150,70,1)", 0.7);
            s.parts.burst(s.px, SHIP_Y, 70, "rgba(255,140,60,1)", { speed: 280, life: 1.1, size: 4 });
            s.parts.burst(s.px, SHIP_Y, 36, "rgba(120,200,255,1)", { speed: 190, life: 0.9, size: 3 });
            s.parts.burst(s.px, SHIP_Y, 14, "rgba(200,210,230,1)", { speed: 140, life: 1.2, size: 5, gravity: 120 });
            s.rings.push({ x: s.px, y: SHIP_Y, t: 0, r: 90, color: "rgba(255,160,80,1)" });
            s.shake.kick(16);
            if (!calm) s.flash = 0.5;
            s.missiles.forEach((m) => (m.alive = false));
            const final = Math.floor(s.t * 10) + s.bonus;
            setScore(final);
            setRunning(false);
            setOver(true);
            onFinish(final);
            break;
          }
          if (!f.grazed && d < f.r + 30 && f.y > SHIP_Y) {
            f.grazed = true;
            s.bonus += 5;
            s.popups.push({ x: s.px, y: SHIP_Y - 30, t: 0, text: "NEAR MISS +5", color: "#7df9ff" });
          }
        }

        // capsules: drift down with a wobble, pulled in when the ship is close
        for (const dr of s.drops) {
          if (!dr.alive) continue;
          dr.age += dt;
          dr.y += 72 * dt;
          dr.x += Math.sin(dr.age * 3) * 14 * dt;
          const dx = s.px - dr.x;
          const dy = SHIP_Y - dr.y;
          const dd = Math.hypot(dx, dy);
          if (dd < 72 && dd > 0.1) {
            dr.x += (dx / dd) * 240 * dt;
            dr.y += (dy / dd) * 240 * dt;
          }
          if (dd < 24) collect(dr);
          else if (dr.y > H + 20) dr.alive = false;
        }

        // engine exhaust
        if (!calm) s.parts.burst(s.px, SHIP_Y + SHIP_H / 2 - 2, 2, "rgba(90,180,255,1)", { speed: 100 + s.rate * 15, life: 0.32, size: 3, angle: Math.PI / 2, spread: 0.5 });
        const live = Math.floor(s.t * 10) + s.bonus;
        if (live !== shownScore) {
          shownScore = live;
          setScore(live);
        }
      }
      s.parts.update(dt);

      // ---- draw ----
      ctx.save();
      s.shake.apply(ctx, dt);

      // nebula, scrolling slowly (seamless)
      if (s.running || s.dead) s.scroll = (s.scroll + 14 * speedUp * dt) % H;
      const sy = Math.floor(s.scroll);
      ctx.drawImage(spr.nebula, 0, sy - H, W, H);
      ctx.drawImage(spr.nebula, 0, sy, W, H);

      // a distant planet drifting past (slower than the stars: far away)
      {
        const p = s.planet;
        const img = spr.planets[p.img];
        const pw = img.width / SPR;
        const ph = img.height / SPR;
        if (s.running || s.dead) p.y += p.v * speedUp * dt;
        if (p.y - ph / 2 > H) {
          p.img = Math.floor(Math.random() * spr.planets.length);
          p.x = rand(30, W - 30);
          p.y = -ph / 2 - rand(160, 520);
          p.v = rand(5, 9);
        }
        if (p.y + ph / 2 > 0) {
          ctx.globalAlpha = 0.92;
          ctx.drawImage(img, p.x - pw / 2, p.y - ph / 2, pw, ph);
          ctx.globalAlpha = 1;
        }
      }

      // near stars, streaking as the game speeds up
      ctx.fillStyle = "#dfe6ff";
      for (const star of s.stars) {
        if (s.running || s.dead) star.y += star.z * 70 * speedUp * dt;
        if (star.y > H) {
          star.y = -4;
          star.x = Math.random() * W;
        }
        ctx.globalAlpha = 0.35 + star.z * 0.65;
        const len = calm ? 1.5 : 1.5 + star.z * speedUp * 3;
        ctx.fillRect(star.x, star.y, 1.2 * star.z + 0.4, len);
      }
      ctx.globalAlpha = 1;

      // capsules
      for (const dr of s.drops) {
        if (!dr.alive) continue;
        const look = DROP_LOOK[dr.kind];
        const pulse = 1 + Math.sin(dr.age * 6) * 0.08;
        glow(ctx, dr.x, dr.y, 26 * pulse, look.glow, 0.55);
        // a turning ring around it
        ctx.strokeStyle = look.color;
        ctx.globalAlpha = 0.7;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(dr.x, dr.y, 16 * pulse, dr.age * 3, dr.age * 3 + Math.PI * 1.2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.drawImage(spr.drops[dr.kind], dr.x - 15 * pulse, dr.y - 15 * pulse, 30 * pulse, 30 * pulse);
      }

      // the mega laser beam
      if (s.laser > 0 && !s.dead) {
        const fade = Math.min(1, s.laser / 0.4) * Math.min(1, (LASER_TIME - s.laser) / 0.15);
        const wob = 1 + Math.sin(now / 30) * 0.12;
        const top = 0;
        const bottom = SHIP_Y - 18;
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = 0.35 * fade;
        ctx.fillStyle = "#ff4fc8";
        ctx.fillRect(s.px - 13 * wob, top, 26 * wob, bottom - top);
        ctx.globalAlpha = 0.65 * fade;
        ctx.fillStyle = "#ff9be6";
        ctx.fillRect(s.px - 6 * wob, top, 12 * wob, bottom - top);
        ctx.globalAlpha = 0.95 * fade;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(s.px - 2.2, top, 4.4, bottom - top);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
        glow(ctx, s.px, bottom, 26 * wob, "rgba(255,120,220,0.95)", 0.9 * fade);
      }

      // shots: glowing bolts along their direction
      ctx.lineCap = "round";
      for (const b of s.shots) {
        if (!b.alive) continue;
        const look = SHOT_LOOK[b.look];
        const k = look.len / SHOT_SPEED;
        if (!light) glow(ctx, b.x, b.y, 7 + b.look * 1.5, look.glow, 0.5);
        ctx.strokeStyle = look.glow;
        ctx.globalAlpha = 0.7;
        ctx.lineWidth = look.w + 2;
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - b.vx * k, b.y - b.vy * k);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = look.core;
        ctx.lineWidth = look.w * 0.55;
        ctx.stroke();
      }

      // missiles
      for (const m of s.missiles) {
        if (!m.alive) continue;
        const a = Math.atan2(m.vy, m.vx);
        glow(ctx, m.x - Math.cos(a) * 6, m.y - Math.sin(a) * 6, 10, "rgba(255,150,60,0.9)", 0.7);
        ctx.save();
        ctx.translate(m.x, m.y);
        ctx.rotate(a);
        ctx.fillStyle = "#e9eef8";
        ctx.fillRect(-6, -1.8, 9, 3.6);
        ctx.fillStyle = "#ff5a4a";
        ctx.beginPath();
        ctx.moveTo(3, -1.8);
        ctx.lineTo(7, 0);
        ctx.lineTo(3, 1.8);
        ctx.fill();
        ctx.fillStyle = "#8aa0c8";
        ctx.fillRect(-6, -3.2, 3, 6.4);
        ctx.restore();
      }

      // foes
      for (const f of s.foes) {
        if (!f.alive) continue;
        const k = f.kind;
        const size = (f.r * 68) / 32; // sprites: a radius-32 body on a 68-wide canvas
        let img: HTMLCanvasElement;
        if (k === "comet") {
          // icy head with a long glowing tail
          const tail = ctx.createLinearGradient(f.x, f.y, f.x - f.vx * 0.35, f.y - f.v * 0.22);
          tail.addColorStop(0, "rgba(160,225,255,0.55)");
          tail.addColorStop(1, "rgba(160,225,255,0)");
          ctx.strokeStyle = tail;
          ctx.lineWidth = f.r * 1.4;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(f.x, f.y);
          ctx.lineTo(f.x - f.vx * 0.35, f.y - f.v * 0.22);
          ctx.stroke();
          glow(ctx, f.x, f.y, f.r * 2.6, "rgba(120,200,255,0.9)", 0.45);
          img = spr.ice[f.variant % spr.ice.length];
        } else if (k === "pebble" || k === "rock" || k === "boulder") {
          glow(ctx, f.x, f.y - f.r * 0.5, f.r * 2.2, "rgba(255,90,50,0.8)", k === "boulder" ? 0.18 : 0.28);
          img = k === "pebble" ? spr.ember[f.variant % spr.ember.length] : spr.rock[f.variant % spr.rock.length];
        } else if (k === "jelly") {
          glow(ctx, f.x, f.y, f.r * 2.6, "rgba(255,80,210,0.85)", 0.4);
          // tentacles, waving
          ctx.strokeStyle = "rgba(255,150,230,0.75)";
          ctx.lineWidth = 1.6;
          ctx.lineCap = "round";
          for (let i = 0; i < 4; i++) {
            const tx = f.x - f.r * 0.6 + i * f.r * 0.4;
            const wv = Math.sin(f.age * 6 + i) * 4;
            ctx.beginPath();
            ctx.moveTo(tx, f.y + f.r * 0.2);
            ctx.quadraticCurveTo(tx + wv, f.y + f.r * 0.8, tx - wv, f.y + f.r * 1.4);
            ctx.stroke();
          }
          img = spr.jelly;
        } else if (k === "stinger") {
          glow(ctx, f.x, f.y, f.r * 2.4, "rgba(120,255,100,0.8)", 0.3);
          // flapping wings
          const flap = 0.55 + Math.abs(Math.sin(f.age * 22)) * 0.45;
          ctx.fillStyle = "rgba(200,255,220,0.45)";
          for (const side of [-1, 1]) {
            ctx.beginPath();
            ctx.ellipse(f.x + side * f.r * 0.75, f.y - f.r * 0.35, f.r * 0.75 * flap, f.r * 0.38, side * 0.5, 0, Math.PI * 2);
            ctx.fill();
          }
          img = spr.stinger;
        } else {
          const pulse = 1 + Math.sin(f.age * 3) * 0.04;
          glow(ctx, f.x, f.y, f.r * 2.8 * pulse, "rgba(190,90,255,0.85)", 0.45);
          img = spr.eye;
        }

        ctx.save();
        ctx.translate(f.x, f.y);
        if (f.spin) ctx.rotate(f.rot);
        const sc = k === "eye" ? 1 + Math.sin(f.age * 3) * 0.04 : 1;
        ctx.drawImage(img, (-size / 2) * sc, (-size / 2) * sc, size * sc, size * sc);
        if (k === "eye") {
          // the iris follows the ship
          const ax = Math.atan2(SHIP_Y - f.y, s.px - f.x);
          const ix = Math.cos(ax) * f.r * 0.22;
          const iy = 2 + Math.sin(ax) * f.r * 0.14;
          ctx.fillStyle = "#e0262f";
          ctx.beginPath();
          ctx.arc(ix, iy, f.r * 0.24, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#14020a";
          ctx.beginPath();
          ctx.ellipse(ix, iy, f.r * 0.07, f.r * 0.17, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        // hit flash: the same picture again, added on top
        if (f.flash > 0) {
          ctx.globalCompositeOperation = "lighter";
          ctx.globalAlpha = f.flash / 0.08;
          ctx.drawImage(img, -size / 2, -size / 2, size, size);
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = "source-over";
        }
        ctx.restore();

        // health bar for tough ones once they've been hit
        if (f.maxHp > 2 && f.hp < f.maxHp) {
          const bw = Math.max(18, f.r * 1.4);
          ctx.fillStyle = "rgba(0,0,0,0.55)";
          ctx.fillRect(f.x - bw / 2, f.y - f.r - 9, bw, 4);
          ctx.fillStyle = f.hp / f.maxHp > 0.35 ? "#5dff8a" : "#ff5a4a";
          ctx.fillRect(f.x - bw / 2 + 0.5, f.y - f.r - 8.5, (bw - 1) * Math.max(0, f.hp / f.maxHp), 3);
        }
      }

      // fireballs: a white-hot core that cools to the foe's colour as it grows
      s.blasts = s.blasts.filter((b) => (b.t += dt) < b.life);
      for (const b of s.blasts) {
        const p = b.t / b.life;
        glow(ctx, b.x, b.y, b.r * (0.4 + p * 0.8), b.color.replace(/[\d.]+\)$/, "0.95)"), (1 - p) * 0.9);
        if (p < 0.45) glow(ctx, b.x, b.y, b.r * (0.25 + p * 0.5), "rgba(255,250,235,1)", (1 - p / 0.45) * 0.9);
      }

      // shockwaves
      s.rings = s.rings.filter((g) => (g.t += dt) < 0.45);
      for (const g of s.rings) {
        const p = g.t / 0.45;
        ctx.globalAlpha = (1 - p) * 0.8;
        ctx.strokeStyle = g.color;
        ctx.lineWidth = 3 * (1 - p) + 0.5;
        ctx.beginPath();
        ctx.arc(g.x, g.y, g.r * (0.3 + p * 0.7), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // ship
      const blink = s.invuln > 0 && Math.floor(s.invuln * 14) % 2 === 0;
      if (!s.dead) {
        const tilt = Math.max(-0.3, Math.min(0.3, s.vx / 1000));
        const look = SHOT_LOOK[s.pow];
        // engine flame (flickers; longer at higher fire rates)
        const fl = 10 + s.rate * 1.5 + Math.random() * 6;
        glow(ctx, s.px, SHIP_Y + SHIP_H * 0.5, 24 + s.rate * 2, "rgba(70,170,255,0.9)", 0.75);
        if (blink) ctx.globalAlpha = 0.35;
        ctx.save();
        ctx.translate(s.px, SHIP_Y);
        ctx.rotate(tilt);
        const flame = ctx.createLinearGradient(0, SHIP_H / 2 - 4, 0, SHIP_H / 2 + fl);
        flame.addColorStop(0, "rgba(255,255,255,0.95)");
        flame.addColorStop(0.4, "rgba(110,200,255,0.9)");
        flame.addColorStop(1, "rgba(40,90,255,0)");
        ctx.fillStyle = flame;
        ctx.beginPath();
        ctx.moveTo(-4.5, SHIP_H / 2 - 5);
        ctx.lineTo(0, SHIP_H / 2 + fl);
        ctx.lineTo(4.5, SHIP_H / 2 - 5);
        ctx.closePath();
        ctx.fill();
        // extra cannon pods as the laser rows grow
        if (s.rows >= 2) {
          for (const side of [-1, 1]) {
            const x = side * (s.rows >= 4 ? 17 : 14);
            ctx.fillStyle = "#3a5fc4";
            ctx.fillRect(x - 2.5, -2, 5, 11);
            ctx.fillStyle = "#c8d6ee";
            ctx.fillRect(x - 1, -6, 2, 6);
            ctx.fillStyle = look.core;
            ctx.fillRect(x - 1, -7, 2, 1.5);
          }
        }
        const sw = spr.ship.width / SPR;
        const sh = spr.ship.height / SPR;
        ctx.drawImage(spr.ship, -sw / 2, -sh / 2, sw, sh);
        // a nose cannon whenever a stream fires from the centre
        if (ROWS[s.rows].some(([ox]) => ox === 0)) {
          ctx.fillStyle = "#c8d6ee";
          ctx.fillRect(-1, -SHIP_H / 2 - 3, 2, 5);
        }
        ctx.restore();
        ctx.globalAlpha = 1;
        // muzzle flashes on the cannons, in the bolts' colour
        if (s.muzzle > 0 && s.running) {
          for (const [ox] of ROWS[s.rows]) glow(ctx, s.px + ox, SHIP_Y - 8, 7 + s.pow, look.glow, 0.85);
        }
        // shield bubble
        if (s.shield) {
          const t = now / 1000;
          glow(ctx, s.px, SHIP_Y + 2, 44, "rgba(90,220,255,0.8)", 0.28 + Math.sin(t * 4) * 0.06);
          ctx.strokeStyle = "rgba(150,240,255,0.75)";
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(s.px, SHIP_Y + 2, 29, 0, Math.PI * 2);
          ctx.stroke();
          ctx.strokeStyle = "rgba(255,255,255,0.9)";
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.arc(s.px, SHIP_Y + 2, 29, t * 2.4, t * 2.4 + 0.9);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(s.px, SHIP_Y + 2, 29, t * 2.4 + Math.PI, t * 2.4 + Math.PI + 0.9);
          ctx.stroke();
        }
      }

      s.parts.draw(ctx);

      // popups
      ctx.textAlign = "center";
      s.popups = s.popups.filter((p) => (p.t += dt) < 0.8);
      for (const p of s.popups) {
        ctx.globalAlpha = 1 - p.t / 0.8;
        ctx.font = p.text.startsWith("NEAR") ? "700 12px Inter, system-ui, sans-serif" : "800 13px Inter, system-ui, sans-serif";
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, p.x, p.y - 8 - p.t * 36);
      }
      ctx.globalAlpha = 1;
      ctx.restore();

      // ---- overlays (not shaken) ----
      ctx.drawImage(spr.vignette, 0, 0, W, H);

      if (s.running) {
        // combo meter (top left) while a chain is going
        if (s.chain >= 4 && s.t - s.lastKill < COMBO_WINDOW) {
          const mult = Math.min(4, 1 + Math.floor((s.chain - 1) / 3));
          const left = 1 - (s.t - s.lastKill) / COMBO_WINDOW;
          ctx.textAlign = "left";
          ctx.font = "900 16px Inter, system-ui, sans-serif";
          ctx.fillStyle = "#ffd84a";
          ctx.fillText(`COMBO ×${mult}`, 10, 24);
          ctx.fillStyle = "rgba(255,216,74,0.35)";
          ctx.fillRect(10, 30, 80, 3);
          ctx.fillStyle = "#ffd84a";
          ctx.fillRect(10, 30, 80 * left, 3);
        }

        // weapon HUD (top right): a pip per level for power, rows and fire rate
        const hud: [string, number, number, string][] = [
          ["PWR", s.pow, POWER.length - 1, DROP_LOOK.power.color],
          ["ROWS", s.rows, ROWS.length - 1, DROP_LOOK.rows.color],
          ["RATE", s.rate, RATE.length - 1, DROP_LOOK.rate.color],
        ];
        ctx.textAlign = "right";
        ctx.font = "800 8px Inter, system-ui, sans-serif";
        hud.forEach(([label, lvl, max, color], i) => {
          const y = 12 + i * 11;
          const right = W - 8;
          for (let p = max; p >= 0; p--) {
            const x = right - (max - p) * 7 - 5;
            ctx.fillStyle = p <= lvl ? color : "rgba(255,255,255,0.16)";
            ctx.fillRect(x, y - 5, 5, 5);
          }
          ctx.fillStyle = "rgba(230,236,255,0.8)";
          ctx.fillText(label, right - 5 * 7 - 6, y); // one column of labels, left of the longest row
        });
        // active specials: a draining bar each
        let sy2 = 12 + hud.length * 11 + 4;
        const bar = (label: string, frac: number, color: string) => {
          ctx.fillStyle = "rgba(0,0,0,0.45)";
          ctx.fillRect(W - 68, sy2 - 6, 60, 7);
          ctx.fillStyle = color;
          ctx.fillRect(W - 67, sy2 - 5, 58 * frac, 5);
          ctx.fillStyle = "rgba(230,236,255,0.85)";
          ctx.fillText(label, W - 72, sy2);
          sy2 += 11;
        };
        if (s.laser > 0) bar("LASER", s.laser / LASER_TIME, "#ff7ad9");
        if (s.missileT > 0) bar("MISSILES", s.missileT / MISSILE_TIME, "#ffb347");
        if (s.shield) bar("SHIELD", 1, "#7df9ff");
      }

      // upgrade banner
      if (s.banner) {
        const b = s.banner;
        b.t += dt;
        const life = 1.4;
        if (b.t >= life) s.banner = null;
        else {
          const pin = Math.min(1, b.t / 0.12);
          const out = b.t > life - 0.35 ? (life - b.t) / 0.35 : 1;
          const pop = 1 + (1 - pin) * 0.4;
          ctx.save();
          ctx.globalAlpha = pin * out;
          ctx.translate(W / 2, H * 0.32);
          ctx.scale(pop, pop);
          ctx.textAlign = "center";
          ctx.font = "900 20px Inter, system-ui, sans-serif";
          ctx.lineWidth = 4;
          ctx.strokeStyle = "rgba(0,0,0,0.6)";
          ctx.strokeText(b.text, 0, 0);
          ctx.fillStyle = b.color;
          ctx.fillText(b.text, 0, 0);
          if (b.sub) {
            ctx.font = "700 11px Inter, system-ui, sans-serif";
            ctx.lineWidth = 3;
            ctx.strokeText(b.sub, 0, 17);
            ctx.fillStyle = "rgba(240,244,255,0.95)";
            ctx.fillText(b.sub, 0, 17);
          }
          ctx.restore();
        }
      }

      // white flash on big explosions
      if (s.flash > 0) {
        ctx.globalAlpha = Math.min(0.6, s.flash);
        ctx.fillStyle = "#fff6e8";
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
        s.flash = Math.max(0, s.flash - dt * 2.2);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function drag(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!st.current.running) return;
    const rect = e.currentTarget.getBoundingClientRect();
    st.current.target = ((e.clientX - rect.left) / rect.width) * W;
  }

  return (
    <div className="game-surface">
      <p className="game-status">
        {over
          ? `Crashed! Score ${score} · ${kills} destroyed · weapon Lv ${level}`
          : running
            ? `Score ${score} · ${kills} destroyed · weapon Lv ${level}`
            : "Grab capsules to upgrade your blaster."}
      </p>
      <canvas
        ref={canvasRef}
        className="arcade-canvas arcade-frame"
        style={{ width: W, maxWidth: "100%", aspectRatio: `${W} / ${H}`, touchAction: "none" }}
        onPointerMove={drag}
        onPointerDown={drag}
        onPointerLeave={() => (st.current.target = null)}
      />
      {!running ? (
        <button type="button" className="primary-btn" onClick={start}>
          {over ? "Play again" : "Start"}
        </button>
      ) : null}
    </div>
  );
}
