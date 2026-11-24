/* Carrom online — Supabase Realtime rooms.
   Host-authoritative: host simulates physics and streams snapshots;
   guests send place/shot commands. Rooms are 4-character codes. */
import { supabase, isSupabaseConfigured } from "../../supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { LivePos, Seats, Snap, Vec } from "./engine";

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function newRoomCode() {
  let code = "";
  for (let i = 0; i < 4; i += 1) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

/** How an online match starts. `mid`: the match id; `uids`: each seat's account id (results). */
export type StartCfg = {
  seats: Seats;
  players: Array<{ name: string; kind: "human" | "cpu" }>;
  mid?: string;
  uids?: Array<string | null>;
  /** chips each player stakes (0: no bet) and how the match was made */
  bet?: number;
  bk?: "room" | "random";
};

/** `chips`: the player's earned chips (what they could bet; the server checks every stake). */
export type RosterEntry = { clientId: string; name: string; seat: number; isHost: boolean; userId?: string; chips?: number };

export type NetStatus = "idle" | "connecting" | "lobby" | "playing" | "error";

export type NetEvents = {
  onStatus: (status: NetStatus, note?: string) => void;
  onRoster: (roster: RosterEntry[], seats: Seats) => void;
  onStart: (cfg: StartCfg) => void;
  onSnapshot: (snap: Snap) => void;
  onLive: (positions: LivePos[]) => void;
  onMessage: (text: string) => void;
};

function randomId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export class CarromNet {
  readonly clientId = randomId();
  readonly isHostClient: boolean;
  private channel: RealtimeChannel | null = null;
  private code: string | null = null;
  private roster: RosterEntry[] = [];
  private seats: Seats = 2;
  private joinedOrder: string[] = [];
  private joinAckTimer: number | null = null;
  private events: NetEvents;
  private mySeat = 0;
  private left = false;
  /** this player's account id (signed in), shared through presence for match results */
  private userId = "";
  private chips = 0;
  private myName = "";
  /** the host's chip stake per player (0 = no bet), shared with the roster */
  private stake = 0;

  private constructor(isHost: boolean, events: NetEvents) {
    this.isHostClient = isHost;
    this.events = events;
  }

  get roomCode() {
    return this.code;
  }

  get mySeatIndex() {
    return this.mySeat;
  }

  get rosterList() {
    return this.roster;
  }

  get bet() {
    return this.stake;
  }

  /** My earned chips, shown to the host so the stake fits everyone. */
  setChips(n: number) {
    this.chips = Math.max(0, Math.floor(n) || 0);
    if (this.channel && this.myName) void this.channel.track({ name: this.myName, userId: this.userId, chips: this.chips });
  }

  /** Host: the chip stake per player (guests get it with the roster). */
  setBet(n: number) {
    if (!this.isHostClient) return;
    this.stake = Math.max(0, Math.floor(n) || 0);
    this.events.onRoster([...this.roster], this.seats);
    this.broadcastRoster(false);
  }

  static get configured() {
    return isSupabaseConfigured && supabase !== null;
  }

  static createHost(name: string, seats: Seats, events: NetEvents, userId = ""): CarromNet {
    const net = new CarromNet(true, events);
    net.userId = userId;
    void net.host(name, seats);
    return net;
  }

  static createGuest(name: string, code: string, events: NetEvents, userId = ""): CarromNet {
    const net = new CarromNet(false, events);
    net.userId = userId;
    void net.guest(name, code);
    return net;
  }

  private makeChannel(code: string) {
    if (!supabase) throw new Error("Supabase is not configured");
    this.code = code;
    const ch = supabase.channel(`carrom:${code}`, {
      config: { broadcast: { self: false }, presence: { key: this.clientId } },
    });
    this.channel = ch;
    return ch;
  }

  private async host(name: string, seats: Seats) {
    if (!supabase) {
      this.events.onStatus("error", "Online play is not configured.");
      return;
    }
    this.events.onStatus("connecting");
    this.seats = seats;
    const code = newRoomCode();
    const ch = this.makeChannel(code);

    this.wirePresence(ch, name);
    // the host listens for what guests send (place / shot)
    this.wireHostMessages(ch);

    ch.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        this.myName = name;
        await ch.track({ name, userId: this.userId, chips: this.chips });
        this.roster = [{ clientId: this.clientId, name, seat: 0, isHost: true, userId: this.userId || undefined, chips: this.chips }];
        this.joinedOrder = [this.clientId];
        this.events.onStatus("lobby");
        this.events.onRoster([...this.roster], seats);
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        if (!this.left) this.events.onStatus("error", "Connection failed. Try again.");
      }
    });
  }

  private async guest(name: string, code: string) {
    if (!supabase) {
      this.events.onStatus("error", "Online play is not configured.");
      return;
    }
    this.events.onStatus("connecting");
    const clean = code.trim().toUpperCase();
    if (clean.length !== 4) {
      this.events.onStatus("error", "Room codes are 4 characters.");
      return;
    }
    const ch = this.makeChannel(clean);

    this.wirePresence(ch, name);
    // guests listen for what the host sends (roster / start / snapshots / live positions)
    this.wireGuestMessages(ch);

    ch.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        this.myName = name;
        await ch.track({ name, userId: this.userId, chips: this.chips });
        // If no host roster arrives shortly, the room does not exist.
        this.joinAckTimer = window.setTimeout(() => {
          if (this.events && this.mySeat === 0 && this.roster.length === 0) {
            this.events.onStatus("error", "No room found with that code.");
          }
        }, 3000);
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        if (!this.left) this.events.onStatus("error", "Connection failed. Try again.");
      }
    });
  }

  private wirePresence(ch: RealtimeChannel, _name: string) {
    ch.on("presence", { event: "sync" }, () => {
      if (!this.isHostClient) return;
      const state = ch.presenceState<{ name: string; userId?: string; chips?: number }>();
      const keys = Object.keys(state);
      // new keys (ignoring ones we already know) join after existing roster
      for (const key of keys) {
        if (!this.joinedOrder.includes(key)) this.joinedOrder.push(key);
      }
      this.joinedOrder = this.joinedOrder.filter((key) => keys.includes(key));

      const roster: RosterEntry[] = [];
      let seat = 0;
      for (const key of this.joinedOrder) {
        const meta = state[key]?.[0];
        const name = (meta && meta.name) || "Player";
        roster.push({
          clientId: key,
          name: key === this.clientId ? name : name,
          seat,
          isHost: key === this.clientId,
          userId: typeof meta?.userId === "string" && meta.userId ? meta.userId.slice(0, 64) : undefined,
          chips: Number.isFinite(Number(meta?.chips)) ? Math.max(0, Math.floor(Number(meta?.chips))) : 0,
        });
        seat += 1;
        if (seat >= this.seats) break;
      }
      const overflow = this.joinedOrder.length > this.seats;
      this.roster = roster;
      this.events.onRoster([...roster], this.seats);
      if (overflow) {
        this.send("room-full", {});
      }
    });
  }

  private wireGuestMessages(ch: RealtimeChannel) {
    ch.on("broadcast", { event: "roster" }, ({ payload }) => {
      const roster = (payload as { roster: RosterEntry[]; seats: Seats }).roster;
      const seats = (payload as { seats: Seats }).seats;
      this.stake = Math.max(0, Math.floor(Number((payload as { bet?: number }).bet) || 0));
      this.roster = roster;
      this.seats = seats;
      const mine = roster.find((entry) => entry.clientId === this.clientId);
      if (this.joinAckTimer) {
        window.clearTimeout(this.joinAckTimer);
        this.joinAckTimer = null;
      }
      if (!mine) {
        this.events.onStatus("error", "That room is full.");
        return;
      }
      this.mySeat = mine.seat;
      this.events.onStatus("lobby");
      this.events.onRoster(roster, seats);
    });
    ch.on("broadcast", { event: "room-full" }, () => {
      this.events.onStatus("error", "That room is full.");
    });
    ch.on("broadcast", { event: "start" }, ({ payload }) => {
      const p = payload as StartCfg;
      this.events.onStatus("playing");
      this.events.onStart(p);
    });
    ch.on("broadcast", { event: "snapshot" }, ({ payload }) => {
      this.events.onSnapshot((payload as { snap: Snap }).snap);
    });
    ch.on("broadcast", { event: "live" }, ({ payload }) => {
      this.events.onLive((payload as { positions: LivePos[] }).positions);
    });
    ch.on("broadcast", { event: "msg" }, ({ payload }) => {
      this.events.onMessage((payload as { text: string }).text);
    });
  }

  private wireHostMessages(ch: RealtimeChannel) {
    ch.on("broadcast", { event: "place" }, ({ payload }) => {
      const p = payload as { clientId: string; seat: number; t: number };
      this.handlers.onPlace?.(p.seat, p.t);
    });
    ch.on("broadcast", { event: "shot" }, ({ payload }) => {
      const p = payload as { clientId: string; seat: number; t: number; dir: Vec; power: number };
      this.handlers.onShot?.(p.seat, p.t, p.dir, p.power);
    });
  }

  private handlers: {
    onPlace?: (seat: number, t: number) => void;
    onShot?: (seat: number, t: number, dir: Vec, power: number) => void;
  } = {};

  onHostCommand(handlers: {
    onPlace?: (seat: number, t: number) => void;
    onShot?: (seat: number, t: number, dir: Vec, power: number) => void;
  }) {
    this.handlers = handlers;
  }

  private send(event: string, payload: unknown) {
    if (!this.channel) return;
    void this.channel.send({ type: "broadcast", event, payload });
  }

  broadcastRoster(started: boolean) {
    this.send("roster", { roster: this.roster, seats: this.seats, started, bet: this.stake });
  }

  broadcastStart(cfg: StartCfg) {
    this.send("start", cfg);
  }

  broadcastSnapshot(snap: Snap) {
    this.send("snapshot", { snap });
  }

  broadcastLive(positions: LivePos[]) {
    this.send("live", { positions });
  }

  broadcastMsg(text: string) {
    this.send("msg", { text });
  }

  sendPlace(seat: number, t: number) {
    this.send("place", { clientId: this.clientId, seat, t: Math.round(t) });
  }

  sendShot(seat: number, t: number, dir: Vec, power: number) {
    this.send("shot", {
      clientId: this.clientId,
      seat,
      t: Math.round(t),
      dir: { x: Math.round(dir.x * 1000) / 1000, y: Math.round(dir.y * 1000) / 1000 },
      power: Math.round(power * 100) / 100,
    });
  }

  leave() {
    this.left = true;
    if (this.channel && supabase) {
      void supabase.removeChannel(this.channel);
    }
    this.channel = null;
  }
}
