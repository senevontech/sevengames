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
  ARROW_BOARDS,
  ARROW_FX,
  ARROW_HEADS,
  ARROW_SKINS,
  BOOSTERS,
  CHESS_BOARDS,
  CHESS_PIECES,
  FRAMES,
  LUDO_BOARDS,
  LUDO_DICE,
  LUDO_TOKENS,
  POOL_CUES,
  POOL_TABLES,
  chessPiecesOf,
  frameClass,
  type ShopSlot,
} from "../lib/shopCatalog";
import { PieceSvg } from "../games/chess/pieces";
import "../pages/account.css";
import "./shop.css";
import "../games/arrows.css";

type Tab = "skins" | "fx" | "boards" | "heads" | "frames" | "boosters" | "chessBoards" | "chessPieces" | "ludoBoards" | "ludoDice" | "ludoTokens" | "poolTables" | "poolCues";

/** Which shop: one per game (shown inside that game), plus avatar frames on the Tokens page. */
export type ShopScope = "arrows" | "chess" | "ludo" | "pool" | "frames";

const SCOPES: Record<ShopScope, { title: string; sub: string; tabs: { id: Tab; label: string }[] }> = {
  arrows: {
    title: "Arrows shop",
    sub: "Arrow styles, exit effects, boards, arrowheads and hint / undo packs.",
    tabs: [
      { id: "skins", label: "Styles" },
      { id: "fx", label: "Effects" },
      { id: "boards", label: "Boards" },
      { id: "heads", label: "Heads" },
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
      { id: "ludoTokens", label: "Token colours" },
    ],
  },
  pool: {
    title: "Pool shop",
    sub: "Tables to play on, and cues with better aim, power and spin.",
    tabs: [
      { id: "poolCues", label: "Cues" },
      { id: "poolTables", label: "Tables" },
    ],
  },
  frames: {
    title: "Avatar frames",
    sub: "A frame around your picture, shown in every game and on leaderboards.",
    tabs: [{ id: "frames", label: "Frames" }],
  },
};

const GAME_NAMES: Record<string, string> = { chess: "Chess", ludo: "Ludo", arrows: "Arrows", carrom: "Carrom", pool: "Pool" };

/* defaults when nothing is equipped in a slot */
const SLOT_DEFAULT: Partial<Record<ShopSlot, string>> = {
  arrow_board: "board:classic",
  arrow_head: "head:classic",
  chess_board: "cboard:classic",
  chess_pieces: "cpieces:classic",
  ludo_board: "lboard:classic",
  ludo_dice: "ldice:classic",
  pool_table: "ptable:club",
  pool_cue: "pcue:house",
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

/** A corner of a pool table: rail, corner cap, pocket, cloth and a ball. */
function PoolTablePreview({ id }: { id: string }) {
  const t = POOL_TABLES[id];
  const g = `shop-pt-${id.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <svg className="shop-ptable" viewBox="0 0 120 72" aria-hidden="true">
      <defs>
        <linearGradient id={`${g}-r`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={t.rail[0]} />
          <stop offset="0.5" stopColor={t.rail[1]} />
          <stop offset="1" stopColor={t.rail[2]} />
        </linearGradient>
        <radialGradient id={`${g}-c`} cx="0.6" cy="0.6" r="0.9">
          <stop offset="0" stopColor={t.cloth} />
          <stop offset="1" stopColor={t.clothDark} />
        </radialGradient>
        <linearGradient id={`${g}-m`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={t.metal[0]} />
          <stop offset="1" stopColor={t.metal[1]} />
        </linearGradient>
        <radialGradient id={`${g}-b`} cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#fff" />
          <stop offset="0.25" stopColor="#f6c400" />
          <stop offset="1" stopColor="#8a6a00" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="120" height="72" rx="10" fill={`url(#${g}-r)`} />
      <circle cx="13" cy="13" r="13" fill={`url(#${g}-m)`} />
      <rect x="14" y="14" width="106" height="58" fill={`url(#${g}-c)`} />
      <rect x="14" y="14" width="106" height="5" fill={t.cushion} />
      <rect x="14" y="14" width="5" height="58" fill={t.cushion} />
      <circle cx="16" cy="16" r="8" fill={t.liner} />
      <circle cx="16" cy="16" r="6" fill="#000" />
      {[44, 74, 104].map((x) => (
        <path key={x} d={`M${x} 5 l2 2.5 -2 2.5 -2 -2.5z`} fill={t.sight} />
      ))}
      <ellipse cx="78" cy="51" rx="7" ry="3" fill="rgba(0,0,0,0.35)" />
      <circle cx="76" cy="46" r="6.5" fill={`url(#${g}-b)`} />
    </svg>
  );
}

/** A cue's butt and shaft in its finish, with its stats as bars. */
function PoolCuePreview({ id }: { id: string }) {
  const c = POOL_CUES[id];
  return (
    <span className="shop-pcue" aria-hidden="true">
      <svg viewBox="0 0 200 22">
        <rect x="2" y="7" width="8" height="8" rx="2" fill="#111" />
        <rect x="10" y="5.5" width="26" height="11" rx="1.5" fill={c.butt} />
        <rect x="36" y="5.5" width="3" height="11" fill={c.ring} />
        <rect x="39" y="6" width="40" height="10" fill={c.wrap} />
        <path d="M79 6.3 L130 7.6 L130 14.4 L79 15.7 Z" fill={c.forearm} />
        <path d="M79 8 L112 11 L79 14 Z" fill={c.inlay} opacity="0.85" />
        <rect x="130" y="7.4" width="4" height="7.2" fill={c.ring} />
        <path d="M134 7.6 L192 9.6 L192 12.4 L134 14.4 Z" fill={c.shaft} />
        <rect x="192" y="9.5" width="4" height="3" fill="#f2eee3" />
        <rect x="196" y="9.7" width="2" height="2.6" fill="#3f6fb5" />
      </svg>
      <span className="shop-pcue-stats">
        {(["aim", "power", "spin"] as const).map((k) => (
          <span key={k}>
            <small>{k === "aim" ? "Aim" : k === "power" ? "Power" : "Spin"}</small>
            <i>
              {[1, 2, 3, 4, 5].map((n) => (
                <b key={n} className={n <= c[k] ? "on" : ""} />
              ))}
            </i>
          </span>
        ))}
      </span>
    </span>
  );
}

/** Two tokens and a home-column strip in a token colour (with its effect). */
function LudoTokenPreview({ id }: { id: string }) {
  const t = LUDO_TOKENS[id];
  const gid = `shop-ltok-${id.replace(/[^a-z0-9]/gi, "")}`;
  const fill = t.effect && t.effect !== "neon" ? `url(#${gid})` : t.fill;
  return (
    <svg className="shop-ldice" viewBox="0 0 100 60" aria-hidden="true">
      <defs>
        {t.effect === "gold" ? (
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff1a8" />
            <stop offset="0.45" stopColor="#e2b23a" />
            <stop offset="1" stopColor="#8a6510" />
          </linearGradient>
        ) : t.effect === "rainbow" ? (
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            {["#ff4d4d", "#ff9f1a", "#ffe14d", "#3ddc84", "#3fa7ff", "#9b5cff"].map((c, i) => (
              <stop key={c} offset={i / 5} stopColor={c} />
            ))}
          </linearGradient>
        ) : t.effect === "galaxy" ? (
          <radialGradient id={gid} cx="0.35" cy="0.3" r="0.9">
            <stop offset="0" stopColor="#8f6bff" />
            <stop offset="0.5" stopColor="#4a2a8c" />
            <stop offset="1" stopColor="#120a2e" />
          </radialGradient>
        ) : null}
      </defs>
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={6 + i * 12} y={40} width={11} height={11} rx={1.5} fill={fill} opacity={0.85} />
      ))}
      {[
        [64, 24],
        [84, 34],
      ].map(([x, y], i) => (
        <g key={i} style={t.effect === "neon" ? { filter: `drop-shadow(0 0 4px ${t.fill})` } : undefined}>
          <circle cx={x} cy={y} r={12} fill={fill} stroke="#fff" strokeWidth={3} />
          <circle cx={x} cy={y} r={5} fill="#fff" opacity={0.85} />
        </g>
      ))}
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

/** A small board in the theme's colours, with dots and one arrow. */
function BoardPreview({ id }: { id: string }) {
  const b = ARROW_BOARDS[id];
  const ink = b.tone === "light" ? "#17181b" : b.tone === "dark" ? "#f1f1f5" : "currentColor";
  return (
    <span className={`shop-aboard${id === "board:classic" ? " is-classic" : ` arw-bg-${id.slice(6)}`}`} aria-hidden="true">
      <svg viewBox="0 0 120 80" style={{ color: ink }}>
        {Array.from({ length: 15 }, (_, i) => (
          <circle key={i} cx={20 + (i % 5) * 20} cy={20 + Math.floor(i / 5) * 20} r={1.6} fill="currentColor" opacity={0.25} />
        ))}
        <path d="M20 60 L20 40 L60 40" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
        <polygon points="66,40 57,35 57,45" fill="currentColor" />
      </svg>
    </span>
  );
}

/** One arrow ending in the head shape. */
function HeadPreview({ id }: { id: string }) {
  const tip = { x: 70, y: 40 };
  const along = (d: number, side = 0) => `${(tip.x + d).toFixed(1)},${(tip.y + side).toFixed(1)}`;
  let head: React.ReactNode;
  switch (id) {
    case "head:chevron":
      head = <polyline points={`${along(-13, -9)} ${along(4)} ${along(-13, 9)}`} fill="none" stroke="currentColor" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />;
      break;
    case "head:dot":
      head = <circle cx={tip.x + 2} cy={tip.y} r={7} fill="currentColor" />;
      break;
    case "head:bold":
      head = <polygon points={`${along(7)} ${along(-14, -11)} ${along(-14, 11)}`} fill="currentColor" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" />;
      break;
    case "head:diamond":
      head = <polygon points={`${along(10)} ${along(1, 7)} ${along(-6)} ${along(1, -7)}`} fill="currentColor" />;
      break;
    case "head:star": {
      const list: string[] = [];
      for (let i = 0; i < 10; i++) {
        const a = (i * Math.PI) / 5;
        const rr = i % 2 ? 4.4 : 10.5;
        list.push(along(3 + Math.cos(a) * rr, Math.sin(a) * rr));
      }
      head = <polygon points={list.join(" ")} fill="currentColor" />;
      break;
    }
    default:
      head = <polygon points={`${along(4)} ${along(-10, -6)} ${along(-10, 6)}`} fill="currentColor" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" />;
  }
  return (
    <svg className="shop-ahead" viewBox="0 0 96 80" aria-hidden="true">
      <path d="M18 64 L18 40 L66 40" fill="none" stroke="currentColor" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
      {head}
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
    // (no level gate: chips buy any item, the server agrees)
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
          {slot === "frame" || slot === "ludo_token" ? (
            <button
              type="button"
              className="ac-btn ac-btn-sm ac-btn-ghost"
              disabled={busy}
              onClick={() => void act(() => shop.equip(slot, null), slot === "frame" ? "Frame taken off." : "Back to the board's colours.")}
            >
              Take off
            </button>
          ) : null}
        </div>
      );
    }
    if (shop.isPlusOnly(id) && !owned) {
      return (
        <div className="shop-foot">
          <span className="shop-plus">⭐ Plus</span>
          <Link className="ac-btn ac-btn-sm ac-btn-ghost" to="/chips#plus">
            Get Plus
          </Link>
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
        <Link className="ac-btn ac-btn-sm ac-btn-ghost" to="/chips#buy">
          Get chips
        </Link>
      ) : (
        <a className="ac-btn ac-btn-sm ac-btn-ghost" href="#buy">
          Get chips
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
          <Link className="shop-wallet" to="/chips#buy" title="Get more chips">
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
            {tab === "boards"
              ? Object.entries(ARROW_BOARDS).map(([id, b]) => (
                  <li key={id} className="ac-card shop-card">
                    <div className="shop-preview">
                      <BoardPreview id={id} />
                    </div>
                    <h3>{b.name} board</h3>
                    <p>{b.blurb}</p>
                    {cosmetic(id, "arrow_board", `${b.name} board`)}
                  </li>
                ))
              : null}
            {tab === "heads"
              ? Object.entries(ARROW_HEADS).map(([id, h]) => (
                  <li key={id} className="ac-card shop-card">
                    <div className="shop-preview shop-preview-dark">
                      <HeadPreview id={id} />
                    </div>
                    <h3>{h.name} head</h3>
                    <p>{h.blurb}</p>
                    {cosmetic(id, "arrow_head", `${h.name} head`)}
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
            {tab === "ludoTokens"
              ? Object.entries(LUDO_TOKENS).map(([id, t]) => (
                    <li key={id} className="ac-card shop-card">
                      <div className="shop-preview">
                        <LudoTokenPreview id={id} />
                      </div>
                      <h3>{t.name} tokens</h3>
                      <p>{t.blurb} Your picture shows on your tokens too.</p>
                      {cosmetic(id, "ludo_token", `${t.name} tokens`)}
                    </li>
                  ))
              : null}
            {tab === "poolTables"
              ? Object.entries(POOL_TABLES).map(([id, t]) => (
                    <li key={id} className="ac-card shop-card">
                      <div className="shop-preview">
                        <PoolTablePreview id={id} />
                      </div>
                      <h3>{t.name} table</h3>
                      <p>{t.blurb}</p>
                      {cosmetic(id, "pool_table", `${t.name} table`)}
                    </li>
                  ))
              : null}
            {tab === "poolCues"
              ? Object.entries(POOL_CUES).map(([id, c]) => (
                    <li key={id} className="ac-card shop-card">
                      <div className="shop-preview">
                        <PoolCuePreview id={id} />
                      </div>
                      <h3>{c.name}</h3>
                      <p>{c.blurb}</p>
                      {cosmetic(id, "pool_cue", c.name)}
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
