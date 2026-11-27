/* The soft (neumorphic) page frame used by the home page's sibling pages (/app, /tokens):
   the home page's header, light/dark toggle and footer around the page's own content. */
import type { CSSProperties, ReactNode } from "react";
import { useGameTheme } from "../hooks/useGameTheme";
import GamesNav from "./GamesNav";
import TokenPill from "./TokenPill";
import SoftFooter from "./SoftFooter";
import { THEMES } from "../pages/Game2";
import "../pages/home3.css";
import "../pages/games-globe.css";
import "../pages/game2.css";

export default function SoftPage({ children, tokens = true }: { children: ReactNode; tokens?: boolean }) {
  const { theme, toggle } = useGameTheme();
  const dark = theme === "dark";
  const { bg, ink } = THEMES[theme];

  return (
    <div
      className={`gs h3 gs-flat g2 soft-page${dark ? " gs-on-dark" : ""}`}
      data-theme={theme}
      style={{ "--gs-bg": bg, "--gs-ink": ink } as CSSProperties}
    >
      <GamesNav mobileMenu theme={{ dark, toggle }}>
        {tokens ? <TokenPill variant="solid" /> : null}
      </GamesNav>
      {children}
      <SoftFooter />
    </div>
  );
}
