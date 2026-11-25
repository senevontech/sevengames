import { lazy, Suspense, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import ShopSection from "./ShopSection";
import "./shop.css";

const ChatPackShop = lazy(() => import("./chat/ChatPackShop"));

/* Only site-wide items here. Each game's items (styles, boards, cues, boosters…) are sold in that
   game's own Shop (games/gameShop.tsx), not on this page. */
type HubTab = "frames" | "chat";

const TABS: { id: HubTab; label: string }[] = [
  { id: "frames", label: "Avatar frames" },
  { id: "chat", label: "Chat packs" },
];

const KEY = "senevon:shop-hub-tab";
const isTab = (v: unknown): v is HubTab => TABS.some((t) => t.id === v);

function initialTab(hash: string): HubTab {
  // "/chips#shop-chess" opens that game's shop
  const fromHash = hash.startsWith("#shop-") ? hash.slice(6) : null;
  if (isTab(fromHash)) return fromHash;
  try {
    const saved = localStorage.getItem(KEY);
    if (isTab(saved)) return saved;
  } catch {
    /* storage blocked */
  }
  return "frames";
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
          <p className="ac-sub">Avatar frames and chat packs, used across every game. Game styles and boosters are in each game's own Shop.</p>
        </div>
      </div>

      <div className="shop-hub-picker" role="tablist" aria-label="Shop sections">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? "active" : ""} onClick={() => pick(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="shop-hub-body" role="tabpanel">
        {tab === "chat" ? (
          <Suspense fallback={<p className="ac-sub">Opening chat packs…</p>}>
            <ChatPackShop />
          </Suspense>
        ) : (
          <ShopSection key={tab} scope="frames" embedded />
        )}
      </div>
    </section>
  );
}
