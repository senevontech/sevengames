/* App (Capacitor) runtime: splash screen, status bar, Android back button and the sign-in
   deep link. On the web every function here does nothing. */
import { Capacitor, registerPlugin } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";
import { supabase } from "../supabase";

export const isNative = Capacitor.isNativePlatform();
export const APP_SCHEME = "com.senevon.games";
/** Where Google sign-in returns to in the app (add it to Supabase → Auth → Redirect URLs). */
export const NATIVE_AUTH_REDIRECT = `${APP_SCHEME}://auth/callback`;

/** Navigate the single-page app from outside React (deep links). */
function go(path: string) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** Google sign-in inside the app: open Google in an in-app browser tab, come back by deep link. */
export async function nativeGoogleSignIn() {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: NATIVE_AUTH_REDIRECT, skipBrowserRedirect: true },
  });
  if (error) throw error;
  if (data?.url) await Browser.open({ url: data.url, presentationStyle: "popover" });
}

async function handleDeepLink(url: string) {
  if (!url.startsWith(`${APP_SCHEME}://`)) return;
  const u = new URL(url.replace(`${APP_SCHEME}://`, "https://app/"));
  if (u.pathname === "/auth/callback" && supabase) {
    const code = u.searchParams.get("code");
    if (code) await supabase.auth.exchangeCodeForSession(code);
    void Browser.close().catch(() => {});
    const redirect = window.sessionStorage.getItem("7games:redirect") || "/";
    window.sessionStorage.removeItem("7games:redirect");
    go(redirect);
    return;
  }
  // any other link into the app: open that page (e.g. com.senevon.games://game/chess)
  go(u.pathname + u.search);
}

/* ---------- status bar: looks see-through ----------
   The status bar takes the colour of whatever the page shows at the very top (the light or dark
   theme, a game's own background…), and its clock / battery icons turn dark on light pages and
   light on dark ones. Re-checked on navigation, on theme changes and every couple of seconds. */
function parseRgb(c: string): [number, number, number, number] | null {
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
}

/** The solid colour behind the top edge of the screen. */
/* android/app/src/main/java/com/senevon/games/BarsPlugin.java: paints the strips behind the
   status bar and navigation bar (Android 15+ ignores StatusBar.setBackgroundColor). */
const Bars = registerPlugin<{
  setColors(o: { top: string; bottom: string; darkTopIcons: boolean; darkBottomIcons: boolean }): Promise<void>;
}>("Bars");

function colorAt(y: number): [number, number, number] {
  let el: Element | null = document.elementFromPoint(window.innerWidth / 2, y);
  while (el) {
    const rgb = parseRgb(getComputedStyle(el).backgroundColor);
    if (rgb && rgb[3] > 0.6) return [rgb[0], rgb[1], rgb[2]];
    el = el.parentElement;
  }
  const body = parseRgb(getComputedStyle(document.body).backgroundColor);
  return body && body[3] > 0.6 ? [body[0], body[1], body[2]] : [18, 18, 18];
}

const hex = (rgb: number[]) => "#" + rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
let lastBar = "";

const isLight = (rgb: number[]) => (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255 > 0.55;

async function syncStatusBar() {
  if (document.visibilityState !== "visible") return;
  const rgb = colorAt(1);
  const low = colorAt(window.innerHeight - 1);
  const color = hex(rgb);
  const bottom = hex(low);
  if (color + bottom === lastBar) return;
  lastBar = color + bottom;
  const light = isLight(rgb);
  try {
    await Bars.setColors({ top: color, bottom, darkTopIcons: light, darkBottomIcons: isLight(low) });
    return;
  } catch {
    /* older app build without the plugin: fall back to the status bar plugin */
  }
  try {
    // Style.Light = dark icons (for light backgrounds), Style.Dark = light icons
    await StatusBar.setStyle({ style: light ? Style.Light : Style.Dark });
    await StatusBar.setBackgroundColor({ color });
  } catch {
    /* not available on this device */
  }
}

function startStatusBarSync() {
  let t = 0;
  const soon = (ms = 60) => {
    window.clearTimeout(t);
    t = window.setTimeout(() => void syncStatusBar(), ms);
  };
  // page changes (React Router uses pushState / replaceState)
  for (const k of ["pushState", "replaceState"] as const) {
    const orig = history[k].bind(history);
    history[k] = ((...args: Parameters<History["pushState"]>) => {
      orig(...args);
      soon(120);
    }) as History["pushState"];
  }
  window.addEventListener("popstate", () => soon(120));
  // light / dark switch
  new MutationObserver(() => soon()).observe(document.body, { attributes: true, subtree: true, attributeFilter: ["data-theme", "data-gtheme"] });
  document.addEventListener("visibilitychange", () => {
    lastBar = "";
    soon();
  });
  // anything else (pages that paint their own background a moment later)
  window.setInterval(() => void syncStatusBar(), 2000);
  soon(300);
}

let started = false;
export async function initNative() {
  if (!isNative || started) return;
  started = true;
  document.documentElement.classList.add("is-app");
  startStatusBarSync();
  void App.addListener("appUrlOpen", ({ url }) => void handleDeepLink(url));
  // Android back: go back in the app, or leave it from the first page
  void App.addListener("backButton", ({ canGoBack }) => {
    if (canGoBack && window.history.length > 1) window.history.back();
    else void App.exitApp();
  });
  // the first screen is up: hide the splash
  window.setTimeout(() => void SplashScreen.hide({ fadeOutDuration: 250 }), 150);
}

/** Open an outside website: the app uses the in-app browser tab, the web a new tab/window. */
export function openExternal(url: string) {
  if (isNative) {
    void Browser.open({ url }).catch(() => window.open(url, "_blank"));
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
