/* Monthly leaderboard prizes (supabase/monthly.sql): this month's race, last month's winners, and
   the signed-in player's prizes waiting to be claimed. */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabase";
import { parseAvatar, type AvatarChoice } from "./avatar";

export type MonthRow = {
  rank: number;
  userId: string;
  name: string;
  avatar: AvatarChoice | null;
  points: number;
  firsts: number;
  rounds: number;
  games: number;
};
export type MonthWinner = { rank: number; userId: string; name: string; avatar: AvatarChoice | null; points: number; prize: number };
export type MonthBoard = {
  /** the month's 1st, "2026-11-01" */
  month: string;
  endsAt: string;
  /** whether this month pays prizes (the first prize month is November 2026) */
  pays: boolean;
  /** [1st, 2nd, 3rd, 4th–10th] */
  prizes: number[];
  top: MonthRow[];
  me: { rank: number; points: number } | null;
  last: { month: string; winners: MonthWinner[] };
};
export type MyPrize = { month: string; rank: number; points: number; prize: number };

/** 1st–10th prize in chips (the server decides; this is for labels) */
export const prizeFor = (rank: number, prizes: number[]) => (rank >= 1 && rank <= 3 ? prizes[rank - 1] : rank <= 10 ? prizes[3] : 0) ?? 0;

/** "2026-11-01" → "November 2026" (or "November" with short) */
export function monthName(month: string, short = false) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, (m || 1) - 1, 1));
  return d.toLocaleDateString(undefined, { month: "long", ...(short ? {} : { year: "numeric" }), timeZone: "UTC" });
}

const notSetUp = (msg: string) => /does not exist|Could not find|PGRST202/i.test(msg);

type RawRow = { user_id: string; name: string; avatar: unknown; points: number; firsts: number; rounds: number; games: number; rank: number; prize?: number };

export function useMonthBoard(limit = 50) {
  const [board, setBoard] = useState<MonthBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) {
      setError("Leaderboard is offline.");
      setLoading(false);
      return;
    }
    const { data, error: err } = await supabase.rpc("leaderboard_month", { p_limit: limit });
    if (err) {
      console.error("[leaderboard] month failed:", err.message);
      setError(notSetUp(err.message) ? "Monthly prizes aren't set up yet (run supabase/monthly.sql)." : "Couldn't load this month's leaderboard.");
      setBoard(null);
    } else {
      const d = data as { month: string; ends_at: string; pays: boolean; prizes: number[]; top: RawRow[]; me: MonthBoard["me"]; last: { month: string; winners: RawRow[] } };
      setError(null);
      setBoard({
        month: d.month,
        endsAt: d.ends_at,
        pays: !!d.pays,
        prizes: d.prizes ?? [],
        me: d.me ?? null,
        top: (d.top ?? []).map((r) => ({
          rank: r.rank,
          userId: r.user_id,
          name: r.name || "Player",
          avatar: parseAvatar(r.avatar),
          points: Number(r.points) || 0,
          firsts: Number(r.firsts) || 0,
          rounds: Number(r.rounds) || 0,
          games: Number(r.games) || 0,
        })),
        last: {
          month: d.last?.month,
          winners: (d.last?.winners ?? []).map((w) => ({ rank: w.rank, userId: w.user_id, name: w.name || "Player", avatar: parseAvatar(w.avatar), points: Number(w.points) || 0, prize: Number(w.prize) || 0 })),
        },
      });
    }
    setLoading(false);
  }, [limit]);

  useEffect(() => {
    void load();
  }, [load]);

  return { board, loading, error, reload: load };
}

/** The signed-in player's prizes waiting to be claimed (empty for guests / before the SQL is run). */
export function useMyPrizes(userId: string | undefined) {
  const [prizes, setPrizes] = useState<MyPrize[]>([]);

  const load = useCallback(async () => {
    if (!supabase || !userId) {
      setPrizes([]);
      return;
    }
    const { data, error } = await supabase.rpc("month_prizes_mine");
    setPrizes(error ? [] : ((data as MyPrize[]) ?? []));
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { prizes, reload: load };
}

/** Claim one month's prize; resolves with the chips added. */
export async function claimMonthPrize(month: string) {
  if (!supabase) throw new Error("You're offline.");
  const { data, error } = await supabase.rpc("month_prize_claim", { p_month: month });
  if (error) {
    if (/already_claimed/.test(error.message)) throw new Error("This prize was already claimed.");
    if (/no_prize/.test(error.message)) throw new Error("No prize found for that month.");
    throw new Error("Couldn't claim the prize. Please try again.");
  }
  return Number((data as { amount: number }).amount) || 0;
}
