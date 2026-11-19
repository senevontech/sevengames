import { useEffect, useRef } from "react";
import { requestBanner } from "../lib/admob";
import { isNative } from "../lib/native";
import { Link } from "react-router-dom";
import { ADSENSE_CLIENT, ADSENSE_SLOT, adsenseConfigured, ensureAdsenseScript } from "../lib/adsense";
import { AD_FREE_PRICE, useShowAds } from "../lib/tokens";
import TokenIcon from "./TokenIcon";
import "./ad-slot.css";

/**
 * One responsive AdSense display unit, with an "Advertisement" label and a "Remove ads" link.
 * Renders nothing when AdSense isn't configured, or for ad-free players (and while their status
 * is still loading, so an ad never flashes up for someone who paid to remove them).
 */
export default function AdSlot({ placement, className = "" }: { placement: string; className?: string }) {
  const showAds = useShowAds();
  // the app: AdMob's native banner at the bottom of the screen while this page is open
  useEffect(() => {
    if (!isNative || !showAds) return;
    void requestBanner(true);
    return () => void requestBanner(false);
  }, [showAds]);
  const show = showAds && adsenseConfigured && !isNative;
  const insRef = useRef<HTMLModElement>(null);

  useEffect(() => {
    if (!show) return;
    ensureAdsenseScript();
    const ins = insRef.current;
    // React may run effects twice in development: only fill an empty slot once
    if (!ins || ins.getAttribute("data-adsbygoogle-status")) return;
    try {
      const w = window as unknown as { adsbygoogle?: unknown[] };
      (w.adsbygoogle = w.adsbygoogle || []).push({});
    } catch {
      /* blocked by an ad blocker, or not ready: leave the space empty */
    }
  }, [show]);

  if (!show) return null;
  return (
    <aside className={`ad-slot ${className}`.trim()} aria-label="Advertisement" data-placement={placement}>
      <div className="ad-slot-top">
        <span className="ad-slot-label">Advertisement</span>
        <Link className="ad-slot-remove" to="/tokens#adfree">
          Remove ads · <TokenIcon size={12} /> {AD_FREE_PRICE}/month
        </Link>
      </div>
      <ins
        ref={insRef}
        className="adsbygoogle"
        style={{ display: "block" }}
        data-ad-client={ADSENSE_CLIENT}
        data-ad-slot={ADSENSE_SLOT}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </aside>
  );
}
