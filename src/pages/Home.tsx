import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { X } from "../components/anim-icons";
import { RiPlayFill, RiPlayCircleLine } from "../components/ReIcons";
import { games, getGame, type Game, type GameCategory } from "../catalog";
import { GameCard } from "../components/GameCard";
import HeroRing from "../components/HeroRing";
import PromoCards from "../components/PromoCards";
import CategoryFilterBar, { type FilterCategory } from "../components/CategoryFilterBar";
import NowPlayingConsole, { type ConsoleGame } from "../components/NowPlayingConsole";
import ContinuePlayingPanel, { type ContinueItem } from "../components/ContinuePlayingPanel";
import FriendsOnlinePanel from "../components/FriendsOnlinePanel";
import { SearchBox } from "../components/Nav";
import { useSiteSettings } from "../lib/siteSettings";
import { useBestForGame } from "../hooks/useBest";

// Marquee games around the ring matching the reference image layout:
// SKYREALM front center, SHADOW TACTICS & VOID ARENA to right, DRIFT NEXUS & PIXEL CRAFT to left
const FEATURED_RING_IDS = [
  "skyrealm",
  "shadow-tactics",
  "void-arena",
  "infitunnel",
  "yat-c",
  "carrom",
  "pov-cricket",
  "publicport",
  "pixel-craft",
  "drift-nexus",
];
const featuredGames = FEATURED_RING_IDS.map((id) => getGame(id)).filter(
  (g): g is Game => Boolean(g),
);

export default function Home() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const categoryParam = (params.get("category") as FilterCategory | null) ?? "All";
  const [selectedCategory, setSelectedCategory] = useState<FilterCategory>(categoryParam);
  const [showTrailer, setShowTrailer] = useState(false);
  const [currentConsoleGame, setCurrentConsoleGame] = useState<ConsoleGame>({
    id: "skyrealm",
    title: "Skyrealm",
    genre: "Open World RPG",
    screenImage: "/images/orbit/now_playing_viewport_2x.png",
    progress: 72,
  });

  const query = params.get("q") ?? "";
  const settings = useSiteSettings();

  // Sync state if category changes via URL
  useEffect(() => {
    if (categoryParam) setSelectedCategory(categoryParam);
  }, [categoryParam]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return games.filter((game) => {
      let matchesCat = true;
      if (selectedCategory !== "All") {
        if (selectedCategory === "RPG") {
          matchesCat = game.category === "RPG" || game.id === "skyrealm";
        } else if (selectedCategory === "Racing") {
          matchesCat = game.category === "Racing" || game.id === "drift-nexus";
        } else if (selectedCategory === "Adventure") {
          matchesCat = game.category === "Adventure" || game.id === "pixel-craft";
        } else if (selectedCategory === "Indie") {
          matchesCat = game.kind === "builtin" || game.category === "Puzzle";
        } else {
          matchesCat = game.category === (selectedCategory as GameCategory);
        }
      }

      const matchesQuery =
        !q ||
        game.title.toLowerCase().includes(q) ||
        game.description.toLowerCase().includes(q) ||
        game.category.toLowerCase().includes(q);

      return matchesCat && matchesQuery;
    });
  }, [selectedCategory, query]);

  // Handle hash scrolling
  useEffect(() => {
    if (location.hash) {
      const el = document.getElementById(location.hash.slice(1));
      if (el) {
        requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth" }));
      }
    }
  }, [location.key, location.hash]);

  function handleCategorySelect(cat: FilterCategory) {
    setSelectedCategory(cat);
    const p = new URLSearchParams(params);
    if (cat === "All") p.delete("category");
    else p.set("category", cat);
    setParams(p, { replace: true });
  }

  function handleContinueSelect(item: ContinueItem) {
    const game = getGame(item.id);
    if (game) {
      setCurrentConsoleGame({
        id: game.id,
        title: game.title,
        genre: game.category,
        screenImage:
          game.id === "skyrealm"
            ? "/images/orbit/now_playing_viewport_2x.png"
            : game.poster || "/images/orbit/now_playing_viewport_2x.png",
        progress: item.progress,
      });
    }
  }

  return (
    <div className="page home">
      {/* 1. Hero Section */}
      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="hero-kicker">PLAY • DISCOVER • BUILD</p>
          <h1 className="hero-heading">
            <span className="hero-line">A Universe</span>
            <span className="hero-line">of Games</span>
          </h1>
          <p className="hero-sub">
            Play instantly, discover new worlds,
            <br />
            and be part of a global gaming universe.
          </p>
          <div className="hero-actions">
            <button
              type="button"
              className="hero-btn-explore"
              onClick={() =>
                document.getElementById("console")?.scrollIntoView({ behavior: "smooth" })
              }
            >
              <RiPlayFill size={16} />
              <span>Explore Games</span>
            </button>
            <button
              type="button"
              className="hero-btn-trailer"
              onClick={() => setShowTrailer(true)}
            >
              <RiPlayCircleLine size={18} />
              <span>Watch Trailer</span>
            </button>
          </div>
        </div>

        {/* 3D Holographic Orbit Ring */}
        <HeroRing games={featuredGames} />

        {/* Hero Right Promo Cards */}
        <PromoCards />
      </section>

      {/* Announcement banner if active */}
      {settings.announcement_enabled && settings.announcement_text ? (
        <div className="announce" role="status">
          {settings.announcement_text}
        </div>
      ) : null}

      {/* 2. Category Filter Bar (Middle Section) */}
      <CategoryFilterBar
        selected={selectedCategory}
        onSelect={handleCategorySelect}
      />

      {/* 3. Bottom Dashboard Deck (Now Playing + Continue Playing + Friends Online) */}
      <section className="dashboard-console-deck" aria-label="Game Console Dashboard">
        {/* Left/Center: Now Playing Screen & Controls */}
        <NowPlayingConsole game={currentConsoleGame} />

        {/* Middle: Continue Playing */}
        <ContinuePlayingPanel onSelectGame={handleContinueSelect} />

        {/* Right: Friends Online */}
        <FriendsOnlinePanel />
      </section>

      {/* 4. Full Game Library Grid */}
      <section className="library" id="games">
        <div className="library-head">
          <div className="library-title-wrap">
            <h2 className="library-title">
              {selectedCategory === "All" ? "Game Catalog" : `${selectedCategory} Games`}
            </h2>
            <span className="library-count">({filtered.length} games available)</span>
          </div>
          <SearchBox className="library-search" />
        </div>

        <div className="library-body">
          <div className="library-main">
            <div className="game-grid">
              {filtered.map((game, i) => (
                <HomeCardWithBest key={game.id} game={game} index={i} />
              ))}
            </div>
            {filtered.length === 0 ? (
              <p className="empty-note">No games match “{query}”.</p>
            ) : null}
          </div>
        </div>
      </section>

      {/* Watch Trailer Modal */}
      {showTrailer ? (
        <div className="orbit-modal-overlay" onClick={() => setShowTrailer(false)}>
          <div
            className="orbit-modal-box trailer-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="modal-close-btn"
              onClick={() => setShowTrailer(false)}
            >
              <X size={22} />
            </button>
            <div className="trailer-video-box">
              <img
                src="/images/orbit/now_playing_viewport_2x.png"
                alt="Skyrealm Cinematic Trailer"
                className="trailer-preview-img"
              />
              <div className="trailer-play-icon">
                <RiPlayFill size={44} />
              </div>
            </div>
            <div className="trailer-info">
              <h3>Skyrealm: The Shattered Heavens — Official Launch Trailer</h3>
              <p>
                Experience the expansive floating realms, soaring gliders, and celestial
                boss encounters in the flagship Senevon open-world RPG.
              </p>
              <button
                type="button"
                className="hero-btn-explore"
                onClick={() => {
                  setShowTrailer(false);
                  navigate("/game/skyrealm");
                }}
              >
                <RiPlayFill size={16} />
                Play Skyrealm Now
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function HomeCardWithBest({ game, index }: { game: Game; index: number }) {
  const best = useBestForGame(game.id);
  return <GameCard game={game} best={best} index={index} />;
}
