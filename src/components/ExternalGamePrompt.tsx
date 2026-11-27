/* Opening a web game from anywhere on Senevon (game disks, lists, search): instead of Senevon's
   game page, open the game's own site. Android players of games with an app get a choice first:
   "Open in app" or "Open in web". Mounted once in App. */
import { useEffect, useState } from "react";
import { ExternalLink, Smartphone, X } from "./anim-icons";
import { getGame } from "../catalog";
import { asksForApp, isExternal, openGameApp, openGameWeb, type ExternalGame } from "../lib/externalGames";
import { GamePoster } from "./GamePoster";
import "./external-game.css";

type AppGame = ExternalGame & { app: NonNullable<ExternalGame["app"]> };

let show: ((g: AppGame) => void) | null = null;

/** Open a web game: ask web / app where that applies, otherwise open its site now. */
export function openExternalGame(g: ExternalGame) {
  if (asksForApp(g) && show) show(g);
  else openGameWeb(g);
}

export default function ExternalGamePrompt() {
  const [game, setGame] = useState<AppGame | null>(null);

  useEffect(() => {
    show = setGame;
    return () => {
      show = null;
    };
  }, []);

  // any plain click on a link to a web game's page opens the game instead
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href^="/game/"]');
      const id = a?.getAttribute("href")?.slice("/game/".length).split(/[?#]/)[0];
      const g = getGame(id);
      if (!isExternal(g)) return;
      e.preventDefault();
      openExternalGame(g);
    };
    // bubble phase on document: runs after React's handlers (the carousel cancels clicks on
    // disks that only slide to the centre)
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  useEffect(() => {
    if (!game) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setGame(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [game]);

  if (!game) return null;
  const close = () => setGame(null);

  return (
    <div className="xg-scrim" onClick={close}>
      <div className="xg-card" role="dialog" aria-modal="true" aria-labelledby="xg-title" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="xg-close" aria-label="Close" onClick={close}>
          <X size={18} />
        </button>
        <GamePoster game={game} size="thumb" />
        <h2 id="xg-title">Open {game.title}</h2>
        <p>Play in the {game.title} app, or right away in your browser.</p>
        <button
          type="button"
          className="xg-btn xg-btn-main"
          onClick={() => {
            openGameApp(game);
            close();
          }}
        >
          <Smartphone size={18} />
          Open in app
        </button>
        <button
          type="button"
          className="xg-btn"
          onClick={() => {
            openGameWeb(game);
            close();
          }}
        >
          <ExternalLink size={18} />
          Open in web
        </button>
        <small>Don&apos;t have the app? Open in app takes you to Google Play.</small>
      </div>
    </div>
  );
}
