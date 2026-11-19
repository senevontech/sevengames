import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { useLiveAds } from "../lib/ads";
import { useSiteSettings } from "../lib/siteSettings";
import { trackAd } from "../lib/track";

/**
 * Sponsored box. Rotates through the currently eligible ads.
 * `variant="card"` is the compact hero side-card; `fallback` renders when no ad is live.
 */
export default function AdBox({
  variant = "banner",
  fallback = null,
}: {
  variant?: "banner" | "card";
  fallback?: ReactNode;
}) {
  const settings = useSiteSettings();
  const ads = useLiveAds("banner");
  const [index, setIndex] = useState(0);
  const seen = useRef(new Set<string>());

  const ad = ads.length ? ads[index % ads.length] : null;

  // Count one impression per ad per page view.
  useEffect(() => {
    if (!ad || !settings.ads_enabled || seen.current.has(ad.id)) return;
    seen.current.add(ad.id);
    trackAd(ad.id, "impression");
  }, [ad, settings.ads_enabled]);

  useEffect(() => {
    if (ads.length < 2) return;
    const id = window.setInterval(
      () => setIndex((i) => (i + 1) % ads.length),
      Math.max(2, settings.ad_rotate_seconds) * 1000,
    );
    return () => window.clearInterval(id);
  }, [ads.length, settings.ad_rotate_seconds]);

  if (!settings.ads_enabled || !ad) return <>{fallback}</>;

  if (variant === "card") {
    return (
      <a
        className="promo promo-ad"
        href={ad.link_url}
        target="_blank"
        rel="noopener noreferrer sponsored"
        aria-label={`Sponsored: ${ad.title}`}
        onClick={() => trackAd(ad.id, "click")}
      >
        {ad.cover_url ? <img className="promo-bg" src={ad.cover_url} alt="" loading="lazy" decoding="async" /> : null}
        <span className="promo-tag">Sponsored</span>
        <span className="promo-text">
          <strong>{ad.title}</strong>
          <small>{ad.body || ad.cta_label}</small>
        </span>
        <span className="promo-go" aria-hidden="true">
          <ArrowRight size={16} />
        </span>
      </a>
    );
  }

  return (
    <aside className="ad-box" aria-label="Sponsored">
      <a
        className="ad-link"
        href={ad.link_url}
        target="_blank"
        rel="noopener noreferrer sponsored"
        onClick={() => trackAd(ad.id, "click")}
      >
        {ad.cover_url ? (
          <img className="ad-cover" src={ad.cover_url} alt="" loading="lazy" />
        ) : (
          <div className="ad-cover ad-cover-empty" />
        )}
        <div className="ad-body">
          {ad.thumb_url ? <img className="ad-thumb" src={ad.thumb_url} alt="" loading="lazy" /> : null}
          <div className="ad-text">
            <span className="ad-tag">Sponsored</span>
            <strong>{ad.title}</strong>
            {ad.body ? <p>{ad.body}</p> : null}
          </div>
          <span className="ad-cta">{ad.cta_label}</span>
        </div>
      </a>
      {ads.length > 1 ? (
        <div className="ad-dots" aria-hidden="true">
          {ads.map((a, i) => (
            <span key={a.id} className={i === index % ads.length ? "on" : ""} />
          ))}
        </div>
      ) : null}
    </aside>
  );
}
