import { useState } from "react";
import type { Game } from "../catalog";
import { posterIcon } from "./GamePoster";

/**
 * A game as a circle: a raised soft (neumorphic) rim around its poster art. Without a poster
 * (or if it fails to load) the face is the game's colour with a large faint initial, a thin
 * inner ring and its icon, so art-less games still look distinct.
 */
export default function GameDisk({ game, iconSize = 22 }: { game: Game; iconSize?: number }) {
  const [failed, setFailed] = useState(false);
  const Icon = posterIcon(game);
  const hasImage = Boolean(game.poster) && !failed;

  return (
    <span className="gd" style={{ "--gd-accent": game.accent } as React.CSSProperties} aria-hidden="true">
      <span className={`gd-face${hasImage ? " has-img" : ""}`}>
        {hasImage ? (
          <img src={game.poster} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)} />
        ) : (
          <>
            <span className="gd-letter">{game.title.charAt(0)}</span>
            <span className="gd-ring" />
            <Icon className="gd-icon" size={iconSize} strokeWidth={1.75} />
          </>
        )}
      </span>
    </span>
  );
}
