/* Card-table sounds, synthesised (no audio files): a card sliding on felt, chips clicking,
   and a short win chime. */
let ctx: AudioContext | null = null;
const ac = () => {
  try {
    ctx ??= new AudioContext();
    return ctx;
  } catch {
    return null;
  }
};

/** A soft paper-on-felt swish. */
export function cardSound(delay = 0) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + delay / 1000;
  const len = 0.09;
  const buf = a.createBuffer(1, Math.floor(a.sampleRate * len), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = a.createBufferSource();
  src.buffer = buf;
  const bp = a.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 2600;
  bp.Q.value = 0.8;
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.22, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  src.connect(bp).connect(g).connect(a.destination);
  src.start(t);
}

function click(t: number, f: number, v: number) {
  const a = ac()!;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = "square";
  o.frequency.setValueAtTime(f, t);
  o.frequency.exponentialRampToValueAtTime(f * 0.6, t + 0.03);
  g.gain.setValueAtTime(v, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + 0.05);
}

/** Two clay chips touching. */
export function chipSound() {
  const a = ac();
  if (!a) return;
  const t = a.currentTime;
  click(t, 3200, 0.05);
  click(t + 0.035, 2700, 0.035);
}

/** Rising three-note chime (a won hand). */
export function winSound() {
  const a = ac();
  if (!a) return;
  [660, 830, 990].forEach((f, i) => {
    const t = a.currentTime + i * 0.09;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = "triangle";
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g).connect(a.destination);
    o.start(t);
    o.stop(t + 0.4);
  });
}
