import { useEffect, useState } from "react";
import { adminCall } from "../../lib/adminApi";
import { games } from "../../catalog";
import { loadGamePrices } from "../../lib/tokens";
import { loadShopPrices } from "../../lib/shop";
import { BUILTIN_PACKS } from "../../lib/chatPacks";
import { ARROW_BOARDS, ARROW_FX, ARROW_HEADS, ARROW_SKINS, BOOSTERS, CHESS_BOARDS, CHESS_PIECES, FRAMES, LUDO_BOARDS, LUDO_DICE } from "../../lib/shopCatalog";

type Config = {
  game_prices: { game_id: string; cost: number }[];
  plan_prices: { currency: string; plan: "monthly" | "yearly"; amount: number }[];
  payments_mode: "mock" | "live";
};

const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

const savedCosts = (c: Config) =>
  Object.fromEntries(games.map((g) => [g.id, String(c.game_prices.find((p) => p.game_id === g.id)?.cost ?? 0)]));

/** "" or junk → "0"; otherwise a whole, non-negative number as text */
const cleanCost = (v: string) => String(Math.max(0, Math.round(Number(v.trim() || 0) || 0)));

/** Admin → Tokens: payments mode, per-game prices, subscription prices per currency, grants. */
export default function TokensTab() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [msg, setMsg] = useState("");
  const [costs, setCosts] = useState<Record<string, string>>({});
  const [newCur, setNewCur] = useState({ currency: "", monthly: "", yearly: "" });
  const [grant, setGrant] = useState({ email: "", amount: "", note: "" });
  const [lookup, setLookup] = useState<string>("");

  // `resetCosts` = drop unsaved price edits (first load, after "save all" / "discard")
  const load = (resetCosts = true) =>
    adminCall<Config>("tokens_config").then(
      (c) => {
        setCfg(c);
        if (resetCosts) setCosts(savedCosts(c));
      },
      (e) => setMsg(errText(e, "Failed to load (did you run supabase/tokens.sql and redeploy the admin function?)")),
    );
  useEffect(() => {
    void load();
  }, []);

  async function run(action: string, payload: Record<string, unknown>, done: string) {
    setMsg("");
    try {
      await adminCall(action, payload);
      setMsg(done);
      await load(false); // keep other unsaved price edits
      void loadGamePrices(true);
    } catch (e) {
      setMsg(errText(e, "Failed"));
    }
  }

  const currencies = [...new Set((cfg?.plan_prices ?? []).map((p) => p.currency))];
  const priceOf = (cur: string, plan: "monthly" | "yearly") => cfg?.plan_prices.find((p) => p.currency === cur && p.plan === plan)?.amount;

  return (
    <div className="adm-stack">
      {msg ? <p className="adm-note adm-msg">{msg}</p> : null}

      {/* ---------- Payments mode ---------- */}
      <div className="card adm-card adm-settings">
        <h3>Payments</h3>
        <p className="adm-note">
          No payment provider is connected yet. In <b>mock</b> mode the Tokens page shows a test checkout and
          anyone signed in can subscribe for free — for testing only. Switch to <b>live</b> before launch: test
          checkout is then refused, and subscriptions will come from the payment provider once it's connected.
        </p>
        <div className="adm-actions">
          <span className="adm-note">
            Current mode: <b>{cfg?.payments_mode ?? "…"}</b>
          </span>
          {cfg ? (
            <button
              type="button"
              className={cfg.payments_mode === "mock" ? "primary-btn" : "ghost-btn"}
              onClick={() =>
                void run(
                  "payments_mode_set",
                  { mode: cfg.payments_mode === "mock" ? "live" : "mock" },
                  `Payments mode set to ${cfg.payments_mode === "mock" ? "live" : "mock"}.`,
                )
              }
            >
              Switch to {cfg.payments_mode === "mock" ? "live" : "mock"}
            </button>
          ) : null}
        </div>
      </div>

      {/* ---------- Game prices ---------- */}
      <GamePrices
        cfg={cfg}
        costs={costs}
        setCosts={setCosts}
        onSaveOne={(id, title, cost) =>
          run("game_price_set", { game_id: id, cost }, `${title}: ${cost ? `${cost} tokens per play` : "free"}.`)
        }
        onSaveAll={async (rows) => {
          setMsg("");
          try {
            await adminCall("game_prices_set_bulk", { prices: rows });
            setMsg(`Saved ${rows.length} game price${rows.length === 1 ? "" : "s"}.`);
            await load(true);
            void loadGamePrices(true);
          } catch (e) {
            setMsg(errText(e, "Failed to save prices"));
          }
        }}
        onDiscard={() => cfg && setCosts(savedCosts(cfg))}
      />

      {/* ---------- Shop item prices ---------- */}
      <ShopPrices />

      {/* ---------- Subscription prices ---------- */}
      <div className="card adm-card adm-settings">
        <h3>Subscription prices</h3>
        <p className="adm-note">
          Both plans give 5,000 tokens every month. Visitors see the price for their country's currency; any
          currency not listed falls back to USD.
        </p>
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>Currency</th>
                <th>Monthly</th>
                <th>Yearly</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {currencies.map((cur) => (
                <PlanRow
                  key={cur}
                  currency={cur}
                  monthly={priceOf(cur, "monthly")}
                  yearly={priceOf(cur, "yearly")}
                  onSave={async (plan, amount) => run("plan_price_set", { currency: cur, plan, amount }, `${cur} ${plan} price saved.`)}
                  onDelete={cur === "USD" ? undefined : () => void run("plan_price_delete", { currency: cur }, `${cur} removed.`)}
                />
              ))}
              <tr>
                <td>
                  <input
                    value={newCur.currency}
                    maxLength={3}
                    placeholder="AED"
                    style={{ width: 80 }}
                    aria-label="New currency code"
                    onChange={(e) => setNewCur((n) => ({ ...n, currency: e.target.value.toUpperCase() }))}
                  />
                </td>
                <td>
                  <input type="number" min={0} step="0.01" value={newCur.monthly} placeholder="monthly" style={{ width: 110 }} aria-label="New monthly price" onChange={(e) => setNewCur((n) => ({ ...n, monthly: e.target.value }))} />
                </td>
                <td>
                  <input type="number" min={0} step="0.01" value={newCur.yearly} placeholder="yearly" style={{ width: 110 }} aria-label="New yearly price" onChange={(e) => setNewCur((n) => ({ ...n, yearly: e.target.value }))} />
                </td>
                <td>
                  <button
                    type="button"
                    className="primary-btn"
                    disabled={newCur.currency.length !== 3 || !(Number(newCur.monthly) > 0) || !(Number(newCur.yearly) > 0)}
                    onClick={async () => {
                      await run("plan_price_set", { currency: newCur.currency, plan: "monthly", amount: Number(newCur.monthly) }, "");
                      await run("plan_price_set", { currency: newCur.currency, plan: "yearly", amount: Number(newCur.yearly) }, `${newCur.currency} added.`);
                      setNewCur({ currency: "", monthly: "", yearly: "" });
                    }}
                  >
                    Add
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <RedeemCard />

      {/* ---------- Grant / look up ---------- */}
      <div className="card adm-card adm-settings">
        <h3>Player tokens</h3>
        <p className="adm-note">Look up a player's balance, or add tokens (use a negative amount to deduct).</p>
        <div className="adm-field">
          <label>Player email</label>
          <input value={grant.email} onChange={(e) => setGrant((g) => ({ ...g, email: e.target.value }))} placeholder="player@example.com" />
        </div>
        <div className="adm-field">
          <label>Amount</label>
          <input type="number" value={grant.amount} onChange={(e) => setGrant((g) => ({ ...g, amount: e.target.value }))} placeholder="e.g. 500" />
        </div>
        <div className="adm-field">
          <label>Note (shown in the player's history)</label>
          <input value={grant.note} maxLength={200} onChange={(e) => setGrant((g) => ({ ...g, note: e.target.value }))} placeholder="e.g. Tournament prize" />
        </div>
        <div className="adm-actions">
          <button
            type="button"
            className="ghost-btn"
            disabled={!grant.email.includes("@")}
            onClick={async () => {
              setLookup("");
              try {
                const r = await adminCall<{ balance: number; subscription: { plan: string; status: string } | null }>("tokens_lookup", { email: grant.email.trim() });
                setLookup(`${r.balance.toLocaleString()} tokens${r.subscription ? ` · ${r.subscription.plan} plan (${r.subscription.status})` : " · no subscription"}`);
              } catch (e) {
                setLookup(errText(e, "Lookup failed"));
              }
            }}
          >
            Look up
          </button>
          <button
            type="button"
            className="primary-btn"
            disabled={!grant.email.includes("@") || !Number(grant.amount)}
            onClick={() =>
              void run(
                "tokens_grant",
                { email: grant.email.trim(), amount: Number(grant.amount), note: grant.note },
                `${Number(grant.amount) > 0 ? "Added" : "Deducted"} ${Math.abs(Number(grant.amount)).toLocaleString()} tokens for ${grant.email.trim()}.`,
              ).then(() => setGrant((g) => ({ ...g, amount: "", note: "" })))
            }
          >
            Apply
          </button>
          {lookup ? <span className="adm-note">{lookup}</span> : null}
        </div>
      </div>
    </div>
  );
}

function PlanRow({
  currency,
  monthly,
  yearly,
  onSave,
  onDelete,
}: {
  currency: string;
  monthly?: number;
  yearly?: number;
  onSave: (plan: "monthly" | "yearly", amount: number) => Promise<void>;
  onDelete?: () => void;
}) {
  const [m, setM] = useState(String(monthly ?? ""));
  const [y, setY] = useState(String(yearly ?? ""));
  useEffect(() => setM(String(monthly ?? "")), [monthly]);
  useEffect(() => setY(String(yearly ?? "")), [yearly]);
  const dirty = m !== String(monthly ?? "") || y !== String(yearly ?? "");
  return (
    <tr>
      <td>
        <b>{currency}</b>
      </td>
      <td>
        <input type="number" min={0} step="0.01" value={m} style={{ width: 110 }} aria-label={`${currency} monthly`} onChange={(e) => setM(e.target.value)} />
      </td>
      <td>
        <input type="number" min={0} step="0.01" value={y} style={{ width: 110 }} aria-label={`${currency} yearly`} onChange={(e) => setY(e.target.value)} />
      </td>
      <td>
        <button
          type="button"
          className="ghost-btn"
          disabled={!dirty || !(Number(m) > 0) || !(Number(y) > 0)}
          onClick={async () => {
            if (m !== String(monthly ?? "")) await onSave("monthly", Number(m));
            if (y !== String(yearly ?? "")) await onSave("yearly", Number(y));
          }}
        >
          Save
        </button>{" "}
        {onDelete ? (
          <button type="button" className="ghost-btn" onClick={onDelete}>
            Remove
          </button>
        ) : null}
      </td>
    </tr>
  );
}

/* ---------- Redeem code → unlimited tokens ---------- */

type Unlimited = { user_id: string; email: string | null; via: string; granted_at: string };

function RedeemCard() {
  const [info, setInfo] = useState<{ code_set_at: string | null; unlimited: Unlimited[] } | null>(null);
  const [code, setCode] = useState("");
  const [revokeExisting, setRevokeExisting] = useState(false);
  const [msg, setMsg] = useState("");

  const load = () =>
    adminCall<{ code_set_at: string | null; unlimited: Unlimited[] }>("redeem_info").then(setInfo, (e) =>
      setMsg(errText(e, "Failed to load")),
    );
  useEffect(() => {
    void load();
  }, []);

  async function save() {
    setMsg("");
    try {
      await adminCall("redeem_code_set", { code: code.trim(), revoke_existing: revokeExisting });
      setMsg(revokeExisting ? "New code saved. Everyone who used the old code has been removed." : "New code saved. The old code no longer works.");
      setCode("");
      setRevokeExisting(false);
      await load();
    } catch (e) {
      setMsg(errText(e, "Failed"));
    }
  }

  async function revoke(u: Unlimited) {
    setMsg("");
    try {
      await adminCall("unlimited_revoke", { user_id: u.user_id });
      setMsg(`Unlimited removed from ${u.email ?? u.user_id}.`);
      await load();
    } catch (e) {
      setMsg(errText(e, "Failed"));
    }
  }

  return (
    <div className="card adm-card adm-settings">
      <h3>Redeem code (unlimited tokens)</h3>
      <p className="adm-note">
        Developers and admins enter this code on the Tokens page (“Have a code?”) to get unlimited tokens — premium
        games become free for that account. The code is stored hashed, so it can't be shown here; set a new one to change
        it. {info ? (info.code_set_at ? `Last changed ${new Date(info.code_set_at).toLocaleString()}.` : "No code set yet.") : null}
      </p>
      <div className="adm-field">
        <label>New code</label>
        <input
          value={code}
          maxLength={64}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setCode(e.target.value)}
          placeholder="at least 6 characters, e.g. SENEVON-DEV-2026"
        />
      </div>
      <label className="adm-check">
        <input type="checkbox" checked={revokeExisting} onChange={(e) => setRevokeExisting(e.target.checked)} /> Also remove
        everyone who redeemed the old code
      </label>
      <div className="adm-actions">
        <button type="button" className="primary-btn" disabled={code.trim().length < 6} onClick={() => void save()}>
          {info?.code_set_at ? "Change code" : "Set code"}
        </button>
        {msg ? <span className="adm-note">{msg}</span> : null}
      </div>
      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr>
              <th>Unlimited account</th>
              <th>Since</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(info?.unlimited ?? []).map((u) => (
              <tr key={u.user_id}>
                <td>{u.email ?? u.user_id}</td>
                <td>{new Date(u.granted_at).toLocaleDateString()}</td>
                <td>
                  <button type="button" className="ghost-btn" onClick={() => void revoke(u)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {info && !info.unlimited.length ? (
              <tr>
                <td colSpan={3}>Nobody has redeemed the code yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------- Game prices: per-row edit + bulk edit ---------- */

function GamePrices({
  cfg,
  costs,
  setCosts,
  onSaveOne,
  onSaveAll,
  onDiscard,
}: {
  cfg: Config | null;
  costs: Record<string, string>;
  setCosts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onSaveOne: (id: string, title: string, cost: number) => Promise<void>;
  onSaveAll: (rows: { game_id: string; cost: number }[]) => Promise<void>;
  onDiscard: () => void;
}) {
  const [bulkValue, setBulkValue] = useState("");
  const [bulkScope, setBulkScope] = useState("all");
  const [saving, setSaving] = useState(false);

  const categories = [...new Set(games.map((g) => g.category))];
  const saved = (id: string) => String(cfg?.game_prices.find((p) => p.game_id === id)?.cost ?? 0);
  const valueOf = (id: string) => costs[id] ?? saved(id);
  const dirty = games.filter((g) => cleanCost(valueOf(g.id)) !== saved(g.id));
  const inScope = (g: (typeof games)[number]) => bulkScope === "all" || g.category === bulkScope;
  const premiumCount = games.filter((g) => Number(cleanCost(valueOf(g.id))) > 0).length;

  function applyBulk(value: string) {
    const v = cleanCost(value);
    setCosts((c) => {
      const next = { ...c };
      for (const g of games) if (inScope(g)) next[g.id] = v;
      return next;
    });
  }

  async function saveAll() {
    setSaving(true);
    await onSaveAll(dirty.map((g) => ({ game_id: g.id, cost: Number(cleanCost(valueOf(g.id))) })));
    setSaving(false);
  }

  return (
    <div className="card adm-card adm-settings">
      <h3>Game prices</h3>
      <p className="adm-note">
        Tokens per play. 0 = free game. Premium games ask players to pay before each new play. {premiumCount} of {games.length}{" "}
        games are premium.
      </p>

      {/* bulk bar */}
      <div className="adm-bulk">
        <label>
          Set
          <select value={bulkScope} onChange={(e) => setBulkScope(e.target.value)} aria-label="Which games to set">
            <option value="all">all games</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c} games
              </option>
            ))}
          </select>
          to
          <input
            type="number"
            min={0}
            step={5}
            value={bulkValue}
            placeholder="tokens"
            style={{ width: 100 }}
            aria-label="Tokens per play for the selected games"
            onChange={(e) => setBulkValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && bulkValue !== "" && applyBulk(bulkValue)}
          />
        </label>
        <button type="button" className="ghost-btn" disabled={bulkValue === ""} onClick={() => applyBulk(bulkValue)}>
          Apply
        </button>
        <button type="button" className="ghost-btn" onClick={() => applyBulk("0")}>
          Make {bulkScope === "all" ? "all" : bulkScope} free
        </button>
        <span className="adm-bulk-spacer" />
        <button type="button" className="ghost-btn" disabled={!dirty.length || saving} onClick={onDiscard}>
          Discard
        </button>
        <button type="button" className="primary-btn" disabled={!dirty.length || saving} onClick={() => void saveAll()}>
          {saving ? "Saving…" : dirty.length ? `Save ${dirty.length} change${dirty.length === 1 ? "" : "s"}` : "No changes"}
        </button>
      </div>

      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr>
              <th>Game</th>
              <th>Tokens / play</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {games.map((g) => {
              const val = valueOf(g.id);
              const isDirty = cleanCost(val) !== saved(g.id);
              return (
                <tr key={g.id} className={isDirty ? "adm-row-dirty" : undefined}>
                  <td>
                    {g.title} <span className="adm-note">· {g.category}</span>
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      step={5}
                      value={val}
                      placeholder="0"
                      style={{ width: 110 }}
                      aria-label={`${g.title} tokens per play`}
                      onChange={(e) => setCosts((c) => ({ ...c, [g.id]: e.target.value }))}
                    />
                    {isDirty ? <span className="adm-note"> was {saved(g.id)}</span> : null}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="ghost-btn"
                      disabled={!isDirty}
                      onClick={() => void onSaveOne(g.id, g.title, Number(cleanCost(val)))}
                    >
                      Save
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type ShopItemRow = { item_id: string; kind: string; price: number; grants: string | null; qty: number; active: boolean; sort: number; plus_only?: boolean };

const SHOP_KIND_LABEL: Record<string, string> = {
  arrow_skin: "Arrows · style",
  arrow_fx: "Arrows · effect",
  arrow_board: "Arrows · board",
  arrow_head: "Arrows · head",
  chat_pack: "Chat pack",
  frame: "Avatar frame",
  booster: "Booster pack",
  chess_board: "Chess · board",
  chess_pieces: "Chess · pieces",
  ludo_board: "Ludo · board",
  ludo_dice: "Ludo · dice",
};

const shopItemName = (id: string) =>
  ARROW_SKINS[id]?.name ??
  ARROW_FX[id]?.name ??
  ARROW_BOARDS[id]?.name ??
  ARROW_HEADS[id]?.name ??
  BUILTIN_PACKS.find((p) => p.id === id)?.name ??
  FRAMES[id]?.name ??
  BOOSTERS[id]?.name ??
  CHESS_BOARDS[id]?.name ??
  CHESS_PIECES[id]?.name ??
  LUDO_BOARDS[id]?.name ??
  LUDO_DICE[id]?.name ??
  id;

/** Admin → Tokens → Shop: price and on/off per shop item (supabase/shop.sql). */
function ShopPrices() {
  const [items, setItems] = useState<ShopItemRow[] | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");

  const load = () =>
    adminCall<{ items: ShopItemRow[] }>("shop_items_list").then(
      (r) => setItems(r.items),
      (e) => setMsg(errText(e, "Failed to load the shop (run supabase/shop.sql and redeploy the admin function).")),
    );
  useEffect(() => {
    void load();
  }, []);

  async function save(row: ShopItemRow, patch: { price?: number; active?: boolean; plus_only?: boolean }, done: string) {
    setMsg("");
    try {
      await adminCall("shop_item_set", { item_id: row.item_id, ...patch });
      setEdits((e) => {
        const next = { ...e };
        delete next[row.item_id];
        return next;
      });
      setMsg(done);
      await load();
      void loadShopPrices(true);
    } catch (e) {
      setMsg(errText(e, "Failed to save"));
    }
  }

  return (
    <div className="card adm-card adm-settings">
      <h3>Shop</h3>
      <p className="adm-note">
        Token prices for shop items. Price 0 on a style or effect makes it free for everyone. Turning an item off hides it
        from sale; players who bought it keep it. "Plus only" makes an item a Senevon Plus exclusive: members get it free,
        nobody else can buy it.
      </p>
      {msg ? <p className="adm-note adm-msg">{msg}</p> : null}
      {items ? (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Tokens</th>
                <th>On sale</th>
                <th>Plus only</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((row) => {
                const val = edits[row.item_id] ?? String(row.price);
                const isDirty = cleanCost(val) !== String(row.price);
                const name = shopItemName(row.item_id);
                return (
                  <tr key={row.item_id} className={isDirty ? "adm-row-dirty" : undefined}>
                    <td>
                      {name} <span className="adm-note">· {SHOP_KIND_LABEL[row.kind] ?? row.kind}</span>
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        step={50}
                        value={val}
                        style={{ width: 110 }}
                        aria-label={`${name} price in tokens`}
                        onChange={(e) => setEdits((x) => ({ ...x, [row.item_id]: e.target.value }))}
                      />
                      {isDirty ? <span className="adm-note"> was {row.price}</span> : null}
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={row.active}
                        aria-label={`${name} on sale`}
                        onChange={(e) => void save(row, { active: e.target.checked }, `${name} ${e.target.checked ? "is on sale" : "is off sale"}.`)}
                      />
                    </td>
                    <td>
                      {row.kind === "booster" || row.plus_only === undefined ? (
                        <span className="adm-note">–</span>
                      ) : (
                        <input
                          type="checkbox"
                          checked={row.plus_only}
                          aria-label={`${name} Plus only`}
                          onChange={(e) =>
                            void save(row, { plus_only: e.target.checked }, `${name} ${e.target.checked ? "is now a Plus exclusive" : "is for everyone again"}.`)
                          }
                        />
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="ghost-btn"
                        disabled={!isDirty}
                        onClick={() => void save(row, { price: Number(cleanCost(val)) }, `${name}: ${cleanCost(val)} tokens.`)}
                      >
                        Save
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : !msg ? (
        <p className="adm-note">Loading…</p>
      ) : null}
    </div>
  );
}
