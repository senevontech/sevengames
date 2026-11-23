/* Pool sounds, synthesised from how the real things ring (no audio files):
   - ball on ball: phenolic resin balls "clack": a hard transient and a few short, inharmonic
     resonances in the 2–7 kHz range (a little higher and brighter the harder they meet);
   - cue tip: a leather tip on the ball (soft "tock"), plus the wooden cue's low knock;
   - cushion: a damped rubber thud with a little wood knock from the rail;
   - pocket: the ball hitting the leather liner, then dropping and rattling;
   - rolling: balls rolling on cloth make a low rumble that follows how fast they move.
   Everything goes through a small room reverb and a gentle compressor, and is panned to
   where on the table it happened. */
let ctx: AudioContext | null = null;
let out: GainNode | null = null;
let verb: GainNode | null = null;
let muted = false;

function ac() {
  if (muted) return null;
  try {
    if (!ctx) {
      ctx = new AudioContext();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 3;
      comp.attack.value = 0.002;
      comp.release.value = 0.12;
      comp.connect(ctx.destination);
      out = ctx.createGain();
      out.gain.value = 0.9;
      out.connect(comp);
      // a small room: a short, dark, stereo noise tail
      const conv = ctx.createConvolver();
      conv.buffer = roomImpulse(ctx, 0.7);
      verb = ctx.createGain();
      verb.gain.value = 0.16;
      verb.connect(conv).connect(comp);
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

export const setPoolMuted = (m: boolean) => {
  muted = m;
  if (m) setRolling(0);
};

function roomImpulse(a: AudioContext, secs: number) {
  const len = Math.floor(a.sampleRate * secs);
  const buf = a.createBuffer(2, len, a.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // early reflections, then a smooth decay; low-passed (a carpeted club room)
      const early = i < a.sampleRate * 0.03 && Math.random() < 0.004 ? (Math.random() * 2 - 1) * 0.8 : 0;
      lp = lp * 0.82 + (Math.random() * 2 - 1) * 0.18;
      d[i] = (lp * Math.pow(1 - t, 3.2) + early) * 0.9;
    }
  }
  return buf;
}

let noiseBuf: AudioBuffer | null = null;
function noise(a: AudioContext) {
  if (noiseBuf) return noiseBuf;
  const len = Math.floor(a.sampleRate * 1.5);
  noiseBuf = a.createBuffer(1, len, a.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

/** a voice's output: panned, to the dry mix and the room */
function bus(a: AudioContext, pan: number, wet = 1) {
  const p = a.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  p.connect(out!);
  if (verb && wet > 0) {
    const s = a.createGain();
    s.gain.value = wet;
    p.connect(s).connect(verb);
  }
  return p;
}

/** a decaying sine (one resonant mode) */
function mode(a: AudioContext, dest: AudioNode, t: number, f: number, vol: number, decay: number, glide = 1) {
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(f, t);
  if (glide !== 1) o.frequency.exponentialRampToValueAtTime(f * glide, t + decay * 3);
  g.gain.setValueAtTime(Math.max(0.0001, vol), t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay * 5);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + decay * 5 + 0.02);
}

/** a filtered noise burst (attack transients, thuds) */
function burst(a: AudioContext, dest: AudioNode, t: number, type: BiquadFilterType, f: number, q: number, vol: number, decay: number, attack = 0.0008) {
  const src = a.createBufferSource();
  src.buffer = noise(a);
  const fl = a.createBiquadFilter();
  fl.type = type;
  fl.frequency.value = f;
  fl.Q.value = q;
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay * 5);
  src.connect(fl).connect(g).connect(dest);
  src.start(t, Math.random() * 1.2, attack + decay * 5 + 0.03);
}

const jitter = (x: number, amt: number) => x * (1 + (Math.random() * 2 - 1) * amt);
const loud = (v: number, full: number) => Math.min(1, Math.max(0, v / full)) ** 0.75;

/* ---------------- the sounds ---------------- */
let lastClick = 0;
/** two balls meeting (rel: closing speed, table units / s) */
export function clickSound(rel: number, pan = 0) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime;
  if (t - lastClick < 0.008) return;
  lastClick = t;
  const v = loud(rel, 4500);
  if (v < 0.01) return;
  const d = bus(a, pan, 0.8);
  const f = jitter(3100 + 900 * v, 0.05);
  // the crack of the contact
  burst(a, d, t, "highpass", 2600, 0.7, 0.55 * v, 0.0016, 0.0004);
  // the ball's ringing modes (inharmonic, very short)
  mode(a, d, t, f, 0.32 * v, 0.006);
  mode(a, d, t, f * 1.47, 0.2 * v, 0.004);
  mode(a, d, t, f * 2.09, 0.12 * v, 0.003);
  // a little body
  mode(a, d, t, jitter(820, 0.06), 0.08 * v, 0.008, 0.9);
}

/** the cue tip on the cue ball (speed: cue ball speed) */
export function cueSound(speed: number, pan = 0) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime;
  const v = loud(speed, 6500);
  const d = bus(a, pan, 0.7);
  burst(a, d, t, "bandpass", 1500 + 1500 * v, 0.9, 0.45 * v + 0.05, 0.004);
  mode(a, d, t, jitter(1250, 0.04), 0.16 * v + 0.03, 0.006);
  // the cue's wood
  mode(a, d, t, jitter(190, 0.05), 0.18 * v + 0.04, 0.012, 0.85);
  if (v > 0.8) burst(a, d, t, "highpass", 3800, 0.6, 0.25 * v, 0.003); // a hard break cracks
}

let lastRail = 0;
/** a ball into a cushion (vn: speed into the cushion) */
export function railSound(vn: number, pan = 0) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime;
  if (t - lastRail < 0.015) return;
  lastRail = t;
  const v = loud(vn, 3500);
  if (v < 0.02) return;
  const d = bus(a, pan, 1);
  burst(a, d, t, "lowpass", 320, 0.9, 0.7 * v, 0.014, 0.002);
  mode(a, d, t, jitter(105, 0.08), 0.35 * v, 0.018, 0.8);
  mode(a, d, t, jitter(430, 0.08), 0.1 * v, 0.008); // the rail's wood
  burst(a, d, t, "bandpass", 1900, 1.2, 0.08 * v, 0.003);
}

/** a ball dropping into a pocket */
export function pocketSound(speed: number, pan = 0) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime;
  const v = 0.35 + 0.65 * loud(speed, 3000);
  const d = bus(a, pan, 1.2);
  // into the leather liner
  burst(a, d, t, "lowpass", 520, 0.8, 0.45 * v, 0.012, 0.002);
  mode(a, d, t, jitter(160, 0.06), 0.3 * v, 0.02, 0.75);
  // down the pocket: a few knocks, each softer and closer together
  let at = t + 0.07;
  let gap = 0.075;
  let vol = 0.22 * v;
  for (let i = 0; i < 4; i++) {
    mode(a, d, at, jitter(700 - i * 60, 0.1), vol, 0.006);
    burst(a, d, at, "bandpass", jitter(1400, 0.1), 1.4, vol * 0.6, 0.004);
    at += gap;
    gap *= 0.7;
    vol *= 0.6;
  }
  // settling against the other balls in the pocket
  burst(a, d, at + 0.02, "lowpass", 260, 0.7, 0.18 * v, 0.03, 0.01);
}

/* ---------------- rolling on cloth ---------------- */
let roll: { src: AudioBufferSourceNode; filt: BiquadFilterNode; gain: GainNode } | null = null;
/** how much is rolling right now (0 = nothing … 1 = a break) */
export function setRolling(level: number) {
  const a = level > 0.001 ? ac() : ctx;
  if (!a || !out) return;
  if (!roll) {
    if (level <= 0.001) return;
    const src = a.createBufferSource();
    src.buffer = noise(a);
    src.loop = true;
    const filt = a.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.value = 250;
    filt.Q.value = 0.5;
    const gain = a.createGain();
    gain.gain.value = 0;
    src.connect(filt).connect(gain).connect(out);
    src.start();
    roll = { src, filt, gain };
  }
  const l = Math.min(1, Math.max(0, level));
  const t = a.currentTime;
  roll.gain.gain.setTargetAtTime(0.11 * Math.sqrt(l), t, 0.05);
  roll.filt.frequency.setTargetAtTime(160 + 520 * l, t, 0.08);
  if (l <= 0.001) {
    const r = roll;
    roll = null;
    window.setTimeout(() => {
      try {
        r.src.stop();
      } catch {
        /* already stopped */
      }
    }, 400);
  }
}

/** shot clock: a soft tick for the last seconds */
export function tickSound(urgent: boolean) {
  const a = ac();
  if (!a) return;
  const d = bus(a, 0, 0);
  mode(a, d, a.currentTime, urgent ? 1650 : 1250, urgent ? 0.07 : 0.045, 0.01);
}

/** a short rising chime for winning the rack */
export function winChime() {
  const a = ac();
  if (!a) return;
  const d = bus(a, 0, 0.6);
  [523, 659, 784, 1047].forEach((f, i) => {
    const t = a.currentTime + i * 0.11;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = "triangle";
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g).connect(d);
    o.start(t);
    o.stop(t + 0.4);
  });
}
