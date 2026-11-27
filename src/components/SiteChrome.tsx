import type { CSSProperties, ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useGameTheme } from "../hooks/useGameTheme";
import { THEMES } from "../pages/Game2";
import GamesNav from "./GamesNav";
import TokenPill from "./TokenPill";
import "../pages/home3.css";
import "../pages/games-globe.css";
import "../pages/game2.css";
import "./site-chrome.css";

/*
 * Page frame for the game pages (/game/:id): the site's global header (GamesNav, the same one as
 * the home page, with the phone hamburger menu) over the game, no sidebar, no footer.
 * .site[data-gtheme] drives the game pages' light / dark styling (game-page.css, game-neu.css)
 * and .site-game the fit-to-screen layout (game-fit.css). Every other page uses SoftPage.
 */
export default function SiteChrome({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { theme, toggle } = useGameTheme();
  const dark = theme === "dark";
  const { bg, ink } = THEMES[theme];

  return (
    <div className="site site-game" data-gtheme={theme}>
      <div className="site-backdrop" aria-hidden="true" />

      {/* only supplies the header's styles + theme (display: contents, see site-chrome.css) */}
      <div
        className={`gs h3 gs-flat g2 site-gnav${dark ? " gs-on-dark" : ""}`}
        data-theme={theme}
        style={{ "--gs-bg": bg, "--gs-ink": ink } as CSSProperties}
      >
        <GamesNav mobileMenu theme={{ dark, toggle }}>
          <TokenPill variant="solid" />
        </GamesNav>
      </div>

      <main className="route site-main" key={pathname}>
        {children}
      </main>
    </div>
  );
}
