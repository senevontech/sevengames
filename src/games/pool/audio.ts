/* Pool sounds, synthesised: the cue tip, phenolic balls clicking, cushion thuds and balls
   dropping into the pockets. Loudness follows how hard things hit. */
let ctx: AudioContext | null = null;
let muted = false;
const ac = () => {
  if (muted) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
};

export const setPoolMuted = (m: boolean) => {
  muted = m;
};

let noiseBuf: AudioBuffer | null = null;
function noise(a: AudioContext) {
  if (noiseBuf) return noiseBuf;
  const len = Math.floor(a.sampleRate * 0.5);
  noiseBuf = a.createBuffer(1, len, a.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

function burst(a: AudioContext, t: number, freq: number, q: number, vol: number, len: number, type: BiquadFilterType = "bandpass") {
  const src = a.createBufferSource();
  src.buffer = noise(a);
  const f = a.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  src.connect(f).connect(g).connect(a.destination);
  src.start(t, Math.random() * 0.3, len + 0.02);
}

function ping(a: AudioContext, t: number, freq: number, vol: number, len: number) {
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(freq * 0.92, t + len);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.001);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + len + 0.02);
}

const level = (v: number, full: number) => Math.min(1, Math.max(0.04, v / full));

/** leather tip on the cue ball */
export function cueSound(speed: number) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime;
  const v = level(speed, 5000);
  burst(a, t, 1800, 1.2, 0.35 * v + 0.05, 0.05);
  ping(a, t, 900, 0.12 * v, 0.04);
}

let lastClick = 0;
/** two balls meeting */
export function clickSound(rel: number) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime;
  if (t - lastClick < 0.012) return;
  lastClick = t;
  const v = level(rel, 3500);
  ping(a, t, 3600 + Math.random() * 500, 0.45 * v, 0.035);
  ping(a, t, 5200 + Math.random() * 600, 0.2 * v, 0.02);
  burst(a, t, 4200, 2, 0.25 * v, 0.02);
}

let lastRail = 0;
/** a ball into a cushion */
export function railSound(vn: number) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime;
  if (t - lastRail < 0.02) return;
  lastRail = t;
  const v = level(vn, 3000);
  burst(a, t, 260, 1.4, 0.55 * v, 0.09, "lowpass");
  ping(a, t, 140, 0.25 * v, 0.07);
}

/** a ball rattling down a pocket */
export function pocketSound(speed: number) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime;
  const v = 0.4 + 0.6 * level(speed, 2500);
  burst(a, t, 700, 1.5, 0.3 * v, 0.06);
  burst(a, t + 0.05, 420, 1.2, 0.35 * v, 0.12, "lowpass");
  ping(a, t + 0.07, 180, 0.3 * v, 0.12);
  burst(a, t + 0.16, 300, 1, 0.15 * v, 0.2, "lowpass");
}

/** a short rising chime for winning the rack */
export function winChime() {
  const a = ac();
  if (!a) return;
  [523, 659, 784, 1047].forEach((f, i) => {
    const t = a.currentTime + i * 0.11;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = "triangle";
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g).connect(a.destination);
    o.start(t);
    o.stop(t + 0.4);
  });
}
