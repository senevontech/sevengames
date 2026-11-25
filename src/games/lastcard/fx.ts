/* One Card feedback: short synthesised sounds (no audio files to download) and phone vibration.
   One shared AudioContext, tiny node graphs that stop themselves. */
let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;
function ac() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    if (!noise) {
      noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.4), ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return ctx;
  } catch {
    return null;
  }
}

function burst(t: number, dur: number, freq: number, q: number, vol: number, type: BiquadFilterType = "bandpass") {
  const a = ctx!;
  const src = a.createBufferSource();
  src.buffer = noise;
  const f = a.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = a.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(a.destination);
  src.start(t, Math.random() * 0.2);
  src.stop(t + dur + 0.02);
}
function tone(t: number, f: number, dur: number, vol: number, type: OscillatorType = "sine", glide?: number) {
  const a = ctx!;
  const o = a.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + dur);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/** a card slapped onto the pile */
export function snapSound() {
  if (!ac()) return;
  const t = ctx!.currentTime;
  burst(t, 0.05, 3200, 0.9, 0.35);
  burst(t + 0.004, 0.09, 900, 1.2, 0.18, "lowpass");
}
/** cards sliding off the deck (n of them) */
export function drawSound(n = 1) {
  if (!ac()) return;
  const t = ctx!.currentTime;
  for (let i = 0; i < Math.min(n, 5); i++) burst(t + i * 0.08, 0.1, 2400, 0.7, 0.16);
}
/** an action card (skip / reverse / +2): a quick whoosh */
export function actionSound() {
  if (!ac()) return;
  const t = ctx!.currentTime;
  burst(t, 0.22, 1400, 0.6, 0.12);
  tone(t + 0.02, 520, 0.18, 0.05, "triangle", 880);
}
/** a wild: a bright four-note shimmer */
export function wildSound() {
  if (!ac()) return;
  const t = ctx!.currentTime;
  [784, 988, 1175, 1568].forEach((f, i) => tone(t + i * 0.05, f, 0.3, 0.05, "triangle"));
}
/** "One card!" */
export function callSound() {
  if (!ac()) return;
  const t = ctx!.currentTime;
  tone(t, 880, 0.14, 0.08, "square");
  tone(t + 0.1, 1320, 0.22, 0.07, "square");
}
/** your turn */
export function turnSound() {
  if (!ac()) return;
  const t = ctx!.currentTime;
  tone(t, 660, 0.16, 0.05);
  tone(t + 0.09, 990, 0.2, 0.045);
}
/** you have to take cards */
export function hitSound() {
  if (!ac()) return;
  const t = ctx!.currentTime;
  tone(t, 220, 0.25, 0.09, "sawtooth", 120);
}
/** a win: a rising arpeggio */
export function winFanfare() {
  if (!ac()) return;
  const t = ctx!.currentTime;
  [523, 659, 784, 1047].forEach((f, i) => tone(t + i * 0.1, f, 0.4, 0.07, "triangle"));
}

export function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* not supported */
  }
}

/** a slower phone: fewer effects (few cores / little memory, or reduced motion asked for) */
export function isLite() {
  try {
    const n = navigator as Navigator & { deviceMemory?: number };
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return true;
    return (n.hardwareConcurrency ?? 8) <= 4 || (n.deviceMemory ?? 8) <= 2;
  } catch {
    return false;
  }
}
