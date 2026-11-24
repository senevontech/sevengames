# Senevon progress sheet

What's built, what's waiting, and what's planned. Newest first.

## Chips: betting and gifts (2026-11-24)

The site currency is **Chips** (stored as "tokens" in the database). Rules:

| | |
|---|---|
| Welcome bonus | 100 chips for a new account (was 1,000) |
| Earned vs bought | Bought chips (packs, Plus) only buy shop items and premium plays. **Only earned chips** (rewards, wins, gifts) can be bet or gifted. Spending uses earned chips first. |
| vs CPU | Optional, 1 chip a game: win +1, lose −1. At most +20 a day from CPU bets; a "win" faster than a real game refunds the stake. Leaving a CPU game early loses the stake (Chess keeps it for a resumed game). |
| Friend rooms (invite codes) | The host picks a stake: Off, or 5+ chips each, capped at the poorest player's earned chips. The winner takes the pot. |
| Random online matches | 3 chips each when both players have 3 earned chips; the winner takes the 6. |
| Same device | No betting (one account). |
| Settling | On the server, from the results every player's device already reports. Draws, results that don't match, or a player who never staked: everyone's stake comes back. A player who leaves forfeits. |
| Gifts | Earned chips to any player, from their profile. Up to 500 a day, account 3+ days old. |
| Shop | Chips buy any item: no level requirement (Carrom strength upgrades keep theirs). |

Games with bets: Chess, Ludo, Carrom, Eight Ball (CPU and online), Arrows (online).

**To switch it on (Supabase SQL Editor, in this order):** `tokens.sql`, `adfree.sql`, `shop.sql`, `carrom.sql`, `engagement.sql`, `matches.sql`, then the new `bets.sql`.

Not done yet / to check:
- [ ] Run the SQL above on the live database.
- [ ] Two-player test of a room bet and a random-match bet on real devices.
- [ ] Google Play listing text and product names still say "tokens".
- [ ] Guests still start with 300 guest chips (more than the 100 welcome); decide whether to lower it.

## Planned: community clans (later phase)

Players build a **club** (clan); other players can join it. Members can:
- play against each other (club rooms),
- share chips with the club (a shared club wallet, earned chips only),
- create club tournaments.

Open questions for when we start: club size limit, who can spend the club wallet (owner / officers / votes), joining by invite or open, tournament entry and prizes (earned chips only, same rules as bets), moderation (kick / ban, club names).

## Earlier

- Chips redesign: SG poker chip icon, floating 3D chip on the Chips page, `/tokens` → `/chips`.
- Eight Ball: Endless timed mode (+3 s a ball, +7 s per 3-shot combo), landscape-only phone layout, touch aiming.
