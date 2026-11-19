/* Online / offline status. In the app it comes from the Network plugin (more reliable than
   the browser's navigator.onLine inside a WebView); on the web from the browser's events. */
import { useSyncExternalStore } from "react";
import { Capacitor } from "@capacitor/core";
import { Network } from "@capacitor/network";

let online = typeof navigator === "undefined" ? true : navigator.onLine;
const listeners = new Set<() => void>();
const set = (v: boolean) => {
  if (v === online) return;
  online = v;
  listeners.forEach((l) => l());
};

if (typeof window !== "undefined") {
  window.addEventListener("online", () => set(true));
  window.addEventListener("offline", () => set(false));
  if (Capacitor.isNativePlatform()) {
    void Network.getStatus().then((s) => set(s.connected));
    void Network.addListener("networkStatusChange", (s) => set(s.connected));
  }
}

export const isOnline = () => online;

export function onOnlineChange(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useOnline() {
  return useSyncExternalStore(onOnlineChange, isOnline, () => true);
}

/** True for a failed request because there was no connection (as opposed to a server error). */
export function isNetworkError(err: unknown) {
  const msg = (err as { message?: string })?.message ?? String(err ?? "");
  return !online || /Failed to fetch|NetworkError|Load failed|network request failed|fetch failed/i.test(msg);
}
