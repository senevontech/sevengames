/* Online match results (supabase/matches.sql): every player's device reports the result.
   Win: +100 XP straight away, +1 token once another player in the match confirms it.
   Loss: −40 XP (never below the start of your level). Draw: +30 XP.
   Only signed-in players count; guests (no account id) are left out of the players list. */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../supabase";
import { useAuthContext } from "../context/AuthContext";
import { useTokens } from "./tokens";
import { betErrorText, betOutcomeText, joinMatchBet, matchBetStatus, type BetKind, type BetState } from "./bets";
import TokenIcon from "../components/TokenIcon";
import "../components/match-reward.css";

export type MatchGame = "chess" | "ludo" | "carrom" | "arrows" | "pool";

export type MatchReward = {
  /** XP actually added (negative for a loss; 0 when rate-limited) */
  xpDelta: number;
  /** win token paid */
  token: boolean;
  /** waiting for the other player to confirm the win */
  awaiting: boolean;
  /** the player's XP in this game after the change */
  xp: number;
  /** the chip bet on this match, if there was one */
  bet?: BetState | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ids = (list: Array<string | null | undefined>) => [...new Set(list.filter((x): x is string => Boolean(x && UUID.test(x))))];

/**
 * report(matchId, players, winners, draw?) once per finished online match (repeat calls for the
 * same match are ignored). `reward` is what this player got; it updates when the win token arrives.
 * `onXp` gets the new XP total so the game's level bar can update.
 */
export function useMatchReport(game: MatchGame, onXp?: (xp: number) => void) {
  const { user } = useAuthContext();
  const { refresh: refreshTokens } = useTokens();
  const [reward, setReward] = useState<MatchReward | null>(null);
  const reported = useRef<string | null>(null);
  // the chip bet on the current match
  const [bet, setBet] = useState<BetState | null>(null);
  const [betError, setBetError] = useState<string | null>(null);
  const betMatch = useRef<string | null>(null);
  const onXpRef = useRef(onXp);
  onXpRef.current = onXp;
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const report = useCallback(
    async (matchId: string, players: Array<string | null | undefined>, winners: Array<string | null | undefined>, draw = false) => {
      if (!user || !supabase || !matchId || reported.current === matchId) return;
      reported.current = matchId;
      const p = ids([user.id, ...players]);
      const w = draw ? [] : ids(winners).filter((x) => p.includes(x));
      const won = !draw && w.includes(user.id);
      try {
        const { data, error } = await supabase.rpc("match_report", {
          p_game: game,
          p_match: matchId.slice(0, 80),
          p_players: p,
          p_winners: w,
          p_draw: draw,
        });
        if (error || !data || !alive.current) return;
        if (betMatch.current === matchId) void followBet(matchId);
        const r = data as { xp_delta: number; token: boolean; xp: number };
        // a win with nobody else signed in can't be confirmed: no token to wait for
        const confirmable = won && p.length > 1;
        setReward({ xpDelta: r.xp_delta, token: r.token, awaiting: confirmable && !r.token, xp: r.xp });
        onXpRef.current?.(r.xp);
        if (r.token) void refreshTokens();
        if (!confirmable || r.token) return;
        // the loser's device usually confirms within a few seconds
        for (const wait of [2500, 5000, 9000]) {
          await new Promise((res) => setTimeout(res, wait));
          if (!alive.current || reported.current !== matchId) return;
          const { data: paid } = await supabase.rpc("match_token_paid", { p_game: game, p_match: matchId.slice(0, 80) });
          if (paid) {
            setReward((cur) => (cur ? { ...cur, token: true, awaiting: false } : cur));
            void refreshTokens();
            return;
          }
        }
        setReward((cur) => (cur ? { ...cur, awaiting: false } : cur));
      } catch {
        /* offline or not set up (matches.sql): the match just doesn't count */
      }
    },
    [user, game, refreshTokens],
  );

  /** after the match: wait for the bet to settle on the server (every player's report agreeing) */
  const followBet = useCallback(
    async (matchId: string) => {
      for (const wait of [800, 1500, 2500, 4000, 6000, 10000, 20000, 40000, 90000, 180000]) {
        await new Promise((res) => setTimeout(res, wait));
        if (!alive.current || betMatch.current !== matchId) return;
        try {
          const st = await matchBetStatus(game, matchId);
          if (st.status === "none") return;
          setBet(st);
          if (st.status !== "open") {
            void refreshTokens();
            return;
          }
        } catch {
          return;
        }
      }
    },
    [game, refreshTokens],
  );

  /**
   * Stake chips on the match that's starting (every player calls this with the same stake).
   * `kind`: "random" for random matching (stake 3), "room" for friend rooms.
   */
  const joinBet = useCallback(
    async (matchId: string, players: Array<string | null | undefined>, kind: BetKind, stake: number) => {
      if (!user || !matchId || stake <= 0 || betMatch.current === matchId) return;
      betMatch.current = matchId;
      setBetError(null);
      const p = ids([user.id, ...players]);
      if (p.length < 2) return;
      try {
        const r = await joinMatchBet(game, matchId, kind, stake, p);
        if (!alive.current || betMatch.current !== matchId) return;
        setBet({ id: r.id, status: "open", stake, payout: 0 });
        void refreshTokens();
      } catch (e) {
        if (alive.current) setBetError(betErrorText(e));
      }
    },
    [user, game, refreshTokens],
  );

  /** A new match is starting: clear the last result. */
  const reset = useCallback(() => {
    setReward(null);
    setBet(null);
    setBetError(null);
    betMatch.current = null;
  }, []);

  // the bet rides along with the reward, so every result screen shows it
  const withBet: MatchReward | null = reward ? { ...reward, bet } : bet && bet.status !== "open" ? { xpDelta: 0, token: false, awaiting: false, xp: 0, bet } : null;
  return { report, reward: withBet, reset, joinBet, bet, betError };
}

/** "+100 XP · +1 token" / "−40 XP" line for result screens. */
export function MatchRewardLine({ reward, className = "" }: { reward: MatchReward | null; className?: string }) {
  if (!reward) return null;
  const { xpDelta, token, awaiting, bet } = reward;
  const betText = bet ? betOutcomeText(bet) : "";
  if (!xpDelta && !token && !awaiting && !betText) return null;
  return (
    <p className={`match-reward ${className}`} role="status">
      {xpDelta ? <b className={xpDelta > 0 ? "is-up" : "is-down"}>{xpDelta > 0 ? `+${xpDelta}` : `−${Math.abs(xpDelta)}`} XP</b> : null}
      {token ? (
        <b className="is-token">
          +1 <TokenIcon size={14} />
        </b>
      ) : awaiting ? (
        <span className="match-reward-wait">chip on its way…</span>
      ) : null}
      {betText ? (
        <b className={`is-bet${bet!.status === "won" && bet!.payout > bet!.stake ? " is-up" : bet!.status === "lost" ? " is-down" : ""}`}>
          <TokenIcon size={14} /> {betText}
        </b>
      ) : null}
    </p>
  );
}

/** A fresh id for a match, shared by sending it to the other players. */
export const newMatchId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
