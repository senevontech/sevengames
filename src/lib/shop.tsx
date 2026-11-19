/* Shop state for the signed-in player: owned cosmetics, booster inventory, what's equipped, and
   the price list. Everything changes on the server only (supabase/shop.sql); this mirrors it.
   Guests see the price list but can't buy, and play with the free defaults.

   Also: useFrameOf(userId), the avatar frame any player has equipped (batched public lookup),
   so avatars on leaderboards show other players' frames. */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { useAuthContext } from "../context/AuthContext";
import { supabase } from "../supabase";
import { tokenErrorText, useTokens } from "./tokens";
import { enqueue } from "./offlineQueue";
import { isNetworkError, isOnline } from "./online";
import { DEFAULT_FX, DEFAULT_SKIN, levelForXp, type BoardGame, type BoosterItem, type ShopSlot } from "./shopCatalog";

export type ShopState = {
  owned: string[];
  inventory: Record<BoosterItem, number>;
  equipped: Partial<Record<ShopSlot, string | null>>;
  /** XP per board game (chess, ludo). */
  xp?: Partial<Record<BoardGame, number>>;
  free: boolean;
  tokens: number;
};

export type PriceRow = {
  item_id: string;
  kind: string;
  price: number;
  grants: string | null;
  qty: number;
  active: boolean;
  sort: number;
  /** Cosmetics unlocked by a level in this game (null = no level needed). */
  game?: BoardGame | null;
  min_level?: number;
};

type Ctx = {
  /** null: guest, loading, or the shop isn't set up on the server. */
  state: ShopState | null;
  prices: PriceRow[];
  /** false = shop.sql hasn't been run yet. */
  available: boolean;
  signedIn: boolean;
  priceOf: (id: string) => number | null;
  owns: (id: string) => boolean;
  buy: (id: string) => Promise<void>;
  equip: (slot: ShopSlot, id: string | null) => Promise<void>;
  /** Use one booster. Resolves false if there's none left (or the server refused). */
  use: (item: BoosterItem) => Promise<boolean>;
  arrowSkin: string;
  arrowFx: string;
  /** The item equipped in a slot (null = none / the default). */
  equippedIn: (slot: ShopSlot) => string | null;
  /** Level in a board game (1 for guests). */
  levelOf: (game: BoardGame) => number;
  xpOf: (game: BoardGame) => number;
  /** Level needed to buy this item (1 = none). */
  levelNeeded: (id: string) => { game: BoardGame | null; level: number };
  /** Report XP for a finished game (server caps it). Guests: nothing. */
  awardXp: (game: BoardGame, amount: number) => Promise<void>;
};

const ShopContext = createContext<Ctx | null>(null);

/* ---------- other players' frames (batched, cached) ---------- */
const frameCache = new Map<string, string | null>();
const framePending = new Set<string>();
const frameListeners = new Set<() => void>();
let frameTimer = 0;

const notifyFrames = () => frameListeners.forEach((l) => l());

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function queueFrame(id: string) {
  if (!supabase || frameCache.has(id) || framePending.has(id)) return;
  // only account ids (a bad id would make the whole batched query fail)
  if (!UUID.test(id)) {
    frameCache.set(id, null);
    return;
  }
  framePending.add(id);
  if (frameTimer) return;
  frameTimer = window.setTimeout(() => {
    frameTimer = 0;
    const ids = [...framePending];
    framePending.clear();
    void supabase!
      .from("player_cosmetics")
      .select("user_id, frame")
      .in("user_id", ids)
      .then(({ data }) => {
        ids.forEach((i) => frameCache.set(i, null));
        (data ?? []).forEach((r) => frameCache.set(r.user_id as string, (r.frame as string | null) ?? null));
        notifyFrames();
      });
  }, 0);
}

function setCachedFrame(userId: string, frame: string | null) {
  frameCache.set(userId, frame);
  notifyFrames();
}

const subscribeFrames = (l: () => void) => {
  frameListeners.add(l);
  return () => frameListeners.delete(l);
};

/** The avatar frame a player has equipped (null = none, or not known yet). */
export function useFrameOf(userId: string | null | undefined): string | null {
  useEffect(() => {
    if (userId) queueFrame(userId);
  }, [userId]);
  return useSyncExternalStore(subscribeFrames, () => (userId ? frameCache.get(userId) ?? null : null));
}

/* ---------- price list (public) ---------- */
let priceCache: PriceRow[] | null = null;
let priceInflight: Promise<PriceRow[] | null> | null = null;

export function loadShopPrices(force = false): Promise<PriceRow[] | null> {
  if (!supabase) return Promise.resolve(null);
  if (force) {
    priceCache = null;
    priceInflight = null;
  }
  if (priceCache) return Promise.resolve(priceCache);
  priceInflight ??= Promise.resolve(
    supabase.from("shop_items").select("item_id, kind, price, grants, qty, active, sort, game, min_level").order("sort"),
  ).then(({ data, error }) => {
    if (error) {
      priceInflight = null;
      return null;
    }
    priceCache = (data ?? []) as PriceRow[];
    return priceCache;
  });
  return priceInflight;
}

export function ShopProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuthContext();
  const tokens = useTokens();
  const [state, setState] = useState<ShopState | null>(null);
  const [prices, setPrices] = useState<PriceRow[]>([]);
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    void loadShopPrices().then((p) => {
      if (p) setPrices(p);
      else setAvailable(false);
    });
  }, []);

  const rpc = useCallback(async (fn: string, args?: Record<string, unknown>) => {
    if (!supabase) throw new Error("not_configured");
    const { data, error } = await supabase.rpc(fn, args);
    if (error) throw new Error(error.message);
    return data as ShopState;
  }, []);

  const apply = useCallback(
    (s: ShopState) => {
      setState(s);
      if (user) setCachedFrame(user.id, s.equipped.frame ?? null);
    },
    [user],
  );

  useEffect(() => {
    if (authLoading) return;
    if (!user || !supabase) {
      setState(null);
      return;
    }
    let cancelled = false;
    rpc("shop_state").then(
      (s) => !cancelled && apply(s),
      () => !cancelled && setState(null),
    );
    return () => {
      cancelled = true;
    };
  }, [user, authLoading, rpc, apply]);

  const priceOf = useCallback((id: string) => prices.find((p) => p.item_id === id)?.price ?? null, [prices]);

  const owns = useCallback(
    (id: string) => {
      const row = prices.find((p) => p.item_id === id);
      if (row && row.price === 0 && row.kind !== "booster") return true;
      return !!state?.owned.includes(id);
    },
    [prices, state],
  );

  const buy = useCallback(
    async (id: string) => {
      try {
        apply(await rpc("shop_buy", { p_item: id }));
      } catch (e) {
        throw new Error(tokenErrorText(e));
      } finally {
        void tokens.refresh();
      }
    },
    [rpc, apply, tokens],
  );

  const equip = useCallback(
    async (slot: ShopSlot, id: string | null) => {
      try {
        apply(await rpc("shop_equip", { p_slot: slot, p_item: id }));
      } catch (e) {
        throw new Error(tokenErrorText(e));
      }
    },
    [rpc, apply],
  );

  const use = useCallback(
    async (item: BoosterItem) => {
      if (!state || state.inventory[item] <= 0) return false;
      // offline: use it now, tell the server when back online
      if (!isOnline() && user) {
        enqueue(user.id, "shop_use", { p_item: item });
        setState((s) => (s ? { ...s, inventory: { ...s.inventory, [item]: Math.max(0, s.inventory[item] - 1) } } : s));
        return true;
      }
      try {
        apply(await rpc("shop_use", { p_item: item }));
        return true;
      } catch {
        return false;
      }
    },
    [rpc, apply, state, user],
  );

  const xpOf = useCallback((game: BoardGame) => state?.xp?.[game] ?? 0, [state]);
  const levelOf = useCallback((game: BoardGame) => levelForXp(xpOf(game)), [xpOf]);
  const levelNeeded = useCallback(
    (id: string) => {
      const row = prices.find((p) => p.item_id === id);
      return { game: row?.game ?? null, level: row?.min_level ?? 1 };
    },
    [prices],
  );
  const equippedIn = useCallback((slot: ShopSlot) => state?.equipped[slot] ?? null, [state]);
  const awardXp = useCallback(
    async (game: BoardGame, amount: number) => {
      if (!user || amount <= 0) return;
      const args = { p_game: game, p_amount: Math.round(amount) };
      const queue = () => {
        enqueue(user.id, "award_game_xp", args, `xp:${game}`);
        // show it straight away; the server confirms when it's sent
        setState((s) => (s ? { ...s, xp: { ...s.xp, [game]: (s.xp?.[game] ?? 0) + args.p_amount } } : s));
      };
      if (!isOnline()) return queue();
      try {
        apply(await rpc("award_game_xp", args));
      } catch (e) {
        if (isNetworkError(e)) queue(); /* else not set up yet / rate-limited: no XP this time */
      }
    },
    [user, rpc, apply],
  );

  const value = useMemo<Ctx>(
    () => ({
      state,
      prices,
      available,
      signedIn: !!user,
      priceOf,
      owns,
      buy,
      equip,
      use,
      arrowSkin: state?.equipped.arrow_skin ?? DEFAULT_SKIN,
      arrowFx: state?.equipped.arrow_fx ?? DEFAULT_FX,
      equippedIn,
      levelOf,
      xpOf,
      levelNeeded,
      awardXp,
    }),
    [state, prices, available, user, priceOf, owns, buy, equip, use, equippedIn, levelOf, xpOf, levelNeeded, awardXp],
  );

  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}

export function useShop(): Ctx {
  const ctx = useContext(ShopContext);
  if (!ctx) throw new Error("useShop must be used inside ShopProvider");
  return ctx;
}
