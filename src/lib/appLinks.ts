/* Where to get the mobile app (website only — none of this shows inside the app).
   Update these when the store listings / file change. */

/** Google Play listing (the app id is fixed: com.senevon.games). */
export const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.senevon.games";

/** Direct APK download, for phones without Google Play. Put the signed release APK at
 *  public/download/senevon-games.apk (or set VITE_APK_URL to wherever it's hosted). */
export const APK_URL = (import.meta.env.VITE_APK_URL as string | undefined)?.trim() || "/download/senevon-games.apk";

/** Shown next to the APK button. */
export const APK_NOTE = "Android 7.0 or newer";

/** The download page on the website. */
export const GET_APP_PATH = "/app";

/** An Android phone or tablet browsing the website (not the app itself). */
export const isAndroidBrowser = () => typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);

/** iPhone / iPad (iPadOS reports itself as a Mac with touch). */
export const isIosBrowser = () =>
  typeof navigator !== "undefined" &&
  (/iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
