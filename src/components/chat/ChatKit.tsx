/* Shared pieces for match chat and friends chat: how an item looks, the pack picker (with buy /
   Plus states for packs you don't own), and the friends-chat unread counts. */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BellOff, Bell } from "../anim-icons";
import TokenIcon from "../TokenIcon";
import { useShop } from "../../lib/shop";
import { useAuthContext } from "../../context/AuthContext";
import { supabase } from "../../supabase";
import { formatTokens } from "../../lib/currency";
import { setChatOff, useChatOff, useChatPacks, type ChatItem, type ChatPack } from "../../lib/chatPacks";
import "./chat.css";

/** One item as it's sent / shown. `size`: "pick" in the picker, "show" in a bubble. */
export function ChatItemView({ pack, item, size = "show" }: { pack: ChatPack; item: ChatItem; size?: "pick" | "show" }) {
  if (pack.kind === "emoji") return <span className={`ci-emoji is-${size}`}>{item.text}</span>;
  if (pack.kind === "phrase") return <span className={`ci-phrase is-${size}`}>{item.text}</span>;
  if (pack.kind === "image")
    return (
      <span className={`ci-image is-${size}`}>
        <img src={item.art} alt={item.text || "sticker"} loading="lazy" />
      </span>
    );
  return (
    <span className={`ci-sticker tone-${item.tone ?? "blue"} anim-${item.anim ?? "bounce"} is-${size}`}>
      <span className="ci-sticker-art" aria-hidden="true">
        {item.art}
      </span>
      <b>{item.text}</b>
    </span>
  );
}

/** Built-in free packs work even before the shop knows about them (chat.sql not run yet). */
const ALWAYS_FREE = new Set(["chat:emoji", "chat:phrases", "chat:starter"]);

export function usePackAccess() {
  const shop = useShop();
  return useCallback(
    (packId: string): "owned" | "plus" | "buy" | "off" => {
      const price = shop.priceOf(packId);
      if (price === null) return ALWAYS_FREE.has(packId) ? "owned" : "off";
      if (shop.owns(packId)) return "owned";
      // off sale (admin): only owners still see it
      if (shop.prices.find((p) => p.item_id === packId)?.active === false) return "off";
      if (shop.isPlusOnly(packId)) return "plus";
      return "buy";
    },
    [shop],
  );
}

/**
 * The picker: a tab per pack; owned packs send on tap, others show how to get them.
 * `cooldown`: seconds left before the next send (0 = ready).
 */
export function ChatPicker({ onPick, cooldown = 0, onClose }: { onPick: (pack: ChatPack, item: ChatItem) => void; cooldown?: number; onClose?: () => void }) {
  const packs = useChatPacks();
  const access = usePackAccess();
  const shop = useShop();
  const { user } = useAuthContext();
  const off = useChatOff();
  const visible = packs.filter((p) => access(p.id) !== "off");
  const [tab, setTab] = useState(visible[0]?.id ?? "chat:emoji");
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const pack = visible.find((p) => p.id === tab) ?? visible[0];
  if (!pack) return null;
  const state = access(pack.id);
  const price = shop.priceOf(pack.id);

  async function buy() {
    if (!armed) return setArmed(true);
    setBusy(true);
    setNote("");
    try {
      await shop.buy(pack.id);
      setNote(`${pack.name} is yours!`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Couldn't buy it.");
    } finally {
      setBusy(false);
      setArmed(false);
    }
  }

  return (
    <div className="chp" role="dialog" aria-label="Send a message">
      <div className="chp-tabs" role="tablist">
        {visible.map((p) => {
          const st = access(p.id);
          const sample = p.items[0];
          return (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={p.id === pack.id}
              className={`chp-tab${p.id === pack.id ? " on" : ""}${st !== "owned" ? " locked" : ""}`}
              title={p.name}
              onClick={() => {
                setTab(p.id);
                setArmed(false);
                setNote("");
              }}
            >
              {p.kind === "phrase" ? "Aa" : p.kind === "image" ? <img src={sample?.art} alt="" /> : p.kind === "sticker" ? sample?.art : sample?.text}
              {st === "plus" ? <i className="chp-tab-tag">⭐</i> : st === "buy" ? <i className="chp-tab-tag">🔒</i> : null}
            </button>
          );
        })}
      </div>

      <div className="chp-head">
        <b>{pack.name}</b>
        {cooldown > 0 ? <span className="chp-cool">wait {cooldown}s</span> : null}
        <button type="button" className="chp-off" onClick={() => setChatOff(!off)} title={off ? "Show messages from others" : "Hide messages from others"}>
          {off ? <BellOff size={15} /> : <Bell size={15} />}
          {off ? "Chat off" : "Chat on"}
        </button>
        {onClose ? (
          <button type="button" className="chp-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        ) : null}
      </div>

      <div className={`chp-grid kind-${pack.kind}${state !== "owned" ? " is-locked" : ""}`}>
        {pack.items.map((it) => (
          <button
            key={it.id}
            type="button"
            className="chp-item"
            disabled={state !== "owned" || cooldown > 0}
            onClick={() => onPick(pack, it)}
            aria-label={it.text || "sticker"}
          >
            <ChatItemView pack={pack} item={it} size="pick" />
          </button>
        ))}
      </div>

      {state === "buy" ? (
        <div className="chp-foot">
          {user ? (
            <button type="button" className={`ac-btn ac-btn-sm ac-btn-primary${armed ? " is-armed" : ""}`} disabled={busy} onClick={() => void buy()}>
              {armed ? "Confirm" : "Unlock"} · <TokenIcon size={13} /> {formatTokens(price ?? 0)}
            </button>
          ) : (
            <Link className="ac-btn ac-btn-sm" to="/login">
              Sign in to unlock
            </Link>
          )}
          <small>Buy once, keep forever.</small>
        </div>
      ) : state === "plus" ? (
        <div className="chp-foot">
          <Link className="ac-btn ac-btn-sm ac-btn-primary" to="/chips#plus">
            ⭐ Get Senevon Plus
          </Link>
          <small>Free for Plus members.</small>
        </div>
      ) : null}
      {note ? <p className="chp-note">{note}</p> : null}
    </div>
  );
}

/* ---------- friends chat: unread counts (live) ---------- */
const unreadListeners = new Set<() => void>();
export const refreshUnread = () => unreadListeners.forEach((l) => l());

/** Unread messages per friend id, kept up to date while the page is open. */
export function useChatUnread() {
  const { user } = useAuthContext();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const load = useCallback(async () => {
    if (!user || !supabase) return setCounts({});
    const { data, error } = await supabase.rpc("chat_unread");
    if (!error && data) setCounts(data as Record<string, number>);
  }, [user]);
  useEffect(() => {
    void load();
    unreadListeners.add(load);
    if (!user || !supabase) return () => void unreadListeners.delete(load);
    const ch = supabase
      .channel(`chat-unread-${user.id}-${Math.random().toString(36).slice(2, 7)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "friend_messages", filter: `to_user=eq.${user.id}` }, () => void load())
      .subscribe();
    return () => {
      unreadListeners.delete(load);
      void supabase!.removeChannel(ch);
    };
  }, [user, load]);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { counts, total };
}
