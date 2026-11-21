/* Web games live on their own sites: Senevon never plays them inside itself. Opening one opens
   its site (a new tab on the web, the browser from the app), signed in with the player's Senevon
   account when the game supports it (`signIn`). Games with their own Android app (`app`) let
   Android players choose: open in the app (or get it from Play), or open the website. */
import { AppLauncher } from "@capacitor/app-launcher";
import { isNative } from "./native";
import { isAndroidBrowser } from "./appLinks";
import { supabase } from "../supabase";
import type { Game, GameApp } from "../catalog";

export type ExternalGame = Extract<Game, { kind: "iframe" }>;

export const isExternal = (g: Game | undefined): g is ExternalGame => g?.kind === "iframe";

/** Ask "Open in app / Open in web"? Only where an Android app can be opened. */
export function asksForApp(g: ExternalGame): g is ExternalGame & { app: GameApp } {
  return !!g.app && (isNative || isAndroidBrowser());
}

/** A one-time code that signs the player in on the game's site (null: guest or not set up). */
async function signInCode(g: ExternalGame): Promise<string | null> {
  if (!g.signIn || !supabase) return null;
  const { data: s } = await supabase.auth.getSession();
  if (!s.session) return null;
  const { data, error } = await supabase.rpc("create_game_signin", { p_game: g.id });
  return error || typeof data !== "string" ? null : data;
}

/** The game's address, with the sign-in code in the #fragment (never sent to a server). */
function withCode(url: string, code: string | null) {
  return code ? `${url.split("#")[0]}#senevon_code=${code}` : url;
}

/** Open the game's website. Call straight from a click (browsers only allow new tabs then). */
export function openGameWeb(g: ExternalGame) {
  if (isNative) {
    // the app: the browser tab can open after the code arrives
    void signInCode(g).then(async (code) => {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url: withCode(g.embedUrl, code) }).catch(() => window.open(g.embedUrl, "_blank"));
    });
    return;
  }
  // the web: open the tab now (inside the click), point it at the game once the code is ready
  const tab = window.open("about:blank", "_blank");
  void signInCode(g).then((code) => {
    const url = withCode(g.embedUrl, code);
    if (tab) {
      tab.opener = null;
      tab.location.replace(url);
    } else {
      window.location.assign(url); // pop-ups blocked: open it here instead
    }
  });
}

/** Open the game's Android app, or its Play Store page when it isn't installed. */
export function openGameApp(g: ExternalGame & { app: GameApp }) {
  const { androidPackage, scheme, playUrl } = g.app;
  if (isNative) {
    void (async () => {
      let installed = false;
      try {
        installed = (await AppLauncher.canOpenUrl({ url: androidPackage })).value;
      } catch {
        installed = false;
      }
      if (installed) {
        const code = await signInCode(g);
        await AppLauncher.openUrl({ url: withCode(`${scheme}://open`, code) }).catch(() => {});
      } else {
        // the Play Store app, or its web page if that fails
        await AppLauncher.openUrl({ url: `market://details?id=${androidPackage}` }).catch(() =>
          AppLauncher.openUrl({ url: playUrl }),
        );
      }
    })();
    return;
  }
  // Android browsers: Chrome opens the app if it's installed, otherwise the Play Store page.
  // (No sign-in code here: the page leaves before it could arrive.)
  const fallback = encodeURIComponent(playUrl);
  window.location.href = `intent://open#Intent;scheme=${scheme};package=${androidPackage};S.browser_fallback_url=${fallback};end`;
}
