import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Crown, Download, Moon, Play, Sun } from "lucide-react";
import { isNative } from "../lib/native";
import { APK_URL, GET_APP_PATH, PLAY_STORE_URL } from "../lib/appLinks";
import { PlayGlyph } from "../components/StoreGlyphs";
import { games, getGame, scoreLabel, type Game, type GameCategory } from "../catalog";
import { categoryIcon } from "../lib/categoryIcons";
import { useRecent } from "../lib/recent";
import { parseAvatar, type AvatarChoice } from "../lib/avatar";
import { supabase } from "../supabase";
import { useGameTheme } from "../hooks/useGameTheme";
import { useBestForGame } from "../hooks/useBest";
import GamesNav, { navCategories } from "../components/GamesNav";
import DiskCarousel from "../components/DiskCarousel";
import GameDisk from "../components/GameDisk";
import PlayerAvatar from "../components/PlayerAvatar";
import TokenPill from "../components/TokenPill";
import SoftFooter from "../components/SoftFooter";
import { useLiveAds, type Ad } from "../lib/ads";
import { useSiteSettings } from "../lib/siteSettings";
import { useShowAds } from "../lib/tokens";
import { trackAd } from "../lib/track";
import { prefetchFromEvent, prefetchWhenIdle } from "../lib/prefetch";
import { byPopularity, usePopularIds } from "../lib/popular";

/** The main carousel moves on to the next game this often (until the player touches it). */
const AUTOPLAY_MS = 2500;
import "./home3.css";
import "./games-globe.css";
import "./game2.css";

/*
 * Home page (/): a disk-based game browser in the game pages' neumorphic style.
 * Light/dark is shared with the game pages (useGameTheme: device setting until the player picks).
 */

// Page surface + text colour per theme (same soft surfaces as the game pages).
export const THEMES = {
  light: { bg: "#e3e5ea", ink: "#17181b" },
  dark: { bg: "#2c2e33", ink: "#eceef2" },
} as const;

const FIRST_ROW = 8; // recently played, topped up with recommendations to this many
const MIN_RECOMMENDED = 4; // "Try next" always has at least this many games
const MAX_AD_DISKS = 2; // sponsored disks mixed into "Try next"
const AD_EVERY = 3; // one sponsored disk after every this many recommended games

// ---------- Collections for the rotating row ----------
const byIds = (ids: string[]) => ids.map((id) => getGame(id)).filter((g): g is Game => Boolean(g));
const COLLECTIONS: { key: string; label: string; games: Game[] }[] = [
  // the catalog lists the newest games last
  { key: "new", label: "New", games: games.slice(-8).reverse() },
  { key: "online", label: "Multiplayer", games: byIds(["chess", "ludo", "carrom", "arrows"]) },
  { key: "quick", label: "Quick games", games: games.filter((g) => g.minutes <= 2) },
  { key: "duo", label: "2 players", games: byIds(["chess", "ludo", "carrom"]) },
  {
    key: "brain",
    label: "Brain teasers",
    games: games.filter((g) => g.category === "Puzzle" || g.category === "Words" || g.category === "Numbers"),
  },
].filter((c) => c.games.length > 0);
const ROTATE_MS = 7000;

// ---------- Category colours ----------
const CATEGORY_COLOR: Partial<Record<GameCategory, string>> = {
  Action: "#ff3b30",
  Adventure: "#28b463",
  RPG: "#a855f7",
  Racing: "#ff9500",
  Strategy: "#5856d6",
  Sports: "#00b3a4",
  Indie: "#ff2d55",
  Puzzle: "#0a84ff",
  Classic: "#b3814c",
  Cards: "#17703f",
  Music: "#7b5cff",
  Words: "#e0a800",
  Numbers: "#30b0c7",
};

// ---------- Top players ----------
type PlayerRow = { userId: string; name: string; avatar: AvatarChoice | null; points: number; firsts: number };
const PLAYER_BOARDS = [
  { key: "points", label: "Top players" },
  { key: "firsts", label: "Most 1st places" },
] as const;
type PlayerBoard = (typeof PLAYER_BOARDS)[number]["key"];

/** Overall leaderboard (supabase leaderboard_overall), ranked by points or by 1st places. */
function useTopPlayers(by: PlayerBoard, limit = 12) {
  const [rows, setRows] = useState<PlayerRow[] | null>(supabase ? null : []);
  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    const other = by === "points" ? "firsts" : "points";
    void Promise.resolve(
      supabase
        .from("leaderboard_overall")
        .select("*")
        .order(by, { ascending: false })
        .order(other, { ascending: false })
        .limit(limit),
    ).then(({ data, error }) => {
      if (!alive) return;
      setRows(
        error || !data
          ? []
          : (data as { user_id: string; display_name: string; points: number; firsts: number; avatar?: unknown }[]).map((r) => ({
              userId: r.user_id,
              name: r.display_name || "Player",
              avatar: parseAvatar(r.avatar),
              points: Number(r.points) || 0,
              firsts: Number(r.firsts) || 0,
            })),
      );
    });
    return () => {
      alive = false;
    };
  }, [by, limit]);
  return rows;
}

// ---------- Small pieces ----------
/** An admin ad as a disk: its square image (or banner, cropped), opens the advertiser's link. */
function AdDisk({ ad }: { ad: Ad }) {
  const img = ad.thumb_url || ad.cover_url;
  const [failed, setFailed] = useState(false);
  // one impression per ad per page view
  useEffect(() => {
    trackAd(ad.id, "impression");
  }, [ad.id]);
  return (
    <li>
      <a
        className="g2-item g2-item-ad"
        href={ad.link_url}
        target="_blank"
        rel="noopener noreferrer sponsored"
        aria-label={`Sponsored: ${ad.title}`}
        onClick={() => trackAd(ad.id, "click")}
      >
        <span className="gd g2-ad-disk" aria-hidden="true">
          <span className="gd-face has-img">
            {img && !failed ? (
              <img src={img} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)} />
            ) : (
              <span className="g2-ad-fallback">{ad.title.charAt(0)}</span>
            )}
          </span>
          <span className="g2-ad-tag">Ad</span>
        </span>
        <span className="g2-label">{ad.title}</span>
        <span className="g2-sub">Sponsored</span>
      </a>
    </li>
  );
}

function GameItem({ game }: { game: Game }) {
  return (
    <li>
      <Link className="g2-item" to={`/game/${game.id}`}>
        <GameDisk game={game} />
        <span className="g2-label">{game.title}</span>
      </Link>
    </li>
  );
}

function Chips<K extends string>({
  options,
  value,
  onPick,
  label,
}: {
  options: readonly { key: K; label: string }[];
  value: K;
  onPick: (k: K) => void;
  label: string;
}) {
  return (
    <div className="g2-chips" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="tab"
          aria-selected={o.key === value}
          className={`g2-chip${o.key === value ? " is-on" : ""}`}
          onClick={() => onPick(o.key)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Details for the game in the carousel's centre. */
function Hero({ game }: { game: Game }) {
  const best = useBestForGame(game.id);
  return (
    <div className="g2-hero" key={game.id}>
      <h1 className="g2-hero-title">{game.title}</h1>
      <p className="g2-hero-meta">
        {game.category} · {game.difficulty} · ~{game.minutes} min
      </p>
      <p className="g2-hero-desc">{game.description}</p>
      <div className="g2-hero-actions">
        {best !== null ? (
          <span className="g2-hero-best">
            {scoreLabel(game)} <b>{best}</b>
          </span>
        ) : null}
        <Link className="g2-play" to={`/game/${game.id}`}>
          <Play size={16} fill="currentColor" strokeWidth={0} aria-hidden="true" />
          Play
        </Link>
      </div>
    </div>
  );
}

// ---------- Page ----------
/** Every game: scaling carousel + the centre game's details. Holds the centre game itself, so
 *  scrolling the carousel only re-renders this part, not the whole page. */
function CarouselWithHero() {
  // most played first, in the centre; the carousel then walks through them in order
  const popular = usePopularIds();
  const ordered = useMemo(() => (popular ? byPopularity(games, popular) : games), [popular]);
  const [centre, setCentre] = useState<Game>(ordered[0]);
  const onActiveChange = useCallback((g: Game) => setCentre(g), []);
  return (
    <>
      {/* key: a fresh carousel (back on the most played) if the order arrives after the first paint */}
      <DiskCarousel key={ordered.map((g) => g.id).join()} items={ordered} startIndex={0} label="All games" onActiveChange={onActiveChange} autoplayMs={AUTOPLAY_MS} />
      <Hero game={centre} />
    </>
  );
}

export default function Game2() {
  const { theme, toggle } = useGameTheme();
  const dark = theme === "dark";
  const { bg, ink } = THEMES[theme];

  // Row 1: recently played, topped up with suggestions (same categories first, then catalog order)
  const recentEntries = useRecent();
  const recent = useMemo(
    () => recentEntries.map((e) => getGame(e.id)).filter((g): g is Game => Boolean(g)),
    [recentEntries],
  );
  const suggestions = useMemo(() => {
    const played = new Set(recent.map((g) => g.id));
    const cats = new Set(recent.map((g) => g.category));
    const pool = games.filter((g) => !played.has(g.id));
    const ranked = [...pool.filter((g) => cats.has(g.category)), ...pool.filter((g) => !cats.has(g.category))];
    return ranked.slice(0, Math.max(MIN_RECOMMENDED, FIRST_ROW - recent.length));
  }, [recent]);

  // Sponsored disks: the admin's live ads (Admin → Ads), unless ads are switched off site-wide
  // or the player has bought ad-free
  const settings = useSiteSettings();
  const showAds = useShowAds();
  const liveAds = useLiveAds("disk");
  const adDisks = useMemo(
    () => (settings.ads_enabled && showAds ? liveAds.slice(0, MAX_AD_DISKS) : []),
    [settings.ads_enabled, showAds, liveAds],
  );
  const tryNext = useMemo(() => {
    const out: ({ kind: "game"; game: Game } | { kind: "ad"; ad: Ad })[] = [];
    let a = 0;
    suggestions.forEach((game, i) => {
      out.push({ kind: "game", game });
      if ((i + 1) % AD_EVERY === 0 && a < adDisks.length) out.push({ kind: "ad", ad: adDisks[a++] });
    });
    while (a < adDisks.length) out.push({ kind: "ad", ad: adDisks[a++] });
    return out;
  }, [suggestions, adDisks]);


  // Rotating collections row: advances on its own until the player picks one
  const [collection, setCollection] = useState(COLLECTIONS[0].key);
  const [pinned, setPinned] = useState(false);
  useEffect(() => {
    if (pinned) return;
    const id = window.setInterval(() => {
      if (document.hidden) return;
      setCollection((k) => COLLECTIONS[(COLLECTIONS.findIndex((c) => c.key === k) + 1) % COLLECTIONS.length].key);
    }, ROTATE_MS);
    return () => window.clearInterval(id);
  }, [pinned]);
  const shown = COLLECTIONS.find((c) => c.key === collection) ?? COLLECTIONS[0];

  // Players row
  const [board, setBoard] = useState<PlayerBoard>("points");
  const players = useTopPlayers(board);

  useEffect(() => prefetchWhenIdle(), []);

  useEffect(() => {
    const prev = document.title;
    document.title = "Senevon Game Studio — A Universe of Games";
    return () => {
      document.title = prev;
    };
  }, []);

  return (
    <div
      className={`gs h3 gs-flat g2${dark ? " gs-on-dark" : ""}`}
      data-theme={theme}
      style={{ "--gs-bg": bg, "--gs-ink": ink } as React.CSSProperties}
      onPointerDown={prefetchFromEvent}
      onPointerOver={prefetchFromEvent}
    >
      <GamesNav mobileMenu>
        {!isNative ? (
          <Link to={GET_APP_PATH} className="gs-icon-btn g2-get-app" aria-label="Get the app" title="Get the app">
            <Download size={19} strokeWidth={1.8} aria-hidden="true" />
          </Link>
        ) : null}
        <TokenPill variant="solid" />
        <button
          type="button"
          className="gs-icon-btn"
          aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
          title={dark ? "Light theme" : "Dark theme"}
          onClick={toggle}
        >
          {dark ? <Sun size={19} strokeWidth={1.8} aria-hidden="true" /> : <Moon size={19} strokeWidth={1.8} aria-hidden="true" />}
        </button>
      </GamesNav>

      <main className="g2-main">
        {/* 1. Recently played (+ suggestions) */}
        <section className="g2-section" aria-labelledby="g2-recent">
          <h2 className="g2-heading" id="g2-recent">
            {recent.length ? "Recently played" : "Popular now"}
          </h2>
          <ul className="g2-row">
            {recent.map((g) => (
              <GameItem key={g.id} game={g} />
            ))}
            {recent.length && tryNext.length ? (
              <li className="g2-divider" aria-hidden="true">
                <span>Try next</span>
              </li>
            ) : null}
            {tryNext.map((it) =>
              it.kind === "game" ? <GameItem key={it.game.id} game={it.game} /> : <AdDisk key={`ad-${it.ad.id}`} ad={it.ad} />,
            )}
          </ul>
        </section>

        {/* 2. Every game: scaling carousel + the centre game's details */}
        <CarouselWithHero />

        {/* 3. Rotating collections */}
        <section className="g2-section" aria-labelledby="g2-coll">
          <div className="g2-head-row">
            <h2 className="g2-heading" id="g2-coll">
              {shown.label}
            </h2>
            <Chips
              label="Collections"
              options={COLLECTIONS}
              value={shown.key}
              onPick={(k) => {
                setCollection(k);
                setPinned(true);
              }}
            />
          </div>
          <ul className="g2-row g2-fade-in" key={shown.key}>
            {shown.games.map((g) => (
              <GameItem key={g.id} game={g} />
            ))}
          </ul>
        </section>

        {/* 4. Categories */}
        <section className="g2-section" aria-labelledby="g2-cats">
          <h2 className="g2-heading" id="g2-cats">
            Categories
          </h2>
          <ul className="g2-row">
            {navCategories.map((c) => {
              const Icon = categoryIcon[c.name];
              return (
                <li key={c.name}>
                  <Link
                    className="g2-item g2-item-cat"
                    to={`/category/${c.name.toLowerCase()}`}
                    style={{ "--cat": CATEGORY_COLOR[c.name] ?? "var(--neu-accent)" } as React.CSSProperties}
                  >
                    <span className="g2-cat-disk" aria-hidden="true">
                      <Icon size={24} strokeWidth={1.8} />
                    </span>
                    <span className="g2-label">{c.name}</span>
                    <span className="g2-sub">
                      {c.count} {c.count === 1 ? "game" : "games"}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>

        {/* 5. Players */}
        <section className="g2-section" aria-labelledby="g2-players">
          <div className="g2-head-row">
            <h2 className="g2-heading" id="g2-players">
              Players
            </h2>
            <Chips label="Player rankings" options={PLAYER_BOARDS} value={board} onPick={setBoard} />
          </div>
          {players === null ? (
            <ul className="g2-row" aria-busy="true">
              {Array.from({ length: 8 }, (_, i) => (
                <li key={i} className="g2-item g2-skel">
                  <span className="g2-player-disk" />
                  <span className="g2-skel-line" />
                </li>
              ))}
            </ul>
          ) : players.length ? (
            <ul className="g2-row g2-fade-in" key={board}>
              {players.map((p, i) => (
                <li key={p.userId}>
                  <Link className="g2-item g2-item-player" to={`/player/${p.userId}`}>
                    <span className="g2-player-disk">
                      <PlayerAvatar id={p.userId} name={p.name} avatar={p.avatar} size={56} className="g2-av" />
                      <span className={`g2-rank${i < 3 ? ` is-top is-${i + 1}` : ""}`}>
                        {i === 0 ? <Crown size={11} strokeWidth={2.4} aria-hidden="true" /> : i + 1}
                      </span>
                    </span>
                    <span className="g2-label">{p.name}</span>
                    <span className="g2-sub">
                      {board === "points" ? `${p.points.toLocaleString()} pts` : `${p.firsts} × 1st`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="g2-empty">No ranked players yet. Finish a round to get on the board.</p>
          )}
        </section>

        {/* 6. Get the app (website only) */}
        {!isNative ? (
          <section className="g2-getapp" aria-labelledby="g2-getapp">
            <h2 className="g2-getapp-title" id="g2-getapp">
              <Link to={GET_APP_PATH}>Get the app</Link>
            </h2>
            <div className="g2-getapp-btns">
              <a className="g2-pill" href={PLAY_STORE_URL} target="_blank" rel="noopener noreferrer">
                <PlayGlyph size={20} />
                Play store
              </a>
              <a className="g2-pill" href={APK_URL} download>
                <span className="g2-pill-dl" aria-hidden="true">
                  <Download size={13} strokeWidth={2.6} />
                </span>
                Apk download
              </a>
            </div>
            <p className="g2-getapp-note">*The app is safe to install and doesn't collect any sensitive user data.</p>
          </section>
        ) : null}
      </main>

      <SoftFooter />
    </div>
  );
}
