# Senevon progress sheet

What's built, what's waiting, and what's planned. Newest first.

## Chips: chip matches and gifts (2026-11-24)

The site currency is **Chips** (stored as "tokens" in the database). Players can play a match for
chips: everyone pays the same **match entry**, and the winner gets the **prize**. (The words "bet",
"stake" and "wager" are not used anywhere, by choice.)

| | |
|---|---|
| Welcome bonus | 100 chips for a new account (was 1,000). Guests get 25 to try premium games (was 300). |
| Earned vs bought | Bought chips (packs, Plus) only buy shop items and premium plays. **Only earned chips** (rewards, wins, gifts) can pay match entries or be gifted. Spending uses earned chips first. |
| vs CPU | "Play for chips", switched on in the vs-CPU settings: a 1-chip entry, win +1, lose −1. At most +20 a day from CPU matches; a "win" faster than a real game just returns the entry. Leaving a CPU game early loses the entry (Chess keeps it for a resumed game). |
| Friend rooms (invite codes) | The host sets the entry: Free, or 5+ chips each, capped at the poorest player's earned chips. The winner gets every entry as the prize. |
| Random online matches | A 3-chip entry each when both players have 3 earned chips; the winner gets the prize of 6. |
| Same device | Always free (one account). |
| Settling | On the server, from the results every player's device already reports. Draws, results that don't match, or a player who never paid: every entry is returned. A player who leaves forfeits. |
| Gifts | Earned chips to any player, from their profile. Up to 500 a day, account 3+ days old. |
| Shop | Chips buy any item: no level requirement (Carrom strength upgrades keep theirs). |

Games with chip matches: Chess, Ludo, Carrom, Eight Ball (CPU and online), Arrows (online).

**To switch it on (Supabase SQL Editor, in this order):** `tokens.sql`, `adfree.sql`, `shop.sql`, `carrom.sql`, `engagement.sql`, `matches.sql`, then the new `entries.sql`.

Not done yet / to check:
- [ ] Run the SQL above on the live database.
- [ ] Two-player test of a friend-room chip match and a random chip match on real devices.
- [ ] Google Play listing text and product names still say "tokens".

## Chips shown before play (2026-11-24)

- Every game's start screen shows a chip line for the chosen mode (tap for the full breakdown):
  vs CPU "Entry 1 · win +1 · lose −1" (or "Free match" when Play for chips is off), online
  "Random match: entry 3 · win +3 · lose −3" plus friend-room rules, same device / solo / Endless /
  Call Break "Free", Blackjack "Free Table chips only · no Chips used". (`components/ChipLine.tsx`)
- Chips page: "How chips are won and lost" (`/chips#chip-math`): earned vs bought bar, drawn flows
  for vs CPU and random matches, a friend-room calculator, when entries come back, and the Table
  chips note. (`components/ChipMath.tsx`)

## Card table: Blackjack & Call Break (2026-11-24)

- The card game (id `blackjack`) is now **Blackjack & Call Break**: two modes on one felt table.
- Blackjack's screens no longer say "bet" ("Place your chips", "Chips returned"); its server code
  keeps its internal names (no SQL to re-run).
- **Call Break** vs three CPU players: 5 rounds, spades are trumps, call 1–8 tricks, follow suit and
  beat the best card if you can, else trump. Made call → call + 0.1 a trick over; missed → −call.
  Rules and CPU in `src/games/callbreak/engine.ts` (simulated: no illegal plays; CPUs make their
  call about 80% of the time).
- Not done yet: Call Break online (server-dealt, like the Blackjack tables), XP / leaderboard for it.

## Planned: community clans (later phase)

Players build a **club** (clan); other players can join it. Members can:
- play against each other (club rooms),
- share chips with the club (a shared club wallet, earned chips only),
- create club tournaments.

Open questions for when we start: club size limit, who can spend the club wallet (owner / officers / votes), joining by invite or open, tournament entry and prizes (earned chips only, same rules as chip matches), moderation (kick / ban, club names).

## Earlier

- Chips redesign: SG poker chip icon, floating 3D chip on the Chips page, `/tokens` → `/chips`.
- Eight Ball: Endless timed mode (+3 s a ball, +7 s per 3-shot combo), landscape-only phone layout, touch aiming.
