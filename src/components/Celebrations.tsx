/* Plays celebrate(...) overlays: confetti, coins, stars. Mounted once in App.tsx.
   A full-screen layer that ignores taps, so the page underneath stays usable. Its player
   (react-useanimations' 8 kB SVG player) and the Lottie files load on the first celebration. */
import { lazy, Suspense, useEffect, useState } from "react";
import { onCelebrate, type CelebrationKind } from "../lib/celebrate";
import { useStillIcons } from "./anim-icons";

const Player = lazy(() => import("./celebrate/Player"));

export default function Celebrations() {
  const still = useStillIcons();
  const [shot, setShot] = useState<{ kind: CelebrationKind; id: number } | null>(null);

  useEffect(() => onCelebrate((kind) => setShot({ kind, id: Date.now() })), []);
  if (still || !shot) return null;
  return (
    <Suspense fallback={null}>
      <Player key={shot.id} kind={shot.kind} onDone={() => setShot(null)} />
    </Suspense>
  );
}
