/* One Card online (supabase/lastcard.sql): a room of 2–4 players. The server deals and checks
   every move; this screen asks for the room's state about once a second (sooner when someone
   pings the room's channel after moving) and sends moves. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Copy, Crown, Lock, LogOut, Play, Share2, Users, Zap } from "lucide-react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "../../supabase";
import { useAuthContext } from "../../context/AuthContext";
import { parseAvatar, useAvatar } from "../../lib/avatar";
import PlayerAvatar from "../../components/PlayerAvatar";
import { DEFAULT_RULES, canPlay, cardOf, type LCState, type LastAction, type Rules } from "./engine";
import { ColorPicker, LCTable, SwapPicker, type SeatInfo } from "./Table";

export type LCView = {
  code: string;
  private: boolean;
  status: "lobby" | "playing" | "over";
  host: boolean;
  rules: { stack: boolean; sevenZero: boolean; drawUntil: boolean };
  top: number | null;
  under: number[] | null;
  color: number;
  turn: number | null;
  dir: 1 | -1;
  pending: number;
  pend_kind: 0 | 2 | 4;
  drawn: number | null;
  deck: number;
  winner: number | null;
  points: number | null;
  last: LastAction | null;
  seq: number;
  ms_left: number | null;
  seats: { seat: number; user_id: string; name: string; avatar: unknown; count: number; called: boolean; out: boolean }[];
  me: number | null;
  hand: number[];
};

const SITE = "https://games.senevon.in/game/last-card";
const POLL_MS = 1100;

const ERRORS: Record<string, string> = {
  not_signed_in: "Sign in to play online.",
  no_room: "That room doesn't exist (or everyone left).",
  room_full: "That room is full (4 players).",
  room_playing: "That room is already playing. Wait for the next game, or start your own.",
  need_players: "You need at least 2 players to deal.",
  not_your_turn: "It's not your turn.",
  bad_move: "That card can't be played now.",
  not_host: "Only the host can do that.",
};
function errText(e: unknown) {
  const m = (e as { message?: string })?.message ?? String(e);
  const key = Object.keys(ERRORS).find((k) => m.includes(k));
  return key ? ERRORS[key] : "Something went wrong. Try again.";
}
async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!supabase) throw new Error("offline");
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

function useMe() {
  const { user } = useAuthContext();
  const { choice } = useAvatar(user);
  const meta = user?.user_metadata ?? {};
  const name = ((meta.full_name as string | undefined) || (meta.name as string | undefined) || user?.email?.split("@")[0] || "Player").slice(0, 24);
  return { user, name, avatar: choice };
}

/* ---------------- the online menu ---------------- */
export function OnlineLobby({ rules, onSeated }: { rules: Rules; onSeated: (v: LCView) => void }) {
  const location = useLocation();
  const { user, name, avatar } = useMe();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = useCallback(
    async (fn: string, args: Record<string, unknown>) => {
      setBusy(true);
      setError(null);
      try {
        onSeated(await rpc<LCView>(fn, { p_name: name, p_avatar: avatar ?? null, ...args }));
      } catch (e) {
        setError(errText(e));
      } finally {
        setBusy(false);
      }
    },
    [name, avatar, onSeated],
  );
  // an invite link (?room=CODE) joins straight away
  const tried = useRef(false);
  useEffect(() => {
    const room = new URLSearchParams(location.search).get("room");
    if (!user || tried.current || !room || !/^[A-Z0-9]{4}$/i.test(room)) return;
    tried.current = true;
    void go("lc_join", { p_code: room.toUpperCase() });
  }, [user, location.search, go]);

  if (!user) {
    return (
      <div className="ol-card">
        <h3>Online</h3>
        <p className="ol-sub">Sign in to play One Card with friends or anyone online.</p>
        <Link className="primary-btn" to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`}>
          Sign in
        </Link>
      </div>
    );
  }
  const r = { stack: rules.stack, sevenZero: rules.sevenZero, drawUntil: rules.drawUntil };
  return (
    <div className="ol-card lc-lobby">
      <h3>Online</h3>
      <p className="ol-sub">2 to 4 players. The server deals; everyone sees only their own cards.</p>
      <button type="button" className="lc-btn lc-btn-main" disabled={busy} onClick={() => void go("lc_quick", {})}>
        <Zap size={16} /> Quick match
      </button>
      <button type="button" className="lc-btn" disabled={busy} onClick={() => void go("lc_create", { p_private: true, p_rules: r })}>
        <Lock size={15} /> Private room for friends
      </button>
      <form
        className="lc-join"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim().length === 4) void go("lc_join", { p_code: code.trim().toUpperCase() });
        }}
      >
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 4))} placeholder="Room code" aria-label="Room code" autoCapitalize="characters" spellCheck={false} />
        <button type="submit" className="lc-btn" disabled={busy || code.trim().length !== 4}>
          Join
        </button>
      </form>
      {error ? (
        <p className="lc-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/* ---------------- the room ---------------- */
export function OnlineRoom({ initial, onLeave }: { initial: LCView; onLeave: () => void }) {
  const [view, setView] = useState<LCView>(initial);
  const viewRef = useRef(view);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<null | { card: number; step: "color" | "swap"; color?: number }>(null);
  const [callNext, setCallNext] = useState(false);
  const [deadline, setDeadline] = useState(() => (initial.ms_left === null ? 0 : Date.now() + initial.ms_left));
  const [, tick] = useState(0);
  const [copied, setCopied] = useState(false);
  const chan = useRef<RealtimeChannel | null>(null);
  const code = initial.code;

  const apply = useCallback((v: LCView) => {
    viewRef.current = v;
    setView(v);
    setDeadline(v.ms_left === null ? 0 : Date.now() + v.ms_left);
  }, []);

  const refresh = useCallback(async () => {
    try {
      apply(await rpc<LCView>("lc_state", { p_code: code }));
      setError(null);
    } catch (e) {
      const msg = (e as Error).message ?? "";
      if (msg.includes("no_room")) onLeave();
      else setError(errText(e));
    }
  }, [apply, code, onLeave]);

  useEffect(() => {
    const id = window.setInterval(() => void refresh(), POLL_MS);
    const t = window.setInterval(() => tick((n) => n + 1), 250);
    if (supabase) {
      const ch = supabase.channel(`lc:${code}`, { config: { broadcast: { self: false } } });
      ch.on("broadcast", { event: "ch" }, () => void refresh());
      ch.subscribe();
      chan.current = ch;
    }
    return () => {
      window.clearInterval(id);
      window.clearInterval(t);
      if (chan.current && supabase) void supabase.removeChannel(chan.current);
      chan.current = null;
    };
  }, [code, refresh]);

  const send = async (fn: string, args: Record<string, unknown> = {}) => {
    setBusy(true);
    setError(null);
    try {
      apply(await rpc<LCView>(fn, { p_code: code, ...args }));
      void chan.current?.send({ type: "broadcast", event: "ch", payload: {} });
    } catch (e) {
      setError(errText(e));
      void refresh();
    } finally {
      setBusy(false);
    }
  };
  const leave = async () => {
    try {
      await rpc("lc_leave");
      void chan.current?.send({ type: "broadcast", event: "ch", payload: {} });
    } catch {
      /* gone anyway */
    }
    onLeave();
  };

  const msLeft = deadline ? Math.max(0, deadline - Date.now()) : null;
  const me = view.me;
  const mySeat = view.seats.find((s) => s.seat === me);
  const n = view.seats.length ? Math.max(...view.seats.map((s) => s.seat)) + 1 : 0;
  const active = view.seats.filter((s) => !s.out);

  // the same rule check as the server, for highlighting what you can play
  const asState = useMemo(
    () =>
      ({
        phase: view.status === "playing" ? "play" : "over",
        drawn: view.drawn,
        pending: view.pending,
        pendKind: view.pend_kind,
        color: view.color,
        discard: view.top === null ? [] : [view.top],
        rules: { ...DEFAULT_RULES, ...view.rules, jumpIn: false },
      }) as unknown as LCState,
    [view],
  );
  const myTurn = view.status === "playing" && me !== null && view.turn === me && !busy;
  const playableIds = myTurn ? view.hand.filter((c) => canPlay(asState, c)) : [];

  const doPlay = (card: number, color?: number, target?: number) => {
    setPick(null);
    const last = callNext || (mySeat?.called ?? false);
    setCallNext(false);
    void send("lc_play", { p_card: card, p_color: color ?? null, p_target: target ?? null, p_last: last });
  };
  const onPlay = (card: number) => {
    if (!playableIds.includes(card)) return;
    const k = cardOf(card);
    if (k.c === 4) return setPick({ card, step: "color" });
    if (view.rules.sevenZero && k.v === 7 && active.length > 2) return setPick({ card, step: "swap" });
    doPlay(card);
  };

  const seats: SeatInfo[] = Array.from({ length: n }, (_, i) => {
    const s = view.seats.find((x) => x.seat === i);
    if (!s) return { name: "—", count: 0, called: false, note: "left" };
    return {
      name: s.seat === me ? "You" : s.name,
      count: s.count,
      called: s.called,
      note: s.out ? "left the game" : undefined,
      face: <PlayerAvatar id={s.user_id} name={s.name} avatar={parseAvatar(s.avatar)} size={30} className="lb-initial lc-av" />,
    };
  });

  const invite = `${SITE}?room=${view.code}`;
  const share = async () => {
    try {
      if (navigator.share) return void (await navigator.share({ text: `Play One Card with me · room ${view.code}`, url: invite }));
    } catch {
      return;
    }
    try {
      await navigator.clipboard.writeText(invite);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* nothing */
    }
  };

  /* ----- waiting for players ----- */
  if (view.status === "lobby" || view.top === null) {
    return (
      <div className="lc-room">
        <div className="lc-panel lc-wait">
          <h3>{view.private ? "Private room" : "Quick match"}</h3>
          <p className="lc-sub">
            Room code <b className="lc-code">{view.code}</b>
          </p>
          <div className="lc-row">
            <button type="button" className="lc-btn" onClick={() => void share()}>
              <Share2 size={15} /> Invite friends
            </button>
            <button
              type="button"
              className="lc-btn"
              onClick={() => {
                void navigator.clipboard?.writeText(view.code);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              }}
            >
              <Copy size={15} /> {copied ? "Copied" : "Copy code"}
            </button>
          </div>
          <ul className="lc-players">
            {view.seats.map((s) => (
              <li key={s.seat}>
                <PlayerAvatar id={s.user_id} name={s.name} avatar={parseAvatar(s.avatar)} size={28} className="lb-initial" />
                <span>{s.seat === me ? `${s.name} (you)` : s.name}</span>
                {s.seat === 0 ? <Crown size={14} aria-label="Host" /> : null}
              </li>
            ))}
            {Array.from({ length: Math.max(0, 4 - view.seats.length) }, (_, i) => (
              <li key={`e${i}`} className="is-empty">
                <Users size={16} /> Waiting for a player…
              </li>
            ))}
          </ul>
          <RulesLine rules={view.rules} />
          {view.host ? (
            <>
              <div className="lc-toggles">
                {(
                  [
                    ["stack", "Stack +2 / +4"],
                    ["sevenZero", "7 swaps · 0 passes"],
                    ["drawUntil", "Draw until you can play"],
                  ] as const
                ).map(([k, label]) => (
                  <label key={k} className="lc-toggle">
                    <input type="checkbox" checked={view.rules[k]} disabled={busy} onChange={(e) => void send("lc_set_rules", { p_rules: { ...view.rules, [k]: e.target.checked } })} />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              <button type="button" className="lc-btn lc-btn-main" disabled={busy || view.seats.length < 2} onClick={() => void send("lc_start")}>
                <Play size={16} /> {view.seats.length < 2 ? "Waiting for players…" : `Deal for ${view.seats.length}`}
              </button>
            </>
          ) : (
            <p className="lc-sub">The host deals when everyone's in.</p>
          )}
          {error ? <p className="lc-error">{error}</p> : null}
          <button type="button" className="lc-btn" onClick={() => void leave()}>
            <LogOut size={15} /> Leave
          </button>
        </div>
      </div>
    );
  }

  /* ----- playing / over ----- */
  const turnSeat = view.seats.find((s) => s.seat === view.turn);
  const status =
    view.status === "over"
      ? view.winner === me
        ? "You win!"
        : `${view.seats.find((s) => s.seat === view.winner)?.name ?? "Someone"} wins`
      : myTurn
        ? view.pending
          ? view.rules.stack
            ? `+${view.pending} coming: stack a +2/+4 or take ${view.pending}`
            : `Take ${view.pending}`
          : view.drawn !== null
            ? "Play the card you drew, or keep it"
            : "Your turn: match the colour or the symbol"
        : `${turnSeat?.name ?? "Someone"} is playing…`;
  const winnerName = view.winner === me ? "You" : view.seats.find((s) => s.seat === view.winner)?.name ?? "Someone";

  return (
    <div className="lc-room">
      <LCTable
        seats={seats}
        me={me ?? 0}
        hand={view.hand}
        turn={view.turn ?? -1}
        dir={view.dir}
        top={view.top}
        under={view.under ?? []}
        color={view.color}
        pending={view.pending}
        drawPile={view.deck}
        over={view.status === "over"}
        winner={view.winner}
        last={view.last}
        seq={view.seq}
        playableIds={playableIds}
        jumpIds={[]}
        canDraw={myTurn && view.drawn === null}
        canPass={myTurn && view.drawn !== null}
        canCall={myTurn && view.hand.length === 2 && !(mySeat?.called || callNext)}
        called={!!(mySeat?.called || callNext)}
        status={status}
        clock={view.status === "playing" && msLeft !== null ? Math.ceil(msLeft / 1000) : null}
        onPlay={onPlay}
        onDraw={() => void send("lc_draw")}
        onPass={() => void send("lc_pass")}
        onCall={() => {
          setCallNext(true);
          void send("lc_call");
        }}
        top_left={
          <span className="lc-pill">
            {view.private ? <Lock size={13} /> : <Users size={13} />} {view.code}
          </span>
        }
        top_right={
          <button type="button" className="lc-pill" onClick={() => void leave()}>
            <LogOut size={14} /> Leave
          </button>
        }
        overlay={
          <>
            {pick?.step === "color" ? (
              <ColorPicker
                onPick={(c) => (view.rules.sevenZero && cardOf(pick.card).v === 7 ? setPick({ ...pick, step: "swap", color: c }) : doPlay(pick.card, c))}
                onCancel={() => setPick(null)}
              />
            ) : null}
            {pick?.step === "swap" ? <SwapPicker seats={seats} me={me ?? 0} onPick={(t) => doPlay(pick.card, pick.color, t)} onCancel={() => setPick(null)} /> : null}
            {view.status === "over" ? (
              <div className="lc-overlay" role="dialog" aria-label="Game over">
                <div className="lc-panel">
                  <h3>{view.winner === me ? "You win!" : `${winnerName} wins`}</h3>
                  <p className="lc-sub">
                    {view.points ? `${view.points} points left in the other hands · ` : ""}
                    {view.winner === me ? "+40 XP" : "+10 XP"}
                  </p>
                  {view.host ? (
                    <button type="button" className="lc-btn lc-btn-main" disabled={busy || active.length < 2} onClick={() => void send("lc_start")}>
                      <Play size={16} /> Deal again
                    </button>
                  ) : (
                    <p className="lc-sub">The host can deal again.</p>
                  )}
                  <button type="button" className="lc-btn" onClick={() => void leave()}>
                    <LogOut size={15} /> Leave the room
                  </button>
                </div>
              </div>
            ) : null}
            {error ? <p className="lc-error lc-error-float">{error}</p> : null}
          </>
        }
      />
    </div>
  );
}

function RulesLine({ rules }: { rules: LCView["rules"] }) {
  const on = [rules.stack ? "stacking" : null, rules.sevenZero ? "7-swap / 0-pass" : null, rules.drawUntil ? "draw until you can play" : null].filter(Boolean);
  return <p className="lc-sub">House rules: {on.length ? on.join(", ") : "classic"}</p>;
}
