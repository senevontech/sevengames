import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { Check, Crown, ShieldCheck, X } from "./anim-icons";
import TokenIcon from "./TokenIcon";
import { useAuthContext } from "../context/AuthContext";
import { tokenErrorText, usePlanPrices, useShowAds, useTokens } from "../lib/tokens";
import { formatMoney, formatTokens, pickCurrency } from "../lib/currency";
import { isNative } from "../lib/native";
import { ADFREE_PRODUCT, PLUS_PRODUCT, buySubscription, loadPlayPrices, playErrorText, type PlayPrices } from "../lib/playBilling";
import { markPromoShown, onAdFreePromo, snoozePromo, type PromoSource } from "../lib/adFreePromo";
import "../pages/tokens.css";
import "./adfree-promo.css";

const HEADLINE: Record<PromoSource, string> = {
  reward_ad: "Tired of ads?",
  game_end: "Play without interruptions",
  settings: "Remove ads",
};

/**
 * The "Go ad-free" popup, mounted once for the whole app. Anything can ask for it with
 * promptAdFree() (lib/adFreePromo.ts). It sells Senevon Plus (ad-free + monthly tokens) and the
 * ad-free pass, and never shows to players who are already ad-free.
 */
export default function AdFreePromo() {
  const showAds = useShowAds();
  const showAdsRef = useRef(showAds);
  showAdsRef.current = showAds;
  const [source, setSource] = useState<PromoSource | null>(null);

  useEffect(
    () =>
      onAdFreePromo((src) => {
        if (!showAdsRef.current) return; // ad-free already, or not known yet
        if (src !== "settings") markPromoShown();
        setSource(src);
      }),
    [],
  );

  // became ad-free some other way (or signed in as someone who is): nothing to sell
  useEffect(() => {
    if (!showAds) setSource(null);
  }, [showAds]);

  if (!source) return null;
  return <PromoCard source={source} onClose={() => setSource(null)} />;
}

type Done = { text: string };

function PromoCard({ source, onClose }: { source: PromoSource; onClose: () => void }) {
  const { user } = useAuthContext();
  const { wallet, subscribe, refresh } = useTokens();
  const navigate = useNavigate();
  const location = useLocation();
  const [plan, setPlan] = useState<"monthly" | "yearly">("yearly");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  // web prices (Razorpay / test checkout) and, in the app, Google Play's local prices
  const prices = usePlanPrices();
  const [play, setPlay] = useState<PlayPrices | null>(null);
  useEffect(() => {
    if (isNative) void loadPlayPrices().then(setPlay);
  }, []);
  const currency = useMemo(() => pickCurrency([...new Set(prices.map((p) => p.currency))]), [prices]);
  const webPrice = (p: "monthly" | "yearly") => prices.find((r) => r.currency === currency && r.plan === p)?.amount;
  const monthly = webPrice("monthly");
  const yearly = webPrice("yearly");
  const savePct = monthly && yearly ? Math.round((1 - yearly / (monthly * 12)) * 100) : 0;

  const plusLabel = (p: "monthly" | "yearly") => {
    if (isNative) return play?.plus[p] ?? null;
    const a = webPrice(p);
    return a === undefined ? null : formatMoney(a, currency);
  };
  const plusPrice = plusLabel(plan);
  const hasPlus = isNative ? Boolean(play?.plus.monthly || play?.plus.yearly) : prices.length > 0;
  const mock = !isNative && (wallet?.payments_mode ?? "mock") === "mock";
  const perMonth = wallet?.sub_tokens ?? 5000;
  // the ad-free pass needs the server side (adfree.sql); guests see it as an option anyway

  // Esc closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function run(action: () => Promise<unknown>, success: string, errText: (err: unknown) => string = tokenErrorText) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setDone({ text: success });
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  const buyPlus = () => {
    if (!user) return;
    const success = `You're ad-free, and ${formatTokens(perMonth)} chips are on their way.`;
    if (isNative) {
      void run(
        async () => {
          await buySubscription(PLUS_PRODUCT, plan, user.id);
          await refresh();
        },
        success,
        playErrorText,
      );
    } else {
      void run(() => subscribe(plan, currency), success);
    }
  };

  const buyPlayAdFree = () => {
    if (!user) return;
    void run(
      async () => {
        await buySubscription(ADFREE_PRODUCT, "monthly", user.id);
        await refresh();
      },
      "You're ad-free! Renews monthly on Google Play.",
      playErrorText,
    );
  };

  const signIn = () => {
    onClose();
    navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
  };

  const noThanks = () => {
    if (source !== "settings") snoozePromo();
    onClose();
  };

  return createPortal(
    <div className="tk-modal afp" role="dialog" aria-modal="true" aria-labelledby="afp-title" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="tk-modal-card afp-card">
        <button type="button" className="tk-modal-x" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>

        {done ? (
          <div className="tk-modal-center">
            <span className="afp-badge" aria-hidden="true">
              <ShieldCheck size={30} />
            </span>
            <h3>You're ad-free!</h3>
            <p>{done.text}</p>
            <button type="button" className="tk-btn tk-btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
        ) : (
          <>
            <header className="afp-head">
              <span className="afp-badge" aria-hidden="true">
                <ShieldCheck size={26} />
              </span>
              <h3 id="afp-title">{HEADLINE[source]}</h3>
              <p>Go ad-free: no banners, ad breaks or video ads anywhere on Senevon.</p>
            </header>

            {/* ---------- Senevon Plus ---------- */}
            {hasPlus ? (
              <section className="afp-opt afp-plus" aria-label="Senevon Plus">
                <div className="afp-opt-top">
                  <b>
                    <Crown size={16} aria-hidden="true" /> Senevon Plus
                  </b>
                  <span className="afp-flag">Best value</span>
                </div>
                <ul className="afp-perks">
                  <li>
                    <Check size={14} aria-hidden="true" /> No ads, ever
                  </li>
                  <li>
                    <Check size={14} aria-hidden="true" /> <TokenIcon size={13} /> {formatTokens(perMonth)} chips every month
                  </li>
                  <li>
                    <Check size={14} aria-hidden="true" /> Cancel any time
                  </li>
                </ul>
                <div className="afp-plans" role="radiogroup" aria-label="Billing period">
                  {(["monthly", "yearly"] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      role="radio"
                      aria-checked={plan === p}
                      className={`afp-plan${plan === p ? " is-on" : ""}`}
                      disabled={!plusLabel(p)}
                      onClick={() => setPlan(p)}
                    >
                      <span>{p === "monthly" ? "Monthly" : "Yearly"}</span>
                      <b>{plusLabel(p) ?? "—"}</b>
                      {p === "yearly" && savePct > 0 && !isNative ? <i>Save {savePct}%</i> : null}
                    </button>
                  ))}
                </div>
                {user ? (
                  <button type="button" className="tk-btn tk-btn-primary afp-cta" disabled={busy || !plusPrice} onClick={buyPlus}>
                    {busy ? "Processing…" : `Get Plus · ${plusPrice ?? "…"}/${plan === "monthly" ? "month" : "year"}${mock ? " (test)" : ""}`}
                  </button>
                ) : null}
              </section>
            ) : null}

            {/* ---------- app only: Google Play's ad-free subscription (real money; never chips) ---------- */}
            {isNative && user && play?.adfree ? (
              <section className="afp-opt" aria-label="Ad-free plan">
                <div className="afp-opt-top">
                  <b>
                    <ShieldCheck size={16} aria-hidden="true" /> Ad-free only
                  </b>
                </div>
                <p className="afp-opt-sub">No ads, renews monthly on Google Play. Cancel any time.</p>
                <div className="afp-row">
                  <button type="button" className="tk-btn" disabled={busy} onClick={buyPlayAdFree}>
                    {play.adfree}/month
                  </button>
                </div>
              </section>
            ) : null}

            {user && !hasPlus ? <p className="afp-hint afp-center">Ad-free plans aren't available yet. Check back soon.</p> : null}

            {error ? (
              <p className="afp-error" role="alert">
                {error}
              </p>
            ) : null}

            {!user ? (
              <button type="button" className="tk-btn tk-btn-primary afp-cta" onClick={signIn}>
                Sign in to go ad-free
              </button>
            ) : null}

            {mock && user ? <p className="afp-hint afp-center">Test mode: no real payment is taken.</p> : null}

            <button type="button" className="afp-skip" onClick={noThanks}>
              {source === "settings" ? "Not now" : "No thanks"}
            </button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
