/* Shared online menu for turn-based games (Chess, Ludo): find a match, create / join a room by
   code, invite players who are online, answer invites. Plus the "waiting in a room" card.
   The lobby itself is the shared hook in games/carrom/matchmaking.ts. */
import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import PlayerAvatar from "./PlayerAvatar";
import type { LobbyApi } from "../games/carrom/matchmaking";
import type { RoomPeer, RoomStatus } from "../lib/gameRoom";
import { useOnline } from "../lib/online";
import "./online-lobby.css";

/** Shown instead of online menus while there's no connection. */
export function OfflineNotice({ what = "Online play" }: { what?: string }) {
  return (
    <div className="ol-card ol-offline">
      <h3>You're offline</h3>
      <p className="ol-sub">{what} needs an internet connection. You can still play against the CPU or with friends on this device.</p>
    </div>
  );
}

export function SignInToPlay({ what }: { what: string }) {
  const location = useLocation();
  return (
    <div className="ol-card">
      <h3>Play online</h3>
      <p className="ol-sub">Sign in to {what}.</p>
      <Link className="primary-btn" to={`/login?next=${encodeURIComponent(location.pathname)}`}>
        Sign in
      </Link>
    </div>
  );
}

export function OnlineMenu({
  lobby,
  guestWait,
  settings,
  findLabel = "Find a match",
  inviteLabel,
  onCreate,
  onJoin,
  footer,
}: {
  lobby: LobbyApi;
  guestWait: string | null;
  /** Shown above the buttons (e.g. clock or seat choice). */
  settings?: ReactNode;
  findLabel?: string;
  /** "invites you to …" */
  inviteLabel: string;
  onCreate: () => void;
  onJoin: (code: string) => void;
  /** Shown under the players list (e.g. a leaderboard). */
  footer?: ReactNode;
}) {
  const [code, setCode] = useState("");
  const [now, setNow] = useState(Date.now());
  const online = useOnline();
  useEffect(() => {
    if (!lobby.searching) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [lobby.searching]);

  if (!online) return <OfflineNotice />;
  return (
    <div className="ol">
      {lobby.incoming.map((inv) => (
        <div key={inv.id} className="ol-invite" role="alert">
          <PlayerAvatar id={lobby.players.find((p) => p.key === inv.from)?.userId ?? inv.from} name={inv.name} avatar={inv.avatar} size={26} className="lb-initial" />
          <span>
            <b>{inv.name}</b> invites you to {inviteLabel}
          </span>
          <button type="button" className="ghost-btn" onClick={() => lobby.decline(inv)}>
            No
          </button>
          <button type="button" className="primary-btn" onClick={() => lobby.accept(inv)}>
            Play
          </button>
        </div>
      ))}

      <div className="ol-card">
        {settings}
        {guestWait ? (
          <p className="ol-sub">
            <span className="ol-spinner" aria-hidden="true" /> Joining {guestWait}'s game…
          </p>
        ) : lobby.searching ? (
          <div className="ol-search">
            <span className="ol-spinner" aria-hidden="true" />
            <span>
              Finding an opponent… <b>{Math.max(0, Math.floor((now - lobby.searchSince) / 1000))}s</b>
            </span>
            <button type="button" className="ghost-btn" onClick={lobby.cancelSearch}>
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" className="primary-btn ol-find" disabled={!lobby.connected} onClick={lobby.findMatch}>
            {lobby.connected ? findLabel : "Connecting…"}
          </button>
        )}
        <div className="ol-row">
          <button type="button" className="ghost-btn" onClick={onCreate} disabled={Boolean(guestWait)}>
            Create room
          </button>
          <form
            className="ol-join"
            onSubmit={(e) => {
              e.preventDefault();
              if (code.length === 4) onJoin(code);
            }}
          >
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4))}
              placeholder="CODE"
              aria-label="Room code"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
            />
            <button type="submit" className="ghost-btn" disabled={code.length !== 4 || Boolean(guestWait)}>
              Join
            </button>
          </form>
        </div>
        {lobby.note ? (
          <p className="ol-note" role="status">
            {lobby.note}
          </p>
        ) : null}
      </div>

      <div className="ol-card ol-players">
        <h4>
          Players online <small>{lobby.players.length}</small>
        </h4>
        {lobby.players.length === 0 ? (
          <p className="ol-sub">Nobody else is here right now. Share a room code with a friend.</p>
        ) : (
          <ul>
            {lobby.players.map((p) => {
              const invited = lobby.outgoing?.to === p.key;
              return (
                <li key={p.key}>
                  <PlayerAvatar id={p.userId} name={p.name} avatar={p.avatar} size={26} className="lb-initial" />
                  <span className="ol-name">{p.name}</span>
                  {p.status === "searching" ? <small className="ol-tag">searching</small> : null}
                  {invited ? (
                    <button type="button" className="ghost-btn" onClick={lobby.cancelInvite}>
                      Invited · cancel
                    </button>
                  ) : (
                    <button type="button" className="ghost-btn" disabled={Boolean(lobby.outgoing) || Boolean(guestWait)} onClick={() => lobby.invite(p)}>
                      Invite
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {footer}
    </div>
  );
}

export function RoomWaiting({
  status,
  note,
  code,
  peers,
  myId,
  isHost,
  matched,
  seats,
  title,
  blurb,
  hostSettings,
  canStart,
  startLabel = "Start game",
  onStart,
  onLeave,
}: {
  status: RoomStatus | null;
  note: string | null;
  code: string;
  peers: RoomPeer[];
  myId: string;
  isHost: boolean;
  /** Joined through a match / invite (starts by itself, no code to share). */
  matched: boolean;
  seats: number;
  title: string;
  blurb?: string;
  hostSettings?: ReactNode;
  canStart: boolean;
  startLabel?: string;
  onStart: () => void;
  onLeave: () => void;
}) {
  const [copied, setCopied] = useState(false);
  if (status === "error")
    return (
      <div className="ol-card">
        <h3>Couldn't join</h3>
        <p className="ol-sub">{note ?? "Something went wrong."}</p>
        <button type="button" className="primary-btn" onClick={onLeave}>
          Back
        </button>
      </div>
    );
  if (status !== "lobby")
    return (
      <div className="ol-card">
        <h3>{isHost ? "Opening room…" : "Joining room…"}</h3>
        <span className="ol-spinner" aria-hidden="true" />
        <button type="button" className="ghost-btn" onClick={onLeave}>
          Cancel
        </button>
      </div>
    );
  return (
    <div className="ol-card">
      <span className="ol-mode">{title}</span>
      {!matched ? (
        <>
          <p className="ol-sub">Room code</p>
          <button
            type="button"
            className="ol-code"
            title="Copy code"
            onClick={() => void navigator.clipboard?.writeText(code).then(() => setCopied(true), () => {})}
          >
            {code}
          </button>
          <p className="ol-sub">{copied ? "Copied!" : isHost ? "Share it with friends · tap to copy" : blurb}</p>
        </>
      ) : blurb ? (
        <p className="ol-sub">{blurb}</p>
      ) : null}
      {isHost && !matched ? hostSettings : null}
      <ul className="ol-peers">
        {peers.map((p) => (
          <li key={p.clientId}>
            <PlayerAvatar id={p.userId} name={p.name} avatar={p.avatar} size={28} className="lb-initial" />
            <span>{p.clientId === myId ? `${p.name} (you)` : p.name}</span>
            {p.isHost ? <small>host</small> : null}
          </li>
        ))}
        {Array.from({ length: Math.max(0, seats - peers.length) }, (_, i) => (
          <li key={`empty-${i}`} className="is-empty">
            Waiting for a player…
          </li>
        ))}
      </ul>
      {isHost && !matched ? (
        <button type="button" className="primary-btn" disabled={!canStart} onClick={onStart}>
          {startLabel}
        </button>
      ) : (
        <p className="ol-sub">{matched ? "Starting…" : "Waiting for the host to start…"}</p>
      )}
      <button type="button" className="ghost-btn" onClick={onLeave}>
        Leave room
      </button>
    </div>
  );
}
