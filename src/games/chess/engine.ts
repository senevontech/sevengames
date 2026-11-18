/* Chess rules: board, legal moves, make / unmake, game end, FEN and SAN.

   Board: 64 squares, index 0 = a8 … 7 = h8 … 56 = a1 … 63 = h1 (FEN order), so row = sq >> 3
   (0 = rank 8) and file = sq & 7. Pieces: 1..6 = white P N B R Q K, negative = black, 0 = empty.
   Moves are applied in place (make) and taken back (unmake) so the CPU search doesn't copy boards. */

export const P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6;
export type Color = 1 | -1; // white | black

export type Move = {
  from: number;
  to: number;
  piece: number; // moving piece (signed)
  captured: number; // captured piece (signed) or 0
  promo: number; // promotion piece type (2..5) or 0
  flag: 0 | 1 | 2 | 3; // 0 normal, 1 en passant, 2 castle, 3 double pawn push
};

export type State = {
  b: Int8Array;
  turn: Color;
  castle: number; // 1 = K, 2 = Q, 4 = k, 8 = q
  ep: number; // en-passant target square or -1
  half: number; // half-move clock (50-move rule)
  full: number; // move number
};

type Undo = { castle: number; ep: number; half: number };

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const KNIGHT = [-17, -15, -10, -6, 6, 10, 15, 17];
const KING = [-9, -8, -7, -1, 1, 7, 8, 9];
const BISHOP_DIRS = [-9, -7, 7, 9];
const ROOK_DIRS = [-8, -1, 1, 8];

const file = (sq: number) => sq & 7;
const row = (sq: number) => sq >> 3;
/** Step from sq by d on the board, or -1 if it wraps around an edge. */
function step(sq: number, d: number): number {
  const to = sq + d;
  if (to < 0 || to > 63) return -1;
  if (Math.abs(file(to) - file(sq)) > 2) return -1; // wrapped
  return to;
}

export const sqName = (sq: number) => "abcdefgh"[file(sq)] + (8 - row(sq));
export const sqFrom = (name: string) => "abcdefgh".indexOf(name[0]) + (8 - Number(name[1])) * 8;

/* ---------------- FEN ---------------- */
const LETTERS = " pnbrqk";

export function fromFen(fen: string): State {
  const [placement, turn, castle, ep, half, full] = fen.trim().split(/\s+/);
  const b = new Int8Array(64);
  let sq = 0;
  for (const ch of placement) {
    if (ch === "/") continue;
    if (/\d/.test(ch)) sq += Number(ch);
    else {
      const t = LETTERS.indexOf(ch.toLowerCase());
      b[sq++] = ch === ch.toUpperCase() ? t : -t;
    }
  }
  let c = 0;
  if (castle?.includes("K")) c |= 1;
  if (castle?.includes("Q")) c |= 2;
  if (castle?.includes("k")) c |= 4;
  if (castle?.includes("q")) c |= 8;
  return {
    b,
    turn: turn === "b" ? -1 : 1,
    castle: c,
    ep: ep && ep !== "-" ? sqFrom(ep) : -1,
    half: Number(half) || 0,
    full: Number(full) || 1,
  };
}

/** Position part of the FEN (placement, side, castling, en passant): equal = same position. */
export function positionKey(s: State): string {
  return toFen(s).split(" ").slice(0, 4).join(" ");
}

export function toFen(s: State): string {
  let out = "";
  for (let r = 0; r < 8; r++) {
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = s.b[r * 8 + f];
      if (!p) empty++;
      else {
        if (empty) out += empty;
        empty = 0;
        const l = LETTERS[Math.abs(p)];
        out += p > 0 ? l.toUpperCase() : l;
      }
    }
    if (empty) out += empty;
    if (r < 7) out += "/";
  }
  const c = (s.castle & 1 ? "K" : "") + (s.castle & 2 ? "Q" : "") + (s.castle & 4 ? "k" : "") + (s.castle & 8 ? "q" : "") || "-";
  return `${out} ${s.turn === 1 ? "w" : "b"} ${c} ${s.ep >= 0 ? sqName(s.ep) : "-"} ${s.half} ${s.full}`;
}

export const clone = (s: State): State => ({ ...s, b: new Int8Array(s.b) });

/* ---------------- attacks ---------------- */

/** Is `sq` attacked by side `by`? */
export function attacked(s: State, sq: number, by: Color): boolean {
  const b = s.b;
  // pawns: a white pawn attacks up (towards row 0)
  const pr = by === 1 ? 9 : -9;
  const pl = by === 1 ? 7 : -7;
  for (const d of [pr, pl]) {
    const from = step(sq, d);
    if (from >= 0 && b[from] === by * P) return true;
  }
  for (const d of KNIGHT) {
    const from = step(sq, d);
    if (from >= 0 && b[from] === by * N) return true;
  }
  for (const d of KING) {
    const from = step(sq, d);
    if (from >= 0 && b[from] === by * K) return true;
  }
  for (const d of BISHOP_DIRS) {
    let cur = sq;
    for (;;) {
      cur = step(cur, d);
      if (cur < 0) break;
      const p = b[cur];
      if (p) {
        if (p === by * B || p === by * Q) return true;
        break;
      }
    }
  }
  for (const d of ROOK_DIRS) {
    let cur = sq;
    for (;;) {
      cur = step(cur, d);
      if (cur < 0) break;
      const p = b[cur];
      if (p) {
        if (p === by * R || p === by * Q) return true;
        break;
      }
    }
  }
  return false;
}

export function kingSquare(s: State, color: Color): number {
  return s.b.indexOf(color * K);
}

export function inCheck(s: State, color: Color = s.turn): boolean {
  const k = kingSquare(s, color);
  return k >= 0 && attacked(s, k, -color as Color);
}

/* ---------------- move generation ---------------- */

function add(moves: Move[], s: State, from: number, to: number, flag: Move["flag"] = 0) {
  const piece = s.b[from];
  const captured = flag === 1 ? -piece : s.b[to];
  const toRow = row(to);
  if (Math.abs(piece) === P && (toRow === 0 || toRow === 7)) {
    for (const promo of [Q, R, B, N]) moves.push({ from, to, piece, captured, promo, flag });
  } else moves.push({ from, to, piece, captured, promo: 0, flag });
}

/** Moves that follow the piece rules; may leave the own king in check. `capturesOnly` for search. */
export function pseudoMoves(s: State, capturesOnly = false): Move[] {
  const moves: Move[] = [];
  const b = s.b;
  const us = s.turn;
  for (let from = 0; from < 64; from++) {
    const p = b[from];
    if (!p || Math.sign(p) !== us) continue;
    const t = Math.abs(p);
    if (t === P) {
      const fwd = us === 1 ? -8 : 8;
      const startRow = us === 1 ? 6 : 1;
      const one = from + fwd;
      if (!capturesOnly && one >= 0 && one < 64 && !b[one]) {
        add(moves, s, from, one);
        const two = one + fwd;
        if (row(from) === startRow && !b[two]) add(moves, s, from, two, 3);
      } else if (capturesOnly && one >= 0 && one < 64 && !b[one] && (row(one) === 0 || row(one) === 7)) {
        add(moves, s, from, one); // promotions count as tactical
      }
      for (const d of us === 1 ? [-9, -7] : [7, 9]) {
        const to = step(from, d);
        if (to < 0) continue;
        if (b[to] && Math.sign(b[to]) === -us) add(moves, s, from, to);
        else if (to === s.ep) add(moves, s, from, to, 1);
      }
    } else if (t === N || t === K) {
      for (const d of t === N ? KNIGHT : KING) {
        const to = step(from, d);
        if (to < 0) continue;
        const q = b[to];
        if (q && Math.sign(q) === us) continue;
        if (capturesOnly && !q) continue;
        add(moves, s, from, to);
      }
      if (t === K && !capturesOnly) castles(moves, s, from);
    } else {
      const dirs = t === B ? BISHOP_DIRS : t === R ? ROOK_DIRS : [...BISHOP_DIRS, ...ROOK_DIRS];
      for (const d of dirs) {
        let to = from;
        for (;;) {
          to = step(to, d);
          if (to < 0) break;
          const q = b[to];
          if (q && Math.sign(q) === us) break;
          if (!capturesOnly || q) add(moves, s, from, to);
          if (q) break;
        }
      }
    }
  }
  return moves;
}

function castles(moves: Move[], s: State, from: number) {
  const us = s.turn;
  const them = -us as Color;
  const home = us === 1 ? 60 : 4;
  if (from !== home || attacked(s, home, them)) return;
  const b = s.b;
  const kSide = us === 1 ? 1 : 4;
  const qSide = us === 1 ? 2 : 8;
  if (s.castle & kSide && !b[home + 1] && !b[home + 2] && b[home + 3] === us * R && !attacked(s, home + 1, them) && !attacked(s, home + 2, them))
    moves.push({ from, to: home + 2, piece: us * K, captured: 0, promo: 0, flag: 2 });
  if (
    s.castle & qSide &&
    !b[home - 1] &&
    !b[home - 2] &&
    !b[home - 3] &&
    b[home - 4] === us * R &&
    !attacked(s, home - 1, them) &&
    !attacked(s, home - 2, them)
  )
    moves.push({ from, to: home - 2, piece: us * K, captured: 0, promo: 0, flag: 2 });
}

// castling rights lost when a piece moves from / to these squares
const CASTLE_MASK = new Int8Array(64).fill(15);
CASTLE_MASK[60] = 15 & ~3; // e1
CASTLE_MASK[63] = 15 & ~1; // h1
CASTLE_MASK[56] = 15 & ~2; // a1
CASTLE_MASK[4] = 15 & ~12; // e8
CASTLE_MASK[7] = 15 & ~4; // h8
CASTLE_MASK[0] = 15 & ~8; // a8

/** Play a move in place; returns what unmake needs. */
export function make(s: State, m: Move): Undo {
  const undo: Undo = { castle: s.castle, ep: s.ep, half: s.half };
  const b = s.b;
  b[m.to] = m.promo ? Math.sign(m.piece) * m.promo : m.piece;
  b[m.from] = 0;
  if (m.flag === 1) b[m.to + (m.piece > 0 ? 8 : -8)] = 0;
  else if (m.flag === 2) {
    if (m.to > m.from) {
      b[m.from + 1] = b[m.from + 3];
      b[m.from + 3] = 0;
    } else {
      b[m.from - 1] = b[m.from - 4];
      b[m.from - 4] = 0;
    }
  }
  s.castle &= CASTLE_MASK[m.from] & CASTLE_MASK[m.to];
  s.ep = m.flag === 3 ? (m.from + m.to) >> 1 : -1;
  s.half = Math.abs(m.piece) === P || m.captured ? 0 : s.half + 1;
  if (s.turn === -1) s.full++;
  s.turn = -s.turn as Color;
  return undo;
}

export function unmake(s: State, m: Move, u: Undo) {
  const b = s.b;
  s.turn = -s.turn as Color;
  if (s.turn === -1) s.full--;
  b[m.from] = m.piece;
  if (m.flag === 1) {
    b[m.to] = 0;
    b[m.to + (m.piece > 0 ? 8 : -8)] = m.captured;
  } else b[m.to] = m.captured;
  if (m.flag === 2) {
    if (m.to > m.from) {
      b[m.from + 3] = b[m.from + 1];
      b[m.from + 1] = 0;
    } else {
      b[m.from - 4] = b[m.from - 1];
      b[m.from - 1] = 0;
    }
  }
  s.castle = u.castle;
  s.ep = u.ep;
  s.half = u.half;
}

/** Legal moves for the side to move. */
export function legalMoves(s: State): Move[] {
  const out: Move[] = [];
  const us = s.turn;
  for (const m of pseudoMoves(s)) {
    const u = make(s, m);
    if (!inCheck(s, us)) out.push(m);
    unmake(s, m, u);
  }
  return out;
}

/* ---------------- notation ---------------- */

export const uci = (m: Move) => sqName(m.from) + sqName(m.to) + (m.promo ? " nbrq"[m.promo - 1] : "");

export function moveFromUci(s: State, text: string): Move | null {
  return legalMoves(s).find((m) => uci(m) === text) ?? null;
}

/** Standard algebraic notation ("Nf3", "exd5", "O-O", "e8=Q+"), computed before the move. */
export function san(s: State, m: Move): string {
  let out: string;
  const t = Math.abs(m.piece);
  if (m.flag === 2) out = m.to > m.from ? "O-O" : "O-O-O";
  else {
    const capture = m.captured !== 0;
    if (t === P) out = (capture ? "abcdefgh"[file(m.from)] + "x" : "") + sqName(m.to) + (m.promo ? "=" + "  NBRQ"[m.promo] : "");
    else {
      const letter = " PNBRQK"[t];
      // disambiguate between identical pieces that can reach the same square
      const rivals = legalMoves(s).filter((o) => o.to === m.to && o.piece === m.piece && o.from !== m.from);
      let dis = "";
      if (rivals.length) {
        const sameFile = rivals.some((o) => file(o.from) === file(m.from));
        const sameRow = rivals.some((o) => row(o.from) === row(m.from));
        dis = !sameFile ? "abcdefgh"[file(m.from)] : !sameRow ? String(8 - row(m.from)) : sqName(m.from);
      }
      out = letter + dis + (capture ? "x" : "") + sqName(m.to);
    }
  }
  const u = make(s, m);
  if (inCheck(s)) out += legalMoves(s).length ? "+" : "#";
  unmake(s, m, u);
  return out;
}

/* ---------------- game end ---------------- */

export type Outcome =
  | { kind: "checkmate"; winner: Color }
  | { kind: "stalemate" | "repetition" | "fifty" | "material" }
  | null;

/** Neither side can possibly mate (K v K, K+minor v K, K+B v K+B same colour squares). */
export function insufficientMaterial(s: State): boolean {
  const minors: { t: number; sq: number }[] = [];
  for (let sq = 0; sq < 64; sq++) {
    const t = Math.abs(s.b[sq]);
    if (!t || t === K) continue;
    if (t === P || t === R || t === Q) return false;
    minors.push({ t, sq });
  }
  if (minors.length <= 1) return true;
  if (minors.every((m) => m.t === B)) {
    const shade = (sq: number) => (file(sq) + row(sq)) & 1;
    return minors.every((m) => shade(m.sq) === shade(minors[0].sq));
  }
  return false;
}

/** Game result for a position, given the position keys seen so far (for repetition). */
export function outcome(s: State, history: string[]): Outcome {
  const moves = legalMoves(s);
  if (!moves.length) return inCheck(s) ? { kind: "checkmate", winner: -s.turn as Color } : { kind: "stalemate" };
  if (s.half >= 100) return { kind: "fifty" };
  if (insufficientMaterial(s)) return { kind: "material" };
  const key = positionKey(s);
  if (history.filter((k) => k === key).length >= 3) return { kind: "repetition" };
  return null;
}

export const outcomeText: Record<string, string> = {
  checkmate: "Checkmate",
  stalemate: "Stalemate",
  repetition: "Draw by repetition",
  fifty: "Draw by the 50-move rule",
  material: "Draw: not enough pieces to mate",
};
