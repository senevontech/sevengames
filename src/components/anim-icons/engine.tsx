/* The animated half of the icon set: its own download, fetched only on devices that animate
   (never in Lite mode or with reduced motion — those keep the plain lucide-react icons).

   Each icon is drawn from lucide's own stroke data (the `lucide` package), so it looks exactly
   like the static icon until it moves. Motion (motion.dev) moves either the whole icon or single
   strokes, in the style of Lucide Animated and Animate UI.

   An icon plays only when the pointer enters the button/link it sits in (mouse), or a finger
   or pen presses it. No draw-in on appear, no loops (they made pages lag). index.tsx mounts this
   only after the first hover/tap, so icons nobody touches stay plain lucide-react SVGs.
   Only transform, opacity and stroke drawing are animated. */
import { LazyMotion, domAnimation, m, useAnimationControls, type Transition } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";
import * as N from "./nodes";
import { TRIGGER, type AnimIconProps } from "./index";

type Target = Record<string, number | number[] | string | Transition>;
type Recipe = {
  /** the whole icon */
  svg?: Target;
  /** single strokes, by their index in the lucide icon */
  parts?: Record<number, Target>;
  /** transform origin of the whole icon, 0..1 of its box */
  origin?: [number, number];
  /** transform origin of single strokes, 0..1 of each stroke's own box */
  partOrigin?: Record<number, [number, number]>;
  dur?: number;
  ease?: Transition["ease"];
  /** spins non-stop (loaders) */
  forever?: boolean;
};

/* ---------- reusable moves ---------- */
const wiggle: Recipe = { svg: { rotate: [0, -12, 10, -6, 0] } };
const pop: Recipe = { svg: { scale: [1, 1.18, 0.96, 1] } };
const bounce: Recipe = { svg: { y: [0, -3, 0, -1.2, 0] } };
const right: Recipe = { svg: { x: [0, 3, 0] }, dur: 0.45 };
const left: Recipe = { svg: { x: [0, -3, 0] }, dur: 0.45 };
const down: Recipe = { svg: { y: [0, 3, 0] }, dur: 0.45 };
const buzz: Recipe = { svg: { rotate: [0, -9, 9, -7, 7, 0] }, dur: 0.5 };
const nod: Recipe = { svg: { y: [0, -2, 0], rotate: [0, -8, 0] } };
const spin: Recipe = { svg: { rotate: [0, 360] }, dur: 0.8 };
const stagger = (i: number, t: Target): Target => ({ ...t, transition: { duration: 0.5, delay: i * 0.07 } });

const R: Record<string, Recipe> = {
  ArrowRight: right,
  ArrowUpDown: { svg: { y: [0, -2, 2, 0] } },
  Atom: { svg: { rotate: [0, 180] }, dur: 0.9 },
  Bell: { svg: { rotate: [0, -16, 13, -9, 5, 0] }, origin: [0.5, 0.08], parts: { 0: { x: [0, -1.6, 1.6, -0.8, 0] } }, dur: 0.75 },
  BellOff: wiggle,
  Bomb: buzz,
  Bot: { parts: { 0: { rotate: [0, -18, 14, 0] }, 4: { scaleY: [1, 0.15, 1] }, 5: { scaleY: [1, 0.15, 1] } }, partOrigin: { 0: [0.5, 1] } },
  Brain: pop,
  Building2: { parts: { 3: stagger(0, { opacity: [1, 0.2, 1] }), 4: stagger(1, { opacity: [1, 0.2, 1] }), 5: stagger(2, { opacity: [1, 0.2, 1] }), 6: stagger(3, { opacity: [1, 0.2, 1] }) } },
  Calculator: pop,
  CalendarCheck: { parts: { 4: { pathLength: [0, 1] } }, svg: { y: [0, -1.5, 0] } },
  CalendarClock: { parts: { 0: { rotate: [0, 360] } }, partOrigin: { 0: [0, 0] }, dur: 0.8 },
  Car: { svg: { x: [0, 3, -1, 0] } },
  Check: { parts: { 0: { pathLength: [0, 1] } }, dur: 0.45 },
  ChevronDown: down,
  ChevronLeft: left,
  ChevronRight: right,
  CircleDot: pop,
  Coins: { parts: { 0: { y: [0, -3, 0] }, 2: { y: [0, -3, 0] }, 1: stagger(1, { y: [0, -2, 0] }), 3: stagger(1, { y: [0, -2, 0] }) } },
  Columns3: { svg: { scaleY: [1, 0.82, 1.06, 1] } },
  Copy: { parts: { 0: { x: [0, -2, 0], y: [0, -2, 0] } }, dur: 0.4 },
  Crown: { parts: { 0: { y: [0, -2.6, 0] } }, svg: { rotate: [0, -6, 5, 0] } },
  Dices: { svg: { rotate: [0, -22, 12, 0] } },
  Disc: spin,
  DoorOpen: { parts: { 1: { scaleX: [1, 0.6, 1] } }, partOrigin: { 1: [0, 0.5] } },
  Download: { parts: { 0: { y: [0, 3, 0] }, 2: { y: [0, 3, 0] } }, dur: 0.5 },
  ExternalLink: { parts: { 0: { x: [0, 2, 0], y: [0, -2, 0] }, 1: { x: [0, 2, 0], y: [0, -2, 0] } }, dur: 0.45 },
  Eye: { svg: { scaleY: [1, 0.12, 1] }, dur: 0.35 },
  EyeOff: wiggle,
  Flame: { svg: { scaleY: [1, 1.12, 0.94, 1.06, 1], rotate: [0, -4, 4, 0] }, origin: [0.5, 1], dur: 0.8 },
  GalleryHorizontalEnd: right,
  Gamepad2: buzz,
  Gauge: { parts: { 0: { rotate: [0, -70, 25, 0] } }, partOrigin: { 0: [0, 1] }, dur: 0.8 },
  Gift: { parts: { 0: { y: [0, -3, 0], rotate: [0, -7, 0] }, 3: { y: [0, -3, 0], rotate: [0, -7, 0] } }, svg: { scale: [1, 1.05, 1] }, dur: 0.6 },
  Globe: { parts: { 1: { scaleX: [1, -1, 1] } }, dur: 0.9 },
  GraduationCap: { parts: { 0: { y: [0, -2.5, 0], rotate: [0, -6, 0] } } },
  Grid2x2: { svg: { rotate: [0, 90] } },
  Hammer: { svg: { rotate: [0, -28, 6, 0] }, origin: [0.1, 0.9] },
  HandCoins: { parts: { 3: { y: [0, -3, 0] }, 4: stagger(1, { y: [0, -3, 0] }) } },
  Hash: { svg: { rotate: [0, -12, 0] } },
  Heart: { svg: { scale: [1, 1.25, 0.95, 1.12, 1] }, dur: 0.7 },
  HelpCircle: { parts: { 1: { rotate: [0, -14, 12, 0] }, 2: { y: [0, -1.5, 0] } } },
  History: { svg: { rotate: [0, -360] }, parts: { 2: { rotate: [0, 360] } }, partOrigin: { 2: [0, 5 / 7] }, dur: 0.8 },
  House: { parts: { 0: { scaleY: [1, 0.55, 1] } }, partOrigin: { 0: [0.5, 1] }, svg: { y: [0, -1.5, 0] } },
  Info: { parts: { 1: { y: [0, -1.5, 0] }, 2: { y: [0, -3, 0] } } },
  Joystick: { parts: { 2: { rotate: [0, -20, 16, 0] }, 3: { x: [0, -2.5, 2, 0] } }, partOrigin: { 2: [0.5, 1] } },
  KeyRound: { svg: { rotate: [0, -22, 10, 0] } },
  Keyboard: { svg: { y: [0, 1.5, 0, 1, 0] } },
  Layers: { parts: { 0: { y: [0, -3, 0] }, 1: stagger(1, { y: [0, -1.5, 0] }) } },
  LayoutGrid: { parts: { 0: stagger(0, { scale: [1, 0.7, 1] }), 1: stagger(1, { scale: [1, 0.7, 1] }), 2: stagger(2, { scale: [1, 0.7, 1] }), 3: stagger(3, { scale: [1, 0.7, 1] }) } },
  Lightbulb: { parts: { 0: { opacity: [1, 0.35, 1, 0.6, 1] } }, svg: { scale: [1, 1.08, 1] } },
  LoaderCircle: { svg: { rotate: [0, 360] }, dur: 0.9, ease: "linear", forever: true },
  Lock: { parts: { 1: { y: [0, -2.5, 0] } } },
  LogIn: { parts: { 0: { x: [0, 2.5, 0] }, 1: { x: [0, 2.5, 0] } }, dur: 0.45 },
  LogOut: { parts: { 0: { x: [0, 3, 0] }, 1: { x: [0, 3, 0] } }, dur: 0.45 },
  Mail: { parts: { 0: { y: [0, 2, 0] } } },
  Medal: { svg: { rotate: [0, -12, 9, -4, 0] }, origin: [0.5, 0] },
  Megaphone: { svg: { rotate: [0, -10, 8, -4, 0], scale: [1, 1.08, 1] }, origin: [0.25, 0.6] },
  Menu: { parts: { 0: { x: [0, -3, 0] }, 1: stagger(1, { x: [0, 3, 0] }), 2: stagger(2, { x: [0, -3, 0] }) } },
  MessageCircle: nod,
  MessageCircleOff: wiggle,
  MessageSquare: nod,
  Minimize2: { svg: { scale: [1, 0.82, 1] } },
  Moon: { svg: { rotate: [0, -20, 10, 0] } },
  Mountain: pop,
  MoveUpRight: { svg: { x: [0, 2, 0], y: [0, -2, 0] }, dur: 0.45 },
  Music: { svg: { rotate: [0, -10, 10, 0], y: [0, -2, 0] } },
  Music4: { svg: { rotate: [0, -10, 10, 0], y: [0, -2, 0] } },
  Orbit: { parts: { 3: { rotate: [0, 360] }, 4: { rotate: [0, 360] } }, svg: { rotate: [0, 360] }, dur: 1 },
  Palette: { svg: { rotate: [0, -14, 10, 0] } },
  PartyPopper: {
    svg: { rotate: [0, -12, 0] },
    origin: [0.1, 0.9],
    parts: { 1: { scale: [1, 2, 1] }, 2: { scale: [1, 2, 1] }, 3: { scale: [1, 2, 1] }, 4: { scale: [1, 2, 1] }, 5: { y: [0, -2, 0] }, 6: { x: [0, 2, 0] }, 7: { y: [0, -2, 0] } },
  },
  Pencil: { svg: { rotate: [0, -14, 6, 0], x: [0, -1, 1, 0] } },
  Play: { svg: { x: [0, 2, 0], scale: [1, 1.12, 1] }, dur: 0.45 },
  Plus: { svg: { rotate: [0, 90] }, dur: 0.4 },
  Puzzle: { svg: { rotate: [0, 10, -6, 0], scale: [1, 1.08, 1] } },
  RotateCcw: { svg: { rotate: [0, -360] }, dur: 0.7 },
  Search: { svg: { x: [0, -1.5, 1.5, 0], y: [0, -1.5, 0], rotate: [0, -10, 0] } },
  Settings: { parts: { 0: { rotate: [0, 90] } }, dur: 0.7 },
  Settings2: { parts: { 2: { x: [0, -10, 0] }, 3: { x: [0, 10, 0] } }, dur: 0.7 },
  Share2: { parts: { 0: stagger(0, { scale: [1, 1.35, 1] }), 1: stagger(1, { scale: [1, 1.35, 1] }), 2: stagger(2, { scale: [1, 1.35, 1] }) } },
  Shield: pop,
  ShieldBan: pop,
  ShieldCheck: { parts: { 1: { pathLength: [0, 1] } }, svg: { scale: [1, 1.08, 1] } },
  ShoppingBag: { parts: { 0: { y: [0, 2, 0] } }, svg: { rotate: [0, -6, 6, 0] } },
  Shuffle: { parts: { 0: { x: [0, 2, 0] }, 1: { x: [0, 2, 0] } }, svg: { scaleY: [1, -1, 1] }, dur: 0.6 },
  Smartphone: buzz,
  Spade: bounce,
  Sparkles: {
    parts: { 0: { scale: [1, 0.75, 1.12, 1], rotate: [0, 14, 0] }, 1: { opacity: [1, 0, 1] }, 2: { opacity: [1, 0, 1] }, 3: { scale: [1, 0, 1] } },
    dur: 0.8,
  },
  Sun: { svg: { rotate: [0, 45] }, parts: { 0: { scale: [1, 0.8, 1] } }, dur: 0.6 },
  Swords: { svg: { rotate: [0, -12, 12, 0], scale: [1, 1.08, 1] } },
  Target: { parts: { 0: { scale: [1, 0.92, 1] }, 1: stagger(1, { scale: [1, 1.15, 1] }), 2: stagger(2, { scale: [1, 1.7, 1] }) } },
  TrainFront: { svg: { y: [0, -1, 0, -1, 0] } },
  Trophy: { svg: { y: [0, -2.5, 0, -1, 0], rotate: [0, -7, 6, 0] }, origin: [0.5, 1], dur: 0.7 },
  Tv: { parts: { 0: { rotate: [0, -14, 12, 0] } }, partOrigin: { 0: [0.5, 1] } },
  Type: pop,
  UserPlus: { parts: { 2: { scale: [1, 1.5, 1] }, 3: { scale: [1, 1.5, 1] }, 1: { y: [0, -1.5, 0] } } },
  UserRound: { parts: { 0: { y: [0, -1.6, 0] } } },
  Users: { parts: { 1: { x: [0, 1.6, 0] }, 2: { x: [0, 1.6, 0] }, 3: { y: [0, -1.4, 0] } } },
  Wallet: { parts: { 0: { y: [0, -2, 0] } }, svg: { scale: [1, 1.05, 1] } },
  Wand2: {
    svg: { rotate: [0, -14, 6, 0] },
    origin: [0, 1],
    parts: { 2: { scale: [1, 1.8, 1] }, 3: stagger(1, { scale: [1, 1.8, 1] }), 4: stagger(2, { scale: [1, 1.8, 1] }) },
  },
  WifiOff: { parts: { 1: stagger(0, { opacity: [1, 0.2, 1] }), 2: stagger(1, { opacity: [1, 0.2, 1] }), 3: stagger(1, { opacity: [1, 0.2, 1] }), 4: stagger(2, { opacity: [1, 0.2, 1] }), 5: stagger(2, { opacity: [1, 0.2, 1] }) } },
  Wind: { parts: { 0: { x: [0, 2.5, 0] }, 1: stagger(1, { x: [0, 2.5, 0] }), 2: stagger(2, { x: [0, 2.5, 0] }) } },
  Worm: { svg: { x: [0, 2, -2, 1, 0] } },
  X: { svg: { rotate: [0, 90] }, dur: 0.35 },
  Zap: { svg: { scale: [1, 1.15, 1], rotate: [0, -8, 8, 0] }, parts: { 0: { opacity: [1, 0.4, 1, 0.7, 1] } } },
};

const REST: Record<string, number> = { scale: 1, scaleX: 1, scaleY: 1, opacity: 1, pathLength: 1 };
/** the still pose for every property a move touches */
function rest(t?: Target) {
  const out: Record<string, number> = {};
  for (const k of Object.keys(t ?? {})) if (k !== "transition") out[k] = REST[k] ?? 0;
  return out;
}

const TAGS = { path: m.path, circle: m.circle, rect: m.rect, line: m.line, polyline: m.polyline, polygon: m.polygon, ellipse: m.ellipse } as const;
const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/([a-zA-Z])(\d)/g, "$1-$2").toLowerCase();

export default function AnimSvg({ name, startNow, size = 24, color = "currentColor", strokeWidth = 2, absoluteStrokeWidth, className, fill = "none", children, ...rest_ }: AnimIconProps & { name: string; startNow?: boolean }) {
  const node = (N as Record<string, [string, Record<string, string | number>][]>)[name] ?? [];
  const r = R[name] ?? pop;
  const controls = useAnimationControls();
  const ref = useRef<SVGSVGElement>(null);
  const busy = useRef(false);
  const base: Transition = { duration: r.dur ?? 0.6, ease: r.ease ?? "easeInOut" };

  const run = () => {
    if (busy.current) return;
    busy.current = true;
    void controls.start("play").finally(() => (busy.current = false));
  };

  // hover / tap on the surrounding button
  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    if (r.forever) {
      void controls.start("play");
      return;
    }
    // mounted by the first hover/tap: play that one now
    if (startNow) run();
    const host = svg.parentElement?.closest(TRIGGER) ?? svg;
    const onEnter = (e: PointerEvent) => e.pointerType === "mouse" && run();
    const onDown = (e: PointerEvent) => e.pointerType !== "mouse" && run();
    host.addEventListener("pointerenter", onEnter as EventListener);
    host.addEventListener("pointerdown", onDown as EventListener);
    return () => {
      host.removeEventListener("pointerenter", onEnter as EventListener);
      host.removeEventListener("pointerdown", onDown as EventListener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r]);

  const sw = absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth;
  const label = rest_["aria-label"] || rest_["aria-labelledby"];
  const svgPlay = r.forever ? { ...r.svg, transition: { ...base, repeat: Infinity } } : { ...r.svg, transition: base };

  return (
    <LazyMotion features={domAnimation} strict>
      <m.svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={fill}
        stroke={color}
        strokeWidth={sw}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`lucide lucide-${kebab(name)}${className ? ` ${className}` : ""}`}
        aria-hidden={label ? undefined : true}
        {...(rest_ as object)}
        style={{ ...(r.origin ? { originX: r.origin[0], originY: r.origin[1] } : null), ...rest_.style }}
        initial={false}
        animate={controls}
        variants={{ rest: rest(r.svg), play: svgPlay }}
      >
        {node.map(([tag, attrs], i) => {
          const El = TAGS[tag as keyof typeof TAGS];
          if (!El) return null;
          const part = r.parts?.[i];
          const o = r.partOrigin?.[i];
          const { key: _k, ...a } = attrs as Record<string, string | number> & { key?: string };
          return (
            <El
              key={i}
              {...(a as object)}
              style={o ? { originX: o[0], originY: o[1] } : undefined}
              variants={part ? { rest: rest(part), play: { transition: base, ...part } } : undefined}
            />
          );
        })}
        {children as ReactNode}
      </m.svg>
    </LazyMotion>
  );
}
