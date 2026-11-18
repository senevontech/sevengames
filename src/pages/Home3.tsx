import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { House, Play, Trophy } from "lucide-react";
import { categories, games, scoreLabel, type Game, type GameCategory } from "../catalog";
import { categoryIcon } from "../lib/categoryIcons";
import { useBestForGame } from "../hooks/useBest";
import NavAccount from "../components/NavAccount";
import TokenPill from "../components/TokenPill";
import FeatureCarousel from "../components/FeatureCarousel";
import LaptopIconSmoke from "../components/LaptopIconSmoke";
import "../components/feature-carousel.css";
import AdSlot from "../components/AdSlot";
import "./home3.css";

/*
 * Home page: minimal, flat design (#dbdbdb). Nav, a compact text hero, the game library as solid
 * cards with a category sidebar that slides in after the hero, and the Studio footer.
 */

// Only categories that actually have games, in catalog order.
const usedCategories = categories.filter((c) => c === "All" || games.some((g) => g.category === c));
// Featured carousel on /home3: the games that have poster art.
const featuredGames = games.filter((g) => g.poster);

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/* ------------------------------------------------------------------ */
/* Game card                                                           */
/* ------------------------------------------------------------------ */

function GlassCard({ game, index }: { game: Game; index: number }) {
  const ref = useRef<HTMLAnchorElement>(null);
  const numRef = useRef<HTMLElement>(null);
  const best = useBestForGame(game.id);

  // Reveal on scroll (lift + un-blur) and count the minutes up once.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    let settle = 0;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        el.classList.add("in");
        settle = window.setTimeout(() => el.classList.add("settled"), 1300 + (index % 4) * 70);
        io.disconnect();
        const t0 = performance.now() + (index % 4) * 70;
        const tick = (now: number) => {
          const t = ease(clamp((now - t0) / 900));
          if (numRef.current) numRef.current.textContent = `${Math.round(game.minutes * t)}`;
          if (t < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
      window.clearTimeout(settle);
    };
  }, [game.minutes, index]);

  function tilt(e: React.PointerEvent<HTMLAnchorElement>) {
    if (e.pointerType !== "mouse") return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    e.currentTarget.style.setProperty("--ry", `${x * 8}deg`);
    e.currentTarget.style.setProperty("--rx", `${-y * 8}deg`);
  }
  function untilt(e: React.PointerEvent<HTMLAnchorElement>) {
    e.currentTarget.style.setProperty("--ry", "0deg");
    e.currentTarget.style.setProperty("--rx", "0deg");
  }

  return (
    <Link
      ref={ref}
      to={`/game/${game.id}`}
      className="h3-gcard"
      style={{ "--d": `${(index % 4) * 70}ms` } as React.CSSProperties}
      onPointerMove={tilt}
      onPointerLeave={untilt}
      aria-label={`Play ${game.title}`}
    >
      <h4>{game.title}</h4>
      <p className="h3-card-note">
        {game.category} · {game.difficulty}
      </p>
      <div className="h3-card-num">
        <b ref={numRef}>0</b>
        <small>min</small>
      </div>
      <span className="h3-chip h3-gcard-tag">Play ›</span>
      <div className="h3-gcard-media">
        {game.poster ? (
          <img src={game.poster} alt="" loading="lazy" decoding="async" />
        ) : (
          <span className="h3-gcard-fallback" style={{ background: game.accent }}>
            {game.title.charAt(0)}
          </span>
        )}
      </div>
      <p className="h3-card-foot">{best !== null ? `${scoreLabel(game)} · ${best}` : "Not played yet"}</p>
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

// /home3 test page: looping dusk video behind the hero, then a scroll-scrubbed "dive" into the
// laptop screen that ends on solid orange behind the game library.
const HERO_VIDEO = "/images/home3/hero-bg.mp4"; // 1920×1080 H.264, 8 s, no audio, loops seamlessly
const HERO_POSTER = "/images/home3/hero-bg-poster.webp"; // its first frame, shown while it loads
// 1280×720, 8 s, every frame a keyframe so scroll-seeking is instant. Its first frame matches the
// hero loop's, and it ends on flat orange (#fc6e1b).
const DIVE_VIDEO = "/images/home3/dive.mp4";

/** `videoHero` (the /home3 test page) adds the video hero and the scroll dive. */
export default function Home3({ videoHero = false }: { videoHero?: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLElement>(null);
  const loopRef = useRef<HTMLVideoElement>(null);
  const diveRef = useRef<HTMLVideoElement>(null);
  const shadeRef = useRef<HTMLDivElement>(null);
  const smokeRef = useRef<HTMLDivElement>(null);
  const fcRef = useRef<HTMLDivElement>(null);
  // Text colour of the current carousel slide (white or near-black), used by the transparent nav.
  const [navInk, setNavInk] = useState("#ffffff");

  // Scroll dive: over the first hero-height of scrolling the hero loop hands over to the dive
  // video, which scrubs with the scroll position (eased, so it glides) until it reaches orange.
  useEffect(() => {
    if (!videoHero) return;
    const loop = loopRef.current!;
    const dive = diveRef.current!;
    const shade = shadeRef.current!;
    let raf = 0;
    let cur = 0;
    let lastSet = -1;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const heroH = heroRef.current?.offsetHeight ?? window.innerHeight;
      const target = clamp(window.scrollY / (heroH * 0.95));
      cur += (target - cur) * 0.18;
      if (Math.abs(target - cur) < 0.0005) cur = target;

      // Hand-over: the loop fades out over the first few % of the dive (same opening shot).
      const handOver = clamp(cur / 0.06);
      loop.style.opacity = `${1 - handOver}`;
      if (handOver >= 1 && !loop.paused) loop.pause();
      else if (handOver < 1 && loop.paused) void loop.play().catch(() => {});
      // The sky shade behind the hero text fades as the camera dives in.
      shade.style.opacity = `${1 - clamp(cur / 0.35)}`;
      // The icon smoke from the laptop fades out as the dive starts (it stops spawning at 0).
      if (smokeRef.current) smokeRef.current.style.opacity = `${1 - clamp(cur / 0.12)}`;
      // The pinned carousel fades in as the dive lands on orange (its colour matches the last frame).
      const fc = fcRef.current;
      if (fc) {
        const show = clamp((cur - 0.82) / 0.16);
        fc.style.opacity = `${show}`;
        fc.style.visibility = show > 0 ? "visible" : "hidden";
        if (show > 0.9) fc.removeAttribute("data-inactive");
        else fc.setAttribute("data-inactive", "");
        // Nav text follows the carousel's text colour once it's on screen
        rootRef.current?.classList.toggle("h3-at-fc", show > 0.5);
      }

      if (dive.readyState >= 1 && dive.duration) {
        const t = cur * (dive.duration - 0.05);
        if (Math.abs(t - lastSet) > 1 / 60 && !dive.seeking) {
          dive.currentTime = t;
          lastSet = t;
        }
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [videoHero]);
  const location = useLocation();
  // Links from the rest of the site use "/?category=X#games", "/#games" and "/#studio".
  const urlCategory = new URLSearchParams(location.search).get("category");
  const [category, setCategory] = useState<GameCategory | "All">(
    urlCategory && usedCategories.includes(urlCategory as GameCategory) ? (urlCategory as GameCategory) : "All",
  );
  useEffect(() => {
    const c = new URLSearchParams(location.search).get("category");
    if (c && usedCategories.includes(c as GameCategory)) setCategory(c as GameCategory);
    if (c || location.hash === "#games") {
      requestAnimationFrame(() => document.getElementById("h3-library")?.scrollIntoView({ block: "start" }));
    } else if (location.hash === "#studio") {
      requestAnimationFrame(() => document.getElementById("studio")?.scrollIntoView({ block: "start" }));
    }
  }, [location.search, location.hash]);
  const list = useMemo(
    () => (category === "All" ? games : games.filter((g) => g.category === category)),
    [category],
  );

  function pick(c: GameCategory | "All") {
    setCategory(c);
    document.getElementById("h3-library")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Page chrome (title, flat background on html/body) and the scroll-driven classes:
  // h3-scrolled turns the nav band on, h3-past-hero slides the sidebar in.
  useEffect(() => {
    const root = rootRef.current!;
    const prevTitle = document.title;
    const prevHtmlBg = document.documentElement.style.background;
    const prevBodyBg = document.body.style.background;
    document.title = "Senevon Game Studio — A Universe of Games";
    document.documentElement.style.background = "#dbdbdb";
    document.body.style.background = "#dbdbdb";

    const onScroll = () => {
      const heroH = heroRef.current?.offsetHeight ?? 400;
      root.classList.toggle("h3-scrolled", window.scrollY > 24);
      root.classList.toggle("h3-past-hero", window.scrollY > heroH * 0.7);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      document.title = prevTitle;
      document.documentElement.style.background = prevHtmlBg;
      document.body.style.background = prevBodyBg;
    };
  }, []);

  return (
    <div
      className={`h3 h3-min${videoHero ? " h3-vhero" : ""}${navInk !== "#ffffff" ? " h3-fc-dark" : ""}`}
      ref={rootRef}
      style={{ "--h3-fc-ink": navInk } as React.CSSProperties}
    >
      {videoHero ? (
        // Fixed background behind the whole page: the hero loop on top, the dive underneath.
        <div className="h3-bgfx" aria-hidden="true">
          <video ref={diveRef} className="h3-bg-dive" src={DIVE_VIDEO} poster={HERO_POSTER} muted playsInline preload="auto" />
          <video ref={loopRef} className="h3-bg-loop" src={HERO_VIDEO} poster={HERO_POSTER} autoPlay muted loop playsInline preload="auto" />
          <div ref={shadeRef} className="h3-bg-shade" />
          <LaptopIconSmoke layerRef={smokeRef} videoRef={loopRef} />
        </div>
      ) : null}

      <nav className="h3-nav">
        <Link className="h3-logo" to="/" aria-label="Senevon Game Studio — home">
          <img className="h3-logo-dark" src="/logo/logo-h-dark-nav.webp" width={432} height={120} alt="Senevon Game Studio" />
          {videoHero ? (
            // White-text logo while the nav sits over the dark video (swapped by CSS)
            <img className="h3-logo-light" src="/logo/logo-h-light-nav.webp" width={432} height={120} alt="" aria-hidden="true" />
          ) : null}
        </Link>
        {videoHero ? (
          // landing: white pill buttons (tokens, "Play now" → game globe) beside the account button
          <div className="h3-nav-end h3-nav-pills">
            <TokenPill variant="solid" />
            <Link className="h3-pill-btn h3-play-btn" to="/games" aria-label="Play now" title="Play now">
              <span className="h3-play-icon" aria-hidden="true">
                <Play size={12} fill="currentColor" strokeWidth={0} />
              </span>
              <span className="h3-play-label">Play now</span>
            </Link>
            <NavAccount />
          </div>
        ) : (
          <>
            <div className="h3-menu">
              <a href="#h3-library">
                Games
                <i className="h3-chev" />
              </a>
              <a href="#h3-library" onClick={() => setCategory("Action")}>
                Categories
                <i className="h3-chev" />
              </a>
              <Link to="/leaderboards">
                Leaderboards
                <i className="h3-chev" />
              </Link>
              <a href="#studio">
                Studio
                <i className="h3-chev" />
              </a>
            </div>
            <NavAccount />
          </>
        )}
      </nav>

      {!videoHero ? (
        <>
        {/* Sidebar: slides in after the hero */}
        <aside className="h3-rail" aria-label="Browse games">
          {/* Neon border glow (a blurred copy of the ring drawn by .h3-rail::before) */}
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
              <button
                key={c}
                type="button"
                className={`h3-rail-item${category === c ? " active" : ""}`}
                data-label={c === "All" ? "All games" : c}
                aria-pressed={category === c}
                onClick={() => pick(c)}
              >
                <Icon size={18} />
              </button>
            );
          })}
          <span className="h3-rail-sep" aria-hidden="true" />
          <Link to="/leaderboards" className="h3-rail-item" data-label="Leaderboards">
            <Trophy size={18} />
          </Link>
        </aside>
        </>
      ) : null}

      {/* Compact text hero */}
      <header className="h3-hero" ref={heroRef}>
        <span className="h3-chip">Senevon Game Studio</span>
        <h1>
          <span className="h3-line">
            <span>A Universe of Games</span>
          </span>
        </h1>
        <p className="h3-subtitle">
          Hand-crafted browser games you can play in one click — no downloads, one account, global
          leaderboards.
        </p>
        <p className="h3-caption">
          Play instantly,
          <br />
          discover new worlds,
          <br />
          and be part of a global gaming universe.
        </p>
      </header>

      {/* /home3: featured games carousel where the dive lands on orange */}
      {videoHero && featuredGames.length >= 3 ? (
        <>
          {/* Scroll room for the dive; the carousel itself is pinned and fades in on top */}
          <div className="h3-dive-space" aria-hidden="true" />
          <div ref={fcRef} className="h3-fcwrap" data-inactive="">
            <FeatureCarousel items={featuredGames} onInk={setNavInk} />
          </div>
          {/* Time on the carousel before the footer slides up over it */}
          <div className="h3-fc-space" aria-hidden="true" />
        </>
      ) : null}

      {!videoHero ? (
        <section className="h3-library" id="h3-library">
          <header className="h3-lib-head">
            <span className="h3-chip">Game library</span>
            <h2>{category === "All" ? "Pick a world. Play instantly." : category}</h2>
            <p>
              {list.length} {list.length === 1 ? "game" : "games"} · free · no downloads
            </p>
          </header>
  
          <div className="h3-grid" key={category}>
            {list.map((g, i) => (
              <GlassCard key={g.id} game={g} index={i} />
            ))}
          </div>
        </section>
      ) : null}

      {/* Studio: about + footer */}
      <>
        <footer className="h3-studio" id="studio">
          <span className="h3-chip">The studio</span>
          <h2>Senevon Game Studio</h2>
          <p className="h3-studio-lead">
            We build hand-crafted browser games you can play in a single click — from one-minute reflex
            tests to open-world adventures, all saved to one account and ranked on global leaderboards.
          </p>
          <ul className="h3-studio-stats">
            <li>
              <b>{games.length}</b>
              <span>Games</span>
            </li>
            <li>
              <b>{usedCategories.length - 1}</b>
              <span>Categories</span>
            </li>
            <li>
              <b>100%</b>
              <span>Free to play</span>
            </li>
          </ul>
          <nav className="h3-studio-links" aria-label="Footer">
            {videoHero ? <Link to="/games">All games</Link> : <a href="#h3-library">Games</a>}
            <Link to="/leaderboards">Leaderboards</Link>
            <Link to="/login">Sign in</Link>
            <Link to="/privacy">Privacy policy</Link>
          </nav>
          <AdSlot placement="home-footer" className="h3-ad" />
          <p className="h3-studio-copy">© {new Date().getFullYear()} Senevon Game Studio</p>
        </footer>
      </>
    </div>
  );
}
