/* Blackjack against the dealer, played with free chips. Every card is dealt on the server
   (supabase/cards.sql): this screen only shows what the server sends and asks it to act, so
   the deck and the dealer's hidden card can't be seen or changed from the browser. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Bot, Gift, Globe, RotateCcw } from "lucide-react";
import type { GameProps } from "../index";
import PlayFlow from "../PlayFlow";
import { CardDefs, PlayingCard } from "../cards/Card";
import { CHIP_VALUES, Chip, ChipStack, shortChips } from "../cards/Chip";
import { cardSound, chipSound, winSound } from "../cards/sounds";
import { chipsErrorText, chipsRpc, useChips, type ChipsState } from "../../lib/chips";
import "../cards/cards.css";
import "./blackjack.css";

type Hand = { cards: number[]; bet: number; done: boolean; doubled: boolean; split: boolean; total: number };
type Result = "win" | "lose" | "push" | "bust" | "dealer_bust" | "blackjack" | "dealer_blackjack";
type Outcome = { result: Result; payout: number; bet: number };
type Round = {
  id: string;
  status: "playing" | "done";
  active: number;
  hands: Hand[];
  dealer: number[];
  dealer_total: number;
  outcome: Outcome[] | null;
  chips: ChipsState;
};

const RESULT_TEXT: Record<Result, string> = {
  blackjack: "Blackjack!",
  win: "You win",
  dealer_bust: "Dealer busts",
  push: "Push",
  lose: "Dealer wins",
  bust: "Bust",
  dealer_blackjack: "Dealer blackjack",
};
const DEAL_GAP = 170; // ms between cards in the opening deal

/** True for cards of the same rank (what the server allows to split). */
const sameRank = (a: number, b: number) => a % 13 === b % 13;

export default function BlackjackGame(_props: GameProps) {
  const location = useLocation();
  const { chips, setChips, error, setError, claim, signedIn, loading } = useChips();
  const [screen, setScreen] = useState<"menu" | "table">("menu");
  const [round, setRound] = useState<Round | null>(null);
  const [bet, setBet] = useState(0);
  const [lastBet, setLastBet] = useState(0);
  const [busy, setBusy] = useState(false);

  // which cards have been on screen already (only new ones play the deal animation)
  const seen = useRef(new Set<string>());

  // resume an unfinished hand (e.g. after a reload)
  useEffect(() => {
    if (screen !== "table" || !signedIn) return;
    let gone = false;
    void chipsRpc<{ round: Round | null; chips: ChipsState }>("bj_current").then(
      (r) => {
        if (gone) return;
        setChips(r.chips);
        if (r.round) {
          setRound(r.round);
          // cards already dealt before the reload don't fly in again
          markSeen(r.round, seen.current);
        }
      },
      (e) => !gone && setError(chipsErrorText(e)),
    );
    return () => {
      gone = true;
    };
  }, [screen, signedIn, setChips, setError]);

  // after each render with a round, its cards count as shown (so they don't fly in again)
  useEffect(() => {
    if (round) markSeen(round, seen.current);
  }, [round]);

  const balance = chips?.balance ?? 0;
  const playing = round?.status === "playing";
  const minBet = chips?.min_bet ?? 10;
  const maxBet = Math.min(chips?.max_bet ?? 50000, balance);

  const send = useCallback(
    async (fn: "bj_deal" | "bj_action", args: Record<string, unknown>) => {
      setBusy(true);
      setError(null);
      try {
        const r = await chipsRpc<Round>(fn, args);
        // sounds for the newly dealt cards, in step with their animation
        const fresh = newCards(r, seen.current);
        fresh.forEach((_, i) => cardSound(i * DEAL_GAP));
        setRound(r);
        setChips(r.chips);
        if (r.status === "done" && r.outcome?.some((o) => o.payout > o.bet)) {
          window.setTimeout(winSound, fresh.length * DEAL_GAP + 350);
        }
      } catch (e) {
        setError(chipsErrorText(e));
      } finally {
        setBusy(false);
      }
    },
    [setChips, setError],
  );

  const deal = (amount: number) => {
    if (amount < minBet || amount > balance || busy) return;
    setLastBet(amount);
    setBet(0);
    void send("bj_deal", { p_bet: amount });
  };
  const act = (a: "hit" | "stand" | "double" | "split") => !busy && void send("bj_action", { p_action: a });
  const addChip = (v: number) => {
    if (bet + v > maxBet) return;
    chipSound();
    setBet((b) => b + v);
  };

  /* ---------- start screen ---------- */
  if (screen === "menu") {
    return (
      <div className="game-surface bj-surface">
        <CardDefs />
        <PlayFlow
          id="blackjack"
          preview={<BlackjackPreview />}
          corner={chips ? <ChipBalance amount={chips.balance} /> : null}
          modes={[
            { key: "dealer", label: "vs Dealer", icon: <Bot size={15} />, start: () => setScreen("table") },
            { key: "online", label: "Online table", icon: <Globe size={15} />, disabled: true, note: "Coming soon" },
          ]}
        />
      </div>
    );
  }

  /* ---------- the table ---------- */
  const hand = round && playing ? round.hands[round.active] : null;
  const canDouble = !!hand && hand.cards.length === 2 && balance >= hand.bet;
  const canSplit = !!hand && round!.hands.length === 1 && hand.cards.length === 2 && sameRank(hand.cards[0], hand.cards[1]) && balance >= hand.bet;
  const net = round?.status === "done" && round.outcome ? round.outcome.reduce((s, o) => s + o.payout - o.bet, 0) : 0;
  const broke = !!chips && chips.balance < minBet && !playing;

  return (
    <div className="game-surface bj-surface">
      <CardDefs />
      <div className="bj-top">
        <ChipBalance amount={balance} />
        {chips?.daily_ready ? (
          <button type="button" className="bj-pill bj-gift" onClick={() => void claim("daily")}>
            <Gift size={15} /> Free {shortChips(chips.daily_amount)}
          </button>
        ) : null}
        <button type="button" className="bj-pill bj-leave" onClick={() => setScreen("menu")} disabled={playing}>
          Menu
        </button>
      </div>

      <div className="ct-table bj-table">
        <div className="ct-felt bj-felt">
          {/* dealer */}
          <div className="bj-seat bj-dealer">
            <span className="bj-label">
              Dealer{round ? <b>{round.dealer_total}</b> : null}
            </span>
            <div className="cd-row">
              {round
                ? round.dealer.map((c, i) => {
                    const key = `${round.id}-d-${i}`;
                    const isNew = !seen.current.has(key);
                    // opening deal order: you, dealer, you, dealer; the dealer's later cards follow the flip
                    const delay = i < 2 ? (i * 2 + 1) * DEAL_GAP : 350 + (i - 2) * DEAL_GAP * 2;
                    return <PlayingCard key={key} card={c} faceUp={c >= 0} deal={isNew} delay={delay} />;
                  })
                : null}
            </div>
          </div>

          <p className="ct-print bj-print">Blackjack pays 3 to 2 · Dealer stands on 17</p>

          {/* result */}
          {round?.status === "done" && round.outcome ? (
            <div className={`bj-result ${net > 0 ? "is-win" : net < 0 ? "is-loss" : "is-push"}`} role="status">
              <b>{round.outcome.length > 1 ? (net > 0 ? "You win" : net < 0 ? "You lose" : "Even") : RESULT_TEXT[round.outcome[0].result]}</b>
              <span>{net > 0 ? `+${net.toLocaleString()}` : net < 0 ? `−${Math.abs(net).toLocaleString()}` : "Bet returned"}</span>
            </div>
          ) : null}

          {/* player hands */}
          <div className="bj-seat bj-player">
            {round ? (
              <div className="bj-hands">
                {round.hands.map((h, hi) => {
                  const o = round.outcome?.[hi];
                  return (
                    <div key={hi} className={`bj-hand${playing && hi === round.active && round.hands.length > 1 ? " is-active" : ""}`}>
                      <div className="cd-row">
                        {h.cards.map((c, i) => {
                          const key = `${round.id}-p${hi}-${i}`;
                          const isNew = !seen.current.has(key);
                          const delay = round.hands.length === 1 && i < 2 ? i * 2 * DEAL_GAP : 0;
                          return <PlayingCard key={key} card={c} deal={isNew} delay={delay} />;
                        })}
                      </div>
                      <div className="bj-hand-foot">
                        <span className={`bj-total${h.total > 21 ? " is-bust" : ""}`}>{h.total}</span>
                        <ChipStack amount={h.bet} size={30} />
                        {o ? <span className={`bj-tag bj-tag-${o.result}`}>{RESULT_TEXT[o.result]}</span> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="bj-betspot">{bet > 0 ? <ChipStack amount={bet} /> : <span>Place your bet</span>}</div>
            )}
            {!playing && round ? (
              <div className="bj-betspot bj-betspot-next">{bet > 0 ? <ChipStack amount={bet} size={30} /> : null}</div>
            ) : null}
          </div>
        </div>
      </div>

      {/* controls */}
      <div className="bj-controls">
        {!signedIn && !loading ? (
          <div className="bj-note">
            <p>Sign in to get 10,000 free chips and play.</p>
            <Link className="bj-btn bj-btn-main" to={`/login?next=${encodeURIComponent(location.pathname)}`}>
              Sign in
            </Link>
          </div>
        ) : playing ? (
          <div className="bj-actions">
            <button type="button" className="bj-btn" disabled={busy} onClick={() => act("hit")}>
              Hit
            </button>
            <button type="button" className="bj-btn" disabled={busy} onClick={() => act("stand")}>
              Stand
            </button>
            <button type="button" className="bj-btn" disabled={busy || !canDouble} onClick={() => act("double")}>
              Double
            </button>
            <button type="button" className="bj-btn" disabled={busy || !canSplit} onClick={() => act("split")}>
              Split
            </button>
          </div>
        ) : broke ? (
          <div className="bj-note">
            <p>You're out of chips.</p>
            {chips?.refill_ready ? (
              <button type="button" className="bj-btn bj-btn-main" onClick={() => void claim("refill")}>
                Get {shortChips(chips.refill_amount)} free chips
              </button>
            ) : chips?.daily_ready ? (
              <button type="button" className="bj-btn bj-btn-main" onClick={() => void claim("daily")}>
                Claim today's {shortChips(chips.daily_amount)}
              </button>
            ) : (
              <p className="bj-sub">Free refill {refillIn(chips?.refill_at ?? null)}.</p>
            )}
          </div>
        ) : (
          <>
            <div className="bj-chips" role="group" aria-label="Add chips to your bet">
              {CHIP_VALUES.map((v) => (
                <button key={v} type="button" className="bj-chip-btn" disabled={bet + v > maxBet} onClick={() => addChip(v)} aria-label={`Add ${v}`}>
                  <Chip value={v} size={46} />
                </button>
              ))}
            </div>
            <div className="bj-actions">
              <button type="button" className="bj-btn" disabled={bet === 0} onClick={() => setBet(0)}>
                Clear
              </button>
              {lastBet > 0 && bet === 0 ? (
                <button type="button" className="bj-btn" disabled={busy || lastBet > balance} onClick={() => deal(lastBet)}>
                  <RotateCcw size={15} /> Rebet {lastBet.toLocaleString()}
                </button>
              ) : null}
              <button type="button" className="bj-btn bj-btn-main" disabled={busy || bet < minBet} onClick={() => deal(bet)}>
                Deal{bet > 0 ? ` ${bet.toLocaleString()}` : ""}
              </button>
            </div>
          </>
        )}
        {error ? (
          <p className="bj-error" role="alert">
            {error}
          </p>
        ) : null}
        <p className="bj-fine">Chips are free play money: they can't be bought or exchanged for anything.</p>
      </div>
    </div>
  );
}

/** Keys of the cards in `r` not shown before (marks nothing: the render does). */
function newCards(r: Round, seen: Set<string>) {
  const keys = r.dealer.map((_, i) => `${r.id}-d-${i}`);
  r.hands.forEach((h, hi) => h.cards.forEach((_, i) => keys.push(`${r.id}-p${hi}-${i}`)));
  return keys.filter((k) => !seen.has(k));
}

function markSeen(r: Round, seen: Set<string>) {
  for (const k of newCards(r, seen)) seen.add(k);
}

function refillIn(at: string | null) {
  if (!at) return "soon";
  const mins = Math.max(1, Math.ceil((new Date(at).getTime() - Date.now()) / 60000));
  return `in ${mins} min`;
}

function ChipBalance({ amount }: { amount: number }) {
  return (
    <span className="bj-pill bj-balance" title="Your chips">
      <Chip value={500} size={20} /> {amount.toLocaleString()}
    </span>
  );
}

/** The start screen's picture: a corner of the table with a blackjack and a bet. */
function BlackjackPreview() {
  const cards = useMemo(() => [0, 25], []); // A♠, K♥
  return (
    <div className="pf-preview bj-preview" inert>
      <div className="ct-table">
        <div className="ct-felt bj-preview-felt">
          <div className="cd-row">
            {cards.map((c) => (
              <PlayingCard key={c} card={c} />
            ))}
          </div>
          <ChipStack amount={650} size={34} />
          <p className="ct-print">Blackjack pays 3 to 2</p>
        </div>
      </div>
    </div>
  );
}
