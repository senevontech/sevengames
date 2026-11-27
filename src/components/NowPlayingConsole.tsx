import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Info,
  Keyboard,
  Minimize2,
  Share2,
  X,
} from "./anim-icons";
import { RiFullscreenLine, RiGamepadLine, RiPlayFill } from "./ReIcons";

export type ConsoleGame = {
  id: string;
  title: string;
  genre: string;
  screenImage: string;
  progress?: number;
};

export const defaultConsoleGame: ConsoleGame = {
  id: "skyrealm",
  title: "Skyrealm",
  genre: "Open World RPG",
  screenImage: "/images/orbit/now_playing_viewport_2x.png",
  progress: 72,
};

export default function NowPlayingConsole({
  game = defaultConsoleGame,
}: {
  game?: ConsoleGame;
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControlsModal, setShowControlsModal] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [sharedToast, setSharedToast] = useState(false);

  const handleShare = () => {
    navigator.clipboard?.writeText(window.location.origin + "/game/" + game.id);
    setSharedToast(true);
    setTimeout(() => setSharedToast(false), 2400);
  };

  return (
    <div className={`now-playing-deck ${isFullscreen ? "is-fullscreen" : ""}`} id="console">
      {/* Left Action Rail / Control Buttons */}
      <div className="console-controls">
        <Link
          to={`/game/${game.id}`}
          className="console-btn btn-play"
          onClick={(e) => {
            // Can launch playable game or route to game page
          }}
        >
          <RiGamepadLine size={18} />
          <span>Play</span>
        </Link>

        <button
          type="button"
          className="console-btn btn-glass"
          onClick={() => setShowControlsModal(true)}
          title="Customise key bindings"
        >
          <Keyboard size={17} />
          <span>Edit Controls</span>
        </button>

        <button
          type="button"
          className="console-btn btn-glass"
          onClick={() => setShowInfoModal(true)}
          title="View game details & lore"
        >
          <Info size={17} />
          <span>Game Info</span>
        </button>

        <button
          type="button"
          className="console-btn btn-glass"
          onClick={handleShare}
          title="Share game with friends"
        >
          <Share2 size={17} />
          <span>{sharedToast ? "Copied!" : "Share"}</span>
        </button>
      </div>

      {/* Right Screen: Glowing Neon Frame & Viewport */}
      <div className="console-viewport-wrap">
        <div className="console-neon-frame">
          {/* Top Status Bar */}
          <div className="console-screen-head">
            <div className="console-status">
              <span className="status-dot-orange" />
              <span className="status-title">Now Playing</span>
              <span className="status-live-badge">
                <span className="live-dot" />
                LIVE
              </span>
            </div>

            <button
              type="button"
              className="screen-action-btn"
              onClick={() => setIsFullscreen(!isFullscreen)}
              aria-label={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
              title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
            >
              {isFullscreen ? <Minimize2 size={16} /> : <RiFullscreenLine size={16} />}
            </button>
          </div>

          {/* Screen Content */}
          <div className="console-screen-content">
            <img
              src={game.screenImage}
              alt={game.title}
              className="screen-background-art"
            />

            {/* In-Game HUD Elements (Radar, Joystick, Action Buttons, Health) */}
            <div className="screen-hud-layer" aria-hidden="true">
              {/* Radar Minimap on Top-Right */}
              <div className="hud-radar">
                <div className="radar-circle">
                  <span className="radar-sweep" />
                  <span className="radar-ring r-inner" />
                  <span className="radar-blip b1" />
                  <span className="radar-blip b2" />
                  <span className="radar-center" />
                </div>
              </div>

              {/* Virtual Analog Joystick on Bottom-Left */}
              <div className="hud-joystick">
                <div className="joystick-base">
                  <div className="joystick-knob" />
                </div>
              </div>

              {/* Action Buttons on Bottom-Right */}
              <div className="hud-actions">
                <div className="action-diamond">
                  <button type="button" className="action-btn ab-top">✦</button>
                  <button type="button" className="action-btn ab-right">✕</button>
                  <button type="button" className="action-btn ab-bottom">⚔</button>
                  <button type="button" className="action-btn ab-left">🛡</button>
                </div>
              </div>

              {/* Health & Exp Bar at Bottom-Center */}
              <div className="hud-status-bar">
                <div className="bar-label">
                  <span>LVL 48</span>
                  <span>HP 3,420 / 3,420</span>
                </div>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: "78%" }} />
                </div>
              </div>
            </div>

            {/* Overlay Play Trigger */}
            <Link
              to={`/game/${game.id}`}
              className="screen-play-overlay"
              aria-label={`Play ${game.title} Fullscreen`}
            >
              <div className="screen-play-badge">
                <RiPlayFill size={22} />
              </div>
            </Link>
          </div>
        </div>
      </div>

      {/* Edit Controls Modal */}
      {showControlsModal ? (
        <div className="orbit-modal-overlay" onClick={() => setShowControlsModal(false)}>
          <div className="orbit-modal-box" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="modal-close-btn"
              onClick={() => setShowControlsModal(false)}
            >
              <X size={20} />
            </button>
            <div className="modal-header">
              <Keyboard size={22} color="#ff7a1a" />
              <h3>Game Controls Configuration</h3>
            </div>
            <div className="controls-grid">
              <div className="control-row">
                <span>Movement</span>
                <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> / <kbd>Arrows</kbd>
              </div>
              <div className="control-row">
                <span>Primary Attack</span>
                <kbd>Space</kbd> / <kbd>Left Click</kbd>
              </div>
              <div className="control-row">
                <span>Special Ability</span>
                <kbd>E</kbd> / <kbd>Q</kbd>
              </div>
              <div className="control-row">
                <span>Dodge / Sprint</span>
                <kbd>Shift</kbd>
              </div>
              <div className="control-row">
                <span>Gamepad Support</span>
                <span className="badge-tag">Auto-Detected</span>
              </div>
            </div>
            <button
              type="button"
              className="primary-btn modal-confirm-btn"
              onClick={() => setShowControlsModal(false)}
            >
              Save & Apply
            </button>
          </div>
        </div>
      ) : null}

      {/* Game Info Modal */}
      {showInfoModal ? (
        <div className="orbit-modal-overlay" onClick={() => setShowInfoModal(false)}>
          <div className="orbit-modal-box" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="modal-close-btn"
              onClick={() => setShowInfoModal(false)}
            >
              <X size={20} />
            </button>
            <div className="modal-header">
              <Info size={22} color="#ff7a1a" />
              <h3>{game.title} — Lore & Features</h3>
            </div>
            <div className="game-info-body">
              <p>
                <strong>Genre:</strong> {game.genre}
              </p>
              <p>
                Step into the breathtaking floating islands of <em>{game.title}</em>.
                Master dynamic elemental abilities, glide across cloud canyons, and
                discover long-lost ancient celestial technologies.
              </p>
              <div className="info-stats-row">
                <div className="info-stat">
                  <span className="stat-num">4.9 ★</span>
                  <span className="stat-desc">Community Rating</span>
                </div>
                <div className="info-stat">
                  <span className="stat-num">1.4M</span>
                  <span className="stat-desc">Active Pilots</span>
                </div>
                <div className="info-stat">
                  <span className="stat-num">60 FPS</span>
                  <span className="stat-desc">Browser Native</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

