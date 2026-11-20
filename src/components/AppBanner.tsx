/* Thin "Get the app" bar for Android visitors on the WEBSITE (never inside the app).
   Hidden on the download page itself and inside games; closing it is remembered. */
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { X } from "lucide-react";
import { isNative } from "../lib/native";
import { GET_APP_PATH, isAndroidBrowser } from "../lib/appLinks";
import "./app-banner.css";

const KEY = "senevon:appBanner";

function dismissedRecently() {
  try {
    const t = Number(localStorage.getItem(KEY) || 0);
    return Date.now() - t < 14 * 24 * 3600 * 1000; // ask again after two weeks
  } catch {
    return false;
  }
}

export default function AppBanner() {
  const { pathname } = useLocation();
  const [hidden, setHidden] = useState(() => isNative || !isAndroidBrowser() || dismissedRecently());
  if (hidden || pathname === GET_APP_PATH || pathname.startsWith("/game/") || pathname.startsWith("/admin")) return null;

  const close = () => {
    setHidden(true);
    try {
      localStorage.setItem(KEY, String(Date.now()));
    } catch {
      /* not remembered */
    }
  };

  return (
    <div className="appbar" role="region" aria-label="Get the app">
      <img src="/logo/icon-192.png" width={36} height={36} alt="" className="appbar-icon" />
      <span className="appbar-text">
        <b>Senevon app</b>
        <small>Faster, full screen, plays offline</small>
      </span>
      <Link to={GET_APP_PATH} className="appbar-get" onClick={close}>
        Get
      </Link>
      <button type="button" className="appbar-close" aria-label="Close" onClick={close}>
        <X size={16} />
      </button>
    </div>
  );
}
