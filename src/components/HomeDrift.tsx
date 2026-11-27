/* Home page only: a few outlined shapes (circle, square, triangle; stroke only, corners rounded
   ~15%) drifting slowly behind the content, from the bottom-left to the top-right, swaying and
   tumbling like petals on a breeze.

   Cheap by design: 6 small elements (4 on phones), pure CSS animations of transform only
   (run by the compositor, no JavaScript per frame), no fill / blur / glow / shadow.
   Not drawn at all in Lite mode or with "reduce motion". Colours, sizes, opacities (5–50%),
   speeds and paths are picked at random once per visit. */
import { useMemo } from "react";
import { useStillIcons } from "./anim-icons";
import "./home-drift.css";

type Kind = "circle" | "square" | "triangle";
const KINDS: Kind[] = ["circle", "square", "triangle"];
const COUNT = 6;

/* outlines only, corners rounded by ~15% of a side */
const SHAPES: Record<Kind, React.ReactNode> = {
  circle: <circle cx="12" cy="12" r="9" />,
  square: <rect x="3" y="3" width="18" height="18" rx="2.7" />,
  triangle: <path d="M10.62 6Q12 3.6 13.38 6L19.82 17.2Q21.2 19.6 18.43 19.6L5.57 19.6Q2.8 19.6 4.18 17.2Z" />,
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export default function HomeDrift() {
  const still = useStillIcons();
  const shapes = useMemo(
    () =>
      Array.from({ length: COUNT }, (_, i) => {
        const dur = rand(34, 52); // seconds for one trip across the screen
        return {
          kind: KINDS[i % KINDS.length],
          style: {
            "--size": `${Math.round(rand(22, 46))}px`,
            "--color": `hsl(${Math.round(rand(0, 360))} ${Math.round(rand(60, 85))}% ${Math.round(rand(48, 62))}%)`,
            "--alpha": rand(0.05, 0.5).toFixed(2),
            // start somewhere along the bottom-left, end somewhere along the top-right
            "--x0": `${rand(-15, 35).toFixed(1)}vw`,
            "--x1": `${rand(75, 115).toFixed(1)}vw`,
            "--dur": `${dur.toFixed(1)}s`,
            // a negative delay spreads them out, so the screen isn't empty at first
            "--delay": `${(-rand(0, dur)).toFixed(1)}s`,
            "--sway": `${rand(2.5, 5).toFixed(1)}vh`,
            "--sway-dur": `${rand(5, 8).toFixed(1)}s`,
            "--spin-dur": `${rand(14, 24).toFixed(1)}s`,
            "--spin-dir": Math.random() < 0.5 ? "normal" : "reverse",
          } as React.CSSProperties,
        };
      }),
    [],
  );

  if (still) return null;
  return (
    <div className="hd-layer" aria-hidden="true">
      {shapes.map((s, i) => (
        <span key={i} className="hd-path" style={s.style}>
          <span className="hd-sway">
            <svg className="hd-shape" viewBox="0 0 24 24">
              {SHAPES[s.kind]}
            </svg>
          </span>
        </span>
      ))}
    </div>
  );
}
