import { useEffect, useRef, useState, type ReactNode } from "react";
import { SeneviIcon } from "../senevi/Senevi";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { Gift, LayoutGrid, Moon, Smartphone, Sun, Users } from "./anim-icons";
import { MenuToggle } from "./anim-icons/toggles";
import { isNative } from "../lib/native";
import { GET_APP_PATH } from "../lib/appLinks";
import { categories, games, type Game } from "../catalog";
import { categoryIcon } from "../lib/categoryIcons";
import NavAccount from "./NavAccount";
import NotifBell from "./NotifBell";
import { RiHomeSmile, RiSearchReicon, RiTrophyLine } from "./ReIcons";
import SearchPanel from "./SearchPanel";
import { useAuthContext } from "../context/AuthContext";
import { useSiteSearch, type SearchFilter, type SearchItem } from "../lib/siteSearch";

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

/** Icon-only "Categories" button with a dropdown of category pages. */
function CategoryMenu() {
  const [open, setOpen] = useState(false);
  const onCategory = useLocation().pathname.startsWith("/category/");
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
        className={`gs-icon-btn${onCategory ? " active" : ""}`}
        aria-label="Categories"
        data-tip="Categories"
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
 * Phones: one hamburger button opening a panel with home, leaderboards, clubs, the
 * light / dark switch and categories.
 * Closes on outside tap, Escape, or picking anything.
 */
/** Light / dark switch: a header button on wide screens, an item in the phone menu. */
export type NavTheme = { dark: boolean; toggle: () => void };

function MobileMenu({ onPick, theme }: { onPick: (g: Game) => void; theme?: NavTheme }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);

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
  const [filter, setFilter] = useState<SearchFilter>("all");
  const { user } = useAuthContext();
  const { items: results, loading: searching, tooShort } = useSiteSearch(query, filter, user?.id ?? null);
  useEffect(() => setHi(0), [query, filter]);
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
  const pickItem = (item: SearchItem) => {
    if (item.kind === "game") return pickGame(item.game);
    navigate(item.to);
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
      pickItem(results[hi]);
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
        {/* search: always in the header, phones too */}
        <div className={`gs-search${searchOpen ? " is-open" : ""}`}>
          {searchOpen ? (
            <>
              <input
                ref={searchRef}
                type="search"
                className="gs-search-input"
                placeholder={filter === "players" ? "Search players…" : filter === "clubs" ? "Search clubs or #ID…" : filter === "games" ? "Search games…" : filter === "pages" ? "Search pages…" : "Search games, players, clubs…"}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onSearchKey}
                onBlur={() => window.setTimeout(() => !query && closeSearch(), 150)}
                role="combobox"
                aria-expanded={results.length > 0}
                aria-controls="gs-search-results"
                aria-activedescendant={results[hi] ? `gs-search-results-${hi}` : undefined}
                aria-label="Search games, players, clubs and pages"
                autoComplete="off"
              />
              <SearchPanel
                className="gs-search-results"
                listId="gs-search-results"
                query={query}
                filter={filter}
                onFilter={(f) => {
                  setFilter(f);
                  searchRef.current?.focus();
                }}
                items={results}
                loading={searching}
                tooShort={tooShort}
                hi={hi}
                onHi={setHi}
                onPick={pickItem}
              />
            </>
          ) : null}
          <button
            type="button"
            className="gs-icon-btn"
            aria-label={searchOpen ? "Close search" : "Search"}
            data-tip={searchOpen ? "Close search" : "Search"}
            onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
          >
            <RiSearchReicon size={21} aria-hidden="true" />
          </button>
        </div>
        <div className="gs-desk">
        {/* NavLink: the current page's button gets .active (orange tint, pressed in) */}
        <NavLink className="gs-home" to="/senevi" aria-label="Meet Senevi" data-tip="Meet Senevi">
          <SeneviIcon size={22} />
        </NavLink>
        <NavLink className="gs-home" to="/rewards" aria-label="Rewards" data-tip="Rewards">
          <Gift size={21} strokeWidth={1.6} aria-hidden="true" />
        </NavLink>
        <NavLink className="gs-home" to="/leaderboards" aria-label="Leaderboards" data-tip="Leaderboards">
          <RiTrophyLine size={22} strokeWidth={1.5} aria-hidden="true" />
        </NavLink>
        <NavLink className="gs-home" to="/" end aria-label="Home" data-tip="Home">
          <RiHomeSmile size={22} aria-hidden="true" />
        </NavLink>
        <CategoryMenu />
        </div>
        {/* Clubs and the theme switch: in the phone menu when there is one */}
        <NavLink className="gs-home gs-clubs gs-desk-only" to="/clubs" aria-label="Clubs" data-tip="Clubs">
          <Users size={21} strokeWidth={1.6} aria-hidden="true" />
        </NavLink>
        {children}
        {theme ? (
          <button
            type="button"
            className="gs-icon-btn gs-desk-only"
            aria-label={theme.dark ? "Switch to light theme" : "Switch to dark theme"}
            data-tip={theme.dark ? "Light mode" : "Dark mode"}
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
