/* Match entries and gifts (supabase/entries.sql). Players play a match for chips: everyone pays the
   same entry, and the winner gets the prize. Only EARNED chips (rewards, wins, gifts) can be used
   for entries or gifts; chips bought with money can't. The server decides every entry and prize.

   vs CPU          "Play for chips": 1-chip entry, win +1, lose −1 (at most +20 a day; a "win"
                   quicker than a real game just returns the entry)
   friend rooms    the host sets the entry (5 or more, up to the poorest player's earned chips);
                   the winner gets every entry as the prize
   random matches  a 3-chip entry each; the winner gets the prize of 6
   gifts           earned chips to anyone, 500 a day, from accounts 3+ days old */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../supabase";
import { useAuthContext } from "../context/AuthContext";
import { useTokens } from "./tokens";

export type EntryGame = "chess" | "ludo" | "carrom" | "arrows" | "pool";
export type EntryKind = "room" | "random";
export type EntryStatus = "open" | "won" | "lost" | "draw" | "refunded" | "none";
export type EntryState = { id?: string; status: EntryStatus; fee: number; prize: number; note?: string | null };

export const ENTRY = {
  cpuFee: 1,
  cpuDailyCap: 20,
  randomFee: 3,
  roomMin: 5,
  giftDailyCap: 500,
  /** quick picks for a room's entry */
  roomPresets: [5, 10, 25, 50, 100, 250],
} as const;

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!supabase) throw new Error("offline");
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export function entryErrorText(err: unknown) {
  const msg = (err as { message?: string })?.message ?? String(err);
  if (msg.includes("insufficient_earned")) return "Not enough earned chips. Bought chips can't be used for match entries or gifts.";
  if (msg.includes("not_signed_in")) return "Sign in to play for chips.";
  if (msg.includes("fee_mismatch")) return "The entry changed. Rejoin the room.";
  if (msg.includes("match_settled")) return "That match is already over.";
  if (msg.includes("bad_fee")) return "That entry isn't allowed.";
  if (msg.includes("account_too_new")) return "Your account needs to be 3 days old to send gifts.";
  if (msg.includes("gift_limit")) return `You can send up to ${ENTRY.giftDailyCap} chips a day.`;
  if (msg.includes("bad_recipient")) return "You can't send chips to that player.";
  if (msg.includes("Could not find the function")) return "Chip matches aren't set up on the server yet (run supabase/entries.sql).";
  return "Something went wrong. Please try again.";
}

/** What a finished match did to your chips: "+3 chips", "−1 chip", "Entry returned"… */
export function entryOutcomeText(e: EntryState) {
  const net = e.prize - e.fee;
  if (e.status === "won") return e.note === "capped" ? "Won · today's CPU chip limit reached, entry returned" : `+${net} chip${net === 1 ? "" : "s"}`;
  if (e.status === "lost") return `−${e.fee} chip${e.fee === 1 ? "" : "s"}`;
  if (e.status === "draw") return "Draw · entry returned";
  if (e.status === "refunded")
    return e.note === "too_fast" ? "Too quick to count · entry returned" : e.note === "disagreed" ? "Results didn't match · entry returned" : "Entry returned";
  if (e.status === "open") return "Adding up the prize…";
  return "";
}

/* ---------------- online matches ---------------- */
export const joinMatchEntry = (game: EntryGame, matchId: string, kind: EntryKind, fee: number, players: string[]) =>
  rpc<{ id: string; earned: number; balance: number }>("entry_match_join", {
    p_game: game,
    p_match: matchId.slice(0, 80),
    p_kind: kind,
    p_fee: fee,
    p_players: players,
  });

export const matchEntryStatus = (game: EntryGame, matchId: string) =>
  rpc<EntryState & { earned: number; balance: number }>("entry_match_status", { p_game: game, p_match: matchId.slice(0, 80) });

/**
 * The entry for an online match, worked out the same way on every player's device:
 * random matches 3 each when every player can cover it (else none); friend rooms use the
 * host's choice (0 = none).
 */
export function matchFee(matched: boolean, roomFee: unknown, peerChips: Array<number | null | undefined>) {
  if (matched) return peerChips.length >= 2 && peerChips.every((c) => (c ?? 0) >= ENTRY.randomFee) ? ENTRY.randomFee : 0;
  const n = Number(roomFee);
  return Number.isFinite(n) && n >= ENTRY.roomMin ? Math.floor(n) : 0;
}

/* ---------------- vs CPU ---------------- */
const CPU_PREF = "senevon:entry-cpu";
function readCpuPref() {
  try {
    return localStorage.getItem(CPU_PREF) === "1";
  } catch {
    return false;
  }
}

const OPEN_KEY = (game: string) => `senevon:entry-cpu-open:${game}`;
function remember(game: string, id: string | null) {
  try {
    if (id) localStorage.setItem(OPEN_KEY(game), id);
    else localStorage.removeItem(OPEN_KEY(game));
  } catch {
    /* not remembered */
  }
}

/**
 * "Play for chips" against the CPU: a 1-chip entry each game. `enabled` is remembered on this
 * device. Call `open()` when a CPU game starts and `finish(result)` when it ends; `entry` is
 * what happened.
 */
export function useCpuEntry(game: Exclude<EntryGame, "arrows">) {
  const { user } = useAuthContext();
  const { wallet, refresh } = useTokens();
  const [enabled, setEnabledState] = useState(readCpuPref);
  const [entry, setEntry] = useState<EntryState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const idRef = useRef<string | null>(null);
  const earned = wallet?.earned ?? 0;
  const canEnter = Boolean(user) && earned >= ENTRY.cpuFee;

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
    setEntry(null);
    setError(null);
    if (!enabled || !user) return;
    try {
      const r = await rpc<{ id: string; fee: number }>("entry_cpu_open", { p_game: game });
      idRef.current = r.id;
      remember(game, r.id);
      setEntry({ id: r.id, status: "open", fee: r.fee, prize: 0 });
      void refresh();
    } catch (e) {
      setError(entryErrorText(e));
    }
  }, [enabled, user, game, refresh]);

  const finish = useCallback(
    async (result: "win" | "lose" | "draw") => {
      const id = idRef.current;
      if (!id) return;
      idRef.current = null;
      remember(game, null);
      try {
        const r = await rpc<EntryState>("entry_cpu_finish", { p_entry: id, p_result: result });
        setEntry(r);
        void refresh();
      } catch (e) {
        setError(entryErrorText(e));
      }
    },
    [refresh, game],
  );

  /** A saved CPU game is being resumed: carry on with the entry it had (if any). */
  const resume = useCallback(() => {
    setError(null);
    try {
      const id = localStorage.getItem(OPEN_KEY(game));
      idRef.current = id;
      setEntry(id ? { id, status: "open", fee: ENTRY.cpuFee, prize: 0 } : null);
    } catch {
      idRef.current = null;
    }
  }, [game]);

  /** leaving a CPU game before it ends: the entry is lost */
  const forfeit = useCallback(() => void finish("lose"), [finish]);

  return { enabled, setEnabled, canEnter, earned, entry, error, open, resume, finish, forfeit };
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
