/* Snake & Ladder sounds (Web Audio, made on the fly — no files). Dice rattle and knock, a soft
   wooden tap per square, rising taps up a ladder, a slide down a snake. Muting is remembered. */

const KEY = "senevon:snakeladder:sound";
let muted = (() => {
  try {
    return localStorage.getItem(KEY) === "off";
  } catch {
    return false;
  }
})();
export const isMuted = () => muted;
export function setMuted(on: boolean) {
  muted = on;
  try {
    localStorage.setItem(KEY, on ? "off" : "on");
  } catch {
    /* private mode */
  }
}

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;
function audio() {
  if (muted) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    if (!noise) {
      noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.25), ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return ctx;
  } catch {
    return null;
  }
}

/** a short filtered noise burst: a click / knock */
function click(a: AudioContext, at: number, freq: number, vol: number, len = 0.03) {
  const src = a.createBufferSource();
  src.buffer = noise;
  const f = a.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = freq;
  f.Q.value = 2.5;
  const g = a.createGain();
  g.gain.setValueAtTime(vol, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + len);
  src.connect(f).connect(g).connect(a.destination);
  src.start(at, Math.random() * 0.15, len + 0.02);
}

function tone(a: AudioContext, at: number, f0: number, f1: number, dur: number, vol: number, type: OscillatorType = "sine") {
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, at);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), at + dur);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(a.destination);
  o.start(at);
  o.stop(at + dur + 0.03);
}

export const sfx = {
  /** dice tumbling on the board (≈ the dice animation length) */
  roll(ms: number) {
    const a = audio();
    if (!a) return;
    const t = a.currentTime;
    const hits = 9;
    for (let i = 0; i < hits; i++) {
      // the knocks come faster and softer as the die settles
      const k = i / hits;
      const at = t + (ms / 1000) * (1 - Math.pow(1 - k, 1.6)) * 0.92;
      click(a, at, 1800 + Math.random() * 1600, 0.16 * (1 - k * 0.6), 0.025);
    }
  },
  /** the die comes to rest */
  land() {
    const a = audio();
    if (!a) return;
    const t = a.currentTime;
    tone(a, t, 210, 120, 0.09, 0.12, "triangle");
    click(a, t, 900, 0.18, 0.05);
  },
  /** a token steps onto a square */
  step(i = 0) {
    const a = audio();
    if (!a) return;
    const t = a.currentTime;
    tone(a, t, 520 + (i % 2) * 40, 380, 0.06, 0.05, "triangle");
    click(a, t, 2400, 0.05, 0.02);
  },
  ladder(ms: number) {
    const a = audio();
    if (!a) return;
    const t = a.currentTime;
    const taps = Math.max(4, Math.round(ms / 110));
    for (let i = 0; i < taps; i++) tone(a, t + (i * ms) / 1000 / taps, 420 + i * 45, 360 + i * 45, 0.07, 0.05, "triangle");
  },
  snake(ms: number) {
    const a = audio();
    if (!a) return;
    const t = a.currentTime;
    const d = ms / 1000;
    tone(a, t, 640, 140, d, 0.06, "sine");
    // a quiet hiss under it
    const src = a.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const f = a.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = 4500;
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.035, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    src.connect(f).connect(g).connect(a.destination);
    src.start(t);
    src.stop(t + d + 0.05);
  },
  /** a roll that would go past 100 */
  blocked() {
    const a = audio();
    if (!a) return;
    const t = a.currentTime;
    tone(a, t, 260, 200, 0.12, 0.06, "square");
  },
  win() {
    const a = audio();
    if (!a) return;
    const t = a.currentTime;
    [523, 659, 784].forEach((f, i) => tone(a, t + i * 0.11, f, f, 0.3, 0.06, "triangle"));
  },
};
