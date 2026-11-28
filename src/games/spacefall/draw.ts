/* Spacefall renderer: draws a World each frame — parallax space, loot, enemies, the boss, all
   projectiles, the ship and its effects, particles and the canvas HUD. Sprites come from art.ts
   (pre-painted); glows are additive blits of a cached radial sprite (no shadowBlur). */
import { glowSprite } from "../fx";
import { bayArt, bossSprite, crystalSprite, droneSprite, enemySprite, eyeSprite, oreSprite, pickupSprite, regionArt, shardSprite, shipSprites, smokeSprite, turretSprite, vignette, type Sprite } from "./art";
import { H, PICKUPS, RARITY_RING, REGIONS, SHOT_LOOK, STAGES, TIERS, W } from "./config";
import type { World } from "./world";
import { shipFlame, shipImage, skyImage } from "./images";

type C = CanvasRenderingContext2D;
const TAU = Math.PI * 2;
const FONT = "Inter, system-ui, sans-serif";

function blit(g: C, s: Sprite, x: number, y: number, scale = 1) {
  g.drawImage(s.c, x - (s.w * scale) / 2, y - (s.h * scale) / 2, s.w * scale, s.h * scale);
}
function blitRot(g: C, s: Sprite, x: number, y: number, a: number, scale = 1) {
  if (!a) return blit(g, s, x, y, scale);
  g.save();
  g.translate(x, y);
  g.rotate(a);
  g.drawImage(s.c, (-s.w * scale) / 2, (-s.h * scale) / 2, s.w * scale, s.h * scale);
  g.restore();
}
function glow(g: C, x: number, y: number, r: number, color: string, alpha = 1) {
  g.globalAlpha = alpha;
  g.drawImage(glowSprite(color), x - r, y - r, r * 2, r * 2);
}

/* ---------- background: stars in three layers, dust, nebulas, a planet ---------- */

type Star = { x: number; y: number; s: number; b: number };
const layers: Star[][] = [0, 1, 2].map((l) =>
  Array.from({ length: [90, 50, 22][l] }, () => ({ x: Math.random() * W, y: Math.random() * H, s: [0.8, 1.3, 2][l], b: 0.35 + Math.random() * 0.65 })),
);
const SPEEDS = [0.06, 0.16, 0.34];
const skyCache = new Map<number, CanvasGradient>();

function background(g: C, w: World, lite: boolean) {
  const art = regionArt();
  const sky = (i: number) => {
    let gr = skyCache.get(i);
    if (!gr) {
      const R = REGIONS[i];
      gr = g.createLinearGradient(0, 0, 0, H);
      gr.addColorStop(0, R.sky[0]);
      gr.addColorStop(0.55, R.sky[1]);
      gr.addColorStop(1, R.sky[2]);
      skyCache.set(i, gr);
    }
    return gr;
  };
  g.fillStyle = sky(w.region);
  g.fillRect(0, 0, W, H);
  if (w.regionFade > 0) {
    g.globalAlpha = w.regionFade;
    g.fillStyle = sky(w.prevRegion);
    g.fillRect(0, 0, W, H);
    g.globalAlpha = 1;
  }
  let photo = false;
  const regionLayer = (i: number, alpha: number) => {
    // a real sky photo (NASA), drifting slowly; it loops as the picture and its mirror image
    const sky = skyImage(i);
    if (sky) {
      photo = true;
      const period = H * 2;
      const y = ((w.scroll * 0.045) % period) - period;
      g.globalAlpha = alpha;
      g.drawImage(sky, 0, y, W, period);
      g.drawImage(sky, 0, y + period, W, period);
      g.globalAlpha = 1;
      return;
    }
    const A = art[i];
    // planet: very slow, comes round every so often
    if (A.planet) {
      const period = H + 700;
      const y = ((w.scroll * 0.03 + 200) % period) - 350;
      g.globalAlpha = alpha * 0.95;
      g.drawImage(A.planet, i % 2 ? 40 : W - 300, y, 300, 300);
    }
    // nebulas
    if (!lite || i === w.region) {
      const period = H + 600;
      for (let k = 0; k < 2; k++) {
        const y = ((w.scroll * 0.05 + k * (period / 2)) % period) - 500;
        g.globalAlpha = alpha * 0.9;
        g.drawImage(A.nebula[k], k ? -80 : W - 420, y, 520, 520);
      }
    }
    g.globalAlpha = 1;
  };
  regionLayer(w.region, 1 - w.regionFade);
  if (w.regionFade > 0) regionLayer(w.prevRegion, w.regionFade);
  // stars
  for (let l = 0; l < 3; l++) {
    const off = w.scroll * SPEEDS[l];
    for (const s of layers[l]) {
      const y = (s.y + off) % H;
      g.globalAlpha = s.b * (l === 2 ? 0.9 : 0.75) * (photo ? (l === 0 ? 0 : 0.55) : 1);
      g.fillStyle = l === 2 ? "#ffffff" : l === 1 ? "#cfe0ff" : "#9fb4e0";
      g.fillRect(s.x, y, s.s, l === 2 ? s.s * 2.4 : s.s);
    }
  }
  // cosmic dust: faint fast streaks in the region's colour
  const dust = REGIONS[w.region].dust;
  g.globalAlpha = 0.2;
  g.fillStyle = dust;
  const off = w.scroll * 0.9;
  for (let i = 0; i < (lite ? 6 : 14); i++) {
    const x = (i * 97.3) % W;
    const y = (i * 211 + off) % (H + 60) - 30;
    g.fillRect(x, y, 1, 14);
  }
  g.globalAlpha = 1;
}

/* ---------- the frame ---------- */

export function drawWorld(g: C, w: World, lite: boolean, hud = true) {
  background(g, w, lite);
  g.save();
  if (w.shake > 0.3) g.translate((Math.random() - 0.5) * w.shake, (Math.random() - 0.5) * w.shake);

  drawLoot(g, w);
  drawEnemies(g, w);
  if (w.boss) drawBoss(g, w);
  drawEnemyFire(g, w);
  drawPlayerFire(g, w);
  if (!w.dead) drawShip(g, w);
  drawParticles(g, w);
  drawRingsAndFlashes(g, w);
  drawPopups(g, w);
  g.restore();

  // overlays (not shaken)
  g.drawImage(vignette(), 0, 0, W, H);
  if (w.hurt > 0) {
    // red at the edges, fading: no strobing
    g.globalAlpha = Math.min(0.55, w.hurt * 1.2);
    g.globalCompositeOperation = "lighter";
    const gr = g.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.65);
    gr.addColorStop(0, "rgba(255,0,0,0)");
    gr.addColorStop(1, "rgba(255,40,30,0.8)");
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
  }
  if (w.screenFlash > 0) {
    g.globalAlpha = Math.min(0.45, w.screenFlash);
    g.fillStyle = "#fff4e6";
    g.fillRect(0, 0, W, H);
    g.globalAlpha = 1;
  }
  if (hud) drawHud(g, w);
}

function drawLoot(g: C, w: World) {
  const ore = oreSprite();
  for (const o of w.ores) {
    if (!o.alive) continue;
    g.globalCompositeOperation = "lighter";
    glow(g, o.x, o.y, 12, "rgba(60,240,210,1)", 0.5);
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    blitRot(g, ore, o.x, o.y, o.t * 3);
  }
  for (const p of w.pickups) {
    if (!p.alive) continue;
    const P = PICKUPS[p.kind];
    const bob = Math.sin(p.t * 3) * 3;
    const ring = RARITY_RING[P.rarity];
    g.globalCompositeOperation = "lighter";
    glow(g, p.x, p.y + bob, 30 + Math.sin(p.t * 5) * 4, ring, P.rarity >= 2 ? 0.7 : 0.45);
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = p.t > 11 ? 0.5 + 0.5 * Math.sin(p.t * 10) : 1;
    blitRot(g, pickupSprite(p.kind), p.x, p.y + bob, Math.sin(p.t * 1.5) * 0.25);
    // rarity ring
    g.strokeStyle = ring;
    g.lineWidth = P.rarity >= 2 ? 2 : 1.2;
    g.globalAlpha *= 0.8;
    g.beginPath();
    g.arc(p.x, p.y + bob, 19 + (P.rarity >= 3 ? Math.sin(p.t * 6) * 2 : 0), 0, TAU);
    g.stroke();
    g.globalAlpha = 1;
  }
}

function drawEnemies(g: C, w: World) {
  for (const e of w.enemies) {
    if (!e.alive) continue;
    const spr = enemySprite(e.kind, e.def.family === "rock" ? e.variant : 0);
    const fam = e.def.family;
    let a = fam === "rock" || e.kind.startsWith("mine") ? e.a : 0;
    if (e.kind === "kamikaze") a = e.state === 2 ? Math.atan2(e.vy, e.vx) - Math.PI / 2 : e.t * 4;
    if (e.kind === "drone") a = Math.atan2(e.vy, e.vx) - Math.PI / 2;
    // ship engines (they fly down, so the glow is behind them, above)
    if (fam === "ship" && e.kind !== "platform" && e.kind !== "kamikaze") {
      g.globalCompositeOperation = "lighter";
      const flick = 0.75 + Math.random() * 0.25;
      const ey = e.kind === "drone" ? e.y - Math.sin(a + Math.PI / 2) * 9 : e.y - e.r * 0.95;
      glow(g, e.x, ey, e.r * 0.7 * flick, "rgba(255,120,60,1)", 0.75);
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = 1;
    }
    if (e.kind === "spitter" || e.kind === "flyer") {
      g.globalCompositeOperation = "lighter";
      glow(g, e.x, e.y, e.r * 1.3, e.kind === "spitter" ? "rgba(255,110,200,1)" : "rgba(170,110,255,1)", 0.35);
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = 1;
    }
    // a flyer flaps: squash the sprite sideways
    if (e.kind === "flyer") {
      g.save();
      g.translate(e.x, e.y);
      g.scale(0.75 + Math.abs(Math.sin(e.t * 8)) * 0.3, 1);
      blit(g, spr, 0, 0);
      g.restore();
    } else blitRot(g, spr, e.x, e.y, a);
    // hit flash: the sprite again, added on top
    if (e.hit > 0) {
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = 0.55;
      blitRot(g, spr, e.x, e.y, a);
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = 1;
    }
    // warning lights
    if (e.kind === "kamikaze" && e.state === 1) {
      g.globalCompositeOperation = "lighter";
      glow(g, e.x, e.y, 26, "rgba(255,40,30,1)", 0.5 + 0.5 * Math.sin(e.t * 30));
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = 1;
    }
    if (e.kind.startsWith("mine")) {
      const armed = e.state === 1;
      g.globalCompositeOperation = "lighter";
      const col = e.kind === "mineProx" ? "rgba(255,210,60,1)" : e.kind === "mineMove" ? "rgba(80,190,255,1)" : "rgba(255,60,40,1)";
      glow(g, e.x, e.y, armed ? 34 : 12, armed ? "rgba(255,50,30,1)" : col, armed ? 0.5 + 0.5 * Math.sin(e.t * 26) : 0.4 + 0.3 * Math.sin(e.t * 4));
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = 1;
      if (e.kind === "mineProx" && !armed) {
        g.strokeStyle = "rgba(255,210,60,0.18)";
        g.lineWidth = 1;
        g.beginPath();
        g.arc(e.x, e.y, 105, 0, TAU);
        g.stroke();
      }
    }
    if (e.kind === "rockBoom") {
      g.globalCompositeOperation = "lighter";
      glow(g, e.x, e.y, e.r * 1.2, "rgba(255,120,30,1)", 0.25 + 0.1 * Math.sin(e.t * 5));
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = 1;
    }
    // health bar on big ones once they've been hit
    if (e.def.size >= 2 && e.hp < e.max) {
      const bw = e.r * 1.6;
      g.fillStyle = "rgba(0,0,0,0.55)";
      g.fillRect(e.x - bw / 2, e.y - e.r - 10, bw, 4);
      g.fillStyle = e.def.size === 3 ? "#ff5a4a" : "#ffb347";
      g.fillRect(e.x - bw / 2, e.y - e.r - 10, bw * Math.max(0, e.hp / e.max), 4);
    }
  }
}

function drawBoss(g: C, w: World) {
  const B = w.boss!;
  const spr = bossSprite(B.kind);
  // engine glow behind it
  g.globalCompositeOperation = "lighter";
  const engineCol = B.kind === 1 ? "rgba(120,255,120,1)" : B.kind === 3 ? "rgba(220,120,255,1)" : "rgba(255,120,60,1)";
  for (const x of [-0.25, 0.25]) glow(g, B.x + B.rx * x, B.y - B.ry * 0.95, 40 + Math.random() * 8, engineCol, 0.7);
  g.globalCompositeOperation = "source-over";
  g.globalAlpha = 1;
  // the Leviathan's tentacles
  if (B.kind === 1) {
    for (let k = 0; k < 6; k++) {
      const side = k < 3 ? -1 : 1;
      const i = k % 3;
      let x = B.x + side * (60 + i * 22);
      let y = B.y + 50 + i * 8;
      let a = Math.PI / 2 + side * (0.3 + i * 0.15);
      for (let s = 0; s < 9; s++) {
        a += Math.sin(B.t * 2.2 + k + s * 0.6) * 0.16;
        const nx = x + Math.cos(a) * 14;
        const ny = y + Math.sin(a) * 14;
        g.strokeStyle = s % 2 ? "#2f6a2a" : "#3f8a36";
        g.lineWidth = 14 - s * 1.3;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(nx, ny);
        g.stroke();
        x = nx;
        y = ny;
      }
      g.globalCompositeOperation = "lighter";
      glow(g, x, y, 8, "rgba(160,255,120,1)", 0.6);
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = 1;
    }
  }
  blit(g, spr, B.x, B.y);
  // core / weak point: pulses brighter as the boss weakens
  const cx = B.x + B.core.ox;
  const cy = B.y + B.core.oy;
  const pulse = 0.6 + 0.4 * Math.sin(B.t * (3 + B.phase * 2));
  g.globalCompositeOperation = "lighter";
  const coreCol = B.kind === 1 ? "rgba(255,190,80,1)" : B.kind === 3 ? "rgba(230,120,255,1)" : "rgba(255,70,40,1)";
  glow(g, cx, cy, B.core.r * 2.2, coreCol, 0.55 * pulse + 0.2);
  g.globalCompositeOperation = "source-over";
  g.globalAlpha = 1;
  if (B.kind === 1) blit(g, eyeSprite(), cx, cy, 0.9 + 0.05 * Math.sin(B.t * 3));
  if (B.kind === 3) blitRot(g, crystalSprite(), cx, cy, Math.sin(B.t) * 0.15, 1.2);
  for (const p of B.parts) {
    const x = B.x + p.ox;
    const y = B.y + p.oy;
    if (!p.alive) {
      // a burnt-out socket
      g.fillStyle = "rgba(15,10,8,0.85)";
      g.beginPath();
      g.arc(x, y, p.r * 0.8, 0, TAU);
      g.fill();
      if (Math.random() < 0.08) w.sparks(x, y, 1, "rgba(255,150,60,1)", 60);
      continue;
    }
    if (p.kind === "turret") blitRot(g, turretSprite(), x, y, p.a - Math.PI / 2, 0.85);
    else if (p.kind === "bay") blit(g, bayArt(), x, y, 0.9);
    else {
      blitRot(g, crystalSprite(), x, y, Math.sin(B.t * 2 + p.ox) * 0.2, 0.75);
      g.globalCompositeOperation = "lighter";
      glow(g, x, y, 22, "rgba(220,120,255,1)", 0.4);
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = 1;
    }
    if (p.hit > 0) {
      g.globalCompositeOperation = "lighter";
      glow(g, x, y, p.r * 1.6, "rgba(255,255,255,1)", 0.45);
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = 1;
    }
    // part health ring
    if (p.hp < p.max) {
      g.strokeStyle = "rgba(255,200,90,0.85)";
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x, y, p.r + 5, -Math.PI / 2, -Math.PI / 2 + TAU * (p.hp / p.max));
      g.stroke();
    }
  }
  if (B.hit > 0) {
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = 0.22;
    blit(g, spr, B.x, B.y);
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
  }
  // telegraphs and lasers
  for (const L of B.lasers) {
    if (!L.alive) continue;
    const firing = L.t > L.warn && L.fire > 0;
    if (!firing) {
      // the warning: a translucent band with bright edges that blinks faster as it nears
      const k = L.t / L.warn;
      g.globalAlpha = 0.12 + 0.12 * Math.abs(Math.sin(L.t * (6 + k * 14)));
      g.fillStyle = "#ff3b30";
      if (L.vertical) g.fillRect(L.pos - L.width / 2, 0, L.width, H);
      else g.fillRect(0, L.pos - L.width / 2, W, L.width);
      g.globalAlpha = 0.7;
      g.strokeStyle = "#ff6a5a";
      g.lineWidth = 1.5;
      g.setLineDash([10, 8]);
      g.beginPath();
      if (L.vertical) {
        g.moveTo(L.pos - L.width / 2, 0);
        g.lineTo(L.pos - L.width / 2, H);
        g.moveTo(L.pos + L.width / 2, 0);
        g.lineTo(L.pos + L.width / 2, H);
      } else {
        g.moveTo(0, L.pos - L.width / 2);
        g.lineTo(W, L.pos - L.width / 2);
        g.moveTo(0, L.pos + L.width / 2);
        g.lineTo(W, L.pos + L.width / 2);
      }
      g.stroke();
      g.setLineDash([]);
      g.globalAlpha = 1;
    } else {
      const k = (L.t - L.warn) / L.fire;
      const wd = L.width * (0.6 + 0.4 * Math.sin(Math.PI * Math.min(1, k * 1.2)));
      g.globalCompositeOperation = "lighter";
      const gr = L.vertical ? g.createLinearGradient(L.pos - wd, 0, L.pos + wd, 0) : g.createLinearGradient(0, L.pos - wd, 0, L.pos + wd);
      gr.addColorStop(0, "rgba(255,40,30,0)");
      gr.addColorStop(0.35, "rgba(255,80,60,0.8)");
      gr.addColorStop(0.5, "rgba(255,245,235,1)");
      gr.addColorStop(0.65, "rgba(255,80,60,0.8)");
      gr.addColorStop(1, "rgba(255,40,30,0)");
      g.fillStyle = gr;
      if (L.vertical) g.fillRect(L.pos - wd, 0, wd * 2, H);
      else g.fillRect(0, L.pos - wd, W, wd * 2);
      g.globalCompositeOperation = "source-over";
    }
  }
}

const BULLET_COL = ["rgba(255,80,60,1)", "rgba(255,150,60,1)", "rgba(110,255,120,1)", "rgba(255,140,60,1)", "rgba(255,70,140,1)", "rgba(170,255,90,1)"];
const BULLET_CORE = ["#ffe1d8", "#fff0c8", "#eaffe6", "#ffffff", "#ffe0f0", "#f3ffd8"];

function drawEnemyFire(g: C, w: World) {
  g.globalCompositeOperation = "lighter";
  for (const b of w.bullets) {
    if (!b.alive) continue;
    glow(g, b.x, b.y, b.r * 3, BULLET_COL[b.kind], 0.85);
  }
  g.globalCompositeOperation = "source-over";
  g.globalAlpha = 1;
  for (const b of w.bullets) {
    if (!b.alive) continue;
    if (b.kind === 1) {
      // needle: a short streak along its path
      const sp = Math.hypot(b.vx, b.vy) || 1;
      g.strokeStyle = BULLET_CORE[1];
      g.lineWidth = 2.6;
      g.beginPath();
      g.moveTo(b.x - (b.vx / sp) * 9, b.y - (b.vy / sp) * 9);
      g.lineTo(b.x + (b.vx / sp) * 3, b.y + (b.vy / sp) * 3);
      g.stroke();
    } else if (b.kind === 3) {
      // enemy missile: a little body pointing where it flies
      g.save();
      g.translate(b.x, b.y);
      g.rotate(Math.atan2(b.vy, b.vx));
      g.fillStyle = "#c9ced6";
      g.fillRect(-7, -2.2, 12, 4.4);
      g.fillStyle = "#e5483a";
      g.fillRect(4, -2.2, 3, 4.4);
      g.restore();
    } else {
      g.fillStyle = BULLET_CORE[b.kind];
      g.beginPath();
      g.arc(b.x, b.y, b.r * 0.6, 0, TAU);
      g.fill();
    }
  }
}

function drawPlayerFire(g: C, w: World) {
  g.globalCompositeOperation = "lighter";
  for (const s of w.shots) {
    if (!s.alive) continue;
    const L = SHOT_LOOK[s.kind];
    glow(g, s.x, s.y, L.w * 3.2, L.glow, 0.7);
  }
  g.globalAlpha = 1;
  g.lineCap = "round";
  for (const s of w.shots) {
    if (!s.alive) continue;
    const L = SHOT_LOOK[s.kind];
    const sp = Math.hypot(s.vx, s.vy) || 1;
    const ux = s.vx / sp;
    const uy = s.vy / sp;
    if (s.kind === 5) {
      g.fillStyle = L.core;
      g.beginPath();
      g.arc(s.x, s.y, L.w * 0.6, 0, TAU);
      g.fill();
      continue;
    }
    g.strokeStyle = L.glow;
    g.lineWidth = L.w;
    g.beginPath();
    g.moveTo(s.x - ux * L.len, s.y - uy * L.len);
    g.lineTo(s.x, s.y);
    g.stroke();
    g.strokeStyle = L.core;
    g.lineWidth = L.w * 0.45;
    g.stroke();
  }
  // missiles
  for (const m of w.pmissiles) {
    if (!m.alive) continue;
    const a = Math.atan2(m.vy, m.vx);
    glow(g, m.x - Math.cos(a) * 7, m.y - Math.sin(a) * 7, m.mini ? 9 : 13, "rgba(255,170,80,1)", 0.9);
  }
  g.globalCompositeOperation = "source-over";
  g.globalAlpha = 1;
  for (const m of w.pmissiles) {
    if (!m.alive) continue;
    g.save();
    g.translate(m.x, m.y);
    g.rotate(Math.atan2(m.vy, m.vx));
    const l = m.mini ? 8 : 11;
    g.fillStyle = "#dfe4ea";
    g.fillRect(-l / 2, -1.8, l, 3.6);
    g.fillStyle = "#e5483a";
    g.fillRect(l / 2 - 2.5, -1.8, 2.5, 3.6);
    g.fillStyle = "#555c66";
    g.fillRect(-l / 2, -3, 2.5, 6);
    g.restore();
  }
  for (const b of w.bombsOut) {
    if (!b.alive) continue;
    g.fillStyle = "#2b3038";
    g.beginPath();
    g.arc(b.x, b.y, 7, 0, TAU);
    g.fill();
    g.strokeStyle = "#8a929c";
    g.lineWidth = 1.2;
    g.stroke();
    g.globalCompositeOperation = "lighter";
    glow(g, b.x, b.y, 16, "rgba(255,70,50,1)", Math.sin(b.t * 30) > 0 ? 0.9 : 0.3);
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
  }
}

function drawShip(g: C, w: World) {
  const S = STAGES[w.stage];
  const spr = shipSprites()[w.stage];
  const sc = 1; // nozzle and muzzle positions are in world units already
  // laser beam (under the ship)
  if (w.beam > 0) {
    const wd = w.beamWidth * (0.85 + 0.15 * Math.sin(w.t * 40));
    const top = 0;
    const y0 = w.py - S.size * 0.45;
    g.globalCompositeOperation = "lighter";
    const gr = g.createLinearGradient(w.px - wd, 0, w.px + wd, 0);
    gr.addColorStop(0, "rgba(180,90,255,0)");
    gr.addColorStop(0.3, "rgba(190,110,255,0.75)");
    gr.addColorStop(0.5, "rgba(255,250,255,1)");
    gr.addColorStop(0.7, "rgba(190,110,255,0.75)");
    gr.addColorStop(1, "rgba(180,90,255,0)");
    g.fillStyle = gr;
    g.fillRect(w.px - wd, top, wd * 2, y0 - top);
    glow(g, w.px, y0, wd * 1.4, "rgba(230,170,255,1)", 0.9);
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
  }
  // engines
  g.globalCompositeOperation = "lighter";
  const flick = 0.85 + Math.random() * 0.3;
  const boost = Math.max(0, -w.vy / 400);
  const picE = shipImage(w.stage);
  const tail = picE ? S.size * 0.56 : 0;
  w.tail = tail; // the exhaust particles start here too
  w.flame = shipFlame();
  for (const [nx, ny, nw] of S.nozzles) {
    const x = w.px + nx * sc;
    const y = picE ? w.py + tail - 2 : w.py + ny * sc + 3;
    glow(g, x, y + 6 + boost * 6, nw * sc * (1.6 + boost) * flick, shipFlame() ?? S.flame, 0.9);
    glow(g, x, y + 2, nw * sc * 0.8, "rgba(255,255,255,1)", 0.8);
  }
  // muzzle flashes
  if (w.muzzle > 0) for (const [mx, my] of S.muzzles) glow(g, w.px + mx * sc, w.py + my * sc, 9, SHOT_LOOK[TIERS[w.tier].streams[0].kind].glow, 0.9);
  g.globalCompositeOperation = "source-over";
  g.globalAlpha = 1;
  // drones
  const nd = w.drones;
  for (let i = 0; i < nd; i++) {
    const d = w.dronePos(i);
    g.globalCompositeOperation = "lighter";
    glow(g, d.x, d.y + 8, 8, "rgba(110,240,255,1)", 0.7);
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    blit(g, droneSprite(), d.x, d.y);
  }
  // the ship: banks into turns (a slight roll and a narrower silhouette)
  const pic = shipImage(w.stage);
  const sh = pic ? S.size * 1.12 : spr.h;
  const sw = pic ? (sh * pic.naturalWidth) / pic.naturalHeight : spr.w;
  const src: CanvasImageSource = pic ?? spr.c;
  g.save();
  g.translate(w.px, w.py);
  g.rotate(w.bank * 0.16);
  g.scale(1 - Math.abs(w.bank) * 0.14, 1);
  if (w.invuln > 0.2 && w.shield <= 0) g.globalAlpha = 0.6;
  g.drawImage(src, -sw / 2, -sh / 2, sw, sh);
  g.globalAlpha = 1;
  if (w.evolveFx > 0) {
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = Math.min(1, w.evolveFx);
    g.drawImage(src, -sw / 2, -sh / 2, sw, sh);
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
  }
  g.restore();
  // shield bubble: a faint rim that brightens with an energy ripple when hit
  const R = S.size * 0.62;
  if (w.shield > 0.5 || w.shieldHit > 0) {
    const f = w.shield / w.maxShield;
    const hit = w.shieldHit / 0.35;
    g.globalCompositeOperation = "lighter";
    g.strokeStyle = `rgba(110,220,255,${(0.12 + f * 0.18 + hit * 0.5).toFixed(3)})`;
    g.lineWidth = 1.6 + hit * 2;
    g.beginPath();
    g.ellipse(w.px, w.py + 2, R, R * 1.05, 0, 0, TAU);
    g.stroke();
    if (hit > 0) glow(g, w.px, w.py, R * 1.3, "rgba(110,220,255,1)", hit * 0.35);
    // a slow shimmer arc around the rim
    g.strokeStyle = `rgba(200,245,255,${(0.15 + f * 0.25).toFixed(3)})`;
    g.lineWidth = 2;
    g.beginPath();
    g.ellipse(w.px, w.py + 2, R, R * 1.05, 0, w.t * 1.5, w.t * 1.5 + 0.8);
    g.stroke();
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
  }
  if (w.invincible > 0) {
    g.globalCompositeOperation = "lighter";
    glow(g, w.px, w.py, R * 1.5, "rgba(255,210,80,1)", 0.35 + 0.1 * Math.sin(w.t * 6));
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
  }
}

function drawParticles(g: C, w: World) {
  const smoke = smokeSprite();
  // smoke first (normal blend), then the bright stuff
  for (const p of w.parts) {
    if (p.life <= 0 || p.kind !== 2) continue;
    const t = p.life / p.max;
    g.globalAlpha = t * 0.45;
    g.drawImage(smoke, p.x - p.size, p.y - p.size, p.size * 2, p.size * 2);
  }
  g.globalAlpha = 1;
  const shard = shardSprite();
  for (const p of w.parts) {
    if (p.life <= 0 || p.kind !== 3) continue;
    g.globalAlpha = Math.min(1, (p.life / p.max) * 1.5);
    blitRot(g, shard, p.x, p.y, p.rot, p.size);
  }
  g.globalCompositeOperation = "lighter";
  for (const p of w.parts) {
    if (p.life <= 0 || p.kind === 2 || p.kind === 3) continue;
    const t = p.life / p.max;
    g.globalAlpha = t;
    g.fillStyle = p.color;
    if (p.kind === 0) {
      // spark: a streak along its velocity
      g.strokeStyle = p.color;
      g.lineWidth = p.size;
      g.beginPath();
      g.moveTo(p.x, p.y);
      g.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
      g.stroke();
    } else {
      const s = p.size;
      g.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    }
  }
  g.globalCompositeOperation = "source-over";
  g.globalAlpha = 1;
}

function drawRingsAndFlashes(g: C, w: World) {
  g.globalCompositeOperation = "lighter";
  for (const f of w.flashes) {
    if (!f.alive) continue;
    const t = f.t / f.dur;
    glow(g, f.x, f.y, f.r * (0.6 + t * 0.5), f.color, (1 - t) * 0.95);
  }
  for (const r of w.rings) {
    if (!r.alive) continue;
    const t = r.t / r.dur;
    const e = 1 - (1 - t) * (1 - t);
    g.globalAlpha = 1 - t;
    g.strokeStyle = r.color;
    g.lineWidth = r.w * (1 - t * 0.6);
    g.beginPath();
    g.arc(r.x, r.y, r.r0 + (r.r1 - r.r0) * e, 0, TAU);
    g.stroke();
  }
  g.globalCompositeOperation = "source-over";
  g.globalAlpha = 1;
}

function drawPopups(g: C, w: World) {
  g.textAlign = "center";
  g.lineJoin = "round";
  for (const p of w.popups) {
    if (!p.alive) continue;
    const t = p.t / 0.9;
    g.globalAlpha = 1 - t * t;
    g.font = `800 ${p.size}px ${FONT}`;
    g.lineWidth = 3;
    g.strokeStyle = "rgba(0,0,0,0.6)";
    g.strokeText(p.text, p.x, p.y - t * 30);
    g.fillStyle = p.color;
    g.fillText(p.text, p.x, p.y - t * 30);
  }
  g.globalAlpha = 1;
}

/* ---------- HUD ---------- */

function bar(g: C, x: number, y: number, w: number, h: number, frac: number, col: string, back = "rgba(255,255,255,0.12)") {
  g.fillStyle = back;
  g.fillRect(x, y, w, h);
  g.fillStyle = col;
  g.fillRect(x, y, w * Math.max(0, Math.min(1, frac)), h);
}

function drawHud(g: C, w: World) {
  const S = STAGES[w.stage];
  // top strip
  const grad = g.createLinearGradient(0, 0, 0, 86);
  grad.addColorStop(0, "rgba(2,4,10,0.8)");
  grad.addColorStop(1, "rgba(2,4,10,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, W, 86);
  // level badge
  g.fillStyle = "rgba(127,227,255,0.16)";
  g.beginPath();
  g.roundRect(12, 12, 64, 32, 9);
  g.fill();
  g.strokeStyle = "rgba(127,227,255,0.6)";
  g.lineWidth = 1;
  g.stroke();
  g.textAlign = "center";
  g.fillStyle = "#e6f8ff";
  g.font = `900 16px ${FONT}`;
  g.fillText(`LV ${w.level}`, 44, 34);
  // xp bar
  bar(g, 86, 30, 150, 8, w.xp / w.next, "#7fe3ff");
  g.textAlign = "left";
  g.font = `800 12px ${FONT}`;
  g.fillStyle = "rgba(230,240,255,0.75)";
  g.fillText(S.name.toUpperCase(), 86, 23);
  // distance and score
  g.textAlign = "right";
  g.font = `900 20px ${FONT}`;
  g.fillStyle = "#ffffff";
  g.fillText(`${Math.floor(w.score).toLocaleString()}`, W - 16, 30);
  g.font = `700 13px ${FONT}`;
  g.fillStyle = "rgba(230,240,255,0.75)";
  g.fillText(`${Math.floor(w.distance / 10).toLocaleString()} km · ${w.kills} down · ${w.resources} ◆`, W - 16, 48);
  // boss bar
  if (w.boss) {
    const B = w.boss;
    const y = 70;
    g.textAlign = "center";
    g.font = `800 13px ${FONT}`;
    g.fillStyle = "#ffb3a6";
    g.fillText(B.name.toUpperCase(), W / 2, y);
    bar(g, 40, y + 6, W - 80, 9, B.hp / B.max, B.phase === 2 ? "#ff3b30" : B.phase === 1 ? "#ff7a3a" : "#ffb347", "rgba(255,255,255,0.12)");
    // phase marks
    g.fillStyle = "rgba(0,0,0,0.6)";
    g.fillRect(40 + (W - 80) * 0.33, y + 6, 2, 9);
    g.fillRect(40 + (W - 80) * 0.66, y + 6, 2, 9);
  }
  // bottom-left status
  const by = H - 62;
  g.fillStyle = "rgba(2,4,10,0.5)";
  g.beginPath();
  g.roundRect(10, by - 12, 206, 62, 12);
  g.fill();
  g.textAlign = "left";
  g.font = `800 11px ${FONT}`;
  g.fillStyle = "rgba(230,240,255,0.8)";
  g.fillText("HULL", 20, by + 4);
  g.fillText("SHIELD", 20, by + 22);
  bar(g, 74, by - 5, 130, 10, w.hp / w.maxHp, w.hp / w.maxHp < 0.3 ? "#ff4a3a" : "#5cff8a");
  bar(g, 74, by + 15, 130, 7, w.shield / w.maxShield, "#59d8ff");
  g.font = `700 11px ${FONT}`;
  g.fillStyle = w.weaponBoost > 0 ? "#ffe14a" : "rgba(230,240,255,0.7)";
  g.fillText(`${TIERS[w.tier].name}${w.weaponBoost > 0 ? " ▲" : ""}`, 20, by + 41);
  // active boosts
  const boosts: [string, number, number, string][] = [];
  if (w.rapid > 0) boosts.push(["RAPID", w.rapid, 10, "#ff7ad9"]);
  if (w.dmgBoost > 0) boosts.push(["×2 DMG", w.dmgBoost, 10, "#ff8a3d"]);
  if (w.invincible > 0) boosts.push(["INVINCIBLE", w.invincible, 6, "#ffd84a"]);
  if (w.weaponBoost > 0) boosts.push(["WEAPON+", w.weaponBoost, 15, "#ffe14a"]);
  boosts.forEach(([label, t, max, col], i) => {
    const y = by - 28 - i * 17;
    g.font = `800 11px ${FONT}`;
    g.fillStyle = col;
    g.fillText(label, 20, y + 4);
    bar(g, 104, y - 3, 70, 5, t / max, col);
  });
  // banners
  let stack = 0;
  for (const b of w.banners) {
    const k = b.t / b.life;
    const pin = Math.min(1, b.t / 0.15);
    const out = k > 0.8 ? (1 - k) / 0.2 : 1;
    g.globalAlpha = pin * out;
    // newer banners sit below older ones instead of on top of them
    const y = H * 0.3 + stack;
    stack += b.big ? 58 : 50;
    g.textAlign = "center";
    g.lineJoin = "round";
    g.font = `900 ${b.big ? 26 : 20}px ${FONT}`;
    g.lineWidth = 5;
    g.strokeStyle = "rgba(0,0,0,0.65)";
    g.strokeText(b.text, W / 2, y);
    g.fillStyle = b.color;
    g.fillText(b.text, W / 2, y);
    if (b.sub) {
      g.font = `700 12px ${FONT}`;
      g.lineWidth = 3;
      g.strokeText(b.sub, W / 2, y + 22);
      g.fillStyle = "rgba(240,246,255,0.95)";
      g.fillText(b.sub, W / 2, y + 22);
    }
  }
  g.globalAlpha = 1;
}

/** the ship alone (start screen / results), centred in a canvas */
export function drawShipPreview(g: C, stage: number, w: number, h: number, t: number) {
  const S = STAGES[stage];
  const spr = shipSprites()[stage];
  g.clearRect(0, 0, w, h);
  const sc = Math.min(w, h) / (S.size + 30);
  g.save();
  g.translate(w / 2, h / 2 - 4);
  g.scale(sc, sc);
  g.globalCompositeOperation = "lighter";
  const tailY = shipImage(stage) ? S.size * 0.56 : 0;
  for (const [nx, ny, nw] of S.nozzles) glow(g, nx, (tailY || ny + 9) + 2, nw * (1.8 + 0.2 * Math.sin(t * 20)), shipFlame() ?? S.flame, 0.9);
  g.globalCompositeOperation = "source-over";
  g.globalAlpha = 1;
  const pic = shipImage(stage);
  if (pic) {
    const h = S.size * 1.12;
    const wd = (h * pic.naturalWidth) / pic.naturalHeight;
    g.drawImage(pic, -wd / 2, -h / 2, wd, h);
  } else g.drawImage(spr.c, -spr.w / 2, -spr.h / 2, spr.w, spr.h);
  g.restore();
}
