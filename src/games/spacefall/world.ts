/* Spacefall simulation: the player's ship, weapons, enemies, bosses, pickups, progression and the
   spawn director. No drawing and no React here; draw.ts reads this state each frame.
   Everything that spawns often lives in fixed pools (no allocations while playing, and a hard cap
   on how many projectiles can exist). Movement is delta-time based. */
import {
  BOSS_EVERY,
  BOSS_HP,
  BOSS_NAMES,
  ENEMIES,
  ENEMY_KINDS,
  H,
  PICKUPS,
  PICKUP_KINDS,
  REGIONS,
  SHOT_SPEED,
  STAGES,
  TIERS,
  W,
  difficulty,
  stageForLevel,
  xpToNext,
  type EnemyDef,
  type EnemyKind,
  type PickupKind,
  type ShotKind,
  type Size,
} from "./config";
import { ROCK_VARIANTS } from "./art";

/* ---------------- entities ---------------- */

export type Enemy = {
  alive: boolean;
  id: number;
  kind: EnemyKind;
  def: EnemyDef;
  variant: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  hp: number;
  max: number;
  t: number;
  fire: number;
  a: number;
  spin: number;
  hit: number;
  ox: number;
  p1: number;
  p2: number;
  state: number;
  armor: number;
  dmgMul: number;
  fireMul: number;
};

export type Bullet = { alive: boolean; x: number; y: number; vx: number; vy: number; r: number; dmg: number; kind: number; t: number; life: number; hp: number };
export type Shot = { alive: boolean; x: number; y: number; vx: number; vy: number; dmg: number; kind: ShotKind; pierce: number; aoe: number; h0: number; h1: number; h2: number };
export type Missile = { alive: boolean; x: number; y: number; vx: number; vy: number; t: number; dmg: number; target: Enemy | null; boss: boolean; mini: boolean; tid: number };
export type Bomb = { alive: boolean; x: number; y: number; vy: number; t: number };
export type Pickup = { alive: boolean; kind: PickupKind; x: number; y: number; vy: number; t: number };
export type Ore = { alive: boolean; x: number; y: number; vx: number; vy: number; t: number };
/** kind: 0 spark (streak), 1 ember (dot), 2 smoke, 3 shard, 4 goo */
export type Particle = { life: number; max: number; x: number; y: number; vx: number; vy: number; size: number; grow: number; kind: number; color: string; rot: number; vr: number; drag: number };
export type Ring = { alive: boolean; x: number; y: number; t: number; dur: number; r0: number; r1: number; color: string; w: number };
export type Flash = { alive: boolean; x: number; y: number; t: number; dur: number; r: number; color: string };
export type Popup = { alive: boolean; x: number; y: number; t: number; text: string; color: string; size: number };
type Delayed = { alive: boolean; t: number; x: number; y: number; size: Size; pal: number };

export type BossPart = { kind: "turret" | "bay" | "crystal"; ox: number; oy: number; r: number; hp: number; max: number; alive: boolean; a: number; fire: number; hit: number };
export type Telegraph = { alive: boolean; vertical: boolean; pos: number; width: number; t: number; warn: number; fire: number };
export type Boss = {
  kind: number;
  tier: number;
  name: string;
  x: number;
  y: number;
  hp: number;
  max: number;
  t: number;
  phase: number;
  entering: number;
  dying: number;
  hit: number;
  parts: BossPart[];
  core: { ox: number; oy: number; r: number };
  rx: number;
  ry: number;
  atkA: number;
  atkB: number;
  atkC: number;
  spiral: number;
  charge: number;
  chargeY: number;
  /** seconds until a warned lunge starts */
  lunge: number;
  lasers: Telegraph[];
  dmgAcc: number;
  dmgT: number;
};

export type Banner = { text: string; sub: string; color: string; t: number; life: number; big: boolean };

function pool<T>(n: number, make: () => T): T[] {
  return Array.from({ length: n }, make);
}

const TAU = Math.PI * 2;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** explosion palettes: 0 fire (ships), 1 rock dust, 2 alien goo, 3 hot white (mines), 4 player blue */
export const PALETTES = [
  { flash: "rgba(255,170,80,1)", spark: "rgba(255,210,120,1)", ember: "rgba(255,120,40,1)", smoke: "rgba(70,60,60,1)", shard: true },
  { flash: "rgba(255,200,150,1)", spark: "rgba(255,220,170,1)", ember: "rgba(220,150,90,1)", smoke: "rgba(120,100,80,1)", shard: true },
  { flash: "rgba(150,255,130,1)", spark: "rgba(200,255,170,1)", ember: "rgba(190,90,255,1)", smoke: "rgba(60,90,50,1)", shard: false },
  { flash: "rgba(255,240,220,1)", spark: "rgba(255,255,230,1)", ember: "rgba(255,70,50,1)", smoke: "rgba(80,70,70,1)", shard: true },
  { flash: "rgba(140,210,255,1)", spark: "rgba(220,240,255,1)", ember: "rgba(90,170,255,1)", smoke: "rgba(60,70,90,1)", shard: true },
];
const familyPalette = (f: EnemyDef["family"]) => (f === "rock" ? 1 : f === "alien" ? 2 : f === "mine" ? 3 : 0);

export type Sfx = {
  shot: (kind: number) => void;
  boom: (size: number) => void;
  hit: () => void;
  hurt: (shield: boolean) => void;
  pickup: (rare: boolean) => void;
  missile: () => void;
  bomb: () => void;
  beam: (on: boolean) => void;
  nova: () => void;
  level: (evolve: boolean) => void;
  warning: () => void;
  laserWarn: () => void;
};

export type Stats = { score: number; distance: number; kills: number; bosses: number; time: number; level: number; resources: number; stage: number };

export class World {
  lite: boolean;
  sfx: Sfx;
  // player
  px = W / 2;
  py = H - 150;
  vx = 0;
  vy = 0;
  bank = 0;
  hp = 100;
  maxHp = 100;
  shield = 30;
  maxShield = 30;
  shieldWait = 0;
  shieldHit = 0;
  invuln = 0;
  hurt = 0;
  level = 1;
  xp = 0;
  next = xpToNext(1);
  stage = 0;
  evolveFx = 0;
  power = 1;
  rateMul = 1;
  extraDrones = 0;
  extraSalvo = 0;
  magnet = 90;
  // timed boosts
  weaponBoost = 0;
  rapid = 0;
  dmgBoost = 0;
  invincible = 0;
  tempDrones: number[] = [];
  // ammo / specials
  missiles = 8;
  bombs = 2;
  special = 0;
  specialMax = 16;
  beam = 0;
  beamWidth = 0;
  fireT = 0;
  shellT = 0;
  droneT = 0;
  autoT = 0;
  muzzle = 0;
  /** where the engines are (set by the renderer when the ship is a picture; 0 = drawn ship) */
  tail = 0;
  // pools
  enemies: Enemy[];
  bullets: Bullet[];
  shots: Shot[];
  pmissiles: Missile[];
  bombsOut: Bomb[];
  pickups: Pickup[];
  ores: Ore[];
  parts: Particle[];
  rings: Ring[];
  flashes: Flash[];
  popups: Popup[];
  delayed: Delayed[];
  private pi = 0;
  private enemyId = 1;
  // world
  t = 0;
  scroll = 0;
  speed = 150;
  distance = 0;
  distXp = 0;
  kills = 0;
  score = 0;
  resources = 0;
  bossesDown = 0;
  region = 0;
  regionFade = 0;
  prevRegion = 0;
  boss: Boss | null = null;
  bossPending = 0;
  bossWarn = 0;
  nextBossLevel = BOSS_EVERY;
  spawnT = 1.2;
  eventT = 30;
  motherT = 60;
  shake = 0;
  screenFlash = 0;
  banners: Banner[] = [];
  dead = false;
  deathT = 0;
  over = false;
  input = { x: 0, y: 0, drag: false, tx: 0, ty: 0 };
  private wants = { missile: false, bomb: false, special: false };

  constructor(lite: boolean, sfx: Sfx) {
    this.lite = lite;
    this.sfx = sfx;
    this.enemies = pool(90, () => ({ alive: false }) as Enemy);
    this.bullets = pool(320, () => ({ alive: false, x: 0, y: 0, vx: 0, vy: 0, r: 4, dmg: 0, kind: 0, t: 0, life: 0, hp: 0 }));
    this.shots = pool(340, () => ({ alive: false, x: 0, y: 0, vx: 0, vy: 0, dmg: 0, kind: 0, pierce: 0, aoe: 0, h0: 0, h1: 0, h2: 0 }));
    this.pmissiles = pool(60, () => ({ alive: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, dmg: 0, target: null, boss: false, mini: false, tid: 0 }));
    this.bombsOut = pool(6, () => ({ alive: false, x: 0, y: 0, vy: 0, t: 0 }));
    this.pickups = pool(16, () => ({ alive: false, kind: "repair", x: 0, y: 0, vy: 0, t: 0 }));
    this.ores = pool(80, () => ({ alive: false, x: 0, y: 0, vx: 0, vy: 0, t: 0 }));
    this.parts = pool(lite ? 420 : 950, () => ({ life: 0, max: 1, x: 0, y: 0, vx: 0, vy: 0, size: 2, grow: 0, kind: 0, color: "#fff", rot: 0, vr: 0, drag: 0 }));
    this.rings = pool(28, () => ({ alive: false, x: 0, y: 0, t: 0, dur: 1, r0: 0, r1: 0, color: "#fff", w: 2 }));
    this.flashes = pool(40, () => ({ alive: false, x: 0, y: 0, t: 0, dur: 1, r: 10, color: "#fff" }));
    this.popups = pool(28, () => ({ alive: false, x: 0, y: 0, t: 0, text: "", color: "#fff", size: 12 }));
    this.delayed = pool(48, () => ({ alive: false, t: 0, x: 0, y: 0, size: 0, pal: 0 }));
    this.applyStage(true);
    this.hp = this.maxHp;
    this.shield = this.maxShield;
  }

  /* ---------------- public ---------------- */

  press(what: "missile" | "bomb" | "special") {
    this.wants[what] = true;
  }

  stats(): Stats {
    return { score: Math.floor(this.score), distance: Math.floor(this.distance / 10), kills: this.kills, bosses: this.bossesDown, time: this.t, level: this.level, resources: this.resources, stage: this.stage };
  }

  get tier() {
    return Math.min(TIERS.length - 1, this.stage + (this.weaponBoost > 0 ? 1 : 0));
  }
  get drones() {
    return Math.min(5, STAGES[this.stage].drones + this.extraDrones + this.tempDrones.length);
  }
  get salvo() {
    return STAGES[this.stage].salvo + this.extraSalvo;
  }

  update(dt: number) {
    if (this.over) return;
    if (this.dead) {
      // the wreck burns for a moment before the results
      this.deathT += dt;
      this.updateEffects(dt * 0.6);
      this.updateEnemies(dt * 0.25);
      if (this.deathT > 1.8) this.over = true;
      return;
    }
    this.t += dt;
    this.updatePlayer(dt);
    this.updateWeapons(dt);
    this.director(dt);
    this.updateEnemies(dt);
    if (this.boss) this.updateBoss(this.boss, dt);
    this.updateProjectiles(dt);
    this.collide();
    this.updateLoot(dt);
    this.updateEffects(dt);
  }

  /* ---------------- player ---------------- */

  private applyStage(first = false) {
    const S = STAGES[this.stage];
    const hpBonus = (this.level - 1) * 6;
    const shBonus = (this.level - 1) * 4;
    const oldMax = this.maxHp;
    this.maxHp = S.hp + hpBonus;
    this.maxShield = S.shield + shBonus;
    if (!first) this.hp = Math.min(this.maxHp, this.hp + (this.maxHp - oldMax));
    this.specialMax = S.special === 0 ? 16 : S.special === 1 ? 20 : 22;
  }

  private updatePlayer(dt: number) {
    const S = STAGES[this.stage];
    const max = 430 + this.stage * 14;
    let dx = 0;
    let dy = 0;
    if (this.input.drag) {
      // follow the finger / mouse (relative drag), with a little lag so it feels physical
      dx = clamp((this.input.tx - this.px) * 11, -max * 1.5, max * 1.5);
      dy = clamp((this.input.ty - this.py) * 11, -max * 1.5, max * 1.5);
    } else {
      const ix = this.input.x;
      const iy = this.input.y;
      const l = Math.hypot(ix, iy) || 1;
      dx = (ix / l) * max * Math.min(1, Math.hypot(ix, iy));
      dy = (iy / l) * max * Math.min(1, Math.hypot(ix, iy));
    }
    // accelerate towards the wanted velocity (and ease off when let go)
    const k = Math.min(1, dt * (this.input.drag ? 14 : 9));
    this.vx += (dx - this.vx) * k;
    this.vy += (dy - this.vy) * k;
    this.px = clamp(this.px + this.vx * dt, 24, W - 24);
    this.py = clamp(this.py + this.vy * dt, 110, H - 46);
    this.bank += (clamp(this.vx / max, -1, 1) - this.bank) * Math.min(1, dt * 8);

    // shield: regenerates after a short pause without damage
    if (this.shieldWait > 0) this.shieldWait -= dt;
    else this.shield = Math.min(this.maxShield, this.shield + S.regen * dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.hurt = Math.max(0, this.hurt - dt);
    this.shieldHit = Math.max(0, this.shieldHit - dt);
    this.evolveFx = Math.max(0, this.evolveFx - dt);
    this.weaponBoost = Math.max(0, this.weaponBoost - dt);
    this.rapid = Math.max(0, this.rapid - dt);
    this.dmgBoost = Math.max(0, this.dmgBoost - dt);
    this.invincible = Math.max(0, this.invincible - dt);
    for (let i = this.tempDrones.length - 1; i >= 0; i--) if ((this.tempDrones[i] -= dt) <= 0) this.tempDrones.splice(i, 1);

    // engine exhaust
    if (!this.lite || Math.random() < 0.5) {
      const sc = 1;
      for (const [nx, ny, nw] of S.nozzles) {
        const p = this.part();
        p.kind = 1;
        p.x = this.px + nx * sc * Math.cos(this.bank * 0.3) + rand(-nw * 0.25, nw * 0.25);
        p.y = this.py + (this.tail || ny * sc) + 4;
        p.vx = rand(-20, 20) - this.vx * 0.1;
        p.vy = rand(160, 260);
        p.max = p.life = rand(0.12, 0.26);
        p.size = nw * sc * 0.55;
        p.grow = -2;
        p.color = S.flame;
        p.drag = 0;
      }
    }

    // distance and distance XP
    this.speed = 150 + Math.min(90, this.level * 3);
    this.scroll += this.speed * dt;
    this.distance += this.speed * dt;
    this.distXp += this.speed * dt;
    if (this.distXp >= 50) {
      this.distXp -= 50;
      this.gainXp(1);
    }
    this.score += this.speed * dt * 0.1;
  }

  damagePlayer(amount: number) {
    if (this.dead || this.invuln > 0 || this.invincible > 0 || this.evolveFx > 1.2) return;
    const dmg = Math.max(1, Math.round(amount));
    this.shieldWait = 2.6;
    if (this.shield > 0) {
      const taken = Math.min(this.shield, dmg);
      this.shield -= taken;
      this.shieldHit = 0.35;
      this.invuln = 0.18;
      this.sfx.hurt(true);
      this.ring(this.px, this.py, 0.3, STAGES[this.stage].size * 0.55, STAGES[this.stage].size * 0.8, "rgba(110,220,255,1)", 2);
      if (taken >= dmg) return;
      this.hp -= dmg - taken;
    } else this.hp -= dmg;
    this.invuln = 0.75;
    this.hurt = 0.45;
    this.shake = Math.max(this.shake, 7);
    this.sfx.hurt(false);
    this.sparks(this.px, this.py, 10, "rgba(255,200,140,1)", 200);
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      this.sfx.beam(false);
      this.beam = 0;
      this.explode(this.px, this.py, 3, 4);
      this.screenFlash = 0.5;
    }
  }

  gainXp(n: number) {
    this.xp += n;
    while (this.xp >= this.next) {
      this.xp -= this.next;
      this.level++;
      this.next = xpToNext(this.level);
      this.levelUp();
    }
  }

  /** automatic upgrades: a little of everything each level, a new ship every few levels */
  private levelUp() {
    const prev = this.stage;
    this.stage = stageForLevel(this.level);
    const L = this.level;
    this.power += 0.05;
    let sub = "Damage +5%";
    if (L % 2 === 0) {
      this.rateMul += 0.035;
      sub += " · Fire rate +";
    }
    if (L % 3 === 0) {
      this.missiles = Math.min(40, this.missiles + 4);
      this.magnet += 6;
      sub += " · +4 missiles";
    }
    // beyond the last stage: modular Mk upgrades every 3 levels
    if (this.stage === STAGES.length - 1 && L > STAGES[STAGES.length - 1].level && (L - STAGES[STAGES.length - 1].level) % 3 === 0) {
      const mk = (L - STAGES[STAGES.length - 1].level) / 3;
      if (mk % 2 === 1 && this.extraDrones < 2) {
        this.extraDrones++;
        sub = `Mk ${mk + 1} · extra combat drone`;
      } else {
        this.extraSalvo += 2;
        this.power += 0.1;
        sub = `Mk ${mk + 1} · bigger missile salvos · damage +10%`;
      }
    }
    this.applyStage();
    this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.15);
    this.shield = this.maxShield;
    if (this.stage !== prev) {
      this.evolveFx = 1.6;
      this.hp = this.maxHp;
      this.banner(`EVOLVED · ${STAGES[this.stage].name.toUpperCase()}`, this.evolveText(), STAGES[this.stage].accent, true);
      this.ring(this.px, this.py, 0.8, 20, 260, "rgba(255,255,255,1)", 4);
      this.sparks(this.px, this.py, 60, "rgba(200,240,255,1)", 340);
      this.screenFlash = 0.25;
      this.sfx.level(true);
    } else {
      this.banner(`LEVEL ${L}`, sub, "#7fe3ff", false);
      this.ring(this.px, this.py, 0.6, 20, 140, "rgba(127,227,255,1)", 3);
      this.sparks(this.px, this.py, 26, "rgba(127,227,255,1)", 240);
      this.sfx.level(false);
    }
    if (L >= this.nextBossLevel && !this.boss && !this.bossPending) {
      this.bossPending = 6;
      this.nextBossLevel += BOSS_EVERY;
    }
  }

  private evolveText() {
    return ["", "Side cannons · faster fire", "Missile launchers · wide fire · shield generator", "Heavy cannons · auto missiles · armour", "Weapon pods · combat drone · laser beam", "Missile barrages · twin drones · mega beam"][this.stage];
  }

  banner(text: string, sub: string, color: string, big: boolean) {
    this.banners.push({ text, sub, color, t: 0, life: big ? 2.6 : 1.6, big });
    if (this.banners.length > 3) this.banners.shift();
  }

  /* ---------------- weapons ---------------- */

  private updateWeapons(dt: number) {
    const S = STAGES[this.stage];
    const sc = S.size / 64;
    const T = TIERS[this.tier];
    const mul = this.power * (this.dmgBoost > 0 ? 2 : 1);
    this.muzzle = Math.max(0, this.muzzle - dt);
    // primary: automatic
    this.fireT -= dt;
    if (this.fireT <= 0) {
      this.fireT = T.rate / ((this.rapid > 0 ? 1.6 : 1) * this.rateMul);
      for (const s of T.streams) this.shoot(this.px + s.x * sc, this.py - S.size * 0.42, s.a + this.bank * 0.04, s.kind, T.dmg * mul);
      this.muzzle = 0.06;
      this.sfx.shot(T.streams[0].kind);
    }
    if (T.shells) {
      this.shellT -= dt;
      if (this.shellT <= 0) {
        this.shellT = T.shells.rate / this.rateMul;
        const sh = this.shoot(this.px, this.py - S.size * 0.45, 0, 5, T.shells.dmg * mul);
        if (sh) sh.aoe = T.shells.aoe;
      }
    }
    // drones: orbit the ship and shoot at the nearest enemy
    const nd = this.drones;
    if (nd > 0) {
      this.droneT -= dt;
      if (this.droneT <= 0) {
        this.droneT = 0.32;
        for (let i = 0; i < nd; i++) {
          const d = this.dronePos(i);
          const tg = this.nearest(d.x, d.y, 520);
          const ax = tg ? tg.x : d.x;
          const ay = tg ? tg.y : d.y - 400;
          const a = Math.atan2(ax - d.x, -(ay - d.y));
          this.shoot(d.x, d.y - 8, a, 0, 8 * mul);
        }
      }
    }
    // automatic mini missiles (heavy assault +)
    if (S.autoMissiles > 0) {
      this.autoT -= dt;
      if (this.autoT <= 0) {
        this.autoT = 2.4;
        if (this.anyTarget()) this.salvoFire(S.autoMissiles, true);
      }
    }
    // manual weapons
    if (this.wants.missile) {
      this.wants.missile = false;
      if (this.missiles > 0) {
        this.missiles--;
        this.salvoFire(this.salvo, false);
        this.sfx.missile();
      }
    }
    if (this.wants.bomb) {
      this.wants.bomb = false;
      if (this.bombs > 0) {
        const b = this.bombsOut.find((x) => !x.alive);
        if (b) {
          this.bombs--;
          b.alive = true;
          b.x = this.px;
          b.y = this.py - 30;
          b.vy = -420;
          b.t = 0;
          this.sfx.bomb();
        }
      }
    }
    if (this.wants.special) {
      this.wants.special = false;
      if (this.special <= 0) {
        this.special = this.specialMax;
        const kind = S.special;
        if (kind === 0 || kind === 2) this.nova();
        if (kind >= 1) {
          this.beam = kind === 2 ? 3.6 : 3;
          this.beamWidth = kind === 2 ? 58 : 38;
          this.sfx.beam(true);
        }
      }
    }
    this.special = Math.max(0, this.special - dt);
    if (this.beam > 0) {
      this.beam -= dt;
      const dps = (STAGES[this.stage].special === 2 ? 320 : 230) * mul;
      this.beamDamage(dps * dt);
      if (this.beam <= 0) this.sfx.beam(false);
    }
  }

  dronePos(i: number) {
    const n = this.drones;
    const a = this.t * 1.6 + (i / Math.max(1, n)) * TAU;
    const R = STAGES[this.stage].size * 0.62;
    return { x: this.px + Math.cos(a) * R, y: this.py + Math.sin(a) * R * 0.55 + 6 };
  }

  private shoot(x: number, y: number, a: number, kind: ShotKind, dmg: number) {
    let s: Shot | null = null;
    for (let i = 0; i < this.shots.length; i++) {
      const k = (this.pi + i) % this.shots.length;
      if (!this.shots[k].alive) {
        s = this.shots[k];
        this.pi = k + 1;
        break;
      }
    }
    if (!s) return null; // capped: no runaway projectiles
    const sp = SHOT_SPEED[kind];
    s.alive = true;
    s.x = x;
    s.y = y;
    s.vx = Math.sin(a) * sp;
    s.vy = -Math.cos(a) * sp;
    s.dmg = dmg;
    s.kind = kind;
    s.pierce = kind === 4 ? 3 : 0;
    s.aoe = 0;
    s.h0 = s.h1 = s.h2 = 0;
    return s;
  }

  private salvoFire(n: number, mini: boolean) {
    // spread targets: each missile takes a different enemy when it can
    const taken: number[] = [];
    for (let i = 0; i < n; i++) {
      const m = this.pmissiles.find((x) => !x.alive);
      if (!m) return;
      const side = i % 2 ? 1 : -1;
      m.alive = true;
      m.x = this.px + side * (14 + (i >> 1) * 6);
      m.y = this.py + 4;
      m.vx = side * rand(140, 220);
      m.vy = rand(-40, 60);
      m.t = 0;
      m.mini = mini;
      m.dmg = (mini ? 22 : 46) * this.power * (this.dmgBoost > 0 ? 2 : 1);
      m.target = this.pickTarget(m.x, m.y, taken);
      m.tid = m.target?.id ?? 0;
      m.boss = !m.target && !!this.boss && this.boss.entering <= 0;
      if (m.target) taken.push(m.target.id);
    }
  }

  private pickTarget(x: number, y: number, taken: number[]) {
    let best: Enemy | null = null;
    let bd = Infinity;
    for (const e of this.enemies) {
      if (!e.alive || e.y < -20 || e.y > H) continue;
      const d = (e.x - x) ** 2 + (e.y - y) ** 2 + (taken.includes(e.id) ? 4e5 : 0) - e.max * 30;
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  private nearest(x: number, y: number, range: number) {
    let best: Enemy | null = null;
    let bd = range * range;
    for (const e of this.enemies) {
      if (!e.alive || e.y < 0) continue;
      const d = (e.x - x) ** 2 + (e.y - y) ** 2;
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    if (!best && this.boss && this.boss.entering <= 0 && this.boss.dying <= 0) return { x: this.boss.x, y: this.boss.y } as Enemy;
    return best;
  }

  private anyTarget() {
    return (this.boss && this.boss.entering <= 0) || this.enemies.some((e) => e.alive && e.y > 0);
  }

  /** the energy blast: hurts everything around the ship and wipes nearby enemy fire */
  private nova() {
    const R = 230;
    this.sfx.nova();
    this.ring(this.px, this.py, 0.55, 20, R, "rgba(150,220,255,1)", 6);
    this.ring(this.px, this.py, 0.7, 10, R * 0.8, "rgba(255,255,255,1)", 3);
    this.flash(this.px, this.py, 0.35, R * 0.7, "rgba(140,200,255,1)");
    this.shake = Math.max(this.shake, 8);
    const dmg = 90 * this.power;
    for (const e of this.enemies) if (e.alive && (e.x - this.px) ** 2 + (e.y - this.py) ** 2 < (R + e.r) ** 2) this.hitEnemy(e, dmg, e.x, e.y, true);
    for (const b of this.bullets) if (b.alive && (b.x - this.px) ** 2 + (b.y - this.py) ** 2 < R * R) this.popBullet(b);
    if (this.boss && Math.hypot(this.boss.x - this.px, this.boss.y - this.py) < R + this.boss.rx) this.hitBoss(this.boss, dmg, this.boss.x, this.boss.y + this.boss.ry * 0.5, false);
  }

  private beamDamage(d: number) {
    const half = this.beamWidth / 2;
    for (const e of this.enemies) {
      if (!e.alive || e.y > this.py || Math.abs(e.x - this.px) > half + e.r) continue;
      this.hitEnemy(e, d, e.x, e.y, false);
    }
    for (const b of this.bullets) if (b.alive && b.y < this.py && Math.abs(b.x - this.px) < half) this.popBullet(b);
    const B = this.boss;
    if (B && B.entering <= 0 && B.dying <= 0 && Math.abs(B.x - this.px) < half + B.rx * 0.8) {
      for (const p of B.parts) if (p.alive && Math.abs(B.x + p.ox - this.px) < half + p.r) this.hitPart(B, p, d * 0.6);
      this.hitBoss(B, d, this.px, B.y + B.ry * 0.6, false);
    }
    if (Math.random() < 0.5) this.sparks(this.px + rand(-half, half) * 0.5, this.py - rand(40, 500), 1, "rgba(255,220,255,1)", 120);
  }

  /* ---------------- director: what comes next ---------------- */

  private threat() {
    let t = 0;
    for (const e of this.enemies) if (e.alive) t += e.def.threat;
    return t;
  }

  private director(dt: number) {
    const D = difficulty(this.level);
    // region cross-fade
    this.regionFade = Math.max(0, this.regionFade - dt / 3);
    // boss sequence: clear the field, warn, then the boss arrives
    if (this.bossPending > 0) {
      this.bossPending -= dt;
      if ((this.threat() === 0 || this.bossPending <= 0) && this.bossWarn <= 0) {
        this.bossWarn = 2.8;
        this.bossPending = 0;
        const kind = this.bossesDown % 4;
        this.banner("WARNING", `${BOSS_NAMES[kind]} approaching`, "#ff5a4a", true);
        this.sfx.warning();
      }
      return;
    }
    if (this.bossWarn > 0) {
      this.bossWarn -= dt;
      if (this.bossWarn <= 0) this.spawnBoss();
      return;
    }
    if (this.boss) return;

    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = D.spawn * rand(0.7, 1.3);
      if (this.threat() < D.threat) this.spawnSome();
    }
    // occasional asteroid fields (more often in the belt)
    this.eventT -= dt;
    if (this.eventT <= 0) {
      this.eventT = rand(28, 42) / (REGIONS[this.region].favour.rock ?? 1);
      for (let i = 0; i < 7 + Math.min(8, this.level >> 1); i++) this.delaySpawn(i * 0.35, Math.random() < 0.7 ? "rockS" : this.level >= 3 ? "rockSplit" : "rockL");
    }
    // a mothership now and then
    if (this.level >= ENEMIES.mother.from) {
      this.motherT -= dt;
      if (this.motherT <= 0) {
        this.motherT = rand(60, 80);
        if (!this.enemies.some((e) => e.alive && e.kind === "mother")) this.spawn("mother", W / 2, -90);
      }
    }
  }

  private queue: { t: number; kind: EnemyKind }[] = [];
  private delaySpawn(t: number, kind: EnemyKind) {
    this.queue.push({ t, kind });
  }

  private spawnSome() {
    const fav = REGIONS[this.region].favour;
    let total = 0;
    for (const k of ENEMY_KINDS) {
      const d = ENEMIES[k];
      if (d.weight <= 0 || this.level < d.from) continue;
      total += d.weight * (fav[d.family] ?? 1);
    }
    let pick = Math.random() * total;
    let kind: EnemyKind = "dart";
    for (const k of ENEMY_KINDS) {
      const d = ENEMIES[k];
      if (d.weight <= 0 || this.level < d.from) continue;
      pick -= d.weight * (fav[d.family] ?? 1);
      if (pick <= 0) {
        kind = k;
        break;
      }
    }
    const def = ENEMIES[kind];
    if (kind === "wing") {
      // a V formation
      const cx = rand(120, W - 120);
      const side = Math.random() < 0.5 ? -1 : 1;
      for (let i = 0; i < (def.group ?? 5); i++) {
        const e = this.spawn(kind, cx, -30 - Math.abs(i - 2) * 34);
        if (e) {
          e.ox = cx + (i - 2) * 34;
          e.p1 = side;
        }
      }
      return;
    }
    if (kind === "drone") {
      const cx = rand(60, W - 60);
      for (let i = 0; i < (def.group ?? 6); i++) this.spawn(kind, cx + rand(-50, 50), -20 - i * 22);
      return;
    }
    this.spawn(kind, rand(40, W - 40), -def.r - 10);
  }

  spawn(kind: EnemyKind, x: number, y: number): Enemy | null {
    const e = this.enemies.find((q) => !q.alive);
    if (!e) return null;
    const def = ENEMIES[kind];
    const D = difficulty(this.level);
    e.alive = true;
    e.id = this.enemyId++;
    e.kind = kind;
    e.def = def;
    e.variant = Math.floor(Math.random() * ROCK_VARIANTS);
    e.x = x;
    e.y = y;
    e.r = def.r;
    e.max = e.hp = def.hp * D.hp * (kind === "mother" ? 1 + this.bossesDown * 0.4 : 1);
    e.t = 0;
    e.fire = rand(0.8, 2.2);
    e.a = Math.random() * TAU;
    e.spin = rand(-1.2, 1.2);
    e.hit = 0;
    e.ox = x;
    e.p1 = rand(0, TAU);
    e.p2 = 0;
    e.state = 0;
    e.armor = kind === "brute" || kind === "rockIron" ? 0.55 : kind === "tank" ? 0.75 : 1;
    e.dmgMul = D.dmg;
    e.fireMul = D.fire;
    const sp = def.speed * D.speed;
    e.vx = 0;
    e.vy = sp;
    if (def.family === "rock") {
      e.vx = rand(-40, 40);
      e.vy = sp * rand(0.7, 1.2);
    }
    if (kind.startsWith("mine")) e.vy = 0;
    if (kind === "gunner" || kind === "spitter" || kind === "launcher") e.p2 = rand(130, 300); // where it stops
    if (kind === "mother") e.p2 = 150;
    return e;
  }

  /* ---------------- enemies ---------------- */

  private updateEnemies(dt: number) {
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const q = this.queue[i];
      q.t -= dt;
      if (q.t <= 0) {
        this.queue.splice(i, 1);
        if (!this.boss) this.spawn(q.kind, rand(30, W - 30), -50);
      }
    }
    const D = difficulty(this.level);
    const scroll = this.speed * 0.55;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      e.t += dt;
      e.hit = Math.max(0, e.hit - dt);
      const sp = e.def.speed * D.speed;
      switch (e.kind) {
        case "dart":
          e.y += e.vy * dt;
          e.x += Math.sin(e.t * 3 + e.p1) * 60 * dt;
          if (this.reload(e, dt, 2.6) && e.y > 30 && e.y < H * 0.6) this.aimed(e, 1, 260, 9);
          break;
        case "wing":
          e.y += sp * 0.75 * dt;
          e.x = e.ox + Math.sin(e.t * 1.7) * 110 * e.p1;
          if (this.reload(e, dt, 3.6) && e.y > 40) this.fireAt(e.x, e.y + 12, Math.PI / 2, 1, 230, 8, e.dmgMul);
          break;
        case "gunner":
        case "spitter":
        case "launcher": {
          // fly in, hold a line and strafe, then leave
          if (e.state === 0) {
            e.y += sp * dt;
            if (e.y >= e.p2) e.state = 1;
          } else if (e.state === 1) {
            e.x = clamp(e.ox + Math.sin(e.t * 0.8 + e.p1) * 130, 40, W - 40);
            if (e.t > 12) e.state = 2;
          } else e.y += sp * 1.2 * dt;
          if (e.state === 1 && this.reload(e, dt, e.kind === "gunner" ? 2.1 : e.kind === "spitter" ? 1.8 : 3)) {
            if (e.kind === "gunner") for (let k = 0; k < 3; k++) this.aimed(e, 0, 250, 9, (k - 1) * 0.12);
            else if (e.kind === "spitter") for (let k = 0; k < 3; k++) this.aimed(e, 2, 200, 10, (k - 1) * 0.22);
            else {
              this.enemyMissile(e.x - 14, e.y + 10, e.dmgMul);
              this.enemyMissile(e.x + 14, e.y + 10, e.dmgMul);
            }
          }
          break;
        }
        case "tank":
          e.y += sp * dt;
          if (this.reload(e, dt, 2.8) && e.y > 20) for (let k = -1; k <= 1; k++) this.fireAt(e.x + k * 9, e.y + 30, Math.PI / 2 + k * 0.22, 4, 190, 14, e.dmgMul);
          break;
        case "kamikaze":
          if (e.state === 0) {
            e.y += sp * dt;
            if (e.y > 90 + e.p1 * 15) {
              e.state = 1;
              e.p2 = 0.65; // warning: it flashes, then dives at you
            }
          } else if (e.state === 1) {
            e.p2 -= dt;
            e.y += 20 * dt;
            if (e.p2 <= 0) {
              const a = Math.atan2(this.py - e.y, this.px - e.x);
              e.vx = Math.cos(a) * 470 * D.speed;
              e.vy = Math.sin(a) * 470 * D.speed;
              e.state = 2;
            }
          } else {
            e.x += e.vx * dt;
            e.y += e.vy * dt;
            if (!this.lite) this.trail(e.x, e.y, "rgba(255,90,60,1)");
          }
          break;
        case "flyer":
          e.y += sp * dt;
          e.x = clamp(e.ox + Math.sin(e.t * 2 + e.p1) * 80, 20, W - 20);
          break;
        case "swift":
          e.y += sp * 0.8 * dt;
          if ((e.p2 -= dt) <= 0) {
            e.p2 = rand(0.5, 1);
            e.vx = rand(-1, 1) * sp;
          }
          e.x = clamp(e.x + e.vx * dt, 20, W - 20);
          break;
        case "brute":
          e.y += sp * dt;
          if (this.reload(e, dt, 3.2) && e.y > 30) for (let k = 0; k < 5; k++) this.fireAt(e.x, e.y + 20, Math.PI / 2 + (k - 2) * 0.3, 4, 150, 16, e.dmgMul);
          break;
        case "drone": {
          // swarm: steer at the player for a while, then peel off
          const tx = e.t < 9 ? this.px : e.x + (e.x < W / 2 ? -1 : 1) * 200;
          const ty = e.t < 9 ? this.py : H + 100;
          const a = Math.atan2(ty - e.y, tx - e.x);
          e.vx += Math.cos(a) * 420 * dt;
          e.vy += Math.sin(a) * 420 * dt;
          const v = Math.hypot(e.vx, e.vy);
          if (v > sp) {
            e.vx = (e.vx / v) * sp;
            e.vy = (e.vy / v) * sp;
          }
          e.x += e.vx * dt;
          e.y += e.vy * dt;
          break;
        }
        case "platform":
          e.y += 45 * dt;
          if (this.reload(e, dt, 3.6) && e.y > 30) {
            this.enemyMissile(e.x - 8, e.y + 12, e.dmgMul);
            this.enemyMissile(e.x + 8, e.y + 12, e.dmgMul);
          }
          break;
        case "mother": {
          if (e.y < e.p2) e.y += 60 * dt;
          else e.x = W / 2 + Math.sin(e.t * 0.35) * 140;
          const f = e.hp / e.max;
          if (this.reload(e, dt, f > 0.6 ? 1.6 : 1.1)) {
            this.fireAt(e.x - 64, e.y + 22, Math.atan2(this.py - e.y, this.px - e.x + 64), 0, 240, 10, e.dmgMul);
            this.fireAt(e.x + 64, e.y + 22, Math.atan2(this.py - e.y, this.px - e.x - 64), 0, 240, 10, e.dmgMul);
            if (f < 0.35) for (let k = 0; k < 10; k++) this.fireAt(e.x, e.y, (k / 10) * TAU + e.t, 2, 170, 9, e.dmgMul);
          }
          // launch fighters from the hangars
          e.state -= dt;
          if (e.state <= 0 && e.y >= e.p2) {
            e.state = f > 0.5 ? 5 : 3.5;
            for (const s of [-1, 1]) {
              const d = this.spawn("dart", e.x + s * 45, e.y + 24);
              if (d) d.vy *= 0.9;
            }
          }
          if (e.t > 60) e.y += 80 * dt;
          break;
        }
        case "mineProx":
        case "mineMini":
        case "mineCluster":
          e.y += scroll * dt + e.vy * dt;
          e.x += e.vx * dt;
          e.vx *= 0.97;
          e.vy *= 0.97;
          e.a += e.spin * dt * 0.3;
          if (e.state === 0 && (e.x - this.px) ** 2 + (e.y - this.py) ** 2 < (e.kind === "mineCluster" ? 140 : 105) ** 2) {
            e.state = 1;
            e.p2 = 0.7;
          }
          if (e.state === 1) {
            e.p2 -= dt;
            if (e.p2 <= 0) this.killEnemy(e, false);
          }
          break;
        case "mine":
          e.y += scroll * dt;
          e.a += e.spin * dt * 0.3;
          break;
        case "mineMove":
          e.y += scroll * 0.8 * dt;
          e.x = clamp(e.ox + Math.sin(e.t * 1.3 + e.p1) * 120, 20, W - 20);
          break;
        default:
          // rocks drift and tumble
          e.x += e.vx * dt;
          e.y += e.vy * dt;
          e.a += e.spin * dt;
          if (e.x < e.r * 0.5 || e.x > W - e.r * 0.5) e.vx = -e.vx;
      }
      if (e.y > H + 120 || e.y < -400 || e.x < -150 || e.x > W + 150) e.alive = false;
    }
  }

  private reload(e: Enemy, dt: number, every: number) {
    e.fire -= dt * e.fireMul;
    if (e.fire <= 0) {
      e.fire = every * rand(0.85, 1.15);
      return true;
    }
    return false;
  }

  private aimed(e: Enemy, kind: number, speed: number, dmg: number, off = 0) {
    this.fireAt(e.x, e.y + e.r * 0.6, Math.atan2(this.py - e.y, this.px - e.x) + off, kind, speed, dmg, e.dmgMul);
  }

  /** enemy fire (capped by the pool) */
  fireAt(x: number, y: number, a: number, kind: number, speed: number, dmg: number, dmgMul = 1) {
    const b = this.bullets.find((q) => !q.alive);
    if (!b) return null;
    const D = difficulty(this.level);
    b.alive = true;
    b.x = x;
    b.y = y;
    b.vx = Math.cos(a) * speed * D.shot;
    b.vy = Math.sin(a) * speed * D.shot;
    b.r = kind === 4 ? 8 : kind === 1 ? 3.5 : kind === 5 ? 7 : kind === 3 ? 5 : 5;
    b.dmg = dmg * dmgMul;
    b.kind = kind;
    b.t = 0;
    b.life = kind === 3 || kind === 5 ? 5 : 8;
    b.hp = kind === 3 || kind === 5 ? 12 : 0;
    return b;
  }

  private enemyMissile(x: number, y: number, dmgMul: number) {
    this.fireAt(x, y, Math.PI / 2, 3, 150, 14, dmgMul);
  }

  private trail(x: number, y: number, color: string) {
    const p = this.part();
    p.kind = 1;
    p.x = x + rand(-3, 3);
    p.y = y + rand(-3, 3);
    p.vx = rand(-15, 15);
    p.vy = rand(-15, 15);
    p.max = p.life = rand(0.2, 0.35);
    p.size = rand(2.5, 4);
    p.grow = -4;
    p.color = color;
    p.drag = 0;
  }

  hitEnemy(e: Enemy, dmg: number, x: number, y: number, showNumber: boolean) {
    if (!e.alive) return;
    const d = dmg * e.armor;
    e.hp -= d;
    e.hit = 0.07;
    if (showNumber && d >= 20) this.popup(x, y - e.r, `${Math.round(d)}`, "#ffe9a8", 13);
    if (e.hp <= 0) this.killEnemy(e, true);
  }

  private killEnemy(e: Enemy, byPlayer: boolean) {
    if (!e.alive) return;
    e.alive = false;
    const def = e.def;
    const pal = familyPalette(def.family);
    this.explode(e.x, e.y, def.size, pal, def.r);
    const L = this.level;
    if (byPlayer) {
      this.kills++;
      this.score += def.score * (1 + 0.05 * (L - 1));
      this.gainXp(Math.round(def.xp * (1 + 0.08 * (L - 1))));
      this.sfx.boom(def.size);
      // loot: crystals, and sometimes a pickup (bigger enemies drop more)
      const ores = def.family === "rock" ? 1 + def.size * 2 : def.size;
      for (let i = 0; i < ores; i++) this.dropOre(e.x, e.y);
      const chance = [0.035, 0.1, 0.26, 1][def.size];
      if (Math.random() < chance) this.dropPickup(e.x, e.y, def.size >= 2 ? 1 : 0);
      if (def.size === 3) this.dropPickup(e.x + 20, e.y, 2);
    } else this.sfx.boom(Math.min(1, def.size));
    // special deaths
    if (e.kind === "rockSplit") {
      for (let i = 0; i < 3; i++) {
        const c = this.spawn("rockS", e.x + rand(-12, 12), e.y + rand(-12, 12));
        if (c) {
          const a = (i / 3) * TAU + rand(-0.3, 0.3);
          c.vx = Math.cos(a) * 120;
          c.vy = Math.abs(Math.sin(a)) * 90 + 60;
          c.max = c.hp = c.hp * 0.7;
        }
      }
    }
    if (e.kind === "mineCluster") {
      for (let i = 0; i < 4; i++) {
        const c = this.spawn("mineMini", e.x, e.y);
        if (c) {
          const a = (i / 4) * TAU + Math.PI / 4;
          c.vx = Math.cos(a) * 160;
          c.vy = Math.sin(a) * 160;
        }
      }
    }
    if (e.kind === "rockBoom" || e.kind.startsWith("mine")) {
      // an explosion that hurts anything close, you included
      const R = e.kind === "rockBoom" ? 110 : e.kind === "mineMini" ? 55 : 85;
      this.ring(e.x, e.y, 0.45, 10, R, "rgba(255,150,70,1)", 5);
      this.shake = Math.max(this.shake, 5);
      if ((this.px - e.x) ** 2 + (this.py - e.y) ** 2 < R * R) this.damagePlayer(28 * e.dmgMul);
      for (const o of this.enemies) if (o.alive && o !== e && (o.x - e.x) ** 2 + (o.y - e.y) ** 2 < R * R) this.hitEnemy(o, 60, o.x, o.y, false);
    }
  }

  /* ---------------- bosses ---------------- */

  private spawnBoss() {
    const kind = this.bossesDown % 4;
    const tier = Math.floor(this.bossesDown / 4);
    const D = difficulty(this.level);
    const hp = BOSS_HP[kind] * (1 + tier * 0.6) * (0.55 + 0.45 * D.hp);
    const parts: BossPart[] = [];
    const add = (kind: BossPart["kind"], ox: number, oy: number, r: number, hpp: number) => parts.push({ kind, ox, oy, r, hp: hpp, max: hpp, alive: true, a: Math.PI / 2, fire: rand(0.5, 2), hit: 0 });
    let core = { ox: 0, oy: 6, r: 20 };
    let rx = 140;
    let ry = 80;
    if (kind === 0) {
      for (const x of [-110, -50, 50, 110]) add("turret", x, x === -50 || x === 50 ? -34 : 2, 14, hp * 0.12);
      core = { ox: 0, oy: 6, r: 18 };
      rx = 146;
      ry = 86;
    } else if (kind === 1) {
      core = { ox: 0, oy: 18, r: 24 };
      rx = 116;
      ry = 96;
    } else if (kind === 2) {
      for (const [x, y] of [[-70, -64], [70, -64], [-150, -10], [150, -10], [-60, 60], [60, 60]]) add("turret", x, y, 14, hp * 0.07);
      add("bay", -112, 34, 18, hp * 0.1);
      add("bay", 112, 34, 18, hp * 0.1);
      core = { ox: 0, oy: -10, r: 18 };
      rx = 184;
      ry = 106;
    } else {
      for (const [x, y] of [[-96, -40], [96, -40], [-60, 54], [60, 54]]) add("crystal", x, y, 16, hp * 0.09);
      core = { ox: 0, oy: 0, r: 22 };
      rx = 160;
      ry = 130;
    }
    this.boss = {
      kind,
      tier,
      name: BOSS_NAMES[kind] + (tier ? ` Mk ${tier + 1}` : ""),
      x: W / 2,
      y: -220,
      hp,
      max: hp,
      t: 0,
      phase: 0,
      entering: 3,
      dying: 0,
      hit: 0,
      parts,
      core,
      rx,
      ry,
      atkA: 2,
      atkB: 4,
      atkC: 7,
      spiral: 0,
      charge: 0,
      chargeY: 0,
      lunge: 0,
      lasers: [0, 1, 2].map(() => ({ alive: false, vertical: true, pos: 0, width: 30, t: 0, warn: 1, fire: 1 })),
      dmgAcc: 0,
      dmgT: 0,
    };
  }

  private updateBoss(B: Boss, dt: number) {
    B.t += dt;
    B.hit = Math.max(0, B.hit - dt);
    for (const p of B.parts) p.hit = Math.max(0, p.hit - dt);
    // damage numbers: added up, shown a few times a second
    B.dmgT -= dt;
    if (B.dmgT <= 0 && B.dmgAcc >= 5) {
      this.popup(B.x + rand(-40, 40), B.y + B.ry * 0.5, `${Math.round(B.dmgAcc)}`, "#ffd27a", 14);
      B.dmgAcc = 0;
      B.dmgT = 0.25;
    }
    if (B.dying > 0) {
      B.dying -= dt;
      B.y += 14 * dt;
      if (Math.random() < dt * 14) this.explode(B.x + rand(-B.rx, B.rx) * 0.8, B.y + rand(-B.ry, B.ry) * 0.8, Math.random() < 0.3 ? 2 : 1, B.kind === 1 ? 2 : 0);
      if (B.dying <= 0) this.bossDefeated(B);
      return;
    }
    const restY = B.kind === 2 ? 205 : B.kind === 3 ? 225 : 215; // clear of the HUD
    if (B.entering > 0) {
      // a slow, menacing entrance
      B.entering -= dt;
      B.y += (restY - B.y) * Math.min(1, dt * 1.4);
      return;
    }
    const f = B.hp / B.max;
    B.phase = f > 0.66 ? 0 : f > 0.33 ? 1 : 2;
    // tougher as it weakens, a bit faster each cycle, never a bullet wall without gaps
    const I = Math.min(1.9, 1 + B.phase * 0.3 + B.tier * 0.12);
    const D = difficulty(this.level);
    const dm = D.dmg;
    // movement (the Leviathan's lunge overrides)
    if (B.lunge > 0) {
      // hold still while the warning shows
    } else if (B.charge > 0) {
      B.charge -= dt;
      const k = 1 - B.charge / 1.2;
      B.y = restY + Math.sin(Math.PI * k) * (B.chargeY - restY);
      if (B.charge <= 0) B.y = restY;
    } else {
      B.x = W / 2 + Math.sin(B.t * (B.kind === 1 ? 0.6 : 0.4)) * (B.kind === 2 ? 70 : 120);
      B.y = restY + Math.sin(B.t * 0.9) * 10;
    }
    // turrets / crystals aim and fire
    for (const p of B.parts) {
      if (!p.alive) continue;
      const x = B.x + p.ox;
      const y = B.y + p.oy;
      p.a = Math.atan2(this.py - y, this.px - x);
      p.fire -= dt * I * D.fire * 0.7;
      if (p.fire > 0) continue;
      if (p.kind === "turret") {
        p.fire = B.kind === 0 ? 2.3 : 2.8;
        for (let k = 0; k < 3; k++) this.fireAt(x + Math.cos(p.a) * 16, y + Math.sin(p.a) * 16, p.a + (k - 1) * 0.1, 0, 240, 10, dm);
      } else if (p.kind === "bay") {
        p.fire = 5.5;
        for (let k = 0; k < 2 + B.phase; k++) this.fireAt(x + (k - 1) * 10, y + 14, Math.PI / 2 + (k - 1) * 0.3, 3, 140, 14, dm);
      } else {
        p.fire = 2.6;
        this.fireAt(x, y, p.a, 2, 230, 11, dm);
      }
    }
    // each boss's own patterns
    const cx = B.x + B.core.ox;
    const cy = B.y + B.core.oy;
    B.atkA -= dt * I;
    B.atkB -= dt * I;
    B.atkC -= dt * I;
    if (B.kind === 0) {
      if (B.phase >= 1 && B.atkA <= 0) {
        B.atkA = 3.6;
        // a fan with a gap aimed at the player: always dodgeable
        const gap = Math.atan2(this.py - cy, this.px - cx);
        for (let k = 0; k < 16; k++) {
          const a = Math.PI * 0.1 + (k / 15) * Math.PI * 0.8;
          if (Math.abs(a - gap) < 0.22) continue;
          this.fireAt(cx, cy + 20, a, 4, 170, 12, dm);
        }
      }
      if (B.phase >= 2 && B.atkB <= 0) {
        B.atkB = 4.5;
        // a wall of needles with two gaps
        const g1 = rand(60, W / 2 - 40);
        const g2 = rand(W / 2 + 40, W - 60);
        for (let x = 20; x < W; x += 26) if (Math.abs(x - g1) > 40 && Math.abs(x - g2) > 40) this.fireAt(x, B.y + B.ry * 0.6, Math.PI / 2, 1, 200, 10, dm);
      }
    } else if (B.kind === 1) {
      // spiral bursts on and off
      if (B.atkA <= 0) {
        B.atkA = B.phase >= 1 ? 0.12 : 0.16;
        if (Math.floor(B.t / 2.2) % 2 === 0) {
          B.spiral += 0.42;
          const arms = B.phase >= 2 ? 3 : 2;
          for (let k = 0; k < arms; k++) this.fireAt(cx, cy, B.spiral + (k / arms) * TAU, 2, 170, 10, dm);
        }
      }
      if (B.atkB <= 0) {
        B.atkB = 4;
        for (let k = 0; k < 3; k++) this.fireAt(cx + (k - 1) * 40, cy + 30, Math.PI / 2 + (k - 1) * 0.5, 5, 110, 14, dm);
      }
      if (B.phase >= 1 && B.atkC <= 0 && B.charge <= 0) {
        // lunge: a warning band first, then it dives
        B.atkC = 7;
        const L = this.laser(B, true, B.x, B.rx * 1.6, 1.1, 0);
        if (L) {
          B.lunge = 1.1;
          this.sfx.laserWarn();
        }
      }
      if (B.lunge > 0) {
        B.lunge -= dt;
        if (B.lunge <= 0) {
          B.charge = 1.2;
          B.chargeY = H - 260;
        }
      }
    } else if (B.kind === 2) {
      if (B.phase >= 1 && B.atkA <= 0) {
        B.atkA = B.phase >= 2 ? 3.4 : 4.6;
        this.laser(B, true, this.px, 30, 1.1, 0.9);
        if (B.phase >= 2) this.laser(B, true, clamp(this.px + (Math.random() < 0.5 ? -1 : 1) * rand(120, 180), 30, W - 30), 30, 1.1, 0.9);
        this.sfx.laserWarn();
      }
      if (B.atkB <= 0) {
        B.atkB = 3;
        for (let k = 0; k < 5; k++) this.fireAt(cx, cy + 40, Math.PI / 2 + (k - 2) * 0.18, 4, 180, 12, dm);
      }
    } else {
      if (B.atkA <= 0) {
        B.atkA = B.phase >= 2 ? 1.7 : 2.3;
        // a ring with a gap that turns every time
        const n = 22;
        const gap = (B.t * 0.9) % TAU;
        for (let k = 0; k < n; k++) {
          const a = (k / n) * TAU;
          const d = Math.abs(((a - gap + Math.PI * 3) % TAU) - Math.PI);
          if (d < 0.35) continue;
          this.fireAt(cx, cy, a, 2, 160, 11, dm);
        }
      }
      if (B.phase >= 1 && B.atkB <= 0) {
        B.atkB = 0.14;
        if (Math.floor(B.t / 1.8) % 2 === 1) {
          B.spiral -= 0.31;
          this.fireAt(cx, cy, B.spiral, 0, 190, 10, dm);
          this.fireAt(cx, cy, -B.spiral + Math.PI, 0, 190, 10, dm);
        }
      }
      if (B.phase >= 2 && B.atkC <= 0) {
        B.atkC = 6;
        this.laser(B, false, this.py, 34, 1.3, 0.9);
        this.laser(B, true, this.px, 34, 1.3, 0.9);
        this.sfx.laserWarn();
      }
      if (B.t % 11 < dt && B.phase >= 1) for (let i = 0; i < 4; i++) this.spawn("drone", B.x + (i - 1.5) * 50, B.y + 60);
    }
    // telegraphed lasers
    for (const L of B.lasers) {
      if (!L.alive) continue;
      L.t += dt;
      if (L.t > L.warn + L.fire) L.alive = false;
      else if (L.t > L.warn && L.fire > 0) {
        const inside = L.vertical ? Math.abs(this.px - L.pos) < L.width / 2 + 6 : Math.abs(this.py - L.pos) < L.width / 2 + 6;
        if (inside) this.damagePlayer(26 * dm);
      }
    }
    // the Leviathan's body hurts during the lunge
    if (B.charge > 0 && Math.abs(this.px - B.x) < B.rx * 0.8 && Math.abs(this.py - B.y) < B.ry) this.damagePlayer(30 * dm);
  }

  private laser(B: Boss, vertical: boolean, pos: number, width: number, warn: number, fire: number) {
    const L = B.lasers.find((l) => !l.alive);
    if (!L) return null;
    L.alive = true;
    L.vertical = vertical;
    L.pos = pos;
    L.width = width;
    L.t = 0;
    L.warn = warn;
    L.fire = fire;
    return L;
  }

  hitBoss(B: Boss, dmg: number, x: number, y: number, weak: boolean) {
    if (B.entering > 0 || B.dying > 0) return;
    // the weak point takes double; armour plating with live turrets takes a bit less
    const liveParts = B.parts.filter((p) => p.alive).length;
    const d = dmg * (weak ? 2 : liveParts > 0 ? 0.8 : 1);
    B.hp -= d;
    B.hit = 0.06;
    B.dmgAcc += d;
    if (Math.random() < 0.3) this.sparks(x, y, 2, weak ? "rgba(255,240,160,1)" : "rgba(255,200,140,1)", 140);
    if (B.hp <= 0) {
      B.hp = 0;
      B.dying = 2.2;
      B.lasers.forEach((l) => (l.alive = false));
      this.shake = Math.max(this.shake, 10);
      for (const b of this.bullets) if (b.alive) this.popBullet(b);
    }
  }

  private hitPart(B: Boss, p: BossPart, dmg: number) {
    if (!p.alive || B.entering > 0 || B.dying > 0) return;
    p.hp -= dmg;
    p.hit = 0.07;
    if (p.hp <= 0) {
      p.alive = false;
      this.explode(B.x + p.ox, B.y + p.oy, 2, 0, 24);
      this.sfx.boom(2);
      this.hitBoss(B, B.max * 0.04, B.x + p.ox, B.y + p.oy, false);
      this.popup(B.x + p.ox, B.y + p.oy - 20, p.kind === "bay" ? "BAY DESTROYED" : p.kind === "crystal" ? "CRYSTAL SHATTERED" : "TURRET DOWN", "#ffcf6a", 12);
    }
  }

  private bossDefeated(B: Boss) {
    this.boss = null;
    this.bossesDown++;
    this.explode(B.x, B.y, 3, B.kind === 1 ? 2 : 0, B.rx);
    this.ring(B.x, B.y, 1.1, 30, 420, "rgba(255,230,180,1)", 7);
    this.screenFlash = 0.6;
    this.shake = 18;
    this.sfx.boom(3);
    // rewards: a lot of XP and score, a repair, rare pickups, ammo
    const reward = 1500 * (1 + B.tier) * (1 + this.bossesDown * 0.25);
    this.score += reward;
    this.gainXp(Math.round(220 * (1 + 0.5 * B.tier) + this.next * 0.5));
    this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.4);
    this.shield = this.maxShield;
    this.missiles = Math.min(40, this.missiles + 6);
    this.bombs = Math.min(6, this.bombs + 1);
    for (let i = 0; i < 3; i++) this.dropPickup(B.x + (i - 1) * 50, B.y, 2);
    for (let i = 0; i < 16; i++) this.dropOre(B.x + rand(-80, 80), B.y + rand(-40, 40));
    // onwards to the next region of space
    this.prevRegion = this.region;
    this.region = this.bossesDown % REGIONS.length;
    this.regionFade = 1;
    this.banner(`${B.name.toUpperCase()} DESTROYED`, `+${Math.round(reward)} · entering ${REGIONS[this.region].name}`, "#ffd27a", true);
    this.spawnT = 3;
  }

  /* ---------------- projectiles & collisions ---------------- */

  private updateProjectiles(dt: number) {
    for (const s of this.shots) {
      if (!s.alive) continue;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (s.y < -40 || s.x < -40 || s.x > W + 40) s.alive = false;
    }
    for (const b of this.bullets) {
      if (!b.alive) continue;
      b.t += dt;
      if (b.kind === 3 || b.kind === 5) {
        // homing, with a limited turn rate so you can outmanoeuvre it
        const want = Math.atan2(this.py - b.y, this.px - b.x);
        const cur = Math.atan2(b.vy, b.vx);
        let d = want - cur;
        while (d > Math.PI) d -= TAU;
        while (d < -Math.PI) d += TAU;
        const turn = (b.kind === 3 ? 1.9 : 1.1) * dt;
        const na = cur + clamp(d, -turn, turn);
        const sp = Math.min(b.kind === 3 ? 330 : 170, Math.hypot(b.vx, b.vy) + (b.kind === 3 ? 160 : 30) * dt);
        b.vx = Math.cos(na) * sp;
        b.vy = Math.sin(na) * sp;
        if (b.kind === 3 && !this.lite && Math.random() < 0.6) this.trail(b.x - b.vx * 0.02, b.y - b.vy * 0.02, "rgba(255,150,80,1)");
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.t > b.life || b.y > H + 30 || b.y < -60 || b.x < -30 || b.x > W + 30) {
        if (b.t > b.life && (b.kind === 3 || b.kind === 5)) this.popBullet(b);
        b.alive = false;
      }
    }
    for (const m of this.pmissiles) {
      if (!m.alive) continue;
      m.t += dt;
      let tx: number | null = null;
      let ty = 0;
      if (m.target && m.target.alive && m.target.id === m.tid) {
        tx = m.target.x;
        ty = m.target.y;
      } else if (m.boss && this.boss && this.boss.dying <= 0) {
        tx = this.boss.x + this.boss.core.ox;
        ty = this.boss.y + this.boss.core.oy;
      } else if (m.t > 0.25) {
        m.target = this.pickTarget(m.x, m.y, []);
        m.tid = m.target?.id ?? 0;
        m.boss = !m.target && !!this.boss && this.boss.entering <= 0;
      }
      const boost = m.t < 0.22 ? 0 : 1;
      if (tx !== null && boost) {
        const a = Math.atan2(ty - m.y, tx - m.x);
        m.vx += Math.cos(a) * 2400 * dt;
        m.vy += Math.sin(a) * 2400 * dt;
      } else if (boost) m.vy -= 1600 * dt;
      const sp = Math.hypot(m.vx, m.vy);
      const max = m.mini ? 640 : 720;
      if (sp > max) {
        m.vx = (m.vx / sp) * max;
        m.vy = (m.vy / sp) * max;
      }
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      if (!this.lite || Math.random() < 0.5) {
        const p = this.part();
        p.kind = 2;
        p.x = m.x;
        p.y = m.y;
        p.vx = rand(-10, 10);
        p.vy = rand(-10, 10);
        p.max = p.life = rand(0.25, 0.45);
        p.size = m.mini ? 4 : 6;
        p.grow = 14;
        p.color = "rgba(200,200,210,1)";
        p.drag = 0;
      }
      if (m.t > 4 || m.y < -60 || m.y > H + 60 || m.x < -60 || m.x > W + 60) m.alive = false;
    }
    for (const b of this.bombsOut) {
      if (!b.alive) continue;
      b.t += dt;
      b.vy *= Math.pow(0.12, dt);
      b.y += b.vy * dt;
      if (b.t > 0.75) {
        b.alive = false;
        this.detonate(b.x, b.y);
      }
    }
  }

  private detonate(x: number, y: number) {
    const R = 190;
    this.explode(x, y, 3, 0, 60);
    this.ring(x, y, 0.6, 20, R, "rgba(255,200,120,1)", 8);
    this.flash(x, y, 0.4, R, "rgba(255,190,120,1)");
    this.screenFlash = 0.3;
    this.shake = Math.max(this.shake, 14);
    this.sfx.boom(3);
    const dmg = 170 * this.power;
    for (const e of this.enemies) if (e.alive && (e.x - x) ** 2 + (e.y - y) ** 2 < (R + e.r) ** 2) this.hitEnemy(e, dmg, e.x, e.y, true);
    for (const b of this.bullets) if (b.alive && (b.x - x) ** 2 + (b.y - y) ** 2 < R * R) this.popBullet(b);
    const B = this.boss;
    if (B && Math.hypot(B.x - x, B.y - y) < R + B.rx * 0.6) {
      for (const p of B.parts) if (p.alive && Math.hypot(B.x + p.ox - x, B.y + p.oy - y) < R) this.hitPart(B, p, dmg * 0.6);
      this.hitBoss(B, dmg, x, y, false);
    }
  }

  private popBullet(b: Bullet) {
    b.alive = false;
    this.sparks(b.x, b.y, 3, b.kind === 2 || b.kind === 5 ? "rgba(140,255,140,1)" : "rgba(255,160,120,1)", 80);
  }

  private shotHits(s: Shot, id: number) {
    if (s.h0 === id || s.h1 === id || s.h2 === id) return true;
    s.h2 = s.h1;
    s.h1 = s.h0;
    s.h0 = id;
    return false;
  }

  private shotDone(s: Shot, x: number, y: number) {
    if (s.aoe > 0) {
      // explosive shell
      this.explode(x, y, 1, 0, 14);
      for (const e of this.enemies) if (e.alive && (e.x - x) ** 2 + (e.y - y) ** 2 < (s.aoe + e.r) ** 2) this.hitEnemy(e, s.dmg * 0.6, e.x, e.y, false);
      s.alive = false;
      return;
    }
    if (s.pierce > 0) s.pierce--;
    else s.alive = false;
    this.sparks(x, y, 2, "rgba(255,240,200,1)", 120);
  }

  private collide() {
    const B = this.boss;
    // player shots → enemies, enemy missiles, boss
    for (const s of this.shots) {
      if (!s.alive) continue;
      for (const e of this.enemies) {
        if (!e.alive || e.y < -e.r) continue;
        const dx = e.x - s.x;
        const dy = e.y - s.y;
        if (dx * dx + dy * dy > (e.r + 5) * (e.r + 5)) continue;
        if (this.shotHits(s, e.id)) continue;
        this.hitEnemy(e, s.dmg, s.x, s.y, s.kind === 5);
        this.shotDone(s, s.x, s.y);
        this.sfx.hit();
        if (!s.alive) break;
      }
      if (!s.alive) continue;
      for (const b of this.bullets) {
        if (!b.alive || b.hp <= 0) continue;
        if ((b.x - s.x) ** 2 + (b.y - s.y) ** 2 > (b.r + 6) ** 2) continue;
        b.hp -= s.dmg;
        if (b.hp <= 0) this.popBullet(b);
        s.alive = false;
        break;
      }
      if (!s.alive || !B || B.entering > 0 || B.dying > 0) continue;
      // boss parts, weak point, then the hull (an ellipse)
      let used = false;
      for (const p of B.parts) {
        if (!p.alive) continue;
        if ((B.x + p.ox - s.x) ** 2 + (B.y + p.oy - s.y) ** 2 < (p.r + 5) ** 2) {
          this.hitPart(B, p, s.dmg);
          this.hitBoss(B, s.dmg * 0.4, s.x, s.y, false);
          used = true;
          break;
        }
      }
      if (!used) {
        const cx = B.x + B.core.ox;
        const cy = B.y + B.core.oy;
        if ((cx - s.x) ** 2 + (cy - s.y) ** 2 < (B.core.r + 5) ** 2) {
          this.hitBoss(B, s.dmg, s.x, s.y, true);
          used = true;
        } else {
          const ex = (s.x - B.x) / B.rx;
          const ey = (s.y - B.y) / B.ry;
          if (ex * ex + ey * ey < 1) {
            this.hitBoss(B, s.dmg, s.x, s.y, false);
            used = true;
          }
        }
      }
      if (used) {
        if (s.aoe > 0) this.explode(s.x, s.y, 1, 0, 14);
        s.alive = s.pierce > 0 && s.aoe <= 0 ? (s.pierce--, true) : false;
        if (s.alive) s.y -= 30; // a lance passes through
      }
    }
    // missiles
    for (const m of this.pmissiles) {
      if (!m.alive) continue;
      let hit = false;
      for (const e of this.enemies) {
        if (e.alive && (e.x - m.x) ** 2 + (e.y - m.y) ** 2 < (e.r + 6) ** 2) {
          this.hitEnemy(e, m.dmg, m.x, m.y, true);
          hit = true;
          break;
        }
      }
      if (!hit && B && B.entering <= 0 && B.dying <= 0) {
        const ex = (m.x - B.x) / B.rx;
        const ey = (m.y - B.y) / B.ry;
        if (ex * ex + ey * ey < 1) {
          const weak = Math.hypot(B.x + B.core.ox - m.x, B.y + B.core.oy - m.y) < B.core.r + 10;
          this.hitBoss(B, m.dmg, m.x, m.y, weak);
          hit = true;
        }
      }
      if (hit) {
        m.alive = false;
        this.explode(m.x, m.y, m.mini ? 0 : 1, 0, 10);
      }
    }
    // enemy fire → player
    const pr = 9 + this.stage * 0.8;
    for (const b of this.bullets) {
      if (!b.alive) continue;
      if ((b.x - this.px) ** 2 + (b.y - this.py) ** 2 < (b.r + pr) ** 2) {
        b.alive = false;
        this.sparks(b.x, b.y, 4, "rgba(255,200,160,1)", 100);
        this.damagePlayer(b.dmg);
      }
    }
    // bodies → player
    const body = STAGES[this.stage].size * 0.3;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const rr = e.r * 0.82 + body;
      if ((e.x - this.px) ** 2 + (e.y - this.py) ** 2 > rr * rr) continue;
      const contact = [16, 24, 34, 40][e.def.size] * e.dmgMul;
      this.damagePlayer(contact);
      if (e.def.size <= 1 || e.kind === "kamikaze") this.killEnemy(e, true);
      else this.hitEnemy(e, 40, e.x, e.y, false);
    }
    if (B && B.entering <= 0 && B.dying <= 0) {
      const ex = (this.px - B.x) / (B.rx * 0.85);
      const ey = (this.py - B.y) / (B.ry * 0.85);
      if (ex * ex + ey * ey < 1) this.damagePlayer(30 * difficulty(this.level).dmg);
    }
  }

  /* ---------------- loot ---------------- */

  private dropOre(x: number, y: number) {
    const o = this.ores.find((q) => !q.alive);
    if (!o) return;
    o.alive = true;
    o.x = x;
    o.y = y;
    const a = rand(0, TAU);
    const v = rand(40, 140);
    o.vx = Math.cos(a) * v;
    o.vy = Math.sin(a) * v;
    o.t = 0;
  }

  /** minRarity: 0 any, 1 uncommon +, 2 rare + */
  private dropPickup(x: number, y: number, minRarity: number) {
    const p = this.pickups.find((q) => !q.alive);
    if (!p) return;
    let total = 0;
    for (const k of PICKUP_KINDS) if (PICKUPS[k].rarity >= minRarity) total += PICKUPS[k].weight;
    let r = Math.random() * total;
    let kind: PickupKind = "repair";
    for (const k of PICKUP_KINDS) {
      if (PICKUPS[k].rarity < minRarity) continue;
      r -= PICKUPS[k].weight;
      if (r <= 0) {
        kind = k;
        break;
      }
    }
    p.alive = true;
    p.kind = kind;
    p.x = clamp(x, 30, W - 30);
    p.y = y;
    p.vy = 70;
    p.t = 0;
  }

  private collect(kind: PickupKind) {
    const P = PICKUPS[kind];
    switch (kind) {
      case "weapon":
        this.weaponBoost = 15;
        this.power = Math.min(this.power + 0.04, 6);
        break;
      case "missiles":
        this.missiles = Math.min(40, this.missiles + 6);
        break;
      case "shield":
        this.shield = this.maxShield;
        this.shieldWait = 0;
        break;
      case "repair":
        this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.3);
        break;
      case "rapid":
        this.rapid = 10;
        break;
      case "damage":
        this.dmgBoost = 10;
        break;
      case "invincible":
        this.invincible = 6;
        break;
      case "bomb":
        this.bombs = Math.min(6, this.bombs + 1);
        break;
      case "drone":
        if (this.tempDrones.length < 3) this.tempDrones.push(25);
        else this.tempDrones[0] = 25;
        break;
      case "xp":
        this.gainXp(Math.round(this.next * 0.25));
        break;
    }
    this.popup(this.px, this.py - 40, P.label.toUpperCase(), P.color, 13);
    this.ring(this.px, this.py, 0.35, 10, 60, P.color.startsWith("#") ? hexA(P.color) : P.color, 3);
    this.sfx.pickup(P.rarity >= 2);
    this.score += 40;
  }

  private updateLoot(dt: number) {
    const mag = this.magnet + this.stage * 10;
    for (const p of this.pickups) {
      if (!p.alive) continue;
      p.t += dt;
      const dx = this.px - p.x;
      const dy = this.py - p.y;
      const d = Math.hypot(dx, dy);
      if (d < 28) {
        p.alive = false;
        this.collect(p.kind);
        continue;
      }
      if (d < mag) {
        p.x += (dx / d) * 260 * dt;
        p.y += (dy / d) * 260 * dt;
      } else {
        p.y += p.vy * dt;
        p.x += Math.sin(p.t * 2.2) * 18 * dt;
      }
      if (p.y > H + 30 || p.t > 14) p.alive = false;
    }
    for (const o of this.ores) {
      if (!o.alive) continue;
      o.t += dt;
      const dx = this.px - o.x;
      const dy = this.py - o.y;
      const d = Math.hypot(dx, dy);
      if (d < 22) {
        o.alive = false;
        this.resources++;
        this.score += 5;
        this.gainXp(1);
        this.sfx.pickup(false);
        continue;
      }
      if (d < mag * 1.6 && o.t > 0.35) {
        const pull = 900 * dt;
        o.vx += (dx / d) * pull;
        o.vy += (dy / d) * pull;
      } else o.vy += 40 * dt;
      o.vx *= Math.pow(0.2, dt);
      o.vy *= Math.pow(0.2, dt);
      o.x += o.vx * dt;
      o.y += (o.vy + this.speed * 0.25) * dt;
      if (o.y > H + 20 || o.t > 10) o.alive = false;
    }
  }

  /* ---------------- effects ---------------- */

  part(): Particle {
    // round-robin: the oldest particle gives way
    const p = this.parts[this.partI];
    this.partI = (this.partI + 1) % this.parts.length;
    p.rot = 0;
    p.vr = 0;
    return p;
  }
  private partI = 0;

  sparks(x: number, y: number, n: number, color: string, speed: number) {
    for (let i = 0; i < n; i++) {
      const p = this.part();
      const a = rand(0, TAU);
      const v = speed * rand(0.3, 1);
      p.kind = 0;
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * v;
      p.vy = Math.sin(a) * v;
      p.max = p.life = rand(0.2, 0.5);
      p.size = rand(1.2, 2.4);
      p.grow = 0;
      p.color = color;
      p.drag = 2.5;
    }
  }

  ring(x: number, y: number, dur: number, r0: number, r1: number, color: string, w: number) {
    const r = this.rings.find((q) => !q.alive);
    if (!r) return;
    r.alive = true;
    r.x = x;
    r.y = y;
    r.t = 0;
    r.dur = dur;
    r.r0 = r0;
    r.r1 = r1;
    r.color = color;
    r.w = w;
  }

  flash(x: number, y: number, dur: number, r: number, color: string) {
    const f = this.flashes.find((q) => !q.alive);
    if (!f) return;
    f.alive = true;
    f.x = x;
    f.y = y;
    f.t = 0;
    f.dur = dur;
    f.r = r;
    f.color = color;
  }

  popup(x: number, y: number, text: string, color: string, size: number) {
    const p = this.popups.find((q) => !q.alive);
    if (!p) return;
    p.alive = true;
    p.x = x;
    p.y = y;
    p.t = 0;
    p.text = text;
    p.color = color;
    p.size = size;
  }

  /** layered explosions: size 0 small pop … 3 a chain of blasts (motherships, bosses, bombs) */
  explode(x: number, y: number, size: Size, pal: number, radius = 20) {
    const P = PALETTES[pal];
    const lite = this.lite;
    const n = [10, 18, 30, 44][size] * (lite ? 0.5 : 1);
    this.flash(x, y, [0.18, 0.26, 0.36, 0.5][size], [radius * 1.8, radius * 2.2, radius * 2.4, radius * 2.2][size] + 20, P.flash);
    this.sparks(x, y, Math.round(n), P.spark, [220, 280, 340, 420][size]);
    // embers
    for (let i = 0; i < n * 0.6; i++) {
      const p = this.part();
      const a = rand(0, TAU);
      const v = rand(30, [120, 160, 220, 280][size]);
      p.kind = 1;
      p.x = x + rand(-radius, radius) * 0.4;
      p.y = y + rand(-radius, radius) * 0.4;
      p.vx = Math.cos(a) * v;
      p.vy = Math.sin(a) * v;
      p.max = p.life = rand(0.3, [0.5, 0.7, 0.9, 1.2][size]);
      p.size = rand(2, [3.5, 4.5, 6, 7][size]);
      p.grow = -3;
      p.color = P.ember;
      p.drag = 1.8;
    }
    // smoke
    if (!lite || size >= 2)
      for (let i = 0; i < [2, 5, 9, 12][size]; i++) {
        const p = this.part();
        const a = rand(0, TAU);
        const v = rand(10, 60);
        p.kind = 2;
        p.x = x + rand(-radius, radius) * 0.5;
        p.y = y + rand(-radius, radius) * 0.5;
        p.vx = Math.cos(a) * v;
        p.vy = Math.sin(a) * v + 30;
        p.max = p.life = rand(0.6, [0.8, 1.1, 1.5, 2][size]);
        p.size = radius * rand(0.5, 0.9);
        p.grow = radius * 1.4;
        p.color = P.smoke;
        p.drag = 1.2;
      }
    // debris: metal shards for ships, rock chips for asteroids, nothing solid from aliens
    if (P.shard)
      for (let i = 0; i < [3, 6, 12, 18][size] * (lite ? 0.5 : 1); i++) {
        const p = this.part();
        const a = rand(0, TAU);
        const v = rand(60, [180, 240, 300, 340][size]);
        p.kind = 3;
        p.x = x;
        p.y = y;
        p.vx = Math.cos(a) * v;
        p.vy = Math.sin(a) * v;
        p.max = p.life = rand(0.5, 1.2);
        p.size = rand(1, [1.2, 1.6, 2.2, 2.6][size]);
        p.grow = 0;
        p.color = pal === 1 ? "rock" : "metal";
        p.rot = rand(0, TAU);
        p.vr = rand(-12, 12);
        p.drag = 1;
      }
    else
      for (let i = 0; i < [6, 10, 16, 22][size]; i++) {
        const p = this.part();
        const a = rand(0, TAU);
        const v = rand(40, 200);
        p.kind = 4;
        p.x = x;
        p.y = y;
        p.vx = Math.cos(a) * v;
        p.vy = Math.sin(a) * v;
        p.max = p.life = rand(0.4, 0.9);
        p.size = rand(2, 5);
        p.grow = -2;
        p.color = i % 2 ? "rgba(140,255,120,1)" : "rgba(200,110,255,1)";
        p.drag = 2.2;
      }
    if (size >= 1) this.ring(x, y, [0.3, 0.35, 0.5, 0.8][size], radius * 0.4, radius * [1.6, 2, 2.8, 3.4][size] + 10, P.flash, [2, 2.5, 4, 6][size]);
    if (size >= 2) this.shake = Math.max(this.shake, size === 2 ? 4 : 12);
    if (size === 3) {
      // a chain of follow-up blasts
      for (let i = 0; i < (lite ? 4 : 7); i++) {
        const d = this.delayed.find((q) => !q.alive);
        if (!d) break;
        d.alive = true;
        d.t = 0.12 + i * 0.13;
        d.x = x + rand(-radius, radius);
        d.y = y + rand(-radius, radius) * 0.7;
        d.size = 1;
        d.pal = pal;
      }
    }
  }

  private updateEffects(dt: number) {
    for (const d of this.delayed) {
      if (!d.alive) continue;
      d.t -= dt;
      if (d.t <= 0) {
        d.alive = false;
        this.explode(d.x, d.y, d.size, d.pal, 20);
      }
    }
    for (const p of this.parts) {
      if (p.life <= 0) continue;
      p.life -= dt;
      const k = Math.max(0, 1 - p.drag * dt);
      p.vx *= k;
      p.vy *= k;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.size = Math.max(0.2, p.size + p.grow * dt);
      p.rot += p.vr * dt;
    }
    for (const r of this.rings) if (r.alive && (r.t += dt) >= r.dur) r.alive = false;
    for (const f of this.flashes) if (f.alive && (f.t += dt) >= f.dur) f.alive = false;
    for (const p of this.popups) if (p.alive && (p.t += dt) >= 0.9) p.alive = false;
    for (const b of this.banners) b.t += dt;
    this.banners = this.banners.filter((b) => b.t < b.life);
    this.shake *= Math.pow(0.004, dt);
    this.screenFlash = Math.max(0, this.screenFlash - dt * 1.6);
  }
}

function hexA(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},1)`;
}
