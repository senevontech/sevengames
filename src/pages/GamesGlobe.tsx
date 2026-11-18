import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { LayoutGrid, Play, Pointer } from "lucide-react";
import { categories, games, type Game } from "../catalog";
import { categoryIcon } from "../lib/categoryIcons";
import NavAccount from "../components/NavAccount";
import { RiHomeSmile, RiSearchReicon, RiTrophyLine } from "../components/ReIcons";
import { inkFor } from "../components/FeatureCarousel";
import "./home3.css";
import "./games-globe.css";

// categories that actually have games, with their counts (for the nav's categories menu)
const navCategories = categories
  .filter((c): c is Game["category"] => c !== "All")
  .map((c) => ({ name: c, count: games.filter((g) => g.category === c).length }))
  .filter((c) => c.count > 0);

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

/*
 * /games: every game as a circular card on a 3D glass globe.
 * Cards sit on latitude rings around a sphere (CSS 3D). Drag / swipe / wheel / arrow keys spin
 * it with inertia, and it settles with the nearest card facing you; that card is enlarged with
 * an orange glow ring and its name is shown top-left. Click the front card to play, any other
 * card to bring it to the front.
 */

// Latitude rings (degrees, + is below the equator in CSS space) and how many cards each holds.
// Spaced so every card is ~28° from its neighbours, also near the poles (a ring of several cards
// right next to a pole would bunch them up and overlap): n ≈ 360·cos(lat) / 28.
const RINGS: { lat: number; n: number }[] = [
  { lat: -90, n: 1 },
  { lat: -56, n: 7 },
  { lat: -28, n: 11 },
  { lat: 0, n: 13 },
  { lat: 28, n: 11 },
  { lat: 56, n: 7 },
  { lat: 90, n: 1 },
];
const PITCH_LIMIT = 60;
const DEG = Math.PI / 180;

type Slot = { lat: number; lon: number; game: Game };

/** Lay the games around the globe (repeating as needed); rings are offset so they interleave. */
function buildSlots(): Slot[] {
  const out: Slot[] = [];
  let k = 0;
  RINGS.forEach((ring, ri) => {
    for (let i = 0; i < ring.n; i++) {
      const lon = (360 / ring.n) * i + (ri % 2 ? 180 / ring.n : 0);
      out.push({ lat: ring.lat, lon, game: games[(k * 7) % games.length] });
      k++;
    }
  });
  return out;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
/** Shortest signed angle from a to b, in degrees. */
const angleTo = (a: number, b: number) => ((((b - a) % 360) + 540) % 360) - 180;

export default function GamesGlobe() {
  const navigate = useNavigate();
  const slots = useMemo(buildSlots, []);
  const sphereRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  // Start with Drift Nexus facing the viewer if it's there (matches the reference), else slot 0.
  const startSlot = Math.max(0, slots.findIndex((s) => s.game.id === "drift-nexus" && s.lat === 0));
  const [activeIdx, setActiveIdx] = useState(startSlot);
  const active = slots[activeIdx].game;
  const goTo = useRef<(i: number) => void>(() => {});

  // ---- search: filter by title or category, pick → spin that game to the front ----
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hi, setHi] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [] as Game[];
    const starts = games.filter((g) => g.title.toLowerCase().startsWith(q));
    const rest = games.filter(
      (g) => !starts.includes(g) && (g.title.toLowerCase().includes(q) || g.category.toLowerCase().includes(q)),
    );
    return [...starts, ...rest].slice(0, 6);
  }, [query]);
  useEffect(() => setHi(0), [query]);
  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  const closeSearch = () => {
    setSearchOpen(false);
    setQuery("");
  };
  /** Spin the globe to a game: prefer its copy on the equator (nearest a natural front view). */
  const pickGame = (g: Game) => {
    const candidates = slots.map((s, i) => ({ s, i })).filter(({ s }) => s.game.id === g.id);
    const best = candidates.sort((a, b) => Math.abs(a.s.lat) - Math.abs(b.s.lat))[0];
    if (best) goTo.current(best.i);
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

  useEffect(() => {
    const sphere = sphereRef.current!;
    const stage = stageRef.current!;
    const cards = Array.from(sphere.querySelectorAll<HTMLElement>(".gs-card"));
    const prevTitle = document.title;
    document.title = "All games — Senevon Game Studio";
    document.documentElement.classList.add("no-scroll");

    // Rotation state (degrees) + velocity; target is used when settling / jumping to a card.
    let yaw = -slots[startSlot].lon;
    let pitch = -slots[startSlot].lat;
    let vy = 0;
    let vp = 0;
    let target: { yaw: number; pitch: number } | null = null;
    let dragging = false;
    let moved = 0;
    let lastX = 0;
    let lastY = 0;
    let lastT = 0;
    let current = -1;

    const sens = () => 180 / Math.max(320, sphere.offsetWidth * 1.6); // degrees per px

    // Finds the card facing the viewer and fades every card by how directly it faces you, so the
    // cards themselves draw the globe (no sphere behind them): full at the front, gone at the rim.
    const frontIndex = () => {
      let best = -Infinity;
      let bi = 0;
      const cy = Math.cos(yaw * DEG);
      const sy = Math.sin(yaw * DEG);
      const cp = Math.cos(pitch * DEG);
      const sp = Math.sin(pitch * DEG);
      slots.forEach((s, i) => {
        const cl = Math.cos(s.lat * DEG);
        const px = cl * Math.sin(s.lon * DEG);
        const py = Math.sin(s.lat * DEG);
        const pz = cl * Math.cos(s.lon * DEG);
        // Sphere = rotateX(-pitch) rotateY(yaw): first Y, then X (CSS: z' = y·sin a + z·cos a).
        const z1 = -px * sy + pz * cy;
        const z = -py * sp + z1 * cp;
        const el = cards[i];
        if (el) {
          // Fades in from just past the rim so edge cards read as thin tilted discs.
          const o = clamp((z + 0.02) / 0.42, 0, 1);
          el.style.opacity = String(o * o * (3 - 2 * o));
          el.style.visibility = o > 0 ? "visible" : "hidden";
          // Size tapers with distance from the centre: 1.3× for the card facing you, ~1× for its
          // neighbours (z ≈ 0.88), down to ~0.45× at the rim. The base size is set so that
          // neighbouring cards never overlap at these scales.
          const f = Math.max(z, 0);
          el.style.setProperty("--gs-s", (0.45 + 0.85 * f * f * f).toFixed(3));
        }
        if (z > best) {
          best = z;
          bi = i;
        }
      });
      return bi;
    };

    const settleOn = (i: number) => {
      const s = slots[i];
      target = { yaw: yaw + angleTo(yaw, -s.lon), pitch: clamp(-s.lat, -PITCH_LIMIT, PITCH_LIMIT) };
      vy = vp = 0;
    };
    goTo.current = settleOn;

    const onDown = (e: PointerEvent) => {
      dragging = true;
      moved = 0;
      target = null;
      vy = vp = 0;
      lastX = e.clientX;
      lastY = e.clientY;
      lastT = performance.now();
      stage.classList.add("is-dragging");
      stage.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      const now = performance.now();
      const dt = Math.max(1, now - lastT);
      const k = sens();
      yaw += dx * k;
      pitch = clamp(pitch + dy * k, -PITCH_LIMIT, PITCH_LIMIT);
      moved += Math.abs(dx) + Math.abs(dy);
      vy = vy * 0.5 + ((dx * k) / dt) * 16 * 0.5;
      vp = vp * 0.5 + ((dy * k) / dt) * 16 * 0.5;
      lastX = e.clientX;
      lastY = e.clientY;
      lastT = now;
    };
    const onUp = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      stage.classList.remove("is-dragging");
      if (performance.now() - lastT > 80) vy = vp = 0;
      if (moved < 6) {
        // Tap: front card plays, any other card rotates to the front.
        const el = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>(".gs-card");
        if (el?.dataset.i) {
          const i = Number(el.dataset.i);
          if (i === current) navigate(`/game/${slots[i].game.id}`);
          else settleOn(i);
        }
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      target = null;
      vy -= e.deltaX * 0.012;
      vp -= e.deltaY * 0.01;
    };
    const onKey = (e: KeyboardEvent) => {
      // Typing in the search box (or any field) must not spin the globe or leave the page
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "Escape") navigate(-1);
      if (e.key === "Enter" && current >= 0 && document.activeElement === document.body) navigate(`/game/${slots[current].game.id}`);
      const step = 360 / 13;
      if (e.key === "ArrowLeft") target = { yaw: yaw + step, pitch };
      if (e.key === "ArrowRight") target = { yaw: yaw - step, pitch };
      if (e.key === "ArrowUp") target = { yaw, pitch: clamp(pitch + 26, -PITCH_LIMIT, PITCH_LIMIT) };
      if (e.key === "ArrowDown") target = { yaw, pitch: clamp(pitch - 26, -PITCH_LIMIT, PITCH_LIMIT) };
    };
    const onClick = (e: MouseEvent) => {
      // Cards are links for keyboard / new-tab use; mouse taps go through the tap logic above.
      e.preventDefault();
      if (e.detail === 0) {
        const el = (e.target as HTMLElement).closest<HTMLElement>(".gs-card");
        if (el?.dataset.i) navigate(`/game/${slots[Number(el.dataset.i)].game.id}`);
      }
    };

    stage.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    stage.addEventListener("wheel", onWheel, { passive: false });
    stage.addEventListener("click", onClick);
    window.addEventListener("keydown", onKey);

    let idle = 0;
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (!dragging) {
        if (target) {
          yaw += (target.yaw - yaw) * 0.12;
          pitch += (target.pitch - pitch) * 0.12;
          if (Math.abs(target.yaw - yaw) < 0.05 && Math.abs(target.pitch - pitch) < 0.05) {
            yaw = target.yaw;
            pitch = target.pitch;
            target = null;
          }
        } else {
          yaw += vy;
          pitch = clamp(pitch + vp, -PITCH_LIMIT, PITCH_LIMIT);
          vy *= 0.94;
          vp *= 0.9;
          if (Math.abs(vy) + Math.abs(vp) < 0.04) {
            vy = vp = 0;
            // Nearly stopped: settle with the nearest card facing the viewer.
            if (++idle > 8 && current >= 0) {
              const s = slots[current];
              const dy = angleTo(yaw, -s.lon);
              const dp = clamp(-s.lat, -PITCH_LIMIT, PITCH_LIMIT) - pitch;
              if (Math.abs(dy) > 0.05 || Math.abs(dp) > 0.05) target = { yaw: yaw + dy, pitch: pitch + dp };
            }
          } else idle = 0;
        }
      }
      sphere.style.transform = `rotateX(${-pitch}deg) rotateY(${yaw}deg)`;

      const fi = frontIndex();
      if (fi !== current) {
        if (current >= 0) cards[current]?.classList.remove("is-front");
        cards[fi]?.classList.add("is-front");
        current = fi;
        setActiveIdx(fi);
      }
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      stage.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      stage.removeEventListener("wheel", onWheel);
      stage.removeEventListener("click", onClick);
      window.removeEventListener("keydown", onKey);
      document.documentElement.classList.remove("no-scroll");
      document.title = prevTitle;
    };
  }, [navigate, slots, startSlot]);

  return (
    <div
      className={`gs h3${inkFor(active.accent) === "#ffffff" ? " gs-on-dark" : ""}`}
      // The page takes the front game's colour; text / buttons flip to whichever ink reads on it.
      style={{ "--gs-bg": active.accent, "--gs-ink": inkFor(active.accent) } as React.CSSProperties}
    >
      <nav className="h3-nav gs-nav">
        <Link className="h3-logo" to="/" aria-label="Senevon Game Studio — home">
          <img className="gs-logo-dark" src="/logo/logo-h-dark-nav.webp" width={432} height={120} alt="Senevon Game Studio" />
          <img className="gs-logo-light" src="/logo/logo-h-light-nav.webp" width={432} height={120} alt="" aria-hidden="true" />
        </Link>
        <div className="h3-nav-end">
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
          <Link className="gs-home" to="/leaderboards" aria-label="Leaderboards" title="Leaderboards">
            <RiTrophyLine size={22} aria-hidden="true" />
          </Link>
          <Link className="gs-home" to="/" aria-label="Home" title="Home">
            <RiHomeSmile size={22} aria-hidden="true" />
          </Link>
          <CategoryMenu />
          <NavAccount />
        </div>
      </nav>

      {/* Front game */}
      <div className="gs-title" key={active.id}>
        <h1>{active.title}</h1>
        <svg className="gs-swoosh" viewBox="0 0 220 26" aria-hidden="true">
          <path d="M4 22 C 60 6, 140 2, 216 6" />
        </svg>
        <p className="gs-meta">
          {active.category} · {active.difficulty} · ~{active.minutes} min
        </p>
        <Link className="gs-play" to={`/game/${active.id}`}>
          <span className="gs-play-icon" aria-hidden="true">
            <Play size={16} strokeWidth={2.4} />
          </span>
          Play now
        </Link>
      </div>

      <div ref={stageRef} className="gs-stage">
        <div className="gs-globe">
          <div ref={sphereRef} className="gs-sphere">
            {slots.map((s, i) => (
              <a
                key={i}
                href={`/game/${s.game.id}`}
                className={`gs-card${i === startSlot ? " is-front" : ""}`}
                data-i={i}
                draggable={false}
                aria-label={`${s.game.title}${i === activeIdx ? " (play)" : ""}`}
                tabIndex={i === activeIdx ? 0 : -1}
                style={
                  {
                    transform: `rotateY(${s.lon}deg) rotateX(${-s.lat}deg) translateZ(var(--gs-r))`,
                    "--gs-accent": s.game.accent,
                  } as React.CSSProperties
                }
              >
                <span className="gs-face">
                  {s.game.poster ? (
                    <img src={s.game.poster} alt="" draggable={false} loading="lazy" />
                  ) : (
                    <span className="gs-fallback">
                      <b>{s.game.title}</b>
                      <i>{s.game.category}</i>
                    </span>
                  )}
                </span>
              </a>
            ))}
          </div>
        </div>
      </div>

      <p className="gs-hint">
        <Pointer size={16} strokeWidth={1.8} aria-hidden="true" />
        Drag to spin · tap a game
      </p>
    </div>
  );
}
