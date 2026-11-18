/* Arrows: Solo (levels, saved progress, shop boosters) or Online (race / infinite matches). */
import { useState } from "react";
import type { GameProps } from "./index";
import { ArrowsPlay } from "./arrows";
import ArrowsOnline from "./arrowsOnline";

export default function ArrowsGame({ onFinish }: GameProps) {
  const [tab, setTab] = useState<"solo" | "online">("solo");
  const [busy, setBusy] = useState(false); // in a room or match: the tabs step aside

  return (
    <div className="arw-shell">
      {!busy ? (
        <div className="arw-seg arw-tabs" role="tablist" aria-label="Play mode">
          {(["solo", "online"] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
              {t === "solo" ? "Solo" : "Online"}
            </button>
          ))}
        </div>
      ) : null}
      {tab === "solo" ? <ArrowsPlay onFinish={onFinish} /> : <ArrowsOnline onBusy={setBusy} />}
    </div>
  );
}
