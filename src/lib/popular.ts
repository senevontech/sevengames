/* Most played games (supabase/popular.sql), for the home page carousel. The last answer is kept
   on this device, so the carousel opens in the right order straight away next time. */
import { useEffect, useState } from "react";
import { supabase } from "../supabase";
import type { Game } from "../catalog";

const KEY = "senevon:popular";
const MAX_AGE = 6 * 3_600_000; // refetch after 6 hours

type Cached = { at: number; ids: string[] };

function readCache(): Cached | null {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) || "null") as Cached | null;
    return c && Array.isArray(c.ids) ? c : null;
  } catch {
    return null;
  }
}

/** Game ids, most played first (null until known: no cache and no answer yet). */
export function usePopularIds() {
  const [ids, setIds] = useState<string[] | null>(() => readCache()?.ids ?? null);
  useEffect(() => {
    const cached = readCache();
    if (cached && Date.now() - cached.at < MAX_AGE) return;
    if (!supabase) return setIds((cur) => cur ?? []);
    let gone = false;
    void Promise.resolve(supabase.rpc("popular_games", { p_days: 30 })).then(({ data, error }) => {
      if (gone) return;
      if (error || !Array.isArray(data)) return setIds((cur) => cur ?? []); // popular.sql not run yet: catalog order
      const next = (data as { game_id: string }[]).map((r) => r.game_id);
      try {
        localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), ids: next } satisfies Cached));
      } catch {
        /* not cached */
      }
      setIds(next);
    });
    return () => {
      gone = true;
    };
  }, []);
  return ids;
}

/** The catalog sorted by plays (games nobody has played yet keep their catalog order, after). */
export function byPopularity(list: Game[], ids: string[]) {
  const rank = new Map(ids.map((id, i) => [id, i]));
  return list
    .map((g, i) => ({ g, r: rank.get(g.id) ?? ids.length + i }))
    .sort((a, b) => a.r - b.r)
    .map((x) => x.g);
}
