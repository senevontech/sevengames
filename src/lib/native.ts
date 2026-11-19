/* App (Capacitor) runtime: splash screen, status bar, Android back button and the sign-in
   deep link. On the web every function here does nothing. */
import { Capacitor } from "@capacitor/core";
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

let started = false;
export async function initNative() {
  if (!isNative || started) return;
  started = true;
  document.documentElement.classList.add("is-app");
  try {
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: "#121212" });
  } catch {
    /* not available on this device */
  }
  void App.addListener("appUrlOpen", ({ url }) => void handleDeepLink(url));
  // Android back: go back in the app, or leave it from the first page
  void App.addListener("backButton", ({ canGoBack }) => {
    if (canGoBack && window.history.length > 1) window.history.back();
    else void App.exitApp();
  });
  // the first screen is up: hide the splash
  window.setTimeout(() => void SplashScreen.hide({ fadeOutDuration: 250 }), 150);
}
