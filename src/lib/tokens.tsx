/* Tokens: wallet state for the signed-in player (plus a browser-only guest wallet),
   per-game prices and subscription prices.
   Every change goes through Supabase RPC functions (supabase/tokens.sql) that enforce the
   rules on the server; this file only calls them and shares the result across the app. */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "../supabase";
import { useAuthContext } from "../context/AuthContext";
import { isNative } from "./native";

export type Subscription = {
  id: string;
  plan: "monthly" | "yearly";
  status: "active" | "cancelled";
  provider: string;
  currency: string;
  amount: number;
  started_at: string;
  period_end: string;
  next_credit_at: string;
};

export type Wallet = {
  balance: number;
  /** redeemed the developer / admin code: premium games are free */
  unlimited: boolean;
  subscription: Subscription | null;
  ads_today: number;
  ad_daily_cap: number;
  ad_reward: number;
  ad_min_seconds: number;
  sub_tokens: number;
  payments_mode: "mock" | "live";
};

export type LedgerRow = { id: number; delta: number; balance_after: number; reason: string; ref: string | null; created_at: string };

export type SpendResult = { ok: true; cost: number } | { ok: false; reason: "insufficient" | "signin" | "error"; cost: number; message?: string };

/* ---------- guest wallet (browser only) ----------
   Guests get GUEST_TOKENS once per device, kept in localStorage. It can be reset by clearing
   site data, which is accepted: on sign-in the server credits at most GUEST_TOKENS, once per
   account (claim_guest_tokens). After any sign-in on this device the guest wallet is spent. */
export const GUEST_TOKENS = 300;
const GUEST_KEY = "senevon:guest-wallet";
type GuestWallet = { balance: number; claimed: boolean };

function readGuest(): GuestWallet | null {
  try {
    const raw = localStorage.getItem(GUEST_KEY);
    if (!raw) return null;
    const g = JSON.parse(raw) as Partial<GuestWallet>;
    const balance = Math.min(GUEST_TOKENS, Math.max(0, Math.floor(Number(g.balance) || 0)));
    return { balance, claimed: Boolean(g.claimed) };
  } catch {
    return null;
  }
}

function writeGuest(g: GuestWallet) {
  try {
    localStorage.setItem(GUEST_KEY, JSON.stringify(g));
  } catch {
    /* storage blocked: the in-memory balance still works for this visit */
  }
}

/** Ad-free status (supabase/adfree.sql). `reason`: a paid pass, or included with a
 *  subscription / Pro / unlimited account. */
export type AdFree = {
  active: boolean;
  reason: "pass" | "subscriber" | "pro" | "unlimited" | null;
  expires_at: string | null;
  auto_renew: boolean;
  price: number;
};
export const AD_FREE_PRICE = 85;

type Ctx = {
  wallet: Wallet | null;
  /** undefined while loading; null = no ad-free status (guest, or not set up on the server) */
  adFree: AdFree | null | undefined;
  buyAdFree: () => Promise<void>;
  cancelAdFree: () => Promise<void>;
  /** guest's browser balance; null when signed in */
  guestBalance: number | null;
  loading: boolean;
  refresh: () => Promise<void>;
  spendForPlay: (gameId: string) => Promise<SpendResult>;
  startAdView: (source: "network" | "house", adId?: string | null) => Promise<string>;
  claimAd: (viewId: string) => Promise<void>;
  subscribe: (plan: "monthly" | "yearly", currency: string) => Promise<void>;
  buyPack: (pack: string, currency: string) => Promise<void>;
  cancel: () => Promise<void>;
  history: () => Promise<LedgerRow[]>;
  redeem: (code: string) => Promise<void>;
};

const TokensContext = createContext<Ctx | null>(null);

/** Friendly text for the server's error codes. */
export function tokenErrorText(err: unknown) {
  const msg = (err as { message?: string })?.message ?? String(err);
  if (msg.includes("play_managed")) return "This subscription is billed by Google Play — cancel it in the Play Store app (Profile → Payments & subscriptions).";
  if (msg.includes("payment_cancelled")) return "Payment cancelled — you haven't been charged.";
  if (msg.includes("checkout_unavailable")) return "Couldn't open the payment window. Check your connection and try again.";
  if (msg.includes("razorpay_not_configured")) return "Payments aren't set up on the server yet.";
  if (msg.includes("bad_signature") || msg.includes("order_mismatch")) return "We couldn't verify that payment. If you were charged, contact support.";
  if (msg.includes("payment_failed")) return "The payment didn't go through. You haven't been charged.";
  if (msg.includes("no_subscription")) return "No active subscription to cancel.";
  if (msg.includes("razorpay:")) return "The payment service had a problem. Please try again.";
  if (msg.includes("ad_no_fill") || msg.includes("ads_unavailable")) return "No ad is available right now. Please try again later.";
  if (msg.includes("ad_cap_reached")) return "You've reached today's ad limit — come back tomorrow.";
  if (msg.includes("ad_not_finished")) return "Watch the whole ad to earn tokens.";
  if (msg.includes("too_many_open_ads")) return "Finish the ad you already started first.";
  if (msg.includes("bad_code")) return "That code isn't valid.";
  if (msg.includes("bad_pack")) return "That pack isn't available any more.";
  if (msg.includes("too_many_attempts")) return "Too many wrong codes — try again in an hour.";
  if (msg.includes("no_code_set")) return "That code isn't valid.";
  if (msg.includes("already_subscribed")) return "You already have a subscription.";
  if (msg.includes("mock_payments_disabled")) return "Payments aren't available yet.";
  if (msg.includes("not_signed_in")) return "Sign in first.";
  if (msg.includes("insufficient_tokens")) return "Not enough tokens.";
  if (msg.includes("none_left")) return "You don't have any left.";
  if (msg.includes("level_required")) return "Reach the level shown to unlock this.";
  if (msg.includes("not_owned")) return "Buy this item first.";
  if (msg.includes("bad_item") || msg.includes("bad_slot")) return "That item isn't available.";
  if (msg.includes("Could not find the function") && msg.includes("shop_")) return "The shop isn't set up on the server yet (run supabase/shop.sql).";
  if (msg.includes("Could not find the function")) return "Tokens aren't set up on the server yet (run supabase/tokens.sql).";
  return "Something went wrong. Please try again.";
}

export function TokensProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuthContext();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [loading, setLoading] = useState(false);

  const rpc = useCallback(async <T,>(fn: string, args?: Record<string, unknown>): Promise<T> => {
    if (!supabase) throw new Error("not_configured");
    const { data, error } = await supabase.rpc(fn, args);
    if (error) throw new Error(error.message);
    return data as T;
  }, []);

  const [adFree, setAdFree] = useState<AdFree | null | undefined>(undefined);
  const loadAdFree = useCallback(async () => {
    try {
      setAdFree(await rpc<AdFree>("ad_free_state"));
    } catch {
      setAdFree(null); // not set up yet (supabase/adfree.sql): ads as normal
    }
  }, [rpc]);
  // guests always see ads; signed-in players: known once their state loads
  useEffect(() => {
    if (authLoading) setAdFree(undefined);
    else if (!user || !supabase) setAdFree(null);
  }, [user, authLoading]);

  const [guestBalance, setGuestBalance] = useState<number | null>(null);
  useEffect(() => {
    // wait for the session check so a signed-in player never gets a fresh guest wallet
    if (user || authLoading) {
      setGuestBalance(null);
      return;
    }
    let g = readGuest();
    if (!g) {
      g = { balance: GUEST_TOKENS, claimed: false };
      writeGuest(g);
    }
    setGuestBalance(g.balance);
  }, [user, authLoading]);

  const refresh = useCallback(async () => {
    if (!user || !supabase) {
      setWallet(null);
      return;
    }
    setLoading(true);
    try {
      // carry unspent guest tokens over to the account (server caps it and allows it once)
      const g = readGuest();
      if (!g || (!g.claimed && g.balance === 0)) {
        writeGuest({ balance: 0, claimed: true });
      } else if (!g.claimed) {
        try {
          const w = await rpc<Wallet>("claim_guest_tokens", { p_amount: g.balance });
          writeGuest({ balance: 0, claimed: true });
          setWallet(w);
          return;
        } catch {
          /* server not updated yet: keep the guest tokens and try again next time */
        }
      }
      setWallet(await rpc<Wallet>("token_wallet"));
    } catch {
      setWallet(null);
    } finally {
      setLoading(false);
      // after the wallet: renewals are charged from it, and a subscription makes you ad-free
      void loadAdFree();
    }
  }, [user, rpc, loadAdFree]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const spendForPlay = useCallback(
    async (gameId: string): Promise<SpendResult> => {
      if (!user) {
        const prices = await loadGamePrices();
        const cost = prices[gameId] ?? 0;
        const g = readGuest() ?? { balance: guestBalance ?? 0, claimed: false };
        if (cost === 0) return { ok: true, cost: 0 };
        if (g.balance < cost) return { ok: false, reason: "insufficient", cost };
        const balance = g.balance - cost;
        writeGuest({ ...g, balance });
        setGuestBalance(balance);
        return { ok: true, cost };
      }
      try {
        const res = await rpc<Wallet & { ok: boolean; cost: number; reason?: string }>("spend_for_play", { p_game: gameId });
        const { ok, cost, reason: _r, ...w } = res;
        setWallet(w as Wallet);
        return ok ? { ok: true, cost } : { ok: false, reason: "insufficient", cost };
      } catch (err) {
        return { ok: false, reason: "error", cost: 0, message: tokenErrorText(err) };
      }
    },
    [user, rpc, guestBalance],
  );

  const startAdView = useCallback(
    (source: "network" | "house", adId?: string | null) => rpc<string>("start_ad_view", { p_source: source, p_ad: adId ?? null }),
    [rpc],
  );

  const claimAd = useCallback(async (viewId: string) => {
    setWallet(await rpc<Wallet>("claim_ad_reward", { p_view: viewId }));
  }, [rpc]);

  // Website in live payments mode: real checkout through Razorpay (the Android app uses Google
  // Play Billing from the Tokens page itself). Otherwise the test checkout.
  const live = wallet?.payments_mode === "live" && !isNative;

  const subscribe = useCallback(async (plan: "monthly" | "yearly", currency: string) => {
    if (live) {
      const rp = await import("./razorpay");
      await rp.razorpaySubscribe(plan, currency);
      setWallet(await rpc<Wallet>("token_wallet"));
    } else {
      setWallet(await rpc<Wallet>("mock_subscribe", { p_plan: plan, p_currency: currency }));
    }
    void loadAdFree(); // subscribers are ad-free
  }, [rpc, loadAdFree, live]);

  const buyAdFree = useCallback(async () => {
    setAdFree(await rpc<AdFree>("ad_free_buy"));
    setWallet(await rpc<Wallet>("token_wallet"));
  }, [rpc]);

  const cancelAdFree = useCallback(async () => {
    setAdFree(await rpc<AdFree>("ad_free_cancel"));
  }, [rpc]);

  const buyPack = useCallback(async (pack: string, currency: string) => {
    if (live) {
      const rp = await import("./razorpay");
      await rp.razorpayBuyPack(pack, currency, `Token pack · ${pack}`);
      setWallet(await rpc<Wallet>("token_wallet"));
    } else {
      setWallet(await rpc<Wallet>("mock_buy_pack", { p_pack: pack, p_currency: currency }));
    }
  }, [rpc, live]);

  const cancel = useCallback(async () => {
    // bought in the Android app: only Google Play can stop it renewing
    if (wallet?.subscription?.provider === "google_play") throw new Error("play_managed");
    if (wallet?.subscription?.provider === "razorpay") {
      const rp = await import("./razorpay");
      await rp.razorpayCancel();
      setWallet(await rpc<Wallet>("token_wallet"));
    } else {
      setWallet(await rpc<Wallet>("cancel_subscription"));
    }
  }, [rpc, wallet?.subscription?.provider]);

  const redeem = useCallback(async (code: string) => {
    const res = await rpc<Wallet & { ok: boolean; reason?: string }>("redeem_code", { p_code: code });
    if (!res.ok) throw new Error(res.reason ?? "bad_code");
    const { ok: _ok, reason: _r, ...w } = res;
    setWallet(w as Wallet);
  }, [rpc]);

  const history = useCallback(async () => {
    if (!supabase || !user) return [];
    const { data } = await supabase
      .from("token_ledger")
      .select("id, delta, balance_after, reason, ref, created_at")
      .order("created_at", { ascending: false })
      .limit(25);
    return (data ?? []) as LedgerRow[];
  }, [user]);

  const value = useMemo(
    () => ({ wallet, adFree, buyAdFree, cancelAdFree, guestBalance, loading, refresh, spendForPlay, startAdView, claimAd, subscribe, buyPack, cancel, history, redeem }),
    [wallet, adFree, buyAdFree, cancelAdFree, guestBalance, loading, refresh, spendForPlay, startAdView, claimAd, subscribe, buyPack, cancel, history, redeem],
  );
  return <TokensContext.Provider value={value}>{children}</TokensContext.Provider>;
}

export function useTokens() {
  const ctx = useContext(TokensContext);
  if (!ctx) throw new Error("useTokens must be used inside <TokensProvider>");
  return ctx;
}

/** Should ads show? false while we don't know yet (so ad-free players never see one flash up). */
export function useShowAds() {
  const { adFree } = useTokens();
  return adFree !== undefined && !adFree?.active;
}

/* ---------- prices (public, cached for the session) ---------- */

let gamePriceCache: Record<string, number> | null = null;
let gamePriceInflight: Promise<Record<string, number>> | null = null;

export function loadGamePrices(force = false): Promise<Record<string, number>> {
  if (gamePriceCache && !force) return Promise.resolve(gamePriceCache);
  if (!supabase) return Promise.resolve({});
  if (force) gamePriceInflight = null;
  gamePriceInflight ??= Promise.resolve(supabase.from("game_prices").select("game_id, cost")).then(
    ({ data }) => {
      gamePriceCache = Object.fromEntries((data ?? []).map((r) => [r.game_id as string, Number(r.cost) || 0]));
      return gamePriceCache;
    },
    () => ({}),
  );
  return gamePriceInflight;
}

/** Tokens per play for a game (0 = free). `null` while loading. */
export function useGameCost(gameId: string | undefined): number | null {
  const [prices, setPrices] = useState<Record<string, number> | null>(gamePriceCache);
  useEffect(() => {
    let alive = true;
    void loadGamePrices().then((p) => alive && setPrices(p));
    return () => {
      alive = false;
    };
  }, []);
  if (!gameId) return 0;
  return prices ? (prices[gameId] ?? 0) : null;
}

export type PlanPrice = { currency: string; plan: "monthly" | "yearly"; amount: number };

export function usePlanPrices() {
  const [rows, setRows] = useState<PlanPrice[]>([]);
  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    void Promise.resolve(supabase.from("plan_prices").select("currency, plan, amount")).then(({ data }) => {
      if (alive) setRows(((data ?? []) as PlanPrice[]).map((r) => ({ ...r, amount: Number(r.amount) })));
    });
    return () => {
      alive = false;
    };
  }, []);
  return rows;
}

export type TokenPack = { id: string; tokens: number; bonus: number; prices: Record<string, number> };

/** One-off token packs with their prices per currency (public). */
export function useTokenPacks() {
  const [packs, setPacks] = useState<TokenPack[] | null>(null);
  useEffect(() => {
    if (!supabase) {
      setPacks([]);
      return;
    }
    let alive = true;
    void Promise.all([
      supabase.from("token_packs").select("id, tokens, bonus, sort").order("sort"),
      supabase.from("pack_prices").select("pack, currency, amount"),
    ]).then(
      ([p, pr]) => {
        if (!alive) return;
        const prices = (pr.data ?? []) as { pack: string; currency: string; amount: number }[];
        setPacks(
          ((p.data ?? []) as { id: string; tokens: number; bonus: number }[]).map((r) => ({
            id: r.id,
            tokens: Number(r.tokens),
            bonus: Number(r.bonus),
            prices: Object.fromEntries(prices.filter((x) => x.pack === r.id).map((x) => [x.currency, Number(x.amount)])),
          })),
        );
      },
      () => alive && setPacks([]),
    );
    return () => {
      alive = false;
    };
  }, []);
  return packs;
}
