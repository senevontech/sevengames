/* Draw a Tune: the synthesiser, the transport and audio export.
   Everything is synthesised with WebAudio (no samples). Every voice plays into a "bus" (limiter,
   hall reverb, optional tempo-synced echo), so the very same instruments can play live or be
   rendered offline into a WAV file ("Save as audio").
     piano    hammered, slightly stretched partials      guitar  plucked steel string
     bells    FM glockenspiel, an octave up              sitar   buzzing strings with a bend (meend)
     strings  bowed, detuned saws with vibrato           flute   breathy, an octave up
     bass     plucked, two octaves down                  synth   bright filtered lead
     drums    kick / tom / snare / hat by height         tabla   ge / na / tin / ti, tuned to the key */
import { STEPS, type BeatId, type Inst, type NoteEv, type Song } from "./music";

type Bus = {
  c: BaseAudioContext;
  out: AudioNode;
  verb: AudioNode;
  echoIn: GainNode;
  echoWet: GainNode;
  delay: DelayNode;
  noise: AudioBuffer;
};

function buildBus(c: BaseAudioContext, dest: AudioNode): Bus {
  const lim = c.createDynamicsCompressor();
  lim.threshold.value = -14;
  lim.knee.value = 8;
  lim.ratio.value = 5;
  lim.attack.value = 0.003;
  lim.release.value = 0.2;
  lim.connect(dest);
  const out = c.createGain();
  out.gain.value = 0.85;
  out.connect(lim);
  // a warm hall: decaying filtered noise
  const conv = c.createConvolver();
  const len = Math.floor(c.sampleRate * 2.2);
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      lp = lp * 0.82 + (Math.random() * 2 - 1) * 0.18;
      d[i] = lp * Math.pow(1 - i / len, 2.6) * (i < 400 ? i / 400 : 1);
    }
  }
  conv.buffer = buf;
  const verb = c.createGain();
  verb.gain.value = 0.5;
  verb.connect(conv).connect(lim);
  // echo: a dotted-eighth delay with soft, darkening repeats
  const echoIn = c.createGain();
  const delay = c.createDelay(2);
  delay.delayTime.value = 0.45;
  const fb = c.createGain();
  fb.gain.value = 0.38;
  const tone = c.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 2600;
  const echoWet = c.createGain();
  echoWet.gain.value = 0;
  echoIn.connect(echoWet).connect(delay);
  delay.connect(tone).connect(fb).connect(delay);
  tone.connect(out);
  const nl = c.sampleRate;
  const noise = c.createBuffer(1, nl, c.sampleRate);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nl; i++) nd[i] = Math.random() * 2 - 1;
  return { c, out, verb, echoIn, echoWet, delay, noise };
}

function setEcho(b: Bus, on: boolean, bpm: number) {
  const t = b.c.currentTime;
  b.delay.delayTime.setTargetAtTime(Math.min(1.9, (60 / bpm) * 0.75), t, 0.05);
  b.echoWet.gain.setTargetAtTime(on ? 0.42 : 0, t, 0.05);
}

let live: { ctx: AudioContext; bus: Bus } | null = null;
function liveBus(): Bus | null {
  try {
    if (!live) {
      const ctx = new AudioContext({ latencyHint: "interactive" });
      live = { ctx, bus: buildBus(ctx, ctx.destination) };
    }
    if (live.ctx.state === "suspended") void live.ctx.resume();
    return live.bus;
  } catch {
    return null;
  }
}
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** an output for one voice: gain → pan → bus (+ reverb and echo sends) */
function voice(b: Bus, pan: number, send: number) {
  const c = b.c;
  const g = c.createGain();
  g.gain.value = 0;
  const p = c.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  g.connect(p).connect(b.out);
  p.connect(b.echoIn);
  if (send > 0) {
    const s = c.createGain();
    s.gain.value = send;
    p.connect(s).connect(b.verb);
  }
  return g;
}
function noiseSrc(b: Bus, t: number, dur: number) {
  const n = b.c.createBufferSource();
  n.buffer = b.noise;
  n.start(t, Math.random() * 0.5);
  n.stop(t + dur);
  return n;
}
function osc(b: Bus, type: OscillatorType, f: number, t: number, end: number, to: AudioNode, amp = 1, detune = 0) {
  const o = b.c.createOscillator();
  o.type = type;
  o.frequency.value = f;
  o.detune.value = detune;
  if (amp !== 1) {
    const a = b.c.createGain();
    a.gain.value = amp;
    o.connect(a).connect(to);
  } else o.connect(to);
  o.start(t);
  o.stop(end);
  return o;
}

/* ---------------- the instruments ---------------- */
function piano(b: Bus, t: number, m: number, vel: number, dur: number) {
  const c = b.c;
  const f = mtof(m);
  const decay = 2.6 * Math.pow(0.5, (m - 48) / 24);
  const g = voice(b, (m - 66) / 60, 0.28);
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
  [1, 2, 3, 4, 5].forEach((n, i) => {
    const amp = [1, 0.5, 0.22, 0.12, 0.05][i];
    for (const det of n === 1 ? [-1.2, 1.2] : [0]) osc(b, "sine", f * n * Math.sqrt(1 + 0.00035 * n * n), t, end, lp, amp / (n === 1 ? 2 : 1), det);
  });
  const hn = noiseSrc(b, t, 0.03);
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = Math.min(9000, f * 3);
  bp.Q.value = 1.2;
  const hg = c.createGain();
  hg.gain.setValueAtTime(0.06 * vel, t);
  hg.gain.exponentialRampToValueAtTime(0.0005, t + 0.03);
  hn.connect(bp).connect(hg).connect(g);
}

function bells(b: Bus, t: number, m: number, vel: number) {
  const c = b.c;
  const f = mtof(m + 12);
  const g = voice(b, 0.28, 0.45);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.12 * vel, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0004, t + 2.2);
  const car = osc(b, "sine", f, t, t + 2.3, g);
  const mod = c.createOscillator();
  mod.frequency.value = f * 3.5;
  const mg = c.createGain();
  mg.gain.setValueAtTime(f * 1.6 * vel, t);
  mg.gain.exponentialRampToValueAtTime(f * 0.05, t + 0.6);
  mod.connect(mg).connect(car.frequency);
  mod.start(t);
  mod.stop(t + 2.3);
  const g2 = c.createGain();
  g2.gain.setValueAtTime(0.25, t);
  g2.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
  g2.connect(g);
  osc(b, "sine", f * 2.76, t, t + 0.6, g2);
}

function strings(b: Bus, t: number, m: number, vel: number, dur: number) {
  const c = b.c;
  const f = mtof(m);
  const g = voice(b, -0.3, 0.55);
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
  lfo.start(t);
  lfo.stop(t + hold + 1);
  [-7, 7, 0].forEach((det, i) => {
    const o = osc(b, "sawtooth", i === 2 ? f / 2 : f, t, t + hold + 1, lp, i === 2 ? 0.35 : 0.5, det);
    lg.connect(o.detune);
  });
}

function bass(b: Bus, t: number, m: number, vel: number, dur: number) {
  const c = b.c;
  const f = mtof(m - 24);
  const g = voice(b, 0, 0.08);
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
  osc(b, "sawtooth", f, t, t + hold + 0.4, lp);
  osc(b, "sine", f, t, t + hold + 0.4, g, 0.9);
}

/** a plucked string from decaying partials: the pluck point shapes the tone */
function pluck(b: Bus, t: number, f: number, vel: number, dur: number, o: { pan: number; send: number; partials: number; pos: number; decay: number; bright: number; bend: number; buzz: boolean; level: number }) {
  const c = b.c;
  const g = voice(b, o.pan, o.send);
  const ring = Math.max(dur + 0.35, 0.6);
  const end = t + ring + 0.3;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(o.level * vel, t + 0.003);
  g.gain.setValueAtTime(o.level * vel, t + ring);
  g.gain.setTargetAtTime(0, t + ring, 0.07);
  let sum: AudioNode = g;
  if (o.buzz) {
    // the sitar's jawari: the string grazes the curved bridge
    const ws = c.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(2.6 * x) * 0.75;
    }
    ws.curve = curve;
    ws.connect(g);
    sum = ws;
  }
  for (let n = 1; n <= o.partials; n++) {
    const amp = Math.abs(Math.sin(Math.PI * n * o.pos)) / Math.pow(n, o.bright);
    if (amp < 0.01) continue;
    const pg = c.createGain();
    pg.gain.setValueAtTime(amp, t);
    pg.gain.setTargetAtTime(0, t + 0.003, o.decay / (1 + 0.45 * n));
    pg.connect(sum);
    const ob = osc(b, n % 2 && o.buzz ? "triangle" : "sine", f * n * (1 + 0.0006 * n), t, end, pg);
    if (o.bend) {
      ob.frequency.setValueAtTime(f * n * (1 - o.bend), t);
      ob.frequency.exponentialRampToValueAtTime(f * n * (1 + 0.0006 * n), t + 0.08);
    }
  }
  // the pick / the finger on the string
  const pn = noiseSrc(b, t, 0.02);
  const hp = c.createBiquadFilter();
  hp.type = "bandpass";
  hp.frequency.value = Math.min(8000, f * 4);
  const pgn = c.createGain();
  pgn.gain.setValueAtTime(0.18 * vel, t);
  pgn.gain.exponentialRampToValueAtTime(0.0005, t + 0.02);
  pn.connect(hp).connect(pgn).connect(g);
}

function guitar(b: Bus, t: number, m: number, vel: number, dur: number) {
  const f = mtof(m - 12);
  pluck(b, t, f, vel, dur, { pan: -0.2, send: 0.25, partials: 9, pos: 0.18, decay: 2.2 * Math.pow(0.6, (m - 48) / 24), bright: 0.9, bend: 0, buzz: false, level: 0.16 });
}

function sitar(b: Bus, t: number, m: number, vel: number, dur: number) {
  const f = mtof(m);
  pluck(b, t, f, vel, dur, { pan: 0.18, send: 0.4, partials: 10, pos: 0.11, decay: 2.8, bright: 0.55, bend: 0.03, buzz: true, level: 0.11 });
  // sympathetic strings shimmer a moment later
  const c = b.c;
  const g = voice(b, -0.35, 0.6);
  g.gain.setValueAtTime(0, t + 0.04);
  g.gain.linearRampToValueAtTime(0.018 * vel, t + 0.12);
  g.gain.exponentialRampToValueAtTime(0.0004, t + 2.4);
  osc(b, "sine", f * 2, t, t + 2.5, g);
  osc(b, "sine", f * 3, t, t + 2.5, g, 0.6);
  void c;
}

function flute(b: Bus, t: number, m: number, vel: number, dur: number) {
  const c = b.c;
  const f = mtof(m + 12);
  const g = voice(b, 0.12, 0.5);
  const hold = Math.max(dur, 0.18);
  const peak = 0.11 * vel;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak * 1.15, t + 0.06);
  g.gain.linearRampToValueAtTime(peak, t + 0.16);
  g.gain.setValueAtTime(peak, t + hold);
  g.gain.setTargetAtTime(0, t + hold, 0.09);
  const end = t + hold + 0.6;
  const lfo = c.createOscillator();
  lfo.frequency.value = 5.1;
  const lg = c.createGain();
  lg.gain.setValueAtTime(0, t);
  lg.gain.linearRampToValueAtTime(0, t + 0.25);
  lg.gain.linearRampToValueAtTime(9, t + 0.6);
  lfo.connect(lg);
  lfo.start(t);
  lfo.stop(end);
  const o1 = osc(b, "sine", f, t, end, g);
  const o2 = osc(b, "triangle", f * 2, t, end, g, 0.1);
  lg.connect(o1.detune);
  lg.connect(o2.detune);
  // breath: noise tuned to the note, and a puff at the start
  const n = noiseSrc(b, t, hold + 0.5);
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = f;
  bp.Q.value = 9;
  const ng = c.createGain();
  ng.gain.value = 0.9;
  n.connect(bp).connect(ng).connect(g);
  const puff = noiseSrc(b, t, 0.08);
  const hp = c.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 2500;
  const pg = c.createGain();
  pg.gain.setValueAtTime(0.05 * vel, t);
  pg.gain.exponentialRampToValueAtTime(0.0005, t + 0.08);
  puff.connect(hp).connect(pg).connect(b.out);
}

function synthLead(b: Bus, t: number, m: number, vel: number, dur: number) {
  const c = b.c;
  const f = mtof(m);
  const g = voice(b, 0.15, 0.3);
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.Q.value = 7;
  lp.frequency.setValueAtTime(Math.min(14000, f * (4 + 8 * vel)), t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(300, f * 1.8), t + 0.28);
  lp.connect(g);
  const hold = Math.max(dur, 0.12);
  const peak = 0.075 * vel;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.005);
  g.gain.setTargetAtTime(peak * 0.65, t + 0.01, 0.12);
  g.gain.setTargetAtTime(0, t + hold, 0.06);
  const end = t + hold + 0.4;
  osc(b, "sawtooth", f, t, end, lp, 0.5, -11);
  osc(b, "sawtooth", f, t, end, lp, 0.5, 11);
  osc(b, "square", f / 2, t, end, lp, 0.25);
}

/** zone: 0 kick, 1 tom, 2 snare, 3 hi-hat, 4 open hat, 5 low dhol, 6 high dhol, 7 808 */
function drum(b: Bus, t: number, zone: number, vel: number) {
  const c = b.c;
  if (zone === 0 || zone === 1 || zone === 5 || zone === 6 || zone === 7) {
    const [f0, f1, d, send, fall] =
      zone === 0 ? [150, 44, 0.42, 0.05, 0.11] : zone === 1 ? [190, 105, 0.35, 0.2, 0.18] : zone === 5 ? [120, 70, 0.5, 0.2, 0.18] : zone === 6 ? [330, 300, 0.18, 0.2, 0.18] : [120, 46, 1.1, 0.04, 0.09];
    const g = voice(b, zone === 1 ? -0.15 : 0, send);
    const o = c.createOscillator();
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + fall);
    const peak = (zone === 0 ? 0.75 : zone === 7 ? 0.7 : 0.45) * vel;
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + d);
    o.connect(g);
    o.start(t);
    o.stop(t + d + 0.02);
    const n = noiseSrc(b, t, 0.025);
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
    const g = voice(b, 0.05, 0.25);
    g.gain.value = 1;
    const n = noiseSrc(b, t, 0.22);
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
    o.start(t);
    o.stop(t + 0.1);
    return;
  }
  const open = zone === 4;
  const g = voice(b, 0.22, 0.12);
  g.gain.value = 1;
  const n = noiseSrc(b, t, open ? 0.3 : 0.06);
  const hp = c.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 7200;
  const ng = c.createGain();
  ng.gain.setValueAtTime(0.2 * vel, t);
  ng.gain.exponentialRampToValueAtTime(0.0005, t + (open ? 0.28 : 0.045));
  n.connect(hp).connect(ng).connect(g);
}

/** tabla: 0 ge (bayan, with its rising swell), 1 na (rim), 2 tin (open ring), 3 ti (muted slap) */
function tabla(b: Bus, t: number, zone: number, vel: number, key: number) {
  const c = b.c;
  const f = mtof(60 + key); // the dayan is tuned to Sa
  if (zone === 0) {
    const g = voice(b, -0.1, 0.25);
    const o = c.createOscillator();
    o.frequency.setValueAtTime(78, t);
    o.frequency.linearRampToValueAtTime(108, t + 0.16);
    o.frequency.exponentialRampToValueAtTime(92, t + 0.5);
    g.gain.setValueAtTime(0.55 * vel, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.7);
    o.connect(g);
    o.start(t);
    o.stop(t + 0.72);
    const n = noiseSrc(b, t, 0.03);
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 600;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.3 * vel, t);
    ng.gain.exponentialRampToValueAtTime(0.0005, t + 0.03);
    n.connect(lp).connect(ng).connect(g);
    return;
  }
  if (zone === 3) {
    const g = voice(b, 0.12, 0.15);
    g.gain.value = 1;
    const n = noiseSrc(b, t, 0.06);
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1700;
    bp.Q.value = 1.5;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.35 * vel, t);
    ng.gain.exponentialRampToValueAtTime(0.0005, t + 0.05);
    n.connect(bp).connect(ng).connect(g);
    const og = c.createGain();
    og.gain.setValueAtTime(0.18 * vel, t);
    og.gain.exponentialRampToValueAtTime(0.0005, t + 0.07);
    og.connect(g);
    osc(b, "sine", f, t, t + 0.08, og);
    return;
  }
  // na / tin: the dayan's ringing head (stretched harmonics)
  const ringFor = zone === 2 ? 0.9 : 0.28;
  const g = voice(b, 0.14, 0.3);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.3 * vel, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0005, t + ringFor);
  const amps = zone === 2 ? [0.7, 0.35, 0.22, 0.1] : [0.5, 0.45, 0.25, 0.08];
  [1, 2, 3, 4.1].forEach((n, i) => osc(b, "sine", f * n, t, t + ringFor + 0.02, g, amps[i]));
  const n = noiseSrc(b, t, 0.012);
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 3200;
  const ng = c.createGain();
  ng.gain.setValueAtTime(0.25 * vel, t);
  ng.gain.exponentialRampToValueAtTime(0.0005, t + 0.012);
  n.connect(bp).connect(ng).connect(g);
}

function play(b: Bus, inst: Inst, midi: number, vel: number, dur: number, t: number, key: number) {
  if (inst === "piano") piano(b, t, midi, vel, dur);
  else if (inst === "bells") bells(b, t, midi, vel);
  else if (inst === "strings") strings(b, t, midi, vel, dur);
  else if (inst === "bass") bass(b, t, midi, vel, dur);
  else if (inst === "guitar") guitar(b, t, midi, vel, dur);
  else if (inst === "sitar") sitar(b, t, midi, vel, dur);
  else if (inst === "flute") flute(b, t, midi, vel, dur);
  else if (inst === "synth") synthLead(b, t, midi, vel, dur);
  else if (inst === "tabla") tabla(b, t, midi, vel, key);
  else drum(b, t, midi, vel);
}

/** one note now (or at a given audio time); for kits `midi` is the zone */
export function playNote(inst: Inst, midi: number, vel: number, dur: number, at?: number, key = 0) {
  const b = liveBus();
  if (!b) return;
  play(b, inst, midi, vel, dur, Math.max(b.c.currentTime + 0.005, at ?? 0), key);
}

/** a short demo of an instrument or beat (for "hear it before you buy") */
export function previewSound(kind: { inst?: Inst; beat?: BeatId }, key = 0) {
  const b = liveBus();
  if (!b) return;
  const t0 = b.c.currentTime + 0.05;
  if (kind.inst) {
    const kit = kind.inst === "drums" || kind.inst === "tabla";
    const seq = kit ? [0, 3, 2, 3, 0, 1, 2, 3] : [60, 64, 67, 72, 67, 64, 60];
    seq.forEach((m, i) => play(b, kind.inst!, kit ? m : m - 12 + key, 0.75, 0.22, t0 + i * 0.18, key));
  }
  if (kind.beat && kind.beat !== "off") {
    const pat = PATTERNS[kind.beat];
    const sd = 60 / 100 / 4;
    for (let s = 0; s < 32; s++) for (const [z, v] of pat.steps[s % 16]) drum(b, t0 + s * sd + (s % 2 ? pat.swing * sd : 0), z, v * 0.8);
  }
}

/* ---------------- backing beats (one bar of 16 steps, repeated) ---------------- */
type Hit = [zone: number, vel: number];
const bar = (fn: (s: number, h: Hit[]) => void) =>
  Array.from({ length: 16 }, (_, s) => {
    const h: Hit[] = [];
    fn(s, h);
    return h;
  });
export const PATTERNS: Record<Exclude<BeatId, "off">, { swing: number; steps: Hit[][] }> = {
  pop: {
    swing: 0,
    steps: bar((s, h) => {
      if ([0, 8, 10].includes(s)) h.push([0, 0.9]);
      if (s === 4 || s === 12) h.push([2, 0.75]);
      if (s % 2 === 0) h.push([3, s % 4 === 0 ? 0.5 : 0.35]);
      if (s === 14) h.push([4, 0.3]);
    }),
  },
  lofi: {
    swing: 0.22,
    steps: bar((s, h) => {
      if ([0, 7, 10].includes(s)) h.push([0, 0.7]);
      if (s === 4 || s === 12) h.push([2, 0.45]);
      if (s % 2 === 0) h.push([3, 0.22]);
    }),
  },
  dhol: {
    swing: 0.12,
    steps: bar((s, h) => {
      if ([0, 3, 6, 8, 11, 14].includes(s)) h.push([5, s % 8 === 0 ? 0.9 : 0.65]);
      if ([2, 5, 7, 10, 13, 15].includes(s)) h.push([6, 0.45]);
      if (s === 4 || s === 12) h.push([2, 0.4]);
    }),
  },
  trap: {
    swing: 0,
    steps: bar((s, h) => {
      if ([0, 3, 10].includes(s)) h.push([7, s === 0 ? 0.95 : 0.75]);
      if (s === 8) h.push([2, 0.85]);
      h.push([3, s >= 13 ? 0.32 : s % 2 === 0 ? 0.3 : 0.16]);
    }),
  },
  house: {
    swing: 0,
    steps: bar((s, h) => {
      if (s % 4 === 0) h.push([0, 0.9]);
      if (s === 4 || s === 12) h.push([2, 0.6]);
      if (s % 4 === 2) h.push([4, 0.32]);
      else if (s % 2 === 1) h.push([3, 0.14]);
    }),
  },
  dembow: {
    swing: 0.05,
    steps: bar((s, h) => {
      if (s % 4 === 0) h.push([0, 0.85]);
      if ([3, 6, 11, 14].includes(s)) h.push([2, 0.6]);
      if (s % 2 === 0) h.push([3, 0.2]);
    }),
  },
};

function scheduleBeat(b: Bus, beat: BeatId, s: number, t: number, stepDur: number) {
  if (beat === "off") return;
  const pat = PATTERNS[beat];
  const swingT = s % 2 === 1 ? pat.swing * stepDur : 0;
  for (const [z, v] of pat.steps[s % 16]) drum(b, t + swingT, z, v * 0.8);
}

/* ---------------- the transport ---------------- */
export class Player {
  private notes: NoteEv[] = [];
  private bpm = 100;
  private beat: BeatId = "off";
  private loop = true;
  private key = 0;
  private t0 = 0;
  private next = 0;
  private timer = 0;
  playing = false;
  onEnd?: () => void;

  get stepDur() {
    return 60 / this.bpm / 4;
  }
  set(notes: NoteEv[], o: { bpm: number; beat: BeatId; loop: boolean; key: number; echo: boolean }) {
    const b = live?.bus;
    if (this.playing && o.bpm !== this.bpm && live) {
      // keep the bar where it is when the tempo changes
      const pos = (live.ctx.currentTime - this.t0) / this.stepDur;
      this.bpm = o.bpm;
      this.t0 = live.ctx.currentTime - pos * this.stepDur;
    }
    this.notes = notes;
    this.bpm = o.bpm;
    this.beat = o.beat;
    this.loop = o.loop;
    this.key = o.key;
    if (b) setEcho(b, o.echo, o.bpm);
    this.echo = o.echo;
  }
  private echo = false;
  start() {
    const b = liveBus();
    if (!b || !live) return;
    this.stop();
    setEcho(b, this.echo, this.bpm);
    this.playing = true;
    this.t0 = live.ctx.currentTime + 0.08;
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
    if (!this.playing || !live) return -1;
    const p = (live.ctx.currentTime - this.t0) / this.stepDur;
    return p < 0 ? 0 : p % STEPS;
  }
  private tick() {
    const b = liveBus();
    if (!b || !live || !this.playing) return;
    const now = live.ctx.currentTime;
    const horizon = now + 0.14;
    while (this.t0 + this.next * this.stepDur < horizon) {
      const abs = this.next;
      const s = abs % STEPS;
      if (!this.loop && abs >= STEPS) {
        const endAt = this.t0 + STEPS * this.stepDur;
        window.clearInterval(this.timer);
        window.setTimeout(() => {
          this.playing = false;
          this.onEnd?.();
        }, Math.max(0, (endAt - now) * 1000));
        return;
      }
      const t = this.t0 + abs * this.stepDur;
      for (const n of this.notes) {
        if (n.step !== s) continue;
        play(b, n.inst, n.midi, n.vel, n.len * this.stepDur, t + n.strum, this.key);
      }
      scheduleBeat(b, this.beat, s, t, this.stepDur);
      this.next++;
    }
  }
}

/* ---------------- recording a clip: the song played into a MediaStream ---------------- */
/** Plays the whole song once (from a moment from now) on a fresh bus that feeds both the speakers
 *  and an audio stream, for the video recorder. Times are on the live audio clock. */
export function startRecordingAudio(song: Song, notes: NoteEv[], opts: { lead: number; audible: boolean }) {
  const b0 = liveBus();
  if (!b0 || !live) return null;
  const ctx = live.ctx;
  const streamDest = ctx.createMediaStreamDestination();
  const split = ctx.createGain();
  split.connect(streamDest);
  if (opts.audible) split.connect(ctx.destination);
  const b = buildBus(ctx, split);
  const stepDur = 60 / song.bpm / 4;
  b.echoWet.gain.value = song.fx?.echo ? 0.42 : 0;
  b.delay.delayTime.value = Math.min(1.9, (60 / song.bpm) * 0.75);
  const t0 = ctx.currentTime + opts.lead;
  for (let s = 0; s < STEPS; s++) {
    const t = t0 + s * stepDur;
    for (const n of notes) if (n.step === s) play(b, n.inst, n.midi, n.vel, n.len * stepDur, t + n.strum, song.key);
    scheduleBeat(b, song.beat, s, t, stepDur);
  }
  return {
    stream: streamDest.stream,
    t0,
    stepDur,
    now: () => ctx.currentTime,
    /** cut the sound off (cancel) */
    stop: () => {
      try {
        split.disconnect();
      } catch {
        /* already */
      }
    },
  };
}

/* ---------------- "Save as audio": render offline, encode a WAV ---------------- */
export async function renderWav(song: Song, notes: NoteEv[], passes = 2): Promise<Blob> {
  const sr = 44100;
  const stepDur = 60 / song.bpm / 4;
  const length = passes * STEPS * stepDur + 3;
  const off = new OfflineAudioContext(2, Math.ceil(length * sr), sr);
  const b = buildBus(off, off.destination);
  b.echoWet.gain.value = song.fx?.echo ? 0.42 : 0;
  b.delay.delayTime.value = Math.min(1.9, (60 / song.bpm) * 0.75);
  const t0 = 0.05;
  for (let pass = 0; pass < passes; pass++) {
    for (let s = 0; s < STEPS; s++) {
      const t = t0 + (pass * STEPS + s) * stepDur;
      for (const n of notes) if (n.step === s) play(b, n.inst, n.midi, n.vel, n.len * stepDur, t + n.strum, song.key);
      scheduleBeat(b, song.beat, s, t, stepDur);
    }
  }
  const buf = await off.startRendering();
  return wavOf(buf);
}

function wavOf(buf: AudioBuffer): Blob {
  const ch = buf.numberOfChannels;
  const n = buf.length;
  const data = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const str = (o: number, s: string) => [...s].forEach((c, i) => data.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  data.setUint32(4, 36 + n * ch * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, ch, true);
  data.setUint32(24, buf.sampleRate, true);
  data.setUint32(28, buf.sampleRate * ch * 2, true);
  data.setUint16(32, ch * 2, true);
  data.setUint16(34, 16, true);
  str(36, "data");
  data.setUint32(40, n * ch * 2, true);
  const chans = Array.from({ length: ch }, (_, i) => buf.getChannelData(i));
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, chans[c][i]));
      data.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([data], { type: "audio/wav" });
}
