import { Component, Suspense, lazy, useEffect, useRef, useState, type ReactNode } from "react";
import TokenIcon from "../TokenIcon";
import { isLite } from "../../lib/perf";
import "./chip-showcase.css";

/* The chip in 3D, small and floating on the page (no box, no background). The 3D code
   (three.js) is only downloaded when it's near the screen; without WebGL, or if the scene
   fails, the flat chip shows instead. Size it with CSS (width / height on `className`). */
const Chip3D = lazy(() => import("./Chip3D"));

function hasWebGL() {
  try {
    const cv = document.createElement("canvas");
    return Boolean(cv.getContext("webgl2") || cv.getContext("webgl"));
  } catch {
    return false;
  }
}

class SceneGuard extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export default function ChipShowcase({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false); // close enough to load
  const [onScreen, setOnScreen] = useState(false); // drawing frames
  // lite mode (low-end phones): the flat chip, and three.js is never downloaded
  const [webgl] = useState(() => !isLite() && hasWebGL());
  const [mobile] = useState(() => {
    try {
      return window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 720;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setNear(true);
      setOnScreen(true);
      return;
    }
    const load = new IntersectionObserver(([e]) => e.isIntersecting && setNear(true), { rootMargin: "300px" });
    const vis = new IntersectionObserver(([e]) => setOnScreen(e.isIntersecting));
    load.observe(el);
    vis.observe(el);
    return () => {
      load.disconnect();
      vis.disconnect();
    };
  }, []);

  const flat = (
    <span className="chip-float-flat">
      <TokenIcon size="100%" />
    </span>
  );

  return (
    <div ref={ref} className={`chip-float ${className}`.trim()} aria-hidden="true">
      {webgl && near ? (
        <SceneGuard fallback={flat}>
          <Suspense fallback={flat}>
            <Chip3D mobile={mobile} active={onScreen} />
          </Suspense>
        </SceneGuard>
      ) : (
        flat
      )}
    </div>
  );
}
