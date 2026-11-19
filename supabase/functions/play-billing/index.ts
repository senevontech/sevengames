// Google Play Billing verification (Supabase Edge Function, Deno).
//
// The Android app sends { productId, purchaseToken } after a purchase (and again on start-up for
// anything still open). This function asks Google's Play Developer API whether the purchase is
// real and belongs to the signed-in player (the app sets the player's id as the purchase's
// obfuscated account id), then credits it through supabase/play.sql and acknowledges it.
//
// Google's Real-time Developer Notifications (Pub/Sub push) can also be pointed here:
//   https://<project>.supabase.co/functions/v1/play-billing?rtdn=<PLAY_RTDN_KEY>
// so renewals and cancellations update even when the app isn't opened.
//
// Secrets (`supabase secrets set …`):
//   GOOGLE_PLAY_SERVICE_ACCOUNT   the service account's JSON key (Play Console → API access)
//   PLAY_PACKAGE_NAME             optional, default com.senevon.games
//   PLAY_RTDN_KEY                 optional, a random string to protect the RTDN endpoint
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.
// Deploy with:  supabase functions deploy play-billing

import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PACKAGE = Deno.env.get("PLAY_PACKAGE_NAME") ?? "com.senevon.games";
const RTDN_KEY = Deno.env.get("PLAY_RTDN_KEY") ?? "";
const API = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}`;

// Keep in sync with src/lib/playBilling.ts and the products in Play Console.
const PACKS: Record<string, string> = {
  tokens_starter: "starter",
  tokens_player: "player",
  tokens_pro: "pro",
  tokens_legend: "legend",
};
const PLUS = "senevon_plus"; // base plans: monthly, yearly
const ADFREE = "adfree_monthly"; // base plan: monthly

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

/* ---------- Google OAuth (service account → access token) ---------- */
const enc = new TextEncoder();
const b64url = (data: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof data === "string" ? enc.encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

let cached: { token: string; until: number } | null = null;
async function googleToken(): Promise<string> {
  if (cached && cached.until > Date.now() + 60_000) return cached.token;
  const raw = Deno.env.get("GOOGLE_PLAY_SERVICE_ACCOUNT");
  if (!raw) throw new Error("GOOGLE_PLAY_SERVICE_ACCOUNT is not set");
  const sa = JSON.parse(raw) as { client_email: string; private_key: string };
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/androidpublisher",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(`${header}.${claims}`));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${b64url(sig)}`,
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`google_auth_failed: ${JSON.stringify(body)}`);
  cached = { token: body.access_token, until: Date.now() + body.expires_in * 1000 };
  return cached.token;
}

async function play(path: string, method = "GET") {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await googleToken()}`, "Content-Type": "application/json" },
    body: method === "POST" ? "{}" : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`play_api_${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

/* ---------- verification ---------- */

async function verifyPack(userId: string, productId: string, token: string) {
  const p = await play(`/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}`);
  if (p.purchaseState !== 0) return { ok: false, reason: p.purchaseState === 2 ? "pending" : "not_purchased" };
  if (p.obfuscatedExternalAccountId !== userId) return { ok: false, reason: "wrong_account" };
  const { data, error } = await db.rpc("play_grant_pack", {
    p_user: userId,
    p_token: token,
    p_product: productId,
    p_pack: PACKS[productId],
    p_order: p.orderId ?? null,
  });
  if (error) throw error;
  if (p.acknowledgementState === 0) {
    await play(`/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}:acknowledge`, "POST");
  }
  return { ok: true, credited: data === true, consume: true };
}

const SUB_STATE: Record<string, "active" | "cancelled" | "expired"> = {
  SUBSCRIPTION_STATE_ACTIVE: "active",
  SUBSCRIPTION_STATE_IN_GRACE_PERIOD: "active",
  SUBSCRIPTION_STATE_CANCELED: "cancelled",
};

async function verifySub(userId: string | null, token: string) {
  const s = await play(`/purchases/subscriptionsv2/tokens/${encodeURIComponent(token)}`);
  const item = (s.lineItems ?? [])[0];
  if (!item) return { ok: false, reason: "no_items" };
  const owner = s.externalAccountIdentifiers?.obfuscatedExternalAccountId as string | undefined;
  if (!owner || (userId && owner !== userId)) return { ok: false, reason: "wrong_account" };
  const productId = item.productId as string;
  const state = SUB_STATE[s.subscriptionState as string] ?? "expired";
  const expiry = item.expiryTime as string;
  if (productId === PLUS) {
    const plan = item.offerDetails?.basePlanId === "yearly" ? "yearly" : "monthly";
    const { error } = await db.rpc("play_set_plus", {
      p_user: owner,
      p_token: token,
      p_product: productId,
      p_plan: plan,
      p_expiry: expiry,
      p_state: state,
      p_order: s.latestOrderId ?? null,
    });
    if (error) throw error;
  } else if (productId === ADFREE) {
    const { error } = await db.rpc("play_set_adfree", {
      p_user: owner,
      p_token: token,
      p_product: productId,
      p_expiry: expiry,
      p_state: state,
      p_order: s.latestOrderId ?? null,
    });
    if (error) throw error;
  } else return { ok: false, reason: "unknown_product" };
  if (s.acknowledgementState === "ACKNOWLEDGEMENT_STATE_PENDING" && state !== "expired") {
    await play(`/purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}:acknowledge`, "POST");
  }
  return { ok: true, state, expiry };
}

/* ---------- handler ---------- */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const url = new URL(req.url);

  try {
    // Google Real-time Developer Notifications (Pub/Sub push)
    if (url.searchParams.has("rtdn")) {
      if (!RTDN_KEY || url.searchParams.get("rtdn") !== RTDN_KEY) return json({ error: "forbidden" }, 403);
      const body = await req.json();
      const data = body?.message?.data ? JSON.parse(atob(body.message.data)) : null;
      const token = data?.subscriptionNotification?.purchaseToken as string | undefined;
      if (token) await verifySub(null, token);
      return json({ ok: true }); // always 200, or Pub/Sub keeps retrying
    }

    // the app: a signed-in player
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: auth } = await db.auth.getUser(jwt);
    const user = auth?.user;
    if (!user) return json({ error: "not_signed_in" }, 401);

    const { productId, purchaseToken } = (await req.json()) as { productId?: string; purchaseToken?: string };
    if (typeof productId !== "string" || typeof purchaseToken !== "string" || purchaseToken.length > 1000) {
      return json({ error: "bad_request" }, 400);
    }
    if (PACKS[productId]) return json(await verifyPack(user.id, productId, purchaseToken));
    if (productId === PLUS || productId === ADFREE) return json(await verifySub(user.id, purchaseToken));
    return json({ error: "unknown_product" }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[play-billing]", msg);
    return json({ error: msg.includes("subscriptions_one_running") ? "already_subscribed" : "verify_failed" }, 500);
  }
});
