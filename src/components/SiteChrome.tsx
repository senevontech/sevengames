import { useEffect, useRef, useState, type ReactNode } from "react";
import { SeneviIcon } from "../senevi/Senevi";
import { Link, useLocation } from "react-router-dom";
import { Building2, Coins, Gift, House, Menu, Moon, Smartphone, Sun, Trophy, UserRound, Users, X } from "lucide-react";
import { categories, games } from "../catalog";
import { categoryIcon } from "../lib/categoryIcons";
import NavAccount from "./NavAccount";
import NotifBell from "./NotifBell";
import TokenPill from "./TokenPill";
import { useGameTheme } from "../hooks/useGameTheme";
import { isNative } from "../lib/native";
import { GET_APP_PATH } from "../lib/appLinks";
import "../pages/home3.css";
import "./site-chrome.css";

/*
 * Page frame for every page except the home page (game, profile, login…), in the new UI:
 * the home page's nav, the glass pill sidebar with its neon border, and the floating-island
 * scene as a blurred, darkened backdrop (the page content keeps its dark-glass styling).
 */

const usedCategories = categories.filter((c) => c === "All" || games.some((g) => g.category === c));

/**
 * Phones: the sidebar's links (home, categories, leaderboards) in a hamburger menu in the header,
 * instead of a floating bottom bar. Closes on outside tap, Escape, or navigating.
 */
function SiteMenu({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={`site-menu${open ? " is-open" : ""}`} ref={rootRef}>
      <button
        type="button"
        className="site-menu-btn"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <X size={18} /> : <Menu size={18} />}
      </button>
      {open ? (
        <nav className="site-menu-panel" aria-label="Browse games">
          <Link to="/" className="site-menu-item">
            <span className="site-menu-icon" aria-hidden="true">
              <House size={17} />
            </span>
            Home
          </Link>
          <Link to="/leaderboards" className="site-menu-item">
            <span className="site-menu-icon" aria-hidden="true">
              <Trophy size={17} />
            </span>
            Leaderboards
          </Link>
          <p className="site-menu-label">Categories</p>
          <div className="site-menu-grid">
            {usedCategories
              .filter((c) => c !== "All")
              .map((c) => {
                const Icon = categoryIcon[c];
                return (
                  <Link key={c} to={`/category/${c.toLowerCase()}`} className="site-menu-item">
                    <span className="site-menu-icon" aria-hidden="true">
                      <Icon size={16} />
                    </span>
                    {c}
                  </Link>
                );
              })}
          </div>
          <div className="site-menu-sep" />
          <Link to="/senevi" className="site-menu-item">
            <span className="site-menu-icon" aria-hidden="true">
              <SeneviIcon size={18} />
            </span>
            Meet Senevi
          </Link>
          <Link to="/rewards" className="site-menu-item">
            <span className="site-menu-icon" aria-hidden="true">
              <Gift size={16} />
            </span>
            Rewards
          </Link>
          <Link to="/clubs" className="site-menu-item">
            <span className="site-menu-icon" aria-hidden="true">
              <Users size={16} />
            </span>
            Clubs
          </Link>
          <Link to="/chips" className="site-menu-item">
            <span className="site-menu-icon" aria-hidden="true">
              <Coins size={16} />
            </span>
            Chips & frames
          </Link>
          <Link to="/business" className="site-menu-item">
            <span className="site-menu-icon" aria-hidden="true">
              <Building2 size={16} />
            </span>
            For business
          </Link>
          <Link to="/profile" className="site-menu-item">
            <span className="site-menu-icon" aria-hidden="true">
              <UserRound size={16} />
            </span>
            Profile
          </Link>
          {!isNative ? (
            <Link to={GET_APP_PATH} className="site-menu-item">
              <span className="site-menu-icon" aria-hidden="true">
                <Smartphone size={16} />
              </span>
              Get the app
            </Link>
          ) : null}
          <div className="site-menu-foot">
            <span>© {new Date().getFullYear()} Senevon Game Studio</span>
            <Link to="/privacy">Privacy policy</Link>
          </div>
        </nav>
      ) : null}
    </div>
  );
}

export default function SiteChrome({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  // Light/dark mode: game pages plus the account pages (profile, tokens); other pages keep the dark frame.
  const isGame =
    pathname.startsWith("/game/") || pathname === "/profile" || pathname === "/chips" || pathname === "/leaderboards" || pathname === "/login" || pathname.startsWith("/player/");
  const { theme, toggle } = useGameTheme();

  return (
    // game pages fit the screen exactly (no page scroll, no footer): see pages/game-fit.css
    <div className={`site${pathname.startsWith("/game/") ? " site-game" : ""}`} data-gtheme={isGame ? theme : undefined}>
      <div className="site-backdrop" aria-hidden="true" />

      {/* Fixed chrome, reusing the home page's styles (scoped under .h3) */}
      <div className="h3 h3-scrolled h3-past-hero site-chrome">
        <nav className="h3-nav">
          <Link className="h3-logo" to="/" aria-label="Senevon Game Studio — home">
            {/* Both logo variants; CSS shows the one that reads on the current nav band
                (light text on dark bands: dark game mode, and the #303030 phone pages) */}
            <img className="site-logo-dark" src="/logo/logo-h-dark-nav.webp" width={432} height={120} alt="Senevon Game Studio" />
            <img className="site-logo-light" src="/logo/logo-h-light-nav.webp" width={432} height={120} alt="" aria-hidden="true" />
            <img className="h3-logo-mark" src="/logo/mark-256.webp" width={256} height={256} alt="" aria-hidden="true" />
          </Link>
          <div className="h3-menu">
            <Link to="/">
              Games
              <i className="h3-chev" />
            </Link>
            <Link to="/">
              Categories
              <i className="h3-chev" />
            </Link>
            <Link to="/leaderboards">
              Leaderboards
              <i className="h3-chev" />
            </Link>
            <Link to="/#studio">
              Studio
              <i className="h3-chev" />
            </Link>
          </div>
          <div className="h3-nav-end">
            <TokenPill />
            {isGame ? (
              <button
                type="button"
                className="h3-theme-toggle"
                onClick={toggle}
                aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
                title={theme === "light" ? "Dark mode" : "Light mode"}
              >
                {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}
              </button>
            ) : null}
            <NotifBell className="h3-theme-toggle" size={17} />
            <SiteMenu pathname={pathname} />
            <NavAccount />
          </div>
        </nav>

        <aside className="h3-rail" aria-label="Browse games">
          <span className="h3-rail-glow" aria-hidden="true">
            <i />
          </span>
          <Link to="/" className="h3-rail-item" data-label="Home">
            <House size={18} />
          </Link>
          <span className="h3-rail-sep" aria-hidden="true" />
          {usedCategories.map((c) => {
            const Icon = categoryIcon[c];
            return (
              <Link
                key={c}
                to={c === "All" ? "/" : `/category/${c.toLowerCase()}`}
                className="h3-rail-item"
                data-label={c === "All" ? "All games" : c}
              >
                <Icon size={18} />
              </Link>
            );
          })}
          <span className="h3-rail-sep" aria-hidden="true" />
          <Link
            to="/leaderboards"
            className={`h3-rail-item${pathname === "/leaderboards" ? " active" : ""}`}
            data-label="Leaderboards"
          >
            <Trophy size={18} />
          </Link>
        </aside>
      </div>

      <main className="route site-main" key={pathname}>
        {children}
      </main>

      <footer className="site-footer">
        {/* Light-text logo on the usual dark footer; dark-text logo on light-mode game pages */}
        <img className="footer-logo-light" src="/logo/logo-h-light-nav.webp" width={432} height={120} alt="Senevon Game Studio" loading="lazy" />
        <img className="footer-logo-dark" src="/logo/logo-h-dark-nav.webp" width={432} height={120} alt="" aria-hidden="true" loading="lazy" />
        <p>Play instantly, discover new worlds, and be part of a global gaming universe.</p>
        <p className="site-footer-copy">
          © {new Date().getFullYear()} Senevon Game Studio · <Link to="/privacy">Privacy policy</Link>
          {!isNative ? (
            <>
              {" · "}
              <Link to={GET_APP_PATH}>Get the app</Link>
            </>
          ) : null}
        </p>
      </footer>
    </div>
  );
}
