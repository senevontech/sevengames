/* Call Break: four players, 52 cards, 13 each, spades are always trumps.

   A round: everyone calls (bids) how many tricks they'll take, 1–8. Then 13 tricks are played.
   Rules of play (the common Indian / Nepali table rules):
     - follow the suit led, and beat the best card on the table if you can;
     - out of that suit: play a spade (beating any spade already played if you can);
     - no spade either (or no spade that beats one already played): any card.
   The best spade wins the trick, else the best card of the suit led. The winner leads next.
   Score: made your call → call + 0.1 for each extra trick; missed it → minus your call.
   After five rounds the highest total wins.

   Cards are 0–51 as in cards/Card.tsx: rank = c % 13 (0 = A … 12 = K), suit = floor(c / 13),
   suit 0 = spades. Seats: 0 = you (bottom), then clockwise 1 left, 2 top, 3 right. */
import { suitOf } from "../cards/Card";

export const ROUNDS = 5;
export const MAX_CALL = 8;
export const SPADES = 0;
export type Seat = 0 | 1 | 2 | 3;
export type Play = { seat: Seat; card: number };

export type CBState = {
  round: number;
  dealer: Seat;
  hands: number[][];
  calls: Array<number | null>;
  tricks: number[];
  /** each finished round's score per seat */
  scores: number[][];
  phase: "call" | "play" | "round-end" | "over";
  turn: Seat;
  trick: Play[];
  /** every card played this round (the CPU remembers them) */
  played: number[];
  /** the last finished trick, shown for a moment */
  last: { plays: Play[]; winner: Seat } | null;
};

/** Card strength within its suit: 2 = 0 … K = 11, A = 12. */
export const power = (c: number) => (c % 13 + 12) % 13;
export const next = (s: Seat) => ((s + 1) % 4) as Seat;

function shuffle(rand: () => number) {
  const d = Array.from({ length: 52 }, (_, i) => i);
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

/** Spades first, then hearts, clubs, diamonds (colours alternate), high to low. */
const SUIT_ORDER = [0, 1, 3, 2];
export const sortHand = (h: number[]) =>
  [...h].sort((a, b) => SUIT_ORDER.indexOf(suitOf(a)) - SUIT_ORDER.indexOf(suitOf(b)) || power(b) - power(a));

export function dealRound(prev: CBState | null, rand: () => number = Math.random): CBState {
  const dealer = prev ? next(prev.dealer) : (Math.floor(rand() * 4) as Seat);
  const deck = shuffle(rand);
  const hands = [0, 1, 2, 3].map((p) => sortHand(deck.slice(p * 13, p * 13 + 13)));
  return {
    round: prev ? prev.round + 1 : 1,
    dealer,
    hands,
    calls: [null, null, null, null],
    tricks: [0, 0, 0, 0],
    scores: prev ? prev.scores : [],
    phase: "call",
    turn: next(dealer),
    trick: [],
    played: [],
    last: null,
  };
}

/** The play currently winning a trick. */
export function winning(trick: Play[]): Play | null {
  if (!trick.length) return null;
  const led = suitOf(trick[0].card);
  let best = trick[0];
  for (const p of trick.slice(1)) {
    const bs = suitOf(best.card);
    const ps = suitOf(p.card);
    if (ps === bs ? power(p.card) > power(best.card) : ps === SPADES || (ps === led && bs !== SPADES && bs !== led)) best = p;
  }
  return best;
}

/** The cards a hand may play onto this trick. */
export function legal(hand: number[], trick: Play[]): number[] {
  if (!trick.length) return hand;
  const led = suitOf(trick[0].card);
  const best = winning(trick)!.card;
  const follow = hand.filter((c) => suitOf(c) === led);
  if (follow.length) {
    // beat the best card if it's of the suit led (once trumped, any card of the suit will do)
    if (suitOf(best) === led) {
      const higher = follow.filter((c) => power(c) > power(best));
      return higher.length ? higher : follow;
    }
    return follow;
  }
  const spades = hand.filter((c) => suitOf(c) === SPADES);
  if (!spades.length) return hand;
  if (suitOf(best) === SPADES) {
    const over = spades.filter((c) => power(c) > power(best));
    return over.length ? over : hand;
  }
  return spades;
}

/** Score for one round: made → call + 0.1 per extra trick; missed → −call. */
export function roundScore(call: number, took: number) {
  return took >= call ? Math.round((call + (took - call) * 0.1) * 10) / 10 : -call;
}
export const totalOf = (s: CBState, seat: number) => Math.round(s.scores.reduce((t, r) => t + (r[seat] ?? 0), 0) * 10) / 10;

export function placeCall(s: CBState, seat: Seat, call: number): CBState {
  if (s.phase !== "call" || s.turn !== seat) return s;
  const calls = [...s.calls];
  calls[seat] = Math.max(1, Math.min(MAX_CALL, Math.round(call)));
  const done = calls.every((c) => c !== null);
  return { ...s, calls, turn: done ? next(s.dealer) : next(seat), phase: done ? "play" : "call" };
}

/** Play a card. A completed trick is kept in `trick` (4 cards) until collect() is called. */
export function playCard(s: CBState, seat: Seat, card: number): CBState {
  if (s.phase !== "play" || s.turn !== seat || s.trick.length >= 4) return s;
  if (!legal(s.hands[seat], s.trick).includes(card)) return s;
  const hands = s.hands.map((h, i) => (i === seat ? h.filter((c) => c !== card) : h));
  const trick = [...s.trick, { seat, card }];
  return { ...s, hands, trick, played: [...s.played, card], turn: trick.length < 4 ? next(seat) : seat };
}

/** Take a finished trick off the table; ends the round after the 13th. */
export function collect(s: CBState): CBState {
  if (s.trick.length < 4) return s;
  const w = winning(s.trick)!.seat;
  const tricks = s.tricks.map((t, i) => (i === w ? t + 1 : t));
  const after: CBState = { ...s, tricks, trick: [], turn: w, last: { plays: s.trick, winner: w } };
  if (s.hands.every((h) => h.length === 0)) {
    const scores = [...s.scores, tricks.map((t, i) => roundScore(s.calls[i] ?? 1, t))];
    return { ...after, scores, phase: s.round >= ROUNDS ? "over" : "round-end" };
  }
  return after;
}

/* ---------------- CPU ---------------- */

/** How many tricks a hand is worth (a cautious estimate). */
export function cpuCall(hand: number[]): number {
  let est = 0;
  const bySuit = [0, 1, 2, 3].map((st) => hand.filter((c) => suitOf(c) === st).map(power).sort((a, b) => b - a));
  const spades = bySuit[SPADES];
  // spades: top honours, then length
  if (spades.includes(12)) est += 1;
  if (spades.includes(11)) est += spades.length >= 2 ? 0.9 : 0.4;
  if (spades.includes(10)) est += spades.length >= 3 ? 0.7 : 0.2;
  est += Math.max(0, spades.length - 3) * 0.8;
  for (const st of [1, 2, 3]) {
    const s = bySuit[st];
    if (s.includes(12)) est += s.length <= 5 ? 0.95 : 0.6;
    if (s.includes(11) && s.length >= 2 && s.length <= 5) est += s.includes(12) ? 0.7 : 0.45;
    // short suits let spades trump
    if (spades.length >= 2) est += s.length === 0 ? 0.7 : s.length === 1 ? 0.35 : 0;
  }
  return Math.max(1, Math.min(MAX_CALL, Math.round(est + 0.6)));
}

/** Is `c` the highest card of its suit still out (not played, not in `hand`)? */
function isBoss(c: number, hand: number[], played: number[]) {
  const st = suitOf(c);
  for (let r = 0; r < 13; r++) {
    const x = st * 13 + r;
    if (power(x) > power(c) && !played.includes(x) && !hand.includes(x)) return false;
  }
  return true;
}

const lowest = (cards: number[]) => cards.reduce((a, b) => (power(b) < power(a) || (power(b) === power(a) && suitOf(a) === SPADES) ? b : a));
const highest = (cards: number[]) => cards.reduce((a, b) => (power(b) > power(a) ? b : a));

export function cpuPlay(s: CBState, seat: Seat): number {
  const hand = s.hands[seat];
  const options = legal(hand, s.trick);
  if (options.length === 1) return options[0];
  const need = (s.calls[seat] ?? 1) - s.tricks[seat];
  const nonSpades = (cs: number[]) => cs.filter((c) => suitOf(c) !== SPADES);

  if (!s.trick.length) {
    // leading: cash a sure winner if tricks are still needed
    if (need > 0) {
      const bosses = options.filter((c) => isBoss(c, hand, s.played));
      const side = nonSpades(bosses);
      if (side.length) return highest(side);
      if (bosses.length) return highest(bosses);
    }
    // otherwise lead low from the longest side suit (keep spades back)
    const side = nonSpades(options);
    if (side.length) {
      const counts = [1, 2, 3].map((st) => side.filter((c) => suitOf(c) === st).length);
      const longest = [1, 2, 3][counts.indexOf(Math.max(...counts))];
      return lowest(side.filter((c) => suitOf(c) === longest));
    }
    return lowest(options);
  }

  const best = winning(s.trick)!;
  const beats = (c: number) => winning([...s.trick, { seat, card: c }])!.card === c;
  const winners = options.filter(beats);
  const last = s.trick.length === 3;
  // a partner-less game: a trick is only "safe" if I play last or my card can't be beaten
  if (need > 0 && winners.length) {
    if (last) return lowest(winners);
    const sure = winners.filter((c) => isBoss(c, hand, s.played) && (suitOf(c) === SPADES || !hasSpadesOut(s, hand, seat, suitOf(s.trick[0].card))));
    if (sure.length) return lowest(sure);
    return suitOf(best.card) === SPADES || winners.every((c) => suitOf(c) === SPADES) ? lowest(winners) : highest(winners);
  }
  // no tricks needed (or can't win): get rid of the least useful card
  const losers = options.filter((c) => !beats(c));
  const pool = losers.length ? losers : options;
  const side = nonSpades(pool);
  return lowest(side.length ? side : pool);
}

/** Could a player still to play trump this suit? (Rough: anyone after me might be out of it.) */
function hasSpadesOut(s: CBState, hand: number[], _seat: Seat, led: number) {
  const outOfSuit = 13 - s.played.filter((c) => suitOf(c) === led).length - hand.filter((c) => suitOf(c) === led).length;
  const spadesOut = 13 - s.played.filter((c) => suitOf(c) === SPADES).length - hand.filter((c) => suitOf(c) === SPADES).length;
  // few cards of the suit left out there and spades still around: someone may trump
  return spadesOut > 0 && outOfSuit <= 3;
}
