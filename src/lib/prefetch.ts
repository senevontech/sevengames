/* Fetch code before it's needed, so opening a page or a game feels instant even though each one
   is its own download. Importing the same module twice reuses the first download. */
import { getGame } from "../catalog";
import { preloadGame } from "../games";

const prefetchGamePage = () => import("../pages/GamePage").catch(() => {});
const prefetchCategoryPage = () => import("../pages/CategoryPage").catch(() => {});

/** A game's page and code (call on touch / hover, before the click lands). */
export function prefetchGame(id: string | undefined) {
  void prefetchGamePage();
  const game = getGame(id);
  if (game?.kind === "builtin") preloadGame(game.engine);
}

/** Once the page has settled: the game page (without any game) and the category page. */
export function prefetchWhenIdle() {
  const run = () => {
    void prefetchGamePage();
    void prefetchCategoryPage();
  };
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(run, { timeout: 4000 });
  else window.setTimeout(run, 2500);
}

/** Event delegation: prefetch whichever game / category link the pointer goes down on (or hovers). */
export function prefetchFromEvent(e: { target: EventTarget | null }) {
  const a = (e.target as Element | null)?.closest?.('a[href^="/game/"], a[href^="/category/"]');
  const href = a?.getAttribute("href");
  if (!href) return;
  if (href.startsWith("/game/")) prefetchGame(href.slice("/game/".length));
  else void prefetchCategoryPage();
}
