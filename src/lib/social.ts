/* Social: public player profiles, follows, friend requests, and the live top-7 leaderboard.
   Server side: supabase/social.sql. */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../supabase";
import { useAuthContext } from "../context/AuthContext";
import { parseAvatar, type AvatarChoice } from "./avatar";

export type Relation = "none" | "requested" | "incoming" | "friends";

export type PublicProfile = {
  id: string;
  name: string;
  avatar: AvatarChoice | null;
  since: string;
  followers: number;
  following: number;
  friends: number;
  rounds: number;
  games: number;
  points: number;
  firsts: number;
  rank: number | null;
  best: { game: string; best: number; place: number }[];
  carrom_xp: number | null;
  chess_xp: number | null;
  ludo_xp: number | null;
  chess_rating: number | null;
  frame: string | null;
  /** chip balance (older servers leave it out) */
  chips?: number;
  is_following: boolean;
  relation: Relation;
  request_id: number | null;
};

export function socialErrorText(e: unknown) {
  const msg = (e as { message?: string })?.message ?? String(e);
  if (msg.includes("not_signed_in")) return "Sign in first.";
  if (msg.includes("too_many_requests")) return "You've sent a lot of requests today — try again tomorrow.";
  if (msg.includes("Could not find the function") || msg.includes("does not exist")) return "Profiles aren't set up yet (run supabase/social.sql).";
  return "Something went wrong. Please try again.";
}

/** A player's public profile, plus actions (follow, friend) that keep it up to date. */
export function usePublicProfile(userId: string | null) {
  const { user } = useAuthContext();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!userId || !supabase) return;
    setLoading(true);
    const { data, error: err } = await supabase.rpc("public_profile", { p_user: userId });
    setLoading(false);
    if (err) {
      setError(socialErrorText(err));
      return;
    }
    if (!data) {
      setError("This player doesn't exist.");
      setProfile(null);
      return;
    }
    const d = data as PublicProfile & { avatar: unknown };
    setError(null);
    setProfile({ ...d, avatar: parseAvatar(d.avatar), best: Array.isArray(d.best) ? d.best : [] });
  }, [userId]);

  useEffect(() => {
    setProfile(null);
    setError(null);
    void load();
    // the viewer changes what "relation" says
  }, [load, user?.id]);

  const run = useCallback(
    async (fn: () => PromiseLike<{ error: unknown }>) => {
      setBusy(true);
      const { error: err } = await fn();
      setBusy(false);
      if (err) setError(socialErrorText(err));
      refreshInbox(); // the nav badge / Friends section
      await load();
    },
    [load],
  );

  const follow = useCallback(
    (on: boolean) =>
      run(() =>
        on
          ? supabase!.from("follows").insert({ follower: user!.id, followee: userId })
          : supabase!.from("follows").delete().eq("follower", user!.id).eq("followee", userId!),
      ),
    [run, user, userId],
  );
  const addFriend = useCallback(() => run(() => supabase!.rpc("friend_request", { p_to: userId })), [run, userId]);
  const removeFriend = useCallback(() => run(() => supabase!.rpc("friend_remove", { p_other: userId })), [run, userId]);
  const respond = useCallback(
    (accept: boolean) => run(() => supabase!.rpc("friend_respond", { p_id: profile?.request_id, p_accept: accept })),
    [run, profile?.request_id],
  );

  return { profile, loading, error, busy, follow, addFriend, removeFriend, respond, reload: load, signedIn: Boolean(user), isMe: user?.id === userId };
}

/* ---------------- my friends / requests ---------------- */

export type MiniPlayer = { id: string; name: string; avatar: AvatarChoice | null };
export type FriendRequest = { id: number; from: MiniPlayer; at: string };

export async function namesFor(ids: string[]): Promise<Map<string, MiniPlayer>> {
  const out = new Map<string, MiniPlayer>();
  if (!ids.length || !supabase) return out;
  // "*": works whether or not the avatar column exists
  const { data } = await supabase.from("profiles").select("*").in("id", ids);
  for (const id of ids) out.set(id, { id, name: "Player", avatar: null });
  for (const r of (data ?? []) as { id: string; display_name: string | null; avatar?: unknown }[])
    out.set(r.id, { id: r.id, name: r.display_name || "Player", avatar: parseAvatar(r.avatar) });
  return out;
}

const inboxListeners = new Set<() => void>();
/** Tell every inbox hook to reload (after accepting / declining somewhere). */
export const refreshInbox = () => inboxListeners.forEach((l) => l());

/** Incoming friend requests for the signed-in player (polled, and refreshed on demand). */
export function useFriendInbox() {
  const { user } = useAuthContext();
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const load = useCallback(async () => {
    if (!user || !supabase) {
      setRequests([]);
      return;
    }
    const { data, error } = await supabase
      .from("friend_requests")
      .select("id, from_user, created_at")
      .eq("to_user", user.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error || !data) return;
    const names = await namesFor(data.map((r) => r.from_user as string));
    setRequests(data.map((r) => ({ id: r.id as number, from: names.get(r.from_user as string)!, at: r.created_at as string })));
  }, [user]);
  useEffect(() => {
    void load();
    if (!user) return;
    inboxListeners.add(load);
    const id = window.setInterval(() => void load(), 60_000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      inboxListeners.delete(load);
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [load, user]);
  return { requests, reload: load };
}

/** My friends, who I follow, and my follower count. */
export function useMyCircle() {
  const { user } = useAuthContext();
  const [friends, setFriends] = useState<MiniPlayer[]>([]);
  const [following, setFollowing] = useState<MiniPlayer[]>([]);
  const [followers, setFollowers] = useState(0);
  const [outgoing, setOutgoing] = useState<MiniPlayer[]>([]);
  const load = useCallback(async () => {
    if (!user || !supabase) return;
    const [fr, fo, fc] = await Promise.all([
      supabase.from("friend_requests").select("from_user, to_user, status").or(`from_user.eq.${user.id},to_user.eq.${user.id}`),
      supabase.from("follows").select("followee").eq("follower", user.id),
      supabase.from("follows").select("follower", { count: "exact", head: true }).eq("followee", user.id),
    ]);
    const rows = (fr.data ?? []) as { from_user: string; to_user: string; status: string }[];
    const friendIds = rows.filter((r) => r.status === "accepted").map((r) => (r.from_user === user.id ? r.to_user : r.from_user));
    const outIds = rows.filter((r) => r.status === "pending" && r.from_user === user.id).map((r) => r.to_user);
    const followIds = ((fo.data ?? []) as { followee: string }[]).map((r) => r.followee);
    const names = await namesFor([...new Set([...friendIds, ...outIds, ...followIds])]);
    setFriends(friendIds.map((id) => names.get(id)!));
    setOutgoing(outIds.map((id) => names.get(id)!));
    setFollowing(followIds.map((id) => names.get(id)!));
    setFollowers(fc.count ?? 0);
  }, [user]);
  useEffect(() => {
    void load();
  }, [load]);
  return { friends, following, followers, outgoing, reload: load };
}

export async function respondToRequest(id: number, accept: boolean) {
  if (!supabase) return;
  const { error } = await supabase.rpc("friend_respond", { p_id: id, p_accept: accept });
  if (error) throw new Error(socialErrorText(error));
  refreshInbox();
}

export async function unfriend(other: string) {
  if (!supabase) return;
  const { error } = await supabase.rpc("friend_remove", { p_other: other });
  if (error) throw new Error(socialErrorText(error));
}

export async function unfollow(me: string, other: string) {
  if (!supabase) return;
  const { error } = await supabase.from("follows").delete().eq("follower", me).eq("followee", other);
  if (error) throw new Error(socialErrorText(error));
}

/* ---------------- live top 7 ---------------- */

export type TopRow = { userId: string; name: string; avatar: AvatarChoice | null; points: number; firsts: number };

/** The overall top `n`, refreshed live when anyone finishes a round (supabase/social.sql). */
export function useLiveTop(n = 7) {
  const [rows, setRows] = useState<TopRow[] | null>(null);
  const [pulse, setPulse] = useState<string | null>(null); // the player whose round just came in
  const timer = useRef(0);

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("leaderboard_overall")
      .select("*")
      .order("points", { ascending: false })
      .order("firsts", { ascending: false })
      .limit(n);
    if (error || !data) return;
    setRows(
      (data as { user_id: string; display_name: string; points: number; firsts: number; avatar?: unknown }[]).map((r) => ({
        userId: r.user_id,
        name: r.display_name || "Player",
        avatar: parseAvatar(r.avatar),
        points: r.points,
        firsts: r.firsts,
      })),
    );
  }, [n]);

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    void load();
    // live: a finished round anywhere → reload (debounced); a slow poll as a fallback
    const ch = client
      .channel("live-top")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "score_activity" }, (p) => {
        const uid = (p.new as { user_id?: string }).user_id ?? null;
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
          void load();
          setPulse(uid);
          window.setTimeout(() => setPulse((cur) => (cur === uid ? null : cur)), 2400);
        }, 600);
      })
      .subscribe();
    const poll = window.setInterval(() => void load(), 45_000);
    return () => {
      window.clearInterval(poll);
      window.clearTimeout(timer.current);
      void client.removeChannel(ch);
    };
  }, [load]);

  return { rows, pulse };
}
