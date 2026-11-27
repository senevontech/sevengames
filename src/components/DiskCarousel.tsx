import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "./anim-icons";
import type { Game } from "../catalog";
import GameDisk from "./GameDisk";

/*
 * Horizontal row of game disks: the centre disk is full size and its neighbours shrink toward
 * both edges (1 → 0.5 → 0.42 → …), with the page colour fading over the edges.
 *
 * Native scroll does the work (swipe, wheel, keys, scroll-snap): every game has a narrow "slot"
 * in the scroll track, so one slot of scroll = one game. Each frame the disks are then moved and
 * scaled from their fractional distance `t` to the centre, so the gap between neighbouring disks
 * stays even however small they get.
 */

const GAP = 0.12; // gap between neighbouring disks, as a fraction of the centre disk's size
const SLOT = 0.45; // scroll distance per game, as a fraction of the centre disk's size
// (the page shows the centre game's details itself, via onActiveChange)

// Endless: the list is repeated COPIES times and the view starts in the middle copy; after each
// scroll it is silently re-centred (see recentre), so you never reach an end.
const COPIES = 5;
const HOME_COPY = 2;
const VISIBLE = 7; // disks laid out on each side of the centre (the rest are hidden)

/** Disk scale at distance `u` (in games) from the centre. */
function scaleAt(u: number) {
  if (u <= 1) return 1 - 0.5 * u;
  return Math.max(0.22, 0.5 - 0.08 * (u - 1));
}

/** Centre-to-centre distance (in disk sizes, without gaps) from the middle to distance `u`: ∫ scale. */
function reachAt(u: number) {
  if (u <= 1) return u - 0.25 * u * u;
  const k = Math.min(u, 4.5) - 1; // scale bottoms out at u = 4.5
  return 0.75 + 0.5 * k - 0.04 * k * k + 0.22 * Math.max(0, u - 4.5);
}

/** One disk in the track. Memoised: when the centre changes only the few disks whose state
 *  changed re-render, not all of them (the track holds every game five times over). */
const Slot = memo(function Slot({
  i,
  game,
  active,
  focusable,
  setRef,
  onPick,
}: {
  i: number;
  game: Game;
  active: boolean;
  focusable: boolean;
  setRef: (i: number, node: HTMLAnchorElement | null) => void;
  onPick: (i: number) => boolean;
}) {
  return (
    <div className="dc-slot">
      <Link
        ref={(node) => setRef(i, node)}
        className={`dc-disk${active ? " is-active" : ""}`}
        to={`/game/${game.id}`}
        aria-label={active ? `Play ${game.title}` : `Show ${game.title}`}
        tabIndex={focusable ? 0 : -1}
        draggable={false}
        onClick={(e) => {
          // only the centre disk opens the game; any other one slides to the centre first
          if (onPick(i)) e.preventDefault();
        }}
      >
        <GameDisk game={game} iconSize={44} />
      </Link>
    </div>
  );
});

export default function DiskCarousel({
  items,
  startIndex = 0,
  label,
  onActiveChange,
  autoplayMs = 0,
}: {
  /** Slide to the next game every `autoplayMs` (0 = off). Pauses while hovered, for a while
   *  after the player touches it, when it's off screen or the tab is hidden, and for reduced motion. */
  autoplayMs?: number;
  items: Game[];
  startIndex?: number;
  label: string;
  /** Called with the game that settles in the centre. */
  onActiveChange?: (game: Game, index: number) => void;
}) {
  const n = items.length;
  const total = n * COPIES;
  const home = (i: number) => HOME_COPY * n + (((i % n) + n) % n); // same game, in the middle copy

  const scrollerRef = useRef<HTMLDivElement>(null);
  const diskRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const shown = useRef(new Set<number>()); // disks currently laid out (the rest stay hidden)
  const geo = useRef({ size: 0, slot: 0 });
  const [active, setActive] = useState(() => home(startIndex));
  const activeRef = useRef(active);

  /** Position + scale the disks near the centre for the current scroll offset. */
  const layout = useCallback(() => {
    const el = scrollerRef.current;
    const { size, slot } = geo.current;
    if (!el || !slot) return;
    const at = el.scrollLeft / slot; // fractional slot index in the centre
    const from = Math.max(0, Math.floor(at - VISIBLE));
    const to = Math.min(total - 1, Math.ceil(at + VISIBLE));
    const next = new Set<number>();
    for (let i = from; i <= to; i++) {
      const disk = diskRefs.current[i];
      if (!disk) continue;
      const t = i - at;
      const u = Math.abs(t);
      const x = Math.sign(t) * size * (reachAt(u) + GAP * u) - t * slot;
      disk.style.transform = `translate(-50%, -50%) translateX(${x}px) scale(${scaleAt(u)})`;
      disk.style.zIndex = String(100 - Math.round(u * 10));
      if (!shown.current.has(i)) {
        disk.style.visibility = "visible";
        disk.style.willChange = "transform";
      }
      next.add(i);
    }
    shown.current.forEach((i) => {
      if (!next.has(i)) {
        const disk = diskRefs.current[i];
        if (disk) {
          disk.style.visibility = "";
          disk.style.willChange = "";
        }
      }
    });
    shown.current = next;
    const idx = Math.min(total - 1, Math.max(0, Math.round(at)));
    if (idx !== activeRef.current) {
      activeRef.current = idx;
      setActive(idx);
    }
  }, [total]);

  /** Read the disk size (set in CSS) and keep the same game centred after a resize. */
  const measure = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const size = parseFloat(getComputedStyle(el).getPropertyValue("--dc-size")) || el.clientWidth * 0.5;
    geo.current = { size, slot: size * SLOT };
    el.style.setProperty("--dc-slot", `${geo.current.slot}px`);
    el.scrollLeft = activeRef.current * geo.current.slot;
    layout();
  }, [layout]);

  useLayoutEffect(() => {
    const el = scrollerRef.current!;
    // --dc-size is a CSS length (e.g. min(50vw, 240px)); resolve it to px via a probe
    const probe = document.createElement("div");
    probe.style.cssText = "position:absolute;visibility:hidden;width:var(--dc-size-src)";
    el.appendChild(probe);
    const resolve = () => {
      el.style.setProperty("--dc-size", `${probe.getBoundingClientRect().width}px`);
      measure();
    };
    resolve();
    const ro = new ResizeObserver(resolve);
    ro.observe(el);

    // Infinite loop: once scrolling has settled (and no finger is down), jump by whole copies
    // back to the same game in the middle copy. The copies are identical, so nothing moves.
    let touching = false;
    let settle = 0;
    const recentre = () => {
      if (touching) return;
      const k = activeRef.current;
      if (k >= n && k < (COPIES - 1) * n) return; // still a full copy of room on both sides
      const target = HOME_COPY * n + (k % n);
      const { slot } = geo.current;
      const offset = el.scrollLeft - k * slot; // keep any sub-slot offset
      activeRef.current = target;
      el.scrollLeft = target * slot + offset;
      layout();
      setActive(target);
    };
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(layout);
      window.clearTimeout(settle);
      settle = window.setTimeout(recentre, 160);
    };
    const onDown = () => {
      touching = true;
    };
    const onUp = () => {
      touching = false;
      window.clearTimeout(settle);
      settle = window.setTimeout(recentre, 160);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("pointerdown", onDown, { passive: true });
    el.addEventListener("touchstart", onDown, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    window.addEventListener("touchend", onUp, { passive: true });
    window.addEventListener("touchcancel", onUp, { passive: true });
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
      window.clearTimeout(settle);
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("touchstart", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("touchend", onUp);
      window.removeEventListener("touchcancel", onUp);
      probe.remove();
    };
  }, [layout, measure, n]);

  useEffect(() => {
    diskRefs.current.length = total;
  }, [total]);

  const activeGame = items[active % n];
  useEffect(() => {
    if (activeGame) onActiveChange?.(activeGame, active % n);
  }, [activeGame, active, n, onActiveChange]);

  const goTo = useCallback(
    (i: number) => {
      const el = scrollerRef.current;
      if (!el) return;
      const idx = Math.min(total - 1, Math.max(0, i));
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollTo({ left: idx * geo.current.slot, behavior: reduce ? "auto" : "smooth" });
    },
    [total],
  );
  /* ----- autoplay ----- */
  const sectionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const root = sectionRef.current;
    if (!autoplayMs || !root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const IDLE_AFTER_TOUCH = 5_000;
    let pausedUntil = 0;
    let hover = false;
    let onScreen = true;
    const touch = () => {
      pausedUntil = Date.now() + IDLE_AFTER_TOUCH;
    };
    const enter = (e: PointerEvent) => {
      if (e.pointerType === "mouse") hover = true;
    };
    const leave = () => {
      hover = false;
    };
    const io = new IntersectionObserver((entries) => {
      onScreen = entries.some((e) => e.isIntersecting);
    });
    io.observe(root);
    root.addEventListener("pointerdown", touch, { passive: true });
    root.addEventListener("wheel", touch, { passive: true });
    root.addEventListener("keydown", touch);
    root.addEventListener("focusin", touch);
    root.addEventListener("pointerenter", enter);
    root.addEventListener("pointerleave", leave);
    const id = window.setInterval(() => {
      if (document.hidden || !onScreen || hover || Date.now() < pausedUntil) return;
      goTo(activeRef.current + 1);
    }, autoplayMs);
    return () => {
      window.clearInterval(id);
      io.disconnect();
      root.removeEventListener("pointerdown", touch);
      root.removeEventListener("wheel", touch);
      root.removeEventListener("keydown", touch);
      root.removeEventListener("focusin", touch);
      root.removeEventListener("pointerenter", enter);
      root.removeEventListener("pointerleave", leave);
    };
  }, [autoplayMs, goTo]);

  /** A disk was clicked: true (= stay on this page) unless it's the centre one. */
  const onPick = useCallback(
    (i: number) => {
      if (i === activeRef.current) return false;
      goTo(i);
      return true;
    },
    [goTo],
  );
  const setRef = useCallback((i: number, node: HTMLAnchorElement | null) => {
    diskRefs.current[i] = node;
  }, []);

  return (
    <section className="dc" aria-label={label} ref={sectionRef}>
      <div className="dc-stage">
        <div className="dc-scroller" ref={scrollerRef}>
          <div className="dc-spacer" aria-hidden="true" />
          {Array.from({ length: total }, (_, i) => (
            <Slot key={i} i={i} game={items[i % n]} active={i === active} focusable={Math.abs(i - active) <= 2} setRef={setRef} onPick={onPick} />
          ))}
          <div className="dc-spacer" aria-hidden="true" />
        </div>
        <button
          type="button"
          className="dc-arrow dc-prev"
          aria-label="Previous game"
          onClick={() => goTo(active - 1)}
        >
          <ChevronLeft size={18} strokeWidth={2} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="dc-arrow dc-next"
          aria-label="Next game"
          onClick={() => goTo(active + 1)}
        >
          <ChevronRight size={18} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
