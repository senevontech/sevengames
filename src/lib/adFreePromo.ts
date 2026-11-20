/* "Go ad-free" popup: when it may open on its own.
   Automatic prompts (after a finished game, after a reward ad) show at most once a day, and
   stay quiet for a week after "No thanks". Opening it from settings always works.
   The popup itself (components/AdFreePromo.tsx) also skips players who are already ad-free. */

export type PromoSource = "game_end" | "reward_ad" | "settings";

const KEY = "senevon:adfree-promo";
const DAY = 24 * 60 * 60 * 1000;
const SNOOZE = 7 * DAY;

type State = { last: number; snooze: number };

function read(): State {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<State>;
    return { last: Number(s.last) || 0, snooze: Number(s.snooze) || 0 };
  } catch {
    return { last: 0, snooze: 0 };
  }
}

function write(s: State) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage blocked: the limit just doesn't carry over to the next visit */
  }
}

/** May an automatic prompt show now? */
export function promoDue(now = Date.now()) {
  const s = read();
  return now - s.last >= DAY && now >= s.snooze;
}

export function markPromoShown() {
  write({ ...read(), last: Date.now() });
}

/** "No thanks": no automatic prompts for a week. */
export function snoozePromo() {
  write({ ...read(), snooze: Date.now() + SNOOZE });
}

type Listener = (source: PromoSource) => void;
let listener: Listener | null = null;

/** Used by the mounted popup to receive requests. */
export function onAdFreePromo(fn: Listener) {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}

/** Ask for the popup, optionally after a delay (so a result screen shows first). */
export function promptAdFree(source: PromoSource, delayMs = 0) {
  if (source !== "settings" && !promoDue()) return;
  if (delayMs > 0) window.setTimeout(() => listener?.(source), delayMs);
  else listener?.(source);
}
