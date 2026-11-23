/* "How to play": the "?" icon in the game page's icon bar opens a short step-by-step tutorial
   (content: src/games/howToPlay.ts). Opens over the page, never inside the game window. */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, HelpCircle, X } from "lucide-react";
import { howToFor, type HowTo } from "../games/howToPlay";
import "./how-to-play.css";

/** The "?" icon; renders nothing for games without a tutorial. */
export function HowToPlayButton({ engine, title, size = 15 }: { engine: string | undefined; title: string; size?: number }) {
  const [open, setOpen] = useState(false);
  const how = howToFor(engine);
  if (!how) return null;
  return (
    <>
      <button type="button" className={`htp-btn${open ? " active" : ""}`} onClick={() => setOpen(true)} aria-label="How to play" title="How to play">
        <HelpCircle size={size} aria-hidden="true" />
      </button>
      {open ? <HowToPlaySheet how={how} title={title} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function HowToPlaySheet({ how, title, onClose }: { how: HowTo; title: string; onClose: () => void }) {
  const pages = how.steps.length + 1; // steps + the controls summary
  const [i, setI] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const touch = useRef<number | null>(null);
  const last = i === pages - 1;

  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") setI((n) => Math.min(pages - 1, n + 1));
      else if (e.key === "ArrowLeft") setI((n) => Math.max(0, n - 1));
      else return;
      e.stopPropagation();
      e.preventDefault();
    };
    // capture: games listen to arrow keys on window too; the tutorial gets them first
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      prevFocus?.focus?.();
    };
  }, [onClose, pages]);

  // in real full screen only the game window is visible, so open inside it
  const host = (document.fullscreenElement as HTMLElement | null) ?? document.querySelector(".site") ?? document.body;
  const step = how.steps[i];

  return createPortal(
    <div className="htp" role="dialog" aria-modal="true" aria-label={`How to play ${title}`} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="htp-panel"
        ref={panelRef}
        tabIndex={-1}
        onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (touch.current === null) return;
          const dx = e.changedTouches[0].clientX - touch.current;
          touch.current = null;
          if (dx < -40) setI((n) => Math.min(pages - 1, n + 1));
          else if (dx > 40) setI((n) => Math.max(0, n - 1));
        }}
      >
        <header className="htp-head">
          <span className="htp-kicker">How to play</span>
          <h2>{title}</h2>
          <button type="button" className="htp-x" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <div className="htp-body" key={i} aria-live="polite">
          {step ? (
            <>
              <span className="htp-icon" aria-hidden="true">
                {step.icon}
              </span>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </>
          ) : (
            <>
              <span className="htp-icon" aria-hidden="true">
                🎮
              </span>
              <h3>Controls &amp; tips</h3>
              <ul className="htp-list">
                {how.controls.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="htp-dots" role="tablist" aria-label="Steps">
          {Array.from({ length: pages }, (_, n) => (
            <button key={n} type="button" role="tab" aria-selected={n === i} aria-label={`Step ${n + 1}`} className={n === i ? "on" : ""} onClick={() => setI(n)} />
          ))}
        </div>

        <footer className="htp-foot">
          <button type="button" className="htp-nav" onClick={() => setI((n) => n - 1)} disabled={i === 0}>
            <ChevronLeft size={16} aria-hidden="true" /> Back
          </button>
          {last ? (
            <button type="button" className="htp-nav is-primary" onClick={onClose}>
              Got it
            </button>
          ) : (
            <button type="button" className="htp-nav is-primary" onClick={() => setI((n) => n + 1)}>
              Next <ChevronRight size={16} aria-hidden="true" />
            </button>
          )}
        </footer>
      </div>
    </div>,
    host,
  );
}
