import { useState } from "react";
import {
  ArrowUpDown,
  Spade,
  Disc,
  Atom,
  Bomb,
  Brain,
  Building2,
  Calculator,
  CircleDot,
  Columns3,
  Copy,
  Gamepad2,
  Grid2x2,
  Hammer,
  Hash,
  Keyboard,
  Layers,
  Lightbulb,
  MoveUpRight,
  Music,
  Music4,
  Orbit,
  Palette,
  Puzzle,
  Target,
  TrainFront,
  Trophy,
  Type,
  Wind,
  Worm,
  type LucideIcon,
} from "lucide-react";
import type { Game } from "../catalog";

const byEngine: Record<string, LucideIcon> = {
  tictactoe: Hash,
  memory: Copy,
  reflex: Target,
  simon: Music,
  "2048": Grid2x2,
  minesweeper: Bomb,
  hangman: Type,
  quiz: Brain,
  math: Calculator,
  word: Keyboard,
  "higher-lower": ArrowUpDown,
  "whack-a-mole": Hammer,
  "color-match": Palette,
  "sliding-puzzle": Puzzle,
  snake: Worm,
  carrom: CircleDot,
  stack: Layers,
  dodge: Wind,
  "connect-four": Columns3,
  "lights-out": Lightbulb,
  arrows: MoveUpRight,
  blackjack: Spade,
  pool: Disc,
  chain: Atom,
  tune: Music4,
};

const byId: Record<string, LucideIcon> = {
  "yat-c": Building2,
  infitunnel: Orbit,
  publicport: TrainFront,
  "pov-cricket": Trophy,
};

export function posterIcon(game: Game): LucideIcon {
  return byId[game.id] ?? (game.kind === "builtin" ? byEngine[game.engine] : undefined) ?? Gamepad2;
}

/**
 * Game poster. Uses `game.poster` (an image URL) when set; otherwise draws a
 * generated poster from the game's accent colour and icon.
 */
export type PosterSize = "card" | "portrait" | "hero" | "thumb";

export function GamePoster({
  game,
  size = "card",
  hideBadge = false,
}: {
  game: Game;
  size?: PosterSize;
  hideBadge?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const Icon = posterIcon(game);
  const hasImage = Boolean(game.poster) && !failed;

  return (
    <div className={`poster poster-${size}${hasImage ? " has-image" : ""}`} aria-hidden="true">
      {hasImage ? (
        <img src={game.poster} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
      ) : (
        <>
          <span className="poster-grid" />
          <span className="poster-ring r1" />
          <span className="poster-ring r2" />
          <span className="poster-mono">{game.title.slice(0, 1)}</span>
          <span className="poster-icon">
            <Icon size={size === "hero" ? 40 : size === "thumb" ? 20 : 30} strokeWidth={1.75} />
          </span>
        </>
      )}
      {game.kind === "iframe" && size !== "thumb" && !hideBadge ? (
        <span className="poster-badge">Web</span>
      ) : null}
    </div>
  );
}
