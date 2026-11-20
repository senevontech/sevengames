import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Check } from "lucide-react";
import TokenIcon from "./TokenIcon";
import { useAuthContext } from "../context/AuthContext";
import { useAvatar } from "../lib/avatar";
import { formatTokens } from "../lib/currency";
import { useShop } from "../lib/shop";
import { useTokens } from "../lib/tokens";
import {
  ARROW_FX,
  ARROW_SKINS,
  BOOSTERS,
  CHESS_BOARDS,
  CHESS_PIECES,
  FRAMES,
  LUDO_BOARDS,
  LUDO_DICE,
  chessPiecesOf,
  frameClass,
  type ShopSlot,
} from "../lib/shopCatalog";
import { PieceSvg } from "../games/chess/pieces";
import "../pages/account.css";
import "./shop.css";

type Tab = "skins" | "fx" | "frames" | "boosters" | "chessBoards" | "chessPieces" | "ludoBoards" | "ludoDice";

/** Which shop: one per game (shown inside that game), plus avatar frames on the Tokens page. */
export type ShopScope = "arrows" | "chess" | "ludo" | "frames";

const SCOPES: Record<ShopScope, { title: string; sub: string; tabs: { id: Tab; label: string }[] }> = {
  arrows: {
    title: "Arrows shop",
    sub: "Arrow styles, exit effects and hint / undo packs.",
    tabs: [
      { id: "skins", label: "Styles" },
      { id: "fx", label: "Effects" },
      { id: "boosters", label: "Boosters" },
    ],
  },
  chess: {
    title: "Chess shop",
    sub: "Boards and piece sets. Yours to keep.",
    tabs: [
      { id: "chessBoards", label: "Boards" },
      { id: "chessPieces", label: "Pieces" },
    ],
  },
  ludo: {
    title: "Ludo shop",
    sub: "Boards, dice and token styles. Yours to keep.",
    tabs: [
      { id: "ludoBoards", label: "Boards" },
      { id: "ludoDice", label: "Dice" },
    ],
  },
  frames: {
    title: "Avatar frames",
    sub: "A frame around your picture, shown in every game and on leaderboards.",
    tabs: [{ id: "frames", label: "Frames" }],
  },
};

const GAME_NAMES: Record<string, string> = { chess: "Chess", ludo: "Ludo", arrows: "Arrows", carrom: "Carrom" };

/* defaults when nothing is equipped in a slot */
const SLOT_DEFAULT: Partial<Record<ShopSlot, string>> = {
  chess_board: "cboard:classic",
  chess_pieces: "cpieces:classic",
  ludo_board: "lboard:classic",
  ludo_dice: "ldice:classic",
};

/** A corner of a chess board with a few pieces. */
function ChessBoardPreview({ id }: { id: string }) {
  const t = CHESS_BOARDS[id];
  const set = chessPiecesOf("cpieces:classic");
  return (
    <span className="shop-cboard" style={{ "--l": t.light, "--d": t.dark, "--f": t.frame } as React.CSSProperties} aria-hidden="true">
      {Array.from({ length: 16 }, (_, i) => (
        <i key={i} className={((i >> 2) + i) % 2 ? "d" : "l"}>
          {i === 5 ? <PieceSvg type={2} white set={set} /> : i === 10 ? <PieceSvg type={5} white={false} set={set} /> : null}
        </i>
      ))}
    </span>
  );
}

function ChessPiecesPreview({ id }: { id: string }) {
  const set = CHESS_PIECES[id];
  return (
    <span className="shop-cpieces" aria-hidden="true">
      <PieceSvg type={6} white set={set} />
      <PieceSvg type={5} white={false} set={set} />
      <PieceSvg type={2} white set={set} />
    </span>
  );
}

function LudoBoardPreview({ id }: { id: string }) {
  const t = LUDO_BOARDS[id];
  return (
    <svg className="shop-lboard" viewBox="0 0 30 30" aria-hidden="true">
      <rect width={30} height={30} rx={3} fill={t.bg} />
      <rect x={1} y={1} width={12} height={12} rx={2} fill={t.red} />
      <rect x={17} y={1} width={12} height={12} rx={2} fill={t.green} />
      <rect x={17} y={17} width={12} height={12} rx={2} fill={t.yellow} />
      <rect x={1} y={17} width={12} height={12} rx={2} fill={t.blue} />
      <rect x={13} y={1} width={4} height={28} fill={t.track} stroke={t.line} strokeWidth={0.3} />
      <rect x={1} y={13} width={28} height={4} fill={t.track} stroke={t.line} strokeWidth={0.3} />
      <polygon points="13,13 17,13 15,15" fill={t.green} />
      <polygon points="17,13 17,17 15,15" fill={t.yellow} />
      <polygon points="13,17 17,17 15,15" fill={t.blue} />
      <polygon points="13,13 13,17 15,15" fill={t.red} />
    </svg>
  );
}

function LudoDicePreview({ id }: { id: string }) {
  const d = LUDO_DICE[id];
  return (
    <svg className="shop-ldice" viewBox="0 0 100 60" aria-hidden="true">
      <rect x={8} y={6} width={48} height={48} rx={11} fill={d.face} stroke={d.edge} strokeWidth={3} />
      {[
        [20, 18],
        [44, 18],
        [32, 30],
        [20, 42],
        [44, 42],
      ].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={4.6} fill={d.pip} />
      ))}
      <circle cx={78} cy={34} r={14} fill="#e53935" stroke="#fff" strokeWidth={3.5} />
      <circle cx={78} cy={34} r={6} fill="#fff" opacity={0.85} />
      {d.tokenShine ? <ellipse cx={73} cy={28} rx={5} ry={2.6} fill="#fff" opacity={0.75} /> : null}
    </svg>
  );
}

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

/**
 * A shop for ONE game (or avatar frames), bought with tokens.
 * `embedded`: shown inside a game's start screen: no page heading, links go to the Tokens page.
 */
export default function ShopSection({ scope, embedded = false }: { scope: ShopScope; embedded?: boolean }) {
  const shop = useShop();
  const { user } = useAuthContext();
  const { uri } = useAvatar(user);
  const { wallet } = useTokens();
  const { pathname, hash } = useLocation();
  const conf = SCOPES[scope];
  const [tab, setTab] = useState<Tab>(conf.tabs[0].id);
  const signInTo = `/login?next=${encodeURIComponent(pathname + hash)}`;
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
      slot === "arrow_skin"
        ? shop.arrowSkin === id
        : slot === "arrow_fx"
          ? shop.arrowFx === id
          : (shop.equippedIn(slot) ?? SLOT_DEFAULT[slot] ?? null) === id;
    const need = shop.levelNeeded(id);
    const locked = need.game !== null && need.level > 1 && shop.levelOf(need.game) < need.level;
    if (!shop.signedIn) {
      return (
        <div className="shop-foot">
          <span className="shop-price">{price ? <><TokenIcon size={14} /> {formatTokens(price)}</> : "Free"}</span>
          <Link className="ac-btn ac-btn-sm ac-btn-ghost" to={signInTo}>
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
    if (locked && !owned) {
      return (
        <div className="shop-foot">
          <span className="shop-price">
            <TokenIcon size={14} /> {price === null ? "—" : formatTokens(price)}
          </span>
          <span className="shop-lock">🔒 {GAME_NAMES[need.game ?? ""] ?? need.game} Lv {need.level}</span>
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
      return embedded ? (
        <Link className="ac-btn ac-btn-sm ac-btn-ghost" to="/tokens#buy">
          Get tokens
        </Link>
      ) : (
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
    <section className={`tw-section shop${embedded ? " shop-embedded" : ""}`} id={embedded ? undefined : "shop"}>
      <div className="ac-section-head">
        <div>
          {embedded ? null : <h2 className="ac-h2">{conf.title}</h2>}
          <p className="ac-sub">{conf.sub}</p>
        </div>
        {embedded && shop.signedIn ? (
          <Link className="shop-wallet" to="/tokens#buy" title="Get more tokens">
            <TokenIcon size={15} /> {wallet?.unlimited ? "∞" : formatTokens(wallet?.balance ?? 0)}
          </Link>
        ) : null}
      </div>

      {!shop.available ? (
        <p className="ac-sub">The shop isn't open yet.</p>
      ) : (
        <>
          {conf.tabs.length > 1 ? (
          <div className="shop-tabs" role="tablist" aria-label="Shop sections">
            {conf.tabs.map((t) => (
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
          ) : null}

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
            {tab === "chessBoards"
              ? Object.entries(CHESS_BOARDS).map(([id, t]) => (
                    <li key={id} className="ac-card shop-card">
                      <div className="shop-preview">
                        <ChessBoardPreview id={id} />
                      </div>
                      <h3>{t.name} board</h3>
                      <p>{t.blurb}</p>
                      {cosmetic(id, "chess_board", `${t.name} board`)}
                    </li>
                  ))
              : null}
            {tab === "chessPieces"
              ? Object.entries(CHESS_PIECES).map(([id, t]) => (
                    <li key={id} className="ac-card shop-card">
                      <div className="shop-preview shop-preview-dark">
                        <ChessPiecesPreview id={id} />
                      </div>
                      <h3>{t.name} pieces</h3>
                      <p>{t.blurb}</p>
                      {cosmetic(id, "chess_pieces", `${t.name} pieces`)}
                    </li>
                  ))
              : null}
            {tab === "ludoBoards"
              ? Object.entries(LUDO_BOARDS).map(([id, t]) => (
                    <li key={id} className="ac-card shop-card">
                      <div className="shop-preview">
                        <LudoBoardPreview id={id} />
                      </div>
                      <h3>{t.name} board</h3>
                      <p>{t.blurb}</p>
                      {cosmetic(id, "ludo_board", `${t.name} board`)}
                    </li>
                  ))
              : null}
            {tab === "ludoDice"
              ? Object.entries(LUDO_DICE).map(([id, t]) => (
                    <li key={id} className="ac-card shop-card">
                      <div className="shop-preview">
                        <LudoDicePreview id={id} />
                      </div>
                      <h3>{t.name} dice</h3>
                      <p>{t.blurb}</p>
                      {cosmetic(id, "ludo_dice", `${t.name} dice`)}
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
                          <Link className="ac-btn ac-btn-sm ac-btn-ghost" to={signInTo}>
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
