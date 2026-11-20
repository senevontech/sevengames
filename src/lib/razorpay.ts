/* Razorpay checkout on the website (live payments mode). The order / subscription is created by
   the `razorpay` Edge Function (it holds the secret key); Razorpay's checkout script is loaded
   only when someone actually pays; the function checks the payment's signature before crediting.
   The Android app uses Google Play Billing instead (src/lib/playBilling.ts). */
import { supabase } from "../supabase";

type RzpResponse = {
  razorpay_payment_id: string;
  razorpay_signature: string;
  razorpay_order_id?: string;
  razorpay_subscription_id?: string;
};
type RzpOptions = Record<string, unknown> & { handler: (r: RzpResponse) => void };
type RzpInstance = { open: () => void; on: (ev: string, cb: (e: unknown) => void) => void };
declare global {
  interface Window {
    Razorpay?: new (o: RzpOptions) => RzpInstance;
  }
}

const SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";
let loading: Promise<void> | null = null;
function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loading = null;
      reject(new Error("checkout_unavailable"));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/** Call the Edge Function; turns its { error } replies into thrown errors with that code. */
async function call<T>(body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.functions.invoke("razorpay", { body });
  if (error) {
    let msg = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      const j = ctx ? await ctx.json() : null;
      if (j?.error) msg = j.error;
    } catch {
      /* keep the generic message */
    }
    throw new Error(msg);
  }
  return data as T;
}

/** Open Razorpay's checkout; resolves once the server has verified (and credited) the payment. */
async function pay(options: Record<string, unknown>, description: string, email: string) {
  await loadCheckout();
  const Razorpay = window.Razorpay;
  if (!Razorpay) throw new Error("checkout_unavailable");
  await new Promise<void>((resolve, reject) => {
    const rzp = new Razorpay({
      ...options,
      name: "Senevon Game Studio",
      description,
      image: `${location.origin}/logo/icon-192.png`,
      prefill: email ? { email } : undefined,
      theme: { color: "#f46000" },
      handler: (r) => void call({ action: "verify", ...r }).then(() => resolve(), reject),
      modal: { ondismiss: () => reject(new Error("payment_cancelled")), confirm_close: true },
    });
    rzp.open();
  });
}

/** Buy a token pack (credited by the server once paid). */
export async function razorpayBuyPack(pack: string, currency: string, label: string) {
  const o = await call<{ key: string; order_id: string; amount: number; currency: string; email: string }>({ action: "order", pack, currency });
  await pay({ key: o.key, order_id: o.order_id, amount: o.amount, currency: o.currency }, label, o.email);
}

/** Start Senevon Plus (an auto-renewing Razorpay subscription). */
export async function razorpaySubscribe(plan: "monthly" | "yearly", currency: string) {
  const s = await call<{ key: string; subscription_id: string; email: string }>({ action: "subscribe", plan, currency });
  await pay({ key: s.key, subscription_id: s.subscription_id }, `Senevon Plus · ${plan}`, s.email);
}

/** Stop Plus renewing (it stays active until the paid period ends). */
export async function razorpayCancel() {
  await call({ action: "cancel" });
}
