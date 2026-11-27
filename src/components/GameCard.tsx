import { Link } from "react-router-dom";
import { Play } from "./anim-icons";
import type { Game } from "../catalog";
import { scoreLabel } from "../catalog";
import { GamePoster } from "./GamePoster";

export function GameCard({ game, best, index = 0 }: { game: Game; best: number | null; index?: number }) {
  // Pointer position drives the spotlight + subtle 3D tilt (see CSS). Mouse only.
  function onMove(e: React.PointerEvent<HTMLAnchorElement>) {
    if (e.pointerType !== "mouse") return;
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    el.style.setProperty("--mx", `${x * 100}%`);
    el.style.setProperty("--my", `${y * 100}%`);
    el.style.setProperty("--rx", `${((0.5 - y) * 6).toFixed(2)}deg`);
    el.style.setProperty("--ry", `${((x - 0.5) * 8).toFixed(2)}deg`);
  }
  function onLeave(e: React.PointerEvent<HTMLAnchorElement>) {
    const el = e.currentTarget;
    el.style.setProperty("--rx", "0deg");
    el.style.setProperty("--ry", "0deg");
  }

  return (
    <Link
      to={`/game/${game.id}`}
      className="game-card"
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      style={{ "--accent": game.accent, "--i": Math.min(index, 14) } as React.CSSProperties}
    >
      <div className="game-card-media">
        <GamePoster game={game} size="portrait" />
        <div className="game-card-overlay">
          <span className="game-chip">{game.category}</span>
          <h3>{game.title}</h3>
        </div>
        <span className="game-card-play" aria-hidden="true">
          <Play size={16} fill="currentColor" />
        </span>
      </div>
      <div className="game-card-body">
        <p className="game-meta">
          {game.difficulty} · {game.minutes} min
        </p>
        <p className="game-best">{best !== null ? `${scoreLabel(game)} ${best}` : scoreLabel(game)}</p>
      </div>
    </Link>
  );
}
