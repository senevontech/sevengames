/* Each game's own shop, opened from anywhere inside the game (its start screen, its result
   screen) as a full-screen sheet. The game page provides it (GameShopProvider) for the game it
   shows; games that sell nothing get no shop, and useGameShop() returns null for them.
   Carrom draws the sheet itself (useCustomGameShop) because its progress lives in the game. */
import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ShoppingBag } from "../components/anim-icons";
import ShopSheet from "../components/ShopSheet";
import type { ShopScope } from "../components/ShopSection";

const ShopSection = lazy(() => import("../components/ShopSection"));

/** Which engine sells what. Add a game here (and its ShopSection scope) to give it a shop. */
export const GAME_SHOPS: Partial<Record<string, { scope: ShopScope | "carrom"; title: string }>> = {
  arrows: { scope: "arrows", title: "Arrows shop" },
  chess: { scope: "chess", title: "Chess shop" },
  ludo: { scope: "ludo", title: "Ludo shop" },
  pool: { scope: "pool", title: "Pool shop" },
  tune: { scope: "tune", title: "Music shop" },
  carrom: { scope: "carrom", title: "Carrom shop" },
};

type Ctx = {
  title: string;
  accent?: string;
  isOpen: boolean;
  open: () => void;
  close: () => void;
  setCustom: (on: boolean) => void;
};

const GameShopContext = createContext<Ctx | null>(null);

/** This game's shop, or null when it has none (or the game runs outside a game page). */
export function useGameShop() {
  return useContext(GameShopContext);
}

/** For a game that renders the sheet's content itself: the provider then draws nothing. */
export function useCustomGameShop() {
  const ctx = useContext(GameShopContext);
  const setCustom = ctx?.setCustom;
  useEffect(() => {
    if (!setCustom) return;
    setCustom(true);
    return () => setCustom(false);
  }, [setCustom]);
  return ctx;
}

export function GameShopProvider({ engine, accent, children }: { engine: string; accent?: string; children: ReactNode }) {
  const conf = GAME_SHOPS[engine];
  const [isOpen, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const open = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);
  // a different game: start closed
  useEffect(() => setOpen(false), [engine]);

  const value = useMemo<Ctx | null>(
    () => (conf ? { title: conf.title, accent, isOpen, open, close, setCustom } : null),
    [conf, accent, isOpen, open, close],
  );

  return (
    <GameShopContext.Provider value={value}>
      {children}
      {conf && isOpen && !custom && conf.scope !== "carrom" ? (
        <ShopSheet title={conf.title} accent={accent} onClose={close}>
          <Suspense fallback={<p className="ss-loading">Opening the shop…</p>}>
            <div className="acct">
              <ShopSection scope={conf.scope} embedded />
            </div>
          </Suspense>
        </ShopSheet>
      ) : null}
    </GameShopContext.Provider>
  );
}

/** A "Shop" button for result / end screens; renders nothing when the game has no shop. */
export function GameShopButton({ className = "ghost-btn", onOpen }: { className?: string; onOpen?: () => void }) {
  const shop = useGameShop();
  if (!shop) return null;
  return (
    <button
      type="button"
      className={`gs-btn ${className}`}
      onClick={() => {
        onOpen?.();
        shop.open();
      }}
    >
      <ShoppingBag size={16} aria-hidden="true" /> Shop
    </button>
  );
}
