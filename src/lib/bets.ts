/* Chip bets and gifts (supabase/bets.sql). Only EARNED chips (rewards, wins, gifts) can be bet or
   gifted; chips bought with money can't. Every stake and payout is decided on the server.

   vs CPU          stake 1: win +1, lose −1 (wins capped at +20 a day, quick "wins" just refund)
   friend rooms    the host picks a stake (5 or more, up to the poorest player's earned chips);
                   the winner takes the pot
   random matches  everyone stakes 3; the winner takes the pot of 6
   gifts           earned chips to anyone, 500 a day, from accounts 3+ days old */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../supabase";
import { useAuthContext } from "../context/AuthContext";
import { useTokens } from "./tokens";

export type BetGame = "chess" | "ludo" | "carrom" | "arrows" | "pool";
export type BetKind = "room" | "random";
export type BetStatus = "open" | "won" | "lost" | "draw" | "refunded" | "none";
export type BetState = { id?: string; status: BetStatus; stake: number; payout: number; note?: string | null };

export const BET = {
  cpuStake: 1,
  cpuDailyCap: 20,
  randomStake: 3,
  roomMin: 5,
  giftDailyCap: 500,
  /** quick picks for a room's stake */
  roomPresets: [5, 10, 25, 50, 100, 250],
} as const;

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!supabase) throw new Error("offline");
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export function betErrorText(err: unknown) {
  const msg = (err as { message?: string })?.message ?? String(err);
  if (msg.includes("insufficient_earned")) return "Not enough earned chips. Bought chips can't be bet or gifted.";
  if (msg.includes("not_signed_in")) return "Sign in to bet chips.";
  if (msg.includes("stake_mismatch")) return "The stake changed. Rejoin the room.";
  if (msg.includes("match_settled")) return "That match is already over.";
  if (msg.includes("bad_stake")) return "That stake isn't allowed.";
  if (msg.includes("account_too_new")) return "Your account needs to be 3 days old to send gifts.";
  if (msg.includes("gift_limit")) return `You can send up to ${BET.giftDailyCap} chips a day.`;
  if (msg.includes("bad_recipient")) return "You can't send chips to that player.";
  if (msg.includes("Could not find the function")) return "Betting isn't set up on the server yet (run supabase/bets.sql).";
  return "Something went wrong. Please try again.";
}

/** What a settled bet did to your chips: "+3", "−1", "refunded"… */
export function betOutcomeText(b: BetState) {
  const net = b.payout - b.stake;
  if (b.status === "won") return b.note === "capped" ? "Won · daily CPU limit reached, stake back" : `+${net} chip${net === 1 ? "" : "s"}`;
  if (b.status === "lost") return `−${b.stake} chip${b.stake === 1 ? "" : "s"}`;
  if (b.status === "draw") return "Draw · stake back";
  if (b.status === "refunded")
    return b.note === "too_fast" ? "Too quick to count · stake back" : b.note === "disagreed" ? "Results didn't match · stake back" : "Stake back";
  if (b.status === "open") return "Settling the bet…";
  return "";
}

/* ---------------- online matches ---------------- */
export const joinMatchBet = (game: BetGame, matchId: string, kind: BetKind, stake: number, players: string[]) =>
  rpc<{ id: string; earned: number; balance: number }>("bet_match_join", {
    p_game: game,
    p_match: matchId.slice(0, 80),
    p_kind: kind,
    p_stake: stake,
    p_players: players,
  });

export const matchBetStatus = (game: BetGame, matchId: string) =>
  rpc<BetState & { earned: number; balance: number }>("bet_match_status", { p_game: game, p_match: matchId.slice(0, 80) });

/**
 * The stake for an online match, worked out the same way on every player's device:
 * random matches stake 3 when every player can afford it (else no bet); friend rooms use the
 * host's choice (0 = no bet).
 */
export function matchStake(matched: boolean, roomBet: unknown, peerChips: Array<number | null | undefined>) {
  if (matched) return peerChips.length >= 2 && peerChips.every((c) => (c ?? 0) >= BET.randomStake) ? BET.randomStake : 0;
  const n = Number(roomBet);
  return Number.isFinite(n) && n >= BET.roomMin ? Math.floor(n) : 0;
}

/* ---------------- vs CPU ---------------- */
const CPU_PREF = "senevon:bet-cpu";
function readCpuPref() {
  try {
    return localStorage.getItem(CPU_PREF) === "1";
  } catch {
    return false;
  }
}

const OPEN_KEY = (game: string) => `senevon:bet-cpu-open:${game}`;
function remember(game: string, id: string | null) {
  try {
    if (id) localStorage.setItem(OPEN_KEY(game), id);
    else localStorage.removeItem(OPEN_KEY(game));
  } catch {
    /* not remembered */
  }
}

/**
 * Betting 1 chip on a game against the CPU. `enabled` is remembered on this device.
 * Call `open()` when a CPU game starts and `settle(result)` when it ends; `bet` is what happened.
 */
export function useCpuBet(game: Exclude<BetGame, "arrows">) {
  const { user } = useAuthContext();
  const { wallet, refresh } = useTokens();
  const [enabled, setEnabledState] = useState(readCpuPref);
  const [bet, setBet] = useState<BetState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const idRef = useRef<string | null>(null);
  const earned = wallet?.earned ?? 0;
  const canBet = Boolean(user) && earned >= BET.cpuStake;

  const setEnabled = useCallback((on: boolean) => {
    setEnabledState(on);
    try {
      localStorage.setItem(CPU_PREF, on ? "1" : "0");
    } catch {
      /* not remembered */
    }
  }, []);

  const open = useCallback(async () => {
    idRef.current = null;
    setBet(null);
    setError(null);
    if (!enabled || !user) return;
    try {
      const r = await rpc<{ id: string; stake: number }>("bet_cpu_open", { p_game: game });
      idRef.current = r.id;
      remember(game, r.id);
      setBet({ id: r.id, status: "open", stake: r.stake, payout: 0 });
      void refresh();
    } catch (e) {
      setError(betErrorText(e));
    }
  }, [enabled, user, game, refresh]);

  const settle = useCallback(
    async (result: "win" | "lose" | "draw") => {
      const id = idRef.current;
      if (!id) return;
      idRef.current = null;
      remember(game, null);
      try {
        const r = await rpc<BetState>("bet_cpu_settle", { p_bet: id, p_result: result });
        setBet(r);
        void refresh();
      } catch (e) {
        setError(betErrorText(e));
      }
    },
    [refresh, game],
  );

  /** A saved CPU game is being resumed: carry on with the bet it had (if any). */
  const resume = useCallback(() => {
    setError(null);
    try {
      const id = localStorage.getItem(OPEN_KEY(game));
      idRef.current = id;
      setBet(id ? { id, status: "open", stake: BET.cpuStake, payout: 0 } : null);
    } catch {
      idRef.current = null;
    }
  }, [game]);

  /** leaving a CPU game before it ends: the stake is lost */
  const forfeit = useCallback(() => void settle("lose"), [settle]);

  return { enabled, setEnabled, canBet, earned, bet, error, open, resume, settle, forfeit };
}

/* ---------------- gifts ---------------- */
export type GiftLimits = { cap: number; sent_today: number; old_enough: boolean; min_age_days: number; earned: number; balance: number };
export const giftLimits = () => rpc<GiftLimits>("gift_limits");
export const giftChips = (to: string, amount: number, note?: string) =>
  rpc<GiftLimits>("gift_chips", { p_to: to, p_amount: amount, p_note: note ?? null });

/** Loads the gift limits for the signed-in player (null for guests / not set up). */
export function useGiftLimits(open: boolean) {
  const { user } = useAuthContext();
  const [limits, setLimits] = useState<GiftLimits | null>(null);
  useEffect(() => {
    if (!open || !user) return;
    let live = true;
    giftLimits()
      .then((l) => live && setLimits(l))
      .catch(() => live && setLimits(null));
    return () => {
      live = false;
    };
  }, [open, user]);
  return [limits, setLimits] as const;
}
