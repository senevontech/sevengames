import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Link } from "react-router-dom";
import { ENTRY } from "../lib/entries";
import TokenIcon from "./TokenIcon";
import "./chip-line.css";

/**
 * What a mode can win or lose in chips, shown on a game's start screen before playing.
 * One line; tap it for the full breakdown.
 *   cpu     "Play for chips" against the CPU (on: entry 1, win +1, lose −1; off: free)
 *   online  random matches (entry 3 each, prize 6) and friend rooms (the host sets the entry)
 *   free    no chips change hands (same device, solo, points games)
 *   table   Blackjack: free Table chips, never Chips
 */
export type ChipLineKind = "cpu" | "online" | "free" | "table";

export default function ChipLine({ kind, on = false, note }: { kind: ChipLineKind; on?: boolean; note?: string }) {
  const [open, setOpen] = useState(false);
  const r = ENTRY.randomFee;

  const line =
    kind === "cpu" ? (
      on ? (
        <>
          Entry <b>{ENTRY.cpuFee}</b> · win <b className="is-up">+{ENTRY.cpuFee}</b> · lose <b className="is-down">−{ENTRY.cpuFee}</b>
        </>
      ) : (
        <>Free match · Play for chips is off</>
      )
    ) : kind === "online" ? (
      <>
        Random match: entry <b>{r}</b> · win <b className="is-up">+{r}</b> · lose <b className="is-down">−{r}</b>
      </>
    ) : kind === "table" ? (
      <>Free Table chips only · no Chips used</>
    ) : (
      <>{note ?? "Free · no chips won or lost"}</>
    );

  const detail =
    kind === "cpu" ? (
      <ul>
        <li>
          Switch <b>Play for chips</b> on in the ⚙ settings. Each game pays a {ENTRY.cpuFee}-chip entry before it starts.
        </li>
        <li>Win: your entry back plus {ENTRY.cpuFee} (+{ENTRY.cpuFee}). Lose or leave early: the entry is gone (−{ENTRY.cpuFee}). Draw: entry returned.</li>
        <li>Up to +{ENTRY.cpuDailyCap} a day from games against Senevi. Only earned chips are used, never bought ones.</li>
      </ul>
    ) : kind === "online" ? (
      <ul>
        <li>
          Random match: both players pay {r}, the winner gets the prize of {r * 2} (+{r}); the other is −{r}. Needs {r} earned chips each, otherwise it's a free
          match.
        </li>
        <li>Friend rooms (invite code): the host sets the entry, {ENTRY.roomMin} or more each; the winner gets every entry. 4 players × 10 = a prize of 40 (+30, others −10).</li>
        <li>Draw, results that don't match, or someone who didn't pay: every entry is returned. Leaving mid-match loses it.</li>
      </ul>
    ) : kind === "table" ? (
      <ul>
        <li>Blackjack is played with free Table chips: 10,000 to start, free top-ups. They can't be bought and never turn into Chips.</li>
        <li>Your Chips balance never changes at this table.</li>
      </ul>
    ) : (
      <ul>
        <li>Nothing is paid and nothing is won in chips in this mode.</li>
      </ul>
    );

  return (
    <div className={`chipline${open ? " is-open" : ""}`}>
      <button type="button" className="chipline-row" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <TokenIcon size={15} />
        <span className="chipline-text">{line}</span>
        <ChevronDown size={15} className="chipline-chev" aria-hidden="true" />
      </button>
      {open ? (
        <div className="chipline-more">
          {detail}
          <Link to="/chips#chip-math">How chips are won and lost</Link>
        </div>
      ) : null}
    </div>
  );
}
