/* One Card: a colour-matching shedding game (the Crazy Eights / Mau-Mau family).
   Match the top card by colour or by number/symbol, use action cards, and be the first to play
   your last card. Say "One card!" when you're down to one, or draw 2.

   Cards are numbers 0–107 (the same numbering as supabase/lastcard.sql):
     colours 0 red · 1 yellow · 2 green · 3 blue, 25 cards each (id = colour × 25 + i):
       i 0 → 0 · i 1–18 → 1…9 twice · 19–20 Skip · 21–22 Reverse · 23–24 +2
     100–103 Wild · 104–107 Wild +4
   This file is the rules for vs Senevi and same-device play; online games run the same rules
   on the server. */

export const COLOR_HEX = ["#ee4545", "#f2b01e", "#28a956", "#2b7de0"];
export const COLOR_NAMES = ["Red", "Yellow", "Green", "Blue"];
export const SKIP = 10;
export const REV = 11;
export const D2 = 12;
export const WILD = 13;
export const W4 = 14;
export const WILD_COLOR = 4;
export const HAND = 7;
export const DECK_SIZE = 108;

export type Card = { c: number; v: number };
export function cardOf(id: number): Card {
  if (id >= 104) return { c: WILD_COLOR, v: W4 };
  if (id >= 100) return { c: WILD_COLOR, v: WILD };
  const c = Math.floor(id / 25);
  const i = id % 25;
  const v = i === 0 ? 0 : i <= 18 ? (i + 1) >> 1 : i <= 20 ? SKIP : i <= 22 ? REV : D2;
  return { c, v };
}
export const isWild = (id: number) => id >= 100;
export const cardPoints = (id: number) => {
  const { v } = cardOf(id);
  return v <= 9 ? v : v <= D2 ? 20 : 50;
};
export function cardName(id: number) {
  const { c, v } = cardOf(id);
  const what = v <= 9 ? String(v) : v === SKIP ? "Skip" : v === REV ? "Reverse" : v === D2 ? "+2" : v === WILD ? "Wild" : "Wild +4";
  return c === WILD_COLOR ? what : `${COLOR_NAMES[c]} ${what}`;
}

export type Rules = {
  /** answer a +2 with a +2 (or a +4), passing the pile on */
  stack: boolean;
  /** a 7 swaps your hand with a player you choose; a 0 passes every hand along */
  sevenZero: boolean;
  /** play an identical card out of turn (vs Senevi only) */
  jumpIn: boolean;
  /** keep drawing until you can play (instead of one card) */
  drawUntil: boolean;
};
export const DEFAULT_RULES: Rules = { stack: true, sevenZero: false, jumpIn: false, drawUntil: false };

export type LastAction = {
  seat: number;
  kind: "play" | "draw" | "pass" | "penalty" | "jump" | "start";
  card?: number;
  count?: number;
  /** a 7 swap: with whom */
  target?: number;
};

export type LCState = {
  n: number;
  hands: number[][];
  draw: number[];
  discard: number[];
  /** the colour in play (a wild's chosen colour) */
  color: number;
  turn: number;
  dir: 1 | -1;
  /** stacked cards the player to move must take (unless they stack on) */
  pending: number;
  /** what the stack is made of: +2s (2) or a +4 on top (4) */
  pendKind: 0 | 2 | 4;
  /** the card the player to move just drew: they may play it or pass */
  drawn: number | null;
  /** said "One card!" */
  called: boolean[];
  phase: "play" | "over";
  winner: number | null;
  rules: Rules;
  last: LastAction | null;
  /** counts every action (for animations) */
  seq: number;
};

/* ---------------- dealing ---------------- */
export type Rand = () => number;
export function shuffle<T>(a: T[], rand: Rand = Math.random) {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

export function newGame(n: number, rules: Rules, first = 0, rand: Rand = Math.random): LCState {
  let deck = shuffle(Array.from({ length: DECK_SIZE }, (_, i) => i), rand);
  const hands: number[][] = Array.from({ length: n }, () => []);
  for (let k = 0; k < HAND; k++) for (let p = 0; p < n; p++) hands[p].push(deck.pop()!);
  // the first card face up is always a plain number (actions and wilds go back in)
  let top = deck.pop()!;
  while (cardOf(top).v > 9) {
    deck.unshift(top);
    deck = shuffle(deck, rand);
    top = deck.pop()!;
  }
  return {
    n,
    hands: hands.map(sortHand),
    draw: deck,
    discard: [top],
    color: cardOf(top).c,
    turn: first % n,
    dir: 1,
    pending: 0,
    pendKind: 0,
    drawn: null,
    called: Array(n).fill(false),
    phase: "play",
    winner: null,
    rules,
    last: { seat: -1, kind: "start", card: top },
    seq: 1,
  };
}

/** colours together, then by value: easier to read */
export const sortHand = (h: number[]) =>
  h.slice().sort((a, b) => {
    const x = cardOf(a);
    const y = cardOf(b);
    return x.c - y.c || x.v - y.v || a - b;
  });

export const topCard = (s: LCState) => s.discard[s.discard.length - 1];
export const nextSeat = (s: LCState, from = s.turn, steps = 1) => (((from + s.dir * steps) % s.n) + s.n) % s.n;

/* ---------------- what may be played ---------------- */
export function canPlay(s: LCState, card: number): boolean {
  if (s.phase !== "play") return false;
  if (s.drawn !== null && card !== s.drawn) return false;
  const k = cardOf(card);
  if (s.pending > 0) {
    if (!s.rules.stack) return false;
    // +2 on +2; +4 on anything stacked
    return (k.v === D2 && s.pendKind === 2) || k.v === W4;
  }
  if (k.c === WILD_COLOR) return true;
  if (k.c === s.color) return true;
  const top = cardOf(topCard(s));
  return top.c !== WILD_COLOR && top.v === k.v;
}
export const playable = (s: LCState, seat: number) => (seat === s.turn ? s.hands[seat].filter((c) => canPlay(s, c)) : []);

/** jump-in: an identical card (same colour and number/symbol) to the top card, out of turn */
export function canJump(s: LCState, seat: number, card: number) {
  if (!s.rules.jumpIn || s.phase !== "play" || s.pending > 0 || s.drawn !== null || seat === s.turn) return false;
  if (isWild(card)) return false;
  const t = cardOf(topCard(s));
  const k = cardOf(card);
  return t.c === k.c && t.v === k.v && s.hands[seat].includes(card);
}

/* ---------------- moves ---------------- */
function takeCards(s: LCState, seat: number, count: number, rand: Rand) {
  for (let i = 0; i < count; i++) {
    if (!s.draw.length) {
      // shuffle the played cards (all but the top one) back in
      const top = s.discard.pop()!;
      s.draw = shuffle(s.discard, rand);
      s.discard = [top];
      if (!s.draw.length) break;
    }
    s.hands[seat].push(s.draw.pop()!);
  }
  if (s.hands[seat].length > 1) s.called[seat] = false;
}

function clone(s: LCState): LCState {
  return { ...s, hands: s.hands.map((h) => h.slice()), draw: s.draw.slice(), discard: s.discard.slice(), called: s.called.slice() };
}

export type PlayOpts = { color?: number; target?: number; rand?: Rand };

/** Play `card` from `seat` (its turn, or a jump-in). A wild needs `color`; a 7 with 7-0 on needs `target`. */
export function play(prev: LCState, seat: number, card: number, o: PlayOpts = {}): LCState {
  const rand = o.rand ?? Math.random;
  const jump = seat !== prev.turn;
  if (jump ? !canJump(prev, seat, card) : !canPlay(prev, card) || !prev.hands[seat].includes(card)) return prev;
  const s = clone(prev);
  s.seq++;
  s.turn = seat;
  s.drawn = null;
  s.hands[seat] = s.hands[seat].filter((c) => c !== card);
  s.discard.push(card);
  const k = cardOf(card);
  s.color = k.c === WILD_COLOR ? Math.max(0, Math.min(3, o.color ?? 0)) : k.c;
  s.last = { seat, kind: jump ? "jump" : "play", card };

  // out of cards: game over (whatever the card was)
  if (!s.hands[seat].length) {
    s.phase = "over";
    s.winner = seat;
    s.pending = 0;
    return s;
  }
  // forgot to say "One card!"
  let penalty = 0;
  if (s.hands[seat].length === 1 && !s.called[seat]) {
    takeCards(s, seat, 2, rand);
    penalty = 2;
  }

  let skip = 0;
  if (k.v === SKIP) skip = 1;
  else if (k.v === REV) {
    s.dir = s.dir === 1 ? -1 : 1;
    if (s.n === 2) skip = 1; // two players: a reverse works like a skip
  } else if (k.v === D2 || k.v === W4) {
    const add = k.v === D2 ? 2 : 4;
    if (s.rules.stack) {
      s.pending += add;
      s.pendKind = add as 2 | 4;
    } else {
      const victim = nextSeat(s, seat);
      takeCards(s, victim, add, rand);
      skip = 1;
    }
  } else if (s.rules.sevenZero && k.v === 7 && s.n > 1) {
    const t = o.target !== undefined && o.target !== seat && o.target >= 0 && o.target < s.n ? o.target : fewestOther(s, seat);
    [s.hands[seat], s.hands[t]] = [s.hands[t], s.hands[seat]];
    [s.called[seat], s.called[t]] = [s.called[t], s.called[seat]];
    s.last.target = t;
  } else if (s.rules.sevenZero && k.v === 0) {
    // every hand moves on one seat in the direction of play
    const hs = s.hands.slice();
    for (let p = 0; p < s.n; p++) s.hands[nextSeat(s, p)] = hs[p];
    s.called = s.called.map(() => false);
  }
  s.hands = s.hands.map(sortHand);
  s.turn = nextSeat(s, seat, 1 + skip);
  if (penalty) s.last = { ...s.last, kind: s.last.kind, count: penalty };
  return s;
}

/** Draw: take the stacked pile (and lose the turn), or draw one card (with draw-until, until one fits). */
export function drawCard(prev: LCState, seat: number, rand: Rand = Math.random): LCState {
  if (prev.phase !== "play" || seat !== prev.turn || prev.drawn !== null) return prev;
  const s = clone(prev);
  s.seq++;
  if (s.pending > 0) {
    const n = s.pending;
    takeCards(s, seat, n, rand);
    s.pending = 0;
    s.pendKind = 0;
    s.hands[seat] = sortHand(s.hands[seat]);
    s.last = { seat, kind: "penalty", count: n };
    s.turn = nextSeat(s, seat);
    return s;
  }
  let got = 0;
  let card: number | null = null;
  do {
    const before = s.hands[seat].length;
    takeCards(s, seat, 1, rand);
    if (s.hands[seat].length === before) break; // nothing left to draw
    got++;
    card = s.hands[seat][s.hands[seat].length - 1];
  } while (s.rules.drawUntil && card !== null && !canPlay({ ...s, drawn: null }, card) && got < 30);
  s.hands[seat] = sortHand(s.hands[seat]);
  s.last = { seat, kind: "draw", count: got };
  if (card !== null && canPlay({ ...s, drawn: null }, card)) {
    s.drawn = card; // they may play it, or pass
  } else {
    s.turn = nextSeat(s, seat);
  }
  return s;
}

/** Keep the card just drawn and end the turn. */
export function pass(prev: LCState, seat: number): LCState {
  if (prev.phase !== "play" || seat !== prev.turn || prev.drawn === null) return prev;
  const s = clone(prev);
  s.seq++;
  s.drawn = null;
  s.last = { seat, kind: "pass" };
  s.turn = nextSeat(s, seat);
  return s;
}

/** Say "One card!" (counts while you hold two cards or fewer). */
export function callLast(prev: LCState, seat: number): LCState {
  if (prev.called[seat] || prev.hands[seat].length > 2) return prev;
  const s = clone(prev);
  s.called[seat] = true;
  return s;
}

const fewestOther = (s: LCState, seat: number) => {
  let best = nextSeat(s, seat);
  for (let p = 0; p < s.n; p++) if (p !== seat && s.hands[p].length < s.hands[best].length) best = p;
  return best;
};

/** points the winner scores: everyone else's cards */
export const scoreFor = (s: LCState) => s.hands.reduce((sum, h, p) => (p === s.winner ? sum : sum + h.reduce((t, c) => t + cardPoints(c), 0)), 0);

/* ---------------- Senevi (the CPU) ---------------- */
export type CpuMove = { kind: "play"; card: number; color: number; target?: number; callLast: boolean } | { kind: "draw" } | { kind: "pass" };

/** the colour this hand holds most of */
export function bestColor(hand: number[], rand: Rand = Math.random) {
  const count = [0, 0, 0, 0];
  for (const c of hand) {
    const k = cardOf(c);
    if (k.c < 4) count[k.c] += k.v > 9 ? 1.5 : 1;
  }
  const max = Math.max(...count);
  if (max === 0) return Math.floor(rand() * 4);
  const best = [0, 1, 2, 3].filter((i) => count[i] === max);
  return best[Math.floor(rand() * best.length)];
}

export function cpuMove(s: LCState, seat: number, rand: Rand = Math.random): CpuMove {
  const hand = s.hands[seat];
  const options = hand.filter((c) => canPlay(s, c));
  if (!options.length) return s.drawn !== null ? { kind: "pass" } : { kind: "draw" };
  const next = nextSeat(s, seat);
  const threat = s.hands[next].length <= 2; // the next player is close to going out
  const colorCount = [0, 0, 0, 0];
  for (const c of hand) {
    const k = cardOf(c);
    if (k.c < 4) colorCount[k.c]++;
  }
  let best = options[0];
  let bestScore = -Infinity;
  for (const c of options) {
    const k = cardOf(c);
    let score = 0;
    if (k.c === WILD_COLOR) {
      // keep wilds for when they're needed
      score = k.v === W4 ? (threat ? 9 : -6) : threat ? 2 : -4;
      if (options.length === 1) score = 10;
    } else {
      score = colorCount[k.c] * 1.4 + (k.v <= 9 ? k.v / 10 : 1.2);
      if (k.v >= SKIP && threat) score += 7;
      if (k.v === D2 && threat) score += 2;
      // a 7 with swapping on is great when someone else holds fewer cards
      if (s.rules.sevenZero && k.v === 7) {
        const fewest = Math.min(...s.hands.map((h, p) => (p === seat ? 99 : h.length)));
        score += fewest < hand.length - 1 ? 6 : -3;
      }
    }
    score += rand() * 0.8;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  const rest = hand.filter((c) => c !== best);
  return {
    kind: "play",
    card: best,
    color: isWild(best) ? bestColor(rest, rand) : cardOf(best).c,
    target: s.rules.sevenZero && cardOf(best).v === 7 ? fewestOther(s, seat) : undefined,
    // Senevi nearly always remembers to say it
    callLast: hand.length === 2 && rand() < 0.92,
  };
}
