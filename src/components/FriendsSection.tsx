/* Profile page → Friends: incoming requests (accept / decline), friends, requests you sent,
   and who you follow. Tapping a player opens their profile card. */
import { useState } from "react";
import PlayerAvatar from "./PlayerAvatar";
import { PlayerCardModal } from "./PlayerCard";
import { useAuthContext } from "../context/AuthContext";
import { respondToRequest, unfollow, unfriend, useFriendInbox, useMyCircle, type MiniPlayer } from "../lib/social";

export default function FriendsSection() {
  const { user } = useAuthContext();
  const { requests, reload: reloadInbox } = useFriendInbox();
  const circle = useMyCircle();
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [tab, setTab] = useState<"friends" | "following">("friends");

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Something went wrong.");
    }
    setBusy(false);
    await Promise.all([reloadInbox(), circle.reload()]);
  }

  const row = (p: MiniPlayer, actions: React.ReactNode) => (
    <li key={p.id}>
      <button type="button" className="fr-who" onClick={() => setOpen(p.id)}>
        <PlayerAvatar id={p.id} name={p.name} avatar={p.avatar} size={34} className="lb-initial" />
        <span>{p.name}</span>
      </button>
      <span className="fr-acts">{actions}</span>
    </li>
  );

  const list = tab === "friends" ? circle.friends : circle.following;

  return (
    <section className="ac-card fr" id="friends">
      <div className="ac-section-head">
        <div>
          <h2 className="ac-h2">Friends</h2>
          <p className="ac-sub">
            {circle.friends.length} friends · {circle.followers} followers · following {circle.following.length}
          </p>
        </div>
      </div>

      {requests.length ? (
        <div className="fr-block">
          <h3 className="fr-h">Friend requests</h3>
          <ul className="fr-list">
            {requests.map((r) =>
              row(
                r.from,
                <>
                  <button type="button" className="ac-btn ac-btn-sm ac-btn-primary" disabled={busy} onClick={() => void act(() => respondToRequest(r.id, true))}>
                    Accept
                  </button>
                  <button type="button" className="ac-btn ac-btn-sm ac-btn-ghost" disabled={busy} onClick={() => void act(() => respondToRequest(r.id, false))}>
                    Decline
                  </button>
                </>,
              ),
            )}
          </ul>
        </div>
      ) : null}

      <div className="fr-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "friends"} className={tab === "friends" ? "active" : ""} onClick={() => setTab("friends")}>
          Friends · {circle.friends.length}
        </button>
        <button type="button" role="tab" aria-selected={tab === "following"} className={tab === "following" ? "active" : ""} onClick={() => setTab("following")}>
          Following · {circle.following.length}
        </button>
      </div>

      {list.length === 0 ? (
        <p className="fr-empty">
          {tab === "friends"
            ? "No friends yet. Tap a player on the leaderboards to add them."
            : "You're not following anyone yet."}
        </p>
      ) : (
        <ul className="fr-list">
          {list.map((p) =>
            row(
              p,
              tab === "friends" ? (
                <button type="button" className="ac-btn ac-btn-sm ac-btn-ghost" disabled={busy} onClick={() => void act(() => unfriend(p.id))}>
                  Unfriend
                </button>
              ) : (
                <button type="button" className="ac-btn ac-btn-sm ac-btn-ghost" disabled={busy || !user} onClick={() => void act(() => unfollow(user!.id, p.id))}>
                  Unfollow
                </button>
              ),
            ),
          )}
        </ul>
      )}

      {circle.outgoing.length ? (
        <div className="fr-block">
          <h3 className="fr-h">Requests you sent</h3>
          <ul className="fr-list">
            {circle.outgoing.map((p) =>
              row(
                p,
                <button type="button" className="ac-btn ac-btn-sm ac-btn-ghost" disabled={busy} onClick={() => void act(() => unfriend(p.id))}>
                  Cancel
                </button>,
              ),
            )}
          </ul>
        </div>
      ) : null}

      {msg ? <p className="fr-msg">{msg}</p> : null}
      {open ? (
        <PlayerCardModal
          userId={open}
          onClose={() => {
            setOpen(null);
            void circle.reload();
            void reloadInbox();
          }}
        />
      ) : null}
    </section>
  );
}
