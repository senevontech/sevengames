/* Senevi, the Senevon game CPU: the live 3D face (three.js, loaded on demand), a fallback face
   for devices without WebGL, the event bus the games use to make him react, and his speech.

   Games don't hold a reference to him. They call `senevi({ type: "think" })` etc., and every
   Senevi on screen for that seat reacts. Lines he says go to `useSeneviLine(seat)`, so each game
   shows them inside its own player strip (never over the board). */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { SeneviInstance } from "./seneviBot";
import "./senevi.css";

export const SENEVI_NAME = "Senevi";

/* ---------- events from the games ---------- */
export type SeneviEvent =
  | { type: "start" }
  | { type: "think"; ms?: number }
  | { type: "cpuGood" }
  | { type: "playerGood" }
  | { type: "over"; result: "cpu" | "player" | "draw" };

type Detail = SeneviEvent & { seat?: string };
const bus = new EventTarget();

/** Make Senevi react. `seat`: only the Senevi in that seat (multi-CPU games); omit for all. */
export function senevi(ev: SeneviEvent, seat?: string) {
  if (ev.type === "over") recordResult(ev.result);
  bus.dispatchEvent(new CustomEvent<Detail>("e", { detail: { ...ev, seat } }));
}

/* ---------- your record against him (this device), per game ---------- */
export type SeneviRecord = Record<string, { w: number; l: number; d: number }>;
const RECORD_KEY = "senevon:senevi-record";
let lastRecord = 0;
export function readSeneviRecord(): SeneviRecord {
  try {
    return JSON.parse(localStorage.getItem(RECORD_KEY) || "{}") as SeneviRecord;
  } catch {
    return {};
  }
}
function recordResult(result: "cpu" | "player" | "draw") {
  // multi-CPU games (Ludo) end with one event per Senevi: count the match once
  if (Date.now() - lastRecord < 3000) return;
  lastRecord = Date.now();
  const game = window.location.pathname.match(/^\/game\/([^/]+)/)?.[1];
  if (!game) return;
  const rec = readSeneviRecord();
  const r = (rec[decodeURIComponent(game)] ??= { w: 0, l: 0, d: 0 });
  if (result === "player") r.w += 1;
  else if (result === "cpu") r.l += 1;
  else r.d += 1;
  try {
    localStorage.setItem(RECORD_KEY, JSON.stringify(rec));
  } catch {
    /* not saved */
  }
}

/* ---------- speech: muted switch + the latest line per seat ---------- */
const MUTE_KEY = "senevon:senevi-mute";
let muted = (() => {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
})();
const muteListeners = new Set<() => void>();
export function setSeneviMuted(on: boolean) {
  muted = on;
  try {
    localStorage.setItem(MUTE_KEY, on ? "1" : "0");
  } catch {
    /* not remembered */
  }
  muteListeners.forEach((l) => l());
}
export function useSeneviMuted() {
  return useSyncExternalStore(
    (l) => {
      muteListeners.add(l);
      return () => void muteListeners.delete(l);
    },
    () => muted,
  );
}

type Line = { text: string; key: number } | null;
const lines = new Map<string, Line>();
const lineListeners = new Set<() => void>();
let lineSeq = 0;
function publishLine(seat: string, text: string | null) {
  lines.set(seat, text ? { text, key: ++lineSeq } : null);
  lineListeners.forEach((l) => l());
}
/** What Senevi (in `seat`) is saying right now, or null. */
export function useSeneviLine(seat = "cpu") {
  return useSyncExternalStore(
    (l) => {
      lineListeners.add(l);
      return () => void lineListeners.delete(l);
    },
    () => lines.get(seat) ?? null,
  );
}

/* ---------- the four bots (set in Admin → Senevi Lab, read by everyone) ----------
   Games with one CPU use bot 1; games with several seat bots 1, 2, 3 (and 4) in order.
   Saved as the site setting "senevi_bots": [{ name, chat, config }] × 4. */
export type SeneviProfile = {
  name: string;
  /** how chatty: 0 silent … 1 normal */
  chat: number;
  /** look and motion: the bot's config (only what differs from the defaults) */
  config: Record<string, unknown>;
};
export const SENEVI_BOTS = 4;
export const DEFAULT_PROFILES: SeneviProfile[] = [
  { name: SENEVI_NAME, chat: 1, config: {} },
  { name: `${SENEVI_NAME} II`, chat: 1, config: { modeColors: ["#52d2ff", "#7cf0c4", "#bf8bff", "#ffd84a"] } },
  { name: `${SENEVI_NAME} III`, chat: 1, config: { modeColors: ["#ff7aa8", "#52d2ff", "#ffd84a", "#bf8bff"] } },
  { name: `${SENEVI_NAME} IV`, chat: 1, config: { modeColors: ["#9dff6a", "#52d2ff", "#bf8bff", "#ffd84a"] } },
];
export function cleanProfiles(raw: unknown): SeneviProfile[] {
  const list = Array.isArray(raw) ? raw : [];
  return DEFAULT_PROFILES.map((d, i) => {
    const r = (list[i] ?? {}) as Partial<SeneviProfile>;
    return {
      name: typeof r.name === "string" && r.name.trim() ? r.name.trim().slice(0, 24) : d.name,
      chat: typeof r.chat === "number" ? Math.max(0, Math.min(1, r.chat)) : d.chat,
      config: r.config && typeof r.config === "object" ? (r.config as Record<string, unknown>) : d.config,
    };
  });
}
let profiles: SeneviProfile[] = DEFAULT_PROFILES;
let profilesLoaded: Promise<SeneviProfile[]> | null = null;
const profileListeners = new Set<() => void>();
export function loadSeneviProfiles() {
  profilesLoaded ??= import("../lib/siteSettings")
    .then((m) => m.loadSettings())
    .then((s) => {
      profiles = cleanProfiles((s as unknown as Record<string, unknown>).senevi_bots);
      profileListeners.forEach((l) => l());
      return profiles;
    })
    .catch(() => profiles);
  return profilesLoaded;
}
/** bot n (1–4); bots past 4 reuse them */
export const seneviProfile = (n: number) => profiles[(Math.max(1, Math.floor(n)) - 1) % SENEVI_BOTS];
/** the name of CPU bot n (1–4) as set in Admin */
export function seneviBotName(n: number) {
  return seneviProfile(n).name;
}
export function useSeneviProfiles() {
  useEffect(() => void loadSeneviProfiles(), []);
  return useSyncExternalStore(
    (l) => {
      profileListeners.add(l);
      return () => void profileListeners.delete(l);
    },
    () => profiles,
  );
}

/* ---------- the face ---------- */
let modPromise: Promise<typeof import("./seneviBot").default> | null = null;
const loadBot = () => (modPromise ??= import("./seneviBot.js").then((m) => m.default));

type FaceProps = {
  /** Size of the head in px (the canvas spills a little past it, transparently). */
  size: number;
  /** "head" in games; "full" (head + body) on his page. */
  body?: "head" | "full";
  /** Which CPU seat this is (multi-CPU games). */
  seat?: string;
  /** Chatty: greets and tells the odd joke (lines go to useSeneviLine). */
  speech?: boolean;
  className?: string;
  /** Called once the bot exists (his page uses it for the expression buttons). */
  onReady?: (bot: SeneviInstance) => void;
  /** which of the four bots (1–4, set in Admin → Senevi Lab); default 1 */
  bot?: number;
  /** a small extra face (e.g. a row of them): fewer LEDs, a lower pixel ratio, gentler motion */
  lowPower?: boolean;
};

export function SeneviFace({ size, body = "head", seat = "cpu", speech = true, className = "", onReady, bot: botNo = 1, lowPower = false }: FaceProps) {
  const host = useRef<HTMLDivElement>(null);
  const [fallback, setFallback] = useState(false);
  const isMuted = useSeneviMuted();
  const speak = speech && !isMuted;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    let bot: SeneviInstance | null = null;
    let gone = false;
    let clearT = 0;
    const onSay = (text: string) => {
      publishLine(seat, text);
      window.clearTimeout(clearT);
      clearT = window.setTimeout(() => publishLine(seat, null), Math.min(6000, 2600 + text.length * 50));
    };
    Promise.all([loadBot(), loadSeneviProfiles()])
      .then(([Senevi]) => {
        if (gone || !host.current) return;
        if (!Senevi.isSupported()) return setFallback(true);
        const small = size < 90;
        const prof = seneviProfile(botNo);
        const cols = Number(prof.config.cols) || 58;
        bot = Senevi.create(host.current, {
          speech: speak && prof.chat > 0,
          onSay: (text) => {
            // a quieter bot keeps most of his lines to himself
            if (prof.chat >= 1 || Math.random() < prof.chat) onSay(text);
          },
          config: {
            ...prof.config,
            body,
            // tiny heads: fewer, bigger LEDs read better and cost less
            ...(small ? { cols: Math.min(cols, 40), maxDpr: 2, bob: Math.min(Number(prof.config.bob ?? 0.4), 0.25) } : {}),
            ...(lowPower ? { cols: Math.min(cols, 34), maxDpr: Math.min(1.5, window.devicePixelRatio || 1), glowRadius: 2, flicker: 0, scanOnChange: false } : {}),
            ...(body === "full" ? { zoom: 0.9 } : {}),
          },
        });
        onReadyRef.current?.(bot);
      })
      .catch(() => !gone && setFallback(true));

    const onEvent = (e: Event) => {
      const d = (e as CustomEvent<Detail>).detail;
      if (!bot || bot.destroyed || (d.seat && d.seat !== seat)) return;
      if (d.type === "start") bot.gameStart();
      else if (d.type === "think") bot.thinkTurn(d.ms);
      else if (d.type === "cpuGood") bot.cpuGood();
      else if (d.type === "playerGood") bot.playerGood();
      else if (d.type === "over") bot.gameOver(d.result);
    };
    bus.addEventListener("e", onEvent);
    return () => {
      gone = true;
      window.clearTimeout(clearT);
      bus.removeEventListener("e", onEvent);
      bot?.destroy();
      publishLine(seat, null);
      if (host.current) host.current.innerHTML = "";
    };
  }, [size, body, seat, speak, botNo, lowPower]);

  return (
    <span className={`snv-face${body === "full" ? " is-full" : ""} ${className}`} style={{ width: size, height: size }} aria-label={SENEVI_NAME} role="img">
      {fallback ? (
        <span className="snv-fallback" aria-hidden="true">
          <i />
          <i />
          <b />
        </span>
      ) : (
        <span ref={host} className="snv-host" />
      )}
    </span>
  );
}

/** His latest line, for a game's player strip (fades in and out; takes no space when quiet). */
export function SeneviLine({ seat = "cpu", className = "" }: { seat?: string; className?: string }) {
  const line = useSeneviLine(seat);
  if (!line) return null;
  return (
    <span key={line.key} className={`snv-line ${className}`} role="status" aria-live="polite">
      {line.text}
    </span>
  );
}

/**
 * A compact "Senevi" card (face + name + what he's saying) for games that had no opponent strip
 * (Noughts, Connect Four). Sits above the board, in the page flow.
 */
export function SeneviCard({ status, seat = "cpu" }: { status?: string; seat?: string }) {
  const line = useSeneviLine(seat);
  return (
    <div className="snv-card">
      <SeneviFace size={40} seat={seat} />
      <div className="snv-card-text">
        <b>
          {SENEVI_NAME} <small>AI</small>
        </b>
        {line ? <SeneviLine seat={seat} /> : status ? <span className="snv-card-status">{status}</span> : null}
      </div>
    </div>
  );
}

/**
 * Senevi as a small flat icon (his dark dome, LED eyes and smile) for buttons, menus and labels,
 * where a live 3D Senevi would be too much. Same size API as a lucide icon.
 */
export function SeneviIcon({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg className={`snv-icon ${className}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="snv-dome" cx="38%" cy="30%" r="75%">
          <stop offset="0" stopColor="#5a5e68" />
          <stop offset="0.6" stopColor="#1b1c21" />
          <stop offset="1" stopColor="#0c0d10" />
        </radialGradient>
      </defs>
      <circle cx="12" cy="12" r="11" fill="url(#snv-dome)" />
      <ellipse cx="8.4" cy="6.4" rx="3.6" ry="1.6" fill="#fff" opacity="0.18" transform="rotate(-24 8.4 6.4)" />
      <rect x="7" y="8.6" width="3" height="5" rx="1.4" fill="#ffaa45" />
      <rect x="14" y="8.6" width="3" height="5" rx="1.4" fill="#ffaa45" />
      <path d="M9.2 16.2 Q12 18 14.8 16.2" stroke="#ffaa45" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </svg>
  );
}
