/* Arrows online — one Supabase Realtime room per match (code "ABCD", channel "arrows:ABCD").

   Both players play their own copy of the same board (same seed), so nothing about the board is
   sent: each side only streams its progress (arrows cleared / left, lives, time) and reports when
   its run ends (cleared the board, or out of lives). The host is the referee: it decides the
   result and broadcasts it, so both screens always agree.

     race      same board; first to clear it wins (finish times within 0.5 s are compared);
               running out of lives loses straight away
     infinite  arrows keep spawning; the first to lose all their lives loses

   Presence carries who is in the room (and the host's chosen mode), so a player who closes the
   tab or drops out is noticed: the one left behind wins. */
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase, isSupabaseConfigured } from "../supabase";
import { parseAvatar, type AvatarChoice } from "../lib/avatar";
import { matchStake } from "../lib/bets";

export type MatchMode = "race" | "infinite";
/** `chips`: the player's earned chips (what they could bet; the server checks every stake). */
export type Peer = { clientId: string; userId: string; name: string; avatar: AvatarChoice | null; isHost: boolean; chips?: number };
export type Progress = { cleared: number; left: number; lives: number; ms: number };
export type MatchResult = { winner: string | null; reason: "finish" | "out" | "left" };
export type NetStatus = "connecting" | "lobby" | "playing" | "error";

export type ArrowsNetEvents = {
  onStatus: (status: NetStatus, note?: string) => void;
  onPeers: (peers: Peer[], mode: MatchMode) => void;
  /** `bet`: chips each player stakes on this round (0: none); `bk`: random match or friend room */
  onStart: (cfg: { mode: MatchMode; seed: number; round: number; bet: number; bk: "room" | "random" }) => void;
  onProgress: (clientId: string, p: Progress) => void;
  onResult: (r: MatchResult) => void;
  /** Who has asked for a rematch so far. */
  onRematch: (clientIds: string[]) => void;
};

type Presence = { userId: string; name: string; avatar: AvatarChoice | null; host: boolean; mode?: MatchMode; at: number; chips?: number; bet?: number };

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const FINISH_GRACE = 500; // ms to wait for the other finish before judging a race
const NO_ROOM_WAIT = 3500;

export function newRoomCode() {
  let code = "";
  for (let i = 0; i < 4; i += 1) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return code;
}

const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const clip = (s: unknown, n: number) => (typeof s === "string" ? s.slice(0, n) : "");
const num = (v: unknown, max: number) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));

export class ArrowsNet {
  readonly clientId = rid();
  readonly isHost: boolean;
  private channel: RealtimeChannel | null = null;
  private code: string;
  private mode: MatchMode;
  private peers: Peer[] = [];
  private joinedAt = Date.now();
  private playing = false;
  private round = 0;
  private decided = false;
  private finishes = new Map<string, number>();
  private finishTimer = 0;
  private rematch = new Set<string>();
  private noRoomTimer = 0;
  private left = false;
  /** the host's chip stake for friend rooms (0 = none); random matches stake 3 */
  private stake = 0;
  private matched = false;

  private constructor(
    isHost: boolean,
    code: string,
    mode: MatchMode,
    private me: { userId: string; name: string; avatar: AvatarChoice | null; chips?: number },
    private events: ArrowsNetEvents,
  ) {
    this.isHost = isHost;
    this.code = code;
    this.mode = mode;
  }

  static get configured() {
    return isSupabaseConfigured && supabase !== null;
  }

  static host(me: ArrowsNet["me"], mode: MatchMode, events: ArrowsNetEvents) {
    const net = new ArrowsNet(true, newRoomCode(), mode, me, events);
    net.open();
    return net;
  }

  static join(me: ArrowsNet["me"], code: string, events: ArrowsNetEvents) {
    const clean = code.trim().toUpperCase();
    const net = new ArrowsNet(false, clean, "race", me, events);
    if (!/^[A-Z0-9]{4}$/.test(clean)) {
      window.setTimeout(() => events.onStatus("error", "Room codes are 4 characters."), 0);
      return net;
    }
    net.open();
    return net;
  }

  get roomCode() {
    return this.code;
  }

  get matchMode() {
    return this.mode;
  }

  /** the stake the host picked (friend rooms) */
  get bet() {
    return this.stake;
  }

  get players() {
    return this.peers;
  }

  /** A random match (stakes 3) rather than a friend room. */
  setMatched(on: boolean) {
    this.matched = on;
  }

  /** My earned chips (the host caps the stake to what everyone has). */
  setChips(n: number) {
    this.me = { ...this.me, chips: Math.max(0, Math.floor(n) || 0) };
    void this.track();
  }

  /** Host: the chip stake per player (guests see it through presence). */
  setBet(n: number) {
    if (!this.isHost) return;
    this.stake = Math.max(0, Math.floor(n) || 0);
    void this.track();
    this.events.onPeers([...this.peers], this.mode);
  }

  private track() {
    const p: Presence = { ...this.me, host: this.isHost, mode: this.isHost ? this.mode : undefined, at: this.joinedAt, bet: this.isHost ? this.stake : undefined };
    return this.channel?.track(p);
  }

  get opponent(): Peer | null {
    return this.peers.find((p) => p.clientId !== this.clientId) ?? null;
  }

  private open() {
    if (!supabase) {
      this.events.onStatus("error", "Online play is not configured.");
      return;
    }
    this.events.onStatus("connecting");
    const ch = supabase.channel(`arrows:${this.code}`, {
      config: { broadcast: { self: false }, presence: { key: this.clientId } },
    });
    this.channel = ch;

    ch.on("presence", { event: "sync" }, () => this.onPresence());
    ch.on("broadcast", { event: "room-full" }, ({ payload }) => {
      if ((payload as { to: string }).to === this.clientId) this.fail("That room is full.");
    });
    ch.on("broadcast", { event: "start" }, ({ payload }) => {
      if (this.isHost) return;
      const p = payload as { mode: MatchMode; seed: number; round: number; bet?: number; bk?: string };
      this.beginRound(p.mode === "infinite" ? "infinite" : "race", num(p.seed, 2 ** 31), num(p.round, 1e6), num(p.bet, 1e7), p.bk === "random" ? "random" : "room");
    });
    ch.on("broadcast", { event: "prog" }, ({ payload }) => {
      const p = payload as Progress & { from: string };
      if (p.from === this.clientId) return;
      this.events.onProgress(p.from, {
        cleared: num(p.cleared, 1e5),
        left: num(p.left, 1e5),
        lives: num(p.lives, 9),
        ms: num(p.ms, 1e8),
      });
    });
    ch.on("broadcast", { event: "end" }, ({ payload }) => {
      const p = payload as { from: string; type: string; ms: number; round: number };
      if (this.isHost && p.round === this.round) this.judge(p.from, p.type === "finish" ? "finish" : "out", num(p.ms, 1e8));
    });
    ch.on("broadcast", { event: "result" }, ({ payload }) => {
      if (this.isHost) return;
      const p = payload as MatchResult & { round: number };
      if (p.round !== this.round || this.decided) return;
      this.settle({ winner: p.winner ? clip(p.winner, 40) : null, reason: p.reason === "out" || p.reason === "left" ? p.reason : "finish" });
    });
    ch.on("broadcast", { event: "rematch" }, ({ payload }) => {
      const from = clip((payload as { from: string }).from, 40);
      this.rematch.add(from);
      this.events.onRematch([...this.rematch]);
      if (this.isHost) this.maybeRematch();
    });

    ch.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await this.track();
        if (this.isHost) this.events.onStatus("lobby");
        else
          this.noRoomTimer = window.setTimeout(() => {
            if (!this.peers.some((x) => x.isHost)) this.fail("No room found with that code.");
          }, NO_ROOM_WAIT);
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        if (!this.left) this.fail("Connection failed. Try again.");
      }
    });
  }

  private fail(note: string) {
    this.events.onStatus("error", note);
    this.leave();
  }

  private onPresence() {
    const ch = this.channel;
    if (!ch) return;
    const state = ch.presenceState<Presence>();
    const all: (Peer & { at: number; mode?: MatchMode; bet: number })[] = [];
    for (const [key, metas] of Object.entries(state)) {
      const p = metas[metas.length - 1];
      if (!p) continue;
      all.push({
        clientId: key,
        userId: clip(p.userId, 64),
        name: clip(p.name, 40) || "Player",
        avatar: parseAvatar(p.avatar),
        isHost: p.host === true,
        at: Number(p.at) || 0,
        mode: p.mode,
        chips: num(p.chips, 1e9),
        bet: num(p.bet, 1e7),
      });
    }
    const host = all.find((p) => p.isHost);
    if (!this.isHost && host?.mode) this.mode = host.mode === "infinite" ? "infinite" : "race";
    if (!this.isHost && host) this.stake = host.bet;
    // host first, then the earliest guest; anyone else is turned away
    all.sort((a, b) => Number(b.isHost) - Number(a.isHost) || a.at - b.at || a.clientId.localeCompare(b.clientId));
    const seated = all.slice(0, 2);
    if (this.isHost) for (const extra of all.slice(2)) this.send("room-full", { to: extra.clientId });

    const hadOpponent = this.opponent;
    this.peers = seated.map(({ clientId, userId, name, avatar, isHost, chips }) => ({ clientId, userId, name, avatar, isHost, chips }));

    if (!this.isHost && host && this.noRoomTimer) {
      window.clearTimeout(this.noRoomTimer);
      this.noRoomTimer = 0;
      if (seated.some((p) => p.clientId === this.clientId)) this.events.onStatus("lobby");
    }
    // the other player left mid-match: the one still here wins
    if (this.playing && hadOpponent && !this.opponent && !this.decided) this.settle({ winner: this.clientId, reason: "left" });
    this.events.onPeers([...this.peers], this.mode);
  }

  private send(event: string, payload: Record<string, unknown>) {
    void this.channel?.send({ type: "broadcast", event, payload: { ...payload, from: this.clientId } });
  }

  private beginRound(mode: MatchMode, seed: number, round: number, bet = 0, bk: "room" | "random" = "room") {
    this.mode = mode;
    this.round = round;
    this.decided = false;
    this.playing = true;
    this.finishes.clear();
    window.clearTimeout(this.finishTimer);
    this.finishTimer = 0;
    this.rematch.clear();
    this.events.onRematch([]);
    this.events.onStatus("playing");
    this.events.onStart({ mode, seed, round, bet, bk });
  }

  /** Host: start a round (first match, or a rematch) once both players are in. */
  start() {
    if (!this.isHost || this.peers.length < 2) return;
    const seed = (Math.random() * 2 ** 31) | 0;
    const round = this.round + 1;
    // chips: 3 each in random matches (if both can), the host's pick in friend rooms
    const bet = matchStake(this.matched, this.stake, this.peers.map((p) => p.chips ?? 0));
    const bk = this.matched ? "random" : "room";
    this.send("start", { mode: this.mode, seed, round, bet, bk });
    this.beginRound(this.mode, seed, round, bet, bk);
  }

  /** Stream this player's progress (call on change; it's small). */
  progress(p: Progress) {
    this.send("prog", { cleared: p.cleared, left: p.left, lives: p.lives, ms: Math.round(p.ms) });
  }

  /** This player's run ended: cleared the board ("finish") or ran out of lives ("out"). */
  end(type: "finish" | "out", ms: number) {
    if (this.decided) return;
    if (this.isHost) this.judge(this.clientId, type, ms);
    else this.send("end", { type, ms: Math.round(ms), round: this.round });
  }

  private judge(who: string, type: "finish" | "out", ms: number) {
    if (this.decided) return;
    const other = this.peers.find((p) => p.clientId !== who)?.clientId ?? null;
    if (type === "out") {
      this.decide({ winner: other, reason: "out" });
      return;
    }
    this.finishes.set(who, ms);
    if (this.finishTimer) return;
    // a close race: give the other finish a moment to arrive, then the faster time wins
    this.finishTimer = window.setTimeout(() => {
      this.finishTimer = 0;
      let best: string | null = null;
      let bestMs = Infinity;
      for (const [id, t] of this.finishes) if (t < bestMs) [best, bestMs] = [id, t];
      this.decide({ winner: best, reason: "finish" });
    }, FINISH_GRACE);
  }

  private decide(r: MatchResult) {
    if (this.decided) return;
    this.send("result", { ...r, round: this.round });
    this.settle(r);
  }

  private settle(r: MatchResult) {
    this.decided = true;
    this.playing = false;
    window.clearTimeout(this.finishTimer);
    this.finishTimer = 0;
    this.events.onResult(r);
  }

  requestRematch() {
    this.rematch.add(this.clientId);
    this.send("rematch", {});
    this.events.onRematch([...this.rematch]);
    if (this.isHost) this.maybeRematch();
  }

  private maybeRematch() {
    if (this.peers.length === 2 && this.peers.every((p) => this.rematch.has(p.clientId))) this.start();
  }

  leave() {
    if (this.left) return;
    this.left = true;
    this.playing = false;
    window.clearTimeout(this.finishTimer);
    window.clearTimeout(this.noRoomTimer);
    if (this.channel && supabase) void supabase.removeChannel(this.channel);
    this.channel = null;
  }
}
