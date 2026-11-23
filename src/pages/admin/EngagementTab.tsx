/* Admin → Engagement: the weekly competition game, tournaments, and Plus-only / early-access games.
   Server: admin Edge Function → engagement.sql tables. */
import { useCallback, useEffect, useState } from "react";
import { adminCall } from "../../lib/adminApi";
import { games } from "../../catalog";
import ChatPacksAdmin from "./ChatPacksAdmin";

type Week = { week_start: string; game_id: string; set_by_admin: boolean; settled_at: string | null };
type Tour = {
  id: string;
  title: string;
  game_id: string;
  entry_fee: number;
  bonus: number;
  prize_pct: number[];
  starts_at: string;
  ends_at: string;
  settled_at: string | null;
  entrants: number;
};
type Data = { weeks: Week[]; tournaments: Tour[]; access: { game_id: string; mode: "plus" | "early" }[]; tournaments_enabled: boolean };

const builtin = games.filter((g) => g.kind === "builtin");
const scoreGames = builtin.filter((g) => !["chess", "ludo"].includes(g.kind === "builtin" ? g.engine : ""));
const title = (id: string) => games.find((g) => g.id === id)?.title ?? id;

/** Monday (yyyy-mm-dd) of the week containing `d`, in India time (weeks run Mon–Sun IST). */
function mondayIST(d: Date) {
  const ist = new Date(d.getTime() + 5.5 * 3_600_000);
  const day = (ist.getUTCDay() + 6) % 7;
  ist.setUTCDate(ist.getUTCDate() - day);
  return ist.toISOString().slice(0, 10);
}

const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

export default function EngagementTab() {
  const [d, setD] = useState<Data | null>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    try {
      setD(await adminCall<Data>("engagement_get"));
    } catch (e) {
      const m = e instanceof Error ? e.message : "Failed to load";
      setMsg(m.includes("weekly_games") || m.includes("does not exist") ? "Run supabase/engagement.sql first." : m);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function call(action: string, body: Record<string, unknown>, done: string) {
    setMsg("");
    try {
      await adminCall(action, body);
      setMsg(done);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    }
  }

  if (!d) return <p className="adm-empty">{msg || "Loading…"}</p>;

  const weeks = [0, 1, 2, 3].map((i) => mondayIST(new Date(Date.now() + i * 7 * 86_400_000)));
  const access = Object.fromEntries(d.access.map((a) => [a.game_id, a.mode]));

  return (
    <div className="dash">
      {msg ? <p className="adm-note adm-msg">{msg}</p> : null}

      {/* ---------- weekly competition ---------- */}
      <div className="card adm-card adm-settings">
        <h3>Weekly competition</h3>
        <p className="adm-note">
          Weeks run Monday to Sunday (India time). Best score in the week's game wins: 2,000 / 1,000 / 500 tokens, then 100 for places 4–10, paid
          automatically when the week ends. "Automatic" picks from a rotation of score games.
        </p>
        <table className="adm-table">
          <thead>
            <tr>
              <th>Week of</th>
              <th>Game</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((w, i) => {
              const row = d.weeks.find((x) => x.week_start === w);
              return (
                <tr key={w}>
                  <td>
                    {w} {i === 0 ? <span className="adm-pill live">this week</span> : null}
                  </td>
                  <td>
                    <select
                      value={row?.set_by_admin ? row.game_id : ""}
                      onChange={(e) => void call("weekly_set", { week_start: w, game_id: e.target.value }, e.target.value ? `Week of ${w}: ${title(e.target.value)}` : `Week of ${w}: automatic`)}
                    >
                      <option value="">Automatic{row && !row.set_by_admin ? ` (${title(row.game_id)})` : ""}</option>
                      {scoreGames.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.title}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {d.weeks.filter((w) => w.settled_at).length ? (
          <p className="adm-note">
            Finished: {d.weeks.filter((w) => w.settled_at).map((w) => `${w.week_start} ${title(w.game_id)}`).join(" · ")}
          </p>
        ) : null}
      </div>

      {/* ---------- Plus-only / early access ---------- */}
      <div className="card adm-card adm-settings">
        <h3>Plus-only and early-access games</h3>
        <p className="adm-note">Plus only: only Senevon Plus members can play it. Early access: same, shown as "early access" until you set it back to Everyone.</p>
        <div className="adm-table-wrap">
          <table className="adm-table">
            <tbody>
              {builtin.map((g) => (
                <tr key={g.id}>
                  <td>{g.title}</td>
                  <td>
                    <select
                      value={access[g.id] ?? ""}
                      onChange={(e) =>
                        void call("game_access_set", { game_id: g.id, mode: e.target.value || null }, `${g.title}: ${e.target.value ? (e.target.value === "plus" ? "Plus only" : "early access") : "everyone"}`)
                      }
                    >
                      <option value="">Everyone</option>
                      <option value="plus">Plus only</option>
                      <option value="early">Early access (Plus)</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---------- tournaments ---------- */}
      <Tournaments d={d} call={call} />

      {/* ---------- custom sticker packs ---------- */}
      <ChatPacksAdmin />
    </div>
  );
}

function Tournaments({ d, call }: { d: Data; call: (a: string, b: Record<string, unknown>, done: string) => Promise<void> }) {
  const now = Date.now();
  const blank = {
    id: "",
    title: "",
    game_id: scoreGames[0]?.id ?? "",
    entry_fee: "100",
    bonus: "0",
    prize: "50, 30, 20",
    starts_at: toLocalInput(new Date(now + 3_600_000).toISOString()),
    ends_at: toLocalInput(new Date(now + 3 * 86_400_000).toISOString()),
  };
  const [f, setF] = useState(blank);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((c) => ({ ...c, [k]: e.target.value }));

  return (
    <div className="card adm-card adm-settings">
      <h3>Tournaments</h3>
      <label className="adm-check">
        <input
          type="checkbox"
          checked={d.tournaments_enabled}
          onChange={(e) => void call("tournaments_toggle", { on: e.target.checked }, e.target.checked ? "Tournaments are ON for players." : "Tournaments are hidden.")}
        />
        Show tournaments to players
      </label>
      <p className="adm-note">
        ⚠️ Players pay an entry fee in tokens and win tokens. Tokens can be bought with real money, so paid-entry contests may fall under India's online
        money-gaming rules. Get legal advice before switching this on. Entry-free tournaments with a bonus prize (entry fee 0) are the safer option.
      </p>

      <form
        className="adm-form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          void call(
            "tournament_save",
            {
              id: f.id || undefined,
              title: f.title,
              game_id: f.game_id,
              entry_fee: Number(f.entry_fee),
              bonus: Number(f.bonus),
              prize_pct: f.prize.split(/[,\s]+/).filter(Boolean).map(Number),
              starts_at: new Date(f.starts_at).toISOString(),
              ends_at: new Date(f.ends_at).toISOString(),
            },
            f.id ? "Tournament updated." : "Tournament created.",
          ).then(() => setF(blank));
        }}
      >
        <label>
          Title
          <input required minLength={3} maxLength={80} value={f.title} onChange={set("title")} />
        </label>
        <label>
          Game
          <select value={f.game_id} onChange={set("game_id")}>
            {scoreGames.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Entry fee (tokens)
          <input type="number" min={0} value={f.entry_fee} onChange={set("entry_fee")} />
        </label>
        <label>
          Bonus added to prizes
          <input type="number" min={0} value={f.bonus} onChange={set("bonus")} />
        </label>
        <label>
          Prize split % (1st, 2nd…)
          <input value={f.prize} onChange={set("prize")} />
        </label>
        <label>
          Starts
          <input type="datetime-local" required value={f.starts_at} onChange={set("starts_at")} />
        </label>
        <label>
          Ends
          <input type="datetime-local" required value={f.ends_at} onChange={set("ends_at")} />
        </label>
        <div className="adm-form-actions">
          <button type="submit" className="primary-btn">
            {f.id ? "Save changes" : "Create tournament"}
          </button>
          {f.id ? (
            <button type="button" className="adm-ghost" onClick={() => setF(blank)}>
              Cancel edit
            </button>
          ) : null}
        </div>
      </form>

      {d.tournaments.length ? (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>Tournament</th>
                <th>When</th>
                <th>Entry</th>
                <th>Players</th>
                <th>Prize pool</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {d.tournaments.map((t) => (
                <tr key={t.id}>
                  <td>
                    <strong>{t.title}</strong>
                    <div className="adm-note">{title(t.game_id)}</div>
                  </td>
                  <td>
                    {new Date(t.starts_at).toLocaleString()} →<br />
                    {new Date(t.ends_at).toLocaleString()}
                    <div>
                      {t.settled_at ? (
                        <span className="adm-pill">finished</span>
                      ) : new Date(t.starts_at).getTime() > now ? (
                        <span className="adm-pill scheduled">upcoming</span>
                      ) : (
                        <span className="adm-pill live">running</span>
                      )}
                    </div>
                  </td>
                  <td>{t.entry_fee}</td>
                  <td>{t.entrants}</td>
                  <td>
                    {t.entry_fee * t.entrants + t.bonus} <span className="adm-note">({t.prize_pct.join("/")}%)</span>
                  </td>
                  <td>
                    {!t.settled_at ? (
                      <button
                        type="button"
                        className="adm-ghost"
                        onClick={() =>
                          setF({
                            id: t.id,
                            title: t.title,
                            game_id: t.game_id,
                            entry_fee: String(t.entry_fee),
                            bonus: String(t.bonus),
                            prize: t.prize_pct.join(", "),
                            starts_at: toLocalInput(t.starts_at),
                            ends_at: toLocalInput(t.ends_at),
                          })
                        }
                      >
                        Edit
                      </button>
                    ) : null}
                    {t.entrants === 0 ? (
                      <button type="button" className="adm-ghost" onClick={() => void call("tournament_delete", { id: t.id }, "Tournament deleted.")}>
                        Delete
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="adm-note">No tournaments yet.</p>
      )}
    </div>
  );
}
