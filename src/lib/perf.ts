/* Lite mode: a lighter site for low-end phones.
   Auto (default): on when the device looks weak (4 cores or fewer, 2 GB of memory or less, data
   saver on), or when a short frame-rate check after the first load finds the page running below
   ~35 fps (remembered for next time). The player can force it on or off on the profile page.

   html.is-lite turns off blur and decorative loops (src/lite.css); code asks isLite() for the
   rest (Senevi's quality, canvas pixel ratio, the 3D chip). */
import { useSyncExternalStore } from "react";

export type PerfChoice = "auto" | "lite" | "full";
const KEY = "sg-perf"; // the player's choice
const AUTO_KEY = "sg-perf-auto"; // "lite" once the frame-rate check found this device slow

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* private mode: this visit only */
  }
};

/** Weak hardware, from what the browser tells us. */
export function looksLowEnd() {
  const n = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  if (n.connection?.saveData) return true;
  if (typeof n.deviceMemory === "number" && n.deviceMemory <= 2) return true;
  if (typeof n.hardwareConcurrency === "number" && n.hardwareConcurrency > 0 && n.hardwareConcurrency <= 4) return true;
  return false;
}

let choice: PerfChoice = (() => {
  const v = read(KEY);
  return v === "lite" || v === "full" ? v : "auto";
})();
let autoSlow = read(AUTO_KEY) === "lite";
let lite = compute();
const listeners = new Set<() => void>();

function compute() {
  if (choice === "lite") return true;
  if (choice === "full") return false;
  return autoSlow || looksLowEnd();
}

function apply() {
  lite = compute();
  document.documentElement.classList.toggle("is-lite", lite);
  listeners.forEach((l) => l());
}

/** Lite mode is on right now. */
export const isLite = () => lite;

/** Canvas pixel ratio: the device's, capped at `max` (and at 1.5 in lite mode). */
export const capDpr = (max: number) => Math.min(window.devicePixelRatio || 1, lite ? Math.min(max, 1.5) : max);

export function getPerfChoice() {
  return choice;
}

export function setPerfChoice(next: PerfChoice) {
  choice = next;
  write(KEY, next === "auto" ? null : next);
  if (next === "auto") {
    // give the frame-rate check a fresh chance
    autoSlow = false;
    write(AUTO_KEY, null);
  }
  apply();
}

/** { lite, choice } that re-renders when either changes. */
export function usePerf() {
  const on = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => lite,
  );
  return { lite: on, choice };
}

/* After the first page has settled, watch ~2.5 s of frames. Below ~35 fps on average (and not
   because the tab was hidden), switch to lite and remember it. Runs once per visit, only on Auto. */
function frameCheck() {
  if (choice !== "auto" || lite) return;
  try {
    if (sessionStorage.getItem("sg-perf-checked")) return;
    sessionStorage.setItem("sg-perf-checked", "1");
  } catch {
    /* fine */
  }
  const start = () => {
    if (document.hidden) return;
    let frames = 0;
    let t0 = 0;
    let hiddenDuring = false;
    const onHide = () => (hiddenDuring = true);
    document.addEventListener("visibilitychange", onHide, { once: true });
    const tick = (t: number) => {
      if (!t0) t0 = t;
      frames++;
      if (t - t0 < 2500) return void requestAnimationFrame(tick);
      document.removeEventListener("visibilitychange", onHide);
      const fps = ((frames - 1) * 1000) / (t - t0);
      if (!hiddenDuring && fps < 35 && choice === "auto") {
        autoSlow = true;
        write(AUTO_KEY, "lite");
        apply();
      }
    };
    requestAnimationFrame(tick);
  };
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  window.setTimeout(() => (idle ? idle(start, { timeout: 3000 }) : start()), 4000);
}

let started = false;
/** Call once at start-up (main.tsx). */
export function initPerf() {
  if (started) return;
  started = true;
  apply();
  frameCheck();
}
