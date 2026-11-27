import { useEffect, useState } from "react";
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import type { User } from "@supabase/supabase-js";
import { RiSearchLine } from "./ReIcons";
import NotifBell from "./NotifBell";
import DynamicAvatar from "./DynamicAvatar";

/**
 * Senevon Game Studio logo. Full horizontal logo (light text, for dark UI);
 * collapses to the square mark on very narrow screens (see .brand-logo CSS).
 */
export function BrandLogo() {
  return (
    <span className="brand-logo">
      <img
        className="brand-logo-full"
        src="/logo/logo-h-light-nav.webp"
        width={432}
        height={120}
        alt="Senevon Game Studio"
        decoding="async"
        fetchPriority="high"
      />
      <img
        className="brand-logo-mark"
        src="/logo/mark-256.webp"
        width={256}
        height={256}
        alt=""
        aria-hidden="true"
        decoding="async"
      />
    </span>
  );
}

/** Search box bound to the home page's `?q=` param, usable from any page. */
export function SearchBox({ className = "" }: { className?: string }) {
  const [params, setParams] = useSearchParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const q = pathname === "/" ? params.get("q") ?? "" : "";

  function update(value: string) {
    if (pathname !== "/") {
      navigate(value ? `/?q=${encodeURIComponent(value)}#games` : "/");
      return;
    }
    const next = new URLSearchParams(params);
    if (value) next.set("q", value);
    else next.delete("q");
    setParams(next, { replace: true });
  }

  return (
    <label className={`search-box ${className}`.trim()}>
      <RiSearchLine size={16} className="search-icon" />
      <input
        type="search"
        placeholder="Search games, creators, or genres…"
        aria-label="Search games, creators, or genres"
        value={q}
        onChange={(event) => update(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") document.getElementById("games")?.scrollIntoView({ behavior: "smooth" });
        }}
      />
    </label>
  );
}

export default function Nav({ user, onSignOut }: { user: User | null; onSignOut: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [scrolled, setScrolled] = useState(false);
  const [activeTab, setActiveTab] = useState("discover");

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const handleNavClick = (tab: string, targetId?: string) => {
    setActiveTab(tab);
    if (targetId) {
      document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <header className={`nav${scrolled ? " scrolled" : ""}`}>
      <div className="nav-inner">
        <Link to="/" className="brand" aria-label="Senevon Game Studio — home" onClick={() => handleNavClick("discover")}>
          <BrandLogo />
        </Link>

        <nav className="nav-links" aria-label="Sections">
          <NavLink
            to="/"
            end
            className={({ isActive }) => `nav-link ${isActive && activeTab === "discover" ? "active" : ""}`}
            onClick={() => handleNavClick("discover")}
          >
            Discover
            <span className="nav-active-pill" />
          </NavLink>
          <a
            href="#console"
            className={`nav-link ${activeTab === "play" ? "active" : ""}`}
            onClick={(e) => {
              e.preventDefault();
              handleNavClick("play", "console");
            }}
          >
            Play
            <span className="nav-active-pill" />
          </a>
          <a
            href="#games"
            className={`nav-link ${activeTab === "create" ? "active" : ""}`}
            onClick={(e) => {
              e.preventDefault();
              handleNavClick("create", "games");
            }}
          >
            Create
            <span className="nav-active-pill" />
          </a>
          <a
            href="#events"
            className={`nav-link ${activeTab === "events" ? "active" : ""}`}
            onClick={(e) => {
              e.preventDefault();
              handleNavClick("events", "friends-panel");
            }}
          >
            Events
            <span className="nav-active-pill" />
          </a>
          <a
            href="#community"
            className={`nav-link ${activeTab === "community" ? "active" : ""}`}
            onClick={(e) => {
              e.preventDefault();
              handleNavClick("community", "friends-panel");
            }}
          >
            Community
            <span className="nav-active-pill" />
          </a>
        </nav>

        <SearchBox className="nav-search" />

        <div className="nav-actions">
          <NotifBell className="nav-icon-btn nav-bell-btn" size={18} />

          <DynamicAvatar user={user} onSignOut={onSignOut} />
        </div>
      </div>
    </header>
  );
}
