/* A player's public profile: avatar, counts, Follow / Add friend, stats, best games, levels.
   Used in a popup (PlayerCardModal) and on the public page /player/:id. Data: lib/social.ts. */
import { useEffect, useState } from "react";
import GiftChipsButton from "./GiftChips";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { X } from "lucide-react";
import PlayerAvatar from "./PlayerAvatar";
import { usePublicProfile, type PublicProfile } from "../lib/social";
import { getGame, scoreLabel } from "../catalog";
import { levelForXp } from "../lib/shopCatalog";
import "./player-card.css";

const MEDAL = ["", "🥇", "🥈", "🥉"];

function since(iso: string) {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", year: "numeric" });
  } catch {
    return "";
  }
}

function FriendButton({ p, busy, add, remove, respond }: { p: PublicProfile; busy: boolean; add: () => void; remove: () => void; respond: (a: boolean) => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = window.setTimeout(() => setArmed(false), 3000);
    return () => window.clearTimeout(id);
  }, [armed]);
  if (p.relation === "incoming")
    return (
      <>
        <button type="button" className="pc-btn pc-primary" disabled={busy} onClick={() => respond(true)}>
          Accept friend
        </button>
        <button type="button" className="pc-btn" disabled={busy} onClick={() => respond(false)}>
          Decline
        </button>
      </>
    );
  if (p.relation === "friends")
    return (
      <button
        type="button"
        className={`pc-btn${armed ? " is-armed" : ""}`}
        disabled={busy}
        onClick={() => (armed ? (setArmed(false), remove()) : setArmed(true))}
      >
        {armed ? "Unfriend?" : "✓ Friends"}
      </button>
    );
  if (p.relation === "requested")
    return (
      <button type="button" className="pc-btn" disabled={busy} onClick={remove} title="Cancel the request">
        Requested · cancel
      </button>
    );
  return (
    <button type="button" className="pc-btn" disabled={busy} onClick={add}>
      + Add friend
    </button>
  );
}

export function ProfileDetails({ userId, full = false }: { userId: string; full?: boolean }) {
  const { profile: p, loading, error, busy, follow, addFriend, removeFriend, respond, signedIn, isMe } = usePublicProfile(userId);

  if (!p)
    return (
      <div className="pc-body pc-empty">
        {error ? <p>{error}</p> : loading ? <span className="pc-spinner" aria-label="Loading" /> : null}
      </div>
    );

  const levels = [
    { label: "Carrom", xp: p.carrom_xp },
    { label: "Chess", xp: p.chess_xp },
    { label: "Ludo", xp: p.ludo_xp },
  ].filter((l) => l.xp !== null && l.xp > 0);

  return (
    <div className={`pc-body${full ? " is-full" : ""}`}>
      <div className="pc-head">
        <PlayerAvatar id={p.id} name={p.name} avatar={p.avatar} size={full ? 88 : 68} className="lb-initial pc-av" />
        <div className="pc-id">
          <h2>{p.name}</h2>
          <p>
            {p.rank ? <span className="pc-rank">#{p.rank} overall</span> : <span className="pc-rank is-new">Unranked</span>}
            <span>Since {since(p.since)}</span>
          </p>
        </div>
      </div>

      <div className="pc-counts">
        <span>
          <b>{p.followers}</b>
          <small>Followers</small>
        </span>
        <span>
          <b>{p.following}</b>
          <small>Following</small>
        </span>
        <span>
          <b>{p.friends}</b>
          <small>Friends</small>
        </span>
      </div>

      <div className="pc-actions">
        {isMe ? (
          <Link className="pc-btn pc-primary" to="/profile">
            This is you · edit profile
          </Link>
        ) : !signedIn ? (
          <Link className="pc-btn pc-primary" to={`/login?next=${encodeURIComponent(`/player/${p.id}`)}`}>
            Sign in to follow
          </Link>
        ) : (
          <>
            <button type="button" className={`pc-btn${p.is_following ? "" : " pc-primary"}`} disabled={busy} onClick={() => void follow(!p.is_following)}>
              {p.is_following ? "Following" : "Follow"}
            </button>
            <FriendButton p={p} busy={busy} add={() => void addFriend()} remove={() => void removeFriend()} respond={(a) => void respond(a)} />
            <GiftChipsButton to={p.id} name={p.name} />
          </>
        )}
      </div>
      {error ? <p className="pc-error">{error}</p> : null}

      <div className="pc-stats">
        <span>
          <b>{p.rounds}</b>
          <small>Rounds played</small>
        </span>
        <span>
          <b>{p.games}</b>
          <small>Games played</small>
        </span>
        <span>
          <b>{p.points}</b>
          <small>Points</small>
        </span>
        <span>
          <b>{p.firsts}</b>
          <small>1st places</small>
        </span>
      </div>

      {p.best.length ? (
        <div className="pc-section">
          <h3>Best games</h3>
          <ul className="pc-best">
            {p.best.map((b) => {
              const g = getGame(b.game);
              return (
                <li key={b.game}>
                  <span className="pc-place">{MEDAL[b.place] || `#${b.place}`}</span>
                  {g ? (
                    <Link to={`/game/${g.id}`} className="pc-game">
                      {g.title}
                    </Link>
                  ) : (
                    <span className="pc-game">{b.game}</span>
                  )}
                  <small>
                    {g ? scoreLabel(g) : "Best"} {b.best}
                  </small>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {levels.length || p.chess_rating ? (
        <div className="pc-section">
          <h3>Levels</h3>
          <div className="pc-levels">
            {levels.map((l) => (
              <span key={l.label}>
                <small>{l.label}</small>
                <b>Lv {levelForXp(l.xp!)}</b>
              </span>
            ))}
            {p.chess_rating ? (
              <span>
                <small>Chess rating</small>
                <b>{p.chess_rating}</b>
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {!full ? (
        <Link className="pc-more" to={`/player/${p.id}`}>
          View full profile →
        </Link>
      ) : null}
    </div>
  );
}

/** Popup over the page; Escape or a tap outside closes it. */
export function PlayerCardModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="pc-backdrop" onClick={onClose}>
      <div className="pc-card" role="dialog" aria-modal="true" aria-label="Player profile" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="pc-close" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <ProfileDetails userId={userId} />
      </div>
    </div>,
    document.body,
  );
}
