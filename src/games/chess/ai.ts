/* Chess CPU: alpha-beta search with quiescence and iterative deepening, material + piece-square
   evaluation. Runs inside a Web Worker (ai.worker.ts) so the board never freezes. */
import { B, K, N, P, Q, R, fromFen, inCheck, legalMoves, make, pseudoMoves, unmake, type Move, type State } from "./engine";

export type Level = "easy" | "medium" | "hard";

const VALUE = [0, 100, 320, 330, 500, 900, 0];

// piece-square tables for white, a8 first (black uses the mirrored square)
// prettier-ignore
const PST: Record<number, number[]> = {
  [P]: [
     0,  0,  0,  0,  0,  0,  0,  0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
     5,  5, 10, 25, 25, 10,  5,  5,
     0,  0,  0, 20, 20,  0,  0,  0,
     5, -5,-10,  0,  0,-10, -5,  5,
     5, 10, 10,-20,-20, 10, 10,  5,
     0,  0,  0,  0,  0,  0,  0,  0],
  [N]: [
    -50,-40,-30,-30,-30,-30,-40,-50,
    -40,-20,  0,  0,  0,  0,-20,-40,
    -30,  0, 10, 15, 15, 10,  0,-30,
    -30,  5, 15, 20, 20, 15,  5,-30,
    -30,  0, 15, 20, 20, 15,  0,-30,
    -30,  5, 10, 15, 15, 10,  5,-30,
    -40,-20,  0,  5,  5,  0,-20,-40,
    -50,-40,-30,-30,-30,-30,-40,-50],
  [B]: [
    -20,-10,-10,-10,-10,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5, 10, 10,  5,  0,-10,
    -10,  5,  5, 10, 10,  5,  5,-10,
    -10,  0, 10, 10, 10, 10,  0,-10,
    -10, 10, 10, 10, 10, 10, 10,-10,
    -10,  5,  0,  0,  0,  0,  5,-10,
    -20,-10,-10,-10,-10,-10,-10,-20],
  [R]: [
     0,  0,  0,  0,  0,  0,  0,  0,
     5, 10, 10, 10, 10, 10, 10,  5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
     0,  0,  0,  5,  5,  0,  0,  0],
  [Q]: [
    -20,-10,-10, -5, -5,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5,  5,  5,  5,  0,-10,
     -5,  0,  5,  5,  5,  5,  0, -5,
      0,  0,  5,  5,  5,  5,  0, -5,
    -10,  5,  5,  5,  5,  5,  0,-10,
    -10,  0,  5,  0,  0,  0,  0,-10,
    -20,-10,-10, -5, -5,-10,-10,-20],
  [K]: [
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -20,-30,-30,-40,-40,-30,-30,-20,
    -10,-20,-20,-20,-20,-20,-20,-10,
     20, 20,  0,  0,  0,  0, 20, 20,
     20, 30, 10,  0,  0, 10, 30, 20],
};
// endgame king: walk to the centre
// prettier-ignore
const KING_END = [
  -50,-40,-30,-20,-20,-30,-40,-50,
  -30,-20,-10,  0,  0,-10,-20,-30,
  -30,-10, 20, 30, 30, 20,-10,-30,
  -30,-10, 30, 40, 40, 30,-10,-30,
  -30,-10, 30, 40, 40, 30,-10,-30,
  -30,-10, 20, 30, 30, 20,-10,-30,
  -30,-30,  0,  0,  0,  0,-30,-30,
  -50,-30,-30,-30,-30,-30,-30,-50];

/** Score from the side to move's point of view (centipawns). */
function evaluate(s: State): number {
  let score = 0;
  let heavy = 0;
  for (let sq = 0; sq < 64; sq++) {
    const p = s.b[sq];
    if (p) {
      const t = Math.abs(p);
      if (t === Q) heavy += 2;
      else if (t === R || t === B || t === N) heavy += 1;
    }
  }
  const endgame = heavy <= 4;
  for (let sq = 0; sq < 64; sq++) {
    const p = s.b[sq];
    if (!p) continue;
    const t = Math.abs(p);
    const idx = p > 0 ? sq : sq ^ 56;
    const table = t === K && endgame ? KING_END : PST[t];
    const v = VALUE[t] + table[idx];
    score += p > 0 ? v : -v;
  }
  return s.turn === 1 ? score : -score;
}

const MATE = 100_000;

class Timeout extends Error {}

function order(moves: Move[]) {
  // captures first (most valuable victim, least valuable attacker), promotions too
  return moves.sort(
    (a, b) =>
      (b.captured ? VALUE[Math.abs(b.captured)] * 10 - VALUE[Math.abs(b.piece)] : 0) +
      (b.promo ? 800 : 0) -
      ((a.captured ? VALUE[Math.abs(a.captured)] * 10 - VALUE[Math.abs(a.piece)] : 0) + (a.promo ? 800 : 0)),
  );
}

export function bestMove(fen: string, level: Level): string | null {
  const s = fromFen(fen);
  const root = legalMoves(s);
  if (!root.length) return null;
  const limit = level === "easy" ? 2 : level === "medium" ? 3 : 6;
  const budget = level === "easy" ? 250 : level === "medium" ? 700 : 1600;
  const deadline = performance.now() + budget;
  let nodes = 0;

  const quiesce = (alpha: number, beta: number, depth: number): number => {
    if ((++nodes & 1023) === 0 && performance.now() > deadline) throw new Timeout();
    const stand = evaluate(s);
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
    if (depth <= -6) return alpha;
    const us = s.turn;
    for (const m of order(pseudoMoves(s, true))) {
      const u = make(s, m);
      if (inCheck(s, us)) {
        unmake(s, m, u);
        continue;
      }
      const v = -quiesce(-beta, -alpha, depth - 1);
      unmake(s, m, u);
      if (v >= beta) return beta;
      if (v > alpha) alpha = v;
    }
    return alpha;
  };

  const search = (depth: number, alpha: number, beta: number, ply: number): number => {
    if ((++nodes & 1023) === 0 && performance.now() > deadline) throw new Timeout();
    if (depth <= 0) return quiesce(alpha, beta, 0);
    const us = s.turn;
    let any = false;
    for (const m of order(pseudoMoves(s))) {
      const u = make(s, m);
      if (inCheck(s, us)) {
        unmake(s, m, u);
        continue;
      }
      any = true;
      const v = -search(depth - 1, -beta, -alpha, ply + 1);
      unmake(s, m, u);
      if (v >= beta) return beta;
      if (v > alpha) alpha = v;
    }
    if (!any) return inCheck(s) ? -MATE + ply : 0;
    if (s.half >= 100) return 0;
    return alpha;
  };

  // iterative deepening: keep the best result of the deepest finished search
  let scored = root.map((m) => ({ m, v: 0 }));
  for (let depth = 1; depth <= limit; depth++) {
    try {
      const next: { m: Move; v: number }[] = [];
      for (const { m } of scored) {
        const u = make(s, m);
        const v = -search(depth - 1, -MATE - 1, MATE + 1, 1);
        unmake(s, m, u);
        next.push({ m, v });
      }
      next.sort((a, b) => b.v - a.v);
      scored = next;
      if (scored[0].v > MATE - 100) break; // found a mate
    } catch (e) {
      if (!(e instanceof Timeout)) throw e;
      break;
    }
  }

  let pick = scored[0].m;
  if (level === "easy") {
    // a beginner: often picks a reasonable but not best move, and sometimes blunders a little
    const ok = scored.filter((x) => x.v >= scored[0].v - 120);
    pick = Math.random() < 0.3 ? scored[Math.floor(Math.random() * Math.min(scored.length, 6))].m : ok[Math.floor(Math.random() * ok.length)].m;
  } else if (level === "medium") {
    const ok = scored.filter((x) => x.v >= scored[0].v - 25);
    pick = ok[Math.floor(Math.random() * ok.length)].m;
  }
  const sqn = (sq: number) => "abcdefgh"[sq & 7] + (8 - (sq >> 3));
  return sqn(pick.from) + sqn(pick.to) + (pick.promo ? " nbrq"[pick.promo - 1] : "");
}
