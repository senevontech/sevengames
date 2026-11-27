/* Builds the celebration animations (Lottie JSON) in src/components/celebrate/.
   They are our own: generated shapes, nothing downloaded. Run after changing this file:
       node scripts/make-celebrations.mjs
   Played by react-useanimations' small SVG player. Fills only (no strokes), because that player
   recolours strokes to the text colour. */
import { mkdirSync, writeFileSync } from "node:fs";

const W = 400;
const H = 400;
const FR = 60;

// seeded random, so the files only change when this script does
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const range = (a, b) => a + rnd() * (b - a);
const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255, 1];

const ease = { o: { x: [0.2], y: [0] }, i: { x: [0.4], y: [1] } };
const lin = { o: { x: [0], y: [0] }, i: { x: [1], y: [1] } };
/** keyframed property: [[frame, value(s)], ...] */
const kf = (frames, e = ease) => ({
  a: 1,
  k: frames.map(([t, s], i) => (i < frames.length - 1 ? { t, s: [].concat(s), ...e } : { t, s: [].concat(s) })),
});
const still = (v) => ({ a: 0, k: v });

const tr = () => ({ ty: "tr", p: still([0, 0]), a: still([0, 0]), s: still([100, 100]), r: still(0), o: still(100) });
const fill = (c) => ({ ty: "fl", c: still(hex(c)), o: still(100), r: 1 });
const rect = (w, h, r = 1) => ({ ty: "rc", p: still([0, 0]), s: still([w, h]), r: still(r) });
const ellipse = (w, h) => ({ ty: "el", p: still([0, 0]), s: still([w, h]) });
/** a five-point star as a closed path */
function star(outer, inner) {
  const v = [];
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const r = i % 2 ? inner : outer;
    v.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  const z = v.map(() => [0, 0]);
  return { ty: "sh", ks: still({ i: z, o: z, v, c: true }) };
}
const group = (...items) => ({ ty: "gr", it: [...items, tr()] });

let ind = 0;
function layer({ shapes, p, r = still(0), s = still([100, 100, 100]), o = still(100), ip = 0, op }) {
  return { ddd: 0, ind: ++ind, ty: 4, sr: 1, ip, op, st: 0, ao: 0, ks: { o, r, p, a: still([0, 0, 0]), s }, shapes };
}
const comp = (nm, op, layers) => ({ v: "5.7.0", nm, fr: FR, ip: 0, op, w: W, h: H, ddd: 0, assets: [], layers });

const PARTY = ["#ff4d6d", "#ffd23f", "#3bceac", "#5e60ce", "#4ea8de", "#ff9f1c", "#f15bb5", "#80ed99"];

/* confetti: a burst from just below the middle, pieces arc out, tumble and fall */
function confetti() {
  ind = 0;
  const op = 110;
  const layers = [];
  for (let n = 0; n < 46; n++) {
    const a = range(-Math.PI * 0.95, -Math.PI * 0.05); // upward fan
    const v = range(110, 190);
    const x0 = W / 2 + range(-14, 14);
    const y0 = H * 0.62;
    const peak = [x0 + Math.cos(a) * v, y0 + Math.sin(a) * v];
    const end = [peak[0] + range(-40, 40), peak[1] + range(150, 230)];
    const t1 = Math.round(range(20, 30));
    const spin = range(-540, 540);
    const w = range(6, 11);
    const h = range(10, 16);
    const flip = Math.round(range(12, 22));
    layers.push(
      layer({
        op,
        shapes: [group(n % 4 === 0 ? ellipse(w, w) : rect(w, h, 1.5), fill(PARTY[n % PARTY.length]))],
        p: kf([[0, [x0, y0, 0]], [t1, [...peak, 0]], [op, [...end, 0]]]),
        r: kf([[0, 0], [op, spin]], lin),
        // paper flutter: squash on one axis
        s: kf([[0, [30, 30, 100]], [8, [100, 100, 100]], [8 + flip, [100, 15, 100]], [8 + flip * 2, [100, 100, 100]], [8 + flip * 3, [100, 15, 100]], [op, [100, 100, 100]]]),
        o: kf([[0, 100], [op - 28, 100], [op, 0]]),
      }),
    );
  }
  return comp("confetti", op, layers);
}

/* chips: gold coins pop up from the bottom, spin (squash on x) and drop away */
function coins() {
  ind = 0;
  const op = 100;
  const layers = [];
  for (let n = 0; n < 16; n++) {
    const x0 = W / 2 + range(-40, 40);
    const y0 = H + 30;
    const top = [x0 + range(-150, 150), range(70, 200)];
    const end = [top[0] + range(-30, 30), H + 40];
    const d = Math.round(range(0, 16));
    const t1 = d + Math.round(range(28, 38));
    const sz = range(26, 40);
    const spinT = Math.round(range(14, 22));
    const s = [[d, [100, 100, 100]]];
    for (let t = d + spinT; t < op; t += spinT) s.push([t, [s.length % 2 ? 12 : 100, 100, 100]]);
    layers.push(
      layer({
        op,
        shapes: [
          group(ellipse(sz * 0.55, sz * 0.55), fill("#ffe27a")),
          group(ellipse(sz * 0.78, sz * 0.78), fill("#e0a106")),
          group(ellipse(sz, sz), fill("#ffcc33")),
        ],
        p: kf([[0, [x0, y0, 0]], [d, [x0, y0, 0]], [t1, [...top, 0]], [op, [...end, 0]]]),
        s: kf(s),
        o: kf([[0, 0], [d, 0], [d + 1, 100], [op - 10, 100], [op, 0]]),
      }),
    );
  }
  return comp("coins", op, layers);
}

/* stars: a soft flash, then a ring of stars bursts out and fades (daily reward, level up) */
function stars() {
  ind = 0;
  const op = 90;
  const c = [W / 2, H / 2, 0];
  const layers = [
    layer({
      op: 40,
      shapes: [group(ellipse(160, 160), fill("#fff3b0"))],
      p: still(c),
      s: kf([[0, [10, 10, 100]], [16, [120, 120, 100]], [40, [150, 150, 100]]]),
      o: kf([[0, 90], [40, 0]]),
    }),
  ];
  const ring = 14;
  for (let n = 0; n < ring * 2; n++) {
    const outerRing = n < ring;
    const a = ((Math.PI * 2) / ring) * (n % ring) + (outerRing ? 0 : Math.PI / ring);
    const dist = outerRing ? range(140, 170) : range(80, 105);
    const d = outerRing ? 2 : 6;
    const sz = outerRing ? range(14, 20) : range(9, 13);
    const colorSet = ["#ffd23f", "#ffe27a", "#ff9f1c", "#fff3b0"];
    layers.push(
      layer({
        op,
        shapes: [group(star(sz, sz * 0.45), fill(colorSet[n % colorSet.length]))],
        p: kf([[0, c], [d, c], [d + 34, [c[0] + Math.cos(a) * dist, c[1] + Math.sin(a) * dist, 0]], [op, [c[0] + Math.cos(a) * (dist + 22), c[1] + Math.sin(a) * (dist + 22) + 18, 0]]]),
        r: kf([[0, 0], [op, range(-200, 200)]], lin),
        s: kf([[0, [0, 0, 100]], [d + 12, [130, 130, 100]], [d + 24, [100, 100, 100]], [op, [60, 60, 100]]]),
        o: kf([[0, 100], [op - 30, 100], [op, 0]]),
      }),
    );
  }
  return comp("stars", op, layers);
}

const out = new URL("../src/components/celebrate/", import.meta.url);
mkdirSync(out, { recursive: true });
for (const [name, data] of Object.entries({ confetti: confetti(), coins: coins(), stars: stars() })) {
  const json = JSON.stringify(data, (_k, v) => (typeof v === "number" ? Math.round(v * 100) / 100 : v));
  writeFileSync(new URL(`${name}.json`, out), json);
  console.log(name, `${(json.length / 1024).toFixed(1)} KB`);
}
