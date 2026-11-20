/* "You won!" / "You lost" / "Draw" card shown over the game when a round is decided.
   Shared by every game with a winner (tic-tac-toe, connect four, minesweeper, hangman, carrom…).
   Tapping "See board" (or the backdrop) hides it so the final position stays visible. */
import { useState, type ReactNode } from "react";
import { Frown, Handshake, Trophy } from "lucide-react";
import "./result-banner.css";

export type Outcome = "win" | "lose" | "draw";

const TITLES: Record<Outcome, string> = { win: "You won!", lose: "You lost", draw: "It's a draw" };

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
  const Icon = outcome === "win" ? Trophy : outcome === "lose" ? Frown : Handshake;
  return (
    <div className={`rb rb-${outcome}`} role="dialog" aria-modal="false" aria-live="assertive" onClick={() => setHidden(true)}>
      <div className="rb-card" onClick={(e) => e.stopPropagation()}>
        {outcome === "win" ? (
          <div className="rb-burst" aria-hidden="true">
            {Array.from({ length: 12 }, (_, i) => (
              <i key={i} style={{ "--a": `${i * 30}deg` } as React.CSSProperties} />
            ))}
          </div>
        ) : null}
        <span className="rb-icon" aria-hidden="true">
          <Icon size={34} strokeWidth={2.2} />
        </span>
        <h3 className="rb-title">{title ?? TITLES[outcome]}</h3>
        {detail ? <p className="rb-detail">{detail}</p> : null}
        <div className="rb-actions">
          <button type="button" className="ghost-btn" onClick={() => setHidden(true)}>
            See board
          </button>
          {onAgain ? (
            <button
              type="button"
              className="primary-btn"
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
