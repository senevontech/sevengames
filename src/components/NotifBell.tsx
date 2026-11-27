/* The nav bell: unread badge; opens the notification window (a dropdown on wide screens, a
   bottom sheet on phones). The window's code is its own small download, fetched on first open
   (or when the pointer comes near the bell). Signed-out players see no bell. */
import { lazy, Suspense, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { useAuthContext } from "../context/AuthContext";
import { useUnreadCount } from "../lib/notifications";
import "./notifications.css";

const loadPanel = () => import("./NotifPanel");
const NotifPanel = lazy(loadPanel);

export default function NotifBell({ className = "", size = 19 }: { className?: string; size?: number }) {
  const { user } = useAuthContext();
  const unread = useUnreadCount();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  if (!user) return null;

  const label = unread ? `Notifications, ${unread} unread` : "Notifications";
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`nb-bell ${className}`.trim()}
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onPointerEnter={() => void loadPanel()}
        onClick={() => setOpen((o) => !o)}
      >
        <Bell size={size} strokeWidth={1.8} aria-hidden="true" />
        {unread ? <span className="nb-badge">{unread > 9 ? "9+" : unread}</span> : null}
      </button>
      {open ? (
        <Suspense fallback={null}>
          <NotifPanel anchor={btnRef} onClose={() => setOpen(false)} />
        </Suspense>
      ) : null}
    </>
  );
}
