// 7games admin API (Supabase Edge Function, Deno).
//
// Secrets (set with `supabase secrets set`):
//   ADMIN_PASSWORD          required – the admin panel password
//   ADMIN_TOKEN_SECRET      optional – HMAC key for session tokens (falls back to ADMIN_PASSWORD)
//   CLOUDINARY_CLOUD_NAME   required for image uploads
//   CLOUDINARY_API_KEY      required for image uploads
//   CLOUDINARY_API_SECRET   required for image uploads
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.
//
// Every request is POST JSON: { action, token?, ...payload }.
// `login` exchanges the password for a short-lived signed token; all other
// actions require that token.

import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;
const enc = new TextEncoder();

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

/* ---------- crypto helpers ---------- */

const hex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function hmac(key: string, msg: string) {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
}

// Constant-time string compare via HMAC of both sides.
async function safeEqual(a: string, b: string) {
  const [x, y] = await Promise.all([hmac("cmp", a), hmac("cmp", b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

const tokenKey = () => Deno.env.get("ADMIN_TOKEN_SECRET") || Deno.env.get("ADMIN_PASSWORD") || "";

async function makeToken() {
  const exp = String(Date.now() + TOKEN_TTL_MS);
  return { token: `${exp}.${await hmac(tokenKey(), exp)}`, expires: Number(exp) };
}

async function verifyToken(token: unknown) {
  if (typeof token !== "string") return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return safeEqual(sig, await hmac(tokenKey(), exp));
}

/* ---------- crude brute-force throttle (per instance) ---------- */

const failures = new Map<string, { n: number; until: number }>();

function throttled(ip: string) {
  const f = failures.get(ip);
  return Boolean(f && f.n >= 5 && f.until > Date.now());
}
function noteFailure(ip: string) {
  const f = failures.get(ip) ?? { n: 0, until: 0 };
  f.n += 1;
  f.until = Date.now() + 10 * 60 * 1000;
  failures.set(ip, f);
}

/* ---------- stats ---------- */

type EventRow = {
  created_at: string;
  visitor_id: string;
  type: string;
  path: string | null;
  game_id: string | null;
  ad_id: string | null;
  referrer: string | null;
  device: string | null;
  score: number | null;
};

async function fetchEvents(sinceIso: string): Promise<EventRow[]> {
  const rows: EventRow[] = [];
  const page = 1000;
  for (let from = 0; from < 100_000; from += page) {
    const { data, error } = await db
      .from("events")
      .select("created_at, visitor_id, type, path, game_id, ad_id, referrer, device, score")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: true })
      .range(from, from + page - 1);
    if (error) throw error;
    rows.push(...(data as EventRow[]));
    if (!data || data.length < page) break;
  }
  return rows;
}

const dayKey = (iso: string) => iso.slice(0, 10);

function topN(map: Map<string, number>, n: number) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

async function stats(daysInput: unknown) {
  const days = Math.min(90, Math.max(1, Number(daysInput) || 30));
  const since = new Date(Date.now() - days * 86_400_000);
  since.setUTCHours(0, 0, 0, 0);
  const events = await fetchEvents(since.toISOString());

  const visitors = new Set<string>();
  const perDay = new Map<string, { views: number; visitors: Set<string> }>();
  for (let i = 0; i <= days; i += 1) {
    const d = new Date(since.getTime() + i * 86_400_000).toISOString().slice(0, 10);
    perDay.set(d, { views: 0, visitors: new Set() });
  }
  const pages = new Map<string, number>();
  const referrers = new Map<string, number>();
  const devices = new Map<string, number>();
  const hours = Array<number>(24).fill(0);
  const games = new Map<string, { starts: number; finishes: number; scoreSum: number; players: Set<string> }>();
  const ads = new Map<string, { impressions: number; clicks: number }>();
  let views = 0;
  let starts = 0;
  let finishes = 0;

  for (const e of events) {
    if (e.type === "pageview") {
      views += 1;
      visitors.add(e.visitor_id);
      const bucket = perDay.get(dayKey(e.created_at));
      if (bucket) {
        bucket.views += 1;
        bucket.visitors.add(e.visitor_id);
      }
      pages.set(e.path || "/", (pages.get(e.path || "/") ?? 0) + 1);
      devices.set(e.device || "unknown", (devices.get(e.device || "unknown") ?? 0) + 1);
      hours[new Date(e.created_at).getUTCHours()] += 1;
      if (e.referrer) {
        let host = e.referrer;
        try {
          host = new URL(e.referrer).hostname;
        } catch {
          /* keep raw */
        }
        referrers.set(host, (referrers.get(host) ?? 0) + 1);
      } else {
        referrers.set("(direct)", (referrers.get("(direct)") ?? 0) + 1);
      }
    } else if (e.type === "game_start" || e.type === "game_finish") {
      const id = e.game_id || "unknown";
      const g = games.get(id) ?? { starts: 0, finishes: 0, scoreSum: 0, players: new Set<string>() };
      g.players.add(e.visitor_id);
      if (e.type === "game_start") {
        g.starts += 1;
        starts += 1;
      } else {
        g.finishes += 1;
        g.scoreSum += e.score ?? 0;
        finishes += 1;
      }
      games.set(id, g);
    } else if ((e.type === "ad_impression" || e.type === "ad_click") && e.ad_id) {
      const a = ads.get(e.ad_id) ?? { impressions: 0, clicks: 0 };
      if (e.type === "ad_impression") a.impressions += 1;
      else a.clicks += 1;
      ads.set(e.ad_id, a);
    }
  }

  const todayKey = new Date().toISOString().slice(0, 10);
  const today = perDay.get(todayKey);

  const [profiles, newProfiles, scores] = await Promise.all([
    db.from("profiles").select("id", { count: "exact", head: true }),
    db.from("profiles").select("id", { count: "exact", head: true }).gte("created_at", since.toISOString()),
    db.from("game_scores").select("id", { count: "exact", head: true }),
  ]);

  const recent = events.slice(-25).reverse().map((e) => ({
    at: e.created_at,
    type: e.type,
    path: e.path,
    game_id: e.game_id,
    device: e.device,
  }));

  return {
    days,
    totals: {
      pageviews: views,
      visitors: visitors.size,
      todayViews: today?.views ?? 0,
      todayVisitors: today?.visitors.size ?? 0,
      gameStarts: starts,
      gameFinishes: finishes,
      users: profiles.count ?? 0,
      newUsers: newProfiles.count ?? 0,
      scoresSaved: scores.count ?? 0,
    },
    daily: [...perDay.entries()].map(([date, v]) => ({ date, views: v.views, visitors: v.visitors.size })),
    pages: topN(pages, 12),
    referrers: topN(referrers, 10),
    devices: topN(devices, 5),
    hours,
    games: [...games.entries()]
      .map(([id, g]) => ({
        id,
        starts: g.starts,
        finishes: g.finishes,
        players: g.players.size,
        avgScore: g.finishes ? Math.round(g.scoreSum / g.finishes) : 0,
      }))
      .sort((a, b) => b.starts - a.starts),
    ads: Object.fromEntries(ads),
    recent,
  };
}

/* ---------- ads ---------- */

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const optText = (v: unknown, max: number) => text(v, max) || null;
const optDate = (v: unknown) => {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const optTime = (v: unknown) => (typeof v === "string" && /^\d{2}:\d{2}(:\d{2})?$/.test(v) ? v : null);
/** Optional image link: empty → null; anything that isn't an http(s) URL is an error
 *  (it used to be dropped silently, saving the ad with no image). */
const imageUrl = (v: unknown, label: string) => {
  const raw = typeof v === "string" ? v.trim() : "";
  if (!raw) return null;
  const ok = httpUrl(raw);
  if (!ok || raw.length > 800) throw new Error(`${label} must be an http(s) image link`);
  return ok;
};
const httpUrl = (v: unknown) => {
  const s = text(v, 800);
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? s : "";
  } catch {
    return "";
  }
};

function cleanAd(input: Record<string, unknown>) {
  const title = text(input.title, 120);
  const link = httpUrl(input.link_url);
  if (!title) throw new Error("Title is required");
  if (!link) throw new Error("A valid http(s) link is required");
  const max = Number(input.max_impressions);
  return {
    title,
    link_url: link,
    cover_url: imageUrl(input.cover_url, "Cover image"),
    thumb_url: imageUrl(input.thumb_url, "Thumbnail"),
    body: optText(input.body, 240),
    cta_label: text(input.cta_label, 30) || "Learn more",
    active: input.active !== false,
    starts_at: optDate(input.starts_at),
    ends_at: optDate(input.ends_at),
    daily_start: optTime(input.daily_start),
    daily_end: optTime(input.daily_end),
    max_impressions: Number.isFinite(max) && max > 0 ? Math.floor(max) : null,
    sort_order: Number.isFinite(Number(input.sort_order)) ? Math.floor(Number(input.sort_order)) : 0,
    placement: input.placement === "banner" || input.placement === "disk" ? input.placement : "all",
    updated_at: new Date().toISOString(),
  };
}

/* ---------- settings ---------- */

const SETTING_KEYS: Record<string, "boolean" | "number" | "string"> = {
  ads_enabled: "boolean",
  ad_rotate_seconds: "number",
  tracking_enabled: "boolean",
  announcement_enabled: "boolean",
  announcement_text: "string",
};

/* ---------- Cloudinary signed upload ---------- */

async function sha1Hex(s: string) {
  return hex(await crypto.subtle.digest("SHA-1", enc.encode(s)));
}

async function cloudinarySignature() {
  const cloud = Deno.env.get("CLOUDINARY_CLOUD_NAME");
  const key = Deno.env.get("CLOUDINARY_API_KEY");
  const secret = Deno.env.get("CLOUDINARY_API_SECRET");
  if (!cloud || !key || !secret) throw new Error("Cloudinary secrets are not configured");
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = "7games/ads";
  // Params must be alphabetical, joined with &, then the secret appended.
  const signature = await sha1Hex(`folder=${folder}&timestamp=${timestamp}${secret}`);
  return { cloud_name: cloud, api_key: key, timestamp, folder, signature };
}

/* ---------- tokens ---------- */

async function userIdByEmail(email: string): Promise<string | null> {
  // paged; fine for small/medium user counts
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === email);
    if (hit) return hit.id;
    if (data.users.length < 200) break;
  }
  return null;
}

/* ---------- router ---------- */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const action = String(body.action ?? "");
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";

  try {
    if (action === "login") {
      const password = Deno.env.get("ADMIN_PASSWORD");
      if (!password) return json({ error: "ADMIN_PASSWORD is not configured on the server" }, 500);
      if (throttled(ip)) return json({ error: "Too many attempts. Try again in a few minutes." }, 429);
      const given = typeof body.password === "string" ? body.password : "";
      if (!(await safeEqual(given, password))) {
        noteFailure(ip);
        await new Promise((r) => setTimeout(r, 600));
        return json({ error: "Wrong password" }, 401);
      }
      failures.delete(ip);
      return json(await makeToken());
    }

    if (!(await verifyToken(body.token))) return json({ error: "Session expired" }, 401);

    switch (action) {
      case "ping":
        return json({ ok: true });

      case "stats":
        return json(await stats(body.days));

      // Dashboard (supabase/analytics.sql): numbers for a period and the one before it
      case "dashboard": {
        const from = new Date(String(body.from));
        const to = new Date(String(body.to));
        if (isNaN(+from) || isNaN(+to) || to <= from) return json({ error: "Bad period" }, 400);
        const { data, error } = await db.rpc("admin_dashboard", { p_from: from.toISOString(), p_to: to.toISOString() });
        if (error) throw error;
        // KPIs (engagement.sql): missing until that file is run
        const k = await db.rpc("admin_kpis", {
          p_from: from.toISOString(),
          p_to: to.toISOString(),
          p_tz: typeof body.tz === "string" ? body.tz.slice(0, 64) : "UTC",
        });
        return json({ ...(data as Record<string, unknown>), kpis: k.error ? null : k.data });
      }

      /* ---------- engagement (engagement.sql) ---------- */
      case "engagement_get": {
        const today = new Date().toISOString().slice(0, 10);
        const [weeks, tours, access, setting] = await Promise.all([
          db.from("weekly_games").select("week_start, game_id, set_by_admin, settled_at").gte("week_start", new Date(Date.now() - 21 * 86_400_000).toISOString().slice(0, 10)).order("week_start"),
          db.from("tournaments").select("*").order("starts_at", { ascending: false }).limit(50),
          db.from("game_access").select("game_id, mode"),
          db.from("site_settings").select("value").eq("key", "tournaments_enabled").maybeSingle(),
        ]);
        for (const r of [weeks, tours, access]) if (r.error) throw r.error;
        const ids = (tours.data ?? []).map((t) => t.id);
        const entries = ids.length ? await db.from("tournament_entries").select("tournament_id").in("tournament_id", ids) : { data: [] };
        const counts: Record<string, number> = {};
        for (const e of (entries.data ?? []) as { tournament_id: string }[]) counts[e.tournament_id] = (counts[e.tournament_id] ?? 0) + 1;
        return json({
          today,
          weeks: weeks.data ?? [],
          tournaments: (tours.data ?? []).map((t) => ({ ...t, entrants: counts[t.id] ?? 0 })),
          access: access.data ?? [],
          tournaments_enabled: setting.data?.value === true,
        });
      }

      case "weekly_set": {
        const week = text(body.week_start, 10);
        const game = text(body.game_id, 64);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(week) || new Date(week + "T00:00:00Z").getUTCDay() !== 1) return json({ error: "Pick a Monday" }, 400);
        if (!game) {
          const { error } = await db.from("weekly_games").delete().eq("week_start", week).is("settled_at", null);
          if (error) throw error;
          return json({ ok: true });
        }
        const { error } = await db.from("weekly_games").upsert({ week_start: week, game_id: game, set_by_admin: true });
        if (error) throw error;
        return json({ ok: true });
      }

      case "tournaments_toggle": {
        const { error } = await db.from("site_settings").upsert({ key: "tournaments_enabled", value: body.on === true, updated_at: new Date().toISOString() });
        if (error) throw error;
        return json({ ok: true });
      }

      case "tournament_save": {
        const title = text(body.title, 80);
        const game = text(body.game_id, 64);
        const starts = new Date(String(body.starts_at));
        const ends = new Date(String(body.ends_at));
        if (title.length < 3 || !game || isNaN(+starts) || isNaN(+ends) || ends <= starts) return json({ error: "Check the title, game and dates" }, 400);
        const pct = (Array.isArray(body.prize_pct) ? body.prize_pct : [50, 30, 20]).map((n) => Math.max(0, Math.round(Number(n) || 0))).slice(0, 10);
        if (pct.reduce((a, b) => a + b, 0) > 100) return json({ error: "Prize shares add up to more than 100%" }, 400);
        const row = {
          title,
          game_id: game,
          entry_fee: Math.max(0, Math.min(100000, Math.round(Number(body.entry_fee) || 0))),
          bonus: Math.max(0, Math.min(1000000, Math.round(Number(body.bonus) || 0))),
          prize_pct: pct,
          starts_at: starts.toISOString(),
          ends_at: ends.toISOString(),
        };
        const id = text(body.id, 40);
        const { error } = id ? await db.from("tournaments").update(row).eq("id", id).is("settled_at", null) : await db.from("tournaments").insert(row);
        if (error) throw error;
        return json({ ok: true });
      }

      case "tournament_delete": {
        const id = text(body.id, 40);
        const { count } = await db.from("tournament_entries").select("user_id", { count: "exact", head: true }).eq("tournament_id", id);
        if (count) return json({ error: "Players have joined (and paid); it can't be deleted" }, 400);
        const { error } = await db.from("tournaments").delete().eq("id", id);
        if (error) throw error;
        return json({ ok: true });
      }

      case "game_access_set": {
        const game = text(body.game_id, 64);
        if (!game) return json({ error: "Missing game" }, 400);
        const mode = body.mode === "plus" || body.mode === "early" ? body.mode : null;
        const { error } = mode
          ? await db.from("game_access").upsert({ game_id: game, mode, updated_at: new Date().toISOString() })
          : await db.from("game_access").delete().eq("game_id", game);
        if (error) throw error;
        return json({ ok: true });
      }

      /* ---------- custom chat sticker packs (chat.sql) ---------- */
      case "chat_packs_list": {
        const { data, error } = await db.from("chat_custom_packs").select("*").order("created_at");
        if (error) throw error;
        const ids = (data ?? []).map((p) => `chat:c:${p.id}`);
        const items = ids.length ? await db.from("shop_items").select("item_id, price, plus_only, active").in("item_id", ids) : { data: [] };
        const byId = Object.fromEntries(((items.data ?? []) as { item_id: string }[]).map((r) => [r.item_id, r]));
        return json({ packs: (data ?? []).map((p) => ({ ...p, shop: byId[`chat:c:${p.id}`] ?? null })) });
      }

      case "chat_pack_save": {
        const id = text(body.id, 32).toLowerCase();
        const name = text(body.name, 40);
        if (!/^[a-z0-9-]{2,32}$/.test(id) || name.length < 2) return json({ error: "Give the pack an id (a-z, 0-9, -) and a name" }, 400);
        const items = (Array.isArray(body.items) ? body.items : [])
          .map((x: unknown, i: number) => {
            const r = (x ?? {}) as Record<string, unknown>;
            return { id: text(r.id, 32) || `s${i}`, label: text(r.label, 30), url: text(r.url, 500) };
          })
          .filter((x: { url: string }) => /^https:\/\/res\.cloudinary\.com\//.test(x.url))
          .slice(0, 24);
        if (!items.length) return json({ error: "Upload at least one sticker" }, 400);
        const { error } = await db.from("chat_custom_packs").upsert({ id, name, items });
        if (error) throw error;
        const price = Math.max(0, Math.min(1_000_000, Math.round(Number(body.price) || 0)));
        const plusOnly = body.plus_only === true;
        const r = await db.from("shop_items").upsert({ item_id: `chat:c:${id}`, kind: "chat_pack", price, plus_only: plusOnly, sort: 100, updated_at: new Date().toISOString() });
        if (r.error) throw r.error;
        return json({ ok: true });
      }

      case "chat_pack_active": {
        // stop selling it; players who bought it keep it (its stickers stay)
        const id = text(body.id, 32);
        const { error } = await db.from("shop_items").update({ active: body.active === true }).eq("item_id", `chat:c:${id}`);
        if (error) throw error;
        return json({ ok: true });
      }

      case "leads_list": {
        const { data, error } = await db.from("business_enquiries").select("*").order("created_at", { ascending: false }).limit(200);
        if (error) throw error;
        return json({ leads: data ?? [] });
      }

      case "lead_update": {
        const id = Number(body.id);
        const patch: Record<string, unknown> = {};
        if (["new", "contacted", "won", "lost"].includes(String(body.status))) patch.status = body.status;
        if (body.note !== undefined) patch.note = text(body.note, 2000);
        const { error } = await db.from("business_enquiries").update(patch).eq("id", id);
        if (error) throw error;
        return json({ ok: true });
      }

      case "dashboard_detail": {
        const from = new Date(String(body.from));
        const to = new Date(String(body.to));
        if (isNaN(+from) || isNaN(+to) || to <= from) return json({ error: "Bad period" }, 400);
        const { data, error } = await db.rpc("admin_detail", {
          p_metric: String(body.metric ?? ""),
          p_from: from.toISOString(),
          p_to: to.toISOString(),
          p_tz: typeof body.tz === "string" ? body.tz.slice(0, 64) : "UTC",
        });
        if (error) throw error;
        return json(data);
      }

      // This browser never counts in the stats (the admin's own visits)
      case "exclude_device": {
        const visitor = typeof body.visitor === "string" ? body.visitor.slice(0, 64) : "";
        if (visitor.length < 8) return json({ error: "Bad device id" }, 400);
        if (body.on === false) {
          await db.from("analytics_excluded").delete().eq("visitor_id", visitor);
        } else {
          const { error } = await db.from("analytics_excluded").upsert({ visitor_id: visitor, note: "admin device" });
          if (error) throw error;
          // its earlier visits don't count either
          await db.from("events").delete().eq("visitor_id", visitor);
        }
        return json({ ok: true });
      }

      case "ads_list": {
        const { data, error } = await db
          .from("ads")
          .select("*")
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: false });
        if (error) throw error;
        return json({ ads: data });
      }

      case "ad_save": {
        const ad = (body.ad ?? {}) as Record<string, unknown>;
        const values = cleanAd(ad);
        if (typeof ad.id === "string" && ad.id) {
          const { data, error } = await db.from("ads").update(values).eq("id", ad.id).select().single();
          if (error) throw error;
          return json({ ad: data });
        }
        const { data, error } = await db.from("ads").insert(values).select().single();
        if (error) throw error;
        return json({ ad: data });
      }

      case "ad_delete": {
        const { error } = await db.from("ads").delete().eq("id", String(body.id ?? ""));
        if (error) throw error;
        return json({ ok: true });
      }

      case "ad_reset_counts": {
        const { error } = await db
          .from("ads")
          .update({ impressions: 0, clicks: 0 })
          .eq("id", String(body.id ?? ""));
        if (error) throw error;
        return json({ ok: true });
      }

      case "settings_get": {
        const { data, error } = await db.from("site_settings").select("key, value");
        if (error) throw error;
        return json({ settings: Object.fromEntries((data ?? []).map((r) => [r.key, r.value])) });
      }

      case "settings_save": {
        const input = (body.settings ?? {}) as Record<string, unknown>;
        const rows: { key: string; value: unknown; updated_at: string }[] = [];
        for (const [key, kind] of Object.entries(SETTING_KEYS)) {
          if (!(key in input)) continue;
          let value: unknown = input[key];
          if (kind === "boolean") value = Boolean(value);
          else if (kind === "number") value = Math.min(120, Math.max(2, Number(value) || 8));
          else value = text(value, 280);
          rows.push({ key, value, updated_at: new Date().toISOString() });
        }
        if (rows.length) {
          const { error } = await db.from("site_settings").upsert(rows);
          if (error) throw error;
        }
        return json({ ok: true });
      }

      case "upload_sign":
        return json(await cloudinarySignature());

      /* ---- Senevon Pro: grant / revoke (payments are wired later) ---- */
      case "pro_list": {
        const { data, error } = await db.from("pro_members").select("user_id, email, note, created_at").order("created_at", { ascending: false });
        if (error) throw error;
        return json({ members: data ?? [] });
      }

      case "pro_set": {
        const email = text(body.email, 200).toLowerCase();
        const on = Boolean(body.on);
        if (!email.includes("@")) return json({ error: "Enter the player's account email" }, 400);
        // find the auth user by email (paged; fine for small/medium user counts)
        let userId: string | null = null;
        for (let page = 1; page <= 20 && !userId; page++) {
          const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
          if (error) throw error;
          userId = data.users.find((u) => (u.email ?? "").toLowerCase() === email)?.id ?? null;
          if (data.users.length < 200) break;
        }
        if (!userId) return json({ error: "No account with that email" }, 404);
        if (on) {
          const { error } = await db.from("pro_members").upsert({ user_id: userId, email, note: text(body.note, 200) || null });
          if (error) throw error;
        } else {
          const { error } = await db.from("pro_members").delete().eq("user_id", userId);
          if (error) throw error;
        }
        return json({ ok: true });
      }

      /* ---- Tokens: prices, plans, payments mode, grants ---- */
      case "tokens_config": {
        const [games, plans, mode] = await Promise.all([
          db.from("game_prices").select("game_id, cost"),
          db.from("plan_prices").select("currency, plan, amount").order("currency"),
          db.from("site_settings").select("value").eq("key", "payments_mode").maybeSingle(),
        ]);
        if (games.error) throw games.error;
        if (plans.error) throw plans.error;
        return json({
          game_prices: games.data ?? [],
          plan_prices: plans.data ?? [],
          payments_mode: (mode.data?.value as string | undefined) ?? "mock",
        });
      }

      case "game_price_set": {
        const gameId = text(body.game_id, 80);
        const cost = Math.max(0, Math.min(1_000_000, Math.round(Number(body.cost) || 0)));
        if (!gameId) return json({ error: "Missing game" }, 400);
        const { error } = await db.from("game_prices").upsert({ game_id: gameId, cost, updated_at: new Date().toISOString() });
        if (error) throw error;
        return json({ ok: true });
      }

      case "game_prices_set_bulk": {
        const list = Array.isArray(body.prices) ? (body.prices as Record<string, unknown>[]) : [];
        const now = new Date().toISOString();
        const rows = list
          .slice(0, 500)
          .map((p) => ({
            game_id: text(p.game_id, 80),
            cost: Math.max(0, Math.min(1_000_000, Math.round(Number(p.cost) || 0))),
            updated_at: now,
          }))
          .filter((r) => r.game_id);
        if (!rows.length) return json({ error: "Nothing to save" }, 400);
        const { error } = await db.from("game_prices").upsert(rows);
        if (error) throw error;
        return json({ ok: true, saved: rows.length });
      }

      /* ---- Shop (supabase/shop.sql): item prices + on/off ---- */
      case "shop_items_list": {
        let { data, error } = await db.from("shop_items").select("item_id, kind, price, grants, qty, active, sort, plus_only").order("kind").order("sort");
        // plus_only arrives with shop.sql's Plus update
        if (error) ({ data, error } = await db.from("shop_items").select("item_id, kind, price, grants, qty, active, sort").order("kind").order("sort"));
        if (error) throw error;
        return json({ items: data ?? [] });
      }

      case "shop_item_set": {
        const itemId = text(body.item_id, 80);
        if (!itemId) return json({ error: "Missing item" }, 400);
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (body.price !== undefined) patch.price = Math.max(0, Math.min(1_000_000, Math.round(Number(body.price) || 0)));
        if (body.active !== undefined) patch.active = body.active === true;
        if (body.plus_only !== undefined) patch.plus_only = body.plus_only === true;
        const { error } = await db.from("shop_items").update(patch).eq("item_id", itemId);
        if (error) throw error;
        return json({ ok: true });
      }

      case "plan_price_set": {
        const currency = text(body.currency, 3).toUpperCase();
        const plan = body.plan === "yearly" ? "yearly" : "monthly";
        const amount = Math.round(Number(body.amount) * 100) / 100;
        if (!/^[A-Z]{3}$/.test(currency)) return json({ error: "Currency must be a 3-letter code like INR" }, 400);
        if (!(amount > 0)) return json({ error: "Price must be above 0" }, 400);
        const { error } = await db.from("plan_prices").upsert({ currency, plan, amount });
        if (error) throw error;
        return json({ ok: true });
      }

      case "plan_price_delete": {
        const currency = text(body.currency, 3).toUpperCase();
        if (currency === "USD") return json({ error: "USD is the fallback currency and can't be removed" }, 400);
        const { error } = await db.from("plan_prices").delete().eq("currency", currency);
        if (error) throw error;
        return json({ ok: true });
      }

      case "payments_mode_set": {
        const mode = body.mode === "live" ? "live" : "mock";
        const { error } = await db
          .from("site_settings")
          .upsert({ key: "payments_mode", value: mode, updated_at: new Date().toISOString() });
        if (error) throw error;
        return json({ ok: true, mode });
      }

      case "tokens_lookup": {
        const email = text(body.email, 200).toLowerCase();
        const userId = email.includes("@") ? await userIdByEmail(email) : null;
        if (!userId) return json({ error: "No account with that email" }, 404);
        const [wallet, sub] = await Promise.all([
          db.from("token_wallets").select("balance").eq("user_id", userId).maybeSingle(),
          db
            .from("subscriptions")
            .select("plan, status, currency, amount, period_end, next_credit_at")
            .eq("user_id", userId)
            .in("status", ["active", "cancelled"])
            .maybeSingle(),
        ]);
        return json({ balance: wallet.data?.balance ?? 0, subscription: sub.data ?? null });
      }

      case "tokens_grant": {
        const email = text(body.email, 200).toLowerCase();
        const amount = Math.round(Number(body.amount) || 0);
        if (!email.includes("@")) return json({ error: "Enter the player's account email" }, 400);
        if (!amount || Math.abs(amount) > 1_000_000) return json({ error: "Enter an amount (negative to deduct)" }, 400);
        const userId = await userIdByEmail(email);
        if (!userId) return json({ error: "No account with that email" }, 404);
        const { data, error } = await db.rpc("admin_grant_tokens", {
          p_user: userId,
          p_amount: amount,
          p_note: text(body.note, 200) || "Admin adjustment",
        });
        if (error) {
          if (String(error.message).includes("insufficient_tokens")) return json({ error: "That would take the balance below 0" }, 400);
          throw error;
        }
        return json({ ok: true, balance: data });
      }

      /* ---- Redeem code → unlimited tokens (developers / admins) ---- */
      case "redeem_info": {
        const [secret, list] = await Promise.all([
          db.from("token_secrets").select("updated_at").eq("key", "redeem_code_hash").maybeSingle(),
          db.from("token_unlimited").select("user_id, email, via, granted_at").order("granted_at", { ascending: false }),
        ]);
        if (list.error) throw list.error;
        return json({ code_set_at: secret.data?.updated_at ?? null, unlimited: list.data ?? [] });
      }

      case "redeem_code_set": {
        const code = text(body.code, 64);
        if (code.length < 6) return json({ error: "Use at least 6 characters" }, 400);
        const { error } = await db.rpc("admin_set_redeem_code", { p_code: code });
        if (error) throw error;
        // optionally make everyone redeem the new code
        if (body.revoke_existing === true) {
          const { error: e2 } = await db.from("token_unlimited").delete().not("user_id", "is", null);
          if (e2) throw e2;
        }
        return json({ ok: true });
      }

      case "unlimited_revoke": {
        const userId = text(body.user_id, 60);
        if (!userId) return json({ error: "Missing user" }, 400);
        const { error } = await db.from("token_unlimited").delete().eq("user_id", userId);
        if (error) throw error;
        return json({ ok: true });
      }

      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : (err as { message?: string })?.message ?? "Server error";
    return json({ error: message }, 400);
  }
});
