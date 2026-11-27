/* The notification window opened from the nav bell. Wide screens: a dropdown under the bell.
   Phones (≤600px): a bottom sheet over a dimmed page. All / Unread tabs, "Mark all read", a dot
   per row to flip read ↔ unread; tapping a row marks it read and opens the sender's profile.
   Friend requests are answered right in the row. */
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { X } from "./anim-icons";
import {
  answerRequest,
  markAllRead,
  markRead,
  markUnread,
  notifIcon,
  notifTarget,
  pageTheme,
  notifText,
  refreshRequests,
  useNotifications,
  type Notif,
  type RequestState,
} from "../lib/notifications";
import type { MiniPlayer } from "../lib/social";
import { formatTokens } from "../lib/currency";
import { timeAgo } from "../lib/recent";
import PlayerAvatar from "./PlayerAvatar";
import TokenIcon from "./TokenIcon";

const PHONE = "(max-width: 600px)";

function usePhone() {
  const [phone, setPhone] = useState(() => window.matchMedia(PHONE).matches);
  useEffect(() => {
    const mq = window.matchMedia(PHONE);
    const on = () => setPhone(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return phone;
}

export default function NotifPanel({ anchor, onClose }: { anchor: RefObject<HTMLButtonElement | null>; onClose: () => void }) {
  const { items, names, requests, loaded, failed, unread } = useNotifications();
  const navigate = useNavigate();
  const phone = usePhone();
  const [tab, setTab] = useState<"all" | "unread">("all");
  const [theme] = useState(() => pageTheme(anchor.current));
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => refreshRequests(), []);

  // dropdown: sit under the bell, right edges lined up (kept on screen)
  useLayoutEffect(() => {
    if (phone) return;
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (r) setPos({ top: Math.round(r.bottom + 10), right: Math.max(12, Math.round(window.innerWidth - r.right - 6)) });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [phone, anchor]);

  // close: Escape, a tap outside (the bell toggles itself), or a page change
  useEffect(() => {
    const bell = anchor.current;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !bell?.contains(t)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    panelRef.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      bell?.focus({ preventScroll: true });
    };
  }, [anchor, onClose]);

  // phone sheet: the page behind doesn't scroll
  useEffect(() => {
    if (!phone) return;
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      html.style.overflow = prev;
    };
  }, [phone]);

  const shown = tab === "unread" ? items.filter((n) => !n.seen) : items;

  const openItem = (n: Notif) => {
    void markRead([n.id]);
    const to = notifTarget(n);
    if (to) {
      onClose();
      navigate(to);
    }
  };

  let body;
  if (!loaded) body = <p className="np-empty">Loading…</p>;
  else if (failed && !items.length) body = <p className="np-empty">Couldn't load notifications. Check your connection.</p>;
  else if (!shown.length)
    body = (
      <p className="np-empty">
        <span aria-hidden="true">🔔</span>
        {tab === "unread" ? "You're all caught up." : "No notifications yet. Gifts, friend requests and new followers show up here."}
      </p>
    );
  else
    body = (
      <ul className="np-list">
        {shown.map((n) => (
          <Row key={n.id} n={n} from={n.from_user ? names.get(n.from_user) : undefined} req={n.ref ? requests.get(n.ref) : undefined} onOpen={openItem} />
        ))}
      </ul>
    );

  return createPortal(
    <>
      {phone ? <div className="np-scrim" aria-hidden="true" /> : null}
      <div
        ref={panelRef}
        data-theme={theme}
        className={`np ${phone ? "np-sheet" : "np-drop"}`}
        role="dialog"
        aria-label="Notifications"
        tabIndex={-1}
        style={!phone && pos ? { top: pos.top, right: pos.right } : undefined}
      >
        <header className="np-head">
          <h2>Notifications</h2>
          <button type="button" className="np-link" disabled={!unread} onClick={() => void markAllRead()}>
            Mark all read
          </button>
          {phone ? (
            <button type="button" className="np-x" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          ) : null}
        </header>
        <div className="np-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "all"} onClick={() => setTab("all")}>
            All
          </button>
          <button type="button" role="tab" aria-selected={tab === "unread"} onClick={() => setTab("unread")}>
            Unread{unread ? <span className="np-count">{unread}</span> : null}
          </button>
        </div>
        <div className="np-scroll">{body}</div>
      </div>
    </>,
    document.body,
  );
}

function Row({ n, from, req, onOpen }: { n: Notif; from?: MiniPlayer; req?: RequestState; onOpen: (n: Notif) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const who = from?.name ?? (n.from_user ? "…" : "Someone");

  const answer = async (accept: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await answerRequest(n, accept);
    } catch (e) {
      setError((e as Error).message || "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className={`np-item${n.seen ? "" : " is-unread"}`}>
      <button type="button" className="np-main" onClick={() => onOpen(n)}>
        <span className="np-av">
          {from ? <PlayerAvatar id={from.id} name={from.name} avatar={from.avatar} size={42} /> : <span className="np-av-blank" />}
          <span className="np-kind" aria-hidden="true">
            {notifIcon(n.kind)}
          </span>
        </span>
        <span className="np-text">
          <span className="np-line">{notifText(n, who)}</span>
          {n.kind === "gift" ? (
            <span className="np-gift">
              <TokenIcon size={15} /> +{formatTokens(n.amount ?? 0)} chips
            </span>
          ) : null}
          {n.note ? <span className="np-note">“{n.note}”</span> : null}
          <time className="np-time" dateTime={n.created_at}>
            {timeAgo(Date.parse(n.created_at))}
          </time>
        </span>
      </button>
      <button
        type="button"
        className="np-dot"
        aria-label={n.seen ? "Mark as unread" : "Mark as read"}
        title={n.seen ? "Mark as unread" : "Mark as read"}
        onClick={() => void (n.seen ? markUnread(n.id) : markRead([n.id]))}
      >
        <i />
      </button>
      {n.kind === "friend_request" ? (
        <div className="np-req">
          {req === "pending" ? (
            <>
              <button type="button" className="np-btn" disabled={busy} onClick={() => void answer(false)}>
                Decline
              </button>
              <button type="button" className="np-btn np-primary" disabled={busy} onClick={() => void answer(true)}>
                Accept
              </button>
            </>
          ) : req === "accepted" ? (
            <span className="np-state">✓ You're friends</span>
          ) : req === "gone" ? (
            <span className="np-state">No longer pending</span>
          ) : null}
          {error ? <span className="np-err">{error}</span> : null}
        </div>
      ) : null}
    </li>
  );
}
