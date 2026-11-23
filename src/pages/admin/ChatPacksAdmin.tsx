/* Admin → Engagement → Custom sticker packs: upload artwork (PNG / WebP / GIF / SVG) as a chat pack,
   priced in tokens or Plus-only. Built-in packs are priced in Admin → Tokens → Shop. */
import { useCallback, useEffect, useState } from "react";
import { adminCall, uploadImage } from "../../lib/adminApi";
import { loadCustomPacks } from "../../lib/chatPacks";
import { loadShopPrices } from "../../lib/shop";

type Sticker = { id: string; label: string; url: string };
type Pack = { id: string; name: string; items: Sticker[]; shop: { price: number; plus_only: boolean; active: boolean } | null };

const blank = { id: "", name: "", price: "500", plus_only: false, items: [] as Sticker[] };

export default function ChatPacksAdmin() {
  const [packs, setPacks] = useState<Pack[] | null>(null);
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    try {
      setPacks((await adminCall<{ packs: Pack[] }>("chat_packs_list")).packs);
    } catch (e) {
      const m = e instanceof Error ? e.message : "Failed to load";
      setMsg(m.includes("chat_custom_packs") ? "Run supabase/chat.sql first." : m);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setMsg("");
    try {
      const added: Sticker[] = [];
      for (const file of Array.from(files).slice(0, 24 - f.items.length)) {
        const url = await uploadImage(file);
        const base = file.name.replace(/\.[^.]+$/, "");
        added.push({ id: base.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24) || `s${Date.now()}`, label: base.slice(0, 30), url });
      }
      setF((c) => ({ ...c, items: [...c.items, ...added] }));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setMsg("");
    try {
      await adminCall("chat_pack_save", { id: f.id, name: f.name, price: Number(f.price), plus_only: f.plus_only, items: f.items });
      setMsg(`Saved "${f.name}".`);
      setF(blank);
      await load();
      void loadCustomPacks(true);
      void loadShopPrices(true);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  async function setActive(p: Pack, active: boolean) {
    try {
      await adminCall("chat_pack_active", { id: p.id, active });
      setMsg(active ? `"${p.name}" is on sale.` : `"${p.name}" is off sale (owners keep it).`);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <div className="card adm-card adm-settings">
      <h3>Custom sticker packs</h3>
      <p className="adm-note">
        Upload your own sticker art (square PNG, WebP, GIF or SVG, up to 24 per pack). Price in tokens, or Plus only (free for members). Players use them
        in online matches, lobbies and friends chat. Built-in packs are priced in Tokens → Shop.
      </p>
      {msg ? <p className="adm-note adm-msg">{msg}</p> : null}

      <div className="adm-form-grid">
        <label>
          Pack id (a-z, 0-9, -)
          <input value={f.id} onChange={(e) => setF({ ...f, id: e.target.value.toLowerCase() })} maxLength={32} placeholder="diwali" />
        </label>
        <label>
          Name
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={40} placeholder="Diwali stickers" />
        </label>
        <label>
          Price (tokens)
          <input type="number" min={0} value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} disabled={f.plus_only} />
        </label>
        <label className="adm-check">
          <input type="checkbox" checked={f.plus_only} onChange={(e) => setF({ ...f, plus_only: e.target.checked })} />
          Plus only
        </label>
        <label>
          Add stickers
          <input type="file" accept="image/png,image/webp,image/gif,image/svg+xml" multiple disabled={busy} onChange={(e) => void upload(e.target.files)} />
        </label>
      </div>

      {f.items.length ? (
        <ul className="adm-stickers">
          {f.items.map((it, i) => (
            <li key={it.id + i}>
              <img src={it.url} alt="" />
              <input
                value={it.label}
                aria-label="Caption"
                onChange={(e) => setF((c) => ({ ...c, items: c.items.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) }))}
              />
              <button type="button" className="adm-ghost" onClick={() => setF((c) => ({ ...c, items: c.items.filter((_, j) => j !== i) }))}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="adm-form-actions">
        <button type="button" className="primary-btn" disabled={busy || !f.id || !f.name || !f.items.length} onClick={() => void save()}>
          {busy ? "Working…" : "Save pack"}
        </button>
        {f.id ? (
          <button type="button" className="adm-ghost" onClick={() => setF(blank)}>
            Clear
          </button>
        ) : null}
      </div>

      {packs?.length ? (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>Pack</th>
                <th>Stickers</th>
                <th>Price</th>
                <th>On sale</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {packs.map((p) => (
                <tr key={p.id}>
                  <td>
                    <strong>{p.name}</strong>
                    <div className="adm-note">{p.id}</div>
                  </td>
                  <td>
                    <span className="adm-sticker-row">
                      {p.items.slice(0, 6).map((it) => (
                        <img key={it.id} src={it.url} alt="" />
                      ))}
                    </span>
                  </td>
                  <td>{p.shop?.plus_only ? "Plus only" : `${p.shop?.price ?? 0} tokens`}</td>
                  <td>
                    <input type="checkbox" checked={p.shop?.active !== false} onChange={(e) => void setActive(p, e.target.checked)} aria-label={`${p.name} on sale`} />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="adm-ghost"
                      onClick={() => setF({ id: p.id, name: p.name, price: String(p.shop?.price ?? 0), plus_only: Boolean(p.shop?.plus_only), items: p.items })}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
