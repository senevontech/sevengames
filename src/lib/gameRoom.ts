/* A small online room for turn-based games (Chess, Ludo), on Supabase Realtime.

   - Room codes are 4 characters; the channel is "<game>:<CODE>".
   - Presence says who is in the room. The host's presence also carries the room settings
     (`meta`, e.g. the chess clock or the number of Ludo seats). Seats: host first, then guests
     in the order they joined; anyone past the seat limit is turned away ("room full").
   - Game messages are broadcasts on one event ("m") with a type `t`, so games can register
     handlers by type. Every message carries the sender's client id (`from`). */
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase, isSupabaseConfigured } from "../supabase";
import { parseAvatar, type AvatarChoice } from "./avatar";

export type RoomStatus = "connecting" | "lobby" | "error";
export type RoomPeer = { clientId: string; userId: string; name: string; avatar: AvatarChoice | null; isHost: boolean; look?: string | null; chips?: number | null };
/** `look`: a cosmetic the game shows everyone (e.g. a Ludo token colour id). */
/** `chips`: the player's earned chips (what they could bet); the server checks every stake anyway. */
export type RoomMe = { userId: string; name: string; avatar: AvatarChoice | null; look?: string | null; chips?: number | null };
export type RoomMsg = { t: string; from: string; [k: string]: unknown };

export type RoomEvents = {
  onStatus: (status: RoomStatus, note?: string) => void;
  /** Seated players (host first) and the host's settings. */
  onPeers: (peers: RoomPeer[], meta: Record<string, unknown>) => void;
  onMessage: (msg: RoomMsg) => void;
};

type Presence = RoomMe & { host: boolean; at: number; meta?: Record<string, unknown> };

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const NO_ROOM_WAIT = 3500;

export const newRoomCode = () => Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join("");
export const randomId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const clip = (s: unknown, n: number) => (typeof s === "string" ? s.slice(0, n) : "");

export class GameRoom {
  readonly clientId = randomId();
  readonly isHost: boolean;
  readonly code: string;
  private channel: RealtimeChannel | null = null;
  private peers: RoomPeer[] = [];
  private meta: Record<string, unknown>;
  private joinedAt = Date.now();
  private noRoomTimer = 0;
  private left = false;

  private constructor(
    private game: string,
    isHost: boolean,
    code: string,
    private me: RoomMe,
    private seats: number,
    meta: Record<string, unknown>,
    private events: RoomEvents,
  ) {
    this.isHost = isHost;
    this.code = code;
    this.meta = meta;
  }

  static get configured() {
    return isSupabaseConfigured && supabase !== null;
  }

  /** Open a new room. `seats` = how many players it holds; `meta` = settings guests see. */
  static host(game: string, me: RoomMe, seats: number, meta: Record<string, unknown>, events: RoomEvents) {
    const room = new GameRoom(game, true, newRoomCode(), me, seats, { ...meta, seats }, events);
    room.open();
    return room;
  }

  static join(game: string, code: string, me: RoomMe, events: RoomEvents) {
    const clean = code.trim().toUpperCase();
    const room = new GameRoom(game, false, clean, me, 8, {}, events);
    if (!/^[A-Z0-9]{4}$/.test(clean)) window.setTimeout(() => events.onStatus("error", "Room codes are 4 characters."), 0);
    else room.open();
    return room;
  }

  get players() {
    return this.peers;
  }

  get settings() {
    return this.meta;
  }

  private open() {
    if (!supabase) {
      this.events.onStatus("error", "Online play is not configured.");
      return;
    }
    this.events.onStatus("connecting");
    const ch = supabase.channel(`${this.game}:${this.code}`, {
      config: { broadcast: { self: false }, presence: { key: this.clientId } },
    });
    this.channel = ch;
    ch.on("presence", { event: "sync" }, () => this.onPresence());
    ch.on("broadcast", { event: "m" }, ({ payload }) => {
      const msg = payload as RoomMsg;
      if (!msg || typeof msg.t !== "string" || typeof msg.from !== "string") return;
      if (msg.t === "room-full") {
        if (msg.to === this.clientId) this.fail("That room is full.");
        return;
      }
      this.events.onMessage(msg);
    });
    ch.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await this.track();
        if (this.isHost) this.events.onStatus("lobby");
        else
          this.noRoomTimer = window.setTimeout(() => {
            if (!this.peers.some((p) => p.isHost)) this.fail("No room found with that code.");
          }, NO_ROOM_WAIT);
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        if (!this.left) this.fail("Connection failed. Try again.");
      }
    });
  }

  private track() {
    const p: Presence = { ...this.me, host: this.isHost, at: this.joinedAt, meta: this.isHost ? this.meta : undefined };
    return this.channel?.track(p);
  }

  /** Update what the others see of me (e.g. my chips once the wallet has loaded). */
  setMe(me: Partial<RoomMe>) {
    this.me = { ...this.me, ...me };
    void this.track();
  }

  /** Host: change the room settings (guests see them through presence). */
  setMeta(meta: Record<string, unknown>) {
    if (!this.isHost) return;
    this.meta = { ...this.meta, ...meta };
    if (typeof meta.seats === "number") this.seats = meta.seats;
    void this.track();
  }

  private fail(note: string) {
    this.events.onStatus("error", note);
    this.leave();
  }

  private onPresence() {
    const ch = this.channel;
    if (!ch) return;
    const state = ch.presenceState<Presence>();
    const all: (RoomPeer & { at: number; meta?: Record<string, unknown> })[] = [];
    for (const [key, metas] of Object.entries(state)) {
      const p = metas[metas.length - 1];
      if (!p) continue;
      all.push({
        clientId: key,
        userId: clip(p.userId, 64),
        name: clip(p.name, 40) || "Player",
        avatar: parseAvatar(p.avatar),
        look: clip(p.look, 32) || null,
        chips: Number.isFinite(Number(p.chips)) ? Math.max(0, Math.floor(Number(p.chips))) : null,
        isHost: p.host === true,
        at: Number(p.at) || 0,
        meta: p.meta,
      });
    }
    const host = all.find((p) => p.isHost);
    if (!this.isHost && host?.meta && typeof host.meta === "object") {
      this.meta = host.meta;
      const seats = Number(host.meta.seats);
      if (seats >= 2 && seats <= 8) this.seats = seats;
    }
    all.sort((a, b) => Number(b.isHost) - Number(a.isHost) || a.at - b.at || a.clientId.localeCompare(b.clientId));
    const seated = all.slice(0, this.seats);
    if (this.isHost) for (const extra of all.slice(this.seats)) this.send("room-full", { to: extra.clientId });
    this.peers = seated.map(({ clientId, userId, name, avatar, isHost, look, chips }) => ({ clientId, userId, name, avatar, isHost, look, chips }));

    if (!this.isHost && host && this.noRoomTimer && seated.some((p) => p.clientId === this.clientId)) {
      window.clearTimeout(this.noRoomTimer);
      this.noRoomTimer = 0;
      this.events.onStatus("lobby");
    }
    this.events.onPeers([...this.peers], this.meta);
  }

  send(t: string, payload: Record<string, unknown> = {}) {
    void this.channel?.send({ type: "broadcast", event: "m", payload: { ...payload, t, from: this.clientId } });
  }

  leave() {
    if (this.left) return;
    this.left = true;
    window.clearTimeout(this.noRoomTimer);
    if (this.channel && supabase) void supabase.removeChannel(this.channel);
    this.channel = null;
  }
}
