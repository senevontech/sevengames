/* Notifications: gift / friend request / new follower (rows written by triggers, see
   supabase/notifications.sql). One store for the whole app: the nav bell (badge + window) and the
   live toast read from it. "seen" in the table = read here.

   Every Supabase call here is awaited: a query builder only sends its request once something
   awaits it (or calls .then on it). The old popup did `void supabase.rpc(...)`, so "seen" was never
   saved and the same popups came back every time the site opened. */
import { useSyncExternalStore } from "react";
import { supabase } from "../supabase";
import { namesFor, respondToRequest, type MiniPlayer } from "./social";

export type NotifKind = "gift" | "friend_request" | "follow";
export type Notif = {
  id: number;
  kind: NotifKind;
  from_user: string | null;
  amount: number | null;
  note: string | null;
  ref: number | null; // gift id / friend request id
  seen: boolean;
  created_at: string;
};
/** A friend request's state now: still open, accepted, or gone (declined / withdrawn). */
export type RequestState = "pending" | "accepted" | "gone";

type State = {
  userId: string | null;
  items: Notif[]; // newest first, at most 100 (the table keeps 100 per player)
  names: ReadonlyMap<string, MiniPlayer>;
  requests: ReadonlyMap<number, RequestState>;
  loaded: boolean;
  failed: boolean;
  unread: number;
};

const COLS = "id, kind, from_user, amount, note, ref, seen, created_at";
const EMPTY: State = { userId: null, items: [], names: new Map(), requests: new Map(), loaded: false, failed: false, unread: 0 };

let state = EMPTY;
const subs = new Set<() => void>();
const arrivals = new Set<(n: Notif) => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  if (patch.items) state.unread = state.items.reduce((c, n) => c + (n.seen ? 0 : 1), 0);
  subs.forEach((f) => f());
}
function subscribe(f: () => void) {
  subs.add(f);
  return () => void subs.delete(f);
}

export const useNotifications = () => useSyncExternalStore(subscribe, () => state);
export const useUnreadCount = () => useSyncExternalStore(subscribe, () => state.unread);

/** Called with each notification that arrives live (not the ones loaded on open). */
export function onNotifArrival(f: (n: Notif) => void) {
  arrivals.add(f);
  return () => void arrivals.delete(f);
}

/** Sender names + avatars, and the current state of friend requests. */
async function enrich(rows: Notif[], uid: string) {
  if (!supabase) return;
  const missing = [...new Set(rows.map((r) => r.from_user).filter((id): id is string => !!id && !state.names.has(id)))];
  const reqIds = rows.filter((r) => r.kind === "friend_request" && r.ref).map((r) => r.ref!);
  const [names, reqs] = await Promise.all([
    namesFor(missing),
    reqIds.length ? supabase.from("friend_requests").select("id, status").in("id", reqIds) : Promise.resolve(null),
  ]);
  if (state.userId !== uid) return;
  const patch: Partial<State> = {};
  if (names.size) patch.names = new Map([...state.names, ...names]);
  if (reqs && !reqs.error) {
    const m = new Map(state.requests);
    const found = new Map((reqs.data ?? []).map((r) => [r.id as number, r.status as string]));
    for (const id of reqIds) m.set(id, found.get(id) === "accepted" ? "accepted" : found.has(id) ? "pending" : "gone");
    patch.requests = m;
  }
  if (Object.keys(patch).length) set(patch);
}

/** Re-check friend requests (they may have been answered on a profile page). */
export function refreshRequests() {
  if (state.userId) void enrich(state.items, state.userId);
}

/** Load the player's notifications and listen for new ones. Returns the cleanup. */
export function startNotifications(userId: string | null, onGift: () => void) {
  set({ ...EMPTY, userId });
  if (!userId || !supabase) return () => {};
  const db = supabase;
  let live = true;
  let lastLoad = 0;

  const load = async () => {
    lastLoad = Date.now();
    const { data, error } = await db.from("notifications").select(COLS).eq("user_id", userId).order("id", { ascending: false }).limit(100);
    if (!live) return;
    if (error) return set({ loaded: true, failed: true });
    const rows = (data ?? []) as Notif[];
    set({ items: rows, loaded: true, failed: false });
    await enrich(rows, userId);
  };
  void load();

  const ch = db
    .channel(`notif-${userId}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, (p) => {
      const n = { ...(p.new as Notif), seen: false };
      if (!live || state.items.some((i) => i.id === n.id)) return;
      set({ items: [n, ...state.items].slice(0, 100) });
      if (n.kind === "gift") onGift();
      void enrich([n], userId).then(() => live && arrivals.forEach((f) => f(n)));
    })
    .subscribe();

  // back on the tab after a while: reload (another device may have read some)
  const onVisible = () => {
    if (document.visibilityState === "visible" && Date.now() - lastLoad > 60_000) void load();
  };
  document.addEventListener("visibilitychange", onVisible);

  return () => {
    live = false;
    document.removeEventListener("visibilitychange", onVisible);
    void db.removeChannel(ch);
  };
}

/** Optimistic: flip locally, save, and flip back if the save fails. */
async function setSeen(ids: number[], seen: boolean) {
  const db = supabase;
  const change = new Set(state.items.filter((n) => ids.includes(n.id) && n.seen !== seen).map((n) => n.id));
  if (!change.size || !db) return;
  const flip = (to: boolean) => set({ items: state.items.map((n) => (change.has(n.id) ? { ...n, seen: to } : n)) });
  flip(seen);
  const { error } = await db.rpc(seen ? "notif_seen" : "notif_unread", { p_ids: [...change] });
  if (error) {
    console.warn("[notifications]", error.message);
    flip(!seen);
  }
}

export const markRead = (ids: number[]) => setSeen(ids, true);
export const markUnread = (id: number) => setSeen([id], false);
export const markAllRead = () => setSeen(state.items.filter((n) => !n.seen).map((n) => n.id), true);

/** Accept / decline a friend request from its notification. Throws a readable message. */
export async function answerRequest(n: Notif, accept: boolean) {
  if (!n.ref) return;
  await respondToRequest(n.ref, accept);
  set({ requests: new Map(state.requests).set(n.ref, accept ? "accepted" : "gone") });
  void markRead([n.id]);
}

/** Where tapping a notification goes (the sender's profile), or null. */
export const notifTarget = (n: Notif) => (n.from_user ? `/player/${n.from_user}` : null);

/** One-line text for a notification. */
export function notifText(n: Notif, who: string) {
  if (n.kind === "gift") return `${who} sent you a gift`;
  if (n.kind === "friend_request") return `${who} wants to be your friend`;
  return `${who} started following you`;
}

export const notifIcon = (k: NotifKind) => (k === "gift" ? "🎁" : k === "friend_request" ? "🤝" : "👋");
