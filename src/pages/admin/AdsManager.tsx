import { useCallback, useEffect, useState } from "react";
import { adminCall, uploadImage } from "../../lib/adminApi";
import { adState, placementLabel, type Ad, type AdPlacement } from "../../lib/ads";

type Draft = {
  id?: string;
  title: string;
  link_url: string;
  cover_url: string;
  thumb_url: string;
  body: string;
  cta_label: string;
  active: boolean;
  starts_at: string; // datetime-local
  ends_at: string;
  daily_start: string; // HH:MM
  daily_end: string;
  max_impressions: string;
  sort_order: string;
  placement: AdPlacement;
};

const blank: Draft = {
  title: "",
  link_url: "",
  cover_url: "",
  thumb_url: "",
  body: "",
  cta_label: "Learn more",
  active: true,
  starts_at: "",
  ends_at: "",
  daily_start: "",
  daily_end: "",
  max_impressions: "",
  sort_order: "0",
  placement: "all",
};

const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const fromAd = (ad: Ad): Draft => ({
  id: ad.id,
  title: ad.title,
  link_url: ad.link_url,
  cover_url: ad.cover_url ?? "",
  thumb_url: ad.thumb_url ?? "",
  body: ad.body ?? "",
  cta_label: ad.cta_label,
  active: ad.active,
  starts_at: toLocalInput(ad.starts_at),
  ends_at: toLocalInput(ad.ends_at),
  daily_start: ad.daily_start?.slice(0, 5) ?? "",
  daily_end: ad.daily_end?.slice(0, 5) ?? "",
  max_impressions: ad.max_impressions ? String(ad.max_impressions) : "",
  sort_order: String(ad.sort_order),
  placement: ad.placement ?? "all",
});

function ImageField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (url: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setErr("");
    try {
      onChange(await uploadImage(file));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="adm-field">
      <label>{label}</label>
      <div className="adm-image-row">
        {value ? <img src={value} alt="" className="adm-preview" /> : <div className="adm-preview empty" />}
        <div className="adm-image-ctl">
          <input type="file" accept="image/*" disabled={busy} onChange={(e) => void pick(e.target.files?.[0])} />
          <input
            type="url"
            placeholder="…or paste an image URL"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
          <small>{busy ? "Uploading to Cloudinary…" : hint}</small>
          {err ? <small className="adm-error">{err}</small> : null}
        </div>
      </div>
    </div>
  );
}

const stateLabel: Record<ReturnType<typeof adState>, string> = {
  live: "Live",
  scheduled: "Scheduled",
  expired: "Expired",
  capped: "Cap reached",
  "outside-hours": "Outside hours",
  paused: "Paused",
};

export default function AdsManager({ stats }: { stats?: Record<string, { impressions: number; clicks: number }> }) {
  const [ads, setAds] = useState<Ad[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await adminCall<{ ads: Ad[] }>("ads_list");
      setAds(res.ads);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load ads");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d));

  async function save() {
    if (!draft) return;
    // the server only stores http(s) image links: say so instead of silently losing the image
    const badImage = (["cover_url", "thumb_url"] as const).find((k) => {
      const v = draft[k].trim();
      if (!v) return false;
      try {
        const u = new URL(v);
        return !(u.protocol === "https:" || u.protocol === "http:") || v.length > 800;
      } catch {
        return true;
      }
    });
    if (badImage) {
      setError(
        `${badImage === "cover_url" ? "Cover image" : "Thumbnail"}: use the upload button, or paste a full https:// image link (not a file path or pasted image data).`,
      );
      return;
    }
    setSaving(true);
    setError("");
    try {
      await adminCall("ad_save", {
        ad: {
          ...draft,
          starts_at: draft.starts_at ? new Date(draft.starts_at).toISOString() : "",
          ends_at: draft.ends_at ? new Date(draft.ends_at).toISOString() : "",
          daily_start: draft.daily_start || null,
          daily_end: draft.daily_end || null,
          max_impressions: draft.max_impressions ? Number(draft.max_impressions) : null,
          sort_order: Number(draft.sort_order) || 0,
        },
      });
      setDraft(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function remove(ad: Ad) {
    if (!window.confirm(`Delete “${ad.title}”? This cannot be undone.`)) return;
    try {
      await adminCall("ad_delete", { id: ad.id });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  async function toggle(ad: Ad) {
    try {
      await adminCall("ad_save", { ad: { ...ad, active: !ad.active } });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  }

  async function resetCounts(ad: Ad) {
    if (!window.confirm("Reset impressions and clicks to 0? Use this to re-run a capped ad.")) return;
    try {
      await adminCall("ad_reset_counts", { id: ad.id });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reset failed");
    }
  }

  return (
    <section className="adm-section">
      <div className="adm-head">
        <h2>Advertisements</h2>
        <button type="button" className="primary-btn" onClick={() => setDraft({ ...blank })}>
          New ad
        </button>
      </div>
      {error ? <p className="adm-error">{error}</p> : null}

      {draft ? (
        <div className="adm-form card">
          <h3>{draft.id ? "Edit ad" : "New ad"}</h3>
          <div className="adm-grid">
            <div className="adm-field">
              <label>Title *</label>
              <input value={draft.title} maxLength={120} onChange={(e) => set("title", e.target.value)} />
            </div>
            <div className="adm-field">
              <label>Link URL *</label>
              <input
                type="url"
                placeholder="https://…"
                value={draft.link_url}
                onChange={(e) => set("link_url", e.target.value)}
              />
            </div>
            <div className="adm-field wide">
              <label>Short text</label>
              <input value={draft.body} maxLength={240} onChange={(e) => set("body", e.target.value)} />
            </div>
            <div className="adm-field">
              <label>Button label</label>
              <input value={draft.cta_label} maxLength={30} onChange={(e) => set("cta_label", e.target.value)} />
            </div>
            <div className="adm-field">
              <label>Order (lower shows first)</label>
              <input type="number" value={draft.sort_order} onChange={(e) => set("sort_order", e.target.value)} />
            </div>
            <div className="adm-field">
              <label>Placement</label>
              <select value={draft.placement} onChange={(e) => set("placement", e.target.value as AdPlacement)}>
                {(Object.keys(placementLabel) as AdPlacement[]).map((p) => (
                  <option key={p} value={p}>
                    {placementLabel[p]}
                  </option>
                ))}
              </select>
              <small>Home disks use the Thumbnail (square), else the cover image cropped to a circle.</small>
            </div>
          </div>

          <ImageField
            label="Cover image"
            hint="Wide banner, ideally 1200×400 (3:1)."
            value={draft.cover_url}
            onChange={(v) => set("cover_url", v)}
          />
          <ImageField
            label="Thumbnail"
            hint="Small square logo, ideally 200×200."
            value={draft.thumb_url}
            onChange={(v) => set("thumb_url", v)}
          />

          <h4>Schedule</h4>
          <div className="adm-grid">
            <div className="adm-field">
              <label>Start (date & time)</label>
              <input type="datetime-local" value={draft.starts_at} onChange={(e) => set("starts_at", e.target.value)} />
            </div>
            <div className="adm-field">
              <label>End (date & time)</label>
              <input type="datetime-local" value={draft.ends_at} onChange={(e) => set("ends_at", e.target.value)} />
            </div>
            <div className="adm-field">
              <label>Daily from (viewer’s local time)</label>
              <input type="time" value={draft.daily_start} onChange={(e) => set("daily_start", e.target.value)} />
            </div>
            <div className="adm-field">
              <label>Daily until</label>
              <input type="time" value={draft.daily_end} onChange={(e) => set("daily_end", e.target.value)} />
            </div>
            <div className="adm-field">
              <label>Quantity (max impressions)</label>
              <input
                type="number"
                min={0}
                placeholder="Unlimited"
                value={draft.max_impressions}
                onChange={(e) => set("max_impressions", e.target.value)}
              />
              <small>Total views across ALL players. When reached, the ad stops for everyone. Leave empty for unlimited.</small>
            </div>
            <label className="adm-check">
              <input type="checkbox" checked={draft.active} onChange={(e) => set("active", e.target.checked)} />
              Active
            </label>
          </div>
          <p className="adm-note">
            Leave dates or daily times empty for no limit. Daily windows can cross midnight (22:00 → 02:00).
          </p>

          <div className="adm-actions">
            <button type="button" className="primary-btn" disabled={saving} onClick={() => void save()}>
              {saving ? "Saving…" : "Save ad"}
            </button>
            <button type="button" className="adm-ghost" onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr>
              <th>Ad</th>
              <th>Status</th>
              <th>Window</th>
              <th>Shown / cap</th>
              <th>Clicks</th>
              <th>CTR</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {ads.map((ad) => {
              const st = adState(ad);
              const ctr = ad.impressions ? ((ad.clicks / ad.impressions) * 100).toFixed(1) + "%" : "–";
              const win = stats?.[ad.id];
              return (
                <tr key={ad.id}>
                  <td>
                    <div className="adm-ad-cell">
                      {ad.thumb_url || ad.cover_url ? (
                        <img src={ad.thumb_url ?? ad.cover_url ?? ""} alt="" />
                      ) : (
                        <span className="adm-ph" />
                      )}
                      <div>
                        <strong>{ad.title}</strong>
                        <small>
                          {new URL(ad.link_url).hostname} · {placementLabel[ad.placement ?? "all"]}
                        </small>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={`adm-pill ${st}`}>{stateLabel[st]}</span>
                  </td>
                  <td className="adm-small">
                    {ad.starts_at ? new Date(ad.starts_at).toLocaleDateString() : "now"} →{" "}
                    {ad.ends_at ? new Date(ad.ends_at).toLocaleDateString() : "no end"}
                    {ad.daily_start && ad.daily_end ? (
                      <>
                        <br />
                        daily {ad.daily_start.slice(0, 5)}–{ad.daily_end.slice(0, 5)}
                      </>
                    ) : null}
                  </td>
                  <td>
                    {ad.impressions}
                    {ad.max_impressions ? ` / ${ad.max_impressions}` : " / ∞"}
                    {win ? <small className="adm-sub"> ({win.impressions} in range)</small> : null}
                  </td>
                  <td>{ad.clicks}</td>
                  <td>{ctr}</td>
                  <td className="adm-row-actions">
                    <button type="button" onClick={() => setDraft(fromAd(ad))}>
                      Edit
                    </button>
                    <button type="button" onClick={() => void toggle(ad)}>
                      {ad.active ? "Pause" : "Resume"}
                    </button>
                    <button type="button" onClick={() => void resetCounts(ad)}>
                      Reset
                    </button>
                    <button type="button" className="danger" onClick={() => void remove(ad)}>
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {ads.length === 0 ? <p className="adm-empty">No ads yet. Create one to show it on the home page.</p> : null}
      </div>
    </section>
  );
}
