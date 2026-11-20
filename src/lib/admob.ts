/* AdMob in the Android app: a banner at the bottom while a page with an ad slot is open,
   an interstitial after every 3rd finished game, and rewarded ads for tokens.

   Rewarded ads are credited on the server only: AdMob calls the `admob-ssv` Edge Function with a
   signed callback carrying the player's id and the ad view id (server-side verification).
   With Google's test ad units (the defaults until real ids are set) there's no callback, so in
   that case the app claims the reward itself the same way the website does.

   Ad unit ids come from build-time settings (.env / .env.app):
     VITE_ADMOB_BANNER, VITE_ADMOB_INTERSTITIAL, VITE_ADMOB_REWARDED
   The AdMob *app* id goes in android/app/src/main/AndroidManifest.xml. */
import { AdMob, BannerAdPosition, BannerAdSize } from "@capacitor-community/admob";
import { supabase } from "../supabase";
import { isNative } from "./native";
import { isOnline } from "./online";

// Google's public test units (safe to use while developing)
const TEST = {
  banner: "ca-app-pub-3940256099942544/6300978111",
  interstitial: "ca-app-pub-3940256099942544/1033173712",
  rewarded: "ca-app-pub-3940256099942544/5224354917",
};
const env = import.meta.env;
const UNITS = {
  banner: (env.VITE_ADMOB_BANNER as string | undefined) || TEST.banner,
  interstitial: (env.VITE_ADMOB_INTERSTITIAL as string | undefined) || TEST.interstitial,
  rewarded: (env.VITE_ADMOB_REWARDED as string | undefined) || TEST.rewarded,
};
const testing = UNITS.rewarded === TEST.rewarded;
const INTERSTITIAL_EVERY = 3;

let ready: Promise<boolean> | null = null;
export function initAdMob(): Promise<boolean> {
  if (!isNative) return Promise.resolve(false);
  ready ??= AdMob.initialize({ initializeForTesting: testing })
    .then(() => true)
    .catch(() => false);
  return ready;
}

/* ---------- banner (one at a time, shown while any slot wants it) ---------- */
let wanted = 0;
let showing = false;
export async function requestBanner(on: boolean) {
  wanted = Math.max(0, wanted + (on ? 1 : -1));
  if (!(await initAdMob())) return;
  try {
    if (wanted > 0 && !showing && isOnline()) {
      showing = true;
      await AdMob.showBanner({ adId: UNITS.banner, adSize: BannerAdSize.ADAPTIVE_BANNER, position: BannerAdPosition.BOTTOM_CENTER, margin: 0, isTesting: testing });
      document.documentElement.classList.add("has-app-banner");
    } else if (wanted === 0 && showing) {
      showing = false;
      await AdMob.removeBanner();
      document.documentElement.classList.remove("has-app-banner");
    }
  } catch {
    showing = false;
    document.documentElement.classList.remove("has-app-banner");
  }
}

/* ---------- interstitial after every few games ---------- */
export async function gameFinishedAd() {
  if (!(await initAdMob()) || !isOnline()) return;
  let n = 0;
  try {
    n = Number(localStorage.getItem("senevon:games-since-ad") || 0) + 1;
    localStorage.setItem("senevon:games-since-ad", String(n >= INTERSTITIAL_EVERY ? 0 : n));
  } catch {
    /* storage unavailable */
  }
  if (n < INTERSTITIAL_EVERY) return;
  try {
    await AdMob.prepareInterstitial({ adId: UNITS.interstitial, isTesting: testing });
    // let the result screen show first
    window.setTimeout(() => void AdMob.showInterstitial().catch(() => {}), 1200);
  } catch {
    /* no fill / offline */
  }
}

/* ---------- rewarded ad for tokens ---------- */

/** Show a rewarded ad. Resolves "rewarded" once the server has the reward (or "skipped"). */
export async function watchRewarded(userId: string): Promise<"rewarded" | "skipped"> {
  if (!supabase || !(await initAdMob())) throw new Error("ads_unavailable");
  const { data: viewId, error } = await supabase.rpc("start_ad_view", { p_source: "network", p_ad: null });
  if (error) throw new Error(error.message);
  const before = await balance();
  try {
    await AdMob.prepareRewardVideoAd({ adId: UNITS.rewarded, isTesting: testing, ssv: { userId, customData: String(viewId) } });
  } catch (e) {
    // no ad to show (no fill, account not approved yet, ad unit still new, network)
    console.warn("AdMob rewarded failed to load:", (e as { message?: string })?.message ?? e);
    throw new Error("ad_no_fill");
  }
  let earned = false;
  try {
    await AdMob.showRewardVideoAd();
    earned = true;
  } catch {
    earned = false;
  }
  if (!earned) return "skipped";
  if (testing) {
    // test units have no server callback: claim it like the website (minimum watch time applies)
    const { error: claimErr } = await supabase.rpc("claim_ad_reward", { p_view: viewId });
    return claimErr ? "skipped" : "rewarded";
  }
  // wait for AdMob's server callback (admob-ssv) to credit it — usually a second or two
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => window.setTimeout(r, 1000));
    if ((await balance()) > before) return "rewarded";
  }
  // No callback (server-side verification not set up on the ad unit, or AdMob is slow): claim it
  // the way the website does. Both paths lock and mark the same ad view, so it's never paid twice.
  console.warn("AdMob SSV callback didn't arrive in time; claiming the reward from the app");
  for (let attempt = 0; attempt < 2; attempt++) {
    const { error: claimErr } = await supabase.rpc("claim_ad_reward", { p_view: viewId });
    if (!claimErr || claimErr.message.includes("already_claimed")) return "rewarded";
    // a very short ad: the server's minimum watch time isn't up yet — wait it out once
    if (claimErr.message.includes("ad_not_finished") && attempt === 0) {
      await new Promise((r) => window.setTimeout(r, 8000));
      continue;
    }
    throw new Error(claimErr.message);
  }
  return "skipped";
}

async function balance() {
  if (!supabase) return 0;
  const { data } = await supabase.rpc("token_wallet");
  return Number((data as { balance?: number } | null)?.balance ?? 0);
}
