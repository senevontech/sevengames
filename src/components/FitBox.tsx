import { useLayoutEffect, useRef, type ReactNode } from "react";

/**
 * Fills its parent and shows `children` as large as fits, without scrolling.
 *
 * The content is laid out at its own natural width (at most the box's width), measured, then
 * scaled to fit the box: down when it's too big, up to `maxScale` when there's room, centred.
 * Scaling is a CSS transform, so the games' own pointer maths (which divide by their on-screen
 * size) keep working. It re-fits whenever the box or the content changes size.
 */
export default function FitBox({ children, maxScale = 1 }: { children: ReactNode; maxScale?: number }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const outer = outerRef.current!;
    const inner = innerRef.current!;
    const fit = () => {
      const w = inner.offsetWidth;
      const h = inner.offsetHeight;
      if (!w || !h) return;
      const s = Math.min(maxScale, outer.clientWidth / w, outer.clientHeight / h);
      inner.style.transform = `translateY(-50%) scale(${s > 0 ? s : 1})`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(outer);
    ro.observe(inner);
    return () => ro.disconnect();
  }, [maxScale]);

  return (
    <div className="fitbox" ref={outerRef}>
      <div className="fitbox-inner" ref={innerRef}>
        {children}
      </div>
    </div>
  );
}
