/* Popup when someone gifts you chips, sends a friend request or follows you.
   Server side: supabase/notifications.sql (triggers write the rows; new ones arrive live, and any
   not yet seen pop up the next time the site opens). One popup at a time; while a game is being
   played (html.gp-playing) they wait until the game ends. */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import { supabase } from "../supabase";
import { useAuthContext } from "../context/AuthContext";
import { useTokens } from "../lib/tokens";
import { namesFor, respondToRequest, type MiniPlayer } from "../lib/social";
import { formatTokens } from "../lib/currency";
import PlayerAvatar from "./PlayerAvatar";
import TokenIcon from "./TokenIcon";
import "./player-card.css";
import "./social-alerts.css";

type Notif = {
  id: number;
  kind: "gift" | "friend_request" | "follow";
  from_user: string | null;
  amount: number | null;
  note: string | null;
  ref: number | null;
  created_at: string;
};

const COLS = "id, kind, from_user, amount, note, ref, created_at";

/** True while a game is being played (the game page sets html.gp-playing). */
function usePlaying() {
  const [playing, setPlaying] = useState(() => document.documentElement.classList.contains("gp-playing"));
  useEffect(() => {
    const el = document.documentElement;
    const mo = new MutationObserver(() => setPlaying(el.classList.contains("gp-playing")));
    mo.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);
  return playing;
}

export default function SocialAlerts() {
  const { user } = useAuthContext();
  const { refresh } = useTokens();
  const navigate = useNavigate();
  const playing = usePlaying();
  const [queue, setQueue] = useState<Notif[]>([]);
  const [names, setNames] = useState<Map<string, MiniPlayer>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  const add = useCallback((rows: Notif[]) => {
    if (!rows.length) return;
    setQueue((q) => {
      const have = new Set(q.map((n) => n.id));
      return [...q, ...rows.filter((r) => !have.has(r.id))];
    });
    if (rows.some((r) => r.kind === "gift")) void refreshRef.current();
  }, []);

  // unseen ones on sign-in, then live
  useEffect(() => {
    setQueue([]);
    if (!user || !supabase) return;
    const db = supabase;
    let live = true;
    void db
      .from("notifications")
      .select(COLS)
      .eq("user_id", user.id)
      .eq("seen", false)
      .order("created_at", { ascending: true })
      .limit(20)
      .then(({ data }) => {
        if (live && data) add(data as Notif[]);
      });
    const ch = db
      .channel(`notif-${user.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` }, (p) =>
        add([p.new as Notif]),
      )
      .subscribe();
    return () => {
      live = false;
      void db.removeChannel(ch);
    };
  }, [user, add]);

  // names + avatars of the senders
  useEffect(() => {
    const missing = [...new Set(queue.map((n) => n.from_user).filter((id): id is string => Boolean(id) && !names.has(id!)))];
    if (!missing.length) return;
    void namesFor(missing).then((m) => setNames((prev) => new Map([...prev, ...m])));
  }, [queue, names]);

  const current = queue[0];

  const close = useCallback(
    (all = false) => {
      const ids = all ? queue.map((n) => n.id) : current ? [current.id] : [];
      if (!ids.length) return;
      setError(null);
      setQueue((q) => q.filter((n) => !ids.includes(n.id)));
      if (supabase) void supabase.rpc("notif_seen", { p_ids: ids });
    },
    [queue, current],
  );

  useEffect(() => {
    if (!current || playing) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, playing, close]);

  if (!user || !current || playing) return null;
  const from = current.from_user ? names.get(current.from_user) : undefined;
  if (current.from_user && !from) return null; // name still loading
  const who = from?.name ?? "Someone";

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      close();
    } catch (e) {
      setError((e as Error).message || "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const viewProfile = () => {
    const id = current.from_user;
    close();
    if (id) navigate(`/player/${id}`);
  };

  const followBack = () =>
    act(async () => {
      if (!supabase || !current.from_user) return;
      const { error: err } = await supabase.from("follows").insert({ follower: user.id, followee: current.from_user });
      if (err && err.code !== "23505") throw new Error("Couldn't follow back. Please try again."); // 23505: already following
    });

  let icon = "👋";
  let title = `${who} started following you`;
  let body: React.ReactNode = null;
  let actions: React.ReactNode;

  if (current.kind === "gift") {
    icon = "🎁";
    title = `${who} sent you a gift`;
    body = (
      <>
        <p className="sa-chips">
          <TokenIcon size={26} />
          <b>+{formatTokens(current.amount ?? 0)}</b>
          <small>chips</small>
        </p>
        {current.note ? <p className="sa-note">“{current.note}”</p> : null}
      </>
    );
    actions = (
      <>
        <button type="button" className="pc-btn" onClick={viewProfile}>
          View profile
        </button>
        <button type="button" className="pc-btn pc-primary" onClick={() => close()}>
          Thanks!
        </button>
      </>
    );
  } else if (current.kind === "friend_request") {
    icon = "🤝";
    title = `${who} wants to be your friend`;
    actions = (
      <>
        <button type="button" className="pc-btn" disabled={busy || !current.ref} onClick={() => void act(() => respondToRequest(current.ref!, false))}>
          Decline
        </button>
        <button type="button" className="pc-btn pc-primary" disabled={busy || !current.ref} onClick={() => void act(() => respondToRequest(current.ref!, true))}>
          Accept
        </button>
        <button type="button" className="pc-btn sa-wide" onClick={viewProfile}>
          View profile
        </button>
      </>
    );
  } else {
    actions = (
      <>
        <button type="button" className="pc-btn" onClick={() => close()}>
          OK
        </button>
        <button type="button" className="pc-btn pc-primary" disabled={busy} onClick={() => void followBack()}>
          Follow back
        </button>
        <button type="button" className="pc-btn sa-wide" onClick={viewProfile}>
          View profile
        </button>
      </>
    );
  }

  return createPortal(
    <div className="pc-backdrop sa-backdrop" onClick={() => close()}>
      <div className="pc-card sa-card" role="alertdialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="pc-close" onClick={() => close()} aria-label="Close">
          <X size={18} />
        </button>
        <div className="pc-body sa-body">
          <div className="sa-who">
            {from ? <PlayerAvatar id={from.id} name={from.name} avatar={from.avatar} size={72} /> : null}
            <span className="sa-icon" aria-hidden="true">
              {icon}
            </span>
          </div>
          <h2 className="sa-title">{title}</h2>
          {body}
          {error ? <p className="pc-error">{error}</p> : null}
          <div className="pc-actions sa-actions">{actions}</div>
          {queue.length > 1 ? (
            <button type="button" className="sa-more" onClick={() => close(true)}>
              {queue.length - 1} more · close all
            </button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
