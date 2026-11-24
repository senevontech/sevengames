import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabase";
import { useAuthContext } from "../context/AuthContext";

/* Favourite games, newest first. Kept on this device (works for guests). Signed in, they're
   also saved to the account (supabase/favorites.sql): the first time on a device the two lists
   are merged, after that the account's list is the one that counts. */
const KEY = "7games:favorites";
const SYNCED = (uid: string) => `7games:favorites-synced:${uid}`;
const EVENT = "7games:favorites-change";
const MAX = 200;

function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((id): id is string => typeof id === "string").slice(0, MAX) : [];
  } catch {
    return [];
  }
}

function write(list: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* storage unavailable (private mode) */
  }
  window.dispatchEvent(new Event(EVENT));
}

let account: string | null = null;
let syncing: string | null = null;
const synced = new Set<string>(); // accounts already synced since the app opened

async function syncAccount(uid: string) {
  if (!supabase || syncing === uid || synced.has(uid)) return;
  syncing = uid;
  try {
    const { data, error } = await supabase.from("favorite_games").select("game_id").order("created_at", { ascending: false });
    if (error) return; // not set up yet: stay device-only
    synced.add(uid);
    const server = (data ?? []).map((r) => r.game_id as string);
    let firstTime = true;
    try {
      firstTime = localStorage.getItem(SYNCED(uid)) !== "1";
    } catch {
      /* treat as first time */
    }
    if (firstTime) {
      const local = read();
      const missing = local.filter((id) => !server.includes(id));
      if (missing.length) await supabase.from("favorite_games").upsert(missing.map((game_id) => ({ user_id: uid, game_id })), { ignoreDuplicates: true });
      write([...local, ...server.filter((id) => !local.includes(id))]);
      try {
        localStorage.setItem(SYNCED(uid), "1");
      } catch {
        /* merged again next time; harmless */
      }
    } else {
      write(server);
    }
  } finally {
    syncing = null;
  }
}

export function isFavorite(id: string) {
  return read().includes(id);
}

export function toggleFavorite(id: string) {
  const list = read();
  const on = !list.includes(id);
  write(on ? [id, ...list] : list.filter((x) => x !== id));
  if (account && supabase) {
    const q = on
      ? supabase.from("favorite_games").upsert({ user_id: account, game_id: id }, { ignoreDuplicates: true })
      : supabase.from("favorite_games").delete().eq("user_id", account).eq("game_id", id);
    void q.then(() => {}, () => {});
  }
  return on;
}

/** The favourite game ids (newest first) and a toggle. Re-renders on changes anywhere. */
export function useFavorites() {
  const { user } = useAuthContext();
  const [list, setList] = useState<string[]>(read);

  useEffect(() => {
    const sync = () => setList(read());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const uid = user?.id ?? null;
  useEffect(() => {
    account = uid;
    if (uid) void syncAccount(uid);
  }, [uid]);

  const toggle = useCallback((id: string) => toggleFavorite(id), []);
  return { list, has: (id: string) => list.includes(id), toggle };
}
