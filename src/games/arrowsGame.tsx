/* Arrows: Solo (levels, saved progress, shop boosters) or Online (race / infinite matches).
   Start screen: Play → Solo / Online (PlayFlow), then the game with a small Back button. */
import { useState } from "react";
import { ChevronLeft, Globe, User } from "lucide-react";
import type { GameProps } from "./index";
import { ArrowsPlay } from "./arrows";
import ArrowsOnline from "./arrowsOnline";
import PlayFlow from "./PlayFlow";

export default function ArrowsGame({ onFinish }: GameProps) {
  const [mode, setMode] = useState<"solo" | "online" | null>(null);
  const [busy, setBusy] = useState(false); // in a room or match: Back steps aside

  if (!mode) {
    return (
      <div className="arw-shell">
        <PlayFlow
          id="arrows"
          preview={
            <div className="pf-preview arw-preview" inert>
              <ArrowsPlay onFinish={() => {}} />
            </div>
          }
          modes={[
            { key: "solo", label: "Solo", icon: <User size={15} />, start: () => setMode("solo") },
            { key: "online", label: "Online", icon: <Globe size={15} />, start: () => setMode("online") },
          ]}
        />
      </div>
    );
  }

  return (
    <div className="arw-shell">
      {!busy ? (
        <div className="pf-back-row">
          <button type="button" className="pf-back" aria-label="Back to ways to play" onClick={() => setMode(null)}>
            <ChevronLeft size={18} />
          </button>
          <span>{mode === "solo" ? "Solo" : "Online"}</span>
        </div>
      ) : null}
      {mode === "solo" ? <ArrowsPlay onFinish={onFinish} /> : <ArrowsOnline onBusy={setBusy} />}
    </div>
  );
}

/** Paid-game preview (behind "Start game"): the solo board, frozen. */
export function ArrowsPreview() {
  return (
    <div className="gp-preview" inert>
      <div className="arw-shell">
        <ArrowsPlay onFinish={() => {}} />
      </div>
    </div>
  );
}
