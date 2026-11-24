import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuthContext } from "../context/AuthContext";
import { useTokens } from "../lib/tokens";
import { formatTokens } from "../lib/currency";
import TokenIcon from "./TokenIcon";
import "../pages/tokens.css";

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Animated balance: counts from the old value to the new one and reports the change
 * (`delta`, with a `tick` that bumps on every change so the same delta can replay).
 */
function useLiveBalance(target: number | null) {
  const [shown, setShown] = useState(target);
  const [change, setChange] = useState<{ delta: number; tick: number } | null>(null);
  const prev = useRef(target);

  useEffect(() => {
    const from = prev.current;
    prev.current = target;
    if (target === null || from === null || from === target) {
      setShown(target);
      return;
    }
    setChange((c) => ({ delta: target - from, tick: (c?.tick ?? 0) + 1 }));
    if (reducedMotion()) {
      setShown(target);
      return;
    }
    const start = performance.now();
    const ms = Math.min(1200, 400 + Math.abs(target - from) / 4);
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(from + (target - from) * eased));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  // hide the "+N" chip once it has floated away
  useEffect(() => {
    if (!change) return;
    const id = window.setTimeout(() => setChange(null), 1600);
    return () => window.clearTimeout(id);
  }, [change]);

  return { shown, change };
}

/**
 * Token balance in the nav; opens the Tokens page.
 * "solid" = white pill button (landing nav), also shown to guests with their guest balance.
 */
export default function TokenPill({ variant = "default" }: { variant?: "default" | "solid" }) {
  const { user } = useAuthContext();
  const { wallet, guestBalance, loading } = useTokens();

  const unlimited = Boolean(user && wallet?.unlimited);
  const value = user ? (wallet && !wallet.unlimited ? wallet.balance : null) : guestBalance;
  const { shown, change } = useLiveBalance(value);

  if (!user && (variant !== "solid" || guestBalance === null)) return null;
  // hidden if the wallet can't load (e.g. tokens.sql not run yet)
  if (user && !wallet && !loading) return null;

  const label = unlimited
    ? "Unlimited chips"
    : value === null
      ? "Your chips"
      : `${formatTokens(value)} ${user ? "chips — get more" : "guest chips"}`;

  return (
    <Link
      to="/chips"
      className={`tk-pill${variant === "solid" ? " tk-pill-solid" : ""}${change ? (change.delta > 0 ? " is-up" : " is-down") : ""}`}
      aria-label={label}
      title={user ? "Get more chips" : "Guest chips: sign in for 100 free"}
    >
      <span className="tk-pill-coin" aria-hidden="true">
        <TokenIcon size={variant === "solid" ? 22 : 18} />
      </span>
      <b>{unlimited ? "∞" : shown !== null ? formatTokens(shown) : "…"}</b>
      {change ? (
        <span key={change.tick} className="tk-pill-delta" aria-hidden="true">
          {change.delta > 0 ? "+" : "−"}
          {formatTokens(Math.abs(change.delta))}
        </span>
      ) : null}
    </Link>
  );
}
