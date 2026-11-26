/* Carrom locker + shop: strikers (with stat upgrades), coin sets and boards, bought with tokens.
   Top items and high upgrade levels also need a minimum player level. Pro owns every item. */
import { capDpr } from "../../lib/perf";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTokens } from "../../lib/tokens";
import { formatTokens } from "../../lib/currency";
import {
  BOARDS,
  COIN_SETS,
  STRIKERS,
  coinSprite,
  lightingSprite,
  strikerSprite,
  type BoardTheme,
  type CoinSet,
  type Shop,
  type ShopKind,
  type StrikerSkin,
} from "./skins";
import { MAX_LEVEL, carromErrorText, xpForLevel, type useCarromProgress } from "./progress";
import { STATS, STAT_MAX, tierOf, upgradeCost, upgradeGate, type StatKey } from "./stats";
import { carromAudio } from "./audio";
import TokenIcon from "../../components/TokenIcon";
import "./carrom.css";

type Prog = ReturnType<typeof useCarromProgress>;

export function LevelBar({ level, xp, pro, compact = false }: { level: number; xp: number; pro: boolean; compact?: boolean }) {
  const cur = xpForLevel(level);
  const next = xpForLevel(Math.min(MAX_LEVEL, level + 1));
  const pct = level >= MAX_LEVEL ? 100 : Math.round(((xp - cur) / Math.max(1, next - cur)) * 100);
  return (
    <div className={`carrom-level${compact ? " compact" : ""}`}>
      <span className="carrom-level-badge">{level}</span>
      <div className="carrom-level-main">
        <div className="carrom-level-top">
          <b>Level {level}</b>
          {pro ? <span className="carrom-pro-tag">PRO</span> : null}
          <small>{level >= MAX_LEVEL ? "Max level" : `${xp - cur} / ${next - cur} XP`}</small>
        </div>
        <div className="carrom-level-track">
          <i style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}

/** Live preview of a disc sprite (drawn on a canvas, so it matches the game exactly). */
function DiscPreview({ draw, size = 64, spin = false }: { draw: (px: number) => HTMLCanvasElement; size?: number; spin?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const dpr = capDpr(2);
    const px = Math.round(size * dpr);
    c.width = c.height = px;
    const g = c.getContext("2d")!;
    const face = draw(px);
    const light = lightingSprite(px);
    let raf = 0;
    let a = 0;
    const paint = () => {
      g.clearRect(0, 0, px, px);
      g.save();
      g.translate(px / 2, px / 2);
      g.rotate(a);
      g.drawImage(face, -px / 2, -px / 2, px, px);
      g.restore();
      g.drawImage(light, 0, 0, px, px);
      if (spin) {
        a += 0.012;
        raf = requestAnimationFrame(paint);
      }
    };
    paint();
    return () => cancelAnimationFrame(raf);
  }, [draw, size, spin]);
  return <canvas ref={ref} style={{ width: size, height: size }} aria-hidden="true" />;
}

function BoardSwatch({ b }: { b: BoardTheme }) {
  return (
    <span
      className="carrom-board-swatch"
      style={
        {
          "--frame": b.frame,
          "--f1": b.field[0],
          "--f2": b.field[1],
          "--ink": b.ink,
          "--brass": b.brass[1],
          "--glow": b.glow ?? "transparent",
        } as React.CSSProperties
      }
      aria-hidden="true"
    >
      <i />
    </span>
  );
}

/** A button that asks for a second tap before spending tokens. */
function SpendButton({
  cost,
  label,
  disabled,
  onConfirm,
  className = "primary-btn",
}: {
  cost: number;
  label: React.ReactNode;
  disabled?: boolean;
  onConfirm: () => void;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = window.setTimeout(() => setArmed(false), 3500);
    return () => window.clearTimeout(id);
  }, [armed]);
  return (
    <button
      type="button"
      className={`${className}${armed ? " is-armed" : ""}`}
      disabled={disabled}
      onClick={() => {
        if (cost === 0 || armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? (
        <>
          Confirm · <TokenIcon size={16} /> {formatTokens(cost)}
        </>
      ) : (
        label
      )}
    </button>
  );
}

/** `bare`: inside a sheet / the Tokens page, which has its own title and Back: no header row. */
export default function CarromLocker({
  prog,
  signedIn,
  onBack,
  bare = false,
}: {
  prog: Prog;
  signedIn: boolean;
  onBack?: () => void;
  bare?: boolean;
}) {
  const [tab, setTab] = useState<ShopKind>("striker");
  const [focus, setFocus] = useState<string>(prog.striker.id);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  const { wallet } = useTokens();
  const { level, pro, free } = prog;
  const balance = wallet?.unlimited ? Infinity : (wallet?.balance ?? 0);

  async function act(fn: () => Promise<void>, ok: string, sound = true) {
    setBusy(true);
    setNote(null);
    try {
      await fn();
      if (sound) {
        carromAudio.unlock();
        carromAudio.upgrade();
      }
      setNote({ text: ok, ok: true });
    } catch (err) {
      setNote({ text: carromErrorText(err), ok: false });
    } finally {
      setBusy(false);
    }
  }

  /** What the main button for an item should do. */
  const stateOf = (kind: ShopKind, id: string, shop: Shop, equipped: boolean) => {
    if (equipped) return { kind: "equipped" as const };
    if (prog.owns(kind, id)) return { kind: "use" as const };
    if (!signedIn) return { kind: "signin" as const };
    // no level gate any more: chips buy any item (strength upgrades keep theirs)
    const price = free ? 0 : shop.price;
    return { kind: "buy" as const, price, afford: price <= balance };
  };

  const tag = (st: ReturnType<typeof stateOf>, shop: Shop) =>
    st.kind === "equipped" ? (
      <span className="carrom-item-tag on">Equipped</span>
    ) : st.kind === "use" ? (
      <span className="carrom-item-tag">Owned</span>
    ) : (
      <span className={`carrom-item-tag price${shop.pro ? " pro" : ""}`}>{free ? (
          "Free for you"
        ) : (
          <>
            <TokenIcon size={12} /> {formatTokens(shop.price)}
          </>
        )}</span>
    );

  const mainButton = (kind: ShopKind, id: string, name: string, shop: Shop, equipped: boolean) => {
    const st = stateOf(kind, id, shop, equipped);
    if (st.kind === "equipped") return <span className="carrom-shop-equipped">✓ Equipped</span>;
    if (st.kind === "use")
      return (
        <button type="button" className="primary-btn" disabled={busy} onClick={() => void act(() => prog.select(kind, id), `${name} equipped.`, false)}>
          Equip
        </button>
      );
    if (st.kind === "signin")
      return (
        <Link className="primary-btn" to="/login?next=/game/carrom">
          Sign in to buy
        </Link>
      );
    return (
      <SpendButton
        cost={st.price}
        label={
          free
            ? "Unlock · free (unlimited)"
            : st.afford
              ? (
                  <>
                    Buy · <TokenIcon size={16} /> {formatTokens(st.price)}
                  </>
                )
              : (
                  <>
                    Need <TokenIcon size={16} /> {formatTokens(st.price - balance)} more
                  </>
                )
        }
        disabled={busy || !st.afford}
        onConfirm={() =>
          void act(async () => {
            await prog.buy(kind, id);
            await prog.select(kind, id);
          }, `${name} unlocked and equipped!`)
        }
      />
    );
  };

  const focused: StrikerSkin = STRIKERS.find((s) => s.id === focus) ?? prog.striker;
  const fStats = prog.statsFor(focused);
  const fOwned = prog.owns("striker", focused.id);

  return (
    <div className="carrom-locker">
      <div className={`carrom-locker-head${bare ? " is-bare" : ""}`}>
        {bare ? null : (
          <>
            <button type="button" className="ghost-btn" onClick={onBack}>
              ‹ Back
            </button>
            <h3>Carrom shop</h3>
          </>
        )}
        {signedIn ? (
          <Link to="/chips" className="carrom-wallet" title="Get more chips">
            <TokenIcon size={16} /> {wallet?.unlimited ? "∞" : formatTokens(wallet?.balance ?? 0)}
          </Link>
        ) : null}
      </div>

      <LevelBar level={level} xp={prog.xp} pro={pro} />
      <p className="carrom-hint">Earn XP every match: coins, the queen, combos and wins. Higher levels open the top items and upgrades.</p>

      {prog.serverError ? <p className="carrom-shop-note bad">{prog.serverError}</p> : null}
      {note ? (
        <p className={`carrom-shop-note${note.ok ? " ok" : " bad"}`} role="status">
          {note.text}
        </p>
      ) : null}

      <div className="carrom-tabs" role="tablist">
        {(
          [
            ["striker", "Strikers"],
            ["coins", "Coin sets"],
            ["board", "Boards"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "striker" ? (
        <div className="carrom-shop-detail">
          <div className="carrom-shop-hero">
            <span className={`carrom-shop-preview tier-${tierOf(fStats)}`} style={{ "--glow": focused.glow ?? "rgba(255,170,60,0.9)" } as React.CSSProperties}>
              <DiscPreview key={focused.id} draw={(px) => strikerSprite(focused, px)} size={96} spin />
            </span>
            <div className="carrom-shop-title">
              <b>{focused.name}</b>
              <small>{focused.shop.pro ? "Pro collection · " : ""}Tier {tierOf(fStats)} of 3</small>
              {mainButton("striker", focused.id, focused.name, focused.shop, prog.striker.id === focused.id)}
            </div>
          </div>

          <ul className="carrom-stats">
            {STATS.map(({ key, label, blurb }) => {
              const lv = fStats[key];
              const base = focused.base[key];
              const target = lv + 1;
              const cost = free ? 0 : upgradeCost(target);
              const gate = upgradeGate(target);
              return (
                <li key={key}>
                  <div className="carrom-stat-top">
                    <b>{label}</b>
                    <small>{blurb}</small>
                    <span className="carrom-stat-lv">
                      {lv}/{STAT_MAX}
                    </span>
                  </div>
                  <div className="carrom-stat-bar" aria-label={`${label} level ${lv} of ${STAT_MAX}`}>
                    {Array.from({ length: STAT_MAX }, (_, i) => (
                      <i key={i} className={i < base ? "base" : i < lv ? "up" : ""} />
                    ))}
                  </div>
                  {fOwned && signedIn ? (
                    lv >= STAT_MAX ? (
                      <span className="carrom-stat-max">MAX</span>
                    ) : level < gate ? (
                      <span className="carrom-stat-gate">Lv {target} needs player level {gate}</span>
                    ) : (
                      <SpendButton
                        className="ghost-btn carrom-stat-up"
                        cost={cost}
                        label={
                          free ? (
                            `Upgrade → ${target} · free`
                          ) : (
                            <>
                              Upgrade → {target} · <TokenIcon size={14} /> {formatTokens(cost)}
                            </>
                          )
                        }
                        disabled={busy || cost > balance}
                        onConfirm={() =>
                          void act(() => prog.upgrade(focused.id, key as StatKey), `${focused.name}: ${label} is now level ${target}!`)
                        }
                      />
                    )
                  ) : null}
                </li>
              );
            })}
          </ul>
          <p className="carrom-hint">Upgrades count against Senevi and in local games. Online matches use equal strikers for everyone.</p>
        </div>
      ) : null}

      <div className="carrom-items">
        {tab === "striker"
          ? STRIKERS.map((s) => {
              const st = stateOf("striker", s.id, s.shop, prog.striker.id === s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  className={`carrom-item${focus === s.id ? " is-on" : ""}`}
                  onClick={() => setFocus(s.id)}
                  aria-pressed={focus === s.id}
                  title={s.name}
                >
                  <span className="carrom-item-art">
                    <DiscPreview draw={(px) => strikerSprite(s, px)} size={56} />
                  </span>
                  <span className="carrom-item-name">{s.name}</span>
                  {tag(st, s.shop)}
                </button>
              );
            })
          : tab === "coins"
            ? COIN_SETS.map((c: CoinSet) => {
                const equipped = prog.coinSet.id === c.id;
                const st = stateOf("coins", c.id, c.shop, equipped);
                return (
                  <div key={c.id} className={`carrom-item is-static${equipped ? " is-on" : ""}`}>
                    <span className="carrom-item-art carrom-coin-trio">
                      <DiscPreview draw={(px) => coinSprite(c, "white", px)} size={30} />
                      <DiscPreview draw={(px) => coinSprite(c, "queen", px)} size={30} />
                      <DiscPreview draw={(px) => coinSprite(c, "black", px)} size={30} />
                    </span>
                    <span className="carrom-item-name">{c.name}</span>
                    {tag(st, c.shop)}
                    <div className="carrom-item-action">{mainButton("coins", c.id, c.name, c.shop, equipped)}</div>
                  </div>
                );
              })
            : BOARDS.map((b) => {
                const equipped = prog.board.id === b.id;
                const st = stateOf("board", b.id, b.shop, equipped);
                return (
                  <div key={b.id} className={`carrom-item is-static${equipped ? " is-on" : ""}`}>
                    <span className="carrom-item-art">
                      <BoardSwatch b={b} />
                    </span>
                    <span className="carrom-item-name">{b.name}</span>
                    {tag(st, b.shop)}
                    <div className="carrom-item-action">{mainButton("board", b.id, b.name, b.shop, equipped)}</div>
                  </div>
                );
              })}
      </div>

      {pro ? (
        <p className="carrom-hint">You're Pro: every striker, coin set and board is yours. Upgrades still use chips.</p>
      ) : null}
      {!signedIn ? (
        <p className="carrom-hint">
          Playing as guest: you can use the free items and your level is saved on this device. <Link to="/login?next=/game/carrom">Sign in</Link> to
          buy items and upgrade strikers with chips.
        </p>
      ) : null}
    </div>
  );
}
