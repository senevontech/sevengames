/* A small toast when a notification arrives live (never for old ones on open: those wait in the
   bell). Hides by itself after a few seconds (paused while hovered), never blocks the page, and
   stays quiet while a game is being played (html.gp-playing) or the bell's window is open.
   Tap it to open the sender's profile (marks it read); × just dismisses (stays unread). */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { X } from "./anim-icons";
import { markRead, notifIcon, notifTarget, notifText, onNotifArrival, pageTheme, useNotifications, type Notif } from "../lib/notifications";
import { formatTokens } from "../lib/currency";
import PlayerAvatar from "./PlayerAvatar";
import "./notifications.css";

const SHOW_MS = 5500;

export default function NotifToast() {
  const { names } = useNotifications();
  const navigate = useNavigate();
  const [n, setN] = useState<Notif | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [paused, setPaused] = useState(false);
  const timer = useRef(0);

  useEffect(
    () =>
      onNotifArrival((next) => {
        const html = document.documentElement;
        if (html.classList.contains("gp-playing") || document.querySelector(".np")) return;
        setTheme(pageTheme());
        setN(next);
      }),
    [],
  );

  useEffect(() => {
    if (!n || paused) return;
    timer.current = window.setTimeout(() => setN(null), SHOW_MS);
    return () => window.clearTimeout(timer.current);
  }, [n, paused]);

  if (!n) return null;
  const from = n.from_user ? names.get(n.from_user) : undefined;
  const who = from?.name ?? "Someone";
  const open = () => {
    void markRead([n.id]);
    setN(null);
    const to = notifTarget(n);
    if (to) navigate(to);
  };

  return createPortal(
    <div className="nt" data-theme={theme} role="status" aria-live="polite" onPointerEnter={() => setPaused(true)} onPointerLeave={() => setPaused(false)}>
      <button type="button" className="nt-main" onClick={open}>
        <span className="np-av">
          {from ? <PlayerAvatar id={from.id} name={from.name} avatar={from.avatar} size={36} /> : <span className="np-av-blank" />}
          <span className="np-kind" aria-hidden="true">
            {notifIcon(n.kind)}
          </span>
        </span>
        <span className="nt-text">
          {notifText(n, who)}
          {n.kind === "gift" ? <b> · +{formatTokens(n.amount ?? 0)} chips</b> : null}
        </span>
      </button>
      <button type="button" className="nt-x" onClick={() => setN(null)} aria-label="Dismiss">
        <X size={16} />
      </button>
    </div>,
    document.body,
  );
}
