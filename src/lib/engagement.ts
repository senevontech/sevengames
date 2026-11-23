/* Engagement features (supabase/engagement.sql): daily login reward, daily challenges,
   achievements, referrals, weekly competition, friend challenges, tournaments, Plus-only games
   and the business enquiry form. Thin wrappers around the server functions. */
import { useEffect, useState } from "react";
import { supabase } from "../supabase";
import type { AvatarChoice } from "./avatar";

export const userTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata";

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error("not_configured");
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

/** Friendly text for the engagement server errors. */
export function engagementErrorText(err: unknown) {
  const m = (err as { message?: string })?.message ?? String(err);
  if (m.includes("already_claimed")) return "Already claimed today. Come back tomorrow!";
  if (m.includes("not_done")) return "Finish the challenge first.";
  if (m.includes("bad_code")) return "That invite code isn't valid.";
  if (m.includes("own_code")) return "That's your own invite code.";
  if (m.includes("too_late")) return "Invite codes can only be used in your first 7 days.";
  if (m.includes("already_referred")) return "You've already used an invite code.";
  if (m.includes("not_friends")) return "You can only challenge friends.";
  if (m.includes("no_score")) return "Play this game first, so there's a score to beat.";
  if (m.includes("already_open")) return "You already have an open challenge with them on this game.";
  if (m.includes("too_many")) return "Too many at once. Try again later.";
  if (m.includes("tournaments_off")) return "Tournaments aren't running right now.";
  if (m.includes("tournament_closed")) return "This tournament has ended.";
  if (m.includes("already_joined")) return "You're already in.";
  if (m.includes("insufficient_tokens")) return "Not enough tokens.";
  if (m.includes("not_signed_in")) return "Sign in first.";
  if (m.includes("bad_email")) return "Enter a valid email address.";
  if (m.includes("bad_name")) return "Enter your name.";
  if (m.includes("bad_message")) return "Tell us a little more (at least 10 characters).";
  if (m.includes("Could not find the function")) return "This isn't set up on the server yet (run supabase/engagement.sql).";
  return "Something went wrong. Please try again.";
}

/* ---------- daily login ---------- */
export type DailyState = { claimed: boolean; run: number; day: number; rewards: number[]; plus: boolean; reward: number; best: number };
export const dailyState = () => rpc<DailyState>("daily_state", { p_tz: userTz() });
export const dailyClaim = () => rpc<{ amount: number; day: number; run: number }>("daily_claim", { p_tz: userTz() });

/* ---------- daily challenges ---------- */
export type Challenge = { id: string; title: string; game_id: string | null; target: number; reward: number; progress: number; claimed: boolean };
export type ChallengeDay = { day: string; bonus: number; bonus_claimed: boolean; ends_at: string; list: Challenge[] | null };
export const challengesToday = () => rpc<ChallengeDay>("challenges_today", { p_tz: userTz() });
export const challengeClaim = (id: string) => rpc<{ amount: number }>("challenge_claim", { p_id: id, p_tz: userTz() });

/* ---------- referrals ---------- */
export type ReferralState = { code: string; reward: number; cap: number; joined: number; paid: number; referred_by: boolean };
export const referralState = () => rpc<ReferralState>("referral_state");
export const referralClaim = (code: string) => rpc<{ paid: boolean; amount: number }>("referral_claim", { p_code: code });

const REF_KEY = "senevon:ref";
/** Remember an invite code from the link (?ref=CODE) until the visitor signs up. */
export function captureReferral(search: string) {
  const code = new URLSearchParams(search).get("ref");
  if (!code || !/^[A-Za-z0-9]{4,12}$/.test(code)) return;
  try {
    localStorage.setItem(REF_KEY, code.toUpperCase());
  } catch {
    /* storage blocked */
  }
}
/** After sign-in: use a remembered invite code once (only works for new accounts). */
export async function applyStoredReferral(): Promise<number> {
  let code: string | null = null;
  try {
    code = localStorage.getItem(REF_KEY);
  } catch {
    return 0;
  }
  if (!code) return 0;
  try {
    const r = await referralClaim(code);
    return r.amount;
  } catch {
    return 0;
  } finally {
    try {
      localStorage.removeItem(REF_KEY);
    } catch {
      /* ignore */
    }
  }
}

/* ---------- weekly competition ---------- */
export type WeeklyRow = { user_id: string; name: string | null; avatar: AvatarChoice | null; score: number; rank: number };
export type Weekly = {
  week_start: string;
  ends_at: string;
  game_id: string;
  lower_better: boolean;
  prizes: number[];
  top: WeeklyRow[];
  me: { score: number; rank: number } | null;
  last: { game_id: string | null; winners: { name: string | null; rank: number; prize: number; score: number }[] };
};
export const weeklyCurrent = () => rpc<Weekly>("weekly_current");

/* ---------- friend challenges ---------- */
export type FriendChallenge = {
  id: number;
  game_id: string;
  target: number;
  status: "open" | "beaten" | "held";
  best: number | null;
  mine: boolean;
  won: boolean;
  expires_at: string;
  created_at: string;
  other: { id: string; name: string | null; avatar: AvatarChoice | null };
};
export const friendChallenges = () => rpc<FriendChallenge[]>("friend_challenges_list");
export const friendChallengeSend = (to: string, gameId: string) => rpc<{ target: number }>("friend_challenge_send", { p_to: to, p_game: gameId });

/* ---------- tournaments ---------- */
export type Tournament = {
  id: string;
  title: string;
  game_id: string;
  entry_fee: number;
  starts_at: string;
  ends_at: string;
  settled: boolean;
  prize_pct: number[];
  entrants: number;
  pool: number;
  joined: boolean;
  top: { name: string | null; score: number; rank: number }[];
  me: { score: number; rank: number } | null;
};
export const tournamentsList = () => rpc<{ enabled: boolean; list: Tournament[] }>("tournaments_list");
export const tournamentJoin = (id: string) => rpc<{ ok: boolean }>("tournament_join", { p_id: id });

/* ---------- achievements ---------- */
export type Achievement = {
  id: string;
  title: string;
  description: string;
  icon: string;
  reward: number;
  target: number;
  progress: number;
  unlocked_at: string | null;
};
export const achievementsSync = () =>
  rpc<{ new: { id: string; title: string; icon: string; reward: number }[]; list: Achievement[] }>("achievements_sync");

/** Another player's unlocked badges (public). */
export async function publicAchievements(userId: string) {
  if (!supabase) return [];
  const { data } = await supabase
    .from("user_achievements")
    .select("unlocked_at, achievements(id, title, description, icon, sort)")
    .eq("user_id", userId);
  type Row = { unlocked_at: string; achievements: { id: string; title: string; description: string; icon: string; sort: number } | null };
  return ((data ?? []) as unknown as Row[])
    .filter((r) => r.achievements)
    .map((r) => ({ ...r.achievements!, unlocked_at: r.unlocked_at }))
    .sort((a, b) => a.sort - b.sort);
}

/* ---------- Plus-only / early-access games ---------- */
export type GameAccess = "plus" | "early";
let accessCache: Record<string, GameAccess> | null = null;
let accessInflight: Promise<Record<string, GameAccess>> | null = null;
function loadAccess() {
  if (accessCache) return Promise.resolve(accessCache);
  if (!supabase) return Promise.resolve({});
  accessInflight ??= Promise.resolve(supabase.from("game_access").select("game_id, mode")).then(
    ({ data }) => {
      accessCache = Object.fromEntries(((data ?? []) as { game_id: string; mode: GameAccess }[]).map((r) => [r.game_id, r.mode]));
      return accessCache;
    },
    () => ({}),
  );
  return accessInflight;
}
/** "plus" / "early" when only Senevon Plus members can play this game; null = everyone. undefined while loading. */
export function useGameAccess(gameId: string | undefined): GameAccess | null | undefined {
  const [map, setMap] = useState<Record<string, GameAccess> | null>(accessCache);
  useEffect(() => {
    let alive = true;
    void loadAccess().then((m) => alive && setMap(m));
    return () => {
      alive = false;
    };
  }, []);
  if (!gameId) return null;
  return map ? map[gameId] ?? null : undefined;
}

/* ---------- business enquiries ---------- */
export const submitEnquiry = (f: { name: string; email: string; message: string; org?: string; phone?: string; service?: string; budget?: string }) =>
  rpc<{ ok: boolean }>("submit_enquiry", {
    p_name: f.name,
    p_email: f.email,
    p_message: f.message,
    p_org: f.org || null,
    p_phone: f.phone || null,
    p_service: f.service || null,
    p_budget: f.budget || null,
  });
