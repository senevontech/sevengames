/* Header search across the site: games, players, clubs and pages (GamesNav → SiteSearch).
   Games and pages are matched on the device. Players and clubs are looked up on the server,
   only from 2 typed letters, a short pause after typing, and never by email:
     players: profiles.display_name (public, like the leaderboards); blocked players are hidden
     clubs:   club_search (supabase/clans.sql): public clubs by name, any club by its exact #ID */
import { useEffect, useMemo, useState } from "react";
import { games, type Game } from "../catalog";
import { supabase } from "../supabase";
import { parseAvatar, type AvatarChoice } from "./avatar";
import { clubSearch } from "./clubs";
import { GET_APP_PATH } from "./appLinks";

export type SearchFilter = "all" | "games" | "players" | "clubs" | "pages";
export const SEARCH_FILTERS: { id: SearchFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "games", label: "Games" },
  { id: "players", label: "Players" },
  { id: "clubs", label: "Clubs" },
  { id: "pages", label: "Pages" },
];

export type SearchItem =
  | { kind: "game"; key: string; title: string; sub: string; game: Game }
  | { kind: "player"; key: string; title: string; sub: string; id: string; avatar: AvatarChoice | null; to: string }
  | { kind: "club"; key: string; title: string; sub: string; to: string }
  | { kind: "page"; key: string; title: string; sub: string; to: string };

export const KIND_LABEL: Record<SearchItem["kind"], string> = { game: "Games", player: "Players", club: "Clubs", page: "Pages" };

/* how many of each kind: in "All" a few of each, in a single filter more */
const LIMIT_ALL = { game: 4, player: 4, club: 3, page: 3 };
const LIMIT_ONE = { game: 8, player: 10, club: 10, page: 10 };

const PAGES: { title: string; to: string; words: string }[] = [
  { title: "Home", to: "/", words: "home start games" },
  { title: "Leaderboards", to: "/leaderboards", words: "leaderboards ranks top players scores" },
  { title: "Rewards", to: "/rewards", words: "rewards daily challenges invite referral" },
  { title: "Chips", to: "/chips", words: "chips buy packs wallet balance plus ad-free history" },
  { title: "Clubs", to: "/clubs", words: "clubs clans teams community" },
  { title: "Profile", to: "/profile", words: "profile account avatar friends settings performance chip usage" },
  { title: "Meet Senevi", to: "/senevi", words: "senevi bot cpu opponent" },
  { title: "Get the app", to: GET_APP_PATH, words: "app android download apk play store" },
];

const norm = (s: string) => s.trim().toLowerCase();

/** Title matches first (prefix before substring), then category matches. */
function matchGames(q: string, n: number): Game[] {
  const starts = games.filter((g) => g.title.toLowerCase().startsWith(q));
  const rest = games.filter((g) => !starts.includes(g) && (g.title.toLowerCase().includes(q) || g.category.toLowerCase().includes(q)));
  return [...starts, ...rest].slice(0, n);
}

function matchPages(q: string, n: number) {
  return PAGES.filter((p) => p.title.toLowerCase().includes(q) || p.words.includes(q)).slice(0, n);
}

/* players I blocked: fetched once per visit */
let blockedFor: string | null = null;
let blocked: Promise<Set<string>> | null = null;
async function myBlocks(me: string | null) {
  if (!me || !supabase) return new Set<string>();
  if (blockedFor !== me || !blocked) {
    blockedFor = me;
    const sb = supabase;
    blocked = (async () => {
      const { data } = await sb.from("chat_blocks").select("blocked").eq("user_id", me);
      return new Set((data ?? []).map((r: { blocked: string }) => r.blocked));
    })().catch(() => new Set<string>());
  }
  return blocked;
}

async function findPlayers(q: string, n: number, me: string | null) {
  if (!supabase) return [];
  // % and _ are wildcards in ilike: drop them so they match literally-ish
  const safe = q.replace(/[%_\\]/g, "");
  if (safe.length < 2) return [];
  const [{ data, error }, blocks] = await Promise.all([
    supabase.from("profiles").select("id, display_name, avatar").ilike("display_name", `%${safe}%`).not("display_name", "is", null).limit(n + 6),
    myBlocks(me),
  ]);
  if (error) return [];
  const rows = (data ?? []) as { id: string; display_name: string; avatar: unknown }[];
  return rows
    .filter((r) => r.id !== me && !blocks.has(r.id))
    .sort((a, b) => Number(!a.display_name.toLowerCase().startsWith(safe)) - Number(!b.display_name.toLowerCase().startsWith(safe)))
    .slice(0, n);
}

async function findClubs(q: string, n: number) {
  if (q.replace("#", "").length < 2) return [];
  try {
    return (await clubSearch(q)).slice(0, n);
  } catch {
    return []; // clubs SQL not run yet
  }
}

/** Results for the header search. `loading` is true while players/clubs are being looked up. */
export function useSiteSearch(query: string, filter: SearchFilter, me: string | null) {
  const q = norm(query);
  const lim = filter === "all" ? LIMIT_ALL : LIMIT_ONE;
  const want = (k: SearchItem["kind"]) => filter === "all" || filter === `${k}s`;

  // on the device: instant
  const local = useMemo(() => {
    if (!q) return [] as SearchItem[];
    const out: SearchItem[] = [];
    if (want("game")) for (const g of matchGames(q, lim.game)) out.push({ kind: "game", key: `g:${g.id}`, title: g.title, sub: g.category, game: g });
    if (want("page")) for (const p of matchPages(q, lim.page)) out.push({ kind: "page", key: `p:${p.to}`, title: p.title, sub: "Page", to: p.to });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, filter]);

  // on the server: after a short pause, newest answer wins
  const [remote, setRemote] = useState<{ q: string; filter: SearchFilter; items: SearchItem[] } | null>(null);
  const needsServer = q.replace("#", "").length >= 2 && (want("player") || want("club"));
  useEffect(() => {
    if (!needsServer) return;
    let live = true;
    const t = window.setTimeout(async () => {
      const [players, clubs] = await Promise.all([
        want("player") ? findPlayers(q, lim.player, me) : Promise.resolve([]),
        want("club") ? findClubs(q, lim.club) : Promise.resolve([]),
      ]);
      if (!live) return;
      const items: SearchItem[] = [
        ...players.map((p): SearchItem => ({ kind: "player", key: `u:${p.id}`, title: p.display_name, sub: "Player", id: p.id, avatar: parseAvatar(p.avatar), to: `/player/${p.id}` })),
        ...clubs.map((c): SearchItem => ({ kind: "club", key: `c:${c.tag}`, title: c.name, sub: `#${c.tag} · ${c.members} member${c.members === 1 ? "" : "s"}`, to: `/clubs/${c.tag}` })),
      ];
      setRemote({ q, filter, items });
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, filter, me, needsServer]);

  const fresh = needsServer && remote?.q === q && remote.filter === filter;
  const items = useMemo(() => {
    const all = [...local, ...(fresh ? remote!.items : [])];
    // group order: games, players, clubs, pages
    const order: SearchItem["kind"][] = ["game", "player", "club", "page"];
    return order.flatMap((k) => all.filter((i) => i.kind === k));
  }, [local, fresh, remote]);

  return { items, loading: needsServer && !fresh, tooShort: (want("player") || want("club")) && q.length > 0 && q.replace("#", "").length < 2 };
}
