import { useLayoutEffect, useRef, type ReactNode } from "react";

/**
 * Fills its parent and shows `children` as large as fits, without scrolling.
 *
 * The content is laid out at the box's full width (games size themselves from it), then the
 * width of what's actually drawn is measured (wrappers that merely span the full width are
 * skipped), and the whole thing is scaled to fit the box: down when it's too big, up to
 * `maxScale` when there's room, centred. Scaling is a CSS transform, so the games' own pointer
 * maths (which divide by their on-screen size) keep working. It re-fits whenever the box or the
 * content changes size.
 */
export default function FitBox({ children, maxScale = 1 }: { children: ReactNode; maxScale?: number }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const outer = outerRef.current!;
    const inner = innerRef.current!;

    /** Width (in layout px) of the drawn content, measured symmetrically about the centre. */
    const drawnWidth = () => {
      const box = inner.getBoundingClientRect();
      const full = inner.offsetWidth;
      if (!full || !box.width) return full;
      const current = box.width / full; // the scale applied right now
      const cx = box.left + box.width / 2;
      const pad = parseFloat(getComputedStyle(inner).paddingLeft) || 0;
      const contentW = box.width - 2 * pad * current; // the box's width inside its padding
      let half = 0;
      inner.querySelectorAll<HTMLElement>("*").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return;
        // a wrapper as wide as the box says nothing about how wide the content is
        if (r.width >= contentW - 2 && el.childElementCount > 0) return;
        half = Math.max(half, cx - r.left, r.right - cx);
      });
      if (!half) return full;
      return Math.min(full, (2 * half) / current + 2 * pad);
    };

    const fit = () => {
      const h = inner.offsetHeight;
      const w = drawnWidth();
      if (!w || !h) return;
      const s = Math.min(maxScale, outer.clientWidth / w, outer.clientHeight / h);
      inner.style.transform = `translate(-50%, -50%) scale(${s > 0 ? s : 1})`;
    };

    fit();
    const ro = new ResizeObserver(() => fit());
    ro.observe(outer);
    ro.observe(inner);
    // content swapping inside (menu → board) without changing the wrapper's height
    let raf = 0;
    const mo = new MutationObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(fit);
    });
    mo.observe(inner, { childList: true, subtree: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [maxScale]);

  return (
    <div className="fitbox" ref={outerRef}>
      <div className="fitbox-inner" ref={innerRef}>
        {children}
      </div>
    </div>
  );
}
