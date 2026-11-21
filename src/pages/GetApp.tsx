/* "Get the app" page (website only — the app redirects away from it).
   Google Play first, a direct APK for phones without Play, and iOS marked as coming soon. */
import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { ArrowRight, ChevronDown, Download, Gauge, Smartphone, UserRound, WifiOff } from "lucide-react";
import { isNative } from "../lib/native";
import { APK_NOTE, APK_URL, PLAY_STORE_URL, isAndroidBrowser, isIosBrowser } from "../lib/appLinks";
import { AppleGlyph, PlayGlyph } from "../components/StoreGlyphs";
import SoftPage from "../components/SoftPage";
import "./get-app.css";

const FEATURES = [
  { Icon: WifiOff, title: "Plays offline", text: "Built-in games work with no connection. Scores sync when you're back online." },
  { Icon: Gauge, title: "Faster & full screen", text: "Opens straight into your games: no browser bars, no waiting." },
  { Icon: UserRound, title: "Same account", text: "Your tokens, levels, shop items and friends come with you." },
  { Icon: Smartphone, title: "Light on your phone", text: `A small download that runs smoothly on most phones (${APK_NOTE}).` },
];

const APK_STEPS = [
  "Tap Download APK above.",
  "Open the downloaded file (from the notification or your Downloads folder).",
  "If Android asks, allow your browser to install apps (Settings → Install unknown apps).",
  "Tap Install, then Open. Updates come from this page, so check back for new versions, or use Google Play for automatic updates.",
];

export default function GetApp() {
  const [platform] = useState(() => (isAndroidBrowser() ? "android" : isIosBrowser() ? "ios" : "desktop"));

  useEffect(() => {
    const prev = document.title;
    document.title = "Get the app — Senevon Game Studio";
    return () => {
      document.title = prev;
    };
  }, []);

  // the app itself never shows its own download page
  if (isNative) return <Navigate to="/" replace />;

  return (
    <SoftPage>
    <main className="ga">
      <section className="ga-hero">
        <div className="ga-copy">
          <p className="ga-kicker">Senevon for mobile</p>
          <h1 className="ga-title">
            Your games,
            <br />
            in your pocket.
          </h1>
          <p className="ga-sub">
            Every Senevon game in one app: carrom, chess, ludo, arrows and more. Play offline, pick up where you left off and
            keep your tokens and progress.
          </p>

          <div className="ga-buttons">
            <a className="ga-store ga-store-play" href={PLAY_STORE_URL} target="_blank" rel="noopener noreferrer">
              <PlayGlyph />
              <span>
                <small>Get it on</small>
                Google Play
              </span>
            </a>
            <a className="ga-store ga-store-apk" href={APK_URL} download>
              <Download size={20} aria-hidden="true" />
              <span>
                <small>Direct download</small>
                Download APK
              </span>
            </a>
            <span className="ga-store ga-store-soon" aria-disabled="true">
              <AppleGlyph />
              <span>
                <small>Coming soon</small>
                App Store
              </span>
            </span>
          </div>

          <p className="ga-hint">
            {platform === "ios"
              ? "The iPhone app is on its way. Until then, play right here in Safari: tap Share → Add to Home Screen for an app-like icon."
              : platform === "desktop"
                ? "On a computer? Open this page on your Android phone to install."
                : `Google Play is the easiest way and keeps the app updated. No Play Store? Use the APK (${APK_NOTE}).`}
          </p>
        </div>

        {/* a phone showing the app's opening screen */}
        <div className="ga-phone" aria-hidden="true">
          <div className="ga-phone-screen">
            <span className="ga-phone-word">Reimagined</span>
            <span className="ga-phone-ring">
              <ArrowRight size={18} strokeWidth={2.4} />
            </span>
            <span className="ga-phone-brand">
              <small>SENEVON</small>
              Games Studio
            </span>
          </div>
        </div>
      </section>

      <section className="ga-features" aria-label="Why get the app">
        {FEATURES.map(({ Icon, title, text }) => (
          <div key={title} className="ga-feature">
            <span className="ga-feature-icon">
              <Icon size={20} aria-hidden="true" />
            </span>
            <h2>{title}</h2>
            <p>{text}</p>
          </div>
        ))}
      </section>

      <details className="ga-steps">
        <summary>
          How to install the APK
          <ChevronDown size={18} aria-hidden="true" />
        </summary>
        <ol>
          {APK_STEPS.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <p className="ga-steps-note">Only download the APK from this page. It's the same app as on Google Play, signed by Senevon Game Studio.</p>
      </details>
    </main>
    </SoftPage>
  );
}
