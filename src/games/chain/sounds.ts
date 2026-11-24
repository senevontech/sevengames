/* Chain Reaction sounds, synthesised: glass shattering, amber blasts, comet whooshes, steel
   beads clicking into wells, wooden dominoes clacking. The deeper the chain, the brighter it
   gets, so a big cascade rises. A small room reverb and a limiter glue it together. */
let ctx: AudioContext | null = null;
let out: GainNode | null = null;
let verb: GainNode | null = null;

function ac() {
  try {
    if (!ctx) {
      ctx = new AudioContext();
      const lim = ctx.createDynamicsCompressor();
      lim.threshold.value = -16;
      lim.ratio.value = 6;
      lim.attack.value = 0.002;
      lim.release.value = 0.15;
      lim.connect(ctx.destination);
      out = ctx.createGain();
      out.gain.value = 0.8;
      out.connect(lim);
      const conv = ctx.createConvolver();
      const len = Math.floor(ctx.sampleRate * 0.9);
      const buf = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        let lp = 0;
        for (let i = 0; i < len; i++) {
          lp = lp * 0.7 + (Math.random() * 2 - 1) * 0.3;
          d[i] = lp * Math.pow(1 - i / len, 3);
        }
      }
      conv.buffer = buf;
      verb = ctx.createGain();
      verb.gain.value = 0.22;
      verb.connect(conv).connect(lim);
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

let noiseBuf: AudioBuffer | null = null;
function noise(a: AudioContext) {
  if (noiseBuf) return noiseBuf;
  const len = Math.floor(a.sampleRate);
  noiseBuf = a.createBuffer(1, len, a.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

function bus(a: AudioContext, pan: number, wet = 1) {
  const p = a.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  p.connect(out!);
  if (wet > 0 && verb) {
    const g = a.createGain();
    g.gain.value = wet;
    p.connect(g).connect(verb);
  }
  return p;
}

function tone(a: AudioContext, d: AudioNode, t: number, f: number, vol: number, decay: number, type: OscillatorType = "sine", glide = 1) {
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (glide !== 1) o.frequency.exponentialRampToValueAtTime(Math.max(20, f * glide), t + decay * 4);
  g.gain.setValueAtTime(Math.max(0.0001, vol), t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay * 5);
  o.connect(g).connect(d);
  o.start(t);
  o.stop(t + decay * 5 + 0.02);
}

function hiss(a: AudioContext, d: AudioNode, t: number, type: BiquadFilterType, f: number, q: number, vol: number, decay: number, attack = 0.001, sweep = 1) {
  const s = a.createBufferSource();
  s.buffer = noise(a);
  const fl = a.createBiquadFilter();
  fl.type = type;
  fl.frequency.setValueAtTime(f, t);
  if (sweep !== 1) fl.frequency.exponentialRampToValueAtTime(f * sweep, t + attack + decay * 4);
  fl.Q.value = q;
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay * 5);
  s.connect(fl).connect(g).connect(d);
  s.start(t, Math.random() * 0.6, attack + decay * 5 + 0.05);
}

/* rate limit: big cascades fire dozens of events per frame */
let lastAt = 0;
let inFrame = 0;
function allow(a: AudioContext, max = 5) {
  if (a.currentTime - lastAt > 0.03) {
    lastAt = a.currentTime;
    inFrame = 0;
  }
  return inFrame++ < max;
}
const lift = (depth: number) => 1 + Math.min(depth, 14) * 0.035;

/** a glass orb shattering */
export function glassBurst(depth: number, pan = 0, big = false) {
  const a = ac();
  if (!a || !allow(a)) return;
  const t = a.currentTime;
  const d = bus(a, pan, 1);
  const p = lift(depth);
  hiss(a, d, t, "highpass", 3500 * p, 0.6, 0.35, 0.012, 0.0006);
  hiss(a, d, t, "bandpass", 1800 * p, 1.2, 0.18, 0.02);
  // the pieces ringing as they fly
  const n = big ? 6 : 4;
  for (let i = 0; i < n; i++) {
    const f = (2600 + Math.random() * 4200) * p;
    tone(a, d, t + Math.random() * 0.09, f, 0.05 + Math.random() * 0.05, 0.015 + Math.random() * 0.02);
  }
  tone(a, d, t, 180, big ? 0.22 : 0.12, 0.03, "sine", 0.6);
}

/** an amber orb's blast */
export function blastSound(depth: number, pan = 0) {
  const a = ac();
  if (!a || !allow(a, 3)) return;
  const t = a.currentTime;
  const d = bus(a, pan, 1.4);
  hiss(a, d, t, "lowpass", 900, 0.7, 0.6, 0.05, 0.002, 0.25);
  tone(a, d, t, 90 * lift(depth), 0.5, 0.06, "sine", 0.45);
  hiss(a, d, t + 0.02, "highpass", 2500, 0.5, 0.15, 0.04);
}

/** a comet orb's bolt streaking off */
export function boltSound(pan = 0) {
  const a = ac();
  if (!a || !allow(a, 2)) return;
  const t = a.currentTime;
  const d = bus(a, pan, 1);
  hiss(a, d, t, "bandpass", 900, 3, 0.25, 0.06, 0.01, 4);
  tone(a, d, t, 600, 0.06, 0.05, "triangle", 2.2);
}

/** a cell bursting: steel beads ping out */
export function cellBurst(depth: number, pan = 0) {
  const a = ac();
  if (!a || !allow(a)) return;
  const t = a.currentTime;
  const d = bus(a, pan, 0.9);
  const f = 880 * lift(depth);
  tone(a, d, t, f, 0.14, 0.03);
  tone(a, d, t, f * 2.76, 0.06, 0.02);
  tone(a, d, t, f * 5.4, 0.03, 0.012);
  hiss(a, d, t, "highpass", 4000, 0.7, 0.12, 0.006);
}

/** a bead landing in a well */
export function beadLand(pan = 0) {
  const a = ac();
  if (!a || !allow(a, 4)) return;
  const t = a.currentTime;
  const d = bus(a, pan, 0.5);
  tone(a, d, t, 2400 + Math.random() * 600, 0.05, 0.008);
  hiss(a, d, t, "bandpass", 3000, 2, 0.05, 0.004);
}

/** a wooden domino falling onto the next / the table */
export function dominoClack(depth: number, pan = 0, big = false) {
  const a = ac();
  if (!a || !allow(a, 4)) return;
  const t = a.currentTime;
  const d = bus(a, pan, 0.7);
  const p = 1 + Math.min(depth, 30) * 0.008;
  hiss(a, d, t, "bandpass", (big ? 1500 : 2600) * p, 1.6, 0.3, 0.006, 0.0005);
  tone(a, d, t, (big ? 650 : 1150) * p, 0.12, 0.01);
  tone(a, d, t, big ? 160 : 260, 0.08, 0.02, "sine", 0.8);
}

/** a steel ball knocked rolling */
export function ballRoll(pan = 0) {
  const a = ac();
  if (!a || !allow(a, 2)) return;
  const t = a.currentTime;
  const d = bus(a, pan, 0.6);
  hiss(a, d, t, "lowpass", 380, 0.8, 0.18, 0.12, 0.02);
  tone(a, d, t, 1900, 0.06, 0.01);
}

/** a tap setting things off */
export function sparkSound() {
  const a = ac();
  if (!a) return;
  const t = a.currentTime;
  const d = bus(a, 0, 0.6);
  hiss(a, d, t, "highpass", 5000, 0.7, 0.2, 0.01);
  tone(a, d, t, 1400, 0.08, 0.02, "triangle", 1.5);
}

/** round cleared / run over */
export function fanfare(good: boolean) {
  const a = ac();
  if (!a) return;
  const d = bus(a, 0, 0.6);
  const notes = good ? [523, 659, 784, 1047] : [392, 330, 262];
  notes.forEach((f, i) => tone(a, d, a.currentTime + i * 0.11, f, 0.09, 0.07, "triangle"));
}
