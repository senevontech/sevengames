import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { categories, games, type Game, type GameCategory } from "../catalog";
import FeatureCarousel from "../components/FeatureCarousel";
import GamesNav from "../components/GamesNav";
import TokenPill from "../components/TokenPill";
import { useGameTheme } from "../hooks/useGameTheme";
import { THEMES } from "./Game2";
import "./home3.css";
import "./games-globe.css";
import "./game2.css";
import "../components/feature-carousel.css";
import "./category-page.css";

/*
 * /category/:slug — full-screen category page in the style of the home page's carousel:
 * category name, game title, round game discs on each game's own colour, with the circular
 * colour reveal. The carousel loops forever; categories with fewer than five games are padded
 * with "Coming soon" placeholder discs so the left / centre / right discs are always filled.
 */

const MIN_SLIDES = 5;
const SOON_COLOR = "#4a4a52";

/** Categories that actually have games, in catalog order. */
export const usedCategories = categories.filter(
  (c): c is GameCategory => c !== "All" && games.some((g) => g.category === c),
);
export const categorySlug = (c: string) => c.toLowerCase();

export default function CategoryPage() {
  const { slug = "" } = useParams();
  const category = usedCategories.find((c) => categorySlug(c) === slug.toLowerCase());
  const [ink, setInk] = useState("#ffffff");
  const { theme, toggle } = useGameTheme();
  const dark = theme === "dark";

  const { slides, soonIds } = useMemo(() => {
    const list: Game[] = category ? games.filter((g) => g.category === category) : [];
    const soon = new Set<string>();
    const padded = [...list];
    for (let k = 0; padded.length < MIN_SLIDES; k++) {
      const id = `soon-${k}`;
      soon.add(id);
      padded.push({
        ...list[0],
        id,
        title: "Coming soon",
        description: `A new ${category} game is on its way. Check back soon.`,
        accent: SOON_COLOR,
        poster: undefined,
      } as Game);
    }
    return { slides: padded, soonIds: soon };
  }, [category]);

  useEffect(() => {
    if (!category) return;
    const prev = document.title;
    document.title = `${category} games — Senevon Game Studio`;
    document.documentElement.classList.add("no-scroll");
    return () => {
      document.title = prev;
      document.documentElement.classList.remove("no-scroll");
    };
  }, [category]);

  if (!category) return <Navigate to="/" replace />;
  const realCount = slides.length - soonIds.size;

  return (
    <div className={`cp h3${ink === "#ffffff" ? " cp-on-dark" : ""}`} style={{ "--cp-ink": ink } as CSSProperties}>
      {/* the site's global header (same as every other page); the wrapper only lends it its theme */}
      <div
        className={`gs h3 gs-flat g2 cp-gnav${dark ? " gs-on-dark" : ""}`}
        data-theme={theme}
        style={{ "--gs-bg": THEMES[theme].bg, "--gs-ink": THEMES[theme].ink } as CSSProperties}
      >
        <GamesNav mobileMenu theme={{ dark, toggle }}>
          <TokenPill variant="solid" />
        </GamesNav>
      </div>

      {/* key: a fresh carousel (index, colours) for each category */}
      <FeatureCarousel
        key={category}
        items={slides}
        soonIds={soonIds}
        colorFor={(g) => g.accent}
        eyebrow={`${category} · ${realCount} ${realCount === 1 ? "game" : "games"}`}
        label={`${category} games`}
        onInk={setInk}
      />

      {/* Jump to another category */}
      <nav className="cp-switch" aria-label="Categories">
        {usedCategories.map((c) => (
          <Link key={c} to={`/category/${categorySlug(c)}`} aria-current={c === category ? "page" : undefined}>
            {c}
          </Link>
        ))}
      </nav>
    </div>
  );
}
