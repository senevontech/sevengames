/* Google AdSense setup, read from build-time settings (Render → Environment, or .env.local):
     VITE_ADSENSE_CLIENT = ca-pub-XXXXXXXXXXXXXXXX   (AdSense → Account → Settings → Account information)
     VITE_ADSENSE_SLOT   = 1234567890                (AdSense → Ads → By ad unit → a responsive display unit)
   With no client ID set, no ads load and every ad slot renders nothing.
   The AdSense script itself is added to index.html at build time (vite.config.ts), so
   Google's site checks see it; ads.txt is generated there too. */

const raw = (import.meta.env.VITE_ADSENSE_CLIENT as string | undefined)?.trim() ?? "";
export const ADSENSE_CLIENT = /^ca-pub-\d{10,20}$/.test(raw) ? raw : "";
export const ADSENSE_SLOT = ((import.meta.env.VITE_ADSENSE_SLOT as string | undefined) ?? "").trim();
export const adsenseConfigured = Boolean(ADSENSE_CLIENT && /^\d{6,20}$/.test(ADSENSE_SLOT));

/** In dev (no build-time injection) make sure the script is on the page. */
export function ensureAdsenseScript() {
  if (!ADSENSE_CLIENT || typeof document === "undefined") return;
  if (document.querySelector('script[src*="pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"]')) return;
  const s = document.createElement("script");
  s.async = true;
  s.crossOrigin = "anonymous";
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`;
  document.head.appendChild(s);
}
