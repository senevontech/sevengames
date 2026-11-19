import { useEffect, useRef, useState } from "react";
import { ADSENSE_CLIENT, ADSENSE_SLOT, adsenseConfigured, ensureAdsenseScript } from "../lib/adsense";

/** Banner size for the screen: 728×90 on wide screens, the standard 320×50 on phones. */
function useBannerSize() {
  const query = "(min-width: 768px)";
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide ? { w: 728, h: 90 } : { w: 320, h: 50 };
}

/**
 * Banner ad under the game's start screen (web: Google AdSense). The space is reserved at a
 * fixed size so nothing jumps when the ad loads. In development, without AdSense set up, it
 * shows a faint placeholder so the space is visible. The game page decides when it shows
 * (start screen only, never for ad-free players, never in the app: AdMob covers that there).
 */
export default function StartAd() {
  const { w, h } = useBannerSize();
  return (
    <aside className="gp-ad" aria-label="Advertisement" style={{ "--ad-w": `${w}px`, "--ad-h": `${h}px` } as React.CSSProperties}>
      {adsenseConfigured ? (
        <AdUnit key={`${w}x${h}`} w={w} h={h} />
      ) : import.meta.env.DEV ? (
        <span className="gp-ad-placeholder">
          Ad space · {w}×{h}
        </span>
      ) : null}
    </aside>
  );
}

function AdUnit({ w, h }: { w: number; h: number }) {
  const ref = useRef<HTMLModElement>(null);
  useEffect(() => {
    ensureAdsenseScript();
    const ins = ref.current;
    // React may run effects twice in development: only fill an empty slot once
    if (!ins || ins.getAttribute("data-adsbygoogle-status")) return;
    try {
      const win = window as unknown as { adsbygoogle?: unknown[] };
      (win.adsbygoogle = win.adsbygoogle || []).push({});
    } catch {
      /* blocked by an ad blocker, or not ready: the space stays empty */
    }
  }, []);
  return (
    <ins
      ref={ref}
      className="adsbygoogle"
      style={{ display: "inline-block", width: w, height: h }}
      data-ad-client={ADSENSE_CLIENT}
      data-ad-slot={ADSENSE_SLOT}
    />
  );
}
