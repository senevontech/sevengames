/* Ludo rules.

   Board: the classic 15 × 15 cross. Colours clockwise from the top-left yard: red, green, yellow,
   blue. Each colour has 4 tokens. A token's position is counted from its own start square:
     -1        in the yard
     0 … 50    on the shared track (51 squares, ending just before its home column)
     51 … 55   its home column
     56        home (finished)

   House rules: a 6 is needed to leave the yard · a 6, a capture or reaching home gives another
   roll · three 6s in a row forfeit the turn · start squares and stars are safe · an exact roll
   is needed to reach home. Landing on rival tokens anywhere else sends them back to their yard.
   The first player to bring all four tokens home wins. */

export type Color = 0 | 1 | 2 | 3; // red, green, yellow, blue
export const COLORS: Color[] = [0, 1, 2, 3];
export const COLOR_NAMES = ["Red", "Green", "Yellow", "Blue"] as const;
export const COLOR_KEYS = ["red", "green", "yellow", "blue"] as const;

export const HOME = 56;
const LAST_TRACK = 50;
const START = [0, 13, 26, 39]; // absolute track index of each colour's start square
export const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

/** Colours used for a given number of players (2 = opposite corners). */
export const colorsFor = (n: number): Color[] => (n === 2 ? [0, 2] : n === 3 ? [0, 1, 2] : [0, 1, 2, 3]);

export type LudoState = {
  /** Colours playing, in turn order. */
  colors: Color[];
  /** tokens[color][i] = position (see above); colours not playing stay in the yard. */
  tokens: number[][];
  turn: number; // index into colors
  phase: "roll" | "move" | "over";
  dice: number; // last roll (0 = none yet)
  sixes: number; // 6s rolled in a row this turn
  rolls: number; // counts every roll (to replay the dice animation)
  winner: Color | null;
  /** The last token move, for animation: from → to, and tokens it sent home. */
  last: { color: Color; token: number; from: number; to: number; captured: { color: Color; token: number }[] } | null;
};

/** `shift` turns the colours round the board (0–3): local games pass a random one, so you
 *  don't always play red. Turn order and the 2-player "opposite corners" stay the same. */
export function newGame(players: number, shift = 0): LudoState {
  return {
    colors: colorsFor(players).map((c) => ((c + shift) % 4) as Color),
    tokens: [0, 1, 2, 3].map(() => [-1, -1, -1, -1]),
    turn: 0,
    phase: "roll",
    dice: 0,
    sixes: 0,
    rolls: 0,
    winner: null,
    last: null,
  };
}

export const current = (s: LudoState): Color => s.colors[s.turn];

/** Absolute track index (0..51) of a position on the shared track, or -1 off the track. */
export const absolute = (color: Color, pos: number) => (pos >= 0 && pos <= LAST_TRACK ? (START[color] + pos) % 52 : -1);

/** Tokens of the current colour that can move with the current dice. */
export function movable(s: LudoState): number[] {
  if (s.phase !== "move") return [];
  const c = current(s);
  const out: number[] = [];
  s.tokens[c].forEach((pos, i) => {
    if (pos === -1) {
      if (s.dice === 6) out.push(i);
    } else if (pos < HOME && pos + s.dice <= HOME) out.push(i);
  });
  return out;
}

function nextTurn(s: LudoState): LudoState {
  return { ...s, turn: (s.turn + 1) % s.colors.length, phase: "roll", sixes: 0 };
}

/** Roll the dice (value 1..6 from the caller, so the online host decides it). */
export function roll(s: LudoState, value: number): LudoState {
  if (s.phase !== "roll") return s;
  const sixes = value === 6 ? s.sixes + 1 : 0;
  const next: LudoState = { ...s, dice: value, sixes, rolls: s.rolls + 1, last: null };
  if (sixes === 3) return { ...nextTurn(next), dice: value, rolls: next.rolls }; // three 6s: turn lost
  return { ...next, phase: "move" };
}

/** After a roll with no legal move: the turn passes (a 6 with nothing to move still re-rolls). */
export function pass(s: LudoState): LudoState {
  if (s.phase !== "move" || movable(s).length) return s;
  return s.dice === 6 ? { ...s, phase: "roll" } : nextTurn(s);
}

export function move(s: LudoState, token: number): LudoState {
  if (!movable(s).includes(token)) return s;
  const c = current(s);
  const tokens = s.tokens.map((t) => [...t]);
  const from = tokens[c][token];
  const to = from === -1 ? 0 : from + s.dice;
  tokens[c][token] = to;

  // capture rivals on a normal (not safe) track square
  const captured: { color: Color; token: number }[] = [];
  const abs = absolute(c, to);
  if (abs >= 0 && !SAFE.has(abs)) {
    for (const oc of s.colors) {
      if (oc === c) continue;
      tokens[oc].forEach((p, i) => {
        if (absolute(oc, p) === abs) {
          tokens[oc][i] = -1;
          captured.push({ color: oc, token: i });
        }
      });
    }
  }

  const done = tokens[c].every((p) => p === HOME);
  const base: LudoState = { ...s, tokens, last: { color: c, token, from, to, captured } };
  if (done) return { ...base, phase: "over", winner: c };
  const again = s.dice === 6 || captured.length > 0 || to === HOME;
  return again ? { ...base, phase: "roll" } : nextTurn(base);
}

/* ---------------- CPU ---------------- */

/** Could a rival land on this absolute square with one roll (1..6)? */
function threatened(s: LudoState, me: Color, abs: number): boolean {
  if (abs < 0 || SAFE.has(abs)) return false;
  for (const oc of s.colors) {
    if (oc === me) continue;
    for (const p of s.tokens[oc]) {
      if (p < 0 || p > LAST_TRACK) continue;
      const at = absolute(oc, p);
      const d = (abs - at + 52) % 52;
      // the rival must not have passed its own home-column entry to reach it
      if (d >= 1 && d <= 6 && p + d <= LAST_TRACK) return true;
    }
    if (s.tokens[oc].includes(-1) && abs === START[oc]) return true; // a 6 brings a token out onto it
  }
  return false;
}

/** The CPU's pick among the movable tokens. */
export function cpuPick(s: LudoState): number {
  const options = movable(s);
  if (options.length <= 1) return options[0] ?? -1;
  const c = current(s);
  let best = options[0];
  let bestScore = -Infinity;
  for (const i of options) {
    const from = s.tokens[c][i];
    const to = from === -1 ? 0 : from + s.dice;
    const abs = absolute(c, to);
    let score = to * 0.6;
    const after = move(s, i);
    if (after.last?.captured.length) score += 120;
    if (to === HOME) score += 90;
    if (from === -1) score += 70;
    if (to > LAST_TRACK && from <= LAST_TRACK) score += 45; // into the home column: safe for good
    if (abs >= 0 && SAFE.has(abs)) score += 30;
    if (threatened(s, c, abs)) score -= 60;
    if (from >= 0 && from <= LAST_TRACK && threatened(s, c, absolute(c, from))) score += 40; // run away
    score += Math.random() * 6; // a little variety
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/* ---------------- geometry (cell centres, in board units 0..15) ---------------- */

// the 52 track squares clockwise from red's start (1, 6)
const TRACK: [number, number][] = [];
{
  const push = (pts: [number, number][]) => TRACK.push(...pts);
  const run = (x0: number, y0: number, dx: number, dy: number, n: number) => push(Array.from({ length: n }, (_, k) => [x0 + dx * k, y0 + dy * k] as [number, number]));
  run(1, 6, 1, 0, 5);
  run(6, 5, 0, -1, 6);
  push([[7, 0], [8, 0]]);
  run(8, 1, 0, 1, 5);
  run(9, 6, 1, 0, 6);
  push([[14, 7], [14, 8]]);
  run(13, 8, -1, 0, 5);
  run(8, 9, 0, 1, 6);
  push([[7, 14], [6, 14]]);
  run(6, 13, 0, -1, 5);
  run(5, 8, -1, 0, 6);
  push([[0, 7], [0, 6]]);
}
export const TRACK_CELLS = TRACK;

// home columns (positions 51..55) per colour
const HOME_COL: [number, number][][] = [
  [1, 2, 3, 4, 5].map((x) => [x, 7] as [number, number]),
  [1, 2, 3, 4, 5].map((y) => [7, y] as [number, number]),
  [13, 12, 11, 10, 9].map((x) => [x, 7] as [number, number]),
  [13, 12, 11, 10, 9].map((y) => [7, y] as [number, number]),
];
export const HOME_CELLS = HOME_COL;

const YARD_ORIGIN: [number, number][] = [
  [0, 0],
  [9, 0],
  [9, 9],
  [0, 9],
];
export const YARD_ORIGINS = YARD_ORIGIN;
const FINISH: [number, number][] = [
  [6.55, 7.5],
  [7.5, 6.55],
  [8.45, 7.5],
  [7.5, 8.45],
];

/** Centre point (x, y) of token `i` of `color` at `pos`. */
export function tokenPoint(color: Color, i: number, pos: number): [number, number] {
  if (pos === -1) {
    const [ox, oy] = YARD_ORIGIN[color];
    return [ox + (i % 2 ? 4 : 2), oy + (i < 2 ? 2 : 4)];
  }
  if (pos === HOME) {
    const [fx, fy] = FINISH[color];
    const off = (i - 1.5) * 0.28;
    return color % 2 ? [fx + off, fy] : [fx, fy + off];
  }
  if (pos > LAST_TRACK) {
    const [x, y] = HOME_COL[color][pos - LAST_TRACK - 1];
    return [x + 0.5, y + 0.5];
  }
  const [x, y] = TRACK[absolute(color, pos)];
  return [x + 0.5, y + 0.5];
}

/** Absolute track square of each colour's start, for drawing. */
export const START_SQUARES = START;
