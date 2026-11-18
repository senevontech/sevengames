import { useEffect, useRef, useState, type Ref } from "react";
import {
  Car,
  Crown,
  Dice5,
  Gamepad2,
  Ghost,
  Heart,
  Joystick,
  Puzzle,
  Rocket,
  Sparkles,
  Star,
  Swords,
  Target,
  Trophy,
  Zap,
  type LucideIcon,
} from "lucide-react";
import "./laptop-icon-smoke.css";

/*
 * Glowing orange game icons that drift out of the laptop screen in the /home3 hero video and
 * fade away like smoke. Sits inside the fixed .h3-bgfx layer, so it stays locked to the video.
 */

const ICONS: LucideIcon[] = [
  Gamepad2, Joystick, Trophy, Swords, Puzzle, Crown, Car, Dice5, Rocket, Ghost, Target, Sparkles, Zap, Heart, Star,
];

// Centre of the laptop screen in the 1920×1080 hero video frame.
const VIDEO_W = 1920;
const VIDEO_H = 1080;
const SPAWN_X = 1056 / VIDEO_W;
const SPAWN_Y = 694 / VIDEO_H;

type Puff = {
  id: number;
  Icon: LucideIcon;
  x: number;
  y: number;
  style: React.CSSProperties;
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Where the laptop screen is on screen, following the video's object-fit: cover + object-position. */
function spawnPoint(video: HTMLVideoElement | null) {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const s = Math.max(W / VIDEO_W, H / VIDEO_H);
  const w = VIDEO_W * s;
  const h = VIDEO_H * s;
  let px = 0.5;
  let py = 0.5;
  if (video) {
    const [ox, oy] = getComputedStyle(video).objectPosition.split(" ");
    if (ox?.endsWith("%")) px = parseFloat(ox) / 100;
    if (oy?.endsWith("%")) py = parseFloat(oy) / 100;
  }
  return { x: (W - w) * px + SPAWN_X * w, y: (H - h) * py + SPAWN_Y * h, W, H };
}

export default function LaptopIconSmoke({
  layerRef,
  videoRef,
}: {
  /** The layer element; the page fades it (style.opacity) as the scroll dive starts. */
  layerRef: Ref<HTMLDivElement>;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}) {
  const [puffs, setPuffs] = useState<Puff[]>([]);
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  const ownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let id = 0;
    let timer = 0;
    let last = -1;

    const placeOrigin = () => {
      const p = spawnPoint(videoRef.current);
      setOrigin({ x: p.x, y: p.y });
    };
    placeOrigin();
    window.addEventListener("resize", placeOrigin);

    const spawn = () => {
      const layer = ownRef.current;
      const hidden = !layer || parseFloat(layer.style.opacity || "1") <= 0.02 || document.hidden;
      if (!hidden) {
        const { x, y, W, H } = spawnPoint(videoRef.current);
        const small = W < 820;
        // Pick a different icon from the previous one
        let k = Math.floor(Math.random() * ICONS.length);
        if (k === last) k = (k + 1) % ICONS.length;
        last = k;
        // Drift up and out across the whole screen, curling sideways like smoke
        const dx = rand(-0.55, 0.55) * W;
        const dy = -rand(0.35, 0.85) * y - rand(0, 0.15) * H;
        const life = rand(4200, 7000);
        const puff: Puff = {
          id: ++id,
          Icon: ICONS[k],
          x,
          y,
          style: {
            "--dx": `${dx}px`,
            "--dy": `${dy}px`,
            "--sway": `${rand(-1, 1) * (small ? 40 : 90)}px`,
            "--r": `${rand(-40, 40)}deg`,
            "--s": `${rand(0.8, 1.25)}`,
            "--size": `${Math.round(rand(small ? 16 : 20, small ? 28 : 38))}px`,
            "--life": `${Math.round(life)}ms`,
          } as React.CSSProperties,
        };
        setPuffs((ps) => [...ps.slice(small ? -6 : -10), puff]);
      }
      // fewer at a time on small screens (phones have less GPU to spare)
      const small = window.innerWidth < 820;
      timer = window.setTimeout(spawn, small ? rand(900, 1400) : rand(480, 820));
    };
    timer = window.setTimeout(spawn, 600);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", placeOrigin);
    };
  }, [videoRef]);

  const setRefs = (el: HTMLDivElement | null) => {
    ownRef.current = el;
    if (typeof layerRef === "function") layerRef(el);
    else if (layerRef) (layerRef as React.RefObject<HTMLDivElement | null>).current = el;
  };

  return (
    <div ref={setRefs} className="lis" aria-hidden="true">
      {origin ? <span className="lis-source" style={{ left: origin.x, top: origin.y }} /> : null}
      {puffs.map(({ id, Icon, x, y, style }) => (
        <span
          key={id}
          className="lis-puff"
          style={{ left: x, top: y, ...style }}
          onAnimationEnd={() => setPuffs((ps) => ps.filter((p) => p.id !== id))}
        >
          <Icon strokeWidth={1.8} />
        </span>
      ))}
    </div>
  );
}
