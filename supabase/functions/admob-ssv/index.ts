// AdMob rewarded ads: server-side verification (Supabase Edge Function, Deno).
//
// AdMob calls this URL (GET) after a player watches a rewarded ad to the end. The query string
// is signed by Google; we check the signature with Google's published keys, then credit the
// reward through supabase/play.sql → admob_reward(). The app passes:
//   user_id      the player's account id
//   custom_data  the ad view id from start_ad_view('network', …)
// so a reward can only go to the player who started that view, once, within the daily cap.
//
// Set it in AdMob → Apps → (the app) → Ad units → (rewarded unit) → Server-side verification:
//   https://<project>.supabase.co/functions/v1/admob-ssv
// Deploy with:  supabase functions deploy admob-ssv --no-verify-jwt   (AdMob sends no auth header)

import { createClient } from "jsr:@supabase/supabase-js@2";

const KEYS_URL = "https://www.gstatic.com/admob/reward/verifier-keys.json";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

let keys: { at: number; byId: Map<string, CryptoKey> } | null = null;
async function keyFor(id: string): Promise<CryptoKey | null> {
  if (!keys || Date.now() - keys.at > 6 * 3600_000 || !keys.byId.has(id)) {
    const res = await fetch(KEYS_URL);
    const body = (await res.json()) as { keys: { keyId: number; base64: string }[] };
    const byId = new Map<string, CryptoKey>();
    for (const k of body.keys ?? []) {
      const der = Uint8Array.from(atob(k.base64), (c) => c.charCodeAt(0));
      byId.set(String(k.keyId), await crypto.subtle.importKey("spki", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]));
    }
    keys = { at: Date.now(), byId };
  }
  return keys.byId.get(id) ?? null;
}

const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

/** DER-encoded ECDSA signature → the 64-byte r‖s form WebCrypto expects. */
function derToRaw(der: Uint8Array): Uint8Array {
  let i = 2; // SEQUENCE, length
  if (der[1] & 0x80) i += der[1] & 0x7f;
  const read = () => {
    if (der[i++] !== 0x02) throw new Error("bad signature");
    const len = der[i++];
    let v = der.slice(i, i + len);
    i += len;
    while (v.length > 32 && v[0] === 0) v = v.slice(1);
    const out = new Uint8Array(32);
    out.set(v, 32 - v.length);
    return out;
  };
  const r = read();
  const s = read();
  const raw = new Uint8Array(64);
  raw.set(r, 0);
  raw.set(s, 32);
  return raw;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const query = url.search.startsWith("?") ? url.search.slice(1) : url.search;
  const at = query.indexOf("&signature=");
  // AdMob's "verify URL" check sends a request without a signature: just say OK
  if (at < 0) return new Response("ok");

  try {
    const message = query.slice(0, at);
    const p = url.searchParams;
    const key = await keyFor(p.get("key_id") ?? "");
    if (!key) return new Response("unknown key", { status: 400 });
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      derToRaw(fromB64url(p.get("signature") ?? "")),
      new TextEncoder().encode(message),
    );
    if (!ok) return new Response("bad signature", { status: 400 });

    const user = p.get("user_id") ?? "";
    const view = p.get("custom_data") ?? "";
    const txn = p.get("transaction_id") ?? "";
    // a valid callback we can't use (e.g. test ads without our ids): accept, credit nothing
    if (!UUID.test(user) || !UUID.test(view) || !txn) return new Response("ok");
    const { error } = await db.rpc("admob_reward", { p_user: user, p_view: view, p_txn: txn });
    if (error) throw error;
    return new Response("ok");
  } catch (e) {
    console.error("[admob-ssv]", e instanceof Error ? e.message : e);
    return new Response("error", { status: 500 }); // AdMob retries
  }
});
