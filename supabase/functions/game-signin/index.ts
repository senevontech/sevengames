// Sign a player in on a partner game's site with their Senevon account (Supabase Edge Function).
//
// Senevon opens the game's site with a one-time code (supabase/game_signin.sql). The site POSTs
// { code } here; we check it (single use, 60 seconds), and answer with a one-time sign-in token
// that the site turns into a session with supabase.auth.verifyOtp({ token_hash, type: "email" }).
// No e-mail is sent.
//
// Secrets (`supabase secrets set …`):
//   GAME_SIGNIN_ORIGINS   optional, comma-separated sites allowed to call this from a browser
//                         (default https://droiddoom.onrender.com)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.
// Deploy with:  supabase functions deploy game-signin --no-verify-jwt

import { createClient } from "jsr:@supabase/supabase-js@2";

const ORIGINS = (Deno.env.get("GAME_SIGNIN_ORIGINS") ?? "https://droiddoom.onrender.com")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

function cors(origin: string | null) {
  // browsers: only the partner sites; native game apps send no Origin header
  const allow = origin && ORIGINS.includes(origin) ? origin : ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const headers = cors(origin);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (origin && !ORIGINS.includes(origin)) return json({ error: "origin" }, 403);

  let code = "";
  try {
    code = String((await req.json())?.code ?? "");
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  if (!/^[0-9a-f]{64}$/.test(code)) return json({ error: "bad_code" }, 400);

  // use the code: delete it as we read it, so it works once
  const { data: row, error } = await db
    .from("game_signin_codes")
    .delete()
    .eq("code_hash", await sha256Hex(code))
    .gt("expires_at", new Date().toISOString())
    .select("user_id, game_id")
    .maybeSingle();
  if (error) return json({ error: "server" }, 500);
  if (!row) return json({ error: "expired" }, 400);

  const { data: u, error: ue } = await db.auth.admin.getUserById(row.user_id);
  const email = u?.user?.email;
  if (ue || !email) return json({ error: "no_email" }, 400);

  const { data: link, error: le } = await db.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = link?.properties?.hashed_token;
  if (le || !tokenHash) return json({ error: "server" }, 500);

  return json({ token_hash: tokenHash, game: row.game_id });
});
