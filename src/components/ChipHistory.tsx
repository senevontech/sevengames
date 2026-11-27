/* Chip history, as a collapsible card: the Chips page "History" and the profile "Chip usage".
   Closed by default. The latest 25 entries are fetched only when it is opened (then again
   whenever the balance changes while open); 8 show at first, "Show all" reveals the rest. */
import { useEffect, useId, useState } from "react";
import { CalendarClock, Check, ChevronDown, Coins, Crown, Gamepad2, Gift, HandCoins, ShieldCheck, ShoppingBag, Sparkles, Tv, Users, Zap, type LucideIcon } from "./anim-icons";
import { useTokens, type LedgerRow } from "../lib/tokens";
import { formatTokens } from "../lib/currency";
import { getGame } from "../catalog";
import "./chip-history.css";

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

/** chip packs: also used by the Chips page's pack cards and checkout */
export const PACK_META: Record<string, { name: string; flag?: string; coins: number }> = {
  starter: { name: "Starter", coins: 1 },
  player: { name: "Player", flag: "Most popular", coins: 2 },
  pro: { name: "Pro", coins: 3 },
  legend: { name: "Legend", flag: "Best value", coins: 4 },
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

/** "striker:neon" → "Neon striker", "upgrade:gold:power:7" → "Gold power → Lv 7" */
function carromRefLabel(ref: string) {
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
  const p = ref.split(":");
  if (p[0] === "upgrade" && p.length === 4) return `${cap(p[1])} ${p[2]} → Lv ${p[3]}`;
  if (p.length === 2) return `${cap(p[1])} ${p[0] === "coins" ? "coin set" : p[0]}`;
  return ref;
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

function detailOf(r: LedgerRow) {
  if (!r.ref) return r.reason === "gift" ? (r.delta < 0 ? "Sent" : "Received") : null;
  switch (r.reason) {
    case "play":
      return getGame(r.ref)?.title ?? r.ref;
    case "purchase":
      return `${PACK_META[r.ref]?.name ?? r.ref} pack`;
    case "carrom":
      return carromRefLabel(r.ref);
    case "admin":
      return r.ref;
    case "entry":
      return entryRefLabel(r.ref, r.delta);
    case "gift":
      return r.delta < 0 ? "Sent" : "Received";
    case "club":
      return clubRefLabel(r.ref);
    default:
      return null;
  }
}

const FIRST = 8;

export default function ChipHistory({ title = "History", sub = "Every chip in and out, newest first.", className = "" }: { title?: string; sub?: string; className?: string }) {
  const { wallet, history } = useTokens();
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const [rows, setRows] = useState<LedgerRow[] | null>(null);
  const bodyId = useId();

  // fetch on open, and again when the balance changes while open
  const balance = wallet?.balance;
  useEffect(() => {
    if (!open || balance === undefined) return;
    let live = true;
    void history().then((r) => live && setRows(r));
    return () => {
      live = false;
    };
  }, [open, balance, history]);

  const shown = rows ? (all ? rows : rows.slice(0, FIRST)) : [];

  return (
    <section className={`ac-card ch-card${open ? " is-open" : ""}${className ? ` ${className}` : ""}`}>
      <button type="button" className="ch-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((o) => !o)}>
        <span className="ch-toggle-text">
          <span className="ac-h2">{title}</span>
          <span className="ac-sub">{sub}</span>
        </span>
        <span className="ch-chev" aria-hidden="true">
          <ChevronDown size={18} />
        </span>
      </button>

      <div className="ch-body" id={bodyId} role="region" aria-label={title} inert={!open}>
        <div className="ch-body-inner">
          {rows === null ? (
            <p className="ac-sub">Loading…</p>
          ) : rows.length ? (
            <>
              <ul className="tw-history">
                {shown.map((r) => {
                  const meta = REASON[r.reason] ?? REASON.admin;
                  const detail = detailOf(r);
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
              {rows.length > FIRST ? (
                <button type="button" className="ac-btn ac-btn-sm ac-btn-ghost ch-more" onClick={() => setAll((a) => !a)}>
                  {all ? "Show less" : `Show all ${rows.length}`}
                </button>
              ) : null}
            </>
          ) : (
            <p className="ac-sub">No activity yet.</p>
          )}
        </div>
      </div>
    </section>
  );
}
