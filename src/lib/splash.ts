/* Talks to the splash screen in index.html: reports real loading steps so its percentage
   follows the actual load, then says when the first page is on screen (→ the arrow button). */

type SplashApi = { step: (pct: number) => void; ready: () => void };

const api = (): SplashApi | undefined => (window as unknown as { __splash?: SplashApi }).__splash;

/** Move the splash's progress up to at least `pct` (it eases there by itself). */
export const splashStep = (pct: number) => api()?.step(pct);

/**
 * Wait until the first page has really rendered — React mounted, the route's lazy code loaded
 * (no loading placeholder left) and real content present — then let the splash finish.
 * Polls lightly (every 100 ms, a couple of selector lookups) so it never competes with loading.
 */
export function splashWhenPageReady() {
  const s = api();
  if (!s) return;
  const root = document.getElementById("root");
  const started = performance.now();
  let steady = 0;
  const check = () => {
    const loaded =
      !!root &&
      root.childElementCount > 0 &&
      !root.querySelector(".page-loading") &&
      !!root.querySelector("h1, h2, h3, img, canvas, button, a");
    steady = loaded ? steady + 1 : 0;
    if (loaded) s.step(90);
    // two steady checks so a half-rendered page doesn't count; give up waiting after 8 s
    if (steady >= 2 || performance.now() - started > 8000) {
      s.step(100);
      s.ready();
      return;
    }
    window.setTimeout(check, 100);
  };
  window.setTimeout(check, 100);
}
