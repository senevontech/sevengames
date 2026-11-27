import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { House, Trophy } from "../components/anim-icons";
import { categories, games, getGame, scoreLabel, type Game, type GameCategory } from "../catalog";
import { categoryIcon } from "../lib/categoryIcons";
import { useBestForGame } from "../hooks/useBest";
import "./home2.css";

/*
 * /home2 — floating-island scroll fly-in (test page) with Senevon content.
 *
 * Structure: hero, then the whole game library as glass cards. The fly-in stage stays pinned
 * behind everything and keeps scrubbing as you scroll; a glass sidebar slides in once you pass
 * the hero. Visuals and motion logic come from the "Mossline" mock; content is Senevon's.
 * One requestAnimationFrame controller drives the stage; cards reveal via IntersectionObserver.
 */

const VIDEO =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20261106_025717_906b686d-9a9a-4dea-bab4-ae2454f8390e.mp4";
const STILL =
  "https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20261106_031618_8ce6dca1-972d-429d-8d13-bf0691c37848.png&w=2400&q=88";
const CUTOUT =
  "https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20261106_031657_baaa3380-5ece-482a-a623-a1838fd7653c.png&w=2400&q=90";
const ROCKS =
  "https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20261106_025635_82593f6a-1cf7-41c1-94ac-96fb89ebfd1a.png&w=2400&q=85";
const FONTS = "https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap";

/** Crop a rock out of the 1200×678 sprite sheet. */
function crop(x: number, y: number, w: number, h: number): React.CSSProperties {
  return { width: `${(1200 / w) * 100}%`, left: `${(-x / w) * 100}%`, top: `${(-y / h) * 100}%` };
}

const featured = getGame("skyrealm") ?? games[0];
// Only categories that actually have games, in catalog order.
const usedCategories = categories.filter((c) => c === "All" || games.some((g) => g.category === c));

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const seg = (p: number, a: number, b: number) => clamp((p - a) / (b - a));
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/* ------------------------------------------------------------------ */
/* Glass game card (styled after the station card)                     */
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
      className="ml-gcard"
      style={{ "--d": `${(index % 4) * 70}ms` } as React.CSSProperties}
      onPointerMove={tilt}
      onPointerLeave={untilt}
      aria-label={`Play ${game.title}`}
    >
      <h4>{game.title}</h4>
      <p className="ml-card-note">
        {game.category} · {game.difficulty}
      </p>
      <div className="ml-card-num">
        <b ref={numRef}>0</b>
        <small>min</small>
      </div>
      <span className="ml-chip ml-gcard-tag">Play ›</span>
      <div className="ml-gcard-media">
        {game.poster ? (
          <img src={game.poster} alt="" loading="lazy" decoding="async" />
        ) : (
          <span className="ml-gcard-fallback" style={{ background: game.accent }}>
            {game.title.charAt(0)}
          </span>
        )}
      </div>
      <p className="ml-card-foot">{best !== null ? `${scoreLabel(game)} · ${best}` : "Not played yet"}</p>
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function Home2() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [category, setCategory] = useState<GameCategory | "All">("All");
  const list = useMemo(
    () => (category === "All" ? games : games.filter((g) => g.category === category)),
    [category],
  );

  function pick(c: GameCategory | "All") {
    setCategory(c);
    document.getElementById("ml-library")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  useEffect(() => {
    const root = rootRef.current!;
    const q = <T extends Element = HTMLElement>(s: string) => root.querySelector(s) as T;
    const qa = <T extends Element = HTMLElement>(s: string) => Array.from(root.querySelectorAll(s)) as T[];

    // ---- page chrome: title, fonts, mist background on html/body ----
    const prevTitle = document.title;
    document.title = "Senevon Game Studio — A Universe of Games";
    const links = [
      Object.assign(document.createElement("link"), { rel: "preconnect", href: "https://fonts.googleapis.com" }),
      Object.assign(document.createElement("link"), { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "" }),
      Object.assign(document.createElement("link"), { rel: "stylesheet", href: FONTS }),
    ];
    links.forEach((l) => document.head.appendChild(l));
    const prevHtmlBg = document.documentElement.style.background;
    const prevBodyBg = document.body.style.background;
    document.documentElement.style.background = "#e7ebe8";
    document.body.style.background = "#e7ebe8";

    const story = q("#ml-story");
    const cams = qa(".ml-cam");
    const plate = q<HTMLImageElement>(".ml-plate");
    const camF = q(".ml-camF");
    const cv = q<HTMLCanvasElement>(".ml-cv");
    const ctx = cv.getContext("2d")!;
    const video = q<HTMLVideoElement>(".ml-push");
    const L0 = q(".ml-L0");
    const L1 = q(".ml-L1");
    const heroCopy = q(".ml-hero-copy");
    const heroLine = q(".ml-line");
    const heroH1 = q("h1");
    const hud = q(".ml-hud");
    const caption = q(".ml-caption");
    const hint = q(".ml-hint");
    const libHead = q(".ml-lib-head");
    const rocks = qa(".ml-rock").map((el) => ({
      el,
      x: Number(el.dataset.x),
      y: Number(el.dataset.y),
      d: Number(el.dataset.d),
    }));
    const prog = q(".ml-prog i");

    // ---- video frame cache + canvas scrubbing ----
    const FPS = 24;
    let NF = 2;
    let frames: (Blob | undefined)[] = [];
    let want = 0;
    let shown = -1;
    let busy = false;
    let tainted = false; // CDN without CORS → canvas can't be read; fall back to live seeking
    let disposed = false;
    const grab = document.createElement("canvas");
    grab.width = 1600;
    grab.height = 900;
    const gctx = grab.getContext("2d")!;

    const nearest = (t: number) => {
      for (let k = 0; k < NF; k++) {
        if (frames[t - k]) return t - k;
        if (frames[t + k]) return t + k;
      }
      return -1;
    };

    const drawCover = (src: CanvasImageSource, bw: number, bh: number) => {
      const s = Math.max(cv.width / bw, cv.height / bh);
      const w = bw * s;
      const h = bh * s;
      ctx.drawImage(src, (cv.width - w) / 2, (cv.height - h) / 2, w, h);
    };

    const drawWant = async () => {
      if (busy || disposed) return;
      if (tainted) {
        if (shown === want || video.seeking) return;
        busy = true;
        video.currentTime = Math.min(want / FPS, Math.max(0, video.duration - 0.01));
        return; // finished in onSeekedLive
      }
      const n = nearest(want);
      if (n < 0 || n === shown) return;
      busy = true;
      try {
        const bmp = await createImageBitmap(frames[n]!);
        if (!disposed) drawCover(bmp, bmp.width, bmp.height);
        shown = n;
        bmp.close();
      } finally {
        busy = false;
      }
      if (nearest(want) !== shown) void drawWant();
    };

    const enterTainted = () => {
      if (tainted) return;
      tainted = true;
      video.pause();
      busy = false;
      void drawWant();
    };

    const store = (i: number, quality: number) => {
      if (tainted || frames[i]) return;
      try {
        gctx.drawImage(video, 0, 0, 1600, 900);
        grab.toBlob(
          (b) => {
            if (!b || frames[i]) return;
            frames[i] = b;
            if (i === want || shown < 0) void drawWant();
          },
          "image/jpeg",
          quality,
        );
      } catch {
        enterTainted();
      }
    };

    const onSeekedLive = () => {
      if (!tainted) return;
      drawCover(video, video.videoWidth, video.videoHeight);
      shown = Math.round(video.currentTime * FPS);
      busy = false;
      if (shown !== want) void drawWant();
    };
    video.addEventListener("seeked", onSeekedLive);

    let stepping = false;
    const stepFallback = () => {
      if (stepping) return;
      stepping = true;
      let i = 0;
      const next = () => {
        if (disposed || tainted || i >= NF) {
          video.removeEventListener("seeked", onStep);
          return;
        }
        video.currentTime = Math.min(i / FPS, video.duration - 0.01);
      };
      const onStep = () => {
        store(i, i === 0 ? 0.9 : 0.86);
        i++;
        next();
      };
      video.addEventListener("seeked", onStep);
      next();
    };

    const startCache = () => {
      NF = Math.max(2, Math.round(video.duration * FPS));
      frames = new Array(NF);
      store(0, 0.9); // frame 0 first: the hero hand-off depends on it
      if (tainted) return;
      const v = video as HTMLVideoElement & {
        requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number;
      };
      if (v.requestVideoFrameCallback) {
        const onFrame = (_now: number, meta: { mediaTime: number }) => {
          if (disposed || tainted) return;
          const i = Math.min(NF - 1, Math.round(meta.mediaTime * FPS));
          if (i > 0) store(i, 0.86);
          if (!video.ended) v.requestVideoFrameCallback!(onFrame);
        };
        v.requestVideoFrameCallback(onFrame);
        video.play().catch(() => stepFallback());
      } else {
        stepFallback();
      }
    };
    if (video.readyState >= 2) startCache();
    else video.addEventListener("loadeddata", startCache, { once: true });

    const sizeCanvas = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      cv.width = Math.round(cv.clientWidth * dpr);
      cv.height = Math.round(cv.clientHeight * dpr);
      shown = -1;
      void drawWant();
    };
    sizeCanvas();

    // ---- hero placement (the island's fern tips sit on the lower half of the letters) ----
    const layoutHero = () => {
      const W = window.innerWidth;
      const H = window.innerHeight;
      if (W < 821) {
        heroCopy.style.top = "";
        heroH1.style.fontSize = "";
        return;
      }
      const bw = W * 1.06;
      const bh = H * 1.12;
      const k = Math.max(bw / 1600, bh / 900);
      const fernTop = -0.09 * H + (bh - 900 * k) / 2 + 245 * k + 0.06 * H;
      let fs = Math.min(104, 72 * k);
      heroH1.style.fontSize = `${fs}px`;
      const lineW = (heroLine.firstElementChild as HTMLElement).getBoundingClientRect().width;
      if (lineW > W * 0.86) {
        fs *= (W * 0.86) / lineW;
        heroH1.style.fontSize = `${fs}px`;
      }
      heroCopy.style.top = `${fernTop + 0.5 * fs - heroCopy.offsetHeight}px`;
    };
    layoutHero();
    void document.fonts?.ready.then(() => !disposed && layoutHero());

    const onResize = () => {
      sizeCanvas();
      layoutHero();
    };
    window.addEventListener("resize", onResize);

    let mx = 0;
    let my = 0;
    let sx = 0;
    let sy = 0;
    const onPointer = (e: PointerEvent) => {
      mx = e.clientX / window.innerWidth - 0.5;
      my = e.clientY / window.innerHeight - 0.5;
    };
    window.addEventListener("pointermove", onPointer, { passive: true });

    const vis = (el: HTMLElement, on: boolean) => {
      el.style.visibility = on ? "visible" : "hidden";
    };

    // ---- per-frame controller ----
    // hp: hero progress (0 → 1 over the first screen). sp: progress through the whole page.
    let hp = 0;
    let sp = 0;
    let last = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(64, now - last);
      last = now;
      const H = window.innerHeight;
      const k = 1 - Math.pow(0.86, dt / 16.7);

      const scrolled = Math.max(0, -story.getBoundingClientRect().top);
      const total = Math.max(1, story.offsetHeight - H);
      const rawHp = clamp(scrolled / H);
      const rawSp = clamp(scrolled / total);
      hp += (rawHp - hp) * k;
      sp += (rawSp - sp) * k;
      if (Math.abs(rawHp - hp) < 0.0002) hp = rawHp;
      if (Math.abs(rawSp - sp) < 0.0002) sp = rawSp;
      sx += (mx - sx) * 0.06;
      sy += (my - sy) * 0.06;

      // The fly-in plays across the library: parked on frame 0 until the hero has gone,
      // then it scrubs to the last frame by the end of the page.
      const startAt = Math.min(0.6, H * 0.6 / total);
      const vp = ease(seg(sp, startAt, 0.98));
      want = Math.round(vp * (NF - 1));
      void drawWant();

      const camT = `translate3d(${-sx * 18}px, ${-sy * 12 + (1 - vp) * H * 0.06}px, 0) scale(${1 + 0.02 * (1 - vp)})`;
      cams.forEach((c) => (c.style.transform = camT));

      // Hand-off: the high-res still dissolves into the identical cached frame 0.
      const ho = shown < 0 ? 0 : shown === 0 ? seg(hp, 0.3, 0.55) : 1;
      plate.style.opacity = `${1 - ho}`;
      plate.style.visibility = ho >= 1 ? "hidden" : "visible";
      camF.style.opacity = `${1 - ho}`;
      vis(camF, ho < 1);

      // Hero copy blurs out and lifts away.
      const h = seg(hp, 0.1, 0.6);
      heroCopy.style.transform = `translate3d(${-sx * 10}px, ${-h * 80 - sy * 6}px, 0) scale(${1 + h * 0.12})`;
      heroCopy.style.filter = `blur(${h * 14}px)`;
      heroCopy.style.opacity = `${1 - h}`;
      hud.style.transform = `translate3d(${sx * 26}px, ${sy * 18 - h * 40}px, 0)`;
      hud.style.opacity = `${1 - seg(hp, 0.1, 0.45)}`;
      const ch = 1 - seg(hp, 0.05, 0.3);
      caption.style.opacity = `${ch}`;
      hint.style.opacity = `${ch}`;
      vis(L0, h < 1);
      vis(L1, h < 1);

      // Rocks fly past the camera.
      const fp = seg(hp, 0.1, 1);
      const fe = fp * fp;
      rocks.forEach(({ el, x, y, d }) => {
        el.style.transform = `translate3d(${x * fp * 70 + sx * -24 * d}vw, ${y * fp * 60 + sy * -16 * d}vh, 0) scale(${1 + fe * 1.6 * d})`;
        el.style.filter = `blur(${fe * 5 * d}px)`;
        vis(el, fp < 1);
      });

      // Sidebar slides in once the hero is mostly gone; the library heading follows.
      root.classList.toggle("ml-past-hero", hp > 0.7);
      const lh = seg(hp, 0.55, 0.95);
      libHead.style.opacity = `${lh}`;
      libHead.style.transform = `translateY(${(1 - lh) * 30}px)`;
      libHead.style.filter = `blur(${(1 - lh) * 8}px)`;

      prog.style.transform = `scaleX(${sp})`;
    };
    raf = requestAnimationFrame(frame);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onPointer);
      video.removeEventListener("seeked", onSeekedLive);
      video.pause();
      links.forEach((l) => l.remove());
      document.title = prevTitle;
      document.documentElement.style.background = prevHtmlBg;
      document.body.style.background = prevBodyBg;
    };
  }, []);

  return (
    <div className="ml" ref={rootRef}>
      <nav className="ml-nav">
        <Link className="ml-logo" to="/" aria-label="Senevon Game Studio — home">
          {/* Dark-text logo variant: this page has a light mist background */}
          <img src="/logo/logo-h-dark-nav.webp" width={432} height={120} alt="Senevon Game Studio" />
        </Link>
        <div className="ml-menu">
          <a href="#ml-library">
            Games
            <i className="ml-chev" />
          </a>
          <a href="#ml-library" onClick={() => setCategory("Action")}>
            Categories
            <i className="ml-chev" />
          </a>
          <Link to="/leaderboards">
            Leaderboards
            <i className="ml-chev" />
          </Link>
          <Link to="/">
            Studio
            <i className="ml-chev" />
          </Link>
        </div>
        <Link className="ml-talk" to="/">
          PLAY NOW <span className="ml-talk-sq">›</span>
        </Link>
      </nav>

      {/* Sidebar: slides in after the hero */}
      <aside className="ml-rail" aria-label="Browse games">
        <Link to="/" className="ml-rail-item" data-label="Home">
          <House size={18} />
        </Link>
        <span className="ml-rail-sep" aria-hidden="true" />
        {usedCategories.map((c) => {
          const Icon = categoryIcon[c];
          return (
            <button
              key={c}
              type="button"
              className={`ml-rail-item${category === c ? " active" : ""}`}
              data-label={c === "All" ? "All games" : c}
              aria-pressed={category === c}
              onClick={() => pick(c)}
            >
              <Icon size={18} />
            </button>
          );
        })}
        <span className="ml-rail-sep" aria-hidden="true" />
        <Link to="/leaderboards" className="ml-rail-item" data-label="Leaderboards">
          <Trophy size={18} />
        </Link>
      </aside>

      <section className="ml-story" id="ml-story">
        {/* Pinned stage: stays behind the hero and the whole library */}
        <div className="ml-stage">
          <div className="ml-cam">
            <canvas className="ml-cv" />
            <img className="ml-plate" src={STILL} alt="" fetchPriority="high" />
            <div className="ml-mist" />
          </div>

          <video className="ml-push" src={VIDEO} muted playsInline preload="auto" crossOrigin="anonymous" />

          <div className="ml-layer ml-L0">
            <div className="ml-hero-copy">
              <span className="ml-chip">Senevon Game Studio</span>
              <h1>
                <span className="ml-line">
                  <span>A Universe of Games</span>
                </span>
              </h1>
            </div>
          </div>

          <div className="ml-cam ml-camF" aria-hidden="true">
            <img src={CUTOUT} alt="" />
          </div>

          <div className="ml-rock ml-rk1" data-x="-.3" data-y="-.6" data-d="1.3" aria-hidden="true">
            <div className="ml-bob">
              <img src={ROCKS} alt="" style={crop(30, 200, 260, 295)} />
            </div>
          </div>
          <div className="ml-rock ml-rk3" data-x="1" data-y=".55" data-d="1.8" aria-hidden="true">
            <div className="ml-bob">
              <img src={ROCKS} alt="" style={crop(895, 240, 265, 270)} />
            </div>
          </div>

          <div className="ml-layer ml-L1">
            <div className="ml-hud">
              <span className="ml-cross" />
              <span className="ml-chip">Now trending</span>
              <pre>{`${featured.title.toUpperCase()}\n${featured.category.toUpperCase()} · ${featured.minutes} MIN\n${games.length} GAMES`}</pre>
            </div>
            <p className="ml-caption">
              Play instantly,
              <br />
              discover new worlds,
              <br />
              and be part of a global gaming universe.
            </p>
            <div className="ml-hint">
              <span className="ml-hint-c">
                <i />
              </span>
              SCROLL TO EXPLORE
            </div>
          </div>

          <div className="ml-prog">
            <i />
          </div>
        </div>

        {/* Scrolling content over the pinned stage */}
        <div className="ml-flow">
          <div className="ml-hero-space" aria-hidden="true" />

          <section className="ml-library" id="ml-library">
            <header className="ml-lib-head">
              <span className="ml-chip">Game library</span>
              <h2>{category === "All" ? "Pick a world. Play instantly." : category}</h2>
              <p>
                {list.length} {list.length === 1 ? "game" : "games"} · free · no downloads
              </p>
            </header>

            <div className="ml-grid" key={category}>
              {list.map((g, i) => (
                <GlassCard key={g.id} game={g} index={i} />
              ))}
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}
