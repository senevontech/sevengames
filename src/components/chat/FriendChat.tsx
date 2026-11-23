/* Friends chat: the conversation with one friend (last 100 messages), sent with pack items only.
   New messages arrive live; opening it marks them read. Block / unblock stops their messages. */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ShieldBan } from "lucide-react";
import PlayerAvatar from "../PlayerAvatar";
import { supabase } from "../../supabase";
import { useAuthContext } from "../../context/AuthContext";
import { chatErrorText, findItem, useChatPacks } from "../../lib/chatPacks";
import type { MiniPlayer } from "../../lib/social";
import { ChatItemView, ChatPicker, refreshUnread } from "./ChatKit";

type Msg = { id: number; mine: boolean; pack: string; item: string; at: string };

export default function FriendChat({ friend, onClose }: { friend: MiniPlayer; onClose: () => void }) {
  const { user } = useAuthContext();
  const packs = useChatPacks();
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [err, setErr] = useState("");
  const [cool, setCool] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.rpc("chat_thread", { p_other: friend.id });
    if (error) return setErr(chatErrorText(error));
    const r = data as { blocked: boolean; messages: Msg[] };
    setMsgs(r.messages);
    setBlocked(r.blocked);
    refreshUnread();
  }, [friend.id]);

  useEffect(() => {
    void load();
    if (!supabase || !user) return;
    const ch = supabase
      .channel(`fchat-${user.id}-${friend.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "friend_messages", filter: `to_user=eq.${user.id}` }, (p) => {
        if ((p.new as { from_user?: string }).from_user === friend.id) void load();
      })
      .subscribe();
    return () => void supabase!.removeChannel(ch);
  }, [load, user, friend.id]);

  useEffect(() => endRef.current?.scrollIntoView({ block: "end" }), [msgs]);

  useEffect(() => {
    if (cool <= 0) return;
    const t = window.setTimeout(() => setCool((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cool]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function send(pack: string, item: string) {
    if (!supabase) return;
    setErr("");
    setCool(3);
    // show it straight away
    setMsgs((cur) => [...(cur ?? []), { id: -Date.now(), mine: true, pack, item, at: new Date().toISOString() }]);
    const { error } = await supabase.rpc("chat_send", { p_to: friend.id, p_pack: pack, p_item: item });
    if (error) setErr(chatErrorText(error));
    void load();
  }

  async function toggleBlock() {
    if (!supabase) return;
    const { error } = await supabase.rpc("chat_block", { p_other: friend.id, p_block: !blocked });
    if (error) return setErr(chatErrorText(error));
    setBlocked(!blocked);
    refreshUnread();
  }

  const host = document.querySelector(".site") ?? document.body;
  return createPortal(
    <div className="fc" role="dialog" aria-label={`Chat with ${friend.name}`} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="fc-panel acct">
        <header className="fc-head">
          <button type="button" className="fc-back" onClick={onClose} aria-label="Close chat">
            <ChevronLeft size={18} />
          </button>
          <PlayerAvatar id={friend.id} name={friend.name} avatar={friend.avatar} size={32} />
          <b>{friend.name}</b>
          <button type="button" className={`fc-block${blocked ? " on" : ""}`} onClick={() => void toggleBlock()} title={blocked ? "Unblock" : "Block messages"}>
            <ShieldBan size={15} /> {blocked ? "Blocked" : "Block"}
          </button>
        </header>

        <div className="fc-body">
          {msgs === null ? <p className="fc-empty">{err || "Loading…"}</p> : null}
          {msgs?.length === 0 ? <p className="fc-empty">Say hi with a sticker 👋</p> : null}
          {msgs?.map((m) => {
            const found = findItem(packs, m.pack, m.item);
            return (
              <div key={m.id} className={`fc-msg${m.mine ? " is-mine" : ""}`}>
                {found ? <ChatItemView pack={found.pack} item={found.item} /> : <span className="fc-unknown">(sticker)</span>}
                <time>{new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
              </div>
            );
          })}
          <div ref={endRef} />
        </div>

        {err && msgs ? <p className="fc-err">{err}</p> : null}
        {blocked ? (
          <p className="fc-empty">You've blocked {friend.name}'s messages.</p>
        ) : (
          <div className="fc-picker">
            <ChatPicker cooldown={cool} onPick={(pack, item) => void send(pack.id, item.id)} />
          </div>
        )}
      </div>
    </div>,
    host,
  );
}
