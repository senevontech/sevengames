import { useState } from "react";
import { Link } from "react-router-dom";
import { Check } from "lucide-react";
import TokenIcon from "./TokenIcon";
import { useAuthContext } from "../context/AuthContext";
import { useAvatar } from "../lib/avatar";
import { formatTokens } from "../lib/currency";
import { useShop } from "../lib/shop";
import { useTokens } from "../lib/tokens";
import { ARROW_FX, ARROW_SKINS, BOOSTERS, FRAMES, frameClass, type ShopSlot } from "../lib/shopCatalog";
import "./shop.css";

type Tab = "skins" | "fx" | "frames" | "boosters";
const TABS: { id: Tab; label: string }[] = [
  { id: "skins", label: "Arrow styles" },
  { id: "fx", label: "Arrow effects" },
  { id: "frames", label: "Avatar frames" },
  { id: "boosters", label: "Boosters" },
];

/** Three bent arrows in a skin's colours. */
function SkinPreview({ id }: { id: string }) {
  const skin = ARROW_SKINS[id];
  const paths = ["M14 62 L14 34 L40 34", "M30 76 L62 76 L62 50", "M50 16 L80 16 L80 40"];
  const heads = ["40,34 33,29 33,39", "62,50 57,57 67,57", "80,40 75,33 85,33"];
  return (
    <svg className={`shop-skin ${skin.className}`} viewBox="0 0 96 92" aria-hidden="true">
      {paths.map((d, i) => {
        const color = skin.tinted || i === 1 ? skin.palette[(i * 3) % skin.palette.length] : "currentColor";
        return (
          <g key={i} style={{ color }}>
            <path className="shop-skin-halo" d={d} />
            <path className="shop-skin-line" d={d} />
            <polygon className="shop-skin-head" points={heads[i]} />
          </g>
        );
      })}
    </svg>
  );
}

/** A looping CSS sketch of the exit effect. */
function FxPreview({ id }: { id: string }) {
  return (
    <span className={`shop-fx shop-fx-${id.slice(3)}`} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

function FramePreview({ id, uri }: { id: string; uri: string | null }) {
  return (
    <span className={frameClass(id)} aria-hidden="true">
      <span className="shop-frame-face">{uri ? <img src={uri} alt="" referrerPolicy="no-referrer" /> : null}</span>
    </span>
  );
}

/** Shop: arrow skins and effects, avatar frames, and booster packs, bought with tokens. */
export default function ShopSection() {
  const shop = useShop();
  const { user } = useAuthContext();
  const { uri } = useAvatar(user);
  const { wallet } = useTokens();
  const [tab, setTab] = useState<Tab>("skins");
  const [armed, setArmed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const balance = wallet?.unlimited ? Infinity : wallet?.balance ?? 0;

  async function act(fn: () => Promise<void>, done: string) {
    setBusy(true);
    setNote(null);
    try {
      await fn();
      setNote({ ok: true, text: done });
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : "Something went wrong." });
    } finally {
      setBusy(false);
      setArmed(null);
    }
  }

  /** Buy / equip / equipped controls for a cosmetic. */
  function cosmetic(id: string, slot: ShopSlot, name: string) {
    const price = shop.priceOf(id);
    const owned = shop.owns(id);
    const equipped =
      slot === "frame" ? shop.state?.equipped.frame === id : slot === "arrow_skin" ? shop.arrowSkin === id : shop.arrowFx === id;
    if (!shop.signedIn) {
      return (
        <div className="shop-foot">
          <span className="shop-price">{price ? <><TokenIcon size={14} /> {formatTokens(price)}</> : "Free"}</span>
          <Link className="ac-btn ac-btn-sm ac-btn-ghost" to="/login?next=/tokens%23shop">
            Sign in
          </Link>
        </div>
      );
    }
    if (equipped) {
      return (
        <div className="shop-foot">
          <span className="shop-status">
            <Check size={14} aria-hidden="true" /> Equipped
          </span>
          {slot === "frame" ? (
            <button type="button" className="ac-btn ac-btn-sm ac-btn-ghost" disabled={busy} onClick={() => void act(() => shop.equip(slot, null), "Frame taken off.")}>
              Take off
            </button>
          ) : null}
        </div>
      );
    }
    if (owned) {
      return (
        <div className="shop-foot">
          <span className="shop-status muted">Owned</span>
          <button type="button" className="ac-btn ac-btn-sm ac-btn-primary" disabled={busy} onClick={() => void act(() => shop.equip(slot, id), `${name} equipped.`)}>
            Equip
          </button>
        </div>
      );
    }
    return (
      <div className="shop-foot">
        <span className="shop-price">
          <TokenIcon size={14} /> {price === null ? "—" : formatTokens(price)}
        </span>
        {buyButton(id, price, `${name} is yours — equipped.`, slot)}
      </div>
    );
  }

  /** Two-step buy (arm, then confirm), optionally equipping a cosmetic straight after. */
  function buyButton(id: string, price: number | null, done: string, equipSlot?: ShopSlot) {
    const short = price !== null && balance < price;
    if (short) {
      return (
        <a className="ac-btn ac-btn-sm ac-btn-ghost" href="#buy">
          Get tokens
        </a>
      );
    }
    return (
      <button
        type="button"
        className={`ac-btn ac-btn-sm ac-btn-primary${armed === id ? " is-armed" : ""}`}
        disabled={busy || price === null}
        onClick={() => {
          if (armed !== id) return setArmed(id);
          void act(async () => {
            await shop.buy(id);
            if (equipSlot) await shop.equip(equipSlot, id);
          }, done);
        }}
      >
        {armed === id ? "Confirm" : "Buy"}
      </button>
    );
  }

  return (
    <section className="tw-section shop" id="shop">
      <div className="ac-section-head">
        <div>
          <h2 className="ac-h2">Shop</h2>
          <p className="ac-sub">Spend tokens on looks and boosters. Styles and frames are yours to keep.</p>
        </div>
      </div>

      {!shop.available ? (
        <p className="ac-sub">The shop isn't open yet.</p>
      ) : (
        <>
          <div className="shop-tabs" role="tablist" aria-label="Shop sections">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                className={tab === t.id ? "active" : ""}
                onClick={() => {
                  setTab(t.id);
                  setArmed(null);
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {note ? (
            <p className={`tw-note${note.ok ? " ok" : " bad"}`} role="status">
              {note.ok ? <Check size={16} aria-hidden="true" /> : null}
              {note.text}
            </p>
          ) : null}

          <ul className="shop-grid">
            {tab === "skins"
              ? Object.entries(ARROW_SKINS).map(([id, s]) => (
                  <li key={id} className="ac-card shop-card">
                    <div className="shop-preview shop-preview-dark">
                      <SkinPreview id={id} />
                    </div>
                    <h3>{s.name}</h3>
                    <p>{s.blurb}</p>
                    {cosmetic(id, "arrow_skin", s.name)}
                  </li>
                ))
              : null}
            {tab === "fx"
              ? Object.entries(ARROW_FX).map(([id, f]) => (
                  <li key={id} className="ac-card shop-card">
                    <div className="shop-preview shop-preview-dark">
                      <FxPreview id={id} />
                    </div>
                    <h3>{f.name}</h3>
                    <p>{f.blurb}</p>
                    {cosmetic(id, "arrow_fx", f.name)}
                  </li>
                ))
              : null}
            {tab === "frames"
              ? Object.entries(FRAMES).map(([id, f]) => (
                  <li key={id} className="ac-card shop-card">
                    <div className="shop-preview">
                      <FramePreview id={id} uri={uri} />
                    </div>
                    <h3>{f.name}</h3>
                    <p>{f.blurb}</p>
                    {cosmetic(id, "frame", `${f.name} frame`)}
                  </li>
                ))
              : null}
            {tab === "boosters"
              ? Object.entries(BOOSTERS).map(([id, b]) => {
                  const price = shop.priceOf(id);
                  const have = shop.state?.inventory[b.grants] ?? 0;
                  return (
                    <li key={id} className="ac-card shop-card">
                      <div className="shop-preview">
                        <span className="shop-booster" aria-hidden="true">
                          {b.grants === "arrows_hint" ? "💡" : "↶"}
                          <b>×{b.qty}</b>
                        </span>
                      </div>
                      <h3>{b.name}</h3>
                      <p>{b.blurb}</p>
                      {shop.signedIn ? <p className="shop-have">You have {have}</p> : null}
                      <div className="shop-foot">
                        <span className="shop-price">
                          <TokenIcon size={14} /> {price === null ? "—" : formatTokens(price)}
                        </span>
                        {shop.signedIn ? (
                          buyButton(id, price, `Added ${b.name}.`)
                        ) : (
                          <Link className="ac-btn ac-btn-sm ac-btn-ghost" to="/login?next=/tokens%23shop">
                            Sign in
                          </Link>
                        )}
                      </div>
                    </li>
                  );
                })
              : null}
          </ul>
        </>
      )}
    </section>
  );
}
