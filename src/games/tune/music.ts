/* Draw a Tune: turning a drawing into notes, and playing them.
   The canvas is a timeline: a bar sweeps left → right across 64 steps (four bars of 16ths).
   Height is pitch, snapped to the chosen scale, so anything you draw is in key. Each pen colour is
   an instrument; a thicker pen plays louder. Everything is synthesised with WebAudio
   (no samples): a hammered piano, glassy bells, bowed strings, a plucked bass and a drum kit. */

export const W = 1200;
export const H = 900;
export const STEPS = 64;
export const COL = W / STEPS;

export type Inst = "piano" | "bells" | "strings" | "bass" | "drums";
export type ScaleId = "major" | "minor" | "penta" | "blues" | "bhairav" | "yaman";
export type BeatId = "off" | "pop" | "lofi" | "dhol";
/** one pen stroke: instrument, size (0 thin … 2 thick), points as x,y,x,y… in canvas units */
export type Stroke = { i: Inst; s: 0 | 1 | 2; p: number[] };
export type Song = { v: 1; scale: ScaleId; key: number; bpm: number; beat: BeatId; strokes: Stroke[] };

export const INSTRUMENTS: Record<Inst, { name: string; color: string }> = {
  piano: { name: "Piano", color: "#4cc3ff" },
  bells: { name: "Bells", color: "#ffd25a" },
  strings: { name: "Strings", color: "#b98cff" },
  bass: { name: "Bass", color: "#43e08b" },
  drums: { name: "Drums", color: "#ff6b6b" },
};
export const INST_ORDER: Inst[] = ["piano", "bells", "strings", "bass", "drums"];

export const SCALES: Record<ScaleId, { name: string; steps: number[] }> = {
  major: { name: "Happy (major)", steps: [0, 2, 4, 5, 7, 9, 11] },
  minor: { name: "Sad (minor)", steps: [0, 2, 3, 5, 7, 8, 10] },
  penta: { name: "Pentatonic", steps: [0, 2, 4, 7, 9] },
  blues: { name: "Blues", steps: [0, 3, 5, 6, 7, 10] },
  bhairav: { name: "Raag Bhairav", steps: [0, 1, 4, 5, 7, 8, 11] },
  yaman: { name: "Raag Yaman", steps: [0, 2, 4, 6, 7, 9, 11] },
};
export const KEYS = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
export const BEATS: Record<BeatId, string> = { off: "No beat", pop: "Pop", lofi: "Lo-fi", dhol: "Dhol" };
export const DRUM_ZONES = ["Kick", "Tom", "Snare", "Hi-hat"]; // bottom → top

export const emptySong = (): Song => ({ v: 1, scale: "penta", key: 0, bpm: 100, beat: "off", strokes: [] });

/* ---------------- pitch lanes ---------------- */
const OCTAVES = 3;
export const rowsOf = (scale: ScaleId) => SCALES[scale].steps.length * OCTAVES + 1;
export const rowH = (scale: ScaleId) => H / rowsOf(scale);
export function rowAt(scale: ScaleId, y: number) {
  const n = rowsOf(scale);
  return Math.max(0, Math.min(n - 1, Math.floor((H - y) / (H / n))));
}
export const rowY = (scale: ScaleId, r: number) => H - (r + 0.5) * rowH(scale);
export function midiOf(scale: ScaleId, key: number, r: number) {
  const st = SCALES[scale].steps;
  return 48 + key + 12 * Math.floor(r / st.length) + st[r % st.length];
}
/** is this row the key's root note (drawn a little brighter) */
export const isRoot = (scale: ScaleId, r: number) => r % SCALES[scale].steps.length === 0;
export const drumZone = (y: number) => Math.max(0, Math.min(3, Math.floor((H - y) / (H / 4))));

/* ---------------- drawing → notes ---------------- */
export type NoteEv = { step: number; len: number; inst: Inst; midi: number; vel: number; y: number; strum: number };

const RETRIGGER: Record<Inst, number> = { piano: 2, bells: 2, strings: 16, bass: 4, drums: 2 };
const MAX_CHORD = 4;

export function songNotes(song: Song): NoteEv[] {
  const rh = rowH(song.scale);
  const out: NoteEv[] = [];
  for (const st of song.strokes) {
    const vel = [0.55, 0.78, 1][st.s] ?? 0.78;
    const drums = st.i === "drums";
    const lanes = (y: number) => (drums ? drumZone(y) : rowAt(song.scale, y));
    const laneH = drums ? H / 4 : rh;
    // which lanes the stroke passes through in each column
    const cols: Array<Set<number> | undefined> = [];
    const add = (c: number, r: number) => {
      if (c < 0 || c >= STEPS) return;
      (cols[c] ??= new Set()).add(r);
    };
    const p = st.p;
    if (p.length === 2) add(Math.floor(p[0] / COL), lanes(p[1]));
    for (let k = 2; k + 1 < p.length; k += 2) {
      const x1 = p[k - 2], y1 = p[k - 1], x2 = p[k], y2 = p[k + 1];
      const c0 = Math.floor(Math.min(x1, x2) / COL);
      const c1 = Math.floor(Math.max(x1, x2) / COL);
      for (let c = c0; c <= c1; c++) {
        let ya: number, yb: number;
        if (Math.abs(x2 - x1) < 0.001) {
          ya = y1;
          yb = y2;
        } else {
          const xa = Math.max(Math.min(x1, x2), c * COL);
          const xb = Math.min(Math.max(x1, x2), (c + 1) * COL);
          ya = y1 + ((xa - x1) / (x2 - x1)) * (y2 - y1);
          yb = y1 + ((xb - x1) / (x2 - x1)) * (y2 - y1);
        }
        const lo = Math.min(ya, yb), hi = Math.max(ya, yb);
        if (hi - lo < laneH * 1.5) {
          add(c, lanes((lo + hi) / 2)); // a gentle slope: one note
        } else {
          // steep: every lane it crosses (a strummed chord)
          const rA = lanes(hi), rB = lanes(lo);
          for (let r = Math.min(rA, rB); r <= Math.max(rA, rB); r++) add(c, r);
        }
      }
    }
    // thin out big chords (keep the outer notes)
    const sets = cols.map((s) => {
      if (!s) return null;
      const arr = [...s].sort((a, b) => a - b);
      if (arr.length <= MAX_CHORD) return new Set(arr);
      const keep = new Set<number>();
      for (let j = 0; j < MAX_CHORD; j++) keep.add(arr[Math.round((j * (arr.length - 1)) / (MAX_CHORD - 1))]);
      return keep;
    });
    // runs of the same lane → held notes, re-struck every few steps
    const every = RETRIGGER[st.i];
    const seen = new Set<string>();
    for (let c = 0; c < STEPS; c++) {
      const s = sets[c];
      if (!s) continue;
      const chord = [...s].sort((a, b) => a - b);
      chord.forEach((r, j) => {
        if (seen.has(`${c}:${r}`)) return;
        let e = c;
        while (e + 1 < STEPS && sets[e + 1]?.has(r)) e++;
        for (let a = c; a <= e; a += every) {
          seen.add(`${a}:${r}`);
          const len = Math.min(every, e - a + 1);
          for (let q = a; q < a + len; q++) seen.add(`${q}:${r}`);
          out.push({
            step: a,
            len,
            inst: st.i,
            midi: drums ? r : midiOf(song.scale, song.key, r),
            vel,
            y: drums ? H - (r + 0.5) * (H / 4) : rowY(song.scale, r),
            strum: chord.length > 1 ? j * 0.014 : 0,
          });
        }
      });
    }
  }
  return out.sort((a, b) => a.step - b.step);
}

/* ---------------- the synth ---------------- */
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let verb: GainNode | null = null;
let noise: AudioBuffer | null = null;

function ac() {
  try {
    if (!ctx) {
      ctx = new AudioContext({ latencyHint: "interactive" });
      const lim = ctx.createDynamicsCompressor();
      lim.threshold.value = -14;
      lim.knee.value = 8;
      lim.ratio.value = 5;
      lim.attack.value = 0.003;
      lim.release.value = 0.2;
      lim.connect(ctx.destination);
      master = ctx.createGain();
      master.gain.value = 0.85;
      master.connect(lim);
      // a warm hall: decaying filtered noise, a touch wider on the right
      const conv = ctx.createConvolver();
      const len = Math.floor(ctx.sampleRate * 2.2);
      const buf = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        let lp = 0;
        for (let i = 0; i < len; i++) {
          lp = lp * 0.82 + (Math.random() * 2 - 1) * 0.18;
          d[i] = lp * Math.pow(1 - i / len, 2.6) * (i < 400 ? i / 400 : 1);
        }
      }
      conv.buffer = buf;
      verb = ctx.createGain();
      verb.gain.value = 0.5;
      verb.connect(conv).connect(lim);
      const nl = ctx.sampleRate;
      noise = ctx.createBuffer(1, nl, ctx.sampleRate);
      const nd = noise.getChannelData(0);
      for (let i = 0; i < nl; i++) nd[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}
export const audioNow = () => ac()?.currentTime ?? 0;
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** an output for one voice: gain → pan → master (+ reverb send) */
function voice(c: AudioContext, pan: number, send: number) {
  const g = c.createGain();
  g.gain.value = 0;
  const p = c.createStereoPanner();
  p.pan.value = pan;
  g.connect(p).connect(master!);
  if (send > 0) {
    const s = c.createGain();
    s.gain.value = send;
    p.connect(s).connect(verb!);
  }
  return g;
}
function noiseSrc(c: AudioContext, t: number, dur: number) {
  const n = c.createBufferSource();
  n.buffer = noise;
  n.start(t, Math.random() * 0.5);
  n.stop(t + dur);
  return n;
}

function piano(c: AudioContext, t: number, m: number, vel: number, dur: number) {
  const f = mtof(m);
  const decay = 2.6 * Math.pow(0.5, (m - 48) / 24); // low notes ring longer
  const g = voice(c, (m - 66) / 60, 0.28);
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(Math.min(16000, f * (5 + 7 * vel)), t);
  lp.frequency.setTargetAtTime(f * 2.2, t + 0.01, 0.35);
  lp.connect(g);
  const end = t + Math.max(dur, 0.18) + 0.5;
  const peak = 0.22 * vel;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.004);
  g.gain.setTargetAtTime(peak * 0.25, t + 0.004, decay * 0.18);
  g.gain.setTargetAtTime(0, t + Math.max(dur, 0.18), 0.16);
  // slightly stretched partials, two strings a hair apart
  [1, 2, 3, 4, 5].forEach((n, i) => {
    const amp = [1, 0.5, 0.22, 0.12, 0.05][i];
    for (const det of n === 1 ? [-1.2, 1.2] : [0]) {
      const o = c.createOscillator();
      o.frequency.value = f * n * Math.sqrt(1 + 0.00035 * n * n);
      o.detune.value = det;
      const a = c.createGain();
      a.gain.value = amp / (n === 1 ? 2 : 1);
      o.connect(a).connect(lp);
      o.start(t);
      o.stop(end);
    }
  });
  // the hammer
  const hn = noiseSrc(c, t, 0.03);
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = Math.min(9000, f * 3);
  bp.Q.value = 1.2;
  const hg = c.createGain();
  hg.gain.setValueAtTime(0.06 * vel, t);
  hg.gain.exponentialRampToValueAtTime(0.0005, t + 0.03);
  hn.connect(bp).connect(hg).connect(g);
}

function bells(c: AudioContext, t: number, m: number, vel: number) {
  const f = mtof(m + 12);
  const g = voice(c, 0.28, 0.45);
  const peak = 0.12 * vel;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0004, t + 2.2);
  const car = c.createOscillator();
  car.frequency.value = f;
  const mod = c.createOscillator();
  mod.frequency.value = f * 3.5;
  const mg = c.createGain();
  mg.gain.setValueAtTime(f * 1.6 * vel, t);
  mg.gain.exponentialRampToValueAtTime(f * 0.05, t + 0.6);
  mod.connect(mg).connect(car.frequency);
  car.connect(g);
  // the bar's inharmonic overtone
  const o2 = c.createOscillator();
  o2.frequency.value = f * 2.76;
  const g2 = c.createGain();
  g2.gain.setValueAtTime(0.25, t);
  g2.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
  o2.connect(g2).connect(g);
  for (const o of [car, mod, o2]) {
    o.start(t);
    o.stop(t + 2.3);
  }
}

function strings(c: AudioContext, t: number, m: number, vel: number, dur: number) {
  const f = mtof(m);
  const g = voice(c, -0.3, 0.55);
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = Math.min(5200, 900 + f * 2.2);
  lp.Q.value = 0.6;
  lp.connect(g);
  const peak = 0.075 * vel;
  const hold = Math.max(dur, 0.25);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.14);
  g.gain.setValueAtTime(peak, t + hold);
  g.gain.setTargetAtTime(0, t + hold, 0.18);
  const lfo = c.createOscillator();
  lfo.frequency.value = 5.3;
  const lg = c.createGain();
  lg.gain.setValueAtTime(0, t);
  lg.gain.linearRampToValueAtTime(7, t + 0.5);
  lfo.connect(lg);
  const oscs = [-7, 7, 0].map((det, i) => {
    const o = c.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = i === 2 ? f / 2 : f;
    o.detune.value = det;
    lg.connect(o.detune);
    const a = c.createGain();
    a.gain.value = i === 2 ? 0.35 : 0.5;
    o.connect(a).connect(lp);
    return o;
  });
  for (const o of [...oscs, lfo]) {
    o.start(t);
    o.stop(t + hold + 1);
  }
}

function bass(c: AudioContext, t: number, m: number, vel: number, dur: number) {
  const f = mtof(m - 24);
  const g = voice(c, 0, 0.08);
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.Q.value = 4;
  lp.frequency.setValueAtTime(260 + 1100 * vel, t);
  lp.frequency.exponentialRampToValueAtTime(180, t + 0.3);
  lp.connect(g);
  const hold = Math.max(dur, 0.12);
  const peak = 0.3 * vel;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.006);
  g.gain.setTargetAtTime(peak * 0.45, t + 0.01, 0.25);
  g.gain.setTargetAtTime(0, t + hold, 0.06);
  const saw = c.createOscillator();
  saw.type = "sawtooth";
  saw.frequency.value = f;
  const sub = c.createOscillator();
  sub.frequency.value = f;
  const sg = c.createGain();
  sg.gain.value = 0.9;
  saw.connect(lp);
  sub.connect(sg).connect(g);
  for (const o of [saw, sub]) {
    o.start(t);
    o.stop(t + hold + 0.4);
  }
}

/** zone: 0 kick, 1 tom, 2 snare, 3 hi-hat (4 open hat, 5 low dhol, 6 high dhol) */
function drum(c: AudioContext, t: number, zone: number, vel: number, pan = 0) {
  if (zone === 0 || zone === 1 || zone === 5 || zone === 6) {
    const [f0, f1, d, send] = zone === 0 ? [150, 44, 0.42, 0.05] : zone === 1 ? [190, 105, 0.35, 0.2] : zone === 5 ? [120, 70, 0.5, 0.2] : [330, 300, 0.18, 0.2];
    const g = voice(c, zone === 1 ? -0.15 : pan, send);
    const o = c.createOscillator();
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + (zone === 0 ? 0.11 : 0.18));
    const peak = (zone === 0 ? 0.75 : 0.45) * vel;
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + d);
    o.connect(g);
    o.start(t);
    o.stop(t + d + 0.02);
    // the beater / the hand on the skin
    const n = noiseSrc(c, t, 0.025);
    const hp = c.createBiquadFilter();
    hp.type = zone === 6 ? "bandpass" : "highpass";
    hp.frequency.value = zone === 6 ? 2400 : 1500;
    const ng = c.createGain();
    ng.gain.setValueAtTime((zone === 6 ? 0.25 : 0.12) * vel, t);
    ng.gain.exponentialRampToValueAtTime(0.0005, t + 0.025);
    n.connect(hp).connect(ng).connect(g);
    return;
  }
  if (zone === 2) {
    const g = voice(c, 0.05, 0.25);
    const n = noiseSrc(c, t, 0.22);
    const bp = c.createBiquadFilter();
    bp.type = "highpass";
    bp.frequency.value = 1200;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.4 * vel, t);
    ng.gain.exponentialRampToValueAtTime(0.0005, t + 0.2);
    n.connect(bp).connect(ng).connect(g);
    const o = c.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(170, t + 0.06);
    const og = c.createGain();
    og.gain.setValueAtTime(0.35 * vel, t);
    og.gain.exponentialRampToValueAtTime(0.0005, t + 0.09);
    o.connect(og).connect(g);
    g.gain.value = 1;
    o.start(t);
    o.stop(t + 0.1);
    return;
  }
  // hats
  const open = zone === 4;
  const g = voice(c, 0.22, 0.12);
  g.gain.value = 1;
  const n = noiseSrc(c, t, open ? 0.3 : 0.06);
  const hp = c.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 7200;
  const ng = c.createGain();
  ng.gain.setValueAtTime(0.2 * vel, t);
  ng.gain.exponentialRampToValueAtTime(0.0005, t + (open ? 0.28 : 0.045));
  n.connect(hp).connect(ng).connect(g);
}

export function playNote(inst: Inst, midi: number, vel: number, dur: number, at?: number) {
  const c = ac();
  if (!c || !master) return;
  const t = Math.max(c.currentTime + 0.005, at ?? 0);
  if (inst === "piano") piano(c, t, midi, vel, dur);
  else if (inst === "bells") bells(c, t, midi, vel);
  else if (inst === "strings") strings(c, t, midi, vel, dur);
  else if (inst === "bass") bass(c, t, midi, vel, dur);
  else drum(c, t, midi, vel);
}

/* ---------------- backing beats (one bar of 16 steps, repeated) ---------------- */
type Hit = [zone: number, vel: number];
const PATTERNS: Record<Exclude<BeatId, "off">, { swing: number; steps: Hit[][] }> = {
  pop: {
    swing: 0,
    steps: Array.from({ length: 16 }, (_, s) => {
      const h: Hit[] = [];
      if ([0, 8, 10].includes(s)) h.push([0, 0.9]);
      if (s === 4 || s === 12) h.push([2, 0.75]);
      if (s % 2 === 0) h.push([3, s % 4 === 0 ? 0.5 : 0.35]);
      if (s === 14) h.push([4, 0.3]);
      return h;
    }),
  },
  lofi: {
    swing: 0.22,
    steps: Array.from({ length: 16 }, (_, s) => {
      const h: Hit[] = [];
      if ([0, 7, 10].includes(s)) h.push([0, 0.7]);
      if (s === 4 || s === 12) h.push([2, 0.45]);
      if (s % 2 === 0) h.push([3, 0.22]);
      return h;
    }),
  },
  dhol: {
    swing: 0.12,
    steps: Array.from({ length: 16 }, (_, s) => {
      const h: Hit[] = [];
      if ([0, 3, 6, 8, 11, 14].includes(s)) h.push([5, s % 8 === 0 ? 0.9 : 0.65]);
      if ([2, 5, 7, 10, 13, 15].includes(s)) h.push([6, 0.45]);
      if (s === 4 || s === 12) h.push([2, 0.4]);
      return h;
    }),
  },
};

/* ---------------- the transport ---------------- */
export class Player {
  private notes: NoteEv[] = [];
  private bpm = 100;
  private beat: BeatId = "off";
  private loop = true;
  private t0 = 0;
  private next = 0; // next step to schedule (absolute, can exceed STEPS when looping)
  private timer = 0;
  playing = false;
  onEnd?: () => void;

  get stepDur() {
    return 60 / this.bpm / 4;
  }
  set(notes: NoteEv[], bpm: number, beat: BeatId, loop: boolean) {
    if (this.playing && bpm !== this.bpm) {
      // keep the bar where it is when the tempo changes
      const c = ac();
      if (c) {
        const pos = (c.currentTime - this.t0) / this.stepDur;
        this.bpm = bpm;
        this.t0 = c.currentTime - pos * this.stepDur;
      }
    }
    this.notes = notes;
    this.bpm = bpm;
    this.beat = beat;
    this.loop = loop;
  }
  start() {
    const c = ac();
    if (!c) return;
    this.stop();
    this.playing = true;
    this.t0 = c.currentTime + 0.08;
    this.next = 0;
    this.tick();
    this.timer = window.setInterval(() => this.tick(), 25);
  }
  stop() {
    window.clearInterval(this.timer);
    this.playing = false;
  }
  /** where the bar is, in steps from the left (0 … STEPS), or -1 when stopped */
  pos() {
    if (!this.playing || !ctx) return -1;
    const p = (ctx.currentTime - this.t0) / this.stepDur;
    return p < 0 ? 0 : p % STEPS;
  }
  private tick() {
    const c = ac();
    if (!c || !this.playing) return;
    const horizon = c.currentTime + 0.14;
    while (this.t0 + this.next * this.stepDur < horizon) {
      const abs = this.next;
      const s = abs % STEPS;
      if (!this.loop && abs >= STEPS) {
        // let the last notes ring, then stop
        const endAt = this.t0 + STEPS * this.stepDur;
        window.clearInterval(this.timer);
        window.setTimeout(() => {
          this.playing = false;
          this.onEnd?.();
        }, Math.max(0, (endAt - c.currentTime) * 1000));
        return;
      }
      const t = this.t0 + abs * this.stepDur;
      for (const n of this.notes) {
        if (n.step !== s) continue;
        playNote(n.inst, n.midi, n.vel, n.len * this.stepDur, t + n.strum);
      }
      if (this.beat !== "off") {
        const pat = PATTERNS[this.beat];
        const swingT = s % 2 === 1 ? pat.swing * this.stepDur : 0;
        for (const [z, v] of pat.steps[s % 16]) drum(c, t + swingT, z, v * 0.8);
      }
      this.next++;
    }
  }
}

/* ---------------- packing a song for saving / sending ---------------- */
const MAX_POINTS = 3000;
export function cleanSong(raw: unknown): Song | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<Song>;
  const scale = (r.scale && r.scale in SCALES ? r.scale : "penta") as ScaleId;
  const beat = (r.beat && r.beat in BEATS ? r.beat : "off") as BeatId;
  const strokes: Stroke[] = [];
  let pts = 0;
  for (const s of Array.isArray(r.strokes) ? r.strokes : []) {
    if (!s || !(s.i in INSTRUMENTS) || !Array.isArray(s.p)) continue;
    const p = s.p.filter((v) => typeof v === "number" && Number.isFinite(v)).map((v, k) => Math.round(Math.max(0, Math.min(k % 2 ? H : W, v))));
    if (p.length < 2 || p.length % 2) continue;
    pts += p.length / 2;
    if (pts > MAX_POINTS) break;
    strokes.push({ i: s.i, s: s.s === 0 || s.s === 2 ? s.s : 1, p });
  }
  return {
    v: 1,
    scale,
    key: Math.max(0, Math.min(11, Math.round(Number(r.key) || 0))),
    bpm: Math.max(60, Math.min(180, Math.round(Number(r.bpm) || 100))),
    beat,
    strokes,
  };
}
/** A ready-made little song to start from: a flowing melody, a few bell sparkles, a walking bass
 *  and a simple groove, in a happy or dreamy scale. Different every time. */
export function surpriseSong(seed = Math.floor(Math.random() * 2 ** 31)): Song {
  let s = seed >>> 0 || 1;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const scale: ScaleId = (["penta", "major", "penta", "minor", "yaman"] as ScaleId[])[Math.floor(rnd() * 5)];
  const song: Song = { v: 1, scale, key: Math.floor(rnd() * 12), bpm: 90 + Math.floor(rnd() * 5) * 8, beat: rnd() < 0.5 ? "pop" : "lofi", strokes: [] };
  const rh = rowH(scale);
  // melody: a smooth random walk through the middle of the canvas
  const ctrl: number[] = [];
  let y = H * (0.35 + rnd() * 0.2);
  for (let k = 0; k <= 8; k++) {
    ctrl.push(y);
    y = Math.max(H * 0.18, Math.min(H * 0.62, y + (rnd() - 0.5) * rh * 7));
  }
  const mel: number[] = [];
  for (let x = 8; x <= W - 8; x += 10) {
    const u = (x / W) * 8;
    const k = Math.min(7, Math.floor(u));
    const f = u - k;
    const e = f * f * (3 - 2 * f);
    mel.push(x, Math.round(ctrl[k] + (ctrl[k + 1] - ctrl[k]) * e));
  }
  song.strokes.push({ i: "piano", s: 1, p: mel });
  // bells: a few sparkles high up
  for (let b = 0; b < 4; b++) {
    const x = Math.round((b * 4 + 2 + Math.floor(rnd() * 2)) * 4 * COL + COL / 2);
    const by = Math.round(H * (0.12 + rnd() * 0.14));
    song.strokes.push({ i: "bells", s: 1, p: [x, by, x + Math.round(COL * 1.5), by] });
  }
  // bass: one note per bar, stepping between nearby roots, low down
  const bass: number[] = [];
  for (let bar = 0; bar < 4; bar++) {
    const by = Math.round(H - rh * (1.5 + Math.floor(rnd() * 3)));
    bass.push(bar * 16 * COL + 6, by, (bar + 1) * 16 * COL - 6, by);
  }
  for (let k = 0; k < bass.length; k += 4) song.strokes.push({ i: "bass", s: 1, p: bass.slice(k, k + 4) });
  // drums: kick on 1 and 3, snare on 2 and 4 (as dots), light hats
  for (let beat = 0; beat < 16; beat++) {
    const x = Math.round(beat * 4 * COL + COL / 2);
    const zone = beat % 2 === 0 ? 0 : 2;
    song.strokes.push({ i: "drums", s: zone === 0 ? 2 : 1, p: [x, Math.round(H - (zone + 0.5) * (H / 4))] });
  }
  if (song.beat === "pop") song.strokes.push({ i: "drums", s: 0, p: [6, Math.round(H * 0.06), W - 6, Math.round(H * 0.06)] });
  song.beat = "off"; // the drawn drums are the groove
  return song;
}

export const pointCount =(song: Song) => song.strokes.reduce((n, s) => n + s.p.length / 2, 0);
export const POINT_LIMIT = MAX_POINTS;
