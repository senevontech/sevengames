import { useEffect, useRef, useState } from "react";
import type { GameProps } from "./index";
import { Particles, Shake, glow, reducedMotion, setupCanvas } from "./fx";

/*
 * Dodge: pilot a ship through a meteor shower and the creatures that live in it. The ship's
 * blaster fires on its own; steer to aim. Meteors and creatures come in types, some tougher than
 * others, and new ones show up the longer you last. One hit ends the run.
 * Score = 10 per second survived + 5 per near miss + points per kill (quick kills chain a combo).
 *
 * Built for slow phones: every meteor / creature body, the ship and the nebula are drawn once
 * into small offscreen canvases at the start and only copied (drawImage) each frame; glows use
 * the shared glow sprite (no shadowBlur); fixed pools for enemies, bullets and particles.
 */

const W = 320;
const H = 460;
const SHIP_Y = H - 58;
const SHIP_W = 34;
const SHIP_H = 40;
const MAX_FOES = 40;
const MAX_SHOTS = 32;
const FIRE_EVERY = 0.2;
const SHOT_SPEED = 560;
const COMBO_WINDOW = 1.6;

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
};
const KINDS: Record<Kind, KindDef> = {
  pebble: { r: [8, 11], hp: 1, pts: 10, v: [170, 230], from: 0, weight: 3, boom: "rgba(255,150,80,1)" },
  rock: { r: [13, 18], hp: 2, pts: 20, v: [130, 180], from: 0, weight: 4, boom: "rgba(255,120,70,1)" },
  jelly: { r: [15, 17], hp: 3, pts: 40, v: [85, 115], from: 10, weight: 1.6, boom: "rgba(255,110,220,1)" },
  boulder: { r: [23, 28], hp: 6, pts: 60, v: [75, 100], from: 15, weight: 1.4, boom: "rgba(255,170,90,1)" },
  comet: { r: [9, 12], hp: 1, pts: 25, v: [310, 370], from: 25, weight: 1.2, boom: "rgba(140,220,255,1)" },
  stinger: { r: [13, 14], hp: 4, pts: 60, v: [105, 125], from: 30, weight: 1.1, boom: "rgba(150,255,120,1)" },
  eye: { r: [25, 27], hp: 12, pts: 120, v: [52, 62], from: 45, weight: 0.6, boom: "rgba(200,120,255,1)" },
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
type Shot = { alive: boolean; x: number; y: number };
type Star = { x: number; y: number; z: number };
type Ring = { x: number; y: number; t: number; r: number; color: string };
type Popup = { x: number; y: number; t: number; text: string; color: string };

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
  // faint far stars baked in
  for (let i = 0; i < 90; i++) {
    g.fillStyle = `rgba(210,220,255,${0.15 + Math.random() * 0.35})`;
    g.fillRect(Math.random() * W, Math.random() * H, 1, 1);
  }
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

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export default function DodgeGame({ onFinish }: GameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [running, setRunning] = useState(false);
  const [over, setOver] = useState(false);
  const [score, setScore] = useState(0);
  const [kills, setKills] = useState(0);
  const st = useRef({
    px: W / 2,
    vx: 0,
    target: null as number | null,
    left: false,
    right: false,
    foes: Array.from({ length: MAX_FOES }, () => ({ alive: false }) as Foe),
    shots: Array.from({ length: MAX_SHOTS }, () => ({ alive: false, x: 0, y: 0 }) as Shot),
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
    stars: [] as Star[],
    rings: [] as Ring[],
    parts: new Particles(320),
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
    s.t = 0;
    s.spawn = 0.5;
    s.fire = 0.3;
    s.bonus = 0;
    s.kills = 0;
    s.chain = 0;
    s.lastKill = -10;
    s.dead = false;
    s.flash = 0;
    s.popups = [];
    s.rings = [];
    s.parts.clear();
    s.running = true;
    setScore(0);
    setKills(0);
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
    const spr = getSprites();
    if (!s.stars.length) s.stars = Array.from({ length: 60 }, () => ({ x: Math.random() * W, y: Math.random() * H, z: 0.25 + Math.random() * 0.75 }));

    const spawnFoe = (speedUp: number) => {
      const f = s.foes.find((q) => !q.alive);
      if (!f) return;
      const kind = pickKind(s.t);
      const d = KINDS[kind];
      const r = rand(d.r[0], d.r[1]);
      const x = rand(r + 4, W - r - 4);
      const hp = d.hp + (kind === "eye" || kind === "boulder" ? Math.floor(s.t / 60) : 0);
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
      s.parts.burst(f.x, f.y, big ? 34 : 18, d.boom, { speed: big ? 230 : 170, life: 0.7, size: big ? 4 : 3 });
      s.parts.burst(f.x, f.y, big ? 10 : 5, "rgba(255,255,230,1)", { speed: 90, life: 0.4, size: 2 });
      if (f.kind === "pebble" || f.kind === "rock" || f.kind === "boulder" || f.kind === "comet") {
        // rock debris: chunky, falls a little
        s.parts.burst(f.x, f.y, big ? 12 : 6, f.kind === "comet" ? "rgba(170,220,255,1)" : "rgba(150,110,95,1)", { speed: 120, life: 0.9, size: big ? 5 : 4, gravity: 140 });
      }
      if (s.rings.length < 8) s.rings.push({ x: f.x, y: f.y, t: 0, r: f.r * (big ? 3 : 2.2), color: d.boom });
      if (big) {
        s.shake.kick(f.kind === "eye" ? 9 : 6);
        if (!calm) s.flash = Math.max(s.flash, f.kind === "eye" ? 0.35 : 0.18);
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
        // smooth steering: keys accelerate, drag eases toward the finger
        if (s.target !== null) s.vx = (s.target - s.px) * 12;
        else {
          const want = (s.right ? 1 : 0) - (s.left ? 1 : 0);
          s.vx += (want * 330 - s.vx) * Math.min(1, dt * 12);
        }
        s.px = Math.max(SHIP_W / 2, Math.min(W - SHIP_W / 2, s.px + s.vx * dt));

        if (s.spawn <= 0) {
          spawnFoe(speedUp);
          s.spawn = Math.max(0.24, 0.7 - s.t * 0.01);
        }

        // auto blaster: twin shots from the wing cannons
        s.fire -= dt;
        if (s.fire <= 0) {
          s.fire += FIRE_EVERY;
          let n = 0;
          for (const b of s.shots) {
            if (b.alive) continue;
            b.alive = true;
            b.x = s.px + (n ? 9 : -9);
            b.y = SHIP_Y - 6;
            if (++n === 2) break;
          }
          s.muzzle = 0.06;
        }
        s.muzzle -= dt;

        for (const b of s.shots) {
          if (!b.alive) continue;
          b.y -= SHOT_SPEED * dt;
          if (b.y < -12) b.alive = false;
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

          // shots
          for (const b of s.shots) {
            if (!b.alive) continue;
            const dx = b.x - f.x;
            const dy = b.y - f.y;
            if (dx * dx + dy * dy < (f.r + 3) * (f.r + 3)) {
              b.alive = false;
              f.hp--;
              f.flash = 0.08;
              s.parts.burst(b.x, b.y + 2, 4, "rgba(255,240,170,1)", { speed: 110, life: 0.25, size: 2, angle: -Math.PI / 2, spread: 1.6 });
              if (f.hp <= 0) {
                killFoe(f);
                break;
              }
            }
          }
          if (!f.alive) continue;

          // the ship (body approximated by a circle)
          const dx = f.x - s.px;
          const dy = f.y - (SHIP_Y + 4);
          const d = Math.hypot(dx, dy);
          if (d < f.r * 0.85 + 12) {
            s.running = false;
            s.dead = true;
            s.parts.burst(s.px, SHIP_Y, 70, "rgba(255,140,60,1)", { speed: 280, life: 1.1, size: 4 });
            s.parts.burst(s.px, SHIP_Y, 36, "rgba(120,200,255,1)", { speed: 190, life: 0.9, size: 3 });
            s.parts.burst(s.px, SHIP_Y, 14, "rgba(200,210,230,1)", { speed: 140, life: 1.2, size: 5, gravity: 120 });
            s.rings.push({ x: s.px, y: SHIP_Y, t: 0, r: 90, color: "rgba(255,160,80,1)" });
            s.shake.kick(16);
            if (!calm) s.flash = 0.5;
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
        // engine exhaust
        if (!calm) s.parts.burst(s.px, SHIP_Y + SHIP_H / 2 - 2, 2, "rgba(90,180,255,1)", { speed: 100, life: 0.32, size: 3, angle: Math.PI / 2, spread: 0.5 });
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

      // shots (under the foes they hit)
      for (const b of s.shots) {
        if (!b.alive) continue;
        glow(ctx, b.x, b.y, 9, "rgba(255,120,60,0.9)", 0.55);
        ctx.fillStyle = "#ffe8b0";
        ctx.fillRect(b.x - 1.5, b.y - 7, 3, 12);
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
          ctx.fillRect(f.x - bw / 2 + 0.5, f.y - f.r - 8.5, (bw - 1) * (f.hp / f.maxHp), 3);
        }
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
      if (!s.dead) {
        const tilt = Math.max(-0.3, Math.min(0.3, s.vx / 1000));
        // engine flame (flickers)
        const fl = 10 + Math.random() * 6;
        glow(ctx, s.px, SHIP_Y + SHIP_H * 0.5, 24, "rgba(70,170,255,0.9)", 0.75);
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
        const sw = spr.ship.width / SPR;
        const sh = spr.ship.height / SPR;
        ctx.drawImage(spr.ship, -sw / 2, -sh / 2, sw, sh);
        ctx.restore();
        // muzzle flashes on the cannons
        if (s.muzzle > 0 && s.running) {
          glow(ctx, s.px - 9, SHIP_Y - 8, 8, "rgba(255,200,120,0.95)", 0.9);
          glow(ctx, s.px + 9, SHIP_Y - 8, 8, "rgba(255,200,120,0.95)", 0.9);
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

      // combo meter (top left) while a chain is going
      if (s.running && s.chain >= 4 && s.t - s.lastKill < COMBO_WINDOW) {
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
      ctx.restore();

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
          ? `Crashed! Score ${score} · ${kills} destroyed.`
          : running
            ? `Score ${score} · ${kills} destroyed`
            : "Your blaster fires on its own. Steer, shoot, don't get hit."}
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
