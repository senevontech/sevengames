/* One-shot celebration overlays: celebrate("chips") from anywhere.
   The <Celebrations /> host in App.tsx plays them; its code and animation files download on the
   first celebration only. Nothing plays in Lite mode or with "reduce motion". */
export type CelebrationKind = "confetti" | "coins" | "stars";

type Listener = (kind: CelebrationKind) => void;
const listeners = new Set<Listener>();

export function celebrate(kind: CelebrationKind) {
  listeners.forEach((l) => l(kind));
}

export function onCelebrate(l: Listener) {
  listeners.add(l);
  return () => void listeners.delete(l);
}
