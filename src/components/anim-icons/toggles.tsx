/* Two-state icons from useAnimations (useanimations.com): the burger that morphs into a close
   cross, the favourite heart that fills, and a looping loader. Each draws the plain lucide-react
   icon in Lite mode / reduced motion and until its small player has downloaded. */
import { lazy, Suspense } from "react";
import { Heart as SHeart, LoaderCircle as SLoader, Menu as SMenu, X as SX } from "lucide-react";
import { useStillIcons } from "./index";

const Player = lazy(() => import("./uaPlayer"));

type Base = { size?: number; className?: string };

/** hamburger ↔ close cross; `open` is the menu state */
export function MenuToggle({ open, size = 22, strokeWidth = 2, className }: Base & { open: boolean; strokeWidth?: number }) {
  const still = useStillIcons();
  const fallback = open ? <SX size={size} strokeWidth={strokeWidth} aria-hidden="true" /> : <SMenu size={size} strokeWidth={strokeWidth} aria-hidden="true" />;
  if (still) return fallback;
  return (
    <Suspense fallback={fallback}>
      <Player kind="menu" active={open} size={size} className={className} />
    </Suspense>
  );
}

/** outline heart ↔ filled heart; `on` is the saved state */
export function HeartToggle({ on, size = 19, className }: Base & { on: boolean }) {
  const still = useStillIcons();
  const fallback = <SHeart size={size} strokeWidth={2} fill={on ? "currentColor" : "none"} aria-hidden="true" />;
  if (still) return fallback;
  return (
    <Suspense fallback={fallback}>
      <Player kind="heart" active={on} size={size} className={className} />
    </Suspense>
  );
}

/** a looping loader (spins on its own; in Lite mode the CSS .spin class still turns the plain one) */
export function Spinner({ size = 22, className }: Base) {
  const still = useStillIcons();
  const fallback = <SLoader className={`spin${className ? ` ${className}` : ""}`} size={size} />;
  if (still) return fallback;
  return (
    <Suspense fallback={fallback}>
      <Player kind="loading" size={size} className={className} />
    </Suspense>
  );
}
