import { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import type { User } from "@supabase/supabase-js";
import {
  RiTrophyLine,
  RiSettings4Line,
  RiGamepadLine,
} from "./ReIcons";
import { useAvatar } from "../lib/avatar";
import AvatarLibrary from "./AvatarLibrary";
import TokenIcon from "./TokenIcon";
import { useTokens } from "../lib/tokens";
import { formatTokens } from "../lib/currency";

export default function DynamicAvatar({
  user,
  onSignOut,
}: {
  user: User | null;
  onSignOut?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { uri } = useAvatar(user);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const meta = user?.user_metadata ?? {};
  const displayName =
    (meta.full_name as string | undefined) || (meta.name as string | undefined) || user?.email?.split("@")[0] || "Guest";
  const initial = displayName.charAt(0).toUpperCase();
  // Generated avatar (falls back to the initial while the style loads for the first time).
  const face = uri ? <img src={uri} alt={displayName} className="avatar-img" referrerPolicy="no-referrer" /> : <span className="avatar-img avatar-initial">{initial}</span>;

  return (
    <div className="dynamic-avatar-wrapper" ref={menuRef}>
      <button
        type="button"
        className="dynamic-avatar-trigger"
        onClick={() => setOpen(!open)}
        aria-label="User Profile & Avatars"
        aria-expanded={open}
      >
        <div className="avatar-img-frame">
          {face}
          <span className="avatar-status-dot online" />
          <span className="avatar-pulse-ring" />
        </div>
      </button>

      {/* Dynamic Popover Glass Card */}
      {open && (
        <div className="avatar-popover-glass" role="menu">
          <div className="popover-profile-header">
            <div className="popover-avatar-lg">
              {face}
              <span className="popover-lvl-badge">LVL 48</span>
            </div>
            <div className="popover-user-meta">
              <strong className="popover-name">{displayName}</strong>
              <span className="popover-badge-tag">{user ? "Senevon player" : "Playing as guest"}</span>
              <span className="popover-status">
                <span className="status-live-dot" /> Online in Skyrealm
              </span>
            </div>
          </div>

          <div className="popover-stats-grid">
            <div className="popover-stat-box">
              <span className="stat-label">Tokens</span>
              <strong className="stat-val">
                <TokenIcon size={15} /> <TokenBalance />
              </strong>
            </div>
            <div className="popover-stat-box">
              <span className="stat-label">Rank</span>
              <strong className="stat-val">🏆 #14 Global</strong>
            </div>
            <div className="popover-stat-box">
              <span className="stat-label">XP Level</span>
              <strong className="stat-val">⚡ 7,420 XP</strong>
            </div>
          </div>

          <div className="avatar-switcher-section">
            <span className="switcher-title">Avatar library</span>
            <AvatarLibrary user={user} compact />
            {user ? (
              <Link to="/profile#avatars" className="switcher-more" onClick={() => setOpen(false)}>
                Browse the full library
              </Link>
            ) : null}
          </div>

          <div className="popover-actions">
            <Link
              to="/profile"
              className="popover-action-link"
              onClick={() => setOpen(false)}
            >
              <RiTrophyLine size={16} />
              <span>Leaderboards & Stats</span>
            </Link>
            <a
              href="#console"
              className="popover-action-link"
              onClick={() => setOpen(false)}
            >
              <RiGamepadLine size={16} />
              <span>Jump into Game Console</span>
            </a>
            {user ? (
              <button
                type="button"
                className="popover-action-link sign-out-btn"
                onClick={() => {
                  setOpen(false);
                  onSignOut?.();
                }}
              >
                <RiSettings4Line size={16} />
                <span>Sign Out</span>
              </button>
            ) : (
              <Link
                to="/login"
                className="popover-action-link sign-in-btn"
                onClick={() => setOpen(false)}
              >
                <RiSettings4Line size={16} />
                <span>Sync Orbit Cloud Account</span>
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** The signed-in player's token balance (∞ for unlimited accounts). */
function TokenBalance() {
  const { wallet } = useTokens();
  return <>{wallet ? (wallet.unlimited ? "∞" : formatTokens(wallet.balance)) : "…"}</>;
}
