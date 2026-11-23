/* Chat in online matches and game lobbies: a chat icon in the game's icon bar opens the pack picker; what anyone
   sends pops up as a bubble with their name. Messages travel on their own Realtime channel per
   room (nothing is stored). One message every 3 s; tap a bubble's name to mute that player for
   this match; "Chat off" hides everyone's messages. */
import { useCallback, useEffect, useRef, useState } from "react";
import { MessageCircle, VolumeX } from "lucide-react";
import { supabase } from "../../supabase";
import { findItem, useChatOff, useChatPacks } from "../../lib/chatPacks";
import { ChatItemView, ChatPicker, usePackAccess } from "./ChatKit";

/* ---------- the icon in the game's icon bar and the panel share open / cooldown state ---------- */
type Ui = { live: boolean; open: boolean; cool: number };
let ui: Ui = { live: false, open: false, cool: 0 };
const uiListeners = new Set<() => void>();
function setUi(next: Partial<Ui>) {
  ui = { ...ui, ...next };
  uiListeners.forEach((l) => l());
}
function useUi() {
  const [cur, setCur] = useState(ui);
  useEffect(() => {
    const on = () => setCur(ui);
    uiListeners.add(on);
    on();
    return () => void uiListeners.delete(on);
  }, []);
  return cur;
}

/** The chat icon for the game's icon bar: only shown while in an online room. */
export function MatchChatButton({ className = "" }: { className?: string }) {
  const { live, open, cool } = useUi();
  if (!live) return null;
  return (
    <button
      type="button"
      className={`mc-btn${open ? " active" : ""}${className ? ` ${className}` : ""}`}
      onClick={() => setUi({ open: !ui.open })}
      aria-label="Send a message"
      title="Chat"
      aria-expanded={open}
    >
      <MessageCircle size={15} aria-hidden="true" />
      {cool > 0 ? <i className="mc-btn-cool">{cool}</i> : null}
    </button>
  );
}

type Bubble = { key: number; from: string; name: string; mine: boolean; pack: string; item: string };
const COOLDOWN = 3;
const SHOW_MS = 4500;

export default function MatchChat({ room, me }: { room: string | null | undefined; me: { id: string; name: string } }) {
  const packs = useChatPacks();
  const access = usePackAccess();
  const off = useChatOff();
  const { open } = useUi();
  const setOpen = (o: boolean) => setUi({ open: o });
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [muted, setMuted] = useState<Set<string>>(new Set());
  const [cool, setCool] = useState(0);
  const chRef = useRef<ReturnType<NonNullable<typeof supabase>["channel"]> | null>(null);
  const seq = useRef(0);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const offRef = useRef(off);
  offRef.current = off;
  const packsRef = useRef(packs);
  packsRef.current = packs;

  const show = useCallback((b: Omit<Bubble, "key">) => {
    if (!findItem(packsRef.current, b.pack, b.item)) return; // unknown item: ignore
    const key = ++seq.current;
    setBubbles((cur) => [...cur.slice(-3), { ...b, key }]);
    window.setTimeout(() => setBubbles((cur) => cur.filter((x) => x.key !== key)), SHOW_MS);
  }, []);

  // one channel per room
  useEffect(() => {
    if (!room || !supabase) return;
    const ch = supabase.channel(`mchat:${room}`, { config: { broadcast: { self: false } } });
    ch.on("broadcast", { event: "c" }, ({ payload }) => {
      const p = payload as { from?: string; name?: string; pack?: string; item?: string };
      if (typeof p.from !== "string" || typeof p.pack !== "string" || typeof p.item !== "string") return;
      if (offRef.current || mutedRef.current.has(p.from)) return;
      show({ from: p.from.slice(0, 64), name: String(p.name ?? "Player").slice(0, 40), mine: false, pack: p.pack, item: p.item });
    }).subscribe();
    chRef.current = ch;
    return () => {
      chRef.current = null;
      void supabase!.removeChannel(ch);
    };
  }, [room, show]);

  // the icon bar shows the chat icon while this room is open
  useEffect(() => {
    setUi({ live: true, open: false, cool: 0 });
    return () => setUi({ live: false, open: false, cool: 0 });
  }, []);
  useEffect(() => setUi({ cool }), [cool]);

  // cooldown tick
  useEffect(() => {
    if (cool <= 0) return;
    const t = window.setTimeout(() => setCool((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cool]);

  if (!room) return null;

  return (
    <div className="mc" aria-live="polite">
      <div className="mc-bubbles">
        {bubbles.map((b) => {
          const found = findItem(packs, b.pack, b.item);
          if (!found) return null;
          return (
            <div key={b.key} className={`mc-bubble${b.mine ? " is-mine" : ""}`}>
              {b.mine ? (
                <span className="mc-name">You</span>
              ) : (
                <button
                  type="button"
                  className="mc-name"
                  title={`Mute ${b.name} for this match`}
                  onClick={() => {
                    setMuted((m) => new Set(m).add(b.from));
                    setBubbles((cur) => cur.filter((x) => x.from !== b.from));
                  }}
                >
                  {b.name} <VolumeX size={12} aria-hidden="true" />
                </button>
              )}
              <ChatItemView pack={found.pack} item={found.item} />
            </div>
          );
        })}
      </div>

      {open ? (
        <div className="mc-picker">
          <ChatPicker
            cooldown={cool}
            onClose={() => setOpen(false)}
            onPick={(pack, item) => {
              if (cool > 0 || access(pack.id) !== "owned") return;
              void chRef.current?.send({ type: "broadcast", event: "c", payload: { from: me.id, name: me.name, pack: pack.id, item: item.id } });
              show({ from: me.id, name: me.name, mine: true, pack: pack.id, item: item.id });
              setCool(COOLDOWN);
              setOpen(false);
            }}
          />
          {muted.size ? (
            <button type="button" className="mc-unmute" onClick={() => setMuted(new Set())}>
              Unmute {muted.size} player{muted.size > 1 ? "s" : ""}
            </button>
          ) : null}
        </div>
      ) : null}

    </div>
  );
}

/* ---------- which room the game on screen is in (one line per game, one host on the page) ---------- */
type Active = { room: string | null; me: { id: string; name: string } };
let active: Active = { room: null, me: { id: "", name: "" } };
const listeners = new Set<() => void>();

/** Games call this every render: the online room they're in (lobby or match), or null. */
export function useMatchChat(room: string | null, me: { id: string; name: string }) {
  useEffect(() => {
    if (active.room === room && active.me.id === me.id && active.me.name === me.name) return;
    active = { room, me };
    listeners.forEach((l) => l());
  }, [room, me.id, me.name]);
  // leaving the game: no room
  useEffect(
    () => () => {
      active = { room: null, me: { id: "", name: "" } };
      listeners.forEach((l) => l());
    },
    [],
  );
}

/** Mounted once (game page): shows the chat for whatever room the game reports. */
export function MatchChatHost() {
  const [cur, setCur] = useState(active);
  useEffect(() => {
    const on = () => setCur(active);
    listeners.add(on);
    on();
    return () => void listeners.delete(on);
  }, []);
  return cur.room && cur.me.id ? <MatchChat key={cur.room} room={cur.room} me={cur.me} /> : null;
}
