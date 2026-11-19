import { useCallback, useEffect, useRef, useState } from "react";
import { useAuthContext } from "../context/AuthContext";
import { watchRewarded } from "../lib/admob";
import { isNative } from "../lib/native";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import TokenIcon from "./TokenIcon";
import { useLiveAds, type Ad } from "../lib/ads";
import { trackAd } from "../lib/track";
import { tokenErrorText, useTokens } from "../lib/tokens";
import "../pages/tokens.css";

/*
 * "Watch an ad, earn tokens".
 * 1. If a Google Ad Manager rewarded ad unit is configured (VITE_GAM_REWARDED_UNIT), it asks the
 *    network for a rewarded ad and pays out when the network says the reward was granted.
 * 2. Otherwise — or when the network has no ad to show — it shows one of your own live ads
 *    (admin panel → Ads) for HOUSE_SECONDS, then lets the player claim.
 * The server opens and checks every view (minimum watch time, daily cap), so the reward can't be
 * claimed by skipping this UI.
 */

const HOUSE_SECONDS = 15;
const GAM_UNIT = import.meta.env.VITE_GAM_REWARDED_UNIT as string | undefined;

/* ---------- Google Ad Manager rewarded ads (only loaded when configured) ---------- */

type GptEvent = { slot: unknown; isEmpty?: boolean; makeRewardedVisible?: () => void };
type Gpt = {
  cmd: Array<() => void>;
  defineOutOfPageSlot: (unit: string, format: unknown) => GptSlot | null;
  enums: { OutOfPageFormat: { REWARDED: unknown } };
  pubads: () => { addEventListener: (name: string, fn: (e: GptEvent) => void) => void; removeEventListener?: (name: string, fn: (e: GptEvent) => void) => void };
  enableServices: () => void;
  display: (slot: GptSlot) => void;
  destroySlots: (slots: GptSlot[]) => void;
};
type GptSlot = { addService: (s: unknown) => GptSlot };

let gptLoading: Promise<Gpt | null> | null = null;
function loadGpt(): Promise<Gpt | null> {
  gptLoading ??= new Promise((resolve) => {
    const w = window as unknown as { googletag?: Gpt };
    w.googletag = w.googletag ?? ({ cmd: [] } as unknown as Gpt);
    const s = document.createElement("script");
    s.src = "https://securepubads.g.doubleclick.net/tag/js/gpt.js";
    s.async = true;
    s.onload = () => resolve(w.googletag ?? null);
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
  return gptLoading;
}

/** Shows a network rewarded ad. Resolves "granted", "closed" (skipped) or "nofill". */
async function runNetworkAd(): Promise<"granted" | "closed" | "nofill"> {
  if (!GAM_UNIT) return "nofill";
  const gt = await loadGpt();
  if (!gt) return "nofill";
  return new Promise((resolve) => {
    let done = false;
    let granted = false;
    let slot: GptSlot | null = null;
    const finish = (r: "granted" | "closed" | "nofill") => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      if (slot) gt.destroySlots([slot]);
      resolve(r);
    };
    // no ad within 8 s → treat as no fill
    const timer = window.setTimeout(() => finish("nofill"), 8000);
    gt.cmd.push(() => {
      slot = gt.defineOutOfPageSlot(GAM_UNIT, gt.enums.OutOfPageFormat.REWARDED);
      if (!slot) return finish("nofill"); // page / device not eligible for rewarded ads
      slot.addService(gt.pubads());
      const pub = gt.pubads();
      pub.addEventListener("rewardedSlotReady", (e) => {
        if (e.slot !== slot) return;
        window.clearTimeout(timer);
        e.makeRewardedVisible?.();
      });
      pub.addEventListener("rewardedSlotGranted", (e) => {
        if (e.slot === slot) granted = true;
      });
      pub.addEventListener("rewardedSlotClosed", (e) => {
        if (e.slot === slot) finish(granted ? "granted" : "closed");
      });
      pub.addEventListener("slotRenderEnded", (e) => {
        if (e.slot === slot && e.isEmpty) finish("nofill");
      });
      gt.enableServices();
      gt.display(slot);
    });
  });
}

/* ---------- modal ---------- */

type Stage =
  | { kind: "loading" }
  | { kind: "house"; ad: Ad; left: number }
  | { kind: "claiming" }
  | { kind: "done"; reward: number }
  | { kind: "message"; text: string };

export default function AdRewardModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { wallet, startAdView, claimAd, refresh } = useTokens();
  const { user } = useAuthContext();
  const ads = useLiveAds("banner");
  const [stage, setStage] = useState<Stage>({ kind: "loading" });
  const viewRef = useRef<{ id: string; started: number } | null>(null);
  // bumps to start another ad without closing the modal
  const [restart, setRestart] = useState(0);
  const runRef = useRef(0);

  const claim = useCallback(async () => {
    const view = viewRef.current;
    if (!view) return;
    setStage({ kind: "claiming" });
    // the server wants a minimum watch time; network ads are normally longer anyway
    const minMs = (wallet?.ad_min_seconds ?? 12) * 1000 + 300;
    const wait = view.started + minMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      await claimAd(view.id);
      viewRef.current = null;
      setStage({ kind: "done", reward: wallet?.ad_reward ?? 50 });
    } catch (err) {
      setStage({ kind: "message", text: tokenErrorText(err) });
    }
  }, [claimAd, wallet?.ad_min_seconds, wallet?.ad_reward]);

  // Start a view each time the modal opens
  useEffect(() => {
    if (!open) return;
    const run = ++runRef.current;
    const alive = () => runRef.current === run;
    viewRef.current = null;
    setStage({ kind: "loading" });

    void (async () => {
      if (!wallet) return setStage({ kind: "message", text: "Sign in to earn tokens." });
      if (wallet.ads_today >= wallet.ad_daily_cap) {
        return setStage({ kind: "message", text: "You've watched today's ads — come back tomorrow for more tokens." });
      }
      try {
        // the app: an AdMob rewarded ad, credited by the server (admob-ssv)
        if (isNative && user) {
          setStage({ kind: "claiming" });
          const res = await watchRewarded(user.id);
          if (!alive()) return;
          await refresh();
          return setStage(
            res === "rewarded"
              ? { kind: "done", reward: wallet.ad_reward ?? 50 }
              : { kind: "message", text: "The ad was closed early, so no tokens this time." },
          );
        }
        if (GAM_UNIT) {
          const id = await startAdView("network");
          if (!alive()) return;
          viewRef.current = { id, started: Date.now() };
          const res = await runNetworkAd();
          if (!alive()) return;
          if (res === "granted") return void claim();
          if (res === "closed") return setStage({ kind: "message", text: "The ad was closed early, so no tokens this time." });
          // no fill → fall through to a house ad, reusing the same view
        }
        const pool = ads.length ? ads : [];
        if (!pool.length) {
          return setStage({ kind: "message", text: "No ads available right now. Please try again later." });
        }
        const ad = pool[Math.floor(Math.random() * pool.length)];
        if (!viewRef.current) {
          const id = await startAdView("house", ad.id);
          if (!alive()) return;
          viewRef.current = { id, started: Date.now() };
        }
        trackAd(ad.id, "impression");
        setStage({ kind: "house", ad, left: HOUSE_SECONDS });
      } catch (err) {
        if (alive()) setStage({ kind: "message", text: tokenErrorText(err) });
      }
    })();
    return () => {
      runRef.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, restart]);

  // House ad countdown
  const houseLeft = stage.kind === "house" ? stage.left : -1;
  useEffect(() => {
    if (houseLeft <= 0) return;
    const t = window.setTimeout(() => {
      setStage((s) => (s.kind === "house" ? { ...s, left: s.left - 1 } : s));
    }, 1000);
    return () => window.clearTimeout(t);
  }, [houseLeft]);

  // Esc closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="tk-modal" role="dialog" aria-modal="true" aria-label="Watch an ad to earn tokens">
      <div className="tk-modal-card">
        <button type="button" className="tk-modal-x" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>

        {stage.kind === "loading" || stage.kind === "claiming" ? (
          <div className="tk-modal-center">
            <span className="tk-spinner" aria-hidden="true" />
            <p>{stage.kind === "loading" ? "Loading an ad…" : "Adding your tokens…"}</p>
          </div>
        ) : null}

        {stage.kind === "house" ? (
          <div className="tk-ad">
            <span className="tk-ad-tag">Sponsored</span>
            <AdArt ad={stage.ad} />
            <h3>{stage.ad.title}</h3>
            {stage.ad.body ? <p>{stage.ad.body}</p> : null}
            <a
              className="tk-ad-cta"
              href={stage.ad.link_url}
              target="_blank"
              rel="noopener noreferrer sponsored"
              onClick={() => trackAd(stage.ad.id, "click")}
            >
              {stage.ad.cta_label || "Learn more"}
            </a>
            <div className="tk-ad-foot">
              <div className="tk-ad-bar" aria-hidden="true">
                <i style={{ width: `${((HOUSE_SECONDS - stage.left) / HOUSE_SECONDS) * 100}%` }} />
              </div>
              <button type="button" className="tk-btn tk-btn-primary" disabled={stage.left > 0} onClick={() => void claim()}>
                <TokenIcon size={18} />
                {stage.left > 0 ? `Claim in ${stage.left}s` : `Claim ${wallet?.ad_reward ?? 50} tokens`}
              </button>
            </div>
          </div>
        ) : null}

        {stage.kind === "done" ? (
          <div className="tk-modal-center">
            <span className="tk-reward-coin" aria-hidden="true">
              <TokenIcon size={66} />
            </span>
            <h3>+{stage.reward} tokens</h3>
            <p>
              {wallet ? `${wallet.ads_today} of ${wallet.ad_daily_cap} ads watched today.` : null}
            </p>
            <div className="tk-ad-done-actions">
              {wallet && wallet.ads_today < wallet.ad_daily_cap ? (
                <button type="button" className="tk-btn" onClick={() => setRestart((n) => n + 1)}>
                  Watch another
                </button>
              ) : null}
              <button type="button" className="tk-btn tk-btn-primary" onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        ) : null}

        {stage.kind === "message" ? (
          <div className="tk-modal-center">
            <p>{stage.text}</p>
            <button type="button" className="tk-btn" onClick={onClose}>
              Close
            </button>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

/** The ad's picture: its cover image, else its thumbnail on a tile, else a tile with its initial.
 *  A link that fails to load falls back the same way, so the ad never shows a broken image. */
function AdArt({ ad }: { ad: Ad }) {
  const [coverOk, setCoverOk] = useState(true);
  const [thumbOk, setThumbOk] = useState(true);
  if (ad.cover_url && coverOk) {
    return <img className="tk-ad-cover" src={ad.cover_url} alt="" onError={() => setCoverOk(false)} />;
  }
  return (
    <span className="tk-ad-cover tk-ad-tile" aria-hidden="true">
      {ad.thumb_url && thumbOk ? (
        <img src={ad.thumb_url} alt="" onError={() => setThumbOk(false)} />
      ) : (
        <b>{(ad.title || "?").trim().charAt(0).toUpperCase()}</b>
      )}
    </span>
  );
}
