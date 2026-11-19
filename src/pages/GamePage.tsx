import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { gameFinishedAd } from "../lib/admob";
import { isNative, openExternal } from "../lib/native";
import { Link, useParams } from "react-router-dom";
import { ChevronLeft, ExternalLink, Info, Maximize, Minimize, Minimize2, Store, Trophy, X } from "lucide-react";
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
import "./game-fit.css";
import FitBox from "../components/FitBox";
import StartAd from "../components/StartAd";
import { GateShort, PlayGateContext, type PlayGateApi } from "../games/PlayFlow";

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
  if (Preview)
    return (
      <Suspense fallback={<div className="gp-preview" aria-hidden="true" />}>
        <Preview />
      </Suspense>
    );
  return (
    <div className="gp-preview" inert>
      <GameRunner gameId={game.engine} onScore={() => {}} />
    </div>
  );
}

/** Games whose own start screen (PlayFlow) takes the payment: "Play · ⚡1" pays and starts. */
const SELF_GATED = new Set(["carrom", "chess", "ludo", "arrows"]);

function GameRunner({ gameId, onScore }: { gameId: string; onScore: (score: number) => void }) {
  const Engine = engines[gameId as keyof typeof engines];
  if (!Engine) return <p className="empty-note">This game is not available yet.</p>;
  return (
    <Suspense fallback={<div className="gp-game-loading" role="status" aria-label="Loading game" />}>
      <Engine onFinish={onScore} />
    </Suspense>
  );
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
  const { wallet, spendForPlay } = useTokens();
  // unlimited accounts (redeem code) play premium games without the gate
  const premium = (cost ?? 0) > 0 && !wallet?.unlimited;
  const premiumRef = useRef(premium);
  premiumRef.current = premium;
  const [paidPlay, setPaidPlay] = useState(0);
  const showAds = useShowAds();
  const showAdsRef = useRef(showAds);
  showAdsRef.current = showAds;
  const [locked, setLocked] = useState(false);
  // phones: the leaderboard panel over the game
  const [sideOpen, setSideOpen] = useState(false);
  // Play mode: once a game starts, everything but the game (and a few floating buttons) hides,
  // including the site nav and the phone bottom bar (html.gp-playing, see game-fit.css)
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    document.documentElement.classList.toggle("gp-playing", playing);
    if (!playing) setSideOpen(false);
    return () => document.documentElement.classList.remove("gp-playing");
  }, [playing]);
  // a new game page starts out of play mode
  useEffect(() => setPlaying(false), [id]);

  // Web games (they run another site in a frame) play best in their own window: ask first.
  // "ask" → overlay; "opened" → opened elsewhere (frame not loaded); "here" → play in the frame.
  const [extMode, setExtMode] = useState<"ask" | "opened" | "here">("ask");
  useEffect(() => setExtMode("ask"), [id]);

  // Two-step start for games with modes: their Play button pays (if needed) and starts
  const selfGated = game?.kind === "builtin" && SELF_GATED.has(game.engine);
  const [credit, setCredit] = useState(false); // a play already paid for ("Play again")
  const [gateBusy, setGateBusy] = useState(false);
  const [gateError, setGateError] = useState<ReactNode>(null);
  const gateApi = useMemo<PlayGateApi>(
    () => ({
      cost: premium ? cost ?? 0 : 0,
      credit,
      busy: gateBusy,
      error: gateError,
      request: (start) => {
        setGateError(null);
        if (!premium || credit) {
          setCredit(false);
          setPlaying(true);
          start();
          return;
        }
        if (!game) return;
        setGateBusy(true);
        void spendForPlay(game.id).then((res) => {
          setGateBusy(false);
          if (res.ok) {
            setPlaying(true);
            start();
          } else if (res.reason === "insufficient" || res.reason === "signin") {
            setGateError(<GateShort signIn={!user} gameId={game.id} />);
          } else {
            setGateError(res.message ?? "Something went wrong.");
          }
        });
      },
    }),
    [premium, cost, credit, gateBusy, gateError, game, user, spendForPlay],
  );
  const lockTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(lockTimer.current), []);
  // "full" = native Fullscreen API when available, otherwise a fixed overlay (e.g. iPhone Safari).
  const [full, setFull] = useState(false);
  // Banner under the start screen: web only (the app shows AdMob's own bottom banner), never
  // for ad-free players, gone once a game starts
  const startAd = showAds && !isNative && !playing && cost !== null && !full;

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

  // Web games: clicks inside the iframe never reach the page, but focus moves into it
  useEffect(() => {
    const onBlur = () => {
      window.setTimeout(() => {
        if (document.activeElement?.tagName === "IFRAME" && stageRef.current?.contains(document.activeElement)) {
          setPlaying(true);
        }
      }, 0);
    };
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, []);

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
      {/* One slim row: back, picture, title + details (the game gets the rest of the screen) */}
      <header className="game-header gp-top">
        <Link to="/" className="back-link" aria-label="All games">
          <ChevronLeft size={18} />
          <span>All games</span>
        </Link>
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
        <div className="gp-modes gp-actions" role="group" aria-label="Game controls">
          <button type="button" className={full ? "active" : ""} aria-pressed={full} onClick={enterFull} title="Full screen (F)">
            <Maximize size={15} />
            <span>Full screen</span>
          </button>
          <Link to="/tokens#buy" className="gp-shop" aria-label="Shop: get tokens" title="Shop">
            <Store size={15} />
            <span>Shop</span>
          </Link>
          {/* phones: the leaderboard opens as a panel over the game */}
          <button
            type="button"
            className={`gp-lb-btn${sideOpen ? " active" : ""}`}
            aria-label="Leaderboard"
            aria-expanded={sideOpen}
            onClick={() => setSideOpen((o) => !o)}
          >
            <Trophy size={15} />
          </button>
          {game.kind === "iframe" ? (
            <a href={game.embedUrl} target="_blank" rel="noopener noreferrer" aria-label="Open original site" title="Original site">
              <ExternalLink size={15} />
            </a>
          ) : null}
        </div>
      </header>


      <div className="game-layout">
        {/* the game window (its controls live in the header row) */}
        <div className="gp-frame">
          <section
            ref={stageRef}
            className={`game-stage gp-stage${full ? " is-full" : ""}${startAd ? " has-ad" : ""}`}
            onPointerDownCapture={() => {
              // free games start on the first touch; paid ones when "Start game" is paid
              // (not while the "new window" question is up for a web game)
              const asking = game.kind === "iframe" && extMode !== "here";
              if (!playing && !asking && cost !== null && !selfGated && !(premium && (paidPlay === 0 || locked))) setPlaying(true);
            }}
          >
            {playing ? (
              <div className="gp-float" role="toolbar" aria-label="Game controls">
                <button
                  type="button"
                  className={sideOpen ? "active" : ""}
                  aria-label="Leaderboard"
                  aria-expanded={sideOpen}
                  onClick={() => setSideOpen((o) => !o)}
                >
                  <Trophy size={16} />
                </button>
                {!full ? (
                  <button type="button" aria-label="Full screen" onClick={() => void enterFull()}>
                    <Maximize size={16} />
                  </button>
                ) : null}
                <button
                  type="button"
                  aria-label="Show page controls"
                  title="Show page controls"
                  onClick={() => {
                    if (full) exitFull();
                    setPlaying(false);
                  }}
                >
                  <Minimize2 size={16} />
                </button>
              </div>
            ) : null}
            {full ? (
              <button type="button" className="exit-full" onClick={exitFull} aria-label="Exit full screen">
                <Minimize size={16} />
                <span>Exit</span>
              </button>
            ) : null}
            {cost === null ? (
              <p className="empty-note">Loading…</p>
            ) : premium && paidPlay === 0 && !selfGated ? (
              // preview of the game with the start bar UNDER it
              <FitBox maxScale={1.5}>
                <div className="gp-play-wrap">
                  <GatePreview game={game} />
                  <PlayGate
                    gameId={game.id}
                    gameTitle={game.title}
                    cost={cost}
                    again={false}
                    onPaid={() => {
                      setPaidPlay(1);
                      setPlaying(true);
                    }}
                  />
                </div>
              </FitBox>
            ) : game.kind === "builtin" ? (
              <FitBox maxScale={1.5}>
              <div className="gp-play-wrap">
                <PlayGateContext.Provider value={gateApi}>
                  <GameRunner key={paidPlay} gameId={game.engine} onScore={handleFinish} />
                </PlayGateContext.Provider>
                {premium && locked ? (
                  <PlayGate
                    gameId={game.id}
                    gameTitle={game.title}
                    cost={cost}
                    again
                    onPaid={() => {
                      setLocked(false);
                      setPaidPlay((n) => n + 1);
                      if (selfGated) setCredit(true); // its Play button won't charge again
                      setPlaying(true);
                    }}
                  />
                ) : null}
              </div>
              </FitBox>
            ) : extMode !== "here" ? (
              <div className="gp-ext" role="dialog" aria-labelledby="gp-ext-title">
                <div className="gp-ext-card">
                  <GamePoster game={game} size="thumb" />
                  {extMode === "ask" ? (
                    <>
                      <h2 id="gp-ext-title">{isNative ? `Play ${game.title} on its website` : "Best in a new window"}</h2>
                      <p>
                        {isNative
                          ? "This game runs best on its own website. We'll open it in your browser."
                          : `For the best experience, play ${game.title} in its own window.`}
                      </p>
                      <button
                        type="button"
                        className="gp-ext-go"
                        onClick={() => {
                          openExternal(game.embedUrl);
                          setExtMode("opened");
                        }}
                      >
                        <ExternalLink size={16} />
                        {isNative ? "Open website" : "Open in new window"}
                      </button>
                    </>
                  ) : (
                    <>
                      <h2 id="gp-ext-title">Opened {isNative ? "in your browser" : "in a new window"}</h2>
                      <p>Have fun! Come back here any time.</p>
                      <button type="button" className="gp-ext-go" onClick={() => openExternal(game.embedUrl)}>
                        <ExternalLink size={16} />
                        Open again
                      </button>
                    </>
                  )}
                  <button type="button" className="gp-ext-skip" onClick={() => setExtMode("here")}>
                    {extMode === "ask" ? "Skip, play here" : "Play here instead"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="iframe-wrap">
                <iframe src={game.embedUrl} title={game.title} allow="gamepad; fullscreen" />
              </div>
            )}
            {startAd ? <StartAd /> : null}
          </section>
        </div>
        {sideOpen ? (
          <button type="button" className="gp-side-scrim" aria-label="Close leaderboard" onClick={() => setSideOpen(false)} />
        ) : null}
        <div className={`gp-side${sideOpen ? " is-open" : ""}`}>
        <button type="button" className="gp-side-close" aria-label="Close leaderboard" onClick={() => setSideOpen(false)}>
          <X size={16} />
        </button>
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
