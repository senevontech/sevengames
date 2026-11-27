/* Clubs (community clans), supabase/clans.sql.
   A club has a unique club ID (#K7Q2MX); names can repeat. 3 to 50 members, one club per player.
   Public clubs: anyone joins with the club ID. Private clubs: the owner's invite code is needed.
   The owner runs the club and decides how the club wallet is spent. Members put EARNED chips in
   (shares the 500-a-day gift limit). Members post open rooms so other members can join them.
   Tournaments come later. */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabase";
import { useAuthContext } from "../context/AuthContext";
import { parseAvatar, type AvatarChoice } from "./avatar";

export const CLUB = { maxMembers: 50, minMembers: 3, roomMinutes: 30, nameMax: 30, aboutMax: 160 } as const;
export type ClubGame = "chess" | "ludo" | "carrom" | "pool" | "arrows";
export const CLUB_GAMES: Record<ClubGame, string> = { chess: "Chess", ludo: "Ludo", carrom: "Carrom", pool: "Eight Ball", arrows: "Arrows" };

export type ClubCard = {
  id: string;
  tag: string;
  name: string;
  about: string;
  visibility: "public" | "private";
  members: number;
  owner_id: string;
  owner_name: string;
  created_at: string;
};
export type ClubMember = { user_id: string; role: "owner" | "member"; name: string; avatar: AvatarChoice | null; given?: number; joined_at?: string };
export type ClubRoom = { user_id: string; name: string; game: ClubGame; code: string; created_at: string };
export type ClubLog = { id: number; kind: "deposit" | "payout"; amount: number; note: string | null; at: string; from: string | null; to: string | null };
export type MyClub = ClubCard & {
  role: "owner" | "member";
  wallet: number;
  wallet_open: boolean;
  invite_code: string | null;
  given_today: number;
  give_cap: number;
  old_enough: boolean;
  member_list: ClubMember[];
  rooms: ClubRoom[];
  log: ClubLog[];
  bans: { user_id: string; name: string }[] | null;
};
export type ClubView = ClubCard & { mine: boolean; banned: boolean; full: boolean; member_list: ClubMember[] | null };

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!supabase) throw new Error("offline");
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

function fixMembers<T extends { member_list: ClubMember[] | null }>(c: T | null): T | null {
  if (!c || !c.member_list) return c;
  return { ...c, member_list: c.member_list.map((m) => ({ ...m, avatar: parseAvatar(m.avatar as unknown as string) })) };
}

export function clubErrorText(err: unknown) {
  const msg = (err as { message?: string })?.message ?? String(err);
  const map: Record<string, string> = {
    not_signed_in: "Sign in to use clubs.",
    in_club: "You're already in a club. Leave it first.",
    no_club: "No club has that ID.",
    need_invite: "This club is private. You need an invite code from its owner.",
    banned: "You can't join this club.",
    club_full: `This club is full (${CLUB.maxMembers} members).`,
    bad_name: "Club names need at least 3 characters.",
    owner_must_transfer: "Hand the club to another member before you leave.",
    not_owner: "Only the club owner can do that.",
    not_in_club: "You're not in a club.",
    club_forming: `The club wallet opens when the club has ${CLUB.minMembers} members.`,
    club_wallet_low: "The club wallet doesn't have that many chips.",
    insufficient_earned: "Not enough earned chips. Bought chips can't go in a club wallet.",
    gift_limit: "That's over today's limit (gifts and club chips together: 500 a day).",
    account_too_new: "Your account needs to be 3 days old to put chips in a club.",
    bad_member: "That player isn't in your club.",
    bad_amount: "Enter a number of chips.",
    bad_code: "Room codes are 4 characters.",
  };
  for (const k of Object.keys(map)) if (msg.includes(k)) return map[k];
  if (msg.includes("Could not find the function")) return "Clubs aren't set up on the server yet (run supabase/clans.sql).";
  return "Something went wrong. Please try again.";
}

export const clubTagText = (tag: string) => `#${tag}`;
/** link that opens a club; private clubs carry the invite code */
export const clubLink = (tag: string, invite?: string | null) =>
  `${window.location.origin}/clubs/${tag}${invite ? `?invite=${invite}` : ""}`;

export const clubView = async (tag: string) => fixMembers(await rpc<ClubView | null>("club_view", { p_tag: tag }));
export const clubSearch = (q: string) => rpc<ClubCard[]>("club_search", { p_query: q });

/** Club showcase sort: most members · newest · clubs with room (most room first). */
export type ClubSort = "popular" | "newest" | "open";
/** A club card with its club points (the members' overall leaderboard points). */
export type RankedClub = ClubCard & { points: number };

/** Public clubs by name, or any club by its exact #ID (supabase/clans.sql club_browse). Falls back
    to the older club_search when that SQL hasn't been run yet. */
export async function clubBrowse(q: string, sort: ClubSort): Promise<RankedClub[]> {
  try {
    return await rpc<RankedClub[]>("club_browse", { p_query: q, p_sort: sort });
  } catch (e) {
    if ((e as { code?: string }).code !== "PGRST202") throw e; // PGRST202: no such function
    return (await clubSearch(q)).map((c) => ({ ...c, points: 0 }));
  }
}

/** The top clubs by club points (refreshed at most every 10 minutes on the server). */
export const clubTop = (limit = 10) => rpc<RankedClub[]>("club_top", { p_limit: limit });
export const clubOf = (user: string) => rpc<{ tag: string; name: string; role: string } | null>("club_of", { p_user: user });

const mine = async (fn: string, args: Record<string, unknown> = {}) => fixMembers(await rpc<MyClub | null>(fn, args));
export const clubApi = {
  mine: () => mine("club_mine"),
  create: (name: string, about: string, visibility: "public" | "private") => mine("club_create", { p_name: name, p_about: about, p_visibility: visibility }),
  join: (tag: string, invite?: string | null) => mine("club_join", { p_tag: tag, p_invite: invite ?? null }),
  leave: () => mine("club_leave"),
  remove: (user: string, ban: boolean) => mine("club_remove", { p_user: user, p_ban: ban }),
  unban: (user: string) => mine("club_unban", { p_user: user }),
  transfer: (user: string) => mine("club_transfer", { p_user: user }),
  update: (name: string, about: string, visibility: "public" | "private") => mine("club_update", { p_name: name, p_about: about, p_visibility: visibility }),
  newInvite: () => mine("club_new_invite"),
  close: () => mine("club_delete"),
  give: (amount: number) => mine("club_give", { p_amount: amount }),
  pay: (user: string, amount: number, note?: string) => mine("club_pay", { p_user: user, p_amount: amount, p_note: note ?? null }),
  postRoom: (game: ClubGame, code: string) => mine("club_room_post", { p_game: game, p_code: code }),
  clearRoom: () => mine("club_room_clear"),
};

/* The signed-in player's club, shared by every component that asks (one request). */
let cache: { user: string; club: MyClub | null } | null = null;
const listeners = new Set<() => void>();
let loading: Promise<void> | null = null;

export function setMyClub(user: string, club: MyClub | null) {
  cache = { user, club };
  listeners.forEach((l) => l());
}

export function useMyClub() {
  const { user } = useAuthContext();
  const uid = user?.id ?? null;
  const [, bump] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!uid) return;
    try {
      setMyClub(uid, await clubApi.mine());
      setError(null);
    } catch (e) {
      setError(clubErrorText(e));
    }
  }, [uid]);

  useEffect(() => {
    const l = () => bump((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);

  useEffect(() => {
    if (!uid || (cache && cache.user === uid) || loading) return;
    loading = reload().finally(() => (loading = null));
  }, [uid, reload]);

  const club = uid && cache?.user === uid ? cache.club : null;
  const loaded = !uid || cache?.user === uid;
  return { club, loaded, error, reload, uid };
}
