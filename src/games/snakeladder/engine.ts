/* Snake & Ladder: the rules and the board layout. No rendering here.
   Every token starts on square 1. Land on a ladder's foot and climb it; land on a snake's head
   and slide to its tail. You need the exact roll to reach 100: a roll that would go past it
   leaves the token where it is. First to 100 wins. */

export const CELLS = 100;
export const START = 1;

/** Ladders: foot → top. */
export const LADDERS: Record<number, number> = {
  4: 25,
  9: 31,
  13: 46,
  21: 82,
  42: 63,
  50: 69,
  74: 92,
};

/** Snakes: head → tail. */
export const SNAKES: Record<number, number> = {
  16: 6,
  32: 10,
  47: 15,
  56: 37,
  87: 36,
  89: 68,
  95: 75,
  99: 54,
};

export type MoveKind = "walk" | "snake" | "ladder" | "blocked";

export type SLMove = {
  seat: number;
  from: number;
  roll: number;
  /** the square the dice took the token to (= from when blocked) */
  land: number;
  /** where it ended up (after a snake or ladder) */
  to: number;
  kind: MoveKind;
};

export type SLState = {
  /** players (2–4) */
  n: number;
  /** each seat's square, 1–100 */
  pos: number[];
  /** whose turn it is to roll */
  turn: number;
  phase: "roll" | "over";
  /** last dice value (0 before the first roll) */
  dice: number;
  /** how many rolls this game: changes on every roll, so a repeated value still animates */
  rolls: number;
  winner: number | null;
  last: SLMove | null;
};

export function newGame(n: number): SLState {
  const players = Math.max(2, Math.min(4, Math.floor(n) || 2));
  return { n: players, pos: Array(players).fill(START), turn: 0, phase: "roll", dice: 0, rolls: 0, winner: null, last: null };
}

/** Where a roll of `d` takes a token on `from` (pure: same rules as roll()). */
export function resolve(from: number, d: number): Omit<SLMove, "seat"> {
  const land = from + d;
  if (land > CELLS) return { from, roll: d, land: from, to: from, kind: "blocked" };
  if (LADDERS[land]) return { from, roll: d, land, to: LADDERS[land], kind: "ladder" };
  if (SNAKES[land]) return { from, roll: d, land, to: SNAKES[land], kind: "snake" };
  return { from, roll: d, land, to: land, kind: "walk" };
}

/** The current player rolls `d` (1–6). */
export function roll(s: SLState, d: number): SLState {
  if (s.phase !== "roll") return s;
  const value = Math.max(1, Math.min(6, Math.floor(d) || 1));
  const seat = s.turn;
  const mv: SLMove = { seat, ...resolve(s.pos[seat], value) };
  const pos = s.pos.slice();
  pos[seat] = mv.to;
  const won = mv.to === CELLS;
  return {
    ...s,
    pos,
    dice: value,
    rolls: s.rolls + 1,
    last: mv,
    phase: won ? "over" : "roll",
    winner: won ? seat : null,
    turn: won ? seat : (seat + 1) % s.n,
  };
}

/** A state that came over the network: is it shaped right? */
export function validState(x: unknown): x is SLState {
  const s = x as SLState;
  return (
    !!s &&
    typeof s.n === "number" &&
    s.n >= 2 &&
    s.n <= 4 &&
    Array.isArray(s.pos) &&
    s.pos.length === s.n &&
    s.pos.every((p) => Number.isInteger(p) && p >= 1 && p <= CELLS) &&
    Number.isInteger(s.turn) &&
    s.turn >= 0 &&
    s.turn < s.n
  );
}

/* ---------------- board coordinates (board units: the board is 1000 × 1000) ---------------- */

export const BOARD = 1000;
export const CELL = BOARD / 10;

/** Row from the bottom (0–9) and column from the left (0–9) of square n. Rows run alternately
 *  left→right and right→left: 1–10 on the bottom row, 11–20 back the other way, and so on. */
export function cellRC(n: number): { row: number; col: number } {
  const i = Math.max(1, Math.min(CELLS, n)) - 1;
  const row = Math.floor(i / 10);
  const k = i % 10;
  return { row, col: row % 2 === 0 ? k : 9 - k };
}

/** Centre of square n, in board units (y grows downwards). */
export function cellCenter(n: number): { x: number; y: number } {
  const { row, col } = cellRC(n);
  return { x: col * CELL + CELL / 2, y: (9 - row) * CELL + CELL / 2 };
}

/** The squares a token walks through, one per pip (from+1 … land). */
export function walkPath(from: number, land: number): number[] {
  const out: number[] = [];
  for (let p = from + 1; p <= land; p++) out.push(p);
  return out;
}
