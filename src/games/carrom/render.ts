/* Carrom rendering — canvas drawing only, no game rules.

   Realism without the cost:
   - the board (wood frame, maple playfield, markings, pockets) is painted ONCE into an offscreen
     canvas and blitted every frame
   - every disc is a pre-rendered sprite (see skins.ts) drawn rotated by its spin angle, with an
     un-rotated lighting layer on top, so the engraving turns but the light stays put
   - soft shadows use one cached blurred sprite instead of canvas shadowBlur
   - impacts spawn powder puffs from a fixed pool; strong hits add a small camera shake */
import {
  BASE_MAX,
  BASE_MIN,
  BASE_OFF,
  PF_MAX,
  PF_MIN,
  POCKETS,
  POCKET_R,
  SINK_T,
  SIZE,
  STRIKER_R,
  WALL,
  baselineFor,
  type Disc,
  type FxEvent,
  type Vec,
  type World,
} from "./engine";
import { BOARDS, coinSprite, lightingSprite, strikerSprite, type BoardTheme, type CoinSet, type StrikerSkin } from "./skins";
import { AIM_FULL_PREVIEW, AIM_TARGET_LINE, aimReachFor } from "./stats";
import { carromAudio } from "./audio";
import { hexRgb, woodCanvas } from "./texture";

/** Current screen rotation (set by the game each frame) so text can stay upright. */
let viewAngle = 0;
export function setViewAngle(a: number) {
  viewAngle = a;
}

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ======================= view ======================= */

/** Visible frame thickness (world units). The physics wall is WALL wide; we crop the view so
 *  only this thin strip of frame shows — a slim modern board without touching the physics. */
export const FRAME_T = 17;
export const VIEW_MIN = WALL - FRAME_T;
export const VIEW = SIZE - VIEW_MIN * 2;

/** Map the canvas (px × px) onto the visible board area, in world units. */
export function setBoardView(ctx: CanvasRenderingContext2D, px: number) {
  const s = px / VIEW;
  ctx.setTransform(s, 0, 0, s, -VIEW_MIN * s, -VIEW_MIN * s);
}

/** A point given as a fraction (0..1) of the canvas → world coordinates. */
export const fractionToBoard = (fx: number, fy: number): Vec => ({ x: VIEW_MIN + fx * VIEW, y: VIEW_MIN + fy * VIEW });

/* ======================= board (painted once) ======================= */

let boardCache: { px: number; theme: string; canvas: HTMLCanvasElement } | null = null;
/** Wood textures depend only on the theme, not the screen size: generated once per theme. */
const woodCache = new Map<string, { field: HTMLCanvasElement; frame: HTMLCanvasElement }>();

function woodFor(th: BoardTheme) {
  let w = woodCache.get(th.id);
  if (!w) {
    const seed = [...th.id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7);
    w = {
      field: woodCanvas(720, 720, { light: th.field, dark: th.fieldGrain, seed, rings: 13, contrast: th.glow ? 0.6 : 0.9 }),
      frame: woodCanvas(720, 40, { light: [th.frame, th.frame], dark: th.frameGrain, seed: seed + 3, rings: 3, contrast: 1 }),
    };
    woodCache.set(th.id, w);
  }
  return w;
}

/** Small arrowhead at (x,y) pointing along angle a. */
function arrowHead(g: CanvasRenderingContext2D, x: number, y: number, a: number, len: number, spread = 0.42) {
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x - Math.cos(a - spread) * len, y - Math.sin(a - spread) * len);
  g.lineTo(x - Math.cos(a + spread) * len, y - Math.sin(a + spread) * len);
  g.closePath();
  g.fill();
}

function paintBoard(px: number, th: BoardTheme) {
  const c = document.createElement("canvas");
  c.width = c.height = px;
  const g = c.getContext("2d")!;
  setBoardView(g, px);
  const wood = woodFor(th);
  const LO = VIEW_MIN;
  const HI = SIZE - VIEW_MIN;
  const W = PF_MAX - PF_MIN;

  // --- frame: four thin mitred rails, grain running along each ---
  for (let i = 0; i < 4; i++) {
    g.save();
    g.translate(500, 500);
    g.rotate((i * Math.PI) / 2);
    g.translate(-500, -500);
    g.beginPath();
    g.moveTo(LO, LO);
    g.lineTo(HI, LO);
    g.lineTo(PF_MAX, PF_MIN);
    g.lineTo(PF_MIN, PF_MIN);
    g.closePath();
    g.clip();
    g.drawImage(wood.frame, 0, i * 6, 720, 20, LO, LO, VIEW, FRAME_T);
    // rounded outer edge catches a little light; inner edge falls into shade (matte, no sheen).
    // rails rotate with i: 0 = top, 1 = right, 2 = bottom, 3 = left
    const edge = g.createLinearGradient(0, LO, 0, PF_MIN);
    const lit = i === 0 || i === 3 ? 0.13 : 0.04;
    edge.addColorStop(0, `rgba(255,240,220,${lit})`);
    edge.addColorStop(0.35, "rgba(255,240,220,0)");
    edge.addColorStop(1, "rgba(0,0,0,0.35)");
    g.fillStyle = edge;
    g.fillRect(LO, LO, VIEW, FRAME_T);
    g.restore();
  }
  g.strokeStyle = "rgba(0,0,0,0.5)";
  g.lineWidth = 0.8;
  for (const [a, b] of [
    [LO, LO],
    [HI, LO],
    [LO, HI],
    [HI, HI],
  ]) {
    g.beginPath();
    g.moveTo(a, b);
    g.lineTo(a === LO ? PF_MIN : PF_MAX, b === LO ? PF_MIN : PF_MAX);
    g.stroke();
  }

  // --- playfield: matte plywood ---
  g.drawImage(wood.field, PF_MIN, PF_MIN, W, W);
  // broad, soft light — brighter towards the top-left, no hot spot
  const light = g.createRadialGradient(430, 400, 80, 500, 500, 720);
  light.addColorStop(0, "rgba(255,250,238,0.07)");
  light.addColorStop(0.6, "rgba(0,0,0,0)");
  light.addColorStop(1, "rgba(60,30,8,0.16)");
  g.fillStyle = light;
  g.fillRect(PF_MIN, PF_MIN, W, W);
  // the raised frame casts a short shadow onto the field (deeper on the top & left)
  const inset = (x: number, y: number, w: number, h: number, x1: number, y1: number, alpha: number) => {
    const gr = g.createLinearGradient(x, y, x1, y1);
    gr.addColorStop(0, `rgba(35,18,4,${alpha})`);
    gr.addColorStop(1, "rgba(35,18,4,0)");
    g.fillStyle = gr;
    g.fillRect(x, y, w, h);
  };
  inset(PF_MIN, PF_MIN, W, 12, PF_MIN, PF_MIN + 12, 0.42);
  inset(PF_MIN, PF_MIN, 12, W, PF_MIN + 12, PF_MIN, 0.42);
  inset(PF_MIN, PF_MAX - 6, W, 6, PF_MIN, PF_MAX - 6, 0.18);
  inset(PF_MAX - 6, PF_MIN, 6, W, PF_MAX - 6, PF_MIN, 0.18);
  g.strokeStyle = "rgba(20,10,2,0.55)";
  g.lineWidth = 1.2;
  g.strokeRect(PF_MIN, PF_MIN, W, W);

  // --- markings: printed ink, multiplied into the wood so the grain shows through ---
  const ink = th.ink;
  g.save();
  if (th.glow) {
    g.shadowColor = th.glow;
    g.shadowBlur = 12;
  } else {
    g.globalCompositeOperation = "multiply";
  }
  g.strokeStyle = ink;
  g.fillStyle = ink;
  g.lineCap = "round";
  g.globalAlpha = 0.9;

  // centre circles + rosette + spot
  g.lineWidth = 2.6;
  g.beginPath();
  g.arc(500, 500, 118, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 1.5;
  g.beginPath();
  g.arc(500, 500, 111, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.arc(500, 500, 58, 0, Math.PI * 2);
  g.stroke();
  // eight-point star around the spot, in outline like a printed board
  g.lineWidth = 1.4;
  g.beginPath();
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI) / 8 - Math.PI / 2;
    const rr = i % 2 ? 22 : 44;
    g.lineTo(500 + Math.cos(a) * rr, 500 + Math.sin(a) * rr);
  }
  g.closePath();
  g.stroke();
  g.fillStyle = th.accent;
  g.beginPath();
  g.arc(500, 500, 13, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 1.8;
  g.stroke();
  g.fillStyle = ink;

  // diagonal arrows towards each corner, with the curved "flick" arrow at their inner end
  for (const [sx, sy] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ] as const) {
    const ux = sx * Math.SQRT1_2;
    const uy = sy * Math.SQRT1_2;
    const out = Math.atan2(uy, ux);
    const ac = { x: 500 + ux * 268, y: 500 + uy * 268 };
    const R = 30;
    // line: from the arc's outer edge to near the corner, arrowhead pointing at the pocket
    const x1 = ac.x + ux * R;
    const y1 = ac.y + uy * R;
    const x2 = 500 + ux * 505;
    const y2 = 500 + uy * 505;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2 - ux * 6, y2 - uy * 6);
    g.stroke();
    arrowHead(g, x2, y2, out, 17, 0.36);
    // three-quarter arc around the inner end, open towards the centre, arrowheads at both tips
    const a0 = out + Math.PI + 0.8;
    const a1 = out + Math.PI - 0.8 + Math.PI * 2;
    g.lineWidth = 1.8;
    g.beginPath();
    g.arc(ac.x, ac.y, R, a0, a1);
    g.stroke();
    for (const [ang, dirSign] of [
      [a0, -1],
      [a1, 1],
    ] as const) {
      const tx = ac.x + Math.cos(ang) * R;
      const ty = ac.y + Math.sin(ang) * R;
      arrowHead(g, tx, ty, ang + (dirSign * Math.PI) / 2, 9, 0.5);
    }
  }

  // baselines: double rail ending in red circles
  for (let i = 0; i < 4; i++) {
    g.save();
    g.translate(500, 500);
    g.rotate((i * Math.PI) / 2);
    g.translate(-500, -500);
    const y = PF_MAX - BASE_OFF;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(BASE_MIN, y - 12);
    g.lineTo(BASE_MAX, y - 12);
    g.moveTo(BASE_MIN, y + 12);
    g.lineTo(BASE_MAX, y + 12);
    g.stroke();
    for (const cx of [BASE_MIN, BASE_MAX]) {
      g.fillStyle = th.accent;
      g.beginPath();
      g.arc(cx, y, 12.5, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 2;
      g.stroke();
    }
    g.restore();
  }
  g.restore();

  // --- pockets: a clean cut through the plywood, netting visible below ---
  const net = hexRgb(th.net);
  for (const p of POCKETS) {
    g.save();
    g.beginPath();
    g.arc(p.x, p.y, POCKET_R, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = `rgb(${net[0] * 0.5},${net[1] * 0.5},${net[2] * 0.5})`;
    g.fillRect(p.x - POCKET_R, p.y - POCKET_R, POCKET_R * 2, POCKET_R * 2);
    // knotted mesh
    g.strokeStyle = `rgba(${net[0]},${net[1]},${net[2]},0.9)`;
    g.lineWidth = 1.3;
    for (let k = -POCKET_R * 2; k < POCKET_R * 2; k += 7) {
      g.beginPath();
      g.moveTo(p.x + k, p.y - POCKET_R);
      g.lineTo(p.x + k + POCKET_R * 2, p.y + POCKET_R);
      g.moveTo(p.x + k + POCKET_R * 2, p.y - POCKET_R);
      g.lineTo(p.x + k, p.y + POCKET_R);
      g.stroke();
    }
    // depth: the net sags away, the board edge shades the rim
    const depth = g.createRadialGradient(p.x + 6, p.y + 8, 2, p.x, p.y, POCKET_R);
    depth.addColorStop(0, "rgba(0,0,0,0.12)");
    depth.addColorStop(0.7, "rgba(0,0,0,0.42)");
    depth.addColorStop(1, "rgba(0,0,0,0.85)");
    g.fillStyle = depth;
    g.fillRect(p.x - POCKET_R, p.y - POCKET_R, POCKET_R * 2, POCKET_R * 2);
    g.restore();
    drawPocketLip(g, p, th);
  }

  // --- corner caps: small matte steel triangles over the mitres ---
  for (const [cx, cy, dx, dy] of [
    [LO, LO, 1, 1],
    [HI, LO, -1, 1],
    [LO, HI, 1, -1],
    [HI, HI, -1, -1],
  ] as const) {
    const L = 22;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + dx * L, cy);
    g.lineTo(cx, cy + dy * L);
    g.closePath();
    const steel = g.createLinearGradient(cx, cy, cx + dx * L * 0.5, cy + dy * L * 0.5);
    steel.addColorStop(0, th.brass[0]);
    steel.addColorStop(0.7, th.brass[1]);
    steel.addColorStop(1, th.brass[2]);
    g.fillStyle = steel;
    g.fill();
    g.strokeStyle = "rgba(0,0,0,0.45)";
    g.lineWidth = 0.8;
    g.stroke();
    g.fillStyle = "rgba(0,0,0,0.4)";
    g.beginPath();
    g.arc(cx + dx * 6, cy + dy * 6, 1.3, 0, Math.PI * 2);
    g.fill();
  }

  // room light: corners fall away into shade
  const lamp = g.createRadialGradient(480, 470, 160, 500, 500, 760);
  lamp.addColorStop(0, "rgba(0,0,0,0)");
  lamp.addColorStop(1, "rgba(0,0,0,0.26)");
  g.fillStyle = lamp;
  g.fillRect(LO, LO, VIEW, VIEW);
  return c;
}

/** The pocket's cut edge (dark outline + the hole's wall); neon boards keep a lit ring. */
function drawPocketLip(g: CanvasRenderingContext2D, p: Vec, th: BoardTheme) {
  g.save();
  if (th.glow) {
    const ring = g.createLinearGradient(p.x - POCKET_R, p.y - POCKET_R, p.x + POCKET_R, p.y + POCKET_R);
    ring.addColorStop(0, th.brass[0]);
    ring.addColorStop(0.5, th.brass[1]);
    ring.addColorStop(1, th.brass[2]);
    g.strokeStyle = ring;
    g.lineWidth = 4;
    g.beginPath();
    g.arc(p.x, p.y, POCKET_R + 1, 0, Math.PI * 2);
    g.stroke();
  } else {
    // inner wall of the hole: in shade near the light, lit on the far (bottom-right) side
    const wall = g.createLinearGradient(p.x - POCKET_R, p.y - POCKET_R, p.x + POCKET_R, p.y + POCKET_R);
    wall.addColorStop(0, "rgba(40,22,8,0.95)");
    wall.addColorStop(1, th.field[1]);
    g.strokeStyle = wall;
    g.lineWidth = 3;
    g.beginPath();
    g.arc(p.x, p.y, POCKET_R - 1.5, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = "rgba(25,12,3,0.6)";
    g.lineWidth = 1;
    g.beginPath();
    g.arc(p.x, p.y, POCKET_R + 0.3, 0, Math.PI * 2);
    g.stroke();
  }
  g.restore();
}

let currentTheme: BoardTheme = BOARDS[0];

/** The static board, cached at the canvas' pixel size and theme. Call with the board view set. */
export function drawBoard(ctx: CanvasRenderingContext2D, theme: BoardTheme = BOARDS[0]) {
  const px = ctx.canvas.width;
  currentTheme = theme;
  if (!boardCache || boardCache.px !== px || boardCache.theme !== theme.id) {
    boardCache = { px, theme: theme.id, canvas: paintBoard(px, theme) };
  }
  ctx.drawImage(boardCache.canvas, VIEW_MIN, VIEW_MIN, VIEW, VIEW);
}

/* ======================= discs ======================= */

let shadowSprite: HTMLCanvasElement | null = null;
function shadow() {
  if (shadowSprite) return shadowSprite;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(32, 32, 8, 32, 32, 32);
  gr.addColorStop(0, "rgba(40,20,4,0.5)");
  gr.addColorStop(0.6, "rgba(40,20,4,0.22)");
  gr.addColorStop(1, "rgba(40,20,4,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  shadowSprite = c;
  return c;
}

let glowCache = new Map<string, HTMLCanvasElement>();
function glowSprite(color: string) {
  let c = glowCache.get(color);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, color.replace(/[\d.]+\)$/, "0.75)"));
  gr.addColorStop(1, color.replace(/[\d.]+\)$/, "0)"));
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  glowCache.set(color, c);
  if (glowCache.size > 12) glowCache = new Map([[color, c]]);
  return c;
}

/** Sprite resolution for a disc of world radius r on this canvas. */
const spritePx = (ctx: CanvasRenderingContext2D, r: number) => Math.max(24, Math.ceil(((r * 2) / SIZE) * ctx.canvas.width));

function blitDisc(ctx: CanvasRenderingContext2D, face: HTMLCanvasElement, x: number, y: number, r: number, angle: number, scale = 1, lift = 0) {
  const rs = r * scale;
  // soft shadow, offset away from the top-left light; grows when the disc is "lifted"
  const so = 3 + lift * 6;
  ctx.drawImage(shadow(), x - rs * 1.25 + so, y - rs * 1.25 + so * 1.5, rs * 2.5, rs * 2.5);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.drawImage(face, -rs, -rs, rs * 2, rs * 2);
  ctx.restore();
  const light = lightingSprite(face.width);
  ctx.drawImage(light, x - rs, y - rs, rs * 2, rs * 2);
}

export function drawCoin(ctx: CanvasRenderingContext2D, d: Disc, set: CoinSet) {
  const kind = d.kind === "striker" ? "white" : d.kind;
  const face = coinSprite(set, kind, spritePx(ctx, d.r));
  const sp = Math.hypot(d.vx, d.vy);
  // motion trail for fast coins (two faint ghosts behind)
  if (sp > 900 && !reduced()) {
    ctx.globalAlpha = 0.12;
    for (const k of [0.022, 0.012]) ctx.drawImage(face, d.x - d.vx * k - d.r, d.y - d.vy * k - d.r, d.r * 2, d.r * 2);
    ctx.globalAlpha = 1;
  }
  if (set.glow) ctx.drawImage(glowSprite(kind === "white" ? "rgba(80,220,255,1)" : kind === "black" ? "rgba(255,80,220,1)" : "rgba(255,220,60,1)"), d.x - d.r * 1.8, d.y - d.r * 1.8, d.r * 3.6, d.r * 3.6);
  blitDisc(ctx, face, d.x, d.y, d.r, d.a);
}

/**
 * Striker. `pull` (0..1) visually draws it back along the aim while you're aiming, like a finger
 * cocked for the flick; `dir` is the aim direction.
 */
export function drawStriker(
  ctx: CanvasRenderingContext2D,
  d: Disc,
  skin: StrikerSkin,
  ringColor: string,
  pulse: number,
  active: boolean,
  pull = 0,
  dir: Vec = { x: 0, y: -1 },
  tier = 0,
) {
  const face = strikerSprite(skin, spritePx(ctx, d.r));
  const x = d.x - dir.x * pull * 16;
  const y = d.y - dir.y * pull * 16;
  const sp = Math.hypot(d.vx, d.vy);
  const tierColor = skin.glow ?? "rgba(255,170,60,1)";
  // upgrade tiers: 2+ → a soft aura that breathes
  if (tier >= 2) {
    const breathe = 0.75 + 0.25 * Math.sin(performance.now() / 420);
    ctx.globalAlpha = 0.55 * breathe;
    ctx.drawImage(glowSprite(tierColor), x - d.r * 2.3, y - d.r * 2.3, d.r * 4.6, d.r * 4.6);
    ctx.globalAlpha = 1;
  }
  if (sp > 900 && !reduced() && tier < 3) {
    ctx.globalAlpha = 0.14;
    for (const k of [0.024, 0.013]) ctx.drawImage(face, d.x - d.vx * k - d.r, d.y - d.vy * k - d.r, d.r * 2, d.r * 2);
    ctx.globalAlpha = 1;
  }
  if (skin.glow) ctx.drawImage(glowSprite(skin.glow), x - d.r * 2, y - d.r * 2, d.r * 4, d.r * 4);
  // turn-colour halo while it's your shot
  if (active) {
    ctx.save();
    ctx.globalAlpha = 0.35 + pulse * 0.4;
    ctx.strokeStyle = ringColor;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(x, y, d.r + 7 + pulse * 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  blitDisc(ctx, face, x, y, d.r, d.a, 1, active ? 0.4 : 0);
  // tier 1+: an engraved metal outer band
  if (tier >= 1) {
    ctx.save();
    ctx.lineWidth = 2.2;
    const band = ctx.createLinearGradient(x - d.r, y - d.r, x + d.r, y + d.r);
    band.addColorStop(0, "rgba(255,245,220,0.95)");
    band.addColorStop(0.5, tier >= 3 ? tierColor : "rgba(190,150,70,0.95)");
    band.addColorStop(1, "rgba(90,60,20,0.95)");
    ctx.strokeStyle = band;
    ctx.beginPath();
    ctx.arc(x, y, d.r - 1.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

export function drawAim(ctx: CanvasRenderingContext2D, s: Vec, dir: Vec, power: number, color: string) {
  const L = 130 + power * 560;
  const ex = s.x + dir.x * L;
  const ey = s.y + dir.y * L;
  ctx.save();
  // guide line fades out along its length
  const grad = ctx.createLinearGradient(s.x, s.y, ex, ey);
  grad.addColorStop(0, color);
  grad.addColorStop(1, color.replace(/[\d.]+\)$/, "0.05)"));
  ctx.strokeStyle = grad;
  ctx.lineWidth = 3.5;
  ctx.setLineDash([14, 12]);
  ctx.beginPath();
  ctx.moveTo(s.x + dir.x * (STRIKER_R + 6), s.y + dir.y * (STRIKER_R + 6));
  ctx.lineTo(ex, ey);
  ctx.stroke();
  ctx.setLineDash([]);
  // ghost striker at the predicted end
  ctx.globalAlpha = 0.3;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(ex, ey, STRIKER_R, 0, Math.PI * 2);
  ctx.stroke();
  // power arc: green → amber → red
  ctx.globalAlpha = 1;
  const hue = 120 - power * 120;
  ctx.strokeStyle = `hsl(${hue} 85% 48%)`;
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(s.x, s.y, STRIKER_R + 14, -Math.PI / 2, -Math.PI / 2 + power * Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** Where a disc of radius `r` leaving `from` along `dir` first touches another disc or a wall. */
function castStriker(world: World, from: Vec, dir: Vec, r: number, maxLen: number, skip?: Disc) {
  let bestT = maxLen;
  let hit: Disc | null = null;
  for (const o of world.discs) {
    if (!o.alive || o === skip || o.kind === "striker") continue;
    const R = o.r + r;
    const fx = from.x - o.x;
    const fy = from.y - o.y;
    const b = fx * dir.x + fy * dir.y;
    const c = fx * fx + fy * fy - R * R;
    const disc = b * b - c;
    if (disc < 0) continue;
    const t = -b - Math.sqrt(disc);
    if (t > 0.5 && t < bestT) {
      bestT = t;
      hit = o;
    }
  }
  // walls (centre stays r inside the playfield)
  let wall: "x" | "y" | null = null;
  const lim = (v: number, d: number, lo: number, hi: number) => (d > 0 ? (hi - v) / d : d < 0 ? (lo - v) / d : Infinity);
  const tx = lim(from.x, dir.x, PF_MIN + r, PF_MAX - r);
  const ty = lim(from.y, dir.y, PF_MIN + r, PF_MAX - r);
  if (tx < bestT && tx > 0) {
    bestT = tx;
    hit = null;
    wall = "x";
  }
  if (ty < bestT && ty > 0) {
    bestT = ty;
    hit = null;
    wall = "y";
  }
  return { t: bestT, hit, wall, at: { x: from.x + dir.x * bestT, y: from.y + dir.y * bestT } };
}

function dashed(ctx: CanvasRenderingContext2D, a: Vec, b: Vec, color: string, width: number, fadeTo = 0.05) {
  const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
  grad.addColorStop(0, color);
  grad.addColorStop(1, color.replace(/[\d.]+\)$/, `${fadeTo})`));
  ctx.strokeStyle = grad;
  ctx.lineWidth = width;
  ctx.setLineDash([14, 12]);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.setLineDash([]);
}

/**
 * Aim guide shaped by the striker's Aim stat:
 *  - every level: a guide line (longer with more Aim) to the first thing the striker touches
 *  - Aim 4+: the struck coin's path
 *  - Aim 7+: the striker's own path after contact, or its bounce off a wall
 */
export function drawAimPreview(ctx: CanvasRenderingContext2D, world: World, dir: Vec, power: number, aim: number, valid: boolean) {
  const s = world.striker;
  const color = valid ? "rgba(31,92,180,0.85)" : "rgba(200,40,30,0.85)";
  const reach = (130 + power * 560) * aimReachFor(aim);
  const start = { x: s.x + dir.x * (STRIKER_R + 6), y: s.y + dir.y * (STRIKER_R + 6) };
  const cast = castStriker(world, s, dir, s.r, reach);
  ctx.save();
  dashed(ctx, start, cast.at, color, 3.5, cast.hit || cast.wall ? 0.6 : 0.05);

  if (valid && (cast.hit || cast.wall) && cast.t < reach) {
    // ghost striker at contact
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(cast.at.x, cast.at.y, STRIKER_R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;

    if (cast.hit && aim >= AIM_TARGET_LINE) {
      const o = cast.hit;
      const n = { x: (o.x - cast.at.x) / (o.r + s.r), y: (o.y - cast.at.y) / (o.r + s.r) };
      const cut = Math.max(0, dir.x * n.x + dir.y * n.y);
      const len = 70 + 260 * cut * (0.6 + power * 0.6) * (aim >= AIM_FULL_PREVIEW ? 1.25 : 1);
      dashed(ctx, o, { x: o.x + n.x * len, y: o.y + n.y * len }, "rgba(240,140,30,0.9)", 3);
      if (aim >= AIM_FULL_PREVIEW && cut < 0.985) {
        const tg = { x: dir.x - n.x * cut, y: dir.y - n.y * cut };
        const tl = Math.hypot(tg.x, tg.y) || 1;
        const sl = 60 + 220 * (1 - cut) * (0.6 + power * 0.6);
        dashed(ctx, cast.at, { x: cast.at.x + (tg.x / tl) * sl, y: cast.at.y + (tg.y / tl) * sl }, "rgba(31,92,180,0.6)", 2.2);
      }
    } else if (cast.wall && aim >= AIM_FULL_PREVIEW) {
      const rd = cast.wall === "x" ? { x: -dir.x, y: dir.y } : { x: dir.x, y: -dir.y };
      const left = Math.max(60, (reach - cast.t) * 0.7);
      const second = castStriker(world, cast.at, rd, s.r, left);
      dashed(ctx, cast.at, second.at, color, 3);
    }
  }

  // power arc: green → amber → red
  const hue = 120 - power * 120;
  ctx.strokeStyle = `hsl(${hue} 85% 48%)`;
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(s.x, s.y, STRIKER_R + 14, -Math.PI / 2, -Math.PI / 2 + power * Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** Pocket edge, redrawn over a dropping disc so it slips UNDER the lip. */
function drawPocketRim(ctx: CanvasRenderingContext2D, p: Vec) {
  drawPocketLip(ctx, p, currentTheme);
}

const SINK_SLIDE = 0.34; // share of the animation spent sliding in, the rest is the drop

/**
 * Discs going into pockets, in two beats:
 *  1. slide — the disc carries on along its line of travel and curves into the pocket mouth
 *  2. drop  — it tips over the edge (squashes along its travel, like a coin tilting),
 *             shrinks into the dark, slips under the brass rim and is gone
 */
export function drawSinks(ctx: CanvasRenderingContext2D, world: World, set: CoinSet, skin: StrikerSkin) {
  for (const s of world.sinks) {
    const k = 1 - Math.max(0, s.t) / SINK_T; // 0 → 1
    const r = s.kind === "striker" ? STRIKER_R : 19;
    const face = s.kind === "striker" ? strikerSprite(skin, spritePx(ctx, r)) : coinSprite(set, s.kind, spritePx(ctx, r));
    const pocket = { x: s.px, y: s.py };

    if (k < SINK_SLIDE) {
      const u = k / SINK_SLIDE;
      const e = 1 - (1 - u) * (1 - u); // ease out: arrives fast, settles at the mouth
      // quadratic curve: keeps the disc's momentum, then bends into the pocket centre
      const reach = Math.hypot(s.px - s.x, s.py - s.y) * 0.7 + Math.min(s.sp, 1200) * 0.012;
      const cx = s.x + s.dx * reach;
      const cy = s.y + s.dy * reach;
      const x = (1 - e) * (1 - e) * s.x + 2 * (1 - e) * e * cx + e * e * s.px;
      const y = (1 - e) * (1 - e) * s.y + 2 * (1 - e) * e * cy + e * e * s.py;
      blitDisc(ctx, face, x, y, r, s.a);
    } else {
      const u = (k - SINK_SLIDE) / (1 - SINK_SLIDE);
      const travel = Math.atan2(s.dy, s.dx);
      const x = s.px + s.dx * r * 0.3 * u;
      const y = s.py + s.dy * r * 0.3 * u;
      const sc = 1 - 0.5 * Math.pow(u, 1.25);
      const tilt = 1 - 0.6 * u; // foreshortening as it tips over the edge
      const fade = u > 0.72 ? 1 - (u - 0.72) / 0.28 : 1;
      ctx.save();
      ctx.beginPath();
      ctx.arc(s.px, s.py, POCKET_R - 1, 0, Math.PI * 2);
      ctx.clip();
      ctx.globalAlpha = fade;
      ctx.translate(x, y);
      ctx.rotate(travel);
      ctx.scale(tilt, 1);
      ctx.rotate(s.a - travel);
      ctx.drawImage(face, -r * sc, -r * sc, r * 2 * sc, r * 2 * sc);
      // falling into the shadow of the pocket
      ctx.globalAlpha = fade * Math.min(0.9, u * 1.15);
      ctx.fillStyle = "#050302";
      ctx.beginPath();
      ctx.arc(0, 0, r * sc + 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    drawPocketRim(ctx, pocket);
  }
}

/** While aiming: a rubber band from the striker back to where you're pulling. */
export function drawPullBand(ctx: CanvasRenderingContext2D, s: Vec, dir: Vec, power: number, valid: boolean) {
  const back = STRIKER_R + 18 + power * 130;
  const bx = s.x - dir.x * back;
  const by = s.y - dir.y * back;
  const nx = -dir.y;
  const ny = dir.x;
  const col = valid ? "255,140,40" : "220,50,40";
  ctx.save();
  ctx.strokeStyle = `rgba(${col},0.75)`;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(s.x + nx * STRIKER_R * 0.8, s.y + ny * STRIKER_R * 0.8);
  ctx.lineTo(bx, by);
  ctx.lineTo(s.x - nx * STRIKER_R * 0.8, s.y - ny * STRIKER_R * 0.8);
  ctx.stroke();
  ctx.fillStyle = `rgba(${col},0.9)`;
  ctx.beginPath();
  ctx.arc(bx, by, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.beginPath();
  ctx.arc(bx, by, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Turn clock: a ring around the striker that drains (green → amber → red). `frac` 1 → 0. */
export function drawTurnTimer(ctx: CanvasRenderingContext2D, s: Vec, frac: number) {
  const f = Math.max(0, Math.min(1, frac));
  const R = STRIKER_R + 27;
  const urgent = f < 0.34;
  const pulse = urgent ? 0.5 + 0.5 * Math.sin(performance.now() / 110) : 0;
  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(40,20,5,0.18)";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(s.x, s.y, R, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = `hsl(${Math.round(120 * f)} 85% ${45 + pulse * 10}%)`;
  ctx.lineWidth = 5 + pulse * 2;
  ctx.beginPath();
  ctx.arc(s.x, s.y, R, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/* ======================= effects ======================= */

type Puff = { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string };

/** Turns physics events into sounds, powder puffs, pocket flashes and camera shake. */
export class CarromFx {
  private puffs: Puff[] = Array.from({ length: 140 }, () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 4, color: "#fff" }));
  private next = 0;
  private shake = 0;
  private flashes: { x: number; y: number; t: number; color: string }[] = [];
  /** mass of the striker in play (heavier strikers sound deeper) */
  strikerMass = 1.7;
  /** shock rings from hard impacts */
  private ripples: { x: number; y: number; t: number; s: number }[] = [];
  /** striker trail (tier 3 strikers: a glowing ribbon) */
  private trail: { x: number; y: number; t: number }[] = [];
  private trailColor = "rgba(255,170,60,1)";
  /** slow motion: time scale for the physics, eases back to 1 */
  private slowLeft = 0;
  /** "+1" / "Queen!" / "Foul!" labels that rise out of a pocket */
  private floaters: { x: number; y: number; vx: number; vy: number; t: number; text: string; fill: string; edge: string }[] = [];

  private emit(x: number, y: number, n: number, speed: number, size: number, color: string, life = 0.5) {
    const count = reduced() ? Math.ceil(n / 3) : n;
    for (let i = 0; i < count; i++) {
      const p = this.puffs[this.next];
      this.next = (this.next + 1) % this.puffs.length;
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.3 + Math.random() * 0.7);
      Object.assign(p, { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, size: size * (0.6 + Math.random() * 0.8), color });
    }
  }

  kickShake(a: number) {
    if (!reduced()) this.shake = Math.max(this.shake, a);
  }

  /** Dramatic moment (queen / last coin): run the physics slower for a beat. */
  slowMo(seconds = 0.9) {
    if (!reduced()) this.slowLeft = Math.max(this.slowLeft, seconds);
  }

  /** Physics time scale for this frame (1 = normal). */
  timeScale(dt: number) {
    if (this.slowLeft <= 0) return 1;
    this.slowLeft -= dt;
    // ease in and out of 35% speed
    const k = Math.min(1, Math.max(0, this.slowLeft) / 0.25);
    return 1 - 0.65 * k;
  }

  /** Record the striker's path while it moves fast (only drawn for top-tier strikers). */
  trackStriker(d: Disc, tier: number, color?: string) {
    if (tier < 3 || reduced()) return;
    if (color) this.trailColor = color;
    if (Math.hypot(d.vx, d.vy) > 260) this.trail.push({ x: d.x, y: d.y, t: 0 });
    if (this.trail.length > 40) this.trail.shift();
  }

  /** Strike animation: dust kicked up behind the striker + flick sound. */
  strike(x: number, y: number, dir: Vec, power: number) {
    carromAudio.flick(power, x);
    this.emit(x - dir.x * STRIKER_R, y - dir.y * STRIKER_R, 10 + Math.round(power * 10), 120 + power * 160, 6, "rgba(255,250,235,0.9)", 0.45);
    this.flashes.push({ x, y, t: 0, color: "255,255,255" });
    if (power > 0.8) this.kickShake(4);
  }

  consume(events: FxEvent[]) {
    for (const e of events) {
      if (e.type === "hit") {
        carromAudio.hit(e.s, e.striker, e.x, this.strikerMass);
        if (e.s > 900 && !reduced()) this.ripples.push({ x: e.x, y: e.y, t: 0, s: Math.min(1, e.s / 2200) });
        if (e.s > 260) this.emit(e.x, e.y, Math.min(10, 2 + Math.round(e.s / 250)), 40 + e.s * 0.08, 5, "rgba(255,252,240,0.85)", 0.4);
        if (e.s > 1500) this.kickShake(Math.min(7, e.s / 400));
      } else if (e.type === "wall") {
        carromAudio.wall(e.s, e.x);
        if (e.s > 500) this.emit(e.x, e.y, 4, 60, 5, "rgba(255,240,215,0.7)", 0.35);
      } else if (e.type === "rattle") {
        carromAudio.rattle(e.x);
        this.kickShake(3);
      } else if (e.type === "pot") {
        carromAudio.pot(e.kind, e.s, e.px);
        const col = e.kind === "white" ? "255,248,225" : e.kind === "black" ? "120,120,140" : e.kind === "queen" ? "255,90,80" : "160,200,255";
        // the pop lands when the disc reaches the pocket mouth, not at capture
        const delay = SINK_T * 0.3;
        this.flashes.push({ x: e.px, y: e.py, t: -delay * 2.6, color: col });
        this.emit(e.px, e.py, 12, 140, 5, `rgba(${col},0.95)`, 0.55);
        if (e.kind === "queen") this.emit(e.px, e.py, 18, 220, 4, "rgba(255,210,90,0.95)", 0.8);
        // label rising from the pocket towards the middle of the board
        const tx = 500 - e.px;
        const ty = 500 - e.py;
        const tl = Math.hypot(tx, ty) || 1;
        const label =
          e.kind === "queen"
            ? { text: "Queen!", fill: "#ff5a4a", edge: "#3a0905" }
            : e.kind === "striker"
              ? { text: "Foul!", fill: "#9fd0ff", edge: "#0b2340" }
              : e.kind === "white"
                ? { text: "+1", fill: "#fff6e0", edge: "#4a2a10" }
                : { text: "+1", fill: "#2a2a30", edge: "#f3e2c0" };
        this.floaters.push({
          x: e.px + (tx / tl) * 62,
          y: e.py + (ty / tl) * 62,
          vx: (tx / tl) * 40,
          vy: (ty / tl) * 40 - 30,
          t: -delay,
          ...label,
        });
      }
    }
    events.length = 0;
  }

  /** Apply camera shake (call inside ctx.save()). */
  applyShake(ctx: CanvasRenderingContext2D, dt: number) {
    if (this.shake < 0.1) return;
    ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
    this.shake *= Math.pow(0.0015, dt);
  }

  /** Trail under the discs (call before drawing the striker). */
  drawUnder(ctx: CanvasRenderingContext2D, dt: number) {
    for (const p of this.trail) p.t += dt;
    this.trail = this.trail.filter((p) => p.t < 0.35);
    if (this.trail.length < 2) return;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let i = 1; i < this.trail.length; i++) {
      const a = this.trail[i - 1];
      const b = this.trail[i];
      const k = 1 - b.t / 0.35;
      ctx.strokeStyle = this.trailColor.replace(/[\d.]+\)$/, `${(0.55 * k * (i / this.trail.length)).toFixed(3)})`);
      ctx.lineWidth = STRIKER_R * 1.4 * k * (i / this.trail.length);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  draw(ctx: CanvasRenderingContext2D, dt: number) {
    for (const r of this.ripples) {
      r.t += dt * 3.2;
      const k = Math.min(1, r.t);
      ctx.strokeStyle = `rgba(255,250,235,${(1 - k) * 0.55 * (0.5 + r.s)})`;
      ctx.lineWidth = 3 * (1 - k) + 0.5;
      ctx.beginPath();
      ctx.arc(r.x, r.y, 8 + k * (40 + r.s * 50), 0, Math.PI * 2);
      ctx.stroke();
    }
    this.ripples = this.ripples.filter((r) => r.t < 1);

    for (const f of this.floaters) {
      f.t += dt;
      if (f.t <= 0) continue;
      const k = Math.min(1, f.t / 1.1);
      const pop = k < 0.15 ? 0.6 + (k / 0.15) * 0.55 : k < 0.25 ? 1.15 - ((k - 0.15) / 0.1) * 0.15 : 1;
      const x = f.x + f.vx * f.t;
      const y = f.y + f.vy * f.t;
      ctx.save();
      ctx.globalAlpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      ctx.translate(x, y);
      ctx.rotate(-viewAngle); // upright for whoever is looking
      ctx.scale(pop, pop);
      ctx.font = "900 34px Inter, -apple-system, 'Segoe UI', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      ctx.lineWidth = 7;
      ctx.strokeStyle = f.edge;
      ctx.strokeText(f.text, 0, 0);
      ctx.fillStyle = f.fill;
      ctx.fillText(f.text, 0, 0);
      ctx.restore();
    }
    this.floaters = this.floaters.filter((f) => f.t < 1.1);

    for (const f of this.flashes) {
      f.t += dt * 2.6;
      if (f.t <= 0) continue;
      const k = Math.min(1, f.t);
      ctx.strokeStyle = `rgba(${f.color},${(1 - k) * 0.9})`;
      ctx.lineWidth = 4 * (1 - k) + 1;
      ctx.beginPath();
      ctx.arc(f.x, f.y, 18 + k * 42, 0, Math.PI * 2);
      ctx.stroke();
    }
    this.flashes = this.flashes.filter((f) => f.t < 1);
    for (const p of this.puffs) {
      if (p.life <= 0) continue;
      p.life -= dt;
      p.vx *= 0.9;
      p.vy *= 0.9;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const t = Math.max(0, p.life / p.max);
      ctx.globalAlpha = t * 0.8;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1.6 - t * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

/* ======================= overlays ======================= */

export function drawBaselineGlow(ctx: CanvasRenderingContext2D, world: World, seat: number) {
  const bl = baselineFor(seat, world.seats);
  ctx.save();
  ctx.fillStyle = "rgba(47,111,208,0.09)";
  const pad = 44;
  if (bl.axis === "h") ctx.fillRect(bl.min - pad, bl.at - pad, bl.max - bl.min + pad * 2, pad * 2);
  else ctx.fillRect(bl.at - pad, bl.min - pad, pad * 2, bl.max - bl.min + pad * 2);
  ctx.restore();
}

const SEAT_COLORS = ["#2f6fd0", "#c2392f", "#1f9d55", "#b8860b"];
export const seatRingColor = (seat: number) => SEAT_COLORS[seat % 4];

export function drawSeatLabels(ctx: CanvasRenderingContext2D, world: World, mySeat: number | null) {
  ctx.save();
  ctx.font = "700 17px Inter, -apple-system, 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const p of world.players) {
    const bl = baselineFor(p.seat, world.seats);
    const mx = (bl.min + bl.max) / 2;
    // between the outer baseline rail and the thin frame
    const off = 29;
    let lx: number;
    let ly: number;
    let rot = 0;
    if (bl.axis === "h") {
      lx = mx;
      ly = bl.at + (bl.at > 500 ? off : -off);
      rot = bl.at > 500 ? 0 : Math.PI;
    } else {
      lx = bl.at + (bl.at > 500 ? off : -off);
      ly = mx;
      rot = bl.at > 500 ? Math.PI / 2 : -Math.PI / 2;
    }
    ctx.save();
    ctx.translate(lx, ly);
    // online (rotated view): names read upright for you; on one shared device they face each seat
    ctx.rotate(viewAngle ? -viewAngle : rot);
    ctx.fillStyle = world.turn === p.seat ? seatRingColor(p.seat) : "rgba(60,35,10,0.42)";
    ctx.fillText(`${p.name}${p.seat === mySeat ? " (you)" : ""}`, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}
