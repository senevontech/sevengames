import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, Play } from "./anim-icons";
import type { Game } from "../catalog";

/*
 * Featured games carousel (home /home3, after the scroll dive).
 * Full-screen solid colour per game; changing game grows the next colour as a circle from the
 * centre of the screen, behind the round "vinyl" posters. Prev / next buttons, swipe, arrow keys
 * (while the section is on screen) or a click on a side poster change the game.
 */

// One solid colour per slide. The first is the dive video's last frame, so the hand-over is seamless.
const COLORS = ["#fc6e1b", "#ffc20e", "#1f5bff", "#10b981", "#e5383b", "#7b2cbf", "#0fa3b1", "#d6336c"];

/** Dark ink on light colours, white on dark ones (relative luminance). */
export function inkFor(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.36 ? "#121212" : "#ffffff";
}

export default function FeatureCarousel({
  items,
  onInk,
  colorFor,
  eyebrow,
  soonIds,
  label = "Featured games",
}: {
  items: Game[];
  /** Called with the current text colour, so the page can match its nav to the slide. */
  onInk?: (ink: string) => void;
  /** Background colour per slide (default: the home palette). */
  colorFor?: (game: Game, index: number) => string;
  /** Small heading above the game title (e.g. the category name). */
  eyebrow?: string;
  /** Slides that are "Coming soon" placeholders: not playable. */
  soonIds?: Set<string>;
  label?: string;
}) {
  const count = items.length;
  const colorOf = (i: number) => (colorFor ? colorFor(items[i], i) : COLORS[i % COLORS.length]);
  const isSoon = (g: Game) => Boolean(soonIds?.has(g.id));
  const [index, setIndex] = useState(0);
  // Colour already filling the section, and the colour currently growing from the centre.
  const [base, setBase] = useState(() => colorOf(0));
  // The growing circle: its colour, where it starts (centre of the middle poster, in px from the
  // section's top-left) and the radius that reaches the farthest corner.
  const [reveal, setReveal] = useState<{ color: string; id: number; x: number; y: number; r: number } | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  // The slide shown before the latest change (updated after commit, so React's double render
  // in development can't skew it). Used to spot the disc that wraps from one hidden side to the
  // other: it must jump, not roll across the screen.
  const shownRef = useRef(0);
  const prevIndex = shownRef.current;
  useEffect(() => {
    shownRef.current = index;
  }, [index]);
  const go = useCallback(
    (next: number) => {
      const i = ((next % count) + count) % count;
      if (i === index) return;
      // If a reveal is still running, settle it first so colours never jump backwards.
      if (reveal) setBase(reveal.color);
      const sec = sectionRef.current;
      const disc = sec?.querySelector(".fc-disc.is-center");
      let x = 0;
      let y = 0;
      let r = 2000;
      if (sec && disc) {
        const s = sec.getBoundingClientRect();
        const d = disc.getBoundingClientRect();
        x = d.left + d.width / 2 - s.left;
        y = d.top + d.height / 2 - s.top;
        r = Math.ceil(Math.max(Math.hypot(x, y), Math.hypot(s.width - x, y), Math.hypot(x, s.height - y), Math.hypot(s.width - x, s.height - y))) + 2;
      }
      setReveal({ color: colorOf(i), id: Date.now(), x, y, r });
      setIndex(i);
    },
    [count, index, reveal],
  );

  // Arrow keys while the carousel is on screen.
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    let visible = false;
    const io = new IntersectionObserver(([e]) => (visible = e.intersectionRatio > 0.5), { threshold: [0, 0.5, 1] });
    io.observe(el);
    const onKey = (e: KeyboardEvent) => {
      // Ignore keys while the carousel is still hidden (it fades in at the end of the dive).
      if (!visible || el.closest("[data-inactive]") || e.target instanceof HTMLInputElement) return;
      if (e.key === "ArrowRight") go(index + 1);
      if (e.key === "ArrowLeft") go(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      io.disconnect();
      window.removeEventListener("keydown", onKey);
    };
  }, [go, index]);

  // Swipe (touch / pen) on the poster stage.
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") swipe.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(e.clientY - s.y)) go(index + (dx < 0 ? 1 : -1));
  };

  const game = items[index];
  const color = colorOf(index);
  const ink = inkFor(color);
  useEffect(() => onInk?.(ink), [ink, onInk]);

  return (
    <section
      ref={sectionRef}
      className="fc"
      style={{ "--fc-base": base, "--fc-accent": color, "--fc-ink": ink } as React.CSSProperties}
      aria-roledescription="carousel"
      aria-label={label}
    >
      {/* Colour growing from the centre of the screen, behind the posters */}
      {reveal ? (
        <div
          key={reveal.id}
          className="fc-reveal"
          style={
            {
              background: reveal.color,
              "--fc-x": `${reveal.x}px`,
              "--fc-y": `${reveal.y}px`,
              "--fc-r": `${reveal.r}px`,
            } as React.CSSProperties
          }
          onAnimationEnd={() => {
            setBase(reveal.color);
            setReveal(null);
          }}
        />
      ) : null}

      <header className="fc-head" key={game.id}>
        <div>
          {eyebrow ? <p className="fc-eyebrow">{eyebrow}</p> : null}
          <h2 className="fc-title">{game.title}</h2>
        </div>
        <p className="fc-desc">{game.description}</p>
      </header>

      <div className="fc-stage" onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
        {items.map((g, i) => {
          // Position relative to the active slide, wrapped to -1 / 0 / +1 (others wait off-stage).
          let pos = i - index;
          if (pos > count / 2) pos -= count;
          if (pos < -count / 2) pos += count;
          const where = pos === 0 ? "center" : pos === -1 ? "left" : pos === 1 ? "right" : pos < 0 ? "far-left" : "far-right";
          let before = i - prevIndex;
          if (before > count / 2) before -= count;
          if (before < -count / 2) before += count;
          const jump = Math.abs(pos - before) > 1;
          const cls = `fc-disc is-${where}${jump ? " is-jump" : ""}`;
          const disc = (
            <>
              <span className="fc-art">
                {g.poster ? (
                  <img src={g.poster} alt="" draggable={false} />
                ) : (
                  <span className={`fc-fallback${isSoon(g) ? " is-soon" : ""}`} style={{ background: `color-mix(in srgb, ${g.accent} 72%, #000)` }}>
                    <b>{g.title}</b>
                    <i>{isSoon(g) ? "New game" : g.category}</i>
                  </span>
                )}
              </span>
              <span className="fc-grooves" aria-hidden="true" />
              <span className="fc-label" aria-hidden="true">
                <b>{isSoon(g) ? "Soon" : g.title}</b>
                <i>{g.category}</i>
                {isSoon(g) ? null : <i>~{g.minutes} min</i>}
              </span>
            </>
          );
          return pos === 0 && !isSoon(g) ? (
            <Link key={g.id} to={`/game/${g.id}`} className={cls} aria-label={`Play ${g.title}`}>
              {disc}
            </Link>
          ) : (
            <button
              key={g.id}
              type="button"
              className={cls}
              onClick={() => (pos === 0 ? undefined : go(i))}
              aria-label={isSoon(g) ? "Coming soon" : `Show ${g.title}`}
              tabIndex={Math.abs(pos) === 1 ? 0 : -1}
              aria-hidden={Math.abs(pos) > 1}
            >
              {disc}
            </button>
          );
        })}
      </div>

      <div className="fc-controls">
        <button type="button" className="fc-btn" onClick={() => go(index - 1)} aria-label="Previous game">
          <ChevronLeft size={18} />
        </button>
        {isSoon(game) ? (
          <span className="fc-play is-soon" aria-disabled="true">
            Coming soon
          </span>
        ) : (
          <Link className="fc-play" to={`/game/${game.id}`}>
            <Play size={15} />
            Play {game.title}
          </Link>
        )}
        <button type="button" className="fc-btn" onClick={() => go(index + 1)} aria-label="Next game">
          <ChevronRight size={18} />
        </button>
      </div>

      <p className="fc-count" aria-live="polite">
        {String(index + 1).padStart(2, "0")} / {String(count).padStart(2, "0")}
      </p>
    </section>
  );
}
