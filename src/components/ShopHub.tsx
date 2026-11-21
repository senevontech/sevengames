import { lazy, Suspense, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import ShopSection, { type ShopScope } from "./ShopSection";
import "./shop.css";

/* Carrom's shop needs the Carrom game code (its items + progress): only fetched when picked */
const CarromShop = lazy(() => import("./CarromShop"));

type HubTab = ShopScope | "carrom";

const TABS: { id: HubTab; label: string }[] = [
  { id: "arrows", label: "Arrows" },
  { id: "chess", label: "Chess" },
  { id: "ludo", label: "Ludo" },
  { id: "carrom", label: "Carrom" },
  { id: "frames", label: "Avatar frames" },
];

const KEY = "senevon:shop-hub-tab";
const isTab = (v: unknown): v is HubTab => TABS.some((t) => t.id === v);

function initialTab(hash: string): HubTab {
  // "/tokens#shop-chess" opens that game's shop
  const fromHash = hash.startsWith("#shop-") ? hash.slice(6) : null;
  if (isTab(fromHash)) return fromHash;
  try {
    const saved = localStorage.getItem(KEY);
    if (isTab(saved)) return saved;
  } catch {
    /* storage blocked */
  }
  return "arrows";
}

/**
 * The Tokens page shop: every game's shop in one place, picked by game. Each section is the
 * same shop the game shows in its own Shop sheet, so items and prices always match.
 */
export default function ShopHub() {
  const { hash } = useLocation();
  const [tab, setTab] = useState<HubTab>(() => initialTab(hash));

  useEffect(() => {
    const fromHash = hash.startsWith("#shop-") ? hash.slice(6) : null;
    if (isTab(fromHash)) setTab(fromHash);
  }, [hash]);

  const pick = (t: HubTab) => {
    setTab(t);
    try {
      localStorage.setItem(KEY, t);
    } catch {
      /* not remembered */
    }
  };

  return (
    <section className="tw-section shop-hub" id="shop">
      <div className="ac-section-head">
        <div>
          <h2 className="ac-h2">Shop</h2>
          <p className="ac-sub">Styles, boosters and upgrades for each game. The same items are in every game's own Shop.</p>
        </div>
      </div>

      <div className="shop-hub-picker" role="tablist" aria-label="Choose a game">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? "active" : ""} onClick={() => pick(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="shop-hub-body" role="tabpanel">
        {tab === "carrom" ? (
          <Suspense fallback={<p className="ac-sub">Opening the Carrom shop…</p>}>
            <CarromShop />
          </Suspense>
        ) : (
          <ShopSection key={tab} scope={tab} embedded />
        )}
      </div>
    </section>
  );
}
