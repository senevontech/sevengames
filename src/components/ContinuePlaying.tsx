import { Link } from "react-router-dom";
import { ArrowRight, Play } from "./anim-icons";
import { getGame, scoreLabel, type Game } from "../catalog";
import { useRecent, timeAgo } from "../lib/recent";
import { useBestForGame } from "../hooks/useBest";
import { GamePoster } from "./GamePoster";

function Row({ game, at }: { game: Game; at: number }) {
  const best = useBestForGame(game.id);
  return (
    <li>
      <Link to={`/game/${game.id}`} className="cp-row" style={{ "--accent": game.accent } as React.CSSProperties}>
        <GamePoster game={game} size="thumb" />
        <span className="cp-text">
          <strong>{game.title}</strong>
          <small>{best !== null ? `${scoreLabel(game)} ${best}` : `Played ${timeAgo(at)}`}</small>
        </span>
        <span className="cp-play" aria-hidden="true">
          <Play size={14} fill="currentColor" />
        </span>
      </Link>
    </li>
  );
}

/** Recently opened games on this device. Renders nothing until something has been played. */
export default function ContinuePlaying({ limit = 4 }: { limit?: number }) {
  const recent = useRecent()
    .map((entry) => ({ entry, game: getGame(entry.id) }))
    .filter((r): r is { entry: { id: string; at: number }; game: Game } => Boolean(r.game))
    .slice(0, limit);

  if (!recent.length) return null;

  return (
    <section className="panel cp" aria-labelledby="cp-title">
      <header className="panel-head">
        <h2 id="cp-title">Continue playing</h2>
        <Link to="/profile" className="panel-link" aria-label="See your stats">
          <ArrowRight size={18} />
        </Link>
      </header>
      <ul className="cp-list">
        {recent.map(({ entry, game }) => (
          <Row key={game.id} game={game} at={entry.at} />
        ))}
      </ul>
    </section>
  );
}
