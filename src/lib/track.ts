/* Analytics: page views and game plays, sent to track_event() (supabase/analytics.sql), which
   only keeps events from the live site (games.senevon.in) or the Android app, drops bots and
   excluded devices, and rate-limits. On top of that, this file never sends from:
     - the dev server (npm run dev) or any other host than the live site
     - Android builds that aren't release builds (see `npm run cap:sync:release`)
     - a device that has logged into the admin panel (excludeThisDevice)
     - automated browsers */
import { supabase } from "../supabase";
import { loadSettings } from "./siteSettings";
import { isNative } from "./native";

const VISITOR_KEY = "7games:visitor";
const NO_TRACK_KEY = "senevon:no-track";
/** The public website. Other hosts (localhost, previews) never send. */
const LIVE_HOSTS = ["games.senevon.in"];
/** Android: only release builds count (VITE_RELEASE=1, set by `npm run cap:sync:release`). */
const RELEASE = import.meta.env.VITE_RELEASE === "1";

let memoryId: string | null = null;

function visitorId(): string {
  try {
    let id = localStorage.getItem(VISITOR_KEY);
    if (!id || id.length < 8) {
      id = crypto.randomUUID();
      localStorage.setItem(VISITOR_KEY, id);
    }
    return id;
  } catch {
    // storage blocked: one id for this visit (not a new one per event)
    memoryId ??= "anon-" + Math.random().toString(36).slice(2, 14);
    return memoryId;
  }
}

/** This device's visitor id (the admin panel uses it to exclude the device). */
export const thisVisitorId = visitorId;

/** Stop counting this device (the admin panel calls this after logging in). */
export function excludeThisDevice(on = true) {
  try {
    if (on) localStorage.setItem(NO_TRACK_KEY, "1");
    else localStorage.removeItem(NO_TRACK_KEY);
  } catch {
    /* storage blocked */
  }
}

export function isDeviceExcluded() {
  try {
    return localStorage.getItem(NO_TRACK_KEY) === "1";
  } catch {
    return false;
  }
}

/** Should this page load count at all? */
function countable() {
  if (import.meta.env.DEV) return false;
  if (isNative) {
    if (!RELEASE) return false;
  } else if (!LIVE_HOSTS.includes(location.hostname)) {
    return false;
  }
  if (isDeviceExcluded()) return false;
  const nav = navigator as Navigator & { webdriver?: boolean };
  if (nav.webdriver) return false;
  if (/bot|crawl|spider|slurp|headless|lighthouse|pagespeed|prerender/i.test(navigator.userAgent)) return false;
  return true;
}

function deviceKind(): string {
  const w = window.innerWidth;
  return w < 640 ? "mobile" : w < 1024 ? "tablet" : "desktop";
}

type EventType = "pageview" | "game_start" | "game_finish";

async function send(row: { type: EventType; path?: string; game_id?: string; score?: number; referrer?: string | null }) {
  if (!supabase || !countable()) return;
  const settings = await loadSettings();
  if (!settings.tracking_enabled) return;
  try {
    await supabase.rpc("track_event", {
      p_visitor: visitorId(),
      p_type: row.type,
      p_path: row.path ?? null,
      p_game: row.game_id ?? null,
      p_score: row.score ?? null,
      p_referrer: row.referrer ?? null,
      p_device: deviceKind(),
    });
  } catch {
    /* analytics must never break the app */
  }
}

let lastPath = "";

export function trackPageview(path: string) {
  if (path.startsWith("/admin") || path === lastPath) return;
  const first = lastPath === "";
  lastPath = path;
  let referrer: string | null = null;
  if (first && document.referrer) {
    try {
      // Ignore self-referrals
      if (new URL(document.referrer).host !== location.host) referrer = document.referrer.slice(0, 300);
    } catch {
      /* ignore */
    }
  }
  void send({ type: "pageview", path: path.slice(0, 200), referrer });
}

export function trackGame(type: "game_start" | "game_finish", gameId: string, score?: number) {
  void send({ type, game_id: gameId, path: `/game/${gameId}`, score: score ?? undefined });
}

export function trackAd(adId: string, kind: "impression" | "click") {
  if (!supabase || !countable()) return;
  void Promise.resolve(
    supabase.rpc("record_ad_event", {
      p_ad: adId,
      p_kind: kind,
      p_visitor: visitorId(),
      p_path: location.pathname,
    }),
  ).catch(() => undefined);
}
