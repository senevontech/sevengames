/* Carrom matchmaking — who's online, invites, and "find a match".

   Everyone on the carrom menu joins one Supabase Realtime channel ("carrom-lobby") and
   publishes a presence entry: name, avatar and status (idle / searching / busy).

   Invites and random matches are a two-step handshake over broadcast messages that are
   addressed to one player (`to`) and carry a random match id:

     invite:   A → invite      → B      (B sees Accept / Decline)
               B → invite-reply → A     (accept)
     random:   A → propose     → B      (both are searching; the smaller client id proposes)
               B → propose-reply → A    (accept if B is still free)

   Once accepted, the inviter / proposer hosts an ordinary 2-player room (see online.ts) and
   sends its code with `go`; the other player joins it. The room then runs the match exactly
   like a room created with a code. */
import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "../../supabase";
import { parseAvatar, type AvatarChoice } from "../../lib/avatar";

export type LobbyStatus = "idle" | "searching" | "busy";

export type LobbyPlayer = {
  key: string; // presence key (one per open tab)
  userId: string;
  name: string;
  avatar: AvatarChoice | null;
  status: LobbyStatus;
  since: number; // when they started searching (fair "first come, first matched")
};

export type Invite = { id: string; from: string; name: string; avatar: AvatarChoice | null; at: number };

/** The outcome of a successful handshake: host a room, or wait for the host's code. */
export type Matched =
  | { role: "host"; matchId: string; partner: string; partnerName: string }
  | { role: "guest"; matchId: string; partner: string; partnerName: string };

type Presence = { userId: string; name: string; avatar: AvatarChoice | null; status: LobbyStatus; since: number };

const CHANNEL = "carrom-lobby";
const INVITE_TTL = 30_000; // an invite expires if not answered
const REPLY_WAIT = 5_000; // proposer waits this long for a reply
const GO_WAIT = 12_000; // guest waits this long for the host's room code
const SEARCH_TICK = 1_500;
const MAX_INVITES = 3; // incoming invites shown at once

const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const clip = (s: unknown, n: number) => (typeof s === "string" ? s.slice(0, n) : "");

export type LobbyApi = {
  connected: boolean;
  players: LobbyPlayer[]; // other available players (not you, not your other tabs, not busy)
  searching: boolean;
  searchSince: number;
  incoming: Invite[];
  outgoing: { id: string; to: string; name: string } | null;
  note: string | null;
  invite: (player: LobbyPlayer) => void;
  cancelInvite: () => void;
  accept: (invite: Invite) => void;
  decline: (invite: Invite) => void;
  findMatch: () => void;
  cancelSearch: () => void;
  /** Host: tell the matched player which room to join. */
  sendGo: (matched: Matched, code: string) => void;
  clearNote: () => void;
};

/**
 * Lobby presence + handshakes. `available` = this player is on the menu and can take a match;
 * otherwise they show as busy and incoming invites are declined.
 */
export function useCarromLobby(opts: {
  enabled: boolean;
  userId: string | null;
  name: string;
  avatar: AvatarChoice | null;
  available: boolean;
  onMatched: (m: Matched) => void;
  /** Guest: the host's room code arrived. */
  onGo: (m: Matched, code: string) => void;
}): LobbyApi {
  const { enabled, userId, name, avatar, available } = opts;
  const keyRef = useRef(rid());
  const chRef = useRef<RealtimeChannel | null>(null);
  const [connected, setConnected] = useState(false);
  const [players, setPlayers] = useState<LobbyPlayer[]>([]);
  const playersRef = useRef<LobbyPlayer[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchSince, setSearchSince] = useState(0);
  const [incoming, setIncoming] = useState<Invite[]>([]);
  const [outgoing, setOutgoing] = useState<{ id: string; to: string; name: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // mutable handshake state (read inside realtime callbacks)
  const st = useRef({
    searching: false,
    since: 0,
    available,
    outgoing: null as { id: string; to: string; name: string; at: number } | null,
    proposal: null as { id: string; to: string; name: string; at: number } | null,
    waitingGo: null as Matched | null,
    cooldown: new Map<string, number>(), // player key → don't propose to them before this time
  });
  st.current.available = available;
  const cb = useRef({ onMatched: opts.onMatched, onGo: opts.onGo });
  cb.current = { onMatched: opts.onMatched, onGo: opts.onGo };
  const meRef = useRef({ userId, name, avatar });
  meRef.current = { userId, name, avatar };

  const status = (): LobbyStatus =>
    !st.current.available || st.current.waitingGo ? "busy" : st.current.searching ? "searching" : "idle";

  const track = useCallback(() => {
    const ch = chRef.current;
    const me = meRef.current;
    if (!ch || !me.userId) return;
    const payload: Presence = {
      userId: me.userId,
      name: me.name,
      avatar: me.avatar,
      status: status(),
      since: st.current.since,
    };
    void ch.track(payload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = useCallback((event: string, payload: Record<string, unknown>) => {
    void chRef.current?.send({ type: "broadcast", event, payload: { ...payload, from: keyRef.current } });
  }, []);

  const stopSearch = useCallback(() => {
    st.current.searching = false;
    st.current.proposal = null;
    setSearching(false);
  }, []);

  /** Both sides agreed: hand over to the game, and stop being available. */
  const matched = useCallback(
    (m: Matched) => {
      stopSearch();
      st.current.outgoing = null;
      setOutgoing(null);
      setIncoming([]);
      if (m.role === "guest") {
        st.current.waitingGo = m;
        window.setTimeout(() => {
          if (st.current.waitingGo?.matchId === m.matchId) {
            st.current.waitingGo = null;
            setNote(`${m.partnerName} didn't start the game. Try again.`);
            track();
          }
        }, GO_WAIT);
      }
      track();
      cb.current.onMatched(m);
    },
    [stopSearch, track],
  );

  /* ---------- channel ---------- */
  useEffect(() => {
    if (!enabled || !supabase || !userId) return;
    const client = supabase;
    let cancelled = false;
    let ch: RealtimeChannel | null = null;

    // channel() hands back an existing channel with the same name, and removing one is async:
    // wait for a previous lobby channel (an earlier mount, or another account) to be gone first.
    const stale = client.getChannels().filter((c) => c.topic === `realtime:${CHANNEL}`);
    void Promise.all(stale.map((c) => client.removeChannel(c))).then(() => {
      if (!cancelled) ch = open(client);
    });

    return () => {
      cancelled = true;
      chRef.current = null;
      setConnected(false);
      setPlayers([]);
      playersRef.current = [];
      if (ch) void client.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, userId]);

  function open(client: NonNullable<typeof supabase>): RealtimeChannel {
    const me = keyRef.current;
    const ch = client.channel(CHANNEL, { config: { broadcast: { self: false }, presence: { key: me } } });
    chRef.current = ch;

    ch.on("presence", { event: "sync" }, () => {
      const state = ch.presenceState<Presence>();
      const list: LobbyPlayer[] = [];
      for (const [key, metas] of Object.entries(state)) {
        const p = metas[metas.length - 1];
        if (!p || key === me || !p.userId || p.userId === meRef.current.userId) continue;
        list.push({
          key,
          userId: clip(p.userId, 64),
          name: clip(p.name, 40) || "Player",
          avatar: parseAvatar(p.avatar),
          status: p.status === "searching" || p.status === "busy" ? p.status : "idle",
          since: Number(p.since) || 0,
        });
      }
      list.sort((a, b) => a.name.localeCompare(b.name));
      playersRef.current = list;
      setPlayers(list);
      // an invite from someone who left is void
      const present = new Set(list.map((p) => p.key));
      setIncoming((inv) => inv.filter((i) => present.has(i.from)));
    });

    /* invites */
    ch.on("broadcast", { event: "invite" }, ({ payload }) => {
      const p = payload as { to: string; from: string; id: string };
      if (p.to !== me) return;
      const sender = playersRef.current.find((x) => x.key === p.from);
      if (!sender || status() === "busy") {
        send("invite-reply", { to: p.from, id: p.id, accept: false });
        return;
      }
      setIncoming((inv) =>
        [...inv.filter((i) => i.from !== p.from), { id: clip(p.id, 40), from: p.from, name: sender.name, avatar: sender.avatar, at: Date.now() }].slice(
          -MAX_INVITES,
        ),
      );
    });
    ch.on("broadcast", { event: "invite-cancel" }, ({ payload }) => {
      const p = payload as { to: string; from: string; id: string };
      if (p.to !== me) return;
      setIncoming((inv) => inv.filter((i) => i.id !== p.id));
    });
    ch.on("broadcast", { event: "invite-reply" }, ({ payload }) => {
      const p = payload as { to: string; from: string; id: string; accept: boolean };
      if (p.to !== me) return;
      const out = st.current.outgoing;
      if (!out || out.id !== p.id || out.to !== p.from) {
        // stale accept (we cancelled or moved on): release the other player
        if (p.accept) send("match-cancel", { to: p.from, id: p.id });
        return;
      }
      if (!p.accept) {
        st.current.outgoing = null;
        setOutgoing(null);
        setNote(`${out.name} declined.`);
        return;
      }
      if (status() === "busy") {
        send("match-cancel", { to: p.from, id: p.id });
        return;
      }
      matched({ role: "host", matchId: p.id, partner: p.from, partnerName: out.name });
    });

    /* random matches */
    ch.on("broadcast", { event: "propose" }, ({ payload }) => {
      const p = payload as { to: string; from: string; id: string };
      if (p.to !== me) return;
      const sender = playersRef.current.find((x) => x.key === p.from);
      const free = st.current.searching && !st.current.proposal && status() === "searching";
      send("propose-reply", { to: p.from, id: p.id, accept: Boolean(free && sender) });
      if (free && sender) matched({ role: "guest", matchId: clip(p.id, 40), partner: p.from, partnerName: sender.name });
    });
    ch.on("broadcast", { event: "propose-reply" }, ({ payload }) => {
      const p = payload as { to: string; from: string; id: string; accept: boolean };
      if (p.to !== me) return;
      const prop = st.current.proposal;
      if (!prop || prop.id !== p.id || prop.to !== p.from) {
        if (p.accept) send("match-cancel", { to: p.from, id: p.id });
        return;
      }
      st.current.proposal = null;
      if (!p.accept || !st.current.searching) {
        if (p.accept) send("match-cancel", { to: p.from, id: p.id });
        st.current.cooldown.set(p.from, Date.now() + 4_000);
        return;
      }
      matched({ role: "host", matchId: p.id, partner: p.from, partnerName: prop.name });
    });

    /* after a handshake */
    ch.on("broadcast", { event: "match-cancel" }, ({ payload }) => {
      const p = payload as { to: string; from: string; id: string };
      if (p.to !== me || st.current.waitingGo?.matchId !== p.id) return;
      st.current.waitingGo = null;
      setNote("The other player is no longer available.");
      track();
    });
    ch.on("broadcast", { event: "go" }, ({ payload }) => {
      const p = payload as { to: string; from: string; id: string; code: string };
      const waiting = st.current.waitingGo;
      // only the host we matched with, for this match, can send us to a room
      if (p.to !== me || !waiting || waiting.matchId !== p.id || waiting.partner !== p.from) return;
      if (typeof p.code !== "string" || !/^[A-Z0-9]{4}$/.test(p.code)) return;
      st.current.waitingGo = null;
      cb.current.onGo(waiting, p.code);
    });

    ch.subscribe((s) => {
      if (s === "SUBSCRIBED") {
        setConnected(true);
        track();
      } else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") {
        setConnected(false);
      }
    });
    return ch;
  }

  // publish changes to name / avatar / availability
  useEffect(() => {
    if (!available && st.current.searching) stopSearch();
    track();
  }, [available, name, avatar?.style, avatar?.seed, track, stopSearch]);

  /* ---------- random matching loop ---------- */
  useEffect(() => {
    if (!searching) return;
    const timer = window.setInterval(() => {
      const s = st.current;
      if (!s.searching) return;
      const now = Date.now();
      if (s.proposal) {
        if (now - s.proposal.at < REPLY_WAIT) return;
        s.cooldown.set(s.proposal.to, now + 4_000); // no reply: try someone else
        s.proposal = null;
      }
      const me = keyRef.current;
      const pool = playersRef.current
        .filter((p) => p.status === "searching" && (s.cooldown.get(p.key) ?? 0) < now)
        .sort((a, b) => a.since - b.since || a.key.localeCompare(b.key));
      const target = pool[0];
      // exactly one side of a pair proposes, so two players never propose to each other
      if (!target || me > target.key) return;
      s.proposal = { id: rid(), to: target.key, name: target.name, at: now };
      send("propose", { to: target.key, id: s.proposal.id });
    }, SEARCH_TICK);
    return () => window.clearInterval(timer);
  }, [searching, send]);

  // expire unanswered invites
  useEffect(() => {
    if (!incoming.length && !outgoing) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setIncoming((inv) => {
        const next = inv.filter((i) => now - i.at < INVITE_TTL);
        return next.length === inv.length ? inv : next;
      });
      const out = st.current.outgoing;
      if (out && now - out.at > INVITE_TTL) {
        send("invite-cancel", { to: out.to, id: out.id });
        st.current.outgoing = null;
        setOutgoing(null);
        setNote(`${out.name} didn't answer.`);
      }
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [incoming.length, outgoing, send]);

  /* ---------- actions ---------- */
  const invite = useCallback(
    (player: LobbyPlayer) => {
      // one handshake at a time: searching and inviting together could match twice
      if (st.current.searching) {
        stopSearch();
        track();
      }
      if (st.current.outgoing) send("invite-cancel", { to: st.current.outgoing.to, id: st.current.outgoing.id });
      const out = { id: rid(), to: player.key, name: player.name, at: Date.now() };
      st.current.outgoing = out;
      setOutgoing({ id: out.id, to: out.to, name: out.name });
      setNote(null);
      send("invite", { to: player.key, id: out.id });
    },
    [send, stopSearch, track],
  );

  const cancelInvite = useCallback(() => {
    const out = st.current.outgoing;
    if (!out) return;
    send("invite-cancel", { to: out.to, id: out.id });
    st.current.outgoing = null;
    setOutgoing(null);
  }, [send]);

  const accept = useCallback(
    (inv: Invite) => {
      setIncoming((list) => list.filter((i) => i.id !== inv.id));
      // decline the others, then accept this one
      for (const other of incoming) {
        if (other.id !== inv.id) send("invite-reply", { to: other.from, id: other.id, accept: false });
      }
      cancelInvite();
      send("invite-reply", { to: inv.from, id: inv.id, accept: true });
      matched({ role: "guest", matchId: inv.id, partner: inv.from, partnerName: inv.name });
    },
    [incoming, send, cancelInvite, matched],
  );

  const decline = useCallback(
    (inv: Invite) => {
      setIncoming((list) => list.filter((i) => i.id !== inv.id));
      send("invite-reply", { to: inv.from, id: inv.id, accept: false });
    },
    [send],
  );

  const findMatch = useCallback(() => {
    cancelInvite();
    const now = Date.now();
    st.current.searching = true;
    st.current.since = now;
    st.current.proposal = null;
    st.current.cooldown.clear();
    setSearching(true);
    setSearchSince(now);
    setNote(null);
    track();
  }, [cancelInvite, track]);

  const cancelSearch = useCallback(() => {
    stopSearch();
    track();
  }, [stopSearch, track]);

  const sendGo = useCallback(
    (m: Matched, code: string) => {
      send("go", { to: m.partner, id: m.matchId, code });
    },
    [send],
  );

  return {
    connected,
    players: players.filter((p) => p.status !== "busy"),
    searching,
    searchSince,
    incoming,
    outgoing,
    note,
    invite,
    cancelInvite,
    accept,
    decline,
    findMatch,
    cancelSearch,
    sendGo,
    clearNote: useCallback(() => setNote(null), []),
  };
}
