import { useState } from "react";
import { SeneviIcon } from "../senevi/Senevi";
import { Bot, Globe, RotateCcw, Users } from "lucide-react";
import { ENTRY } from "../lib/entries";
import TokenIcon from "./TokenIcon";
import "./chip-math.css";

/** A little pile of chips with its amount (up to five drawn). */
function Pile({ n, tone = "" }: { n: number; tone?: "" | "up" | "down" | "muted" }) {
  const shown = Math.max(0, Math.min(5, n));
  return (
    <span className={`cm-pile${tone ? ` is-${tone}` : ""}`}>
      <span className="cm-chips" aria-hidden="true">
        {shown ? Array.from({ length: shown }, (_, i) => <TokenIcon key={i} size={18} />) : <span className="cm-none">0</span>}
      </span>
      <b>{n}</b>
    </span>
  );
}

/** An arrow between steps of a flow. */
const To = ({ label }: { label?: string }) => (
  <span className="cm-to" aria-hidden="true">
    {label ? <small>{label}</small> : null}
    <svg viewBox="0 0 40 12" width="40" height="12">
      <path d="M1 6h34M30 1l6 5-6 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </span>
);

/**
 * "How chips are won and lost" on the Chips page: the split of your wallet, each kind of chip
 * match drawn as a flow (entry → prize → result), and a calculator for friend-room entries.
 */
export default function ChipMath({ earned, bought }: { earned: number | null; bought: number | null }) {
  const r = ENTRY.randomFee;
  const c = ENTRY.cpuFee;
  const [players, setPlayers] = useState(2);
  const [entry, setEntry] = useState(10);
  const fee = Math.max(ENTRY.roomMin, Math.floor(entry) || ENTRY.roomMin);
  const prize = fee * players;
  const total = (earned ?? 0) + (bought ?? 0);

  return (
    <section className="tw-section cm" id="chip-math" aria-labelledby="cm-title">
      <div className="ac-section-head">
        <div>
          <h2 className="ac-h2" id="cm-title">
            How chips are won and lost
          </h2>
          <p className="ac-sub">Play a match for chips: everyone pays the same entry, the winner gets the prize. Every game shows its numbers before you press Play.</p>
        </div>
      </div>

      {/* earned vs bought */}
      {earned !== null && bought !== null ? (
        <div className="ac-card cm-wallet">
          <div className="cm-bar" role="img" aria-label={`${earned} earned chips, ${bought} bought chips`}>
            <span className="cm-bar-earned" style={{ flexGrow: total ? earned : 1 }} />
            <span className="cm-bar-bought" style={{ flexGrow: total ? bought : 0 }} />
          </div>
          <div className="cm-legend">
            <span>
              <i className="cm-dot is-earned" /> <b>{earned.toLocaleString()}</b> earned · pays match entries and gifts
            </span>
            <span>
              <i className="cm-dot is-bought" /> <b>{bought.toLocaleString()}</b> bought · shop and premium games only
            </span>
          </div>
        </div>
      ) : null}

      <div className="cm-grid">
        {/* vs Senevi */}
        <article className="ac-card cm-card">
          <h3>
            <SeneviIcon size={18} /> vs Senevi · Play for chips
          </h3>
          <div className="cm-flow">
            <Pile n={c} />
            <To label="entry" />
            <div className="cm-split">
              <span>
                Win <Pile n={c * 2} tone="up" /> <em className="is-up">+{c}</em>
              </span>
              <span>
                Lose <Pile n={0} tone="down" /> <em className="is-down">−{c}</em>
              </span>
            </div>
          </div>
          <p className="cm-note">Switch it on in the game's ⚙ settings. Up to +{ENTRY.cpuDailyCap} a day; a draw returns the entry.</p>
        </article>

        {/* random match */}
        <article className="ac-card cm-card">
          <h3>
            <Globe size={16} aria-hidden="true" /> Random online match
          </h3>
          <div className="cm-flow">
            <div className="cm-join">
              <Pile n={r} />
              <span className="cm-plus">+</span>
              <Pile n={r} />
            </div>
            <To label="prize" />
            <div className="cm-split">
              <span>
                Winner <Pile n={r * 2} tone="up" /> <em className="is-up">+{r}</em>
              </span>
              <span>
                Other <Pile n={0} tone="down" /> <em className="is-down">−{r}</em>
              </span>
            </div>
          </div>
          <p className="cm-note">Both players need {r} earned chips, otherwise it's a free match.</p>
        </article>

        {/* friend room calculator */}
        <article className="ac-card cm-card cm-calc">
          <h3>
            <Users size={16} aria-hidden="true" /> Friend room · work it out
          </h3>
          <div className="cm-controls">
            <label>
              Players
              <span className="cm-seg" role="radiogroup" aria-label="Players">
                {[2, 3, 4].map((n) => (
                  <button key={n} type="button" className={players === n ? "is-on" : ""} aria-pressed={players === n} onClick={() => setPlayers(n)}>
                    {n}
                  </button>
                ))}
              </span>
            </label>
            <label>
              Entry each
              <input type="number" inputMode="numeric" min={ENTRY.roomMin} value={entry} onChange={(e) => setEntry(Number(e.target.value))} aria-label="Entry per player" />
            </label>
          </div>
          <div className="cm-sum" aria-live="polite">
            <span>
              {players} × <b>{fee}</b> = prize <b>{prize}</b>
            </span>
            <span>
              Winner <em className="is-up">+{prize - fee}</em>
            </span>
            <span>
              {players > 2 ? "Each other player" : "Other player"} <em className="is-down">−{fee}</em>
            </span>
          </div>
          <p className="cm-note">The host sets the entry ({ENTRY.roomMin} or more), up to what the poorest player has earned.</p>
        </article>

        {/* returned */}
        <article className="ac-card cm-card">
          <h3>
            <RotateCcw size={16} aria-hidden="true" /> When entries come back
          </h3>
          <ul className="cm-list">
            <li>
              <b>Draw</b>: everyone gets their entry back.
            </li>
            <li>
              <b>Results don't match</b> (two players both claim the win): every entry is returned.
            </li>
            <li>
              <b>Someone didn't pay</b> the entry: the match is free, entries returned.
            </li>
            <li>
              <b>Leaving mid-match</b> counts as a loss: your entry goes to the winner.
            </li>
          </ul>
        </article>
      </div>

      <p className="cm-foot">
        Blackjack is played with free <b>Table chips</b>, a separate currency that can't be bought. Your Chips never change at the Blackjack table.
      </p>
    </section>
  );
}
