import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SeneviIcon } from "../senevi/Senevi";
import { Link, useNavigate } from "react-router-dom";
import { Gift, LayoutGrid, Moon, Smartphone, Sun, Users } from "./anim-icons";
import { MenuToggle } from "./anim-icons/toggles";
import { isNative } from "../lib/native";
import { GET_APP_PATH } from "../lib/appLinks";
import { categories, games, type Game } from "../catalog";
import { categoryIcon } from "../lib/categoryIcons";
import NavAccount from "./NavAccount";
import NotifBell from "./NotifBell";
import { RiHomeSmile, RiSearchReicon, RiTrophyLine } from "./ReIcons";

/*
 * The icon header of the home page (originally the /games globe page): logo, search, leaderboards, home, categories, account.
 * Styles live in pages/games-globe.css and are scoped to `.gs` (the page sets --gs-bg / --gs-ink,
 * and adds `gs-on-dark` when the ink is white so the light logo shows).
 */

// categories that actually have games, with their counts (for the nav's categories menu)
export const navCategories = categories
  .filter((c): c is Game["category"] => c !== "All")
  .map((c) => ({ name: c, count: games.filter((g) => g.category === c).length }))
  .filter((c) => c.count > 0);

/** Title matches first (prefix before substring), then category matches; top 6. */
function searchGames(query: string): Game[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const starts = games.filter((g) => g.title.toLowerCase().startsWith(q));
  const rest = games.filter(
    (g) => !starts.includes(g) && (g.title.toLowerCase().includes(q) || g.category.toLowerCase().includes(q)),
  );
  return [...starts, ...rest].slice(0, 6);
}

/** Icon-only "Categories" button with a dropdown of category pages. */
function CategoryMenu() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

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
    <div className={`gs-cats${open ? " is-open" : ""}`} ref={rootRef}>
      <button
        type="button"
        className="gs-icon-btn"
        aria-label="Categories"
        title="Categories"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <LayoutGrid size={21} strokeWidth={1.8} aria-hidden="true" />
      </button>
      {open ? (
        <ul className="gs-cats-menu" aria-label="Categories">
          {navCategories.map((c, i) => {
            const Icon = categoryIcon[c.name];
            return (
              <li key={c.name} style={{ animationDelay: `${i * 25}ms` }}>
                <Link to={`/category/${c.name.toLowerCase()}`} onClick={() => setOpen(false)}>
                  <span className="gs-cats-icon" aria-hidden="true">
                    <Icon size={16} />
                  </span>
                  <span className="gs-cats-name">{c.name}</span>
                  <span className="gs-cats-count">{c.count}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Phones: one hamburger button opening a panel with search, home, leaderboards, clubs, the
 * light / dark switch and categories.
 * Closes on outside tap, Escape, or picking anything.
 */
/** Light / dark switch: a header button on wide screens, an item in the phone menu. */
export type NavTheme = { dark: boolean; toggle: () => void };

function MobileMenu({ onPick, theme }: { onPick: (g: Game) => void; theme?: NavTheme }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const results = useMemo(() => searchGames(query), [query]);
  const close = () => {
    setOpen(false);
    setQuery("");
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={`gs-burger${open ? " is-open" : ""}`} ref={rootRef}>
      <button
        type="button"
        className="gs-icon-btn"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <MenuToggle open={open} size={22} strokeWidth={1.8} />
      </button>
      {open ? (
        <div className="gs-burger-panel">
          <div className="gs-burger-search">
            <RiSearchReicon size={18} aria-hidden="true" />
            <input
              type="search"
              placeholder="Search games…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && results[0]) {
                  onPick(results[0]);
                  close();
                }
              }}
              aria-label="Search games"
              autoComplete="off"
            />
          </div>

          {query.trim() ? (
            <ul className="gs-burger-list">
              {results.length ? (
                results.map((g) => (
                  <li key={g.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onPick(g);
                        close();
                      }}
                    >
                      <span className="gs-r-dot" style={{ background: g.accent }} />
                      <span className="gs-cats-name">{g.title}</span>
                      <span className="gs-r-cat">{g.category}</span>
                    </button>
                  </li>
                ))
              ) : (
                <li className="gs-burger-empty">No games match "{query.trim()}"</li>
              )}
            </ul>
          ) : (
            <>
              <ul className="gs-burger-list">
                <li>
                  <Link to="/" onClick={close}>
                    <span className="gs-cats-icon" aria-hidden="true">
                      <RiHomeSmile size={17} />
                    </span>
                    <span className="gs-cats-name">Home</span>
                  </Link>
                </li>
                <li>
                  <Link to="/leaderboards" onClick={close}>
                    <span className="gs-cats-icon" aria-hidden="true">
                      <RiTrophyLine size={17} />
                    </span>
                    <span className="gs-cats-name">Leaderboards</span>
                  </Link>
                </li>
                <li>
                  <Link to="/senevi" onClick={close}>
                    <span className="gs-cats-icon" aria-hidden="true">
                      <SeneviIcon size={18} />
                    </span>
                    <span className="gs-cats-name">Meet Senevi</span>
                  </Link>
                </li>
                <li>
                  <Link to="/rewards" onClick={close}>
                    <span className="gs-cats-icon" aria-hidden="true">
                      <Gift size={16} />
                    </span>
                    <span className="gs-cats-name">Rewards</span>
                  </Link>
                </li>
                <li>
                  <Link to="/clubs" onClick={close}>
                    <span className="gs-cats-icon" aria-hidden="true">
                      <Users size={16} />
                    </span>
                    <span className="gs-cats-name">Clubs</span>
                  </Link>
                </li>
                {theme ? (
                  <li>
                    {/* stays open, so the switch is seen */}
                    <button type="button" onClick={theme.toggle}>
                      <span className="gs-cats-icon" aria-hidden="true">
                        {theme.dark ? <Sun size={16} /> : <Moon size={16} />}
                      </span>
                      <span className="gs-cats-name">{theme.dark ? "Light mode" : "Dark mode"}</span>
                    </button>
                  </li>
                ) : null}
                {!isNative ? (
                  <li>
                    <Link to={GET_APP_PATH} onClick={close}>
                      <span className="gs-cats-icon" aria-hidden="true">
                        <Smartphone size={16} />
                      </span>
                      <span className="gs-cats-name">Get the app</span>
                    </Link>
                  </li>
                ) : null}
              </ul>
              <p className="gs-burger-label">Categories</p>
              <ul className="gs-burger-list">
                {navCategories.map((c) => {
                  const Icon = categoryIcon[c.name];
                  return (
                    <li key={c.name}>
                      <Link to={`/category/${c.name.toLowerCase()}`} onClick={close}>
                        <span className="gs-cats-icon" aria-hidden="true">
                          <Icon size={16} />
                        </span>
                        <span className="gs-cats-name">{c.name}</span>
                        <span className="gs-cats-count">{c.count}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Picking a search result calls `onPick` (the globe spins to it); without it, opens the game.
 * `children` (extra icon buttons) sit just before the account button and stay visible on phones.
 * `mobileMenu`: on phones, search / leaderboards / home / categories / clubs fold into a hamburger
 * menu (and the light / dark switch, when `theme` is given).
 */
export default function GamesNav({
  onPick,
  children,
  mobileMenu = false,
  theme,
}: {
  onPick?: (g: Game) => void;
  children?: ReactNode;
  mobileMenu?: boolean;
  theme?: NavTheme;
}) {
  const navigate = useNavigate();
  // ---- search: filter by title or category, pick → spin that game to the front ----
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hi, setHi] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => searchGames(query), [query]);
  useEffect(() => setHi(0), [query]);
  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  const closeSearch = () => {
    setSearchOpen(false);
    setQuery("");
  };
  const pickGame = (g: Game) => {
    if (onPick) onPick(g);
    else navigate(`/game/${g.id}`);
    closeSearch();
  };
  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeSearch();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHi((h) => Math.min(h + 1, Math.max(0, results.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter" && results[hi]) {
      e.preventDefault();
      pickGame(results[hi]);
    }
  };

  return (
    <nav className={`h3-nav gs-nav${mobileMenu ? " gs-has-burger" : ""}`}>
      <Link className="h3-logo" to="/" aria-label="Senevon Game Studio — home">
        <img className="gs-logo-dark" src="/logo/logo-h-dark-nav.webp" width={432} height={120} alt="Senevon Game Studio" />
        <img className="gs-logo-light" src="/logo/logo-h-light-nav.webp" width={432} height={120} alt="" aria-hidden="true" />
            <img className="h3-logo-mark" src="/logo/mark-256.webp" width={256} height={256} alt="" aria-hidden="true" />
      </Link>
      <div className="h3-nav-end">
        {/* desktop icons (hidden on phones when the hamburger menu is on) */}
        <div className="gs-desk">
        <div className={`gs-search${searchOpen ? " is-open" : ""}`}>
          {searchOpen ? (
            <>
              <input
                ref={searchRef}
                type="search"
                className="gs-search-input"
                placeholder="Search games…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onSearchKey}
                onBlur={() => window.setTimeout(() => !query && closeSearch(), 150)}
                role="combobox"
                aria-expanded={results.length > 0}
                aria-controls="gs-search-results"
                aria-activedescendant={results[hi] ? `gs-r-${results[hi].id}` : undefined}
                aria-label="Search games"
                autoComplete="off"
              />
              {query.trim() ? (
                <ul className="gs-search-results" id="gs-search-results" role="listbox">
                  {results.length ? (
                    results.map((g, i) => (
                      <li
                        key={g.id}
                        id={`gs-r-${g.id}`}
                        role="option"
                        aria-selected={i === hi}
                        className={i === hi ? "is-hi" : ""}
                        onMouseEnter={() => setHi(i)}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          pickGame(g);
                        }}
                      >
                        <span className="gs-r-dot" style={{ background: g.accent }} />
                        <span className="gs-r-title">{g.title}</span>
                        <span className="gs-r-cat">{g.category}</span>
                      </li>
                    ))
                  ) : (
                    <li className="gs-r-empty">No games match "{query.trim()}"</li>
                  )}
                </ul>
              ) : null}
            </>
          ) : null}
          <button
            type="button"
            className="gs-icon-btn"
            aria-label={searchOpen ? "Close search" : "Search games"}
            title={searchOpen ? "Close search" : "Search"}
            onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
          >
            <RiSearchReicon size={21} aria-hidden="true" />
          </button>
        </div>
        <Link className="gs-home" to="/senevi" aria-label="Meet Senevi" title="Meet Senevi">
          <SeneviIcon size={22} />
        </Link>
        <Link className="gs-home" to="/rewards" aria-label="Rewards" title="Rewards">
          <Gift size={21} strokeWidth={1.6} aria-hidden="true" />
        </Link>
        <Link className="gs-home" to="/leaderboards" aria-label="Leaderboards" title="Leaderboards">
          <RiTrophyLine size={22} strokeWidth={1.5} aria-hidden="true" />
        </Link>
        <Link className="gs-home" to="/" aria-label="Home" title="Home">
          <RiHomeSmile size={22} aria-hidden="true" />
        </Link>
        <CategoryMenu />
        </div>
        {/* Clubs and the theme switch: in the phone menu when there is one */}
        <Link className="gs-home gs-clubs gs-desk-only" to="/clubs" aria-label="Clubs" title="Clubs">
          <Users size={21} strokeWidth={1.6} aria-hidden="true" />
        </Link>
        {children}
        {theme ? (
          <button
            type="button"
            className="gs-icon-btn gs-desk-only"
            aria-label={theme.dark ? "Switch to light theme" : "Switch to dark theme"}
            title={theme.dark ? "Light theme" : "Dark theme"}
            onClick={theme.toggle}
          >
            {theme.dark ? <Sun size={19} strokeWidth={1.8} aria-hidden="true" /> : <Moon size={19} strokeWidth={1.8} aria-hidden="true" />}
          </button>
        ) : null}
        <NotifBell className="gs-icon-btn" />
        {mobileMenu ? <MobileMenu onPick={pickGame} theme={theme} /> : null}
        <NavAccount />
      </div>
    </nav>
  );
}
