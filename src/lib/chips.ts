/* Free chips for the card games (supabase/cards.sql). A separate play currency on purpose:
   never sold, never turned into tokens or items. Everything changes on the server. */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabase";
import { useAuthContext } from "../context/AuthContext";

export type ChipsState = {
  balance: number;
  daily_ready: boolean;
  daily_amount: number;
  refill_ready: boolean;
  refill_at: string | null;
  refill_amount: number;
  min_bet: number;
  max_bet: number;
};

/** Friendly text for the server's error codes. */
export function chipsErrorText(err: unknown) {
  const msg = (err as { message?: string })?.message ?? String(err);
  if (msg.includes("insufficient_chips")) return "Not enough table chips for that.";
  if (msg.includes("already_claimed")) return "You've already had today's free table chips.";
  if (msg.includes("refill_wait")) return "Free refill is once an hour.";
  if (msg.includes("not_broke")) return "Refills are for when you've run out of table chips.";
  if (msg.includes("round_open")) return "Finish the current hand first.";
  if (msg.includes("bad_bet")) return "That amount is outside the table limits.";
  if (msg.includes("not_signed_in")) return "Sign in to play with table chips.";
  if (msg.includes("table_full")) return "That table is full (5 players).";
  if (msg.includes("no_table")) return "No table with that code.";
  if (msg.includes("betting_closed")) return "The round has started: chips can't be placed now.";
  if (msg.includes("not_your_turn")) return "It's not your turn.";
  if (msg.includes("not_seated")) return "You're not sitting at this table.";
  if (msg.includes("cant_double") || msg.includes("cant_split")) return "You can't do that with this hand.";
  if (msg.includes("does not exist") || msg.includes("Could not find")) return "Card games aren't set up on the server yet.";
  return "Something went wrong. Try again.";
}

export async function chipsRpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error("not_configured");
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export function useChips() {
  const { user, loading } = useAuthContext();
  const [chips, setChips] = useState<ChipsState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) return setChips(null);
    try {
      setChips(await chipsRpc<ChipsState>("chips_state"));
      setError(null);
    } catch (e) {
      setError(chipsErrorText(e));
    }
  }, [user]);

  useEffect(() => {
    if (!loading) void refresh();
  }, [loading, refresh]);

  const claim = useCallback(async (kind: "daily" | "refill") => {
    try {
      setChips(await chipsRpc<ChipsState>(kind === "daily" ? "chips_daily" : "chips_refill"));
      setError(null);
    } catch (e) {
      setError(chipsErrorText(e));
    }
  }, []);

  return { chips, setChips, error, setError, refresh, claim, signedIn: !!user, loading };
}
