import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { rmSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Google AdSense, only when VITE_ADSENSE_CLIENT (ca-pub-…) is set at build time:
 *  - puts the AdSense script + the site-verification meta tag in index.html (Google's checks
 *    read the page source)
 *  - writes /ads.txt with the publisher line
 * Keep AdSense "Auto ads" OFF: the site places its own ad units, away from the games.
 */
function adsense(client: string | null): Plugin {
  return {
    name: "senevon-adsense",
    transformIndexHtml(html) {
      if (!client) return html;
      return html.replace(
        "</head>",
        `    <meta name="google-adsense-account" content="${client}" />\n` +
          `    <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}" crossorigin="anonymous"></script>\n` +
          "  </head>",
      );
    },
    generateBundle() {
      if (!client) return;
      this.emitFile({
        type: "asset",
        fileName: "ads.txt",
        source: `google.com, ${client.replace(/^ca-/, "")}, DIRECT, f08c47fec0942fa0\n`,
      });
    },
  };
}

/**
 * App build only: drop viewport-fit=cover. Android 15+ runs apps edge-to-edge, and with "cover"
 * Capacitor lays the WebView under the status bar (clock, battery) and gesture bar. Without it,
 * Capacitor's SystemBars pads the WebView natively so the UI starts below the status bar.
 */
function appViewport(isApp: boolean): Plugin {
  return {
    name: "senevon-app-viewport",
    transformIndexHtml(html) {
      return isApp ? html.replace(/,\s*viewport-fit=cover/, "") : html;
    },
  };
}

/** App build: drop public/download (the website's APK) so the app doesn't carry a copy of itself. */
function dropDownloads(isApp: boolean): Plugin {
  return {
    name: "senevon-drop-downloads",
    apply: "build",
    closeBundle() {
      if (isApp) rmSync(resolve("dist", "download"), { recursive: true, force: true });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "VITE_");
  // the Android app ("--mode app") never loads AdSense (apps use AdMob instead)
  const client = mode === "app" ? "" : (env.VITE_ADSENSE_CLIENT ?? "").trim();
  return {
    plugins: [react(), appViewport(mode === "app"), dropDownloads(mode === "app"), adsense(/^ca-pub-\d{10,20}$/.test(client) ? client : null)],
    build: {
      outDir: "dist",
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ["react", "react-dom", "react-router-dom"],
            supabase: ["@supabase/supabase-js"],
          },
        },
      },
    },
  };
});
