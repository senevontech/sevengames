/* The celebration player (its own download). Lottie files come from
   scripts/make-celebrations.mjs; each one is fetched when first needed. */
import { useEffect, useState } from "react";
import UseAnimations from "react-useanimations";
import type { CelebrationKind } from "../../lib/celebrate";
import "./celebrate.css";

const FILES: Record<CelebrationKind, () => Promise<{ default: { fr: number; op: number } }>> = {
  confetti: () => import("./confetti.json"),
  coins: () => import("./coins.json"),
  stars: () => import("./stars.json"),
};

export default function Player({ kind, onDone }: { kind: CelebrationKind; onDone: () => void }) {
  const [data, setData] = useState<{ fr: number; op: number } | null>(null);

  useEffect(() => {
    let live = true;
    void FILES[kind]().then((m) => live && setData(m.default));
    return () => {
      live = false;
    };
  }, [kind]);

  useEffect(() => {
    if (!data) return;
    const t = window.setTimeout(onDone, (data.op / data.fr) * 1000 + 80);
    return () => window.clearTimeout(t);
  }, [data, onDone]);

  if (!data) return null;
  return (
    <div className="cel-layer" aria-hidden="true">
      <UseAnimations animation={{ animationData: data, interaction: "loop" }} autoplay loop={false} size="min(92vw, 520px)" className="cel-anim" />
    </div>
  );
}
