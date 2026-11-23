/* Admin → Dashboard: the important numbers for a period, each compared with the period before.
   Clicking a card opens its detail page (daily chart, breakdowns, latest entries).
   Data: admin Edge Function → admin_dashboard() / admin_detail() (supabase/analytics.sql). */
import { useCallback, useEffect, useState } from "react";
import { adminCall } from "../../lib/adminApi";
import { games } from "../../catalog";
import "./admin-dashboard.css";

type Period = "today" | "7" | "30" | "90";
const PERIODS: [Period, string][] = [
  ["today", "Today"],
  ["7", "7 days"],
  ["30", "30 days"],
  ["90", "90 days"],
];

type Metric = "signups" | "signins" | "active" | "traffic" | "games" | "matches" | "money" | "tokens";

type Nums = {
  users_total: number;
  signups: number;
  signins: number;
  active_users: number;
  views: number;
  views_web: number;
  views_app: number;
  visitors: number;
  visitors_web: number;
  visitors_app: number;
  game_starts: number;
  game_finishes: number;
  players: number;
  online_matches: number;
  scores_saved: number;
  revenue: Record<string, number>;
  purchases_web: number;
  purchases_app: number;
  new_subs: number;
  active_subs: number;
  adfree_active: number;
  tokens_earned: number;
  tokens_spent: number;
  shop_sales: number;
  ad_rewards: number;
};

type Kpis = {
  dau: number;
  mau: number;
  d1: number | null;
  d7: number | null;
  d30: number | null;
  session_minutes: number;
  games_per_session: number;
  sessions: number;
  conversion: number | null;
  payers: number;
  arpdau_inr: number | null;
  sub_retention: number | null;
};

type Detail = {
  labels: string[];
  series: { d: string; a: number; b?: number }[] | null;
  breakdowns: { title: string; rows: [string, number][] }[];
  table: { columns: string[]; rows: unknown[][] };
};

const fmt = (n: number) => Math.round(n).toLocaleString();
const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/** The period as [from, to): today = since local midnight; N days = the last N days including today. */
function range(p: Period) {
  const to = new Date();
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  if (p !== "today") from.setDate(from.getDate() - (Number(p) - 1));
  return { from: from.toISOString(), to: to.toISOString() };
}

const gameName = (id: string) => games.find((g) => g.id === id || (g.kind === "builtin" && g.engine === id))?.title ?? id;

function Change({ cur, prev }: { cur: number; prev: number | undefined }) {
  if (prev === undefined) return null;
  if (prev === 0) return cur > 0 ? <span className="dash-chg up">new</span> : <span className="dash-chg">–</span>;
  const pct = Math.round(((cur - prev) / prev) * 100);
  return (
    <span className={`dash-chg${pct > 0 ? " up" : pct < 0 ? " down" : ""}`} title={`Previous period: ${fmt(prev)}`}>
      {pct > 0 ? "▲" : pct < 0 ? "▼" : ""} {Math.abs(pct)}%
    </span>
  );
}

function Card({
  label,
  value,
  cur,
  prev,
  sub,
  onOpen,
}: {
  label: string;
  value: string;
  cur?: number;
  prev?: number;
  sub?: string;
  onOpen?: () => void;
}) {
  const body = (
    <>
      <span className="dash-label">{label}</span>
      <strong>{value}</strong>
      <span className="dash-foot">
        {cur !== undefined ? <Change cur={cur} prev={prev} /> : null}
        {sub ? <small>{sub}</small> : null}
      </span>
      {onOpen ? <span className="dash-more" aria-hidden="true">Details →</span> : null}
    </>
  );
  return onOpen ? (
    <button type="button" className="dash-card is-link" onClick={onOpen}>
      {body}
    </button>
  ) : (
    <div className="dash-card">{body}</div>
  );
}

const money = (r: Record<string, number>) => {
  const e = Object.entries(r ?? {});
  if (!e.length) return "0";
  return e.map(([c, n]) => new Intl.NumberFormat(undefined, { style: "currency", currency: c, maximumFractionDigits: 0 }).format(n)).join(" + ");
};
const sumMoney = (r: Record<string, number>) => Object.values(r ?? {}).reduce((a, b) => a + b, 0);

export default function DashboardTab() {
  const [period, setPeriod] = useState<Period>("7");
  const [data, setData] = useState<{ cur: Nums; prev: Nums; kpis?: Kpis | null } | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<{ metric: Metric; title: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      setData(await adminCall<{ cur: Nums; prev: Nums; kpis?: Kpis | null }>("dashboard", { ...range(period), tz: tz() }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load";
      setErr(msg.includes("admin_dashboard") ? "The dashboard isn't set up yet: run supabase/analytics.sql." : msg);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    void load();
  }, [load]);

  const periodBar = (
    <div className="dash-bar">
      <div className="dash-periods" role="radiogroup" aria-label="Period">
        {PERIODS.map(([id, label]) => (
          <button key={id} type="button" role="radio" aria-checked={period === id} className={period === id ? "on" : ""} onClick={() => setPeriod(id)}>
            {label}
          </button>
        ))}
      </div>
      <span className="dash-hint">Compared with the {period === "today" ? "same time yesterday" : `previous ${period} days`}</span>
      <button type="button" className="adm-ghost" onClick={() => void load()} disabled={loading}>
        {loading ? "…" : "Refresh"}
      </button>
    </div>
  );

  if (open) return <DetailPage metric={open.metric} title={open.title} period={period} onBack={() => setOpen(null)} />;

  const c = data?.cur;
  const p = data?.prev;
  const go = (metric: Metric, title: string) => () => setOpen({ metric, title });

  return (
    <div className="dash">
      {periodBar}
      {err ? <p className="adm-error">{err}</p> : null}
      {!c ? (
        !err ? <p className="adm-empty">Loading…</p> : null
      ) : (
        <>
          {data?.kpis ? <KpiSection k={data.kpis} /> : null}

          <section className="dash-group">
            <h3>Players</h3>
            <div className="dash-grid">
              <Card label="Sign-ins" value={fmt(c.signins)} cur={c.signins} prev={p?.signins} sub="logins" onOpen={go("signins", "Sign-ins")} />
              <Card label="New sign-ups" value={fmt(c.signups)} cur={c.signups} prev={p?.signups} onOpen={go("signups", "New sign-ups")} />
              <Card label="Active accounts" value={fmt(c.active_users)} cur={c.active_users} prev={p?.active_users} sub="signed in and used the site" onOpen={go("active", "Active accounts")} />
              <Card label="Total accounts" value={fmt(c.users_total)} sub="all time" onOpen={go("signups", "New sign-ups")} />
            </div>
          </section>

          <section className="dash-group">
            <h3>Traffic</h3>
            <div className="dash-grid">
              <Card
                label="Page views"
                value={fmt(c.views)}
                cur={c.views}
                prev={p?.views}
                sub={`web ${fmt(c.views_web)} · app ${fmt(c.views_app)}`}
                onOpen={go("traffic", "Traffic")}
              />
              <Card
                label="Unique visitors"
                value={fmt(c.visitors)}
                cur={c.visitors}
                prev={p?.visitors}
                sub={`web ${fmt(c.visitors_web)} · app ${fmt(c.visitors_app)}`}
                onOpen={go("traffic", "Traffic")}
              />
            </div>
          </section>

          <section className="dash-group">
            <h3>Games</h3>
            <div className="dash-grid">
              <Card label="Games played" value={fmt(c.game_starts)} cur={c.game_starts} prev={p?.game_starts} sub={`${fmt(c.game_finishes)} finished`} onOpen={go("games", "Games")} />
              <Card label="Players" value={fmt(c.players)} cur={c.players} prev={p?.players} sub="different visitors who played" onOpen={go("games", "Games")} />
              <Card label="Online matches" value={fmt(c.online_matches)} cur={c.online_matches} prev={p?.online_matches} onOpen={go("matches", "Online matches")} />
              <Card label="Scores saved" value={fmt(c.scores_saved)} cur={c.scores_saved} prev={p?.scores_saved} />
            </div>
          </section>

          <section className="dash-group">
            <h3>Money</h3>
            <div className="dash-grid">
              <Card label="Website revenue" value={money(c.revenue)} cur={sumMoney(c.revenue)} prev={p ? sumMoney(p.revenue) : undefined} sub="Razorpay" onOpen={go("money", "Purchases & revenue")} />
              <Card
                label="Purchases"
                value={fmt(c.purchases_web + c.purchases_app)}
                cur={c.purchases_web + c.purchases_app}
                prev={p ? p.purchases_web + p.purchases_app : undefined}
                sub={`web ${fmt(c.purchases_web)} · app ${fmt(c.purchases_app)}`}
                onOpen={go("money", "Purchases & revenue")}
              />
              <Card label="New subscriptions" value={fmt(c.new_subs)} cur={c.new_subs} prev={p?.new_subs} sub={`${fmt(c.active_subs)} active now`} onOpen={go("money", "Purchases & revenue")} />
              <Card label="Ad-free players" value={fmt(c.adfree_active)} sub="pass active now" />
            </div>
          </section>

          <section className="dash-group">
            <h3>Tokens</h3>
            <div className="dash-grid">
              <Card label="Tokens earned" value={fmt(c.tokens_earned)} cur={c.tokens_earned} prev={p?.tokens_earned} onOpen={go("tokens", "Tokens")} />
              <Card label="Tokens spent" value={fmt(c.tokens_spent)} cur={c.tokens_spent} prev={p?.tokens_spent} onOpen={go("tokens", "Tokens")} />
              <Card label="Shop sales" value={fmt(c.shop_sales)} cur={c.shop_sales} prev={p?.shop_sales} onOpen={go("tokens", "Tokens")} />
              <Card label="Rewarded ads watched" value={fmt(c.ad_rewards)} cur={c.ad_rewards} prev={p?.ad_rewards} onOpen={go("tokens", "Tokens")} />
            </div>
          </section>
        </>
      )}
    </div>
  );
}

/* ---------- KPIs (business plan) ---------- */
const pct = (v: number | null | undefined) => (v === null || v === undefined ? "–" : `${v}%`);

function KpiSection({ k }: { k: Kpis }) {
  const stick = k.mau ? Math.round((k.dau / k.mau) * 100) : null;
  return (
    <section className="dash-group">
      <h3>Key metrics</h3>
      <div className="dash-grid">
        <Card label="DAU (daily active)" value={fmt(k.dau)} sub="average per day, signed-in players" />
        <Card label="MAU (monthly active)" value={fmt(k.mau)} sub={stick !== null ? `stickiness ${stick}% (DAU/MAU)` : "last 30 days"} />
        <Card label="Retention D1 · D7 · D30" value={`${pct(k.d1)} · ${pct(k.d7)} · ${pct(k.d30)}`} sub="of players who signed up in this period" />
        <Card label="Avg session" value={`${k.session_minutes} min`} sub={`${fmt(k.sessions)} sessions`} />
        <Card label="Games per session" value={String(k.games_per_session)} />
        <Card label="Conversion" value={pct(k.conversion)} sub={`${fmt(k.payers)} paying players`} />
        <Card label="ARPDAU" value={k.arpdau_inr === null ? "–" : `₹${k.arpdau_inr}`} sub="website revenue ÷ daily actives" />
        <Card label="Subscription retention" value={pct(k.sub_retention)} sub="subscribers 30+ days in, still active" />
      </div>
    </section>
  );
}

/* ---------- detail page ---------- */

function DetailPage({ metric, title, period, onBack }: { metric: Metric; title: string; period: Period; onBack: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    setD(null);
    setErr("");
    adminCall<Detail>("dashboard_detail", { metric, tz: tz(), ...range(period) }).then(
      (r) => alive && setD(r),
      (e) => alive && setErr(e instanceof Error ? e.message : "Failed to load"),
    );
    return () => {
      alive = false;
    };
  }, [metric, period]);

  const series = d?.series ?? [];
  const totalA = series.reduce((s, x) => s + (x.a || 0), 0);
  const totalB = series.reduce((s, x) => s + (x.b || 0), 0);

  return (
    <div className="dash">
      <div className="dash-bar">
        <button type="button" className="adm-ghost" onClick={onBack}>
          ← Dashboard
        </button>
        <h2 className="dash-title">{title}</h2>
        <span className="dash-hint">{PERIODS.find(([id]) => id === period)?.[1]}</span>
      </div>
      {err ? <p className="adm-error">{err}</p> : null}
      {!d ? (
        !err ? <p className="adm-empty">Loading…</p> : null
      ) : (
        <>
          <div className="card adm-card">
            <div className="dash-legend">
              <span>
                <i className="a" /> {d.labels[0]} <b>{fmt(totalA)}</b>
              </span>
              {d.labels[1] ? (
                <span>
                  <i className="b" /> {d.labels[1]} {metric === "signins" || metric === "traffic" ? <small>(per day)</small> : <b>{fmt(totalB)}</b>}
                </span>
              ) : null}
            </div>
            <DayBars series={series} two={Boolean(d.labels[1])} />
          </div>

          {d.breakdowns.length ? (
            <div className="adm-cols">
              {d.breakdowns.map((b) => (
                <div key={b.title} className="card adm-card">
                  <h3>{b.title}</h3>
                  <Breakdown rows={b.rows.map(([k, n]) => [metric === "games" || metric === "matches" ? gameName(String(k)) : String(k), Number(n)])} />
                </div>
              ))}
            </div>
          ) : null}

          <div className="card adm-card">
            <h3>{metric === "games" ? "Per game" : "Latest"}</h3>
            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead>
                  <tr>
                    {d.table.columns.map((col) => (
                      <th key={col}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {d.table.rows.map((row, i) => (
                    <tr key={i}>
                      {row.map((cell, j) => (
                        <td key={j}>{cellText(cell, d.table.columns[j], metric)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {d.table.rows.length === 0 ? <p className="adm-empty">Nothing in this period.</p> : null}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const ISO = /^\d{4}-\d{2}-\d{2}T/;
function cellText(v: unknown, column: string, metric: Metric) {
  if (v === null || v === undefined || v === "") return "–";
  if (typeof v === "string" && ISO.test(v)) return new Date(v).toLocaleString();
  if (column === "Game" && (metric === "games" || metric === "matches")) return gameName(String(v));
  if (typeof v === "number") return column === "Change" || column === "XP" ? (v > 0 ? `+${fmt(v)}` : fmt(v)) : fmt(v);
  return String(v);
}

function DayBars({ series, two }: { series: { d: string; a: number; b?: number }[]; two: boolean }) {
  const max = Math.max(1, ...series.map((s) => Math.max(s.a || 0, two ? s.b || 0 : 0)));
  const n = Math.max(1, series.length);
  const w = 100 / n;
  return (
    <>
      <svg className="adm-chart dash-chart" viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label="Per day">
        {series.map((s, i) => {
          const ha = ((s.a || 0) / max) * 36;
          const hb = ((s.b || 0) / max) * 36;
          const bw = two ? w * 0.36 : w * 0.72;
          return (
            <g key={s.d}>
              <rect x={i * w + w * 0.14} y={38 - ha} width={bw} height={Math.max(ha, 0.4)} rx="0.5" className="dash-a">
                <title>{`${s.d}: ${fmt(s.a || 0)}`}</title>
              </rect>
              {two ? (
                <rect x={i * w + w * 0.14 + bw} y={38 - hb} width={bw} height={Math.max(hb, 0.4)} rx="0.5" className="dash-b">
                  <title>{`${s.d}: ${fmt(s.b || 0)}`}</title>
                </rect>
              ) : null}
            </g>
          );
        })}
      </svg>
      <div className="adm-axis">
        <span>{series[0]?.d}</span>
        <span>{series[series.length - 1]?.d}</span>
      </div>
    </>
  );
}

function Breakdown({ rows }: { rows: [string, number][] }) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  const sum = rows.reduce((a, r) => a + r[1], 0);
  if (!rows.length) return <p className="adm-empty">No data in this period.</p>;
  return (
    <ul className="adm-barlist">
      {rows.map(([label, n]) => (
        <li key={label}>
          <span className="adm-bl-fill" style={{ width: `${(n / max) * 100}%` }} />
          <span className="adm-bl-label">{label}</span>
          <span className="adm-bl-n">
            {fmt(n)}
            {sum ? <small> {Math.round((n / sum) * 100)}%</small> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
