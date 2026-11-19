import { useCallback, useEffect, useRef, useState } from "react";
import { gameFinishedAd } from "../lib/admob";
import { isNative } from "../lib/native";
import { Link, useParams } from "react-router-dom";
import { ChevronLeft, ExternalLink, Info, Maximize, Minimize, MonitorPlay, Store } from "lucide-react";
import { GamePoster } from "../components/GamePoster";
import { getGame, scoreLabel } from "../catalog";
import { engines, previews } from "../games";
import { useAuthContext } from "../context/AuthContext";
import { useLeaderboard, useSaveScore } from "../lib/scores";
import { useBestForGame } from "../hooks/useBest";
import Leaderboard from "../components/Leaderboard";
import { trackGame } from "../lib/track";
import { pushRecent } from "../lib/recent";
import { useGameCost, useShowAds, useTokens } from "../lib/tokens";
import { formatTokens } from "../lib/currency";
import PlayGate from "../components/PlayGate";
import AdSlot from "../components/AdSlot";
import TokenIcon from "../components/TokenIcon";
import "./game-page.css";
import "../games/game-skin.css";
import "./game-neu.css";

/** The game as it looks before you start: a custom preview, or its own start screen made inert. */
function GatePreview({ game }: { game: NonNullable<ReturnType<typeof getGame>> }) {
  if (game.kind !== "builtin") {
    return (
      <div className="gp-preview gp-preview-poster" aria-hidden="true">
        <GamePoster game={game} size="hero" />
      </div>
    );
  }
  const Preview = previews[game.engine as keyof typeof previews];
  if (Preview) return <Preview />;
  return (
    <div className="gp-preview" inert>
      <GameRunner gameId={game.engine} onScore={() => {}} />
    </div>
  );
}

function GameRunner({ gameId, onScore }: { gameId: string; onScore: (score: number) => void }) {
  const Engine = engines[gameId as keyof typeof engines];
  if (!Engine) return <p className="empty-note">This game is not available yet.</p>;
  return <Engine onFinish={onScore} />;
}

export default function GamePage() {
  const { id } = useParams();
  const game = getGame(id);
  const auth = useAuthContext();
  const user = auth.user;
  const saveScore = useSaveScore(user);
  const best = useBestForGame(id ?? "");
  const { leaders, loading, error: leaderError, refresh: refreshLeaders } = useLeaderboard(game?.id ?? "");
  const stageRef = useRef<HTMLElement>(null);
  // Tokens: premium games (cost > 0) are paid per play. `paidPlay` counts paid plays (it also
  // remounts the game fresh for each one); `locked` puts the gate back up after a finished match.
  const cost = useGameCost(game?.id);
  const { wallet } = useTokens();
  // unlimited accounts (redeem code) play premium games without the gate
  const premium = (cost ?? 0) > 0 && !wallet?.unlimited;
  const premiumRef = useRef(premium);
  premiumRef.current = premium;
  const [paidPlay, setPaidPlay] = useState(0);
  const showAds = useShowAds();
  const showAdsRef = useRef(showAds);
  showAdsRef.current = showAds;
  const [locked, setLocked] = useState(false);
  const lockTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(lockTimer.current), []);
  // "full" = native Fullscreen API when available, otherwise a fixed overlay (e.g. iPhone Safari).
  const [full, setFull] = useState(false);

  useEffect(() => {
    const sync = () => {
      if (!document.fullscreenElement) setFull(false);
    };
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFull(false);
    };
    document.documentElement.classList.add("no-scroll");
    window.addEventListener("keydown", onKey);
    return () => {
      document.documentElement.classList.remove("no-scroll");
      window.removeEventListener("keydown", onKey);
    };
  }, [full]);

  const enterFull = useCallback(async () => {
    setFull(true);
    const el = stageRef.current;
    try {
      if (el?.requestFullscreen && !document.fullscreenElement) await el.requestFullscreen();
    } catch {
      /* fall back to the CSS overlay */
    }
  }, []);

  const exitFull = useCallback(() => {
    setFull(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }, []);

  // After a guest finishes a match: "sign in to save your score". Dismissible for the session.
  const [nudge, setNudge] = useState(false);
  const nudgeOff = useRef(
    (() => {
      try {
        return sessionStorage.getItem("senevon:guest-note") === "1";
      } catch {
        return false;
      }
    })(),
  );
  const userRef = useRef(user);
  userRef.current = user;
  useEffect(() => {
    if (user) setNudge(false);
  }, [user]);

  // "F" toggles full screen (ignored while typing or when a game input has focus).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "f" && e.key !== "F") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (full) exitFull();
      else void enterFull();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full, enterFull, exitFull]);

  useEffect(() => {
    if (id && getGame(id)) {
      trackGame("game_start", id);
      pushRecent(id);
    }
  }, [id]);

  if (!game) {
    return (
      <div className="page narrow">
        <h1>Game not found</h1>
        <p className="hero-sub">It may have been renamed. Head back to the library.</p>
        <Link className="primary-btn" to="/">
          Back to games
        </Link>
      </div>
    );
  }

  const handleFinish = useCallback(
    async (score: number) => {
      if (game) {
        trackGame("game_finish", game.id, score);
        // the app: an interstitial after every few finished games (never mid-game)
        if (isNative && showAdsRef.current) void gameFinishedAd();
        if (!userRef.current && !nudgeOff.current) setNudge(true);
        // premium: let the result show for a moment, then ask to pay for the next play
        if (premiumRef.current) {
          window.clearTimeout(lockTimer.current);
          lockTimer.current = window.setTimeout(() => setLocked(true), 1800);
        }
        // a saved score can change the board — reload it so the new result shows up
        if (await saveScore(game.id, score, 0)) refreshLeaders();
      }
    },
    [game, saveScore, refreshLeaders],
  );

  return (
    <div className="page game-page gp" style={{ "--accent": game.accent } as React.CSSProperties}>
      <Link to="/" className="back-link">
        <ChevronLeft size={18} />
        All games
      </Link>

      <header className="game-header">
        <GamePoster game={game} size="hero" />
        <div className="game-header-text">
          <h1>{game.title}</h1>
          <ul className="gp-chips" aria-label="Game details">
            <li>{game.category}</li>
            <li>{game.difficulty}</li>
            <li>~{game.minutes} min</li>
            {cost !== null ? (
              <li className={premium ? "gp-chip-cost" : "gp-chip-free"}>
                {premium ? (
                  <>
                    <TokenIcon size={14} title="tokens" /> {formatTokens(cost)} / play
                  </>
                ) : (cost ?? 0) > 0 ? (
                  "Unlimited"
                ) : (
                  "Free"
                )}
              </li>
            ) : null}
            {best !== null ? <li className="gp-chip-best">Best: {best}</li> : null}
          </ul>
          <p className="hero-sub">{game.description}</p>
        </div>
      </header>


      <div className="game-layout">
        {/* Glass frame: toolbar on top, the game edge-to-edge underneath */}
        <div className="gp-frame">
          <div className="gp-toolbar">
            <div className="gp-now">
              <span className="gp-dot" aria-hidden="true" />
              <span className="gp-now-title">{game.title}</span>
              <span className="gp-now-meta">{game.kind === "iframe" ? "Web game" : "Senevon original"}</span>
            </div>
            <div className="gp-modes" role="group" aria-label="How to play">
              <button type="button" className={full ? "" : "active"} aria-pressed={!full} onClick={exitFull}>
                <MonitorPlay size={15} />
                <span>Play here</span>
              </button>
              <button type="button" className={full ? "active" : ""} aria-pressed={full} onClick={enterFull}>
                <Maximize size={15} />
                <span>Full screen</span>
                <kbd className="gp-kbd" aria-hidden="true">F</kbd>
              </button>
              <Link to="/tokens#buy" className="gp-shop" aria-label="Shop: get tokens" title="Shop">
                <Store size={15} />
                <span>Shop</span>
              </Link>
              {game.kind === "iframe" ? (
                <a href={game.embedUrl} target="_blank" rel="noopener noreferrer" aria-label="Open original site">
                  <ExternalLink size={15} />
                  <span>Original site</span>
                </a>
              ) : null}
            </div>
          </div>

          <section ref={stageRef} className={`game-stage gp-stage${full ? " is-full" : ""}`}>
            {full ? (
              <button type="button" className="exit-full" onClick={exitFull} aria-label="Exit full screen">
                <Minimize size={16} />
                <span>Exit</span>
              </button>
            ) : null}
            {cost === null ? (
              <p className="empty-note">Loading…</p>
            ) : premium && paidPlay === 0 ? (
              // preview of the game with the start bar UNDER it
              <div className="gp-play-wrap">
                <GatePreview game={game} />
                <PlayGate gameId={game.id} gameTitle={game.title} cost={cost} again={false} onPaid={() => setPaidPlay(1)} />
              </div>
            ) : game.kind === "builtin" ? (
              <div className="gp-play-wrap">
                <GameRunner key={paidPlay} gameId={game.engine} onScore={handleFinish} />
                {premium && locked ? (
                  <PlayGate
                    gameId={game.id}
                    gameTitle={game.title}
                    cost={cost}
                    again
                    onPaid={() => {
                      setLocked(false);
                      setPaidPlay((n) => n + 1);
                    }}
                  />
                ) : null}
              </div>
            ) : (
              <div className="iframe-wrap">
                <iframe src={game.embedUrl} title={game.title} allow="gamepad; fullscreen" />
              </div>
            )}
          </section>
        </div>
        <div className="gp-side">
        <Leaderboard
          leaders={leaders}
          loading={loading}
          error={leaderError}
          scoreLabel={scoreLabel(game)}
          userId={user?.id}
          personalBest={best}
          gameId={game.id}
        />
        <AdSlot placement="game-side" />
        </div>
      </div>

      {nudge && !user ? (
        <p className="gp-guest gp-nudge" role="status">
          <Info size={15} aria-hidden="true" />
          <span>
            Nice game! Guest scores stay on this device.{" "}
            <Link to={`/login?next=/game/${game.id}`}>Sign in</Link> to save it to the global leaderboard.
          </span>
          <button
            type="button"
            className="gp-guest-x"
            aria-label="Dismiss"
            onClick={() => {
              setNudge(false);
              nudgeOff.current = true;
              try {
                sessionStorage.setItem("senevon:guest-note", "1");
              } catch {
                /* ignore */
              }
            }}
          >
            ×
          </button>
        </p>
      ) : null}
    </div>
  );
}
