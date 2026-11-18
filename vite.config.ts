import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "VITE_");
  const client = (env.VITE_ADSENSE_CLIENT ?? "").trim();
  return {
    plugins: [react(), adsense(/^ca-pub-\d{10,20}$/.test(client) ? client : null)],
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
