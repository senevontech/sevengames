/* Arrows online: find a random opponent, invite a player who's online, or share a room code.
   Two modes: Race (same board, first to clear it wins) and Infinite (arrows keep coming; first
   to lose both lives loses). Rooms: ./arrowsNet.ts. Lobby (who's online, invites, random
   matching): the shared hook from carrom/matchmaking.ts, one lobby channel per mode so players
   are only matched with someone who wants the same mode. */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuthContext } from "../context/AuthContext";
import { useAvatar } from "../lib/avatar";
import PlayerAvatar from "../components/PlayerAvatar";
import { useCarromLobby, type LobbyApi, type Matched } from "./carrom/matchmaking";
import { ArrowsNet, type MatchMode, type MatchResult, type NetStatus, type Peer, type Progress } from "./arrowsNet";
import { ArrowsPlay, MATCH_LIVES } from "./arrows";
import { useOnline } from "../lib/online";
import { OfflineNotice } from "../components/OnlineLobby";

const MODES: { id: MatchMode; label: string; blurb: string }[] = [
  { id: "race", label: "Race", blurb: "Same board for both. First to clear it wins — 3 lives." },
  { id: "infinite", label: "Infinite", blurb: "Arrows keep coming, faster and faster. Lose 2 lives and you lose." },
];

const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/** The opponent, in one slim line above your board. */
function OpponentBar({ peer, progress, mode, gone }: { peer: Peer | null; progress: Progress | null; mode: MatchMode; gone: boolean }) {
  const max = MATCH_LIVES[mode];
  const lives = progress?.lives ?? max;
  const total = progress ? progress.cleared + progress.left : 0;
  const pct = total ? (progress!.cleared / total) * 100 : 0;
  return (
    <div className={`arw-opp${gone ? " is-gone" : ""}`} aria-label="Opponent">
      {peer ? <PlayerAvatar id={peer.userId} name={peer.name} avatar={peer.avatar} size={26} className="lb-initial arw-opp-av" /> : null}
      <span className="arw-opp-name">{gone ? "Left the match" : peer?.name ?? "Opponent"}</span>
      <span className="arw-opp-hearts" aria-label={`${lives} lives`}>
        {Array.from({ length: max }, (_, i) => (
          <i key={i} className={i < lives ? "on" : ""} />
        ))}
      </span>
      {mode === "race" ? (
        <span className="arw-opp-bar" aria-label={`${Math.round(pct)}% cleared`}>
          <i style={{ width: `${pct}%` }} />
        </span>
      ) : (
        <span className="arw-opp-stat">{progress?.cleared ?? 0} cleared</span>
      )}
    </div>
  );
}

export default function ArrowsOnline({ onBusy }: { onBusy: (busy: boolean) => void }) {
  const { user } = useAuthContext();
  const location = useLocation();
  const { choice: myAvatar } = useAvatar(user);
  const meta = user?.user_metadata ?? {};
  const myName = ((meta.full_name as string | undefined) || (meta.name as string | undefined) || user?.email?.split("@")[0] || "Player").slice(0, 40);

  const [mode, setMode] = useState<MatchMode>("race");
  const [phase, setPhase] = useState<"menu" | "room" | "match">("menu");
  const [joinCode, setJoinCode] = useState("");
  const [netStatus, setNetStatus] = useState<NetStatus | null>(null);
  const [netNote, setNetNote] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [roomMode, setRoomMode] = useState<MatchMode>("race");
  const [peers, setPeers] = useState<Peer[]>([]);
  const [round, setRound] = useState<{ mode: MatchMode; seed: number; round: number } | null>(null);
  const [opp, setOpp] = useState<Progress | null>(null);
  const [result, setResult] = useState<MatchResult | null>(null);
  const [myEnd, setMyEnd] = useState<{ type: "finish" | "out"; ms: number } | null>(null);
  const [rematch, setRematch] = useState<string[]>([]);
  const [guestWait, setGuestWait] = useState<string | null>(null);
  const [matchedRoom, setMatchedRoom] = useState(false);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now());

  const netRef = useRef<ArrowsNet | null>(null);
  const hostMatchRef = useRef<Matched | null>(null);
  const autoStart = useRef(false);
  const lobbyRef = useRef<LobbyApi | null>(null);

  useEffect(() => onBusy(phase !== "menu"), [phase, onBusy]);

  const events = useCallback(
    () => ({
      onStatus: (status: NetStatus, note?: string) => {
        setNetStatus(status);
        setNetNote(note ?? null);
        // matched host: the room is open, send its code to the other player
        const m = hostMatchRef.current;
        const net = netRef.current;
        if (status === "lobby" && m && net?.isHost) {
          hostMatchRef.current = null;
          lobbyRef.current?.sendGo(m, net.roomCode);
        }
      },
      onPeers: (list: Peer[], m: MatchMode) => {
        setPeers(list);
        setRoomMode(m);
        const net = netRef.current;
        // matched game: start as soon as the other player is in
        if (net?.isHost && autoStart.current && list.length === 2) {
          autoStart.current = false;
          window.setTimeout(() => netRef.current === net && net.start(), 400);
        }
      },
      onStart: (cfg: { mode: MatchMode; seed: number; round: number }) => {
        setRound(cfg);
        setOpp(null);
        setResult(null);
        setMyEnd(null);
        setPhase("match");
      },
      onProgress: (_id: string, p: Progress) => setOpp(p),
      onResult: (r: MatchResult) => setResult(r),
      onRematch: (ids: string[]) => setRematch(ids),
    }),
    [],
  );

  const me = () => ({ userId: user?.id ?? "", name: myName, avatar: myAvatar });

  function resetRoom() {
    setNetStatus(null);
    setNetNote(null);
    setPeers([]);
    setRound(null);
    setOpp(null);
    setResult(null);
    setMyEnd(null);
    setRematch([]);
    setCopied(false);
  }

  function hostRoom(match?: Matched) {
    netRef.current?.leave();
    resetRoom();
    hostMatchRef.current = match ?? null;
    autoStart.current = Boolean(match);
    setMatchedRoom(Boolean(match));
    const net = ArrowsNet.host(me(), mode, events());
    netRef.current = net;
    setRoomCode(net.roomCode);
    setRoomMode(mode);
    setPhase("room");
  }

  function joinRoom(code: string, matched = false) {
    netRef.current?.leave();
    resetRoom();
    hostMatchRef.current = null;
    autoStart.current = false;
    setMatchedRoom(matched);
    const net = ArrowsNet.join(me(), code, events());
    netRef.current = net;
    setRoomCode(net.roomCode);
    setPhase("room");
  }

  function leave() {
    hostMatchRef.current = null;
    autoStart.current = false;
    netRef.current?.leave();
    netRef.current = null;
    setRoomCode(null);
    resetRoom();
    setPhase("menu");
  }

  // leaving the page (or switching to solo) leaves the room
  useEffect(() => () => netRef.current?.leave(), []);

  const lobby = useCarromLobby({
    enabled: ArrowsNet.configured && Boolean(user),
    channel: `arrows-lobby-${mode}`,
    userId: user?.id ?? null,
    name: myName,
    avatar: myAvatar,
    available: phase === "menu" && !guestWait,
    onMatched: (m) => {
      if (m.role === "host") {
        setGuestWait(null);
        hostRoom(m);
      } else setGuestWait(m.partnerName);
    },
    onGo: (m, code) => {
      setGuestWait(null);
      joinRoom(code, true);
      void m;
    },
  });
  lobbyRef.current = lobby;
  useEffect(() => {
    if (lobby.note) setGuestWait(null);
  }, [lobby.note]);

  // search timer
  useEffect(() => {
    if (!lobby.searching) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [lobby.searching]);

  const isOnlineNow = useOnline();
  const progressCb = useCallback((p: Progress) => netRef.current?.progress(p), []);
  const endCb = useCallback((type: "finish" | "out", ms: number) => {
    setMyEnd({ type, ms });
    netRef.current?.end(type, ms);
  }, []);

  /* ---------- gates ---------- */
  if (!isOnlineNow && phase === "menu") {
    return (
      <div className="game-surface arw-surface arw-online">
        <OfflineNotice />
      </div>
    );
  }
  if (!ArrowsNet.configured) {
    return (
      <div className="game-surface arw-surface arw-online">
        <div className="arw-online-card">
          <p>Online play isn't available right now.</p>
        </div>
      </div>
    );
  }
  if (!user) {
    return (
      <div className="game-surface arw-surface arw-online">
        <div className="arw-online-card">
          <h3>Play online</h3>
          <p>Sign in to race other players or invite a friend.</p>
          <Link className="primary-btn" to={`/login?next=${encodeURIComponent(location.pathname)}`}>
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  const net = netRef.current;
  const opponent = net ? peers.find((p) => p.clientId !== net.clientId) ?? null : null;

  /* ---------- match ---------- */
  if (phase === "match" && round && net) {
    const won = result?.winner === net.clientId;
    const draw = result && result.winner === null;
    const oppName = opponent?.name ?? "Your opponent";
    const iAsked = rematch.includes(net.clientId);
    const theyAsked = opponent ? rematch.includes(opponent.clientId) : false;
    let detail = "";
    if (result?.reason === "left") detail = `${oppName} left the match.`;
    else if (result && round.mode === "infinite")
      detail = won
        ? `${oppName} ran out of lives after ${secs(opp?.ms ?? 0)}.`
        : `You ran out of lives after ${secs(myEnd?.ms ?? 0)}.`;
    else if (result?.reason === "out") detail = won ? `${oppName} ran out of lives.` : "You ran out of lives.";
    else if (result)
      detail = won
        ? `You cleared it in ${secs(myEnd?.ms ?? 0)}${opp && opp.left === 0 ? ` · ${oppName} ${secs(opp.ms)}` : ""}.`
        : `${oppName} cleared it first${opp && opp.left === 0 ? ` in ${secs(opp.ms)}` : ""}.`;
    const resultCard = result ? (
      <div className="arw-overlay" role="dialog" aria-modal="true" aria-labelledby="arw-result-title">
        <div className={`arw-card arw-result${won ? " is-win" : draw ? "" : " is-loss"}`}>
          <h3 id="arw-result-title">{won ? "You win! 🏆" : draw ? "It's a draw" : "You lose"}</h3>
          <p>{detail}</p>
          <div className="arw-confirm-actions">
            <button type="button" className="ghost-btn" onClick={leave}>
              Leave
            </button>
            <button
              type="button"
              className="primary-btn"
              disabled={!opponent || iAsked}
              onClick={() => netRef.current?.requestRematch()}
              autoFocus
            >
              {!opponent ? "Opponent left" : iAsked ? `Waiting for ${oppName}…` : theyAsked ? "Accept rematch" : "Rematch"}
            </button>
          </div>
          {theyAsked && !iAsked ? <p className="arw-result-note">{oppName} wants a rematch.</p> : null}
        </div>
      </div>
    ) : null;

    return (
      <ArrowsPlay
        key={round.round}
        onFinish={() => {}}
        match={{ mode: round.mode, seed: round.seed }}
        onMatchProgress={progressCb}
        onMatchEnd={endCb}
        matchOver={Boolean(result)}
        top={<OpponentBar peer={opponent} progress={opp} mode={round.mode} gone={!opponent} />}
        overlay={resultCard}
      />
    );
  }

  /* ---------- waiting in a room ---------- */
  if (phase === "room") {
    const modeInfo = MODES.find((m) => m.id === roomMode)!;
    return (
      <div className="game-surface arw-surface arw-online">
        <div className="arw-online-card">
          {netStatus === "error" ? (
            <>
              <h3>Couldn't join</h3>
              <p>{netNote ?? "Something went wrong."}</p>
              <button type="button" className="primary-btn" onClick={leave}>
                Back
              </button>
            </>
          ) : netStatus !== "lobby" ? (
            <>
              <h3>{net?.isHost ? "Opening room…" : "Joining room…"}</h3>
              <span className="arw-spinner" aria-hidden="true" />
              <button type="button" className="ghost-btn" onClick={leave}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <span className="arw-online-mode">{modeInfo.label}</span>
              {!matchedRoom ? (
                <>
                  <p className="arw-online-sub">Room code</p>
                  <button
                    type="button"
                    className="arw-code"
                    title="Copy code"
                    onClick={() => {
                      void navigator.clipboard?.writeText(roomCode ?? "").then(() => setCopied(true), () => {});
                    }}
                  >
                    {roomCode}
                  </button>
                  <p className="arw-online-sub">{copied ? "Copied!" : net?.isHost ? "Share it with a friend · tap to copy" : modeInfo.blurb}</p>
                </>
              ) : (
                <p className="arw-online-sub">{modeInfo.blurb}</p>
              )}
              <ul className="arw-peers">
                {peers.map((p) => (
                  <li key={p.clientId}>
                    <PlayerAvatar id={p.userId} name={p.name} avatar={p.avatar} size={28} className="lb-initial arw-opp-av" />
                    <span>{p.clientId === net?.clientId ? `${p.name} (you)` : p.name}</span>
                    {p.isHost ? <small>host</small> : null}
                  </li>
                ))}
                {peers.length < 2 ? <li className="is-empty">Waiting for a player…</li> : null}
              </ul>
              {net?.isHost && !matchedRoom ? (
                <button type="button" className="primary-btn" disabled={peers.length < 2} onClick={() => net.start()}>
                  Start match
                </button>
              ) : peers.length === 2 ? (
                <p className="arw-online-sub">Starting…</p>
              ) : null}
              <button type="button" className="ghost-btn" onClick={leave}>
                Leave room
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  /* ---------- menu ---------- */
  const modeInfo = MODES.find((m) => m.id === mode)!;
  return (
    <div className="game-surface arw-surface arw-online">
      <div className="arw-seg" role="tablist" aria-label="Match mode">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={mode === m.id}
            className={mode === m.id ? "active" : ""}
            onClick={() => {
              if (mode === m.id) return;
              if (lobby.searching) lobby.cancelSearch();
              lobby.cancelInvite();
              setMode(m.id);
            }}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="arw-online-sub">{modeInfo.blurb}</p>

      {lobby.incoming.map((inv) => (
        <div key={inv.id} className="arw-invite" role="alert">
          <PlayerAvatar
            id={lobby.players.find((p) => p.key === inv.from)?.userId ?? inv.from}
            name={inv.name}
            avatar={inv.avatar}
            size={26}
            className="lb-initial arw-opp-av"
          />
          <span>
            <b>{inv.name}</b> invites you to {modeInfo.label}
          </span>
          <button type="button" className="ghost-btn" onClick={() => lobby.decline(inv)}>
            No
          </button>
          <button type="button" className="primary-btn" onClick={() => lobby.accept(inv)}>
            Play
          </button>
        </div>
      ))}

      <div className="arw-online-card">
        {guestWait ? (
          <p className="arw-online-sub">
            <span className="arw-spinner" aria-hidden="true" /> Joining {guestWait}'s match…
          </p>
        ) : lobby.searching ? (
          <div className="arw-search">
            <span className="arw-spinner" aria-hidden="true" />
            <span>
              Finding an opponent… <b>{Math.max(0, Math.floor((now - lobby.searchSince) / 1000))}s</b>
            </span>
            <button type="button" className="ghost-btn" onClick={lobby.cancelSearch}>
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" className="primary-btn arw-find" disabled={!lobby.connected} onClick={lobby.findMatch}>
            {lobby.connected ? "Find a match" : "Connecting…"}
          </button>
        )}
        <div className="arw-room-row">
          <button type="button" className="ghost-btn" onClick={() => hostRoom()} disabled={Boolean(guestWait)}>
            Create room
          </button>
          <form
            className="arw-join"
            onSubmit={(e) => {
              e.preventDefault();
              if (joinCode.trim().length === 4) joinRoom(joinCode);
            }}
          >
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4))}
              placeholder="CODE"
              aria-label="Room code"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
            />
            <button type="submit" className="ghost-btn" disabled={joinCode.length !== 4 || Boolean(guestWait)}>
              Join
            </button>
          </form>
        </div>
        {lobby.note ? (
          <p className="arw-online-note" role="status">
            {lobby.note}
          </p>
        ) : null}
      </div>

      <div className="arw-online-card arw-players">
        <h4>
          Players online <small>{lobby.players.length}</small>
        </h4>
        {lobby.players.length === 0 ? (
          <p className="arw-online-sub">Nobody else is here right now. Share a room code with a friend.</p>
        ) : (
          <ul>
            {lobby.players.map((p) => {
              const invited = lobby.outgoing?.to === p.key;
              return (
                <li key={p.key}>
                  <PlayerAvatar id={p.userId} name={p.name} avatar={p.avatar} size={26} className="lb-initial arw-opp-av" />
                  <span className="arw-player-name">{p.name}</span>
                  {p.status === "searching" ? <small className="arw-tag">searching</small> : null}
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
    </div>
  );
}
