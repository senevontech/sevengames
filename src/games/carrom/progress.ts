/* Carrom progression: XP → level, owned + equipped items (striker, coin set, board), striker upgrades.

   Signed-in players: everything lives on the server (supabase/carrom.sql) and changes only through
   its RPCs, which charge tokens and check levels. Guests play with the free items and keep their XP
   on this device. */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../../supabase";
import { enqueue } from "../../lib/offlineQueue";
import { isNetworkError, isOnline } from "../../lib/online";
import { useTokens } from "../../lib/tokens";
import { BOARDS, COIN_SETS, STRIKERS, itemKey, type BoardTheme, type CoinSet, type ShopKind, type StrikerSkin } from "./skins";
import { effectiveStats, type StatKey, type StrikerStats } from "./stats";

export const MAX_LEVEL = 30;
/** Total XP needed to reach `level` (level 1 = 0 XP): 100, 300, 600, 1000 … */
export const xpForLevel = (level: number) => 50 * level * (level - 1);
export function levelForXp(xp: number) {
  let lv = 1;
  while (lv < MAX_LEVEL && xp >= xpForLevel(lv + 1)) lv++;
  return lv;
}

export const XP = { coin: 10, queen: 25, win: 100, loss: 40, combo: 15 } as const;

/** XP for one finished match, from the local player's point of view. `combos` = extra coins sunk
 *  in multi-pot shots plus pots on consecutive shots. */
export function matchXp(coins: number, queen: boolean, won: boolean, combos = 0) {
  return coins * XP.coin + (queen ? XP.queen : 0) + (won ? XP.win : XP.loss) + combos * XP.combo;
}

type ServerState = {
  xp: number;
  level: number;
  striker: string;
  coins: string;
  board: string;
  pro: boolean;
  free: boolean;
  owned: string[];
  upgrades: Record<string, Partial<StrikerStats>>;
};

type GuestState = { xp: number; striker: string; coins: string; board: string };
const GUEST_DEFAULT: GuestState = { xp: 0, striker: "classic", coins: "classic", board: "classic" };
const LOCAL_KEY = "senevon:carrom";

function readGuest(): GuestState {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw) {
      const g = JSON.parse(raw) as Partial<GuestState>;
      return { ...GUEST_DEFAULT, xp: Math.max(0, Number(g.xp) || 0) };
    }
  } catch {
    /* private mode */
  }
  return { ...GUEST_DEFAULT };
}
function writeGuest(g: GuestState) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(g));
  } catch {
    /* ignore */
  }
}

/** Friendly text for the carrom RPC errors. */
export function carromErrorText(err: unknown) {
  const msg = (err as { message?: string })?.message ?? String(err);
  if (msg.includes("insufficient_tokens")) return "Not enough chips.";
  if (msg.includes("level_required")) return "Reach the required level first.";
  if (msg.includes("max_level")) return "That stat is already maxed.";
  if (msg.includes("not_owned")) return "Buy this item first.";
  if (msg.includes("not_signed_in")) return "Sign in to use the shop.";
  if (msg.includes("Could not find the function")) return "The carrom shop isn't set up yet (run supabase/carrom.sql).";
  return "Something went wrong. Please try again.";
}

export function useCarromProgress(user: User | null) {
  const { refresh: refreshTokens } = useTokens();
  const [guest, setGuest] = useState<GuestState>(readGuest);
  const [server, setServer] = useState<ServerState | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const rpc = useCallback(async (fn: string, args?: Record<string, unknown>) => {
    if (!supabase) throw new Error("not_configured");
    const { data, error } = await supabase.rpc(fn, args);
    if (error) throw new Error(error.message);
    return data as ServerState;
  }, []);

  useEffect(() => {
    if (!user || !supabase) {
      setServer(null);
      return;
    }
    let alive = true;
    rpc("carrom_state").then(
      (s) => {
        if (alive) {
          setServer(s);
          setServerError(null);
        }
      },
      (err) => alive && setServerError(carromErrorText(err)),
    );
    return () => {
      alive = false;
    };
  }, [user, rpc]);

  const signedIn = Boolean(user && server);
  const pro = server?.pro ?? false;
  const xp = server ? server.xp : guest.xp;
  const level = levelForXp(xp);

  const owns = useCallback(
    (kind: ShopKind, id: string) => {
      const list = kind === "striker" ? STRIKERS : kind === "coins" ? COIN_SETS : BOARDS;
      const item = list.find((x) => x.id === id);
      if (!item) return false;
      if (item.shop.price === 0) return true;
      if (!server) return false;
      return server.pro || server.owned.includes(itemKey(kind, id));
    },
    [server],
  );

  const pick = <T extends { id: string }>(list: T[], kind: ShopKind, id: string) =>
    list.find((x) => x.id === id && owns(kind, x.id)) ?? list[0];

  const striker: StrikerSkin = pick(STRIKERS, "striker", server?.striker ?? guest.striker);
  const coinSet: CoinSet = pick(COIN_SETS, "coins", server?.coins ?? guest.coins);
  const board: BoardTheme = pick(BOARDS, "board", server?.board ?? guest.board);

  const statsFor = useCallback(
    (s: StrikerSkin): StrikerStats => effectiveStats(s.base, server?.upgrades?.[s.id]),
    [server],
  );
  const strikerStats = useMemo(() => statsFor(striker), [statsFor, striker]);

  /** The server's XP after an online match report (match_report). */
  const syncXp = useCallback((xp: number) => setServer((s) => (s ? { ...s, xp } : s)), []);

  /** Adds match XP; returns the levels before and after. */
  const addXp = useCallback(
    (amount: number) => {
      const gain = Math.max(0, Math.round(amount));
      const before = level;
      if (server) {
        const after = levelForXp(server.xp + gain);
        setServer({ ...server, xp: server.xp + gain }); // optimistic; the server has the final say
        if (!isOnline() && user) enqueue(user.id, "carrom_award_xp", { p_amount: gain }, "xp:carrom");
        else
          void rpc("carrom_award_xp", { p_amount: gain }).then(setServer, (e) => {
            if (user && isNetworkError(e)) enqueue(user.id, "carrom_award_xp", { p_amount: gain }, "xp:carrom");
          });
        return { before, after };
      }
      const next = { ...guest, xp: guest.xp + gain };
      setGuest(next);
      writeGuest(next);
      return { before, after: levelForXp(next.xp) };
    },
    [level, server, guest, rpc, user],
  );

  const buy = useCallback(
    async (kind: ShopKind, id: string) => {
      setServer(await rpc("carrom_buy", { p_kind: kind, p_item: id }));
      void refreshTokens();
    },
    [rpc, refreshTokens],
  );

  const upgrade = useCallback(
    async (strikerId: string, stat: StatKey) => {
      setServer(await rpc("carrom_upgrade", { p_striker: strikerId, p_stat: stat }));
      void refreshTokens();
    },
    [rpc, refreshTokens],
  );

  const select = useCallback(
    async (kind: ShopKind, id: string) => {
      if (!server) {
        // guests can only use the free items
        if (!owns(kind, id)) return;
        const next = { ...guest, [kind === "striker" ? "striker" : kind]: id } as GuestState;
        setGuest(next);
        writeGuest(next);
        return;
      }
      // optimistic equip, then confirm
      const key = kind === "striker" ? "striker" : kind;
      setServer({ ...server, [key]: id });
      try {
        setServer(await rpc("carrom_select", { p_kind: kind, p_item: id }));
      } catch {
        setServer(server);
      }
    },
    [server, guest, owns, rpc],
  );

  return {
    syncXp,
    xp,
    level,
    pro,
    free: server?.free ?? false,
    signedIn,
    serverError,
    striker,
    coinSet,
    board,
    strikerStats,
    statsFor,
    upgradesFor: (id: string) => server?.upgrades?.[id] ?? {},
    owns,
    addXp,
    buy,
    upgrade,
    select,
  };
}
