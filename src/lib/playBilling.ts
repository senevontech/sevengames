/* Google Play Billing in the Android app: token packs, the token subscription and ad-free.
   Nothing is credited on the device: every purchase is sent to the `play-billing` Edge Function,
   which checks it with Google and credits the account (supabase/play.sql). Packs are consumed
   (so they can be bought again) only after the server has credited them.
   Product ids: keep in sync with supabase/functions/play-billing and Play Console. */
import { NativePurchases, PURCHASE_TYPE } from "@capgo/native-purchases";
import { supabase } from "../supabase";
import { isNative } from "./native";

export const PACK_PRODUCTS: Record<string, string> = {
  starter: "tokens_starter",
  player: "tokens_player",
  pro: "tokens_pro",
  legend: "tokens_legend",
};
export const PLUS_PRODUCT = "senevon_plus"; // base plans "monthly", "yearly"
export const ADFREE_PRODUCT = "adfree_monthly"; // base plan "monthly"
const PACK_IDS = new Set(Object.values(PACK_PRODUCTS));

export type PlayPrices = {
  packs: Record<string, string>; // pack id → "₹59.00"
  plus: Partial<Record<"monthly" | "yearly", string>>;
  adfree: string | null;
};

let supported: Promise<boolean> | null = null;
/** Google Play Billing is available (the Android app, with the Play Store on the phone). */
export function playBillingAvailable(): Promise<boolean> {
  if (!isNative) return Promise.resolve(false);
  supported ??= NativePurchases.isBillingSupported()
    .then((r) => r.isBillingSupported)
    .catch(() => false);
  return supported;
}

/** Local prices from Google Play (in the player's currency). Missing = not set up in Play Console yet. */
export async function loadPlayPrices(): Promise<PlayPrices> {
  const out: PlayPrices = { packs: {}, plus: {}, adfree: null };
  if (!(await playBillingAvailable())) return out;
  try {
    const { products } = await NativePurchases.getProducts({ productIdentifiers: [...PACK_IDS], productType: PURCHASE_TYPE.INAPP });
    for (const p of products) {
      const pack = Object.keys(PACK_PRODUCTS).find((k) => PACK_PRODUCTS[k] === p.identifier);
      if (pack) out.packs[pack] = p.priceString;
    }
  } catch {
    /* none set up yet */
  }
  try {
    const { products } = await NativePurchases.getProducts({ productIdentifiers: [PLUS_PRODUCT, ADFREE_PRODUCT], productType: PURCHASE_TYPE.SUBS });
    // subscriptions: one entry per base plan; `identifier` = base plan id, `planIdentifier` = product id
    for (const p of products) {
      if (p.planIdentifier === PLUS_PRODUCT && (p.identifier === "monthly" || p.identifier === "yearly")) out.plus[p.identifier] ??= p.priceString;
      if (p.planIdentifier === ADFREE_PRODUCT) out.adfree ??= p.priceString;
    }
  } catch {
    /* none set up yet */
  }
  return out;
}

type VerifyResult = { ok?: boolean; credited?: boolean; consume?: boolean; reason?: string; error?: string; state?: string };

async function verify(productId: string, purchaseToken: string): Promise<VerifyResult> {
  if (!supabase) throw new Error("not_configured");
  const { data, error } = await supabase.functions.invoke("play-billing", { body: { productId, purchaseToken } });
  if (error) {
    // the function's JSON error body, if any
    const ctx = (error as { context?: Response }).context;
    const body = ctx && typeof ctx.json === "function" ? await ctx.json().catch(() => null) : null;
    throw new Error(body?.error ?? error.message);
  }
  return data as VerifyResult;
}

export function playErrorText(e: unknown) {
  const msg = (e as { message?: string })?.message ?? String(e);
  if (/cancel/i.test(msg)) return "Purchase cancelled.";
  if (msg.includes("already_subscribed")) return "You already have a subscription.";
  if (msg.includes("pending")) return "Your payment is pending. Tokens arrive as soon as Google confirms it.";
  if (msg.includes("wrong_account")) return "That purchase belongs to another account.";
  if (msg.includes("not_signed_in")) return "Sign in first.";
  return "The purchase couldn't be confirmed yet. It'll be retried next time you open the app.";
}

/** Buy a token pack. Resolves once the tokens are on the account. */
export async function buyPack(pack: string, userId: string) {
  const productId = PACK_PRODUCTS[pack];
  if (!productId) throw new Error("bad_pack");
  const t = await NativePurchases.purchaseProduct({
    productIdentifier: productId,
    productType: PURCHASE_TYPE.INAPP,
    appAccountToken: userId,
    autoAcknowledgePurchases: false, // the server acknowledges once it has credited
    isConsumable: false, // consumed below, after the server has credited it
  });
  if (!t.purchaseToken) throw new Error("no_token");
  const r = await verify(productId, t.purchaseToken);
  if (!r.ok) throw new Error(r.reason ?? "verify_failed");
  await NativePurchases.consumePurchase({ purchaseToken: t.purchaseToken }).catch(() => {});
  return r;
}

/** Start a subscription (the token plan, or ad-free). */
export async function buySubscription(product: typeof PLUS_PRODUCT | typeof ADFREE_PRODUCT, plan: "monthly" | "yearly", userId: string) {
  const t = await NativePurchases.purchaseProduct({
    productIdentifier: product,
    planIdentifier: plan,
    productType: PURCHASE_TYPE.SUBS,
    appAccountToken: userId,
    autoAcknowledgePurchases: false,
  });
  if (!t.purchaseToken) throw new Error("no_token");
  const r = await verify(product, t.purchaseToken);
  if (!r.ok) throw new Error(r.reason ?? "verify_failed");
  return r;
}

/** On start-up: hand anything Google still holds (unconfirmed packs, renewed subscriptions) to the server. */
export async function syncPlayPurchases(userId: string) {
  if (!(await playBillingAvailable())) return;
  try {
    const { purchases } = await NativePurchases.getPurchases();
    for (const p of purchases) {
      if (!p.purchaseToken) continue;
      if (p.appAccountToken && p.appAccountToken !== userId) continue; // another account on this phone
      try {
        const r = await verify(p.productIdentifier, p.purchaseToken);
        if (r.ok && PACK_IDS.has(p.productIdentifier)) await NativePurchases.consumePurchase({ purchaseToken: p.purchaseToken }).catch(() => {});
      } catch {
        /* try again next start */
      }
    }
  } catch {
    /* billing unavailable */
  }
}

/** Google Play's own page for changing or cancelling subscriptions. */
export const manageSubscriptions = () => NativePurchases.manageSubscriptions();
