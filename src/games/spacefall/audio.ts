/* Spacefall sound: recorded sci-fi effects (Kenney's CC0 packs, see
   asset-sources/spacefall/sfx/KENNEY-LICENSE.txt) played through Web Audio, with a slight random
   pitch so repeats don't sound copied. Until the files have loaded (or if they can't), a small
   synthesised stand-in plays instead. Rapid sounds are rate-limited. Muting is remembered. */
import type { Sfx } from "./world";

const KEY = "senevon:spacefall:sound";
const BASE = "/games/spacefall/sfx/";
const NAMES = [
  "shot0", "shot1", "shot2", "shot3", "shot4", "shell", "hit", "boom0", "boom1", "boom2", "boom3", "shieldHit", "hurt",
  "pickup", "pickupRare", "ore", "missile", "bomb", "beam", "nova", "level", "evolve", "warning", "laserWarn", "click", "engine",
] as const;
type Name = (typeof NAMES)[number];

let muted = (() => {
  try {
    return localStorage.getItem(KEY) === "off";
  } catch {
    return false;
  }
})();
export const isMuted = () => muted;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
const buffers = new Map<Name, AudioBuffer>();
let loading = false;
const loops: Partial<Record<"beam" | "engine", { src: AudioBufferSourceNode; g: GainNode }>> = {};

function ac() {
  if (muted) return null;
  try {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.7;
      master.connect(ctx.destination);
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function load() {
  if (loading || !ctx) return;
  loading = true;
  const a = ctx;
  for (const n of NAMES)
    void fetch(`${BASE}${n}.mp3`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()))
      .then((b) => a.decodeAudioData(b))
      .then((buf) => buffers.set(n, buf))
      .catch(() => {
        /* the synthesised stand-in keeps playing */
      });
}

export function setMuted(on: boolean) {
  muted = on;
  try {
    localStorage.setItem(KEY, on ? "off" : "on");
  } catch {
    /* private mode */
  }
  if (on) {
    stopLoop("beam");
    stopLoop("engine");
  }
}

/** call from a user gesture so the browser lets sound start (also starts loading the files) */
export function unlockAudio() {
  if (ac()) load();
}

export function suspendAudio(on: boolean) {
  if (!ctx) return;
  if (on) void ctx.suspend();
  else if (!muted) void ctx.resume();
}

/** play a recorded sound; false when it isn't loaded (so the caller can fall back) */
function play(n: Name, vol = 1, pitch = 0.06, delay = 0) {
  const a = ac();
  const buf = buffers.get(n);
  if (!a || !master || !buf) return false;
  const s = a.createBufferSource();
  s.buffer = buf;
  s.playbackRate.value = 1 + (Math.random() * 2 - 1) * pitch;
  const g = a.createGain();
  g.gain.value = vol;
  s.connect(g).connect(master);
  s.start(a.currentTime + delay);
  return true;
}

function startLoop(n: "beam" | "engine", vol: number) {
  const a = ac();
  const buf = buffers.get(n);
  if (!a || !master || !buf || loops[n]) return;
  const src = a.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const g = a.createGain();
  g.gain.value = 0.0001;
  g.gain.setTargetAtTime(vol, a.currentTime, 0.08);
  src.connect(g).connect(master);
  src.start();
  loops[n] = { src, g };
}

function stopLoop(n: "beam" | "engine") {
  const l = loops[n];
  if (!l || !ctx) return;
  l.g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.1);
  const src = l.src;
  window.setTimeout(() => {
    try {
      src.stop();
    } catch {
      /* already stopped */
    }
  }, 500);
  delete loops[n];
}

/** the ship's engine hum while a run is going */
export function engineHum(on: boolean) {
  if (on) startLoop("engine", 0.35);
  else stopLoop("engine");
}

/* ---- synthesised stand-ins ---- */
function tone(f0: number, f1: number, dur: number, vol: number, type: OscillatorType = "sine", delay = 0) {
  const a = ac();
  if (!a || !master) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}
function burst(dur: number, vol: number, freq: number) {
  const a = ac();
  if (!a || !master || !noise) return;
  const t = a.currentTime;
  const s = a.createBufferSource();
  s.buffer = noise;
  const f = a.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.setValueAtTime(freq, t);
  f.frequency.exponentialRampToValueAtTime(120, t + dur);
  const g = a.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(master);
  s.start(t, Math.random() * 0.5, dur + 0.05);
}

const last: Record<string, number> = {};
function gate(key: string, ms: number) {
  const now = performance.now();
  if ((last[key] ?? 0) + ms > now) return false;
  last[key] = now;
  return true;
}

export const sfx: Sfx = {
  shot(kind) {
    if (!gate("shot", 90)) return;
    const n: Name = kind === 5 ? "shell" : kind >= 4 ? "shot4" : kind === 3 ? "shot3" : kind === 2 ? "shot2" : kind === 1 ? "shot1" : "shot0";
    if (!play(n, kind >= 4 ? 0.5 : 0.42, 0.08)) tone(980, 380, 0.06, 0.035, "square");
  },
  hit() {
    if (!gate("hit", 70)) return;
    play("hit", 0.35, 0.15);
  },
  boom(size) {
    if (!gate(`boom${size}`, size >= 2 ? 110 : 60)) return;
    const n: Name = (["boom0", "boom1", "boom2", "boom3"] as const)[size];
    if (!play(n, [0.55, 0.7, 0.85, 1][size], 0.1)) burst([0.25, 0.4, 0.7, 1.3][size], [0.18, 0.25, 0.35, 0.45][size], 1400);
    if (size === 3) play("boom2", 0.6, 0.05, 0.12);
  },
  hurt(shield) {
    if (!gate("hurt", 110)) return;
    if (!play(shield ? "shieldHit" : "hurt", shield ? 0.6 : 0.85, 0.05)) tone(shield ? 900 : 200, shield ? 1500 : 70, 0.2, 0.1, shield ? "sine" : "sawtooth");
  },
  pickup(rare) {
    if (!gate(rare ? "pickR" : "pick", 40)) return;
    if (rare) play("pickupRare", 0.7, 0) || tone(880, 1320, 0.2, 0.06, "triangle");
    else play("ore", 0.3, 0.12) || tone(1200, 1800, 0.06, 0.03, "triangle");
  },
  missile() {
    if (!play("missile", 0.7, 0.06)) burst(0.35, 0.12, 2500);
  },
  bomb() {
    if (!play("bomb", 0.6, 0.04)) tone(500, 120, 0.5, 0.08, "triangle");
  },
  beam(on) {
    if (on) startLoop("beam", 0.55);
    else stopLoop("beam");
  },
  nova() {
    if (!play("nova", 0.9, 0)) burst(0.6, 0.3, 4000);
  },
  level(evolve) {
    if (!play(evolve ? "evolve" : "level", 0.8, 0)) [523, 659, 784].forEach((f, i) => tone(f, f, 0.2, 0.07, "triangle", i * 0.07));
    if (evolve) play("pickupRare", 0.6, 0, 0.25);
  },
  warning() {
    for (let i = 0; i < 3; i++) if (!play("warning", 0.8, 0, i * 0.75)) tone(440, 330, 0.35, 0.1, "square", i * 0.8);
  },
  laserWarn() {
    if (!gate("lw", 300)) return;
    if (!play("laserWarn", 0.6, 0)) tone(1500, 1500, 0.08, 0.05, "square");
  },
};

/** UI clicks on the game's own buttons */
export function uiClick() {
  play("click", 0.5, 0.04);
}
