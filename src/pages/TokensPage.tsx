import { useEffect, useMemo, useState } from "react";
import { isNative } from "../lib/native";
import { ADFREE_PRODUCT, PLUS_PRODUCT, buyPack, buySubscription, loadPlayPrices, manageSubscriptions, playErrorText, type PlayPrices } from "../lib/playBilling";
import { Link, useLocation } from "react-router-dom";
import {
  CalendarClock,
  Check,
  Coins,
  HandCoins,
  Crown,
  Gift,
  Gamepad2,
  KeyRound,
  ShoppingBag,
  Sparkles,
  Tv,
  X,
  Zap,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "../components/anim-icons";
import TokenIcon from "../components/TokenIcon";
import ChipShowcase from "../components/chip/ChipShowcase";
import ChipMath from "../components/ChipMath";
import { useAuthContext } from "../context/AuthContext";
import { tokenErrorText, usePlanPrices, useTokenPacks, useTokens, type LedgerRow, type TokenPack } from "../lib/tokens";
import { formatMoney, formatTokens, pickCurrency } from "../lib/currency";
import { getGame } from "../catalog";
import AdRewardModal from "../components/AdRewardModal";
import ShopHub from "../components/ShopHub";
import "./tokens.css";
import "./account.css";
import "./tokens-page.css";

const REASON: Record<string, { label: string; Icon: LucideIcon }> = {
  signup: { label: "Welcome bonus", Icon: Gift },
  play: { label: "Played", Icon: Gamepad2 },
  ad: { label: "Watched an ad", Icon: Tv },
  subscription: { label: "Subscription chips", Icon: CalendarClock },
  admin: { label: "Adjustment", Icon: Sparkles },
  guest: { label: "Guest chips carried over", Icon: Gift },
  purchase: { label: "Bought a chip pack", Icon: ShoppingBag },
  carrom: { label: "Carrom shop", Icon: Gamepad2 },
  adfree: { label: "Ad-free month", Icon: ShieldCheck },
  shop: { label: "Shop", Icon: ShoppingBag },
  match: { label: "Online win", Icon: Gamepad2 },
  daily: { label: "Daily reward", Icon: Gift },
  challenge: { label: "Daily challenge", Icon: Check },
  achievement: { label: "Achievement", Icon: Sparkles },
  referral: { label: "Invited a friend", Icon: Gift },
  weekly: { label: "Weekly competition prize", Icon: Crown },
  friend: { label: "Friend challenge", Icon: Zap },
  tournament: { label: "Tournament", Icon: Crown },
  entry: { label: "Chip match", Icon: Coins },
  gift: { label: "Gift", Icon: HandCoins },
  club: { label: "Club wallet", Icon: Users },
};

/** "give:K7Q2MX" → "Put in club #K7Q2MX" */
function clubRefLabel(ref: string) {
  const [kind, tag] = ref.split(":");
  return kind === "give" ? `Put in club #${tag}` : kind === "pay" ? `Paid by club #${tag}` : kind === "closed" ? `Club #${tag} closed` : `#${tag}`;
}

const ENTRY_GAMES: Record<string, string> = { chess: "Chess", ludo: "Ludo", carrom: "Carrom", arrows: "Arrows", pool: "Eight Ball" };
/** "cpu:pool" → "Eight Ball vs Senevi", "pool:match-id" → "Eight Ball" */
function entryRefLabel(ref: string, delta: number) {
  const [a, b] = ref.split(":");
  const game = a === "cpu" ? `${ENTRY_GAMES[b] ?? b} vs Senevi` : ENTRY_GAMES[a] ?? a;
  return `${game} · ${delta < 0 ? "entry" : "prize"}`;
}

const PACK_META: Record<string, { name: string; flag?: string; coins: number }> = {
  starter: { name: "Starter", coins: 1 },
  player: { name: "Player", flag: "Most popular", coins: 2 },
  pro: { name: "Pro", coins: 3 },
  legend: { name: "Legend", flag: "Best value", coins: 4 },
};

/** "striker:neon" → "Neon striker", "upgrade:gold:power:7" → "Gold power → Lv 7" */
function carromRefLabel(ref: string) {
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
  const p = ref.split(":");
  if (p[0] === "upgrade" && p.length === 4) return `${cap(p[1])} ${p[2]} → Lv ${p[3]}`;
  if (p.length === 2) return `${cap(p[1])} ${p[0] === "coins" ? "coin set" : p[0]}`;
  return ref;
}

type Checkout = { kind: "plan"; plan: "monthly" | "yearly" } | { kind: "pack"; pack: TokenPack };

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

function CoinStack({ n }: { n: number }) {
  return (
    <span className="tw-stack" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <i key={i} style={{ "--i": i } as React.CSSProperties} />
      ))}
    </span>
  );
}

export default function TokensPage() {
  const { user } = useAuthContext();
  const { wallet, guestBalance, loading, subscribe, buyPack, cancel, history, refresh, redeem, adFree } = useTokens();
  const noAds = Boolean(adFree?.active);
  const location = useLocation();
  const [code, setCode] = useState("");
  const [codeOpen, setCodeOpen] = useState(false);
  const prices = usePlanPrices();
  const packs = useTokenPacks();
  const [adOpen, setAdOpen] = useState(false);
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [busy, setBusy] = useState(false);
  // the Android app: everything is sold through Google Play, at Play's local prices
  const [play, setPlay] = useState<PlayPrices | null>(null);
  useEffect(() => {
    if (isNative) void loadPlayPrices().then(setPlay);
  }, []);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  const [rows, setRows] = useState<LedgerRow[]>([]);

  useEffect(() => {
    document.title = "Chips — Senevon Game Studio";
  }, []);

  // "/chips#buy" (from the profile wallet card) scrolls to the packs, "/chips#plus" to Senevon Plus
  useEffect(() => {
    const target = location.hash.slice(1);
    if ((target !== "buy" && target !== "plus" && target !== "chip-math") || !packs) return;
    const id = requestAnimationFrame(() => document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" }));
    return () => cancelAnimationFrame(id);
  }, [location.hash, packs]);

  // reload history whenever the balance changes
  const balance = wallet?.balance;
  useEffect(() => {
    if (balance === undefined) return;
    void history().then(setRows);
  }, [balance, history]);

  const currencies = useMemo(
    () => [...new Set([...prices.map((p) => p.currency), ...(packs ?? []).flatMap((p) => Object.keys(p.prices))])],
    [prices, packs],
  );
  const currency = pickCurrency(currencies);
  const price = (plan: "monthly" | "yearly") => prices.find((p) => p.currency === currency && p.plan === plan)?.amount;
  const monthly = price("monthly");
  const yearly = price("yearly");
  const savePct = monthly && yearly ? Math.round((1 - yearly / (monthly * 12)) * 100) : 0;
  const perMonth = wallet?.sub_tokens ?? 5000;
  const sub = wallet?.subscription ?? null;
  const mock = (wallet?.payments_mode ?? "mock") === "mock";
  const adsLeft = wallet ? Math.max(0, wallet.ad_daily_cap - wallet.ads_today) : 0;

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true);
    setNote(null);
    try {
      await action();
      setNote({ text: success, ok: true });
      return true;
    } catch (err) {
      setNote({ text: tokenErrorText(err), ok: false });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function playRun(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setNote(null);
    try {
      await action();
      await refresh();
      setNote({ text: success, ok: true });
    } catch (err) {
      setNote({ text: playErrorText(err), ok: false });
    } finally {
      setBusy(false);
    }
  }

  async function confirmCheckout() {
    if (!checkout) return;
    const done =
      checkout.kind === "plan"
        ? await run(() => subscribe(checkout.plan, currency), `Subscribed! ${formatTokens(perMonth)} chips have been added.`)
        : await run(
            () => buyPack(checkout.pack.id, currency),
            `${formatTokens(checkout.pack.tokens + checkout.pack.bonus)} chips added to your wallet.`,
          );
    setCheckout(null);
    if (done) window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function doRedeem(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    const ok = await run(() => redeem(code.trim()), "Code redeemed — you now have unlimited chips.");
    if (ok) {
      setCode("");
      setCodeOpen(false);
    }
  }

  /* ---------- guests ---------- */
  if (!user) {
    return (
      <div className="acct tw">
        <section className="ac-card ac-coin-card tw-hero">
          <div className="tw-hero-main">
            <ChipShowcase className="tw-hero-chip" />
            <div>
              <span className="tw-hero-label">Guest chips</span>
              <strong className="tw-balance">{guestBalance === null ? "…" : formatTokens(guestBalance)}</strong>
              <p className="tw-hero-sub">
                Premium games cost chips per play. Sign in to get 100 free chips, buy packs and earn more by
                watching ads. Your unspent guest chips come with you.
              </p>
            </div>
          </div>
          <div className="tw-hero-actions">
            <Link className="ac-btn" to="/login?next=/chips">
              Sign in or create an account
            </Link>
          </div>
        </section>
        <ChipMath earned={null} bought={null} />
        <ShopHub />
      </div>
    );
  }

  return (
    <div className="acct tw">
      {/* ---------- balance ---------- */}
      <section className="ac-card ac-coin-card tw-hero">
        <div className="tw-hero-main">
          <ChipShowcase className="tw-hero-chip" />
          <div>
            <span className="tw-hero-label">Your balance</span>
            <strong className="tw-balance">
              {wallet ? (wallet.unlimited ? "∞" : formatTokens(wallet.balance)) : loading ? "…" : "—"}
            </strong>
            {wallet?.unlimited ? (
              <span className="tw-pill">
                <KeyRound size={14} aria-hidden="true" /> Unlimited: premium games are free for you
              </span>
            ) : (
              <>
                <p className="tw-hero-sub">Free games are always free. Premium games use chips per play. Chips never expire.</p>
                {wallet ? (
                  <p className="tw-hero-sub tw-earned">
                    <b>{formatTokens(wallet.earned ?? 0)}</b> earned (for chip matches and gifts) ·{" "}
                    <b>{formatTokens(Math.max(0, wallet.balance - (wallet.earned ?? 0)))}</b> bought (shop and premium games only)
                  </p>
                ) : null}
              </>
            )}
          </div>
        </div>
        <div className="tw-hero-actions">
          {wallet && !wallet.unlimited ? (
            <a className="ac-btn" href="#buy">
              <ShoppingBag size={16} aria-hidden="true" /> Buy chips
            </a>
          ) : null}
          {!noAds ? (
            <button
              type="button"
              className="ac-btn ac-btn-ghost"
              disabled={!wallet || adsLeft === 0}
              onClick={() => setAdOpen(true)}
            >
              <Tv size={16} aria-hidden="true" /> Watch ad · +{wallet?.ad_reward ?? 50}
            </button>
          ) : null}
          {!wallet && !loading ? (
            <button type="button" className="ac-btn ac-btn-ghost" onClick={() => void refresh()}>
              Retry
            </button>
          ) : null}
        </div>
      </section>

      {note ? (
        <p className={`tw-note${note.ok ? " ok" : " bad"}`} role="status">
          {note.ok ? <Check size={16} aria-hidden="true" /> : null}
          {note.text}
        </p>
      ) : null}

      {/* ---------- how chips are won and lost ---------- */}
      {!wallet?.unlimited ? (
        <ChipMath earned={wallet ? wallet.earned ?? 0 : null} bought={wallet ? Math.max(0, wallet.balance - (wallet.earned ?? 0)) : null} />
      ) : null}

      {/* ---------- buy packs ---------- */}
      {!wallet?.unlimited ? (
        <section className="tw-section" id="buy">
          <div className="ac-section-head">
            <div>
              <h2 className="ac-h2">Buy chips</h2>
              <p className="ac-sub">One-off packs. Bigger packs include bonus chips.</p>
            </div>
            {mock ? <span className="tw-test">Test mode · no real payment</span> : null}
          </div>
          {packs === null ? (
            <div className="tw-packs">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="ac-card tw-pack is-skeleton" />
              ))}
            </div>
          ) : packs.length === 0 ? (
            <p className="ac-sub">Chip packs aren't available right now.</p>
          ) : (
            <div className="tw-packs">
              {packs.map((p, i) => {
                const meta = PACK_META[p.id] ?? { name: p.id, coins: Math.min(4, i + 1) };
                const amount = p.prices[currency] ?? p.prices.USD;
                const cur = p.prices[currency] !== undefined ? currency : "USD";
                return (
                  <article
                    key={p.id}
                    className={`ac-card tw-pack${meta.flag ? " is-flagged" : ""}`}
                    style={{ animationDelay: `${i * 60}ms` }}
                  >
                    {meta.flag ? <span className="tw-flag">{meta.flag}</span> : null}
                    <CoinStack n={meta.coins} />
                    <h3 className="tw-pack-name">{meta.name}</h3>
                    <p className="tw-pack-tokens">
                      {formatTokens(p.tokens + p.bonus)}
                      <small>chips</small>
                    </p>
                    <p className="tw-pack-bonus">
                      {p.bonus > 0 ? (
                        <>
                          <Zap size={13} aria-hidden="true" /> {formatTokens(p.tokens)} + {formatTokens(p.bonus)} bonus
                        </>
                      ) : (
                        "No bonus"
                      )}
                    </p>
                    <button
                      type="button"
                      className={`ac-btn${meta.flag ? " ac-btn-primary" : ""} tw-pack-buy`}
                      disabled={isNative ? !play?.packs[p.id] || busy : amount === undefined || busy}
                      onClick={() =>
                        isNative
                          ? void playRun(() => buyPack(p.id, user.id), `${formatTokens(p.tokens + p.bonus)} chips added!`)
                          : setCheckout({ kind: "pack", pack: p })
                      }
                    >
                      {isNative ? (play ? play.packs[p.id] ?? "Soon" : "…") : amount !== undefined ? formatMoney(amount, cur) : "—"}
                    </button>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      ) : null}

      {/* ---------- subscription (Senevon Plus; "/chips#plus" scrolls here) ---------- */}
      <section className="tw-section" id="plus">
        <div className="ac-section-head">
          <div>
            <h2 className="ac-h2">Senevon Plus</h2>
            <p className="ac-sub">
              The best value: {formatTokens(perMonth)} chips every month, no ads, double daily rewards (+50 bonus a day), Plus-only games and early
              access, and Plus-exclusive shop items free. Everything in DroidDoom unlocked. Cancel any time.
            </p>
          </div>
        </div>
        {sub ? (
          <div className="ac-card tw-sub">
            <span className="tw-icon" aria-hidden="true">
              <Crown size={20} />
            </span>
            <div className="tw-sub-text">
              <p>
                <b>{sub.plan === "monthly" ? "Monthly" : "Yearly"} plan</b>
                <span className={`tw-status ${sub.status}`}>{sub.status === "active" ? "Active" : "Cancelled"}</span>
              </p>
              <p className="ac-sub">
                {formatTokens(perMonth)} chips every month · {formatMoney(Number(sub.amount), sub.currency)}/
                {sub.plan === "monthly" ? "month" : "year"}
              </p>
              <p className="ac-sub">
                {sub.status === "active"
                  ? `Next ${formatTokens(perMonth)} chips on ${fmtDate(sub.next_credit_at)} · renews ${fmtDate(sub.period_end)}`
                  : new Date(sub.next_credit_at) < new Date(sub.period_end)
                    ? `Next ${formatTokens(perMonth)} chips on ${fmtDate(sub.next_credit_at)} · ends ${fmtDate(sub.period_end)}`
                    : `Ends ${fmtDate(sub.period_end)}`}
              </p>
            </div>
            {sub.status === "active" ? (
              <button
                type="button"
                className="ac-btn ac-btn-sm"
                disabled={busy}
                onClick={() =>
                  void run(cancel, "Subscription cancelled. It won't renew; chips you've paid for still arrive until the period ends.")
                }
              >
                Cancel
              </button>
            ) : null}
          </div>
        ) : (
          <div className="tw-plans">
            {(["monthly", "yearly"] as const).map((plan) => {
              const amount = plan === "monthly" ? monthly : yearly;
              const best = plan === "yearly";
              return (
                <article key={plan} className={`ac-card tw-plan${best ? " is-flagged" : ""}`}>
                  {best && savePct > 0 ? <span className="tw-flag">Save {savePct}%</span> : null}
                  <span className="tw-icon" aria-hidden="true">
                    {best ? <Crown size={20} /> : <CalendarClock size={20} />}
                  </span>
                  <h3 className="tw-pack-name">{best ? "Yearly" : "Monthly"}</h3>
                  <p className="tw-price">
                    {isNative ? (play ? play.plus[plan] ?? "Soon" : "…") : amount !== undefined ? formatMoney(amount, currency) : "…"}
                    <small>/{best ? "year" : "month"}</small>
                  </p>
                  <ul className="tw-perks">
                    <li>
                      <Check size={14} aria-hidden="true" /> {formatTokens(perMonth)} chips every month
                    </li>
                    <li>
                      <Check size={14} aria-hidden="true" /> First {formatTokens(perMonth)} straight away
                    </li>
                    <li>
                      <Check size={14} aria-hidden="true" /> {best ? "Billed once a year" : "Cancel any time"}
                    </li>
                  </ul>
                  <button
                    type="button"
                    className={`ac-btn${best ? " ac-btn-primary" : ""}`}
                    disabled={isNative ? !play?.plus[plan] || busy : amount === undefined}
                    onClick={() =>
                      isNative
                        ? void playRun(() => buySubscription(PLUS_PRODUCT, plan, user.id), `Subscribed! ${formatTokens(perMonth)} chips have been added.`)
                        : setCheckout({ kind: "plan", plan })
                    }
                  >
                    Subscribe {plan}
                  </button>
                </article>
              );
            })}
          </div>
        )}
        <p className="tw-fine">
          {isNative ? "Billed through Google Play. " : `Prices shown in ${currency}. `}Unused chips never expire.
          {isNative ? (
            <>
              {" "}
              <button type="button" className="tw-link" onClick={() => void manageSubscriptions()}>
                Manage subscriptions
              </button>
            </>
          ) : null}
        </p>
      </section>

      {/* ---------- ad-free pass ---------- */}
      <section className="tw-section" id="adfree">
        <div className="ac-section-head">
          <div>
            <h2 className="ac-h2">Go ad-free</h2>
            <p className="ac-sub">
              No ads anywhere on Senevon. Ad-free comes with Senevon Plus{isNative ? " or the Google Play ad-free plan" : ""}; it can't be bought with chips.
            </p>
          </div>
        </div>
        <div className="ac-card tw-sub tw-adfree">
          <span className="tw-icon" aria-hidden="true">
            <ShieldCheck size={20} />
          </span>
          <div className="tw-sub-text">
            <p>
              <b>Ad-free</b>
              {noAds ? <span className="tw-status active">Active</span> : null}
            </p>
            <p className="ac-sub">
              {adFree === undefined
                ? "Checking…"
                : adFree === null
                  ? "Not available yet."
                  : adFree.reason === "subscriber"
                    ? "Included with your subscription."
                    : adFree.reason === "pro"
                      ? "Included with Senevon Pro."
                      : adFree.reason === "unlimited"
                        ? "Included with your unlimited account."
                        : adFree.active && adFree.expires_at
                          ? `Ad-free until ${fmtDate(adFree.expires_at)}`
                          : "Hide every ad on the site, including ad breaks."}
            </p>
          </div>
          {adFree && !adFree.active ? (
            <a className="ac-btn ac-btn-sm ac-btn-primary" href="#plus">
              Get Plus
            </a>
          ) : null}
          {isNative && adFree && !adFree.active && play?.adfree ? (
            <button
              type="button"
              className="ac-btn ac-btn-sm"
              disabled={busy}
              onClick={() => void playRun(() => buySubscription(ADFREE_PRODUCT, "monthly", user.id), "You're ad-free! Renews monthly on Google Play.")}
            >
              Ad-free · {play.adfree}/month
            </button>
          ) : null}
        </div>
      </section>

      {/* ---------- shop: every game's items (also sold in each game's own Shop) + avatar frames ---------- */}
      <ShopHub />

      {/* ---------- earn + code ---------- */}
      <div className="tw-row">
        {!noAds ? (
        <section className="ac-card tw-earn">
          <span className="tw-icon" aria-hidden="true">
            <Tv size={20} />
          </span>
          <div className="tw-earn-text">
            <b>Watch an ad · +{wallet?.ad_reward ?? 50} chips</b>
            <p className="ac-sub">{wallet ? `${wallet.ads_today} of ${wallet.ad_daily_cap} watched today` : "Up to 10 a day"}</p>
            {wallet ? (
              <span className="tw-meter" aria-hidden="true">
                <i style={{ width: `${Math.min(100, (wallet.ads_today / Math.max(1, wallet.ad_daily_cap)) * 100)}%` }} />
              </span>
            ) : null}
          </div>
          <button type="button" className="ac-btn ac-btn-sm ac-btn-primary" disabled={!wallet || adsLeft === 0} onClick={() => setAdOpen(true)}>
            Watch
          </button>
        </section>
        ) : null}

        {wallet && !wallet.unlimited ? (
          <section className="ac-card tw-code">
            {codeOpen ? (
              <form className="tw-redeem" onSubmit={(e) => void doRedeem(e)}>
                <KeyRound size={18} aria-hidden="true" />
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Enter redeem code"
                  aria-label="Redeem code"
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  maxLength={64}
                  autoFocus
                />
                <button type="submit" className="ac-btn ac-btn-sm ac-btn-primary" disabled={busy || !code.trim()}>
                  Redeem
                </button>
              </form>
            ) : (
              <>
                <span className="tw-icon" aria-hidden="true">
                  <KeyRound size={20} />
                </span>
                <div className="tw-earn-text">
                  <b>Have a code?</b>
                  <p className="ac-sub">Redeem it for your account.</p>
                </div>
                <button type="button" className="ac-btn ac-btn-sm" onClick={() => setCodeOpen(true)}>
                  Enter code
                </button>
              </>
            )}
          </section>
        ) : null}
      </div>

      {/* ---------- history ---------- */}
      <section className="ac-card tw-history-card">
        <div className="ac-section-head">
          <h2 className="ac-h2">History</h2>
        </div>
        {rows.length ? (
          <ul className="tw-history">
            {rows.map((r) => {
              const meta = REASON[r.reason] ?? REASON.admin;
              const detail =
                (r.reason === "play" && r.ref ? (getGame(r.ref)?.title ?? r.ref) : null) ??
                (r.reason === "purchase" && r.ref ? (PACK_META[r.ref]?.name ?? r.ref) + " pack" : null) ??
                (r.reason === "carrom" && r.ref ? carromRefLabel(r.ref) : null) ??
                (r.reason === "admin" && r.ref ? r.ref : null) ??
                (r.reason === "entry" && r.ref ? entryRefLabel(r.ref, r.delta) : null) ??
                (r.reason === "gift" ? (r.delta < 0 ? "Sent" : "Received") : null) ??
                (r.reason === "club" && r.ref ? clubRefLabel(r.ref) : null);
              return (
                <li key={r.id}>
                  <span className={`tw-h-icon${r.delta >= 0 ? " plus" : ""}`} aria-hidden="true">
                    <meta.Icon size={15} />
                  </span>
                  <span className="tw-h-what">
                    {meta.label}
                    {detail ? <small>{detail}</small> : null}
                  </span>
                  <span className="tw-h-when">{fmtDate(r.created_at)}</span>
                  <b className={r.delta >= 0 ? "plus" : "minus"}>
                    {r.delta >= 0 ? "+" : "−"}
                    {formatTokens(Math.abs(r.delta))}
                  </b>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="ac-sub">No activity yet.</p>
        )}
      </section>

      {/* ---------- test checkout ---------- */}
      {checkout ? (
        <div className="tk-modal" role="dialog" aria-modal="true" aria-label="Checkout" onClick={(e) => e.target === e.currentTarget && setCheckout(null)}>
          <div className="tk-modal-card">
            <button type="button" className="tk-modal-x" onClick={() => setCheckout(null)} aria-label="Close">
              <X size={18} />
            </button>
            <div className="tk-modal-center">
              {mock ? <span className="tk-test-tag">Test checkout · no real payment</span> : null}
              {checkout.kind === "plan" ? (
                <>
                  <h3>{checkout.plan === "monthly" ? "Monthly" : "Yearly"} plan</h3>
                  <p className="tk-price">
                    {formatMoney((checkout.plan === "monthly" ? monthly : yearly) ?? 0, currency)}
                    <small>/{checkout.plan === "monthly" ? "month" : "year"}</small>
                  </p>
                  <p>
                    {formatTokens(perMonth)} chips now, then {formatTokens(perMonth)} every month
                    {checkout.plan === "yearly" ? " for the year" : ""}. Cancel any time.
                  </p>
                </>
              ) : (
                <>
                  <CoinStack n={PACK_META[checkout.pack.id]?.coins ?? 2} />
                  <h3>{PACK_META[checkout.pack.id]?.name ?? checkout.pack.id} pack</h3>
                  <p className="tk-price">
                    {formatMoney(
                      checkout.pack.prices[currency] ?? checkout.pack.prices.USD ?? 0,
                      checkout.pack.prices[currency] !== undefined ? currency : "USD",
                    )}
                  </p>
                  <p>
                    {formatTokens(checkout.pack.tokens + checkout.pack.bonus)} chips
                    {checkout.pack.bonus > 0 ? ` (includes ${formatTokens(checkout.pack.bonus)} bonus)` : ""}, added to your wallet
                    right away. One-off payment.
                  </p>
                </>
              )}
              {mock ? (
                <button type="button" className="tk-btn tk-btn-primary" disabled={busy} onClick={() => void confirmCheckout()}>
                  {busy ? "Processing…" : "Confirm test purchase"}
                </button>
              ) : (
                <>
                  <button type="button" className="tk-btn tk-btn-primary" disabled={busy} onClick={() => void confirmCheckout()}>
                    {busy
                      ? "Waiting for payment…"
                      : `Pay ${
                          checkout.kind === "plan"
                            ? formatMoney((checkout.plan === "monthly" ? monthly : yearly) ?? 0, currency)
                            : formatMoney(
                                checkout.pack.prices[currency] ?? checkout.pack.prices.USD ?? 0,
                                checkout.pack.prices[currency] !== undefined ? currency : "USD",
                              )
                        }`}
                  </button>
                  <p className="tk-muted">
                    Secure payment by Razorpay · UPI, cards, netbanking{checkout.kind === "plan" ? " · renews automatically, cancel any time" : ""}
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <AdRewardModal open={adOpen} onClose={() => setAdOpen(false)} />
    </div>
  );
}
