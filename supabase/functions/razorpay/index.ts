// Razorpay payments for the website (Supabase Edge Function, Deno).
//
// The browser never sees the secret key. It calls this function (signed in) to:
//   { action: "order", pack, currency }            → a Razorpay order for a token pack
//   { action: "subscribe", plan, currency }        → a Razorpay subscription for Senevon Plus
//   { action: "verify", ...checkout response }     → checks Razorpay's signature, then credits
//   { action: "cancel" }                           → cancels Plus at the end of the paid period
// and Razorpay calls it with webhooks (POST ?webhook=1, signed with the webhook secret), which
// credit payments even if the buyer closed the tab, and keep Plus renewals / cancellations in sync.
//
// Secrets (`supabase secrets set …`):
//   RAZORPAY_KEY_ID           rzp_live_… (or rzp_test_… while testing)
//   RAZORPAY_KEY_SECRET       its secret
//   RAZORPAY_WEBHOOK_SECRET   the secret you type when adding the webhook in Razorpay
// Webhook URL: https://<project>.supabase.co/functions/v1/razorpay?webhook=1
//   events: payment.captured, subscription.activated, subscription.charged,
//           subscription.cancelled, subscription.completed, subscription.halted, subscription.pending
// Deploy with:  supabase functions deploy razorpay --no-verify-jwt
//   (Razorpay's webhooks carry no Supabase token; player requests are checked here instead.)

import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const KEY_ID = Deno.env.get("RAZORPAY_KEY_ID") ?? "";
const KEY_SECRET = Deno.env.get("RAZORPAY_KEY_SECRET") ?? "";
const WEBHOOK_SECRET = Deno.env.get("RAZORPAY_WEBHOOK_SECRET") ?? "";
const API = "https://api.razorpay.com/v1";
const CURRENCIES = new Set(["INR", "USD", "EUR", "GBP"]);

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/* ---------- Razorpay API ---------- */
async function rzp<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!KEY_ID || !KEY_SECRET) throw new HttpError(500, "razorpay_not_configured");
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: "Basic " + btoa(`${KEY_ID}:${KEY_SECRET}`), "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as { error?: { description?: string } }).error?.description ?? `HTTP ${res.status}`;
    throw new HttpError(502, `razorpay: ${msg}`);
  }
  return data as T;
}

/* ---------- signatures ---------- */
const enc = new TextEncoder();
async function hmacHex(secret: string, message: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}
/** Constant-time compare of two hex strings. */
function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/* ---------- helpers ---------- */
const units = (amount: number) => Math.round(amount * 100); // INR/USD/EUR/GBP all have 2 decimals
const periodOf = (plan: string) => (plan === "monthly" ? 30 : 365) * 86400_000;

type RzpSubscription = { id: string; status: string; current_end: number | null; notes?: Record<string, string> };

/** Our state for a Razorpay subscription, and the end of what's been paid. */
function stateOf(s: RzpSubscription, plan: string): { state: string; end: Date } {
  const end = s.current_end ? new Date(s.current_end * 1000) : new Date(Date.now() + periodOf(plan));
  if (s.status === "active" || s.status === "authenticated" || s.status === "pending") return { state: "active", end };
  // cancelled / completed / halted / expired: paid time left still counts
  return { state: end.getTime() > Date.now() ? "cancelled" : "expired", end };
}

async function syncSubscription(subId: string) {
  const { data: order } = await db.from("razorpay_orders").select("item").eq("id", subId).maybeSingle();
  if (!order) return; // not one of ours
  const s = await rzp<RzpSubscription>("GET", `/subscriptions/${subId}`);
  if (s.status === "created") return; // checkout never completed
  const { state, end } = stateOf(s, order.item);
  const { error } = await db.rpc("rp_set_plus", { p_sub: subId, p_state: state, p_period_end: end.toISOString() });
  if (error) throw error;
}

async function grantPack(paymentId: string, orderId: string) {
  // trust Razorpay's own record of the payment, not just the browser
  const p = await rzp<{ status: string; order_id: string }>("GET", `/payments/${paymentId}`);
  if (p.order_id !== orderId) throw new HttpError(400, "order_mismatch");
  if (p.status === "authorized") await rzp("POST", `/payments/${paymentId}/capture`, {}).catch(() => {}); // if auto-capture is off
  else if (p.status !== "captured") throw new HttpError(400, `payment_${p.status}`);
  const { error } = await db.rpc("rp_grant_pack", { p_payment: paymentId, p_order: orderId });
  if (error) throw error;
}

/** Razorpay plan id for a plan + currency + price (created on first use). */
async function planId(plan: "monthly" | "yearly", currency: string, amount: number) {
  const { data } = await db.from("razorpay_plans").select("plan_id").match({ plan, currency, amount }).maybeSingle();
  if (data) return data.plan_id as string;
  const p = await rzp<{ id: string }>("POST", "/plans", {
    period: plan,
    interval: 1,
    item: { name: `Senevon Plus (${plan})`, amount: units(amount), currency, description: "Monthly tokens and no ads" },
  });
  await db.from("razorpay_plans").insert({ plan, currency, amount, plan_id: p.id });
  return p.id;
}

/* ---------- player actions ---------- */
async function playerAction(req: Request) {
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth } = await db.auth.getUser(jwt);
  const user = auth?.user;
  if (!user) throw new HttpError(401, "not_signed_in");
  const body = (await req.json().catch(() => ({}))) as Record<string, string>;
  const currency = CURRENCIES.has(String(body.currency).toUpperCase()) ? String(body.currency).toUpperCase() : "INR";

  switch (body.action) {
    case "order": {
      const pack = String(body.pack ?? "");
      const { data: info } = await db.from("token_packs").select("id").eq("id", pack).eq("active", true).maybeSingle();
      if (!info) throw new HttpError(400, "bad_pack");
      // the price in the buyer's currency, else USD (as the page shows it)
      const { data: prices } = await db.from("pack_prices").select("currency, amount").eq("pack", pack);
      const price = prices?.find((p) => p.currency === currency) ?? prices?.find((p) => p.currency === "USD");
      if (!price) throw new HttpError(400, "bad_pack");
      const order = await rzp<{ id: string; amount: number; currency: string }>("POST", "/orders", {
        amount: units(Number(price.amount)),
        currency: price.currency,
        receipt: `pack_${pack}_${Date.now()}`.slice(0, 40),
        notes: { user_id: user.id, pack },
      });
      await db.from("razorpay_orders").insert({ id: order.id, user_id: user.id, kind: "pack", item: pack, currency: price.currency, amount: price.amount });
      return json({ key: KEY_ID, order_id: order.id, amount: order.amount, currency: order.currency, email: user.email ?? "" });
    }

    case "subscribe": {
      const plan = body.plan === "yearly" ? "yearly" : "monthly";
      const { data: running } = await db.from("subscriptions").select("id").eq("user_id", user.id).in("status", ["active", "cancelled"]).maybeSingle();
      if (running) throw new HttpError(400, "already_subscribed");
      const { data: prices } = await db.from("plan_prices").select("currency, amount").eq("plan", plan);
      const price = prices?.find((p) => p.currency === currency) ?? prices?.find((p) => p.currency === "INR");
      if (!price) throw new HttpError(400, "bad_plan");
      let use = price;
      let pid: string;
      try {
        pid = await planId(plan, price.currency, Number(price.amount));
      } catch (e) {
        // if this account can't bill subscriptions in that currency, fall back to INR
        const inr = prices?.find((p) => p.currency === "INR");
        if (price.currency === "INR" || !inr) throw e;
        use = inr;
        pid = await planId(plan, "INR", Number(inr.amount));
      }
      const sub = await rzp<{ id: string }>("POST", "/subscriptions", {
        plan_id: pid,
        total_count: plan === "monthly" ? 120 : 10,
        quantity: 1,
        customer_notify: 1,
        notes: { user_id: user.id, plan },
      });
      await db.from("razorpay_orders").insert({ id: sub.id, user_id: user.id, kind: "plus", item: plan, currency: use.currency, amount: use.amount });
      return json({ key: KEY_ID, subscription_id: sub.id, currency: use.currency, amount: units(Number(use.amount)), email: user.email ?? "" });
    }

    case "verify": {
      const paymentId = String(body.razorpay_payment_id ?? "");
      const signature = String(body.razorpay_signature ?? "");
      const orderId = body.razorpay_order_id ? String(body.razorpay_order_id) : "";
      const subId = body.razorpay_subscription_id ? String(body.razorpay_subscription_id) : "";
      const ref = orderId || subId;
      const { data: mine } = await db.from("razorpay_orders").select("user_id").eq("id", ref).maybeSingle();
      if (!mine || mine.user_id !== user.id) throw new HttpError(400, "unknown_order");
      const expected = await hmacHex(KEY_SECRET, orderId ? `${orderId}|${paymentId}` : `${paymentId}|${subId}`);
      if (!same(expected, signature)) throw new HttpError(400, "bad_signature");
      if (orderId) await grantPack(paymentId, orderId);
      else await syncSubscription(subId);
      return json({ ok: true });
    }

    case "cancel": {
      const { data: sub } = await db
        .from("subscriptions")
        .select("provider_ref")
        .eq("user_id", user.id)
        .eq("provider", "razorpay")
        .eq("status", "active")
        .maybeSingle();
      if (!sub?.provider_ref) throw new HttpError(400, "no_subscription");
      // stop renewing; what's paid for stays until the period ends
      await rzp("POST", `/subscriptions/${sub.provider_ref}/cancel`, { cancel_at_cycle_end: 1 });
      const s = await rzp<RzpSubscription>("GET", `/subscriptions/${sub.provider_ref}`);
      const { data: order } = await db.from("razorpay_orders").select("item").eq("id", sub.provider_ref).maybeSingle();
      const end = s.current_end ? new Date(s.current_end * 1000) : new Date(Date.now() + periodOf(order?.item ?? "monthly"));
      const { error } = await db.rpc("rp_set_plus", { p_sub: sub.provider_ref, p_state: "cancelled", p_period_end: end.toISOString() });
      if (error) throw error;
      return json({ ok: true });
    }
  }
  throw new HttpError(400, "bad_action");
}

/* ---------- webhooks ---------- */
async function webhook(req: Request) {
  const raw = await req.text();
  if (!WEBHOOK_SECRET) throw new HttpError(500, "webhook_not_configured");
  const expected = await hmacHex(WEBHOOK_SECRET, raw);
  if (!same(expected, req.headers.get("x-razorpay-signature") ?? "")) throw new HttpError(400, "bad_signature");
  const ev = JSON.parse(raw) as {
    event: string;
    payload: { payment?: { entity: { id: string; order_id: string | null } }; subscription?: { entity: { id: string } } };
  };
  if (ev.event === "payment.captured") {
    const pay = ev.payload.payment?.entity;
    if (pay?.order_id) {
      const { data: order } = await db.from("razorpay_orders").select("kind").eq("id", pay.order_id).maybeSingle();
      if (order?.kind === "pack") await grantPack(pay.id, pay.order_id);
    }
  } else if (ev.event.startsWith("subscription.")) {
    const id = ev.payload.subscription?.entity.id;
    if (id) await syncSubscription(id);
  }
  return new Response("ok");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (new URL(req.url).searchParams.has("webhook")) return await webhook(req);
    return await playerAction(req);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const message = e instanceof Error ? e.message : String(e);
    console.error("[razorpay]", message);
    return json({ error: message }, status); // a failed webhook gets retried by Razorpay
  }
});
