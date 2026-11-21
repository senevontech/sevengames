import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft } from "lucide-react";
import "./shop-sheet.css";

/**
 * A game's shop as a full-screen sheet: slides up on phones, a large centered panel on wider
 * screens. Rendered inside `.site` (not straight into <body>) so it keeps the game page's
 * light / dark theme; `accent` tints it with the game's colour.
 */
export default function ShopSheet({
  title,
  accent,
  onClose,
  children,
}: {
  title: string;
  accent?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Esc closes; the page behind doesn't scroll; focus moves into the sheet and back after
  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const html = document.documentElement;
    const prevOverflow = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      html.style.overflow = prevOverflow;
      prevFocus?.focus?.();
    };
  }, [onClose]);

  const host = (typeof document !== "undefined" && document.querySelector(".site")) || document.body;
  return createPortal(
    <div
      className="ss"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={accent ? ({ "--ss-accent": accent } as React.CSSProperties) : undefined}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="ss-panel" ref={panelRef} tabIndex={-1}>
        <header className="ss-head">
          <button type="button" className="ss-back" onClick={onClose}>
            <ChevronLeft size={18} aria-hidden="true" />
            Back
          </button>
          <h2>{title}</h2>
        </header>
        <div className="ss-body">{children}</div>
      </div>
    </div>,
    host,
  );
}
