import { Link } from "react-router-dom";
import { ArrowRight, Trophy } from "lucide-react";
import type { LeaderRow } from "../lib/scores";
import PlayerAvatar from "./PlayerAvatar";

export default function Leaderboard({
  leaders,
  loading,
  error,
  scoreLabel,
  userId,
  personalBest,
  gameId,
}: {
  leaders: LeaderRow[];
  loading: boolean;
  error?: string | null;
  scoreLabel: string;
  userId: string | undefined;
  personalBest: number | null;
  /** links to the full page for this game */
  gameId?: string;
}) {
  return (
    <aside className="leaderboard">
      <h2>
        <Trophy size={16} />
        {scoreLabel} — Top 10
      </h2>

      {loading ? (
        <p className="leaderboard-empty">Loading…</p>
      ) : error ? (
        <p className="leaderboard-empty">{error}</p>
      ) : leaders.length === 0 ? (
        <p className="leaderboard-empty">No scores yet — be the first on the board.</p>
      ) : (
        <ol className="leaderboard-list">
          {leaders.map((row) => {
            const isYou = row.userId === userId;
            return (
              <li key={`${row.rank}-${row.userId}`} className={isYou ? "you" : ""}>
                <span className="rank">{row.rank}</span>
                <PlayerAvatar id={row.userId} name={row.displayName} avatar={row.avatar} size={24} className="lb-initial lb-mini" />
                <span className="name">{isYou ? "You" : row.displayName}</span>
                <span className="value">{row.score}</span>
              </li>
            );
          })}
        </ol>
      )}

      {userId && personalBest !== null ? (
        <p className="leaderboard-personal">Your best: {personalBest}</p>
      ) : null}
      {!userId ? <p className="leaderboard-personal">Sign in to compete globally.</p> : null}
      <Link className="leaderboard-more" to={gameId ? `/leaderboards?game=${gameId}` : "/leaderboards"}>
        Full leaderboard <ArrowRight size={14} aria-hidden="true" />
      </Link>
    </aside>
  );
}
