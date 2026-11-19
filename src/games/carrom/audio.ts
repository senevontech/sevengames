/* Carrom sounds.

   1) Recorded samples, if present: drop real carrom recordings into /public/sounds/carrom/
      (hit-coin.mp3, hit-striker.mp3, wall.mp3, pot.mp3, flick.mp3). Each one that loads is used,
      with small pitch/volume variation per hit so repeats don't sound identical.
   2) Otherwise (or for anything missing) physical-model synthesis, built like the real thing:
      - an impact is a 1-3 ms noise "knock" ringing a bank of tuned resonators (the wood / resin
        of the discs). Harder hits are brighter (the knock is less filtered), a heavier striker
        rings lower, and each mode decays at its own rate, like real hard wood
      - the plywood board answers every hit with a short low "thump" underneath
      - the frame is wood: a dull, short "thok" with little ring
      - pocket: a tick on the pocket edge, the soft drop into the cloth net, then the coin
        clinking against the ones already inside
      - discs slide on boric powder: a fine, grainy hiss whose texture flickers like real powder
   Sounds are panned by where they happen and sent through a small wooden-room reverb.

   Dynamics (tuned so it sounds like a real board, not a wall of clicks):
      - loudness follows impact speed on an expanding curve: a light touch is a faint tick,
        a smash is a sharp clack (~30 dB apart), instead of everything at a similar level
      - very light contacts (coins settling) make no sound at all
      - softer hits are also darker (less high end), like real wood
      - only a gentle safety limiter on the output (no squashing), little reverb, a faint
        powder hiss, and a cap on how many sounds overlap during a break */

const MUTE_KEY = "senevon:carrom-mute";
const SAMPLE_NAMES = ["hit-coin", "hit-striker", "wall", "pot", "flick"] as const;
type SampleName = (typeof SAMPLE_NAMES)[number];

/** [frequency Hz, decay seconds, gain] */
type Mode = [freq: number, decay: number, amp: number];

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

const MASTER = 0.7;
/** impact speed (px/s) that counts as a full-strength hit */
const FULL = 1500;
/** quieter than this and a contact makes no sound (coins nudging / settling) */
const SILENT_BELOW = 140;

/** Impact speed → loudness 0..1 on an expanding curve: soft touches are much quieter than smashes. */
function level(speed: number) {
  const v = Math.max(0, Math.min(1, (speed - SILENT_BELOW) / (FULL - SILENT_BELOW)));
  return Math.pow(v, 1.6);
}

class CarromAudio {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private master: GainNode | null = null;
  private wet: GainNode | null = null;
  private slideGain: GainNode | null = null;
  private slideFilter: BiquadFilterNode | null = null;
  private grainGain: GainNode | null = null;
  private samples = new Map<SampleName, AudioBuffer>();
  private recent: number[] = [];
  muted = (() => {
    try {
      return localStorage.getItem(MUTE_KEY) === "1";
    } catch {
      return false;
    }
  })();

  /** Must be called from a user gesture (browsers block audio until then). */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const c = new AC();
    this.ctx = c;

    const comp = c.createDynamicsCompressor();
    // a safety limiter only: loud hits stay louder than soft ones
    comp.threshold.value = -4;
    comp.knee.value = 4;
    comp.ratio.value = 8;
    comp.attack.value = 0.002;
    comp.release.value = 0.12;
    comp.connect(c.destination);
    this.master = c.createGain();
    this.master.gain.value = this.muted ? 0 : MASTER;
    this.master.connect(comp);

    // shared white noise
    const len = c.sampleRate * 2;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // small wooden room: short, dark, early-reflection-heavy tail
    const irLen = Math.floor(c.sampleRate * 0.45);
    const ir = c.createBuffer(2, irLen, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const o = ir.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < irLen; i++) {
        const t = i / c.sampleRate;
        lp += ((Math.random() * 2 - 1) - lp) * 0.28;
        // a few discrete early reflections (table, walls) + a dark diffuse tail
        const early = [0.007, 0.013, 0.021].some((e) => Math.abs(t - e - ch * 0.0017) < 0.0004) ? 0.6 : 0;
        o[i] = (lp * Math.exp(-t * 11) + early * Math.exp(-t * 30)) * (t < 0.002 ? t / 0.002 : 1);
      }
    }
    const verb = c.createConvolver();
    verb.buffer = ir;
    this.wet = c.createGain();
    this.wet.gain.value = 0.09;
    this.wet.connect(verb).connect(this.master);

    // powder slide: band-passed noise, its level flickered by a slow noise "grain" signal
    const slide = c.createBufferSource();
    slide.buffer = this.noise;
    slide.loop = true;
    this.slideFilter = c.createBiquadFilter();
    this.slideFilter.type = "bandpass";
    this.slideFilter.frequency.value = 1400;
    this.slideFilter.Q.value = 0.5;
    const soften = c.createBiquadFilter();
    soften.type = "lowpass";
    soften.frequency.value = 4200;
    this.grainGain = c.createGain();
    this.grainGain.gain.value = 0.75;
    const grain = c.createBufferSource();
    grain.buffer = this.noise;
    grain.loop = true;
    grain.playbackRate.value = 0.01; // very slow noise = random 20-60 Hz flutter
    const grainDepth = c.createGain();
    grainDepth.gain.value = 0.5;
    grain.connect(grainDepth).connect(this.grainGain.gain);
    this.slideGain = c.createGain();
    this.slideGain.gain.value = 0;
    // a quiet low rumble of the discs on the plywood, under the hiss
    const rumbleF = c.createBiquadFilter();
    rumbleF.type = "lowpass";
    rumbleF.frequency.value = 260;
    const rumble = c.createGain();
    rumble.gain.value = 0.9;
    slide.connect(this.slideFilter).connect(soften).connect(this.grainGain).connect(this.slideGain);
    slide.connect(rumbleF).connect(rumble).connect(this.slideGain);
    this.slideGain.connect(this.master);
    slide.start();
    grain.start();

    void this.loadSamples();
  }

  private async loadSamples() {
    const c = this.ctx;
    if (!c) return;
    await Promise.all(
      SAMPLE_NAMES.map(async (name) => {
        try {
          const res = await fetch(`/sounds/carrom/${name}.mp3`);
          const type = res.headers.get("content-type") ?? "";
          if (!res.ok || type.includes("html")) return; // missing file (SPA fallback page)
          const buf = await c.decodeAudioData(await res.arrayBuffer());
          this.samples.set(name, buf);
        } catch {
          /* no sample: synthesis covers it */
        }
      }),
    );
  }

  setMuted(m: boolean) {
    this.muted = m;
    try {
      localStorage.setItem(MUTE_KEY, m ? "1" : "0");
    } catch {
      /* ignore */
    }
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : MASTER, this.ctx.currentTime, 0.02);
  }

  private ready() {
    return !this.muted && !!this.ctx && !!this.master && this.ctx.state === "running";
  }

  private ok() {
    if (!this.ready()) return false;
    const now = performance.now();
    this.recent = this.recent.filter((t) => now - t < 90);
    if (this.recent.length >= 5) return false;
    this.recent.push(now);
    return true;
  }

  /** Output for one sound: panned by board x (0..1000), with a send to the room reverb. */
  private out(x = 500, dry = 1, send = 1): AudioNode {
    const c = this.ctx!;
    const g = c.createGain();
    g.gain.value = dry;
    let node: AudioNode = g;
    if (typeof c.createStereoPanner === "function") {
      const p = c.createStereoPanner();
      p.pan.value = Math.max(-0.7, Math.min(0.7, (x / 1000) * 2 - 1)) * 0.8;
      g.connect(p);
      node = p;
    }
    node.connect(this.master!);
    const s = c.createGain();
    s.gain.value = send;
    node.connect(s).connect(this.wet!);
    return g;
  }

  /** Play a recorded sample if we have it. */
  private sample(name: SampleName, dest: AudioNode, vol: number, rate = 1, at = 0) {
    const buf = this.samples.get(name);
    if (!buf) return false;
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate * rnd(0.96, 1.04);
    const g = c.createGain();
    g.gain.value = vol * rnd(0.9, 1.05);
    src.connect(g).connect(dest);
    src.start(c.currentTime + at);
    return true;
  }

  /** A short noise "knock" (the excitation): `bright` 0..1 opens the filter like a harder hit. */
  private knock(at: number, ms: number, bright: number) {
    const c = this.ctx!;
    const t = c.currentTime + at;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 900 + Math.pow(bright, 1.2) * 7500;
    const g = c.createGain();
    g.gain.setValueAtTime(1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + ms / 1000);
    src.connect(lp).connect(g);
    src.start(t, Math.random() * 1.5, ms / 1000 + 0.02);
    return g;
  }

  /** Ring a bank of resonators (band-pass filters) with a knock: Q is set from each mode's decay. */
  private resonate(dest: AudioNode, at: number, modes: Mode[], vol: number, bright: number, knockMs = 2) {
    const exc = this.knock(at, knockMs, bright);
    for (const [f, decay, amp] of modes) {
      const bp = this.ctx!.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = f;
      bp.Q.value = Math.max(2, Math.PI * f * decay * 0.7);
      const g = this.ctx!.createGain();
      // a resonator's output level falls as Q rises; compensate so modes stay balanced
      g.gain.value = vol * amp * Math.sqrt(bp.Q.value) * 1.5;
      exc.connect(bp).connect(g).connect(dest);
    }
    // a little of the raw knock itself: the "click" of contact
    const click = this.ctx!.createGain();
    click.gain.value = vol * 0.07 * bright * bright;
    exc.connect(click).connect(dest);
  }

  /** Low thump of the plywood board under an impact. */
  private boardThump(dest: AudioNode, at: number, vol: number) {
    this.resonate(dest, at, [[rnd(105, 130), 0.07, 1], [rnd(210, 240), 0.04, 0.45]], vol, 0.1, 4);
  }

  /** Coin / striker collision. `mass` = striker mass (heavier → deeper, fuller). */
  hit(strength: number, striker: boolean, x = 500, mass = 1.7) {
    if (strength < SILENT_BELOW || !this.ok()) return;
    const v = Math.min(1, strength / FULL);
    // the striker is heavier: its hits carry more weight than coin-on-coin ticks
    const vol = (striker ? 0.62 : 0.42) * Math.max(0.03, level(strength));
    const o = this.out(x, 1, 0.7);
    if (this.sample(striker ? "hit-striker" : "hit-coin", o, vol * 1.3, striker ? 1.7 / mass : rnd(0.95, 1.08))) return;
    // coins are small, hard and bright; the striker is bigger and heavier → lower, fuller
    const pitch = striker ? 1 / Math.pow(mass / 1.7, 0.6) : 1;
    const base = (striker ? 1350 : 2350) * pitch * rnd(0.95, 1.05);
    this.resonate(
      o,
      0,
      [
        [base, striker ? 0.03 : 0.022, 1],
        [base * 1.59, 0.018, 0.6],
        [base * 2.37, 0.012, 0.4],
        [base * 3.42, 0.008, 0.25],
      ],
      vol * 0.5,
      v,
      striker ? 2.5 : 1.5,
    );
    if (striker && v > 0.25) this.boardThump(o, 0.001, vol * 0.18 * (mass / 1.7));
  }

  /** Disc into the wooden frame. */
  wall(strength: number, x = 500) {
    if (strength < SILENT_BELOW * 1.4 || !this.ok()) return;
    const v = Math.min(1, strength / FULL);
    // the rail is cushioned: a dull thud, quieter than a disc-on-disc clack
    const vol = 0.4 * Math.max(0.03, level(strength));
    const o = this.out(x, 1, 1);
    if (this.sample("wall", o, vol * 1.3)) return;
    this.resonate(o, 0, [[rnd(170, 200), 0.06, 1], [rnd(410, 450), 0.035, 0.55], [rnd(760, 820), 0.02, 0.35]], vol * 0.55, v * 0.5, 5);
    // the disc's own small click against the rail
    this.resonate(o, 0, [[2100, 0.012, 1]], vol * 0.08, v);
  }

  /** Disc into a pocket: edge tick, drop into the net, clink on the coins inside. */
  pot(kind: string, speed: number, x = 500) {
    if (!this.ok()) return;
    const v = Math.min(1, speed / 1400);
    const o = this.out(x, 1, 1.1);
    if (this.sample("pot", o, 0.7 + v * 0.3)) return;
    // brushing the pocket's wooden edge
    if (speed > 300) this.resonate(o, 0, [[rnd(900, 1050), 0.02, 1], [1900, 0.01, 0.4]], 0.05 + v * v * 0.14, v * 0.6);
    // the soft fall into the cloth net
    const c = this.ctx!;
    const t = c.currentTime + 0.16;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 700;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.14, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    src.connect(lp).connect(g).connect(o);
    src.start(t, Math.random(), 0.2);
    this.resonate(o, 0.17, [[rnd(120, 140), 0.08, 1]], 0.3, 0.1, 5);
    // clinking against the coins already in the net: two or three quick, quieter clicks
    const clinks = 2 + (Math.random() < 0.5 ? 1 : 0);
    for (let i = 0; i < clinks; i++) {
      const at = 0.3 + i * rnd(0.05, 0.09);
      this.resonate(o, at, [[rnd(2100, 2700), 0.015, 1], [rnd(3300, 3900), 0.009, 0.5]], 0.045 / (i + 1), 0.5);
    }
    if (kind === "queen") {
      // the queen is the same material: give it a slightly fuller, longer clink
      this.resonate(o, 0.3, [[1650, 0.05, 1], [2600, 0.03, 0.5]], 0.12, 0.8);
    }
  }

  /** Fast coin clipping the pocket jaw and bouncing back out. */
  rattle(x = 500) {
    if (!this.ok()) return;
    const o = this.out(x, 1, 1);
    this.resonate(o, 0, [[1050, 0.025, 1], [2200, 0.012, 0.5]], 0.2, 0.6);
    this.resonate(o, 0.04, [[980, 0.02, 1]], 0.12, 0.5);
    this.boardThump(o, 0.005, 0.08);
  }

  /** The finger flicking the striker: a nail "tsk" and the striker leaving. */
  flick(power: number, x = 500) {
    if (!this.ok()) return;
    const o = this.out(x, 1, 0.5);
    if (this.sample("flick", o, 0.5 + power * 0.5)) return;
    const p = Math.pow(Math.max(0, Math.min(1, power)), 1.4);
    this.resonate(o, 0, [[rnd(3400, 4200), 0.006, 1]], 0.04 + p * 0.14, 0.4 + p * 0.5, 1);
    this.resonate(o, 0.003, [[rnd(240, 280), 0.035, 1]], 0.06 + p * 0.2, 0.2, 3);
  }

  /** Striker nudged along the baseline (slider): a short powdery scuff. */
  scrape(x = 500) {
    if (!this.ok()) return;
    const c = this.ctx!;
    const o = this.out(x, 1, 0.2);
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = rnd(1300, 1800);
    bp.Q.value = 0.7;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    src.connect(bp).connect(g).connect(o);
    src.start(t, Math.random(), 0.08);
  }

  /** Clock tick for the last seconds of a turn: a small wooden knock. */
  tick(urgent: boolean) {
    if (!this.ready()) return;
    this.resonate(this.out(500, 1, 0.3), 0, [[urgent ? 1900 : 1500, 0.02, 1]], urgent ? 0.12 : 0.07, 0.5);
  }

  /** Time ran out: two low knocks on the frame. */
  timeout() {
    if (!this.ready()) return;
    const o = this.out(500, 1, 0.8);
    this.resonate(o, 0, [[300, 0.06, 1], [620, 0.03, 0.4]], 0.4, 0.4, 4);
    this.resonate(o, 0.16, [[220, 0.08, 1], [450, 0.03, 0.4]], 0.4, 0.4, 4);
  }

  /** Your turn starts: a light tap on the frame. */
  turn() {
    if (!this.ready()) return;
    const o = this.out(500, 0.8, 0.8);
    this.resonate(o, 0, [[880, 0.04, 1]], 0.12, 0.4);
    this.resonate(o, 0.08, [[1320, 0.04, 1]], 0.1, 0.4);
  }

  /** Shop: upgrade / purchase — a bright metallic "shing". */
  upgrade() {
    if (!this.ready()) return;
    const o = this.out(500, 0.8, 1.4);
    this.resonate(o, 0, [[1568, 0.35, 1], [2349, 0.25, 0.6], [3136, 0.18, 0.35]], 0.12, 0.9);
    this.resonate(o, 0.09, [[2093, 0.4, 1], [3136, 0.25, 0.5]], 0.1, 0.9);
  }

  /** Continuous slide hiss, driven every frame by the summed speed of moving discs (0 = silent). */
  slide(totalSpeed: number) {
    if (!this.ctx || !this.slideGain || !this.slideFilter) return;
    const t = this.ctx.currentTime;
    const k = Math.min(1, Math.max(0, totalSpeed - 120) / 2600);
    const g = this.muted ? 0 : 0.035 * Math.pow(k, 1.3);
    this.slideGain.gain.setTargetAtTime(g, t, 0.06);
    this.slideFilter.frequency.setTargetAtTime(700 + k * 1100, t, 0.08);
  }
}

export const carromAudio = new CarromAudio();
