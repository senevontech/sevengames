import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { House, Moon, Sun, Trophy } from "lucide-react";
import { categories, games } from "../catalog";
import { categoryIcon } from "../lib/categoryIcons";
import NavAccount from "./NavAccount";
import TokenPill from "./TokenPill";
import { useGameTheme } from "../hooks/useGameTheme";
import "../pages/home3.css";
import "./site-chrome.css";

/*
 * Page frame for every page except the home page (game, profile, login…), in the new UI:
 * the home page's nav, the glass pill sidebar with its neon border, and the floating-island
 * scene as a blurred, darkened backdrop (the page content keeps its dark-glass styling).
 */

const usedCategories = categories.filter((c) => c === "All" || games.some((g) => g.category === c));

export default function SiteChrome({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  // Light/dark mode: game pages plus the account pages (profile, tokens); other pages keep the dark frame.
  const isGame =
    pathname.startsWith("/game/") || pathname === "/profile" || pathname === "/tokens" || pathname === "/leaderboards" || pathname === "/login" || pathname.startsWith("/player/");
  const { theme, toggle } = useGameTheme();

  return (
    <div className="site" data-gtheme={isGame ? theme : undefined}>
      <div className="site-backdrop" aria-hidden="true" />

      {/* Fixed chrome, reusing the home page's styles (scoped under .h3) */}
      <div className="h3 h3-scrolled h3-past-hero site-chrome">
        <nav className="h3-nav">
          <Link className="h3-logo" to="/" aria-label="Senevon Game Studio — home">
            {/* Both logo variants; CSS shows the one that reads on the current nav band
                (light text on dark bands: dark game mode, and the #303030 phone pages) */}
            <img className="site-logo-dark" src="/logo/logo-h-dark-nav.webp" width={432} height={120} alt="Senevon Game Studio" />
            <img className="site-logo-light" src="/logo/logo-h-light-nav.webp" width={432} height={120} alt="" aria-hidden="true" />
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
        </p>
      </footer>
    </div>
  );
}
