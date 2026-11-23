/* Admin → Leads: enquiries from the Senevon Interactive page (/business). */
import { useCallback, useEffect, useState } from "react";
import { adminCall } from "../../lib/adminApi";

type Lead = {
  id: number;
  created_at: string;
  name: string;
  organisation: string | null;
  email: string;
  phone: string | null;
  service: string | null;
  budget: string | null;
  message: string;
  status: "new" | "contacted" | "won" | "lost";
  note: string | null;
};

const STATUS: Lead["status"][] = ["new", "contacted", "won", "lost"];
const PILL: Record<Lead["status"], string> = { new: "scheduled", contacted: "outside-hours", won: "live", lost: "expired" };

export default function LeadsTab() {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [msg, setMsg] = useState("");
  const [filter, setFilter] = useState<Lead["status"] | "all">("all");

  const load = useCallback(async () => {
    try {
      setLeads((await adminCall<{ leads: Lead[] }>("leads_list")).leads);
    } catch (e) {
      const m = e instanceof Error ? e.message : "Failed to load";
      setMsg(m.includes("business_enquiries") ? "Run supabase/engagement.sql first." : m);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function update(id: number, patch: { status?: string; note?: string }) {
    try {
      await adminCall("lead_update", { id, ...patch });
      setLeads((cur) => cur?.map((l) => (l.id === id ? ({ ...l, ...patch } as Lead) : l)) ?? null);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to save");
    }
  }

  if (!leads) return <p className="adm-empty">{msg || "Loading…"}</p>;
  const shown = filter === "all" ? leads : leads.filter((l) => l.status === filter);

  return (
    <div className="card adm-card">
      <h3>Business enquiries (Senevon Interactive)</h3>
      <p className="adm-note">
        From the <a href="/business" target="_blank" rel="noreferrer">/business</a> page. {leads.filter((l) => l.status === "new").length} new.
      </p>
      {msg ? <p className="adm-note adm-msg">{msg}</p> : null}
      <div className="dash-periods" role="radiogroup" aria-label="Filter">
        {(["all", ...STATUS] as const).map((s) => (
          <button key={s} type="button" role="radio" aria-checked={filter === s} className={filter === s ? "on" : ""} onClick={() => setFilter(s)}>
            {s}
          </button>
        ))}
      </div>
      {shown.length === 0 ? <p className="adm-empty">No enquiries.</p> : null}
      <ul className="adm-leads">
        {shown.map((l) => (
          <li key={l.id}>
            <div className="adm-lead-top">
              <strong>{l.name}</strong>
              {l.organisation ? <span>· {l.organisation}</span> : null}
              <span className={`adm-pill ${PILL[l.status]}`}>{l.status}</span>
              <time className="adm-note">{new Date(l.created_at).toLocaleString()}</time>
            </div>
            <div className="adm-note">
              <a href={`mailto:${l.email}`}>{l.email}</a>
              {l.phone ? (
                <>
                  {" · "}
                  <a href={`tel:${l.phone}`}>{l.phone}</a>
                </>
              ) : null}
              {l.service ? ` · ${l.service}` : ""}
              {l.budget ? ` · ${l.budget}` : ""}
            </div>
            <p className="adm-lead-msg">{l.message}</p>
            <div className="adm-lead-actions">
              <select value={l.status} onChange={(e) => void update(l.id, { status: e.target.value })} aria-label="Status">
                {STATUS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <input
                defaultValue={l.note ?? ""}
                placeholder="Private note"
                aria-label="Private note"
                onBlur={(e) => e.target.value !== (l.note ?? "") && void update(l.id, { note: e.target.value })}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
