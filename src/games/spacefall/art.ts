/* Spacefall art: every ship, rock, creature, boss, pickup and backdrop is painted once in code
   into an offscreen canvas (2 px per world unit) and only copied with drawImage while playing.
   Lighting is consistent: a key light from the upper left (a sheen laid over each finished
   sprite), metal is gradient-shaded with panel lines and fine grain, glows are added at runtime. */
import { PICKUPS, REGIONS, STAGES, type EnemyKind, type PickupKind, type Region } from "./config";

export const SPR = 2;

export type Sprite = { c: HTMLCanvasElement; w: number; h: number };

/* ---------- helpers ---------- */

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type G = CanvasRenderingContext2D;

function sprite(w: number, h: number, draw: (g: G) => void, sheen = true): Sprite {
  const c = document.createElement("canvas");
  c.width = Math.ceil(w * SPR);
  c.height = Math.ceil(h * SPR);
  const g = c.getContext("2d")!;
  g.scale(SPR, SPR);
  g.translate(w / 2, h / 2);
  g.lineJoin = "round";
  g.lineCap = "round";
  draw(g);
  if (sheen) {
    // one light for everything: brighter upper-left, darker lower-right, only over what's drawn
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = "source-atop";
    const gr = g.createLinearGradient(0, 0, c.width, c.height);
    gr.addColorStop(0, "rgba(255,255,255,0.16)");
    gr.addColorStop(0.45, "rgba(255,255,255,0)");
    gr.addColorStop(1, "rgba(0,0,0,0.32)");
    g.fillStyle = gr;
    g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = "source-over";
  }
  return { c, w, h };
}

/** both halves of a symmetric part (the ship faces up / down along the y axis) */
function sym(g: G, part: () => void) {
  part();
  g.save();
  g.scale(-1, 1);
  part();
  g.restore();
}

function poly(g: G, pts: number[]) {
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.closePath();
}

/** brushed metal fill across x0..x1, with an outline */
function metal(g: G, x0: number, x1: number, c: [string, string, string], edge = "rgba(10,14,22,0.85)", lw = 0.9) {
  const gr = g.createLinearGradient(x0, 0, x1, 0);
  gr.addColorStop(0, c[0]);
  gr.addColorStop(0.55, c[1]);
  gr.addColorStop(1, c[2]);
  g.fillStyle = gr;
  g.fill();
  g.strokeStyle = edge;
  g.lineWidth = lw;
  g.stroke();
}

/** fine grain inside the current path (a little texture so metal isn't flat) */
function grain(g: G, seed: number, x: number, y: number, w: number, h: number, n: number, alpha = 0.12) {
  const r = rng(seed);
  g.save();
  g.clip();
  for (let i = 0; i < n; i++) {
    g.fillStyle = r() < 0.5 ? `rgba(255,255,255,${alpha * r()})` : `rgba(0,0,0,${alpha * 1.4 * r()})`;
    g.fillRect(x + r() * w, y + r() * h, 0.6 + r() * 1.2, 0.4 + r() * 0.6);
  }
  g.restore();
}

function lines(g: G, segs: number[][], color = "rgba(0,0,0,0.38)", lw = 0.6) {
  g.strokeStyle = color;
  g.lineWidth = lw;
  g.beginPath();
  for (const s of segs) {
    g.moveTo(s[0], s[1]);
    for (let i = 2; i < s.length; i += 2) g.lineTo(s[i], s[i + 1]);
  }
  g.stroke();
}

function glass(g: G, x: number, y: number, rx: number, ry: number, tint = "#7fd8ff") {
  g.beginPath();
  g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  const gr = g.createLinearGradient(x - rx, y - ry, x + rx, y + ry);
  gr.addColorStop(0, "#e6fbff");
  gr.addColorStop(0.25, tint);
  gr.addColorStop(1, "#06121f");
  g.fillStyle = gr;
  g.fill();
  g.strokeStyle = "rgba(0,0,0,0.7)";
  g.lineWidth = 0.7;
  g.stroke();
  g.beginPath();
  g.ellipse(x - rx * 0.35, y - ry * 0.4, rx * 0.28, ry * 0.3, -0.4, 0, Math.PI * 2);
  g.fillStyle = "rgba(255,255,255,0.7)";
  g.fill();
}

function barrel(g: G, x: number, y0: number, y1: number, w: number, brake = true) {
  const top = Math.min(y0, y1);
  const len = Math.abs(y1 - y0);
  g.beginPath();
  g.rect(x - w / 2, top, w, len);
  metal(g, x - w / 2, x + w / 2, ["#d9dee6", "#7d8794", "#2b313b"], "rgba(5,8,12,0.9)", 0.6);
  if (brake) {
    g.beginPath();
    g.rect(x - w / 2 - 0.6, top, w + 1.2, 2);
    g.fillStyle = "#3a414c";
    g.fill();
  }
  g.fillStyle = "rgba(0,0,0,0.85)";
  g.fillRect(x - w * 0.22, top - 0.2, w * 0.44, 1);
}

/** a soft round blob (for nebulas, smoke and glows) */
function blob(g: G, x: number, y: number, r: number, color: string) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, color);
  gr.addColorStop(1, color.replace(/[\d.]+\)$/, "0)"));
  g.fillStyle = gr;
  g.fillRect(x - r, y - r, r * 2, r * 2);
}

/* ---------- the player's ship: six stages built from modular parts ---------- */

const STEEL: [string, string, string] = ["#eef2f7", "#8f9aa8", "#3a424e"];
const DARK: [string, string, string] = ["#8a94a3", "#454d59", "#1b2028"];

function shipStage(stage: number): Sprite {
  const S = STAGES[stage];
  const size = S.size + 8;
  const acc = S.accent;
  return sprite(size, size, (g) => {
    // ----- wings
    sym(g, () => {
      if (stage === 0) poly(g, [5, -2, 21, 12, 21, 17, 6, 15]);
      else if (stage === 1) poly(g, [6, -6, 27, 8, 27, 14, 20, 17, 7, 15]);
      else if (stage === 2) poly(g, [7, 2, 29, -4, 31, 1, 27, 13, 8, 17]);
      else if (stage === 3) poly(g, [9, -4, 35, 6, 37, 16, 28, 21, 10, 21]);
      else if (stage === 4) poly(g, [10, -8, 37, 0, 40, 14, 30, 23, 11, 23]);
      else poly(g, [12, -10, 45, -2, 51, 12, 46, 24, 34, 27, 12, 27]);
      metal(g, 4, 40 + stage * 2, STEEL);
      grain(g, 11 + stage, 0, -12, 52, 40, 140);
      // accent stripe along the leading edge
      g.strokeStyle = acc;
      g.lineWidth = 1.3;
      g.beginPath();
      if (stage === 0) (g.moveTo(7, 1), g.lineTo(19, 12));
      else if (stage === 1) (g.moveTo(8, -3), g.lineTo(25, 9));
      else if (stage === 2) (g.moveTo(9, 3), g.lineTo(28, -2));
      else if (stage === 3) (g.moveTo(11, -1), g.lineTo(33, 8));
      else if (stage === 4) (g.moveTo(12, -5), g.lineTo(36, 2));
      else (g.moveTo(14, -7), g.lineTo(44, 0));
      g.stroke();
      lines(g, stage === 0 ? [[8, 6, 18, 14]] : [[10, 4, 22, 12], [12, 10, 24, 16]]);
    });
    // forward canards / fins
    if (stage >= 2) {
      sym(g, () => {
        if (stage >= 5) poly(g, [13, -24, 25, -31, 23, -18, 14, -16]);
        else poly(g, [6, -15, 15, -11, 15, -7, 6, -8]);
        metal(g, 6, 24, STEEL);
      });
    }
    // side weapon pods on struts (elite +)
    if (stage >= 4) {
      const px = stage >= 5 ? 46 : 42;
      sym(g, () => {
        g.beginPath();
        g.rect(28, 3, px - 31, 4);
        metal(g, 28, px, DARK);
        g.beginPath();
        g.roundRect(px - 5, -12, 10, 27, 4);
        metal(g, px - 5, px + 5, STEEL);
        grain(g, 77, px - 5, -12, 10, 27, 30);
        g.fillStyle = acc;
        g.fillRect(px - 3.5, 8, 7, 2);
        barrel(g, px, -6, -16, 2.8);
        if (stage >= 5) barrel(g, px - 3, -4, -12, 2);
        // a little nav light
        g.fillStyle = "rgba(255,255,255,0.9)";
        g.fillRect(px - 0.8, 12, 1.6, 1.6);
      });
    }
    // missile racks under the wings (interceptor +)
    if (stage >= 2) {
      sym(g, () => {
        const x = stage >= 3 ? 20 : 15;
        const y = stage >= 3 ? 6 : 4;
        g.beginPath();
        g.roundRect(x - 4.5, y, 9, 12, 2);
        metal(g, x - 4.5, x + 4.5, DARK);
        const tubes = stage >= 3 ? 3 : 2;
        for (let i = 0; i < tubes; i++) {
          const tx = x - 3 + (6 / Math.max(1, tubes - 1)) * i;
          g.fillStyle = "#c9ced6";
          g.fillRect(tx - 0.9, y - 3, 1.8, 4);
          g.fillStyle = "#e5483a";
          g.fillRect(tx - 0.9, y - 4.2, 1.8, 1.4);
        }
      });
    }
    // wing / side cannons
    if (stage === 1) sym(g, () => barrel(g, 21, -12, -2, 2.6));
    if (stage === 2) sym(g, () => barrel(g, 23, -11, 0, 2.6));
    if (stage >= 3) sym(g, () => barrel(g, stage >= 4 ? 30 : 29, -14, 0, 3.2));
    // ----- fuselage
    const L = [24, 28, 30, 34, 40, 46][stage];
    const Wd = [7, 9, 10, 13, 13, 15][stage];
    const T = [20, 22, 24, 28, 30, 32][stage];
    g.beginPath();
    g.moveTo(0, -L);
    g.bezierCurveTo(Wd * 0.7, -L * 0.7, Wd * 1.1, -L * 0.25, Wd, T * 0.55);
    g.lineTo(Wd * 0.75, T);
    g.lineTo(-Wd * 0.75, T);
    g.lineTo(-Wd, T * 0.55);
    g.bezierCurveTo(-Wd * 1.1, -L * 0.25, -Wd * 0.7, -L * 0.7, 0, -L);
    g.closePath();
    metal(g, -Wd, Wd, STEEL);
    grain(g, 5 + stage, -Wd, -L, Wd * 2, L + T, 160);
    // panel lines and a spine
    lines(g, [[0, -L * 0.55, 0, T - 2], [-Wd * 0.7, -2, Wd * 0.7, -2], [-Wd * 0.8, 10, Wd * 0.8, 10]], "rgba(0,0,0,0.3)", 0.5);
    // armour plates (heavy +)
    if (stage >= 3) {
      sym(g, () => {
        poly(g, [2, -L * 0.42, Wd * 0.85, -L * 0.2, Wd * 0.9, 6, 2, 8]);
        metal(g, 2, Wd, DARK, "rgba(0,0,0,0.8)", 0.6);
        grain(g, 31, 0, -L * 0.42, Wd, L * 0.6, 40, 0.15);
      });
    }
    // gold trim on the destroyer
    if (stage >= 5) {
      g.strokeStyle = "#ffcc4a";
      g.lineWidth = 0.9;
      sym(g, () => {
        g.beginPath();
        g.moveTo(1.5, -L * 0.8);
        g.lineTo(Wd * 0.9, -L * 0.2);
        g.lineTo(Wd * 0.95, T * 0.5);
        g.stroke();
      });
    }
    // primary cannons
    if (stage <= 1) barrel(g, 0, -L - 4, -L + 6, 3);
    if (stage === 2) sym(g, () => barrel(g, 8, -L + 2, -L + 14, 2.8));
    if (stage >= 3) sym(g, () => barrel(g, stage >= 4 ? 12 : 12, -L - 1, -L + 18, 3.6));
    // laser emitter crystal at the nose (elite +)
    if (stage >= 4) {
      poly(g, [0, -L - 3, 3.2, -L + 3, 0, -L + 9, -3.2, -L + 3]);
      const gr = g.createLinearGradient(0, -L - 3, 0, -L + 9);
      gr.addColorStop(0, "#ffffff");
      gr.addColorStop(0.4, acc);
      gr.addColorStop(1, "#2a0a3a");
      g.fillStyle = gr;
      g.fill();
      g.strokeStyle = "rgba(0,0,0,0.6)";
      g.lineWidth = 0.5;
      g.stroke();
    }
    // tail fins
    sym(g, () => {
      poly(g, [Wd * 0.6, T * 0.5, Wd + 5, T + 3, Wd * 0.7, T + 2]);
      metal(g, Wd * 0.6, Wd + 5, DARK);
    });
    // shield generator ring (interceptor +)
    if (stage >= 2) {
      g.beginPath();
      g.arc(0, 9, 3.6, 0, Math.PI * 2);
      g.fillStyle = "#11161e";
      g.fill();
      g.strokeStyle = acc;
      g.lineWidth = 1.2;
      g.stroke();
    }
    // engine nozzles
    for (const [nx, ny, nw] of S.nozzles) {
      g.beginPath();
      g.moveTo(nx - nw / 2, ny - 4);
      g.lineTo(nx + nw / 2, ny - 4);
      g.lineTo(nx + nw * 0.62, ny + 1);
      g.lineTo(nx - nw * 0.62, ny + 1);
      g.closePath();
      metal(g, nx - nw / 2, nx + nw / 2, DARK);
      g.fillStyle = "#0a0d12";
      g.fillRect(nx - nw * 0.45, ny - 0.4, nw * 0.9, 1.2);
    }
    // cockpit
    glass(g, 0, -L * 0.42, stage >= 3 ? 3.8 : 3.2, stage >= 3 ? 7.5 : 6.5);
    // accent markings
    g.fillStyle = acc;
    sym(g, () => g.fillRect(Wd * 0.35, 2, 1.4, 6));
  });
}

let shipCache: Sprite[] | null = null;
export const shipSprites = () => (shipCache ??= STAGES.map((_, i) => shipStage(i)));

export const droneSprite = once(() =>
  sprite(22, 22, (g) => {
    g.beginPath();
    g.arc(0, 0, 8, 0, Math.PI * 2);
    metal(g, -8, 8, STEEL);
    grain(g, 3, -8, -8, 16, 16, 30);
    g.beginPath();
    g.arc(0, 0, 8, 0, Math.PI * 2);
    g.strokeStyle = "#6cf0ff";
    g.lineWidth = 1.2;
    g.stroke();
    barrel(g, 0, -11, -4, 2.2, false);
    glass(g, 0, 1, 3, 3, "#59d8ff");
  }),
);

function once<T>(f: () => T) {
  let v: T | undefined;
  return () => (v ??= f());
}

/* ---------- enemies (they face down: +y) ---------- */

const RED: [string, string, string] = ["#ffb3a6", "#b8332a", "#3a0b08"];
const GUN: [string, string, string] = ["#c7cdd4", "#5a636e", "#1d2228"];
const OLIVE: [string, string, string] = ["#c3d39a", "#5b6b34", "#1f2610"];
const AMBER: [string, string, string] = ["#ffe0a0", "#c27a1e", "#43230a"];

function enemyArt(kind: EnemyKind, variant: number): Sprite {
  switch (kind) {
    case "dart":
      return sprite(40, 40, (g) => {
        sym(g, () => {
          poly(g, [3, -8, 17, -4, 18, 2, 5, 6]);
          metal(g, 3, 18, RED);
          grain(g, 9, 0, -10, 18, 18, 40);
          lines(g, [[6, -4, 15, -1]]);
        });
        poly(g, [0, 18, 5, 4, 5, -12, 0, -15, -5, -12, -5, 4]);
        metal(g, -5, 5, GUN);
        glass(g, 0, 4, 2.4, 4, "#ffb347");
        sym(g, () => barrel(g, 9, 3, 11, 2, false));
      });
    case "wing":
      return sprite(36, 34, (g) => {
        sym(g, () => {
          poly(g, [0, 14, 16, -6, 17, -12, 11, -12, 0, 2]);
          metal(g, 0, 17, AMBER);
          grain(g, 4, 0, -12, 17, 26, 40);
          g.fillStyle = "#1b1209";
          g.fillRect(9, -8, 5, 1.4);
        });
        glass(g, 0, -1, 2.6, 4, "#ff5a3a");
      });
    case "gunner":
      return sprite(56, 54, (g) => {
        sym(g, () => {
          poly(g, [8, -18, 24, -8, 24, 8, 12, 18, 6, 12]);
          metal(g, 6, 24, GUN);
          grain(g, 21, 6, -18, 18, 36, 60);
          barrel(g, 15, 10, 25, 3.4);
          lines(g, [[10, -6, 22, -2], [10, 6, 22, 4]]);
        });
        g.beginPath();
        g.arc(0, 0, 11, 0, Math.PI * 2);
        metal(g, -11, 11, AMBER);
        g.beginPath();
        g.arc(0, 0, 5, 0, Math.PI * 2);
        g.fillStyle = "#1b0d03";
        g.fill();
        barrel(g, 0, 8, 22, 4);
      });
    case "tank":
      return sprite(72, 76, (g) => {
        sym(g, () => {
          g.beginPath();
          g.roundRect(18, -30, 13, 58, 4);
          metal(g, 18, 31, DARK);
          for (let y = -26; y < 26; y += 6) lines(g, [[19, y, 30, y]], "rgba(0,0,0,0.45)", 0.8);
          poly(g, [6, -26, 18, -22, 18, 24, 6, 30]);
          metal(g, 6, 18, OLIVE);
          grain(g, 41, 6, -26, 12, 56, 70);
          barrel(g, 9, 16, 37, 5);
        });
        g.beginPath();
        g.roundRect(-10, -24, 20, 40, 5);
        metal(g, -10, 10, GUN);
        grain(g, 7, -10, -24, 20, 40, 60);
        lines(g, [[-8, -10, 8, -10], [-8, 4, 8, 4]]);
        glass(g, 0, -15, 4, 3, "#9bff6a");
      });
    case "kamikaze":
      return sprite(38, 40, (g) => {
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          poly(g, [Math.cos(a - 0.25) * 9, Math.sin(a - 0.25) * 9, Math.cos(a) * 17, Math.sin(a) * 17, Math.cos(a + 0.25) * 9, Math.sin(a + 0.25) * 9]);
          metal(g, -17, 17, GUN);
        }
        g.beginPath();
        g.arc(0, 0, 10, 0, Math.PI * 2);
        metal(g, -10, 10, RED);
        grain(g, 2, -10, -10, 20, 20, 40);
      });
    case "drone":
      return sprite(26, 26, (g) => {
        g.beginPath();
        g.arc(0, 0, 10, 0, Math.PI * 2);
        metal(g, -10, 10, GUN);
        grain(g, 8, -10, -10, 20, 20, 30);
        sym(g, () => {
          g.beginPath();
          g.rect(8, -2, 4, 4);
          metal(g, 8, 12, DARK);
        });
        g.beginPath();
        g.arc(0, 1, 4, 0, Math.PI * 2);
        g.fillStyle = "#2a0303";
        g.fill();
      });
    case "platform":
      return sprite(70, 70, (g) => {
        g.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
          g.lineTo(Math.cos(a) * 30, Math.sin(a) * 30);
        }
        g.closePath();
        metal(g, -30, 30, GUN);
        grain(g, 13, -30, -30, 60, 60, 120);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
          lines(g, [[Math.cos(a) * 12, Math.sin(a) * 12, Math.cos(a) * 28, Math.sin(a) * 28]]);
        }
        g.beginPath();
        g.arc(0, 0, 12, 0, Math.PI * 2);
        metal(g, -12, 12, DARK);
        for (let i = 0; i < 4; i++) {
          const x = -7.5 + i * 5;
          g.fillStyle = "#c9ced6";
          g.fillRect(x - 1.4, -4, 2.8, 9);
          g.fillStyle = "#e5483a";
          g.fillRect(x - 1.4, 4, 2.8, 2);
        }
      });
    case "launcher":
      return sprite(70, 72, (g) => {
        sym(g, () => {
          poly(g, [6, -30, 14, -18, 30, 0, 26, 14, 10, 20, 6, 30]);
          metal(g, 6, 30, GUN);
          grain(g, 17, 6, -30, 24, 60, 90);
          g.beginPath();
          g.roundRect(16, -6, 10, 18, 2);
          metal(g, 16, 26, DARK);
          for (let i = 0; i < 2; i++) {
            g.fillStyle = "#c9ced6";
            g.fillRect(18 + i * 4, 10, 2.4, 6);
            g.fillStyle = "#e5483a";
            g.fillRect(18 + i * 4, 15, 2.4, 2);
          }
        });
        g.beginPath();
        g.roundRect(-6, -26, 12, 50, 4);
        metal(g, -6, 6, RED);
        glass(g, 0, 12, 3, 5, "#ffb347");
      });
    case "mother":
      return sprite(170, 130, (g) => {
        sym(g, () => {
          poly(g, [0, 58, 30, 50, 78, 16, 82, -10, 60, -40, 20, -54, 0, -56]);
          metal(g, 0, 82, GUN);
          grain(g, 51, 0, -56, 82, 114, 420);
          lines(g, [[10, -40, 60, -24], [14, -20, 74, -4], [14, 2, 72, 10], [12, 24, 50, 34]]);
          // hangar bays
          g.beginPath();
          g.roundRect(34, 12, 22, 12, 3);
          g.fillStyle = "#0b0f15";
          g.fill();
          g.strokeStyle = "rgba(255,150,70,0.9)";
          g.lineWidth = 1;
          g.stroke();
          // armour plates
          poly(g, [20, -46, 52, -32, 46, -14, 18, -24]);
          metal(g, 18, 52, RED, "rgba(0,0,0,0.8)", 0.7);
          barrel(g, 64, 0, 18, 4.5);
        });
        g.beginPath();
        g.arc(0, -4, 18, 0, Math.PI * 2);
        metal(g, -18, 18, DARK);
        g.beginPath();
        g.arc(0, -4, 9, 0, Math.PI * 2);
        g.fillStyle = "#2a0703";
        g.fill();
      });
    case "flyer":
      return sprite(52, 40, (g) => {
        sym(g, () => {
          g.beginPath();
          g.moveTo(3, -4);
          g.quadraticCurveTo(14, -18, 25, -10);
          g.quadraticCurveTo(20, -2, 23, 6);
          g.quadraticCurveTo(14, 2, 10, 10);
          g.quadraticCurveTo(7, 4, 3, 6);
          g.closePath();
          const gr = g.createLinearGradient(3, -16, 24, 8);
          gr.addColorStop(0, "rgba(220,140,255,0.95)");
          gr.addColorStop(1, "rgba(70,20,110,0.95)");
          g.fillStyle = gr;
          g.fill();
          g.strokeStyle = "rgba(30,6,50,0.9)";
          g.lineWidth = 0.8;
          g.stroke();
          lines(g, [[4, -2, 22, -9], [4, 1, 21, 4], [4, 3, 11, 9]], "rgba(255,210,255,0.45)", 0.5);
        });
        g.beginPath();
        g.ellipse(0, 0, 5, 12, 0, 0, Math.PI * 2);
        metal(g, -5, 5, ["#d5ffb0", "#4f9a2e", "#16300a"], "rgba(10,20,5,0.9)");
        g.fillStyle = "#ffe14a";
        sym(g, () => g.fillRect(1.4, 6, 1.8, 1.8));
      });
    case "swift":
      return sprite(36, 46, (g) => {
        sym(g, () => {
          poly(g, [2, -6, 15, -16, 16, -10, 4, 2]);
          g.fillStyle = "rgba(170,255,240,0.5)";
          g.fill();
          g.strokeStyle = "rgba(20,60,60,0.8)";
          g.lineWidth = 0.6;
          g.stroke();
          poly(g, [2, 4, 12, 12, 9, 15, 2, 9]);
          g.fillStyle = "rgba(170,255,240,0.45)";
          g.fill();
        });
        g.beginPath();
        g.ellipse(0, 0, 4.5, 18, 0, 0, Math.PI * 2);
        metal(g, -4.5, 4.5, ["#b4fff0", "#1f8a78", "#06302a"]);
        for (let y = -10; y < 14; y += 4) lines(g, [[-4, y, 4, y]], "rgba(0,30,25,0.6)", 0.6);
        g.fillStyle = "#ff3b5a";
        sym(g, () => {
          g.beginPath();
          g.arc(2.4, 14, 1.6, 0, Math.PI * 2);
          g.fill();
        });
      });
    case "brute":
      return sprite(76, 78, (g) => {
        sym(g, () => {
          poly(g, [4, 34, 10, 20, 22, 22, 14, 34]); // horns / mandibles
          metal(g, 4, 22, ["#f2e2c2", "#8a6a3a", "#2a1a08"]);
          g.beginPath();
          g.moveTo(0, -30);
          g.quadraticCurveTo(30, -28, 30, 0);
          g.quadraticCurveTo(28, 22, 0, 24);
          g.closePath();
          metal(g, 0, 30, ["#a7f08a", "#356b26", "#0f2209"]);
          grain(g, 61, 0, -30, 30, 54, 120, 0.2);
          lines(g, [[1, -18, 24, -16], [1, -4, 28, -2], [1, 10, 25, 12]], "rgba(5,15,2,0.6)", 0.9);
        });
        lines(g, [[0, -30, 0, 24]], "rgba(5,15,2,0.8)", 1.2);
        g.fillStyle = "#ff8a1a";
        sym(g, () => {
          g.beginPath();
          g.arc(6, 21, 2.2, 0, Math.PI * 2);
          g.fill();
        });
      });
    case "spitter":
      return sprite(56, 62, (g) => {
        // tentacles
        g.strokeStyle = "rgba(255,140,200,0.65)";
        g.lineWidth = 2;
        for (let i = -2; i <= 2; i++) {
          g.beginPath();
          g.moveTo(i * 5, 6);
          g.bezierCurveTo(i * 7 + 4, 14, i * 7 - 4, 20, i * 8, 28);
          g.stroke();
        }
        g.beginPath();
        g.moveTo(-20, 6);
        g.bezierCurveTo(-22, -26, 22, -26, 20, 6);
        g.quadraticCurveTo(0, 12, -20, 6);
        g.closePath();
        const gr = g.createRadialGradient(-5, -12, 2, 0, -4, 24);
        gr.addColorStop(0, "rgba(255,230,250,0.95)");
        gr.addColorStop(0.5, "rgba(230,90,180,0.85)");
        gr.addColorStop(1, "rgba(80,10,60,0.9)");
        g.fillStyle = gr;
        g.fill();
        g.strokeStyle = "rgba(60,5,40,0.9)";
        g.lineWidth = 0.9;
        g.stroke();
        g.beginPath();
        g.arc(0, -4, 6, 0, Math.PI * 2);
        g.fillStyle = "rgba(255,250,180,0.9)";
        g.fill();
      });
    case "mine":
    case "mineProx":
    case "mineMove":
    case "mineCluster":
    case "mineMini": {
      const r = kind === "mineCluster" ? 16 : kind === "mineMini" ? 6 : 11;
      const light = kind === "mineProx" ? "#ffd23a" : kind === "mineMove" ? "#4fc3ff" : "#ff3b30";
      return sprite(r * 2 + 16, r * 2 + 16, (g) => {
        const spikes = kind === "mineMini" ? 6 : 10;
        for (let i = 0; i < spikes; i++) {
          const a = (i / spikes) * Math.PI * 2;
          poly(g, [Math.cos(a - 0.18) * r, Math.sin(a - 0.18) * r, Math.cos(a) * (r + 6), Math.sin(a) * (r + 6), Math.cos(a + 0.18) * r, Math.sin(a + 0.18) * r]);
          metal(g, -r, r, DARK);
        }
        g.beginPath();
        g.arc(0, 0, r, 0, Math.PI * 2);
        metal(g, -r, r, GUN);
        grain(g, 19 + r, -r, -r, r * 2, r * 2, 50);
        lines(g, [[-r, 0, r, 0]], "rgba(0,0,0,0.45)", 0.7);
        if (kind === "mineCluster") {
          for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
            g.beginPath();
            g.arc(Math.cos(a) * 9, Math.sin(a) * 9, 4, 0, Math.PI * 2);
            metal(g, -4, 4, DARK);
          }
        }
        g.beginPath();
        g.arc(0, 0, r * 0.32, 0, Math.PI * 2);
        g.fillStyle = light;
        g.fill();
      });
    }
    default:
      return rockArt(kind, variant);
  }
}

function rockArt(kind: EnemyKind, variant: number): Sprite {
  const r = kind === "rockS" ? 16 : kind === "rockL" ? 42 : kind === "rockSplit" ? 38 : kind === "rockIron" ? 34 : 32;
  const seed = 100 + variant * 31 + r;
  const rnd = rng(seed);
  const pal: [string, string, string] =
    kind === "rockIron"
      ? ["#c9ccd2", "#5d626b", "#1a1c21"]
      : kind === "rockBoom"
        ? ["#9a7a6a", "#4a2e22", "#160a06"]
        : variant % 2
          ? ["#b8a48c", "#6a5440", "#1e150c"]
          : ["#a8a49c", "#5c5852", "#1a1815"];
  const pts: number[] = [];
  const n = 13;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (0.78 + rnd() * 0.26);
    pts.push(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  return sprite(r * 2 + 6, r * 2 + 6, (g) => {
    g.beginPath();
    g.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) {
      const mx = (pts[i - 2] + pts[i]) / 2;
      const my = (pts[i - 1] + pts[i + 1]) / 2;
      g.quadraticCurveTo(pts[i - 2], pts[i - 1], mx, my);
    }
    g.closePath();
    const gr = g.createRadialGradient(-r * 0.4, -r * 0.4, r * 0.1, 0, 0, r * 1.1);
    gr.addColorStop(0, pal[0]);
    gr.addColorStop(0.5, pal[1]);
    gr.addColorStop(1, pal[2]);
    g.fillStyle = gr;
    g.fill();
    g.strokeStyle = "rgba(0,0,0,0.6)";
    g.lineWidth = 0.9;
    g.stroke();
    g.save();
    g.clip();
    // craters: a dark bowl with a lit rim on the far side
    const craters = Math.round(r / 5);
    for (let i = 0; i < craters; i++) {
      const cx = (rnd() - 0.5) * r * 1.4;
      const cy = (rnd() - 0.5) * r * 1.4;
      const cr = 1.5 + rnd() * r * 0.22;
      g.beginPath();
      g.arc(cx, cy, cr, 0, Math.PI * 2);
      g.fillStyle = "rgba(0,0,0,0.28)";
      g.fill();
      g.beginPath();
      g.arc(cx + cr * 0.15, cy + cr * 0.15, cr, 0.2, Math.PI * 0.9);
      g.strokeStyle = "rgba(255,255,255,0.18)";
      g.lineWidth = 0.8;
      g.stroke();
    }
    // speckle
    for (let i = 0; i < r * 9; i++) {
      g.fillStyle = rnd() < 0.5 ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.12)";
      g.fillRect((rnd() - 0.5) * r * 2, (rnd() - 0.5) * r * 2, 1, 1);
    }
    if (kind === "rockIron") {
      // metallic streaks and rivet-like nodules
      for (let i = 0; i < 6; i++) {
        const y = (rnd() - 0.5) * r * 1.6;
        lines(g, [[-r, y, r, y + (rnd() - 0.5) * 10]], "rgba(220,230,255,0.22)", 1.2);
      }
    }
    if (kind === "rockSplit") {
      // fracture lines
      g.strokeStyle = "rgba(10,6,2,0.8)";
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(-r * 0.8, -r * 0.2);
      g.lineTo(-r * 0.2, 0);
      g.lineTo(0.1 * r, r * 0.7);
      g.moveTo(-r * 0.2, 0);
      g.lineTo(r * 0.6, -r * 0.5);
      g.stroke();
    }
    if (kind === "rockBoom") {
      // magma cracks
      g.strokeStyle = "rgba(255,140,40,0.95)";
      g.lineWidth = 1.6;
      g.beginPath();
      for (let i = 0; i < 4; i++) {
        let x = (rnd() - 0.5) * r;
        let y = (rnd() - 0.5) * r;
        g.moveTo(x, y);
        for (let k = 0; k < 3; k++) {
          x += (rnd() - 0.5) * r * 0.6;
          y += (rnd() - 0.5) * r * 0.6;
          g.lineTo(x, y);
        }
      }
      g.stroke();
      g.strokeStyle = "rgba(255,230,150,0.8)";
      g.lineWidth = 0.6;
      g.stroke();
    }
    g.restore();
  });
}

const enemyCache = new Map<string, Sprite>();
export const ROCK_VARIANTS = 3;
export function enemySprite(kind: EnemyKind, variant = 0): Sprite {
  const key = `${kind}:${variant}`;
  let s = enemyCache.get(key);
  if (!s) {
    s = enemyArt(kind, variant);
    enemyCache.set(key, s);
  }
  return s;
}

/* ---------- bosses ---------- */

const PURPLE: [string, string, string] = ["#f0d0ff", "#7a3ab0", "#1e0830"];

function bossArt(kind: number): Sprite {
  if (kind === 0)
    // Armored Cruiser: a long wedge hull, armour plates, exposed reactor in the middle
    return sprite(300, 190, (g) => {
      sym(g, () => {
        poly(g, [0, 90, 26, 70, 70, 40, 140, 14, 146, -10, 120, -40, 60, -70, 20, -88, 0, -90]);
        metal(g, 0, 146, GUN);
        grain(g, 201, 0, -90, 146, 180, 900);
        lines(g, [[20, -70, 110, -30], [30, -40, 140, -2], [24, -10, 140, 6], [22, 20, 100, 30], [18, 48, 60, 44]]);
        poly(g, [30, -60, 90, -38, 84, -18, 26, -36]);
        metal(g, 26, 90, RED, "rgba(0,0,0,0.85)", 0.8);
        poly(g, [96, -14, 138, -4, 132, 12, 92, 8]);
        metal(g, 92, 138, RED, "rgba(0,0,0,0.85)", 0.8);
        barrel(g, 130, 10, 34, 5);
        // engine block at the back (top of screen)
        g.beginPath();
        g.roundRect(14, -96, 22, 14, 3);
        metal(g, 14, 36, DARK);
      });
      g.beginPath();
      g.arc(0, 6, 22, 0, Math.PI * 2);
      metal(g, -22, 22, DARK);
      g.beginPath();
      g.arc(0, 6, 13, 0, Math.PI * 2);
      g.fillStyle = "#2a0602";
      g.fill();
    });
  if (kind === 1)
    // Alien Leviathan: armoured head and carapace (tentacles are animated at runtime)
    return sprite(260, 220, (g) => {
      sym(g, () => {
        g.beginPath();
        g.moveTo(0, -100);
        g.bezierCurveTo(70, -100, 120, -60, 118, -10);
        g.bezierCurveTo(116, 40, 70, 80, 0, 96);
        g.closePath();
        metal(g, 0, 118, ["#d6ffd0", "#3f7a3a", "#0b1f0a"]);
        grain(g, 301, 0, -100, 118, 196, 700, 0.18);
        // carapace segments
        for (let i = 0; i < 4; i++) {
          g.beginPath();
          g.moveTo(4, -80 + i * 32);
          g.quadraticCurveTo(70, -86 + i * 32, 104 - i * 8, -54 + i * 34);
          g.strokeStyle = "rgba(5,20,5,0.75)";
          g.lineWidth = 2;
          g.stroke();
        }
        // spines
        for (let i = 0; i < 4; i++) {
          poly(g, [96 - i * 10, -40 + i * 26, 126 - i * 10, -48 + i * 26, 100 - i * 10, -28 + i * 26]);
          metal(g, 96, 126, ["#fff2d0", "#9a7a4a", "#2a1a08"]);
        }
      });
      lines(g, [[0, -100, 0, -40]], "rgba(5,20,5,0.8)", 2);
      // mouth ridge
      g.beginPath();
      g.moveTo(-40, 70);
      g.quadraticCurveTo(0, 96, 40, 70);
      g.strokeStyle = "rgba(255,120,60,0.8)";
      g.lineWidth = 3;
      g.stroke();
    });
  if (kind === 2)
    // Dreadnought: huge, layered decks; turrets and missile bays are separate parts
    return sprite(380, 230, (g) => {
      sym(g, () => {
        poly(g, [0, 110, 40, 96, 110, 70, 182, 30, 188, -20, 160, -70, 90, -100, 30, -112, 0, -114]);
        metal(g, 0, 188, GUN);
        grain(g, 401, 0, -114, 188, 224, 1300);
        poly(g, [20, -90, 120, -60, 150, -20, 120, 20, 30, 10]);
        metal(g, 20, 150, DARK, "rgba(0,0,0,0.8)", 0.8);
        grain(g, 402, 20, -90, 130, 110, 300, 0.15);
        lines(g, [[30, -70, 140, -40], [34, -40, 150, -10], [40, 40, 170, 20], [30, 70, 120, 66]]);
        for (let i = 0; i < 5; i++) {
          g.fillStyle = "rgba(255,190,90,0.9)";
          g.fillRect(40 + i * 22, 50, 6, 2);
        }
        barrel(g, 172, 0, 36, 6);
      });
      g.beginPath();
      g.roundRect(-30, -40, 60, 60, 10);
      metal(g, -30, 30, RED);
      g.beginPath();
      g.arc(0, -10, 16, 0, Math.PI * 2);
      g.fillStyle = "#2a0602";
      g.fill();
    });
  // Cosmic Destroyer: crystal alien warship
  return sprite(340, 290, (g) => {
    sym(g, () => {
      poly(g, [0, 140, 40, 90, 120, 60, 168, 0, 140, -50, 160, -120, 90, -90, 40, -136, 0, -110]);
      metal(g, 0, 168, PURPLE);
      grain(g, 501, 0, -136, 168, 276, 900, 0.2);
      poly(g, [20, -90, 80, -60, 120, -10, 60, 40, 20, 20]);
      const gr = g.createLinearGradient(20, -90, 120, 40);
      gr.addColorStop(0, "rgba(255,230,140,0.9)");
      gr.addColorStop(1, "rgba(160,60,20,0.9)");
      g.fillStyle = gr;
      g.fill();
      g.strokeStyle = "rgba(40,10,5,0.9)";
      g.lineWidth = 1;
      g.stroke();
      lines(g, [[20, -90, 120, -10], [80, -60, 60, 40], [40, 90, 150, 10]], "rgba(255,210,255,0.35)", 0.9);
    });
  });
}

const bossCache = new Map<number, Sprite>();
export function bossSprite(kind: number) {
  let s = bossCache.get(kind);
  if (!s) {
    s = bossArt(kind);
    bossCache.set(kind, s);
  }
  return s;
}

/** a boss turret (aims at runtime) */
export const turretSprite = once(() =>
  sprite(36, 44, (g) => {
    g.beginPath();
    g.arc(0, -2, 13, 0, Math.PI * 2);
    metal(g, -13, 13, GUN);
    grain(g, 91, -13, -15, 26, 26, 50);
    barrel(g, -4, 2, 20, 4);
    barrel(g, 4, 2, 20, 4);
    g.beginPath();
    g.arc(0, -2, 5, 0, Math.PI * 2);
    g.fillStyle = "#151a20";
    g.fill();
  }),
);
export const bayArt = once(() =>
  sprite(44, 34, (g) => {
    g.beginPath();
    g.roundRect(-19, -13, 38, 26, 4);
    metal(g, -19, 19, DARK);
    for (let i = 0; i < 4; i++) {
      g.fillStyle = "#c9ced6";
      g.fillRect(-14 + i * 8, -4, 4, 12);
      g.fillStyle = "#e5483a";
      g.fillRect(-14 + i * 8, 7, 4, 3);
    }
  }),
);
export const crystalSprite = once(() =>
  sprite(40, 52, (g) => {
    poly(g, [0, -24, 14, -4, 0, 24, -14, -4]);
    const gr = g.createLinearGradient(-14, -24, 14, 24);
    gr.addColorStop(0, "#fff6ff");
    gr.addColorStop(0.4, "#d36bff");
    gr.addColorStop(1, "#3a0a52");
    g.fillStyle = gr;
    g.fill();
    g.strokeStyle = "rgba(30,0,40,0.9)";
    g.lineWidth = 1;
    g.stroke();
    lines(g, [[0, -24, 0, 24], [-14, -4, 14, -4]], "rgba(255,255,255,0.35)", 0.6);
  }),
);
export const eyeSprite = once(() =>
  sprite(60, 44, (g) => {
    g.beginPath();
    g.ellipse(0, 0, 26, 17, 0, 0, Math.PI * 2);
    const gr = g.createRadialGradient(-6, -6, 2, 0, 0, 26);
    gr.addColorStop(0, "#fffbe0");
    gr.addColorStop(0.5, "#ffb84a");
    gr.addColorStop(1, "#6a1a02");
    g.fillStyle = gr;
    g.fill();
    g.strokeStyle = "rgba(20,5,0,0.9)";
    g.lineWidth = 2;
    g.stroke();
    g.beginPath();
    g.ellipse(0, 0, 4, 14, 0, 0, Math.PI * 2);
    g.fillStyle = "#120400";
    g.fill();
  }, false),
);

/* ---------- pickups ---------- */

const pickupCache = new Map<PickupKind, Sprite>();
export function pickupSprite(kind: PickupKind) {
  let s = pickupCache.get(kind);
  if (s) return s;
  const p = PICKUPS[kind];
  s = sprite(34, 34, (g) => {
    // hexagonal capsule: metal frame, coloured glass core, glyph
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
      g.lineTo(Math.cos(a) * 14, Math.sin(a) * 14);
    }
    g.closePath();
    metal(g, -14, 14, STEEL);
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
      g.lineTo(Math.cos(a) * 10.5, Math.sin(a) * 10.5);
    }
    g.closePath();
    const gr = g.createRadialGradient(-3, -4, 1, 0, 0, 12);
    gr.addColorStop(0, "#ffffff");
    gr.addColorStop(0.35, p.color);
    gr.addColorStop(1, "#0a0f18");
    g.fillStyle = gr;
    g.fill();
    g.fillStyle = "rgba(10,12,20,0.85)";
    g.font = `900 ${p.glyph.length > 1 ? 8 : 11}px Inter, system-ui, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(p.glyph, 0, 1);
  });
  pickupCache.set(kind, s);
  return s;
}

/* ---------- effects and scenery ---------- */

/** soft white puff (smoke, tinted by alpha) */
export const smokeSprite = once(() => {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  blob(g, 32, 32, 32, "rgba(255,255,255,0.55)");
  return c;
});

/** a hot shard of debris */
export const shardSprite = once(() =>
  sprite(8, 8, (g) => {
    poly(g, [-3, -2, 3, -3, 2, 3, -2, 2]);
    metal(g, -3, 3, ["#d8dde4", "#6a7280", "#20252c"], "rgba(0,0,0,0.6)", 0.4);
  }),
);

/** crystals dropped as resources */
export const oreSprite = once(() =>
  sprite(14, 16, (g) => {
    poly(g, [0, -7, 5, -1, 2, 7, -3, 6, -5, -1]);
    const gr = g.createLinearGradient(-5, -7, 5, 7);
    gr.addColorStop(0, "#e8fffb");
    gr.addColorStop(0.45, "#3fe0c8");
    gr.addColorStop(1, "#06403a");
    g.fillStyle = gr;
    g.fill();
    g.strokeStyle = "rgba(0,30,25,0.8)";
    g.lineWidth = 0.5;
    g.stroke();
  }, false),
);

export type RegionArt = { sky: CanvasGradient | null; nebula: HTMLCanvasElement[]; planet: HTMLCanvasElement | null };

function nebulaArt(r: Region, seed: number) {
  const c = document.createElement("canvas");
  c.width = c.height = 320;
  const g = c.getContext("2d")!;
  const rnd = rng(seed);
  for (let i = 0; i < 26; i++) {
    const x = 60 + rnd() * 200;
    const y = 60 + rnd() * 200;
    const rr = 30 + rnd() * 90;
    blob(g, x, y, rr, (i % 2 ? r.nebula[0] : r.nebula[1]).replace(/[\d.]+\)$/, `${(0.08 + rnd() * 0.14).toFixed(2)})`));
  }
  // dark dust lanes through it
  g.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 8; i++) blob(g, 40 + rnd() * 240, 40 + rnd() * 240, 20 + rnd() * 40, "rgba(0,0,0,0.35)");
  return c;
}

function planetArt(r: Region) {
  const p = r.planet!;
  const c = document.createElement("canvas");
  c.width = c.height = 360;
  const g = c.getContext("2d")!;
  const R = 110;
  g.translate(180, 180);
  // atmosphere halo
  blob(g, 0, 0, R * 1.45, p.atmo.replace(/[\d.]+\)$/, "0.35)"));
  g.beginPath();
  g.arc(0, 0, R, 0, Math.PI * 2);
  const gr = g.createRadialGradient(-R * 0.45, -R * 0.45, R * 0.1, 0, 0, R);
  gr.addColorStop(0, p.a);
  gr.addColorStop(0.7, p.b);
  gr.addColorStop(1, "#000");
  g.fillStyle = gr;
  g.fill();
  // cloud bands
  g.save();
  g.clip();
  const rnd = rng(7);
  for (let i = 0; i < 14; i++) {
    const y = -R + rnd() * R * 2;
    g.fillStyle = `rgba(255,255,255,${0.03 + rnd() * 0.06})`;
    g.fillRect(-R, y, R * 2, 3 + rnd() * 10);
  }
  // night side
  const sh = g.createLinearGradient(-R, -R, R, R);
  sh.addColorStop(0.45, "rgba(0,0,0,0)");
  sh.addColorStop(1, "rgba(0,0,0,0.85)");
  g.fillStyle = sh;
  g.fillRect(-R, -R, R * 2, R * 2);
  g.restore();
  if (p.ring) {
    g.save();
    g.rotate(-0.35);
    g.scale(1, 0.26);
    g.lineWidth = 16;
    g.strokeStyle = "rgba(230,210,170,0.45)";
    g.beginPath();
    g.arc(0, 0, R * 1.55, 0.05 * Math.PI, 0.95 * Math.PI, true);
    g.stroke();
    g.lineWidth = 5;
    g.strokeStyle = "rgba(255,240,210,0.35)";
    g.beginPath();
    g.arc(0, 0, R * 1.72, 0.05 * Math.PI, 0.95 * Math.PI, true);
    g.stroke();
    g.restore();
  }
  return c;
}

let regionCache: RegionArt[] | null = null;
export function regionArt(): RegionArt[] {
  return (regionCache ??= REGIONS.map((r, i) => ({ sky: null, nebula: [nebulaArt(r, 11 + i * 7), nebulaArt(r, 29 + i * 5)], planet: r.planet ? planetArt(r) : null })));
}

export const vignette = once(() => {
  const c = document.createElement("canvas");
  c.width = 270;
  c.height = 450;
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(135, 225, 120, 135, 225, 300);
  gr.addColorStop(0, "rgba(0,0,0,0)");
  gr.addColorStop(1, "rgba(0,0,0,0.55)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 270, 450);
  return c;
});

/** build everything up front (behind the start screen), so nothing stutters mid-run */
export function warmArt() {
  shipSprites();
  droneSprite();
  for (const k of ["dart", "wing", "gunner", "tank", "kamikaze", "drone", "platform", "launcher", "mother", "flyer", "swift", "brute", "spitter", "mine", "mineProx", "mineMove", "mineCluster", "mineMini"] as EnemyKind[]) enemySprite(k);
  for (const k of ["rockS", "rockL", "rockIron", "rockBoom", "rockSplit"] as EnemyKind[]) for (let v = 0; v < ROCK_VARIANTS; v++) enemySprite(k, v);
  for (let b = 0; b < 4; b++) bossSprite(b);
  turretSprite();
  bayArt();
  crystalSprite();
  eyeSprite();
  for (const k of Object.keys(PICKUPS) as PickupKind[]) pickupSprite(k);
  smokeSprite();
  shardSprite();
  oreSprite();
  regionArt();
  vignette();
}
