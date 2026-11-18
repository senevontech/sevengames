import { useCallback, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../supabase";
import { parseAvatar, type AvatarChoice } from "./avatar";

export type ScoreRow = {
  gameId: string;
  score: number;
  seconds: number;
  createdAt: string;
};

export type LeaderRow = {
  rank: number;
  userId: string;
  displayName: string;
  score: number;
  isYou: boolean;
  avatar: AvatarChoice | null;
};

export function isLowerBetter(gameId: string) {
  return gameId === "minefield" || gameId === "slide";
}

export function personalKey(userId: string) {
  return `7games:scores:${userId}`;
}

export function readLocalScores(userId: string): ScoreRow[] {
  try {
    const raw = window.localStorage.getItem(personalKey(userId));
    return raw ? (JSON.parse(raw) as ScoreRow[]) : [];
  } catch {
    return [];
  }
}

export function writeLocalScores(userId: string, scores: ScoreRow[]) {
  try {
    window.localStorage.setItem(personalKey(userId), JSON.stringify(scores.slice(0, 80)));
  } catch {
    // storage unavailable — ignore
  }
}

function bestOf(rows: ScoreRow[], lowerBetter: boolean) {
  if (!rows.length) return null;
  return rows.reduce((best, row) =>
    lowerBetter ? row.score < best.score ? row : best : row.score > best.score ? row : best,
  );
}

export function usePersonalScores(user: User | null) {
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setScores([]);
      setLoading(false);
      return;
    }

    const local = readLocalScores(user.id);
    setScores(local);
    setLoading(false);

    if (!supabase) return;

    supabase
      .from("game_scores")
      .select("game_id, score, seconds, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(80)
      .then(({ data }) => {
        if (!data) return;
        const rows: ScoreRow[] = data.map((row) => ({
          gameId: row.game_id,
          score: row.score,
          seconds: row.seconds,
          createdAt: row.created_at,
        }));
        const merged = mergeScores(local, rows);
        setScores(merged);
        writeLocalScores(user.id, merged);
      });
  }, [user]);

  const bestFor = useCallback(
    (gameId: string) => {
      const best = bestOf(
        scores.filter((score) => score.gameId === gameId),
        isLowerBetter(gameId),
      );
      return best ? best.score : null;
    },
    [scores],
  );

  return { scores, bestFor, loading };
}

export function useLeaderboard(gameId: string, limit = 10) {
  const [leaders, setLeaders] = useState<LeaderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);

    if (!supabase || !gameId) {
      setLeaders([]);
      setError(supabase ? null : "Leaderboard is offline.");
      setLoading(false);
      return;
    }

    supabase
      .from(isLowerBetter(gameId) ? "leaderboard_fastest" : "leaderboard")
      // "*" rather than a column list: works whether or not the avatar column exists yet
      .select("*")
      .eq("game_id", gameId)
      .order("best_score", { ascending: isLowerBetter(gameId) })
      .order("user_id", { ascending: true }) // stable order for ties
      .limit(limit)
      .then(({ data, error: err }) => {
        if (!active) return;
        if (err) {
          console.error("[leaderboard] load failed:", err.message);
          setError("Couldn't load the leaderboard.");
          setLeaders([]);
          setLoading(false);
          return;
        }
        setError(null);
        setLeaders(
          (data ?? []).map((row, index) => ({
            rank: index + 1,
            userId: row.user_id,
            displayName: row.display_name || "Player",
            score: row.best_score,
            isYou: false,
            avatar: parseAvatar(row.avatar),
          })),
        );
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [gameId, version, limit]);

  return { leaders, loading, error, refresh };
}

export type OverallRow = {
  rank: number;
  userId: string;
  displayName: string;
  points: number;
  firsts: number;
  rounds: number;
  games: number;
  avatar: AvatarChoice | null;
};

/** Players ranked across every game (supabase/leaderboard.sql → leaderboard_overall). */
export function useOverallLeaderboard(limit = 25) {
  const [rows, setRows] = useState<OverallRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    if (!supabase) {
      setRows([]);
      setError("Leaderboard is offline.");
      setLoading(false);
      return;
    }
    void Promise.resolve(
      supabase
        .from("leaderboard_overall")
        .select("*")
        .order("points", { ascending: false })
        .order("firsts", { ascending: false })
        .order("rounds", { ascending: false })
        .limit(limit),
    ).then(({ data, error: err }) => {
      if (!active) return;
      if (err) {
        console.error("[leaderboard] overall failed:", err.message);
        setError(/does not exist|Could not find/i.test(err.message) ? "Overall ranking isn't set up yet (run supabase/leaderboard.sql)." : "Couldn't load the leaderboard.");
        setRows([]);
      } else {
        setError(null);
        setRows(
          (data ?? []).map((r, i) => ({
            rank: i + 1,
            userId: r.user_id as string,
            displayName: (r.display_name as string) || "Player",
            points: Number(r.points) || 0,
            firsts: Number(r.firsts) || 0,
            rounds: Number(r.rounds) || 0,
            games: Number(r.games) || 0,
            avatar: parseAvatar(r.avatar),
          })),
        );
      }
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [limit]);

  return { rows, loading, error };
}

export function useSaveScore(user: User | null) {
  return useCallback(
    async (gameId: string, score: number, seconds: number) => {
      const row: ScoreRow = {
        gameId,
        score,
        seconds,
        createdAt: new Date().toISOString(),
      };

      if (user) {
        const local = readLocalScores(user.id);
        const next = [row, ...local].slice(0, 80);
        writeLocalScores(user.id, next);
      }

      if (!supabase || !user) return false;

      const s = Math.max(0, Math.round(score));
      const secs = Math.max(0, Math.round(seconds));
      // Server function first (works regardless of table policies, adds sanity checks) …
      const rpc = await supabase.rpc("submit_score", { p_game: gameId, p_score: s, p_seconds: secs });
      if (!rpc.error) return rpc.data !== false;
      // … falling back to a direct insert if supabase/leaderboard.sql hasn't been run yet.
      if (!/Could not find the function|does not exist/i.test(rpc.error.message)) {
        console.error("[scores] save failed:", rpc.error.message);
        return false;
      }
      const { error } = await supabase.from("game_scores").insert({
        user_id: user.id,
        game_id: gameId,
        score: s,
        seconds: secs,
      });
      if (error) {
        console.error("[scores] save failed:", error.message);
        return false;
      }
      return true;
    },
    [user],
  );
}

export function mergeScores(local: ScoreRow[], remote: ScoreRow[]) {
  const seen = new Set<string>();
  const merged: ScoreRow[] = [];
  for (const row of [...local, ...remote]) {
    const key = `${row.gameId}|${row.score}|${row.seconds}|${row.createdAt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(row);
  }
  return merged.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 80);
}
