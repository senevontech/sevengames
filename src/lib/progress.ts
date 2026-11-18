/* Saved game progress: the level a player has reached in a game, so closing the site doesn't
   send them back to level 1.

   - Everyone: saved on this device (localStorage) straight away.
   - Signed-in players: also saved to their account (supabase/progress.sql), so it follows them to
     other devices. Device and account copies are compared by save time and the newest wins, which
     also makes a reset on one device carry over to the others.
   - A guest's progress is carried into their account the first time they sign in on that device,
     unless the account already has newer progress.

   To give another game saved levels: call useGameProgress("<game id>") in it, start from
   `progress.level`, call `progress.save(n)` when a level is reached, and add the id to
   PROGRESS_GAMES so it shows on the Profile page with a reset button. */
import { useCallback, useEffect, useState } from "react";
import { useAuthContext } from "../context/AuthContext";
import { supabase } from "../supabase";

/** Games that save levels (listed on the Profile page). */
export const PROGRESS_GAMES = ["arrows"] as const;

type Saved = { level: number; updatedAt: number };

const GUEST = "guest";
const keyFor = (owner: string, gameId: string) => `senevon:progress:${owner}:${gameId}`;

function readLocal(owner: string, gameId: string): Saved | null {
  try {
    const raw = localStorage.getItem(keyFor(owner, gameId));
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<Saved>;
    const level = Math.floor(Number(p.level));
    if (!Number.isFinite(level) || level < 1) return null;
    return { level, updatedAt: Number(p.updatedAt) || 0 };
  } catch {
    return null; // private mode / blocked storage
  }
}

function writeLocal(owner: string, gameId: string, p: Saved) {
  try {
    localStorage.setItem(keyFor(owner, gameId), JSON.stringify(p));
  } catch {
    /* storage unavailable: progress lasts for this visit only */
  }
}

function pushRemote(userId: string, gameId: string, p: Saved) {
  if (!supabase) return;
  void supabase
    .from("game_progress")
    .upsert(
      { user_id: userId, game_id: gameId, level: p.level, updated_at: new Date(p.updatedAt).toISOString() },
      { onConflict: "user_id,game_id" },
    )
    .then(({ error }) => {
      if (error) console.warn("[progress] save failed", error.message);
    });
}

export type GameProgress = {
  /** Saved level (1 when nothing is saved). */
  level: number;
  /** False until we know who the player is and have read their saved level. */
  ready: boolean;
  /** Save the level the player has reached. */
  save: (level: number) => void;
  /** Back to level 1 (on this device and, when signed in, the account). */
  reset: () => void;
};

export function useGameProgress(gameId: string): GameProgress {
  const { user, loading } = useAuthContext();
  const owner = user?.id ?? GUEST;
  const [saved, setSaved] = useState<Saved | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (loading) return;
    let local = readLocal(owner, gameId);
    if (user && !local) {
      const guest = readLocal(GUEST, gameId);
      if (guest) {
        local = guest;
        writeLocal(owner, gameId, guest);
      }
    }
    setSaved(local);
    setReady(true);
    if (!user || !supabase) return;

    let cancelled = false;
    void supabase
      .from("game_progress")
      .select("level, updated_at")
      .eq("user_id", user.id)
      .eq("game_id", gameId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled || error) return;
        const remote: Saved | null = data ? { level: data.level, updatedAt: Date.parse(data.updated_at) || 0 } : null;
        const current = readLocal(owner, gameId);
        if (remote && (!current || remote.updatedAt >= current.updatedAt)) {
          writeLocal(owner, gameId, remote);
          setSaved(remote);
        } else if (current) {
          // This device has the newer save (played offline, or carried over from guest play)
          pushRemote(user.id, gameId, current);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [owner, gameId, loading, user]);

  const save = useCallback(
    (level: number) => {
      const p: Saved = { level: Math.max(1, Math.floor(level)), updatedAt: Date.now() };
      writeLocal(owner, gameId, p);
      setSaved(p);
      if (user) pushRemote(user.id, gameId, p);
    },
    [owner, gameId, user],
  );

  const reset = useCallback(() => save(1), [save]);

  return { level: saved?.level ?? 1, ready, save, reset };
}
