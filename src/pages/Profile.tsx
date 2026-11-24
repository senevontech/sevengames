import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, Gamepad2, History, LogOut, Pencil, ShieldCheck, Trophy } from "lucide-react";
import { promptAdFree } from "../lib/adFreePromo";
import TokenIcon from "../components/TokenIcon";
import { useAuthContext } from "../context/AuthContext";
import { useAvatar } from "../lib/avatar";
import AvatarLibrary from "../components/AvatarLibrary";
import { GamePoster } from "../components/GamePoster";
import { games, scoreLabel } from "../catalog";
import { isLowerBetter, usePersonalScores } from "../lib/scores";
import { useShowAds, useTokens } from "../lib/tokens";
import { PROGRESS_GAMES, useGameProgress } from "../lib/progress";
import { formatTokens } from "../lib/currency";
import "./account.css";
import "./profile.css";
import AvatarFrame from "../components/AvatarFrame";
import FriendsSection from "../components/FriendsSection";
import AchievementGrid from "../components/AchievementGrid";
import { achievementsSync, type Achievement } from "../lib/engagement";

/** One game's saved level, with a two-step reset. */
function ProgressRow({ gameId }: { gameId: string }) {
  const game = games.find((g) => g.id === gameId);
  const progress = useGameProgress(gameId);
  const [confirming, setConfirming] = useState(false);
  if (!game) return null;
  return (
    <li className="pf-progress-row">
      <Link to={`/game/${game.id}`} className="pf-progress-game">
        <GamePoster game={game} size="thumb" />
        <span className="pf-best-title">{game.title}</span>
      </Link>
      <span className="pf-best-score">
        <small>Level</small>
        <b>{progress.level}</b>
      </span>
      {confirming ? (
        <span className="pf-progress-confirm">
          <button type="button" className="ac-btn ac-btn-sm ac-btn-ghost" onClick={() => setConfirming(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="ac-btn ac-btn-sm pf-progress-danger"
            onClick={() => {
              progress.reset();
              setConfirming(false);
            }}
          >
            Reset to 1
          </button>
        </span>
      ) : (
        <button
          type="button"
          className="ac-btn ac-btn-sm ac-btn-ghost"
          disabled={progress.level <= 1}
          onClick={() => setConfirming(true)}
        >
          Reset
        </button>
      )}
    </li>
  );
}

export default function Profile() {
  const auth = useAuthContext();
  const user = auth.user;
  const navigate = useNavigate();
  const { scores } = usePersonalScores(user);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const { uri: avatarUri } = useAvatar(user);
  const { wallet, loading: walletLoading } = useTokens();
  const showAds = useShowAds();
  const location = useLocation();

  useEffect(() => {
    document.title = "Profile — Senevon Game Studio";
  }, []);

  // achievements: unlock (and pay for) any newly reached, then show them all
  const [ach, setAch] = useState<Achievement[] | null>(null);
  useEffect(() => {
    if (!user) return;
    void achievementsSync().then((r) => setAch(r.list), () => setAch(null));
  }, [user]);

  // "/profile#avatars" (from the nav avatar menu) jumps straight to the library.
  useEffect(() => {
    if (location.hash !== "#avatars" && location.hash !== "#friends") return;
    const target = location.hash.slice(1);
    const id = requestAnimationFrame(() =>
      document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
    return () => cancelAnimationFrame(id);
  }, [location.hash, location.key]);

  useEffect(() => {
    if (!user) {
      navigate("/login?next=/profile", { replace: true });
      return;
    }
    const meta = user.user_metadata ?? {};
    setDisplayName(
      (meta.full_name as string | undefined) || (meta.name as string | undefined) || (user.email?.split("@")[0] ?? "Player"),
    );
  }, [user, navigate]);

  if (!user) return null;

  const totalPlays = scores.length;
  const playedGameIds = [...new Set(scores.map((score) => score.gameId))];
  const latest = playedGameIds[0] ? games.find((game) => game.id === playedGameIds[0]) : null;
  const since = user.created_at
    ? new Date(user.created_at).toLocaleDateString(undefined, { month: "short", year: "numeric" })
    : null;

  function bestFor(gameId: string) {
    const lowerBetter = isLowerBetter(gameId);
    const rows = scores.filter((score) => score.gameId === gameId);
    if (!rows.length) return null;
    return rows.reduce(
      (best, row) => (lowerBetter ? (row.score < best ? row.score : best) : row.score > best ? row.score : best),
      rows[0].score,
    );
  }

  return (
    <div className="acct pf">
      {/* ---------- identity ---------- */}
      <section className="ac-card pf-hero">
        <AvatarFrame userId={user.id}>
        <a href="#avatars" className="pf-avatar" aria-label="Change avatar">
          {avatarUri ? (
            <img src={avatarUri} alt="" width={128} height={128} referrerPolicy="no-referrer" />
          ) : (
            <span className="pf-avatar-initial">{(displayName ?? "?").charAt(0).toUpperCase()}</span>
          )}
          <span className="pf-avatar-edit" aria-hidden="true">
            <Pencil size={13} />
          </span>
        </a>
        </AvatarFrame>
        <div className="pf-id">
          <span className="pf-eyebrow">Player profile</span>
          <h1 className="pf-name">{displayName}</h1>
          <p className="pf-meta">
            <span className="pf-email">{user.email}</span>
            {since ? <span>Joined {since}</span> : null}
          </p>
        </div>
        <button
          type="button"
          className="ac-btn ac-btn-sm pf-signout"
          onClick={async () => {
            await auth.signOut();
            navigate("/");
          }}
        >
          <LogOut size={15} aria-hidden="true" />
          Sign out
        </button>
      </section>

      {/* ---------- wallet + stats ---------- */}
      <div className="pf-overview">
        <section className="ac-card ac-coin-card pf-wallet" aria-label="Chip wallet">
          <div className="pf-wallet-top">
            <TokenIcon size={52} className="ac-token" />
            <div>
              <span className="pf-wallet-label">Chip balance</span>
              <strong className="pf-wallet-num">
                {wallet ? (wallet.unlimited ? "∞" : formatTokens(wallet.balance)) : walletLoading ? "…" : "—"}
              </strong>
            </div>
          </div>
          <div className="pf-wallet-actions">
            <Link className="ac-btn ac-btn-sm" to="/chips#buy">
              Buy chips
            </Link>
            <Link className="ac-btn ac-btn-sm ac-btn-ghost" to="/chips">
              Wallet <ArrowRight size={14} aria-hidden="true" />
            </Link>
            {showAds ? (
              <button type="button" className="ac-btn ac-btn-sm ac-btn-ghost" onClick={() => promptAdFree("settings")}>
                <ShieldCheck size={14} aria-hidden="true" /> Remove ads
              </button>
            ) : null}
          </div>
        </section>

        <div className="pf-stats">
          <div className="ac-card pf-stat">
            <span className="pf-stat-icon" aria-hidden="true">
              <History size={17} />
            </span>
            <strong>{formatTokens(totalPlays)}</strong>
            <span>Rounds played</span>
          </div>
          <div className="ac-card pf-stat">
            <span className="pf-stat-icon" aria-hidden="true">
              <Gamepad2 size={17} />
            </span>
            <strong>{playedGameIds.length}</strong>
            <span>Games tried</span>
          </div>
          <div className="ac-card pf-stat">
            <span className="pf-stat-icon" aria-hidden="true">
              <Trophy size={17} />
            </span>
            {latest ? (
              <Link to={`/game/${latest.id}`} className="pf-stat-text" title={latest.title}>
                {latest.title}
              </Link>
            ) : (
              <strong>—</strong>
            )}
            <span>Latest game</span>
          </div>
        </div>
      </div>

      {/* ---------- avatars + bests ---------- */}
      <div className="pf-columns">
        <section className="ac-card pf-avatars" id="avatars">
          <div className="ac-section-head">
            <div>
              <h2 className="ac-h2">Avatar library</h2>
              <p className="ac-sub">Pick a style, then a character. It follows your account to every device.</p>
            </div>
          </div>
          <AvatarLibrary user={user} />
        </section>

        <section className="ac-card pf-bests">
          <div className="ac-section-head">
            <h2 className="ac-h2">Your bests</h2>
          </div>
          {playedGameIds.length === 0 ? (
            <div className="pf-empty">
              <p>No rounds yet. Pick a game and set your first record.</p>
              <Link className="ac-btn ac-btn-primary ac-btn-sm" to="/">
                Browse games
              </Link>
            </div>
          ) : (
            <ul className="pf-best-list">
              {playedGameIds.map((gameId) => {
                const game = games.find((item) => item.id === gameId);
                if (!game) return null;
                return (
                  <li key={gameId}>
                    <Link to={`/game/${game.id}`}>
                      <GamePoster game={game} size="thumb" />
                      <span className="pf-best-title">{game.title}</span>
                      <span className="pf-best-score">
                        <small>{scoreLabel(game)}</small>
                        <b>{bestFor(gameId)}</b>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <FriendsSection />

        {ach ? <AchievementGrid list={ach} /> : null}

        <section className="ac-card pf-progress">
          <div className="ac-section-head">
            <div>
              <h2 className="ac-h2">Saved progress</h2>
              <p className="ac-sub">Levels you've reached. Resetting sends that game back to level 1.</p>
            </div>
          </div>
          <ul className="pf-best-list">
            {PROGRESS_GAMES.map((id) => (
              <ProgressRow key={id} gameId={id} />
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
