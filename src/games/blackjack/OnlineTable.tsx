/* Blackjack online: up to five players at one table against the dealer (supabase/blackjack_tables.sql).
   The server deals and runs the clocks; this screen asks for the table's state about once a
   second (sooner when another player pings the table's channel after a move) and sends bets
   and moves. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Lock, LogOut, RotateCcw, Users, Zap } from "lucide-react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "../../supabase";
import { useAuthContext } from "../../context/AuthContext";
import { parseAvatar, useAvatar } from "../../lib/avatar";
import PlayerAvatar from "../../components/PlayerAvatar";
import { chipsErrorText, chipsRpc, type ChipsState } from "../../lib/chips";
import { PlayingCard } from "../cards/Card";
import { CHIP_VALUES, Chip, ChipStack } from "../cards/Chip";
import { cardSound, chipSound, winSound } from "../cards/sounds";

type Result = "win" | "lose" | "push" | "bust" | "dealer_bust" | "blackjack" | "dealer_blackjack";
type Hand = { cards: number[]; bet: number; done: boolean; doubled: boolean; split: boolean; natural?: boolean; total: number };
type SeatView = {
  seat: number;
  user_id: string;
  name: string;
  avatar: unknown;
  bet: number;
  active: number;
  outcome: Array<{ result: Result; payout: number; bet: number }> | null;
  leaving: boolean;
  hands: Hand[];
};
export type TableView = {
  code: string;
  private: boolean;
  phase: "betting" | "playing" | "done";
  round: number;
  turn: number | null;
  ms_left: number | null;
  dealer: number[];
  dealer_total: number;
  seats: SeatView[];
  me: number | null;
  chips: ChipsState;
};

const RESULT_TEXT: Record<Result, string> = {
  blackjack: "Blackjack!",
  win: "Win",
  dealer_bust: "Dealer busts",
  push: "Push",
  lose: "Lose",
  bust: "Bust",
  dealer_blackjack: "Dealer BJ",
};
const DEAL_GAP = 150;
const POLL_MS = 1100;
const TURN_S = 20;

function useMe() {
  const { user } = useAuthContext();
  const { choice } = useAvatar(user);
  const meta = user?.user_metadata ?? {};
  const name = ((meta.full_name as string | undefined) || (meta.name as string | undefined) || user?.email?.split("@")[0] || "Player").slice(0, 24);
  return { user, name, avatar: choice };
}

/* ---------------- the online menu ---------------- */
export function OnlineLobby({ onSeated }: { onSeated: (v: TableView) => void }) {
  const location = useLocation();
  const { user, name, avatar } = useMe();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async (fn: string, args: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      onSeated(await chipsRpc<TableView>(fn, { p_name: name, p_avatar: avatar ?? null, ...args }));
    } catch (e) {
      setError(chipsErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!user) {
    return (
      <div className="ol-card">
        <h3>Online table</h3>
        <p className="ol-sub">Sign in to sit at a table with other players.</p>
        <Link className="primary-btn" to={`/login?next=${encodeURIComponent(location.pathname)}`}>
          Sign in
        </Link>
      </div>
    );
  }
  return (
    <div className="ol-card bjo-lobby">
      <h3>Online table</h3>
      <p className="ol-sub">Up to five players against one dealer. The server deals every card; everyone bets their own free table chips.</p>
      <button type="button" className="bj-btn bj-btn-main" disabled={busy} onClick={() => void go("bjt_quick", {})}>
        <Zap size={16} /> Quick seat
      </button>
      <button type="button" className="bj-btn" disabled={busy} onClick={() => void go("bjt_create", { p_private: true })}>
        <Lock size={15} /> Private table for friends
      </button>
      <form
        className="bjo-join"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim().length === 4) void go("bjt_join", { p_code: code.trim().toUpperCase() });
        }}
      >
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 4))} placeholder="Table code" aria-label="Table code" autoCapitalize="characters" spellCheck={false} />
        <button type="submit" className="bj-btn" disabled={busy || code.trim().length !== 4}>
          Join
        </button>
      </form>
      {error ? (
        <p className="bj-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/* ---------------- the table ---------------- */
export function OnlineTable({ initial, onLeave }: { initial: TableView; onLeave: () => void }) {
  const [view, setView] = useState<TableView>(initial);
  const viewRef = useRef(view);
  viewRef.current = view;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(0); // chips picked, not yet placed
  const [lastBet, setLastBet] = useState(0);
  const [deadline, setDeadline] = useState(() => (initial.ms_left === null ? 0 : Date.now() + initial.ms_left));
  const [, tick] = useState(0);
  // when each card first appeared (cards keep their deal animation for a moment)
  const seen = useRef(new Map<string, number>());
  const chan = useRef<RealtimeChannel | null>(null);
  const code = initial.code;

  // cards already on the table when you sit down don't fly in
  useMemo(() => markSeen(initial, seen.current, 0), [initial]);

  const apply = useCallback((v: TableView) => {
    const prev = viewRef.current;
    const fresh = newCards(v, seen.current);
    fresh.forEach((_, i) => cardSound(i * DEAL_GAP));
    markSeen(v, seen.current, Date.now());
    // your result: a chime when you came out ahead
    if (v.phase === "done" && prev.phase !== "done" && v.me !== null) {
      const mine = v.seats.find((s) => s.seat === v.me);
      const net = mine?.outcome?.reduce((s, o) => s + o.payout - o.bet, 0) ?? 0;
      if (net > 0) window.setTimeout(winSound, fresh.length * DEAL_GAP + 300);
    }
    viewRef.current = v;
    setView(v);
    setDeadline(v.ms_left === null ? 0 : Date.now() + v.ms_left);
  }, []);

  const refresh = useCallback(async () => {
    try {
      apply(await chipsRpc<TableView>("bjt_state", { p_code: code }));
      setError(null);
    } catch (e) {
      const msg = (e as Error).message ?? "";
      if (msg.includes("no_table")) onLeave();
      else setError(chipsErrorText(e));
    }
  }, [apply, code, onLeave]);

  // keep in step: poll, plus a ping from whoever just moved
  useEffect(() => {
    const id = window.setInterval(() => void refresh(), POLL_MS);
    const t = window.setInterval(() => tick((n) => n + 1), 250);
    if (supabase) {
      const ch = supabase.channel(`bjt:${code}`, { config: { broadcast: { self: false } } });
      ch.on("broadcast", { event: "ch" }, () => void refresh());
      ch.subscribe();
      chan.current = ch;
    }
    return () => {
      window.clearInterval(id);
      window.clearInterval(t);
      if (chan.current && supabase) void supabase.removeChannel(chan.current);
      chan.current = null;
    };
  }, [code, refresh]);

  const send = async (fn: string, args: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      apply(await chipsRpc<TableView>(fn, { p_code: code, ...args }));
      void chan.current?.send({ type: "broadcast", event: "ch", payload: {} });
    } catch (e) {
      setError(chipsErrorText(e));
      void refresh();
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    try {
      await chipsRpc("bjt_leave");
      void chan.current?.send({ type: "broadcast", event: "ch", payload: {} });
    } catch {
      /* gone anyway */
    }
    onLeave();
  };

  const me = view.seats.find((s) => s.seat === view.me) ?? null;
  const others = view.seats.filter((s) => s.seat !== view.me);
  const balance = view.chips.balance;
  const msLeft = deadline ? Math.max(0, deadline - Date.now()) : null;
  const myTurn = view.phase === "playing" && me !== null && view.turn === me.seat;
  const hand = myTurn && me ? me.hands[me.active] : null;
  const canDouble = !!hand && hand.cards.length === 2 && balance >= hand.bet;
  const canSplit = !!hand && me!.hands.length === 1 && hand.cards.length === 2 && hand.cards[0] % 13 === hand.cards[1] % 13 && balance >= hand.bet;
  const turnSeat = view.seats.find((s) => s.seat === view.turn);
  const maxBet = Math.min(view.chips.max_bet, balance + (me?.bet ?? 0));

  const placeBet = (amount: number) => {
    if (amount < view.chips.min_bet || busy) return;
    setLastBet(amount);
    setPending(0);
    void send("bjt_bet", { p_amount: amount });
  };

  const status =
    view.phase === "betting"
      ? me && me.bet > 0
        ? `Bet placed · cards in ${Math.ceil((msLeft ?? 0) / 1000)}s or when everyone's in`
        : view.seats.some((s) => s.bet > 0)
          ? `Place your bet · ${Math.ceil((msLeft ?? 0) / 1000)}s`
          : "Place your bet to start the round"
      : view.phase === "playing"
        ? myTurn
          ? `Your move · ${Math.ceil((msLeft ?? 0) / 1000)}s`
          : `${turnSeat?.name ?? "Someone"} is playing…`
        : `Next round in ${Math.ceil((msLeft ?? 0) / 1000)}s`;

  return (
    <div className="bjo">
      <div className="bj-top">
        <span className="bj-pill bj-balance" title="Your table chips">
          <Chip value={500} size={20} /> {balance.toLocaleString()}
        </span>
        <span className="bj-pill bjo-code" title={view.private ? "Private table: share this code" : "Table code"}>
          {view.private ? <Lock size={13} /> : <Users size={13} />} {view.code}
        </span>
        <button type="button" className="bj-pill bj-leave" onClick={() => void leave()}>
          <LogOut size={14} /> Leave
        </button>
      </div>

      <div className="ct-table bj-table">
        <div className="ct-felt bj-felt bjo-felt">
          {/* dealer */}
          <div className="bj-seat bj-dealer">
            <span className="bj-label">Dealer{view.dealer.length ? <b>{view.dealer_total}</b> : null}</span>
            <div className="cd-row">
              {view.dealer.map((c, i) => {
                const key = `${view.round}-d-${i}`;
                return <PlayingCard key={key} card={c} faceUp={c >= 0} deal={isFresh(seen.current, key)} delay={i * DEAL_GAP} />;
              })}
            </div>
          </div>

          <p className="ct-print bj-print">Blackjack pays 3 to 2 · Dealer stands on 17</p>

          {/* the other players */}
          <div className="bjo-others">
            {others.length === 0 ? <p className="bjo-empty">Waiting for other players… share code {view.code}</p> : null}
            {others.map((s) => (
              <SeatBox key={s.seat} s={s} view={view} seen={seen.current} small msLeft={view.turn === s.seat ? msLeft : null} />
            ))}
          </div>

          {/* you */}
          {me ? <SeatBox s={me} view={view} seen={seen.current} msLeft={myTurn ? msLeft : null} mine pending={pending} /> : null}
        </div>
      </div>

      <p className="bjo-status" aria-live="polite">
        {status}
      </p>

      <div className="bj-controls">
        {view.phase === "playing" && myTurn ? (
          <div className="bj-actions">
            <button type="button" className="bj-btn" disabled={busy} onClick={() => void send("bjt_action", { p_action: "hit" })}>
              Hit
            </button>
            <button type="button" className="bj-btn" disabled={busy} onClick={() => void send("bjt_action", { p_action: "stand" })}>
              Stand
            </button>
            <button type="button" className="bj-btn" disabled={busy || !canDouble} onClick={() => void send("bjt_action", { p_action: "double" })}>
              Double
            </button>
            <button type="button" className="bj-btn" disabled={busy || !canSplit} onClick={() => void send("bjt_action", { p_action: "split" })}>
              Split
            </button>
          </div>
        ) : view.phase === "betting" && me ? (
          me.bet > 0 ? (
            <div className="bj-actions">
              <button type="button" className="bj-btn" disabled={busy} onClick={() => void send("bjt_bet", { p_amount: 0 })}>
                Take back {me.bet.toLocaleString()}
              </button>
            </div>
          ) : balance < view.chips.min_bet ? (
            <div className="bj-note">
              <p>You're out of table chips.</p>
              <p className="bj-sub">Leave the table to claim free table chips.</p>
            </div>
          ) : (
            <>
              <div className="bj-chips" role="group" aria-label="Add chips to your bet">
                {CHIP_VALUES.map((v) => (
                  <button
                    key={v}
                    type="button"
                    className="bj-chip-btn"
                    disabled={pending + v > maxBet}
                    onClick={() => {
                      chipSound();
                      setPending((p) => p + v);
                    }}
                    aria-label={`Add ${v}`}
                  >
                    <Chip value={v} size={44} />
                  </button>
                ))}
              </div>
              <div className="bj-actions">
                <button type="button" className="bj-btn" disabled={pending === 0} onClick={() => setPending(0)}>
                  Clear
                </button>
                {lastBet > 0 && pending === 0 ? (
                  <button type="button" className="bj-btn" disabled={busy || lastBet > balance} onClick={() => placeBet(lastBet)}>
                    <RotateCcw size={15} /> Rebet {lastBet.toLocaleString()}
                  </button>
                ) : null}
                <button type="button" className="bj-btn bj-btn-main" disabled={busy || pending < view.chips.min_bet} onClick={() => placeBet(pending)}>
                  Bet{pending > 0 ? ` ${pending.toLocaleString()}` : ""}
                </button>
              </div>
            </>
          )
        ) : null}
        {error ? (
          <p className="bj-error" role="alert">
            {error}
          </p>
        ) : null}
        <p className="bj-fine">Table chips are free play money: they can't be bought or exchanged for anything, and they're separate from the Chips in your wallet.</p>
      </div>
    </div>
  );
}

function SeatBox({
  s,
  view,
  seen,
  small = false,
  mine = false,
  msLeft,
  pending = 0,
}: {
  s: SeatView;
  view: TableView;
  seen: Map<string, number>;
  small?: boolean;
  mine?: boolean;
  msLeft: number | null;
  pending?: number;
}) {
  const turn = view.phase === "playing" && view.turn === s.seat;
  const net = s.outcome ? s.outcome.reduce((a, o) => a + o.payout - o.bet, 0) : null;
  const sitting = view.phase !== "betting" && s.hands.length === 0;
  return (
    <div className={`bjo-seat${small ? " is-small" : " is-mine"}${turn ? " is-turn" : ""}${s.leaving ? " is-leaving" : ""}`}>
      <div className="bjo-who">
        <PlayerAvatar id={s.user_id} name={s.name} avatar={parseAvatar(s.avatar)} size={small ? 22 : 28} className="lb-initial bjo-av" />
        <span className="bjo-name">{mine ? "You" : s.name}</span>
        {turn && msLeft !== null ? <span className={`bjo-clock${msLeft < 6000 ? " is-low" : ""}`} style={{ "--p": `${(msLeft / (TURN_S * 1000)) * 100}%` } as React.CSSProperties} /> : null}
        {net !== null ? <b className={`bjo-net${net > 0 ? " is-up" : net < 0 ? " is-down" : ""}`}>{net > 0 ? `+${net.toLocaleString()}` : net < 0 ? `−${Math.abs(net).toLocaleString()}` : "±0"}</b> : null}
      </div>
      {s.hands.length ? (
        <div className="bj-hands">
          {s.hands.map((h, hi) => {
            const o = s.outcome?.[hi];
            return (
              <div key={hi} className={`bj-hand${turn && hi === s.active && s.hands.length > 1 ? " is-active" : ""}`}>
                <div className="cd-row">
                  {h.cards.map((c, i) => {
                    const key = `${view.round}-s${s.seat}-h${hi}-${i}`;
                    return <PlayingCard key={key} card={c} deal={isFresh(seen, key)} delay={i * DEAL_GAP} />;
                  })}
                </div>
                <div className="bj-hand-foot">
                  <span className={`bj-total${h.total > 21 ? " is-bust" : ""}`}>{h.total}</span>
                  <ChipStack amount={h.bet} size={small ? 22 : 30} />
                  {o ? <span className={`bj-tag bj-tag-${o.result}`}>{RESULT_TEXT[o.result]}</span> : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className={`bj-betspot${small ? " bjo-spot-small" : ""}`}>
          {s.bet > 0 ? <ChipStack amount={s.bet} size={small ? 24 : 34} /> : pending > 0 ? <ChipStack amount={pending} size={34} /> : <span>{sitting ? "Sitting out" : mine ? "Your bet" : "Betting…"}</span>}
        </div>
      )}
    </div>
  );
}

/* which cards have been shown (only new ones animate) */
function allKeys(v: TableView) {
  const keys = v.dealer.map((_, i) => `${v.round}-d-${i}`);
  v.seats.forEach((s) => s.hands.forEach((h, hi) => h.cards.forEach((_, i) => keys.push(`${v.round}-s${s.seat}-h${hi}-${i}`))));
  return keys;
}
function newCards(v: TableView, seen: Map<string, number>) {
  return allKeys(v).filter((k) => !seen.has(k));
}
function markSeen(v: TableView, seen: Map<string, number>, at: number) {
  for (const k of allKeys(v)) if (!seen.has(k)) seen.set(k, at);
}
const isFresh = (seen: Map<string, number>, key: string) => Date.now() - (seen.get(key) ?? Date.now()) < 1500;
