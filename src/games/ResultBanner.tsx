/* "You won!" / "You lost" / "Draw" card shown over the game when a round is decided.
   Shared by every game with a winner (tic-tac-toe, connect four, minesweeper, hangman, carrom…).
   Tapping "See board" (or the backdrop) hides it so the final position stays visible. */
import { useState, type ReactNode } from "react";
import "./result-banner.css";
import { GameShopButton } from "./gameShop";

export type Outcome = "win" | "lose" | "draw";

const TITLES: Record<Outcome, string> = { win: "You won!", lose: "You lost", draw: "It's a draw" };

/* Line-drawn icon: a ring draws itself, then the symbol inside, then (on a win) sparks fly out. */
function OutcomeIcon({ outcome }: { outcome: Outcome }) {
  return (
    <svg className="rb-svg" viewBox="0 0 64 64" width="88" height="88" aria-hidden="true">
      <circle className="rb-ring" cx="32" cy="32" r="28" pathLength={1} />
      {outcome === "win" ? (
        <>
          <g className="rb-sym">
            <path d="M23 18h18v9a9 9 0 0 1-18 0z" pathLength={1} />
            <path d="M23 21h-4a4 4 0 0 0 4 7" pathLength={1} />
            <path d="M41 21h4a4 4 0 0 1-4 7" pathLength={1} />
            <path d="M32 36v7M26 46h12" pathLength={1} />
          </g>
          <g className="rb-sparks">
            {[0, 60, 120, 180, 240, 300].map((a) => (
              <line key={a} x1="32" y1="0" x2="32" y2="-5" style={{ "--a": `${a}deg` } as React.CSSProperties} />
            ))}
          </g>
        </>
      ) : outcome === "lose" ? (
        <g className="rb-sym">
          <path d="M24 26v1M40 26v1" pathLength={1} />
          <path d="M23 43a11 9 0 0 1 18 0" pathLength={1} />
        </g>
      ) : (
        <g className="rb-sym">
          <path d="M22 27h20M22 37h20" pathLength={1} />
        </g>
      )}
    </svg>
  );
}

export default function ResultBanner({
  outcome,
  title,
  detail,
  againLabel = "Play again",
  onAgain,
}: {
  outcome: Outcome;
  /** override the headline (e.g. "Player 2 wins!" on a shared device) */
  title?: ReactNode;
  detail?: ReactNode;
  againLabel?: string;
  onAgain?: () => void;
}) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  return (
    <div className={`rb rb-${outcome}`} role="dialog" aria-modal="false" aria-live="assertive" onClick={() => setHidden(true)}>
      <div className="rb-card" onClick={(e) => e.stopPropagation()}>
        <OutcomeIcon outcome={outcome} />
        <h3 className="rb-title">{title ?? TITLES[outcome]}</h3>
        {detail ? <p className="rb-detail">{detail}</p> : null}
        <div className="rb-actions">
          <button type="button" className="rb-btn rb-btn-ghost" onClick={() => setHidden(true)}>
            See board
          </button>
          <GameShopButton className="rb-btn rb-btn-ghost" onOpen={() => setHidden(true)} />
          {onAgain ? (
            <button
              type="button"
              className="rb-btn rb-btn-main"
              onClick={() => {
                setHidden(true);
                onAgain();
              }}
            >
              {againLabel}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
