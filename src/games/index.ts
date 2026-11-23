/* The game registry. Every game is its own download, fetched the first time it's opened (or
   ahead of time by preloadGame), so the home page doesn't download and parse all of them. In the
   app the chunks ship inside the APK, so this works offline too. */
import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { GameEngine } from "../catalog";

export { shuffle, formatTime } from "./util";

export type GameProps = {
  /** Call once when the round ends with the final score (or time in seconds for timed games). */
  onFinish: (score: number) => void;
};

type Loader<P> = () => Promise<{ default: ComponentType<P> }>;

const loaders: Record<GameEngine, Loader<GameProps>> = {
  tictactoe: () => import("./tictactoe"),
  memory: () => import("./memory"),
  reflex: () => import("./reflex"),
  simon: () => import("./simon"),
  "2048": () => import("./merge"),
  minesweeper: () => import("./minesweeper"),
  hangman: () => import("./hangman"),
  quiz: () => import("./quiz"),
  math: () => import("./math"),
  word: () => import("./word"),
  "higher-lower": () => import("./higher-lower"),
  "whack-a-mole": () => import("./whack-a-mole"),
  "color-match": () => import("./color-match"),
  "sliding-puzzle": () => import("./sliding-puzzle"),
  snake: () => import("./snake"),
  carrom: () => import("./carrom/index"),
  stack: () => import("./stack"),
  dodge: () => import("./dodge"),
  "connect-four": () => import("./connect-four"),
  "lights-out": () => import("./lights-out"),
  arrows: () => import("./arrowsGame"),
  chess: () => import("./chess/index"),
  ludo: () => import("./ludo/index"),
  blackjack: () => import("./blackjack/index"),
};

const previewLoaders: Partial<Record<GameEngine, Loader<object>>> = {
  carrom: () => import("./carrom/Preview"),
  arrows: () => import("./arrowsGame").then((m) => ({ default: m.ArrowsPreview })),
};

export const engines = Object.fromEntries(
  Object.entries(loaders).map(([k, load]) => [k, lazy(load)]),
) as Record<GameEngine, LazyExoticComponent<ComponentType<GameProps>>>;

/** What to show behind the premium "Start game" bar (default: the game's own start screen, inert). */
export const previews = Object.fromEntries(
  Object.entries(previewLoaders).map(([k, load]) => [k, lazy(load!)]),
) as Partial<Record<GameEngine, LazyExoticComponent<ComponentType<object>>>>;

/** Start downloading a game's code ahead of time (e.g. when its disk is touched). */
export function preloadGame(engine: string | undefined) {
  if (!engine) return;
  void loaders[engine as GameEngine]?.().catch(() => {});
  void previewLoaders[engine as GameEngine]?.().catch(() => {});
}
