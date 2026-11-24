/* Draw a Tune: turning a drawing into notes, and playing them.
   The canvas is a timeline: a bar sweeps left → right across 64 steps (four bars of 16ths).
   Height is pitch, snapped to the chosen scale, so anything you draw is in key. Each pen colour is
   an instrument; a thicker pen plays louder. The sounds themselves are in synth.ts.
   Some instruments, beats, scales and effects are unlocked in the Music shop (LOCKS below); a song
   that uses them still plays for everyone. */

export const W = 1200;
export const H = 900;
export const STEPS = 64;
export const COL = W / STEPS;

export type Inst = "piano" | "bells" | "strings" | "bass" | "drums" | "guitar" | "sitar" | "flute" | "synth" | "tabla";
export type ScaleId = "major" | "minor" | "penta" | "blues" | "bhairav" | "yaman" | "japanese" | "hijaz" | "dorian" | "todi";
export type BeatId = "off" | "pop" | "lofi" | "dhol" | "trap" | "house" | "dembow";
/** one pen stroke: instrument, size (0 thin … 2 thick), points as x,y,x,y… in canvas units */
export type Stroke = { i: Inst; s: 0 | 1 | 2; p: number[] };
export type Song = { v: 1; scale: ScaleId; key: number; bpm: number; beat: BeatId; strokes: Stroke[]; fx?: { echo?: boolean } };

export const INSTRUMENTS: Record<Inst, { name: string; color: string }> = {
  piano: { name: "Piano", color: "#4cc3ff" },
  bells: { name: "Bells", color: "#ffd25a" },
  strings: { name: "Strings", color: "#b98cff" },
  bass: { name: "Bass", color: "#43e08b" },
  drums: { name: "Drums", color: "#ff6b6b" },
  guitar: { name: "Guitar", color: "#ff9f43" },
  sitar: { name: "Sitar", color: "#ff5fa2" },
  flute: { name: "Flute", color: "#2ad4c4" },
  synth: { name: "Synth", color: "#c3f73a" },
  tabla: { name: "Tabla", color: "#d08a55" },
};
export const INST_ORDER: Inst[] = ["piano", "bells", "strings", "bass", "drums"];
export const EXTRA_INST: Inst[] = ["guitar", "sitar", "flute", "synth", "tabla"];
/** pitch shift each instrument plays at (for note names) */
export const OCT_SHIFT: Partial<Record<Inst, number>> = { bells: 12, flute: 12, bass: -24, guitar: -12 };
/** kits: the height picks the drum instead of a note */
export const isKit = (i: Inst) => i === "drums" || i === "tabla";
export const KIT_ZONES: Record<"drums" | "tabla", string[]> = { drums: ["Kick", "Tom", "Snare", "Hi-hat"], tabla: ["Ge", "Na", "Tin", "Ti"] };

/** what needs unlocking in the Music shop (item ids in src/lib/shopCatalog.ts TUNE_ITEMS) */
export const INST_LOCK: Partial<Record<Inst, string>> = { guitar: "tinst:guitar", sitar: "tinst:sitar", flute: "tinst:flute", synth: "tinst:synth", tabla: "tinst:tabla" };
export const SCALE_LOCK: Partial<Record<ScaleId, string>> = { japanese: "tscale:world", hijaz: "tscale:world", dorian: "tscale:world", todi: "tscale:world" };
export const BEAT_LOCK: Partial<Record<BeatId, string>> = { trap: "tbeat:trap", house: "tbeat:house", dembow: "tbeat:dembow" };
export const ECHO_ITEM = "tfx:echo";

export const SCALES: Record<ScaleId, { name: string; steps: number[] }> = {
  major: { name: "Happy (major)", steps: [0, 2, 4, 5, 7, 9, 11] },
  minor: { name: "Sad (minor)", steps: [0, 2, 3, 5, 7, 8, 10] },
  penta: { name: "Pentatonic", steps: [0, 2, 4, 7, 9] },
  blues: { name: "Blues", steps: [0, 3, 5, 6, 7, 10] },
  bhairav: { name: "Raag Bhairav", steps: [0, 1, 4, 5, 7, 8, 11] },
  yaman: { name: "Raag Yaman", steps: [0, 2, 4, 6, 7, 9, 11] },
  japanese: { name: "Japanese", steps: [0, 1, 5, 7, 8] },
  hijaz: { name: "Hijaz", steps: [0, 1, 4, 5, 7, 8, 10] },
  dorian: { name: "Dorian", steps: [0, 2, 3, 5, 7, 9, 10] },
  todi: { name: "Raag Todi", steps: [0, 1, 3, 6, 7, 8, 11] },
};
export const KEYS = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
export const BEATS: Record<BeatId, string> = { off: "No beat", pop: "Pop", lofi: "Lo-fi", dhol: "Dhol", trap: "Trap", house: "House", dembow: "Dembow" };
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

const RETRIGGER: Record<Inst, number> = { piano: 2, bells: 2, strings: 16, bass: 4, drums: 2, guitar: 2, sitar: 2, flute: 16, synth: 2, tabla: 2 };
const MAX_CHORD = 4;

export function songNotes(song: Song): NoteEv[] {
  const rh = rowH(song.scale);
  const out: NoteEv[] = [];
  for (const st of song.strokes) {
    const vel = [0.55, 0.78, 1][st.s] ?? 0.78;
    const drums = isKit(st.i);
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
    fx: r.fx && typeof r.fx === "object" && r.fx.echo ? { echo: true } : undefined,
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
