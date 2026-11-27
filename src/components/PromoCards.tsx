import { useState } from "react";
import { Link } from "react-router-dom";
import { X } from "./anim-icons";
import { RiArrowRightLine, RiFlashlightLine, RiSparklesLine } from "./ReIcons";

export default function PromoCards() {
  const [showRewardModal, setShowRewardModal] = useState(false);
  const [claimed, setClaimed] = useState(false);

  return (
    <>
      <div className="promos">
        {/* Play Instantly Card */}
        <a
          href="#console"
          className="promo promo-instant"
          onClick={(e) => {
            e.preventDefault();
            document.getElementById("console")?.scrollIntoView({ behavior: "smooth" });
          }}
        >
          <div className="promo-content">
            <div className="promo-header">
              <span className="promo-icon-instant">
                <RiFlashlightLine size={20} className="flash-icon-svg" />
              </span>
              <strong className="promo-title">Play Instantly</strong>
            </div>
            <p className="promo-desc">
              No downloads.
              <br />
              Start any game in your browser.
            </p>
          </div>
          <span className="promo-go" aria-hidden="true">
            <RiArrowRightLine size={16} />
          </span>
        </a>

        {/* Daily Reward Card */}
        <button
          type="button"
          className="promo promo-reward"
          onClick={() => setShowRewardModal(true)}
        >
          <div className="promo-reward-graphic">
            <img
              src="/images/orbit/daily_reward_chest_2x.png"
              alt="Daily Reward Loot Chest"
              className="chest-img"
            />
            <span className="chest-glow" />
          </div>
          <div className="promo-content">
            <strong className="promo-title">Daily Reward</strong>
            <small className="promo-sub">Claim your gift!</small>
          </div>
          <span className="promo-go" aria-hidden="true">
            <RiArrowRightLine size={16} />
          </span>
        </button>
      </div>

      {/* Daily Reward Modal */}
      {showRewardModal ? (
        <div className="orbit-modal-overlay" onClick={() => setShowRewardModal(false)}>
          <div className="orbit-modal-box reward-modal" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="modal-close-btn"
              onClick={() => setShowRewardModal(false)}
            >
              <X size={20} />
            </button>
            <div className="reward-modal-content">
              <div className="reward-glow-ring" />
              <img
                src="/images/orbit/daily_reward_chest_2x.png"
                alt="Daily Chest"
                className={`reward-modal-chest ${claimed ? "opened" : ""}`}
              />
              <h3>{claimed ? "Reward Claimed!" : "Daily Orbit Supply Drop"}</h3>
              <p>
                {claimed
                  ? "You received 500 Orbit Coins & 50 XP! Come back tomorrow for more."
                  : "Welcome back, Commander! Claim your daily rations and boost your ranking."}
              </p>
              {!claimed ? (
                <button
                  type="button"
                  className="primary-btn reward-claim-btn"
                  onClick={() => setClaimed(true)}
                >
                  <RiSparklesLine size={18} />
                  Claim +500 Coins
                </button>
              ) : (
                <button
                  type="button"
                  className="ghost-btn reward-close-btn"
                  onClick={() => setShowRewardModal(false)}
                >
                  Done
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
