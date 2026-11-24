import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { adminCall, AdminError, clearToken, getToken, login } from "../../lib/adminApi";
import { isSupabaseConfigured } from "../../supabase";
import { games } from "../../catalog";
import { defaultSettings, type SiteSettings } from "../../lib/siteSettings";
import AdsManager from "./AdsManager";
import TokensTab from "./TokensTab";
import DashboardTab from "./DashboardTab";
import EngagementTab from "./EngagementTab";
import LeadsTab from "./LeadsTab";
import { excludeThisDevice, isDeviceExcluded, thisVisitorId } from "../../lib/track";

type Stats = {
  days: number;
  totals: {
    pageviews: number;
    visitors: number;
    todayViews: number;
    todayVisitors: number;
    gameStarts: number;
    gameFinishes: number;
    users: number;
    newUsers: number;
    scoresSaved: number;
  };
  daily: { date: string; views: number; visitors: number }[];
  pages: [string, number][];
  referrers: [string, number][];
  devices: [string, number][];
  hours: number[];
  games: { id: string; starts: number; finishes: number; players: number; avgScore: number }[];
  ads: Record<string, { impressions: number; clicks: number }>;
  recent: { at: string; type: string; path: string | null; game_id: string | null; device: string | null }[];
};

const gameTitle = (id: string) => games.find((g) => g.id === id)?.title ?? id;
const fmt = (n: number) => n.toLocaleString();

/* ---------- small chart pieces (inline SVG, no dependencies) ---------- */

function Bars({ values, labels, color = "var(--accent)" }: { values: number[]; labels: string[]; color?: string }) {
  const max = Math.max(1, ...values);
  const w = 100 / values.length;
  return (
    <svg className="adm-chart" viewBox="0 0 100 40" preserveAspectRatio="none" role="img">
      {values.map((v, i) => {
        const h = (v / max) * 36;
        return (
          <rect key={i} x={i * w + w * 0.12} y={38 - h} width={w * 0.76} height={Math.max(h, 0.4)} rx="0.6" fill={color}>
            <title>{`${labels[i]}: ${v}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

function BarList({ rows, total }: { rows: [string, number][]; total?: number }) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  const sum = total ?? rows.reduce((a, r) => a + r[1], 0);
  if (rows.length === 0) return <p className="adm-empty">No data yet.</p>;
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

/* ---------- login ---------- */

function LoginGate({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await login(pw);
      onDone();
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="adm-login">
      <form className="card adm-login-card" onSubmit={(e) => void submit(e)}>
        <img className="brand-mark-img" src="/logo/mark-256.webp" width={256} height={256} alt="Senevon" />
        <h1>Admin</h1>
        <p className="hero-sub">Enter the admin password.</p>
        <input
          type="password"
          autoFocus
          autoComplete="current-password"
          placeholder="Password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
        />
        {err ? <p className="adm-error">{err}</p> : null}
        <button type="submit" className="primary-btn full" disabled={busy || !pw}>
          {busy ? "Checking…" : "Sign in"}
        </button>
        <Link to="/" className="adm-back">
          ← Back to site
        </Link>
      </form>
    </div>
  );
}

/* ---------- tabs ---------- */

function Traffic({ s }: { s: Stats }) {
  return (
    <div className="adm-cols">
      <div className="card adm-card">
        <h3>Top pages</h3>
        <BarList rows={s.pages} />
      </div>
      <div className="card adm-card">
        <h3>Referrers</h3>
        <BarList rows={s.referrers} />
      </div>
      <div className="card adm-card">
        <h3>Devices</h3>
        <BarList rows={s.devices} />
      </div>
      <div className="card adm-card">
        <h3>Busiest hours (UTC)</h3>
        <Bars values={s.hours} labels={s.hours.map((_, h) => `${h}:00`)} color="#ff9f0a" />
        <div className="adm-axis">
          <span>00:00</span>
          <span>12:00</span>
          <span>23:00</span>
        </div>
      </div>
    </div>
  );
}

function GamesTab({ s }: { s: Stats }) {
  const unplayed = games.filter((g) => !s.games.some((x) => x.id === g.id));
  return (
    <div className="card adm-card">
      <h3>Game activity</h3>
      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr>
              <th>Game</th>
              <th>Starts</th>
              <th>Finishes</th>
              <th>Completion</th>
              <th>Players</th>
              <th>Avg score</th>
            </tr>
          </thead>
          <tbody>
            {s.games.map((g) => (
              <tr key={g.id}>
                <td>
                  <strong>{gameTitle(g.id)}</strong>
                </td>
                <td>{fmt(g.starts)}</td>
                <td>{fmt(g.finishes)}</td>
                <td>{g.starts ? Math.round((g.finishes / g.starts) * 100) + "%" : "–"}</td>
                <td>{fmt(g.players)}</td>
                <td>{g.finishes ? fmt(g.avgScore) : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {s.games.length === 0 ? <p className="adm-empty">No game activity in this range.</p> : null}
      </div>
      {unplayed.length ? (
        <p className="adm-note">Not played in range: {unplayed.map((g) => g.title).join(", ")}.</p>
      ) : null}
    </div>
  );
}

/** "Don't count this device": on for every browser that logs into the admin panel. */
function DeviceSwitch() {
  const [off, setOff] = useState(isDeviceExcluded);
  const [busy, setBusy] = useState(false);
  return (
    <label className="adm-check">
      <input
        type="checkbox"
        checked={off}
        disabled={busy}
        onChange={(e) => {
          const on = e.target.checked;
          setBusy(true);
          excludeThisDevice(on);
          setOff(on);
          void adminCall("exclude_device", { visitor: thisVisitorId(), on }).finally(() => setBusy(false));
        }}
      />
      Don&apos;t count this device in the stats
    </label>
  );
}

function SettingsTab() {
  const [settings, setSettings] = useState<SiteSettings>(defaultSettings);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    void adminCall<{ settings: Partial<SiteSettings> }>("settings_get").then(
      (r) => setSettings({ ...defaultSettings, ...r.settings }),
      (e) => setMsg(e instanceof Error ? e.message : "Failed to load"),
    );
  }, []);

  const set = <K extends keyof SiteSettings>(k: K, v: SiteSettings[K]) => setSettings((s) => ({ ...s, [k]: v }));

  async function save() {
    setMsg("Saving…");
    try {
      await adminCall("settings_save", { settings });
      setMsg("Saved. Visitors pick this up on their next page load.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Save failed");
    }
  }

  return (
    <div className="card adm-card adm-settings">
      <h3>Site settings</h3>
      <label className="adm-check">
        <input type="checkbox" checked={settings.ads_enabled} onChange={(e) => set("ads_enabled", e.target.checked)} />
        Show ads on the home page
      </label>
      <div className="adm-field">
        <label>Ad rotation interval (seconds)</label>
        <input
          type="number"
          min={2}
          max={120}
          value={settings.ad_rotate_seconds}
          onChange={(e) => set("ad_rotate_seconds", Number(e.target.value))}
        />
      </div>
      <label className="adm-check">
        <input
          type="checkbox"
          checked={settings.tracking_enabled}
          onChange={(e) => set("tracking_enabled", e.target.checked)}
        />
        Collect traffic &amp; game analytics
      </label>
      <DeviceSwitch />
      <label className="adm-check">
        <input
          type="checkbox"
          checked={settings.announcement_enabled}
          onChange={(e) => set("announcement_enabled", e.target.checked)}
        />
        Show announcement banner on the home page
      </label>
      <div className="adm-field">
        <label>Announcement text</label>
        <input
          maxLength={280}
          value={settings.announcement_text}
          onChange={(e) => set("announcement_text", e.target.value)}
        />
      </div>
      <div className="adm-actions">
        <button type="button" className="primary-btn" onClick={() => void save()}>
          Save settings
        </button>
        {msg ? <span className="adm-note">{msg}</span> : null}
      </div>
    </div>
  );
}

/* ---------- Pro members ---------- */

type ProMember = { user_id: string; email: string | null; note: string | null; created_at: string };

function ProTab() {
  const [members, setMembers] = useState<ProMember[] | null>(null);
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState("");

  const load = () =>
    adminCall<{ members: ProMember[] }>("pro_list").then(
      (r) => setMembers(r.members),
      (e) => setMsg(e instanceof Error ? e.message : "Failed to load (did you run supabase/pro.sql?)"),
    );
  useEffect(() => {
    void load();
  }, []);

  async function setPro(target: string, on: boolean) {
    setMsg("");
    try {
      await adminCall("pro_set", { email: target, on, note });
      setMsg(on ? `${target} is now Pro.` : `Pro removed from ${target}.`);
      if (on) {
        setEmail("");
        setNote("");
      }
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <div className="card adm-card adm-settings">
      <h3>Senevon Pro</h3>
      <p className="adm-note">
        Pro unlocks every Carrom striker and coin set. Until payments are connected, grant it here by the player's account
        email.
      </p>
      <div className="adm-field">
        <label>Player email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="player@example.com" />
      </div>
      <div className="adm-field">
        <label>Note (optional)</label>
        <input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="e.g. paid via UPI, order #123" />
      </div>
      <div className="adm-actions">
        <button type="button" className="primary-btn" disabled={!email.includes("@")} onClick={() => void setPro(email.trim(), true)}>
          Grant Pro
        </button>
        {msg ? <span className="adm-note">{msg}</span> : null}
      </div>
      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Note</th>
              <th>Since</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(members ?? []).map((m) => (
              <tr key={m.user_id}>
                <td>{m.email ?? m.user_id}</td>
                <td>{m.note ?? "—"}</td>
                <td>{new Date(m.created_at).toLocaleDateString()}</td>
                <td>
                  {m.email ? (
                    <button type="button" className="ghost-btn" onClick={() => void setPro(m.email!, false)}>
                      Remove
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
            {members && !members.length ? (
              <tr>
                <td colSpan={4}>No Pro members yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------- shell ---------- */

type Tab = "overview" | "traffic" | "games" | "engagement" | "leads" | "ads" | "tokens" | "pro" | "settings";
const TABS: [Tab, string][] = [
  ["overview", "Dashboard"],
  ["traffic", "Traffic"],
  ["games", "Games"],
  ["engagement", "Engagement"],
  ["leads", "Leads"],
  ["ads", "Ads"],
  ["tokens", "Chips"],
  ["pro", "Pro"],
  ["settings", "Settings"],
];

function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [days, setDays] = useState(30);
  const [stats, setStats] = useState<Stats | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      setStats(await adminCall<Stats>("stats", { days }));
    } catch (e) {
      if (e instanceof AdminError && e.status === 401) onLogout();
      else setErr(e instanceof Error ? e.message : "Failed to load stats");
    } finally {
      setLoading(false);
    }
  }, [days, onLogout]);

  useEffect(() => {
    void load();
  }, [load]);

  // the admin's own visits never count: this browser is excluded once it's logged in here
  useEffect(() => {
    if (isDeviceExcluded()) return;
    excludeThisDevice();
    void adminCall("exclude_device", { visitor: thisVisitorId() }).catch(() => undefined);
  }, []);

  return (
    <div className="adm">
      <header className="adm-bar">
        <div className="adm-bar-in">
          <Link to="/" className="brand">
            <img className="brand-mark-img" src="/logo/mark-256.webp" width={256} height={256} alt="Senevon" />
            Admin
          </Link>
          <nav className="adm-tabs">
            {TABS.map(([id, label]) => (
              <button key={id} type="button" className={tab === id ? "on" : ""} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </nav>
          <div className="adm-bar-right">
            {(tab === "traffic" || tab === "games") ? (
              <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Date range">
                <option value={7}>Last 7 days</option>
                <option value={30}>Last 30 days</option>
                <option value={90}>Last 90 days</option>
              </select>
            ) : null}
            <button type="button" className="adm-ghost" onClick={() => void load()} disabled={loading}>
              {loading ? "…" : "Refresh"}
            </button>
            <button type="button" className="adm-ghost" onClick={onLogout}>
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="adm-main">
        {err ? <p className="adm-error">{err}</p> : null}
        {tab === "overview" ? <DashboardTab /> : null}
        {tab === "traffic" && stats ? <Traffic s={stats} /> : null}
        {tab === "games" && stats ? <GamesTab s={stats} /> : null}
        {tab === "ads" ? <AdsManager stats={stats?.ads} /> : null}
        {tab === "settings" ? <SettingsTab /> : null}
        {tab === "engagement" ? <EngagementTab /> : null}
        {tab === "leads" ? <LeadsTab /> : null}
        {tab === "pro" ? <ProTab /> : null}
        {tab === "tokens" ? <TokensTab /> : null}
        {!stats && !err && (tab === "traffic" || tab === "games") ? <p className="adm-empty">Loading…</p> : null}
      </main>
    </div>
  );
}

export default function Admin() {
  const [authed, setAuthed] = useState(() => Boolean(getToken()));

  const logout = useCallback(() => {
    clearToken();
    setAuthed(false);
  }, []);

  if (!isSupabaseConfigured) {
    return (
      <div className="adm-login">
        <div className="card adm-login-card">
          <h1>Admin</h1>
          <p className="hero-sub">Supabase is not configured, so the admin panel is unavailable.</p>
        </div>
      </div>
    );
  }

  return authed ? <Dashboard onLogout={logout} /> : <LoginGate onDone={() => setAuthed(true)} />;
}
