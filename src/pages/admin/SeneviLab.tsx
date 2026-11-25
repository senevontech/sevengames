/* Admin → Senevi Lab: design the four CPU bots (Senevi 1–4) the way the ceo agent's Bot Lab does
   (a live stage, every expression and game event as a trigger, every look / face / motion knob),
   then Publish. Saved as the site setting "senevi_bots"; every game reads it:
   one-CPU games play bot 1, games with several CPUs seat bots 1, 2, 3 (4) in order. */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase } from "../../supabase";
import { adminCall } from "../../lib/adminApi";
import { DEFAULT_PROFILES, SENEVI_BOTS, cleanProfiles, type SeneviProfile } from "../../senevi/Senevi";
import type { ConfigRow, SeneviExpression, SeneviInstance } from "../../senevi/seneviBot";
import "../../senevi/senevi.css";
import "./senevi-lab.css";

type BotModule = typeof import("../../senevi/seneviBot");
let modPromise: Promise<BotModule> | null = null;
const loadMod = () => (modPromise ??= import("../../senevi/seneviBot.js") as Promise<BotModule>);

const MODE_NAMES = ["Ready", "Thinking", "Celebrate", "Review"];
const SIZES: [string, number][] = [
  ["S", 150],
  ["M", 230],
  ["L", 300],
  ["XL", 420],
];
const fmt = (v: unknown) => (typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : String(v));

/** only what differs from the defaults is saved */
function diffFrom(defaults: Record<string, unknown>, cfg: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cfg)) if (k in defaults && JSON.stringify(v) !== JSON.stringify(defaults[k])) out[k] = v;
  return out;
}

/* ---------------- one live bot on the stage ---------------- */
function BotStage({
  profile,
  size,
  label,
  selected,
  onPick,
  onReady,
  defaults,
}: {
  profile: SeneviProfile;
  size: number;
  label: string;
  selected: boolean;
  onPick: () => void;
  onReady: (b: SeneviInstance | null) => void;
  defaults: Record<string, unknown> | null;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const bot = useRef<SeneviInstance | null>(null);
  const [line, setLine] = useState<string | null>(null);
  const [fail, setFail] = useState(false);
  const cfgRef = useRef(profile.config);
  cfgRef.current = profile.config;
  const readyRef = useRef(onReady);
  readyRef.current = onReady;

  useEffect(() => {
    let gone = false;
    let clear = 0;
    void loadMod().then(({ default: Senevi }) => {
      if (gone || !host.current) return;
      if (!Senevi.isSupported()) return setFail(true);
      bot.current = Senevi.create(host.current, {
        speech: true,
        onSay: (t) => {
          setLine(t);
          window.clearTimeout(clear);
          clear = window.setTimeout(() => setLine(null), 3200);
        },
        config: { ...cfgRef.current },
      });
      readyRef.current(bot.current);
    });
    return () => {
      gone = true;
      window.clearTimeout(clear);
      bot.current?.destroy();
      bot.current = null;
      readyRef.current(null);
      if (host.current) host.current.innerHTML = "";
    };
  }, [size]);

  // live tuning: every change goes straight to the bot
  useEffect(() => {
    if (bot.current && defaults) bot.current.setConfig({ ...defaults, ...profile.config });
  }, [profile.config, defaults]);

  return (
    <div className={`slab-card${selected ? " is-sel" : ""}`} onClick={onPick} style={{ ["--bot-size" as string]: `${size}px`, ["--halo" as string]: String((profile.config.modeColors as string[] | undefined)?.[0] ?? "#ffaa45") }}>
      <span className="slab-card-label">
        {label} · {profile.name}
      </span>
      <div className="slab-halo" />
      <span className="snv-face slab-face" style={{ width: size, height: size }}>
        {fail ? <span className="slab-fail">WebGL isn't available in this browser.</span> : <span ref={host} className="snv-host" />}
      </span>
      {line ? <p className="slab-line">{line}</p> : null}
    </div>
  );
}

/* ---------------- one tuning control ---------------- */
function Control({ row, value, onChange }: { row: ConfigRow; value: unknown; onChange: (v: unknown) => void }) {
  const [key, label, a, b, c] = row;
  const id = `slab-${key}`;
  let input: ReactNode;
  if (a === "color") input = <input id={id} type="color" value={String(value)} onChange={(e) => onChange(e.target.value)} />;
  else if (a === "toggle") input = <input id={id} type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />;
  else if (a === "select")
    input = (
      <select id={id} value={String(value)} onChange={(e) => onChange(e.target.value)}>
        {(b as [string, string][]).map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    );
  else input = <input id={id} type="range" min={a as number} max={b as number} step={c} value={Number(value)} onChange={(e) => onChange(Number(e.target.value))} />;
  return (
    <div className="slab-row">
      <label htmlFor={id}>{label}</label>
      {input}
      <output>{typeof a === "number" ? fmt(value) : ""}</output>
    </div>
  );
}

/* =================================================================== */
export default function SeneviLab() {
  const [profiles, setProfiles] = useState<SeneviProfile[]>(DEFAULT_PROFILES);
  const [saved, setSaved] = useState<string>(JSON.stringify(DEFAULT_PROFILES));
  const [sel, setSel] = useState(0);
  const [view, setView] = useState<"one" | "all">("one");
  const [size, setSize] = useState(300);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [halo, setHalo] = useState(true);
  const [target, setTarget] = useState<"sel" | "all">("sel");
  const [msg, setMsg] = useState("");
  const [json, setJson] = useState("");
  const [busy, setBusy] = useState(false);
  const [mod, setMod] = useState<BotModule | null>(null);
  const [fps, setFps] = useState<number[]>([]);
  const bots = useRef<(SeneviInstance | null)[]>([null, null, null, null]);

  useEffect(() => {
    void loadMod().then(setMod);
    // the published bots (fresh from the database, not the page's cache)
    if (supabase)
      void supabase
        .from("site_settings")
        .select("value")
        .eq("key", "senevi_bots")
        .maybeSingle()
        .then(({ data }) => {
          if (!data) return;
          const p = cleanProfiles(data.value);
          setProfiles(p);
          setSaved(JSON.stringify(p));
        });
    const id = window.setInterval(() => setFps(bots.current.map((b) => b?.fps ?? 0)), 600);
    return () => window.clearInterval(id);
  }, []);

  const defaults = mod?.DEFAULT_CONFIG ?? null;
  const schema = mod?.CONFIG_SCHEMA ?? [];
  const prof = profiles[sel];
  const cfg = useMemo(() => ({ ...(defaults ?? {}), ...prof.config }), [defaults, prof.config]);
  const dirty = JSON.stringify(profiles) !== saved;

  const update = useCallback(
    (i: number, patch: Partial<SeneviProfile>) => setProfiles((ps) => ps.map((p, k) => (k === i ? { ...p, ...patch } : p))),
    [],
  );
  const setKey = (key: string, v: unknown) => {
    if (!defaults) return;
    const next = { ...prof.config, [key]: v };
    update(sel, { config: diffFrom(defaults, { ...defaults, ...next }) });
  };

  /* triggers go to the selected bot, or all four */
  const each = (fn: (b: SeneviInstance) => void) => {
    bots.current.forEach((b, i) => {
      if (!b || b.destroyed) return;
      if (target === "all" || view === "one" || i === sel) fn(b);
    });
  };
  const EXPRS = (mod?.default.EXPRESSIONS ?? []) as SeneviExpression[];
  const EVENTS: [string, (b: SeneviInstance) => void][] = [
    ["Game start", (b) => b.gameStart()],
    ["Thinking", (b) => b.thinkTurn(2500)],
    ["His good move", (b) => b.cpuGood()],
    ["Your good move", (b) => b.playerGood()],
    ["He wins", (b) => b.gameOver("cpu")],
    ["He loses", (b) => b.gameOver("player")],
    ["Draw", (b) => b.gameOver("draw")],
    ["Celebrate", (b) => b.celebrate()],
    ["Defeat", (b) => b.defeat()],
    ["Dizzy", (b) => b.react("dizzy", 2400)],
    ["Drowsy now", (b) => b.forceIdle(31000)],
    ["Sleep now", (b) => b.forceIdle(46000)],
    ["Look ←", (b) => b.lookAt(-0.45, 0, 1600)],
    ["Look ↑", (b) => b.lookAt(0, 0.3, 1600)],
    ["Look →", (b) => b.lookAt(0.45, 0, 1600)],
    ["Say something", (b) => void b.saySomething()],
    ["Jump", (b) => b.jump()],
    ["Shake head", (b) => b.shakeHead()],
  ];

  const publish = async () => {
    setBusy(true);
    setMsg("Publishing…");
    try {
      const r = await adminCall<{ ok: boolean; bots: SeneviProfile[] }>("senevi_save", { bots: profiles });
      const clean = cleanProfiles(r.bots ?? profiles);
      setProfiles(clean);
      setSaved(JSON.stringify(clean));
      setMsg("Published. Players get the new Senevis on their next page load.");
    } catch (e) {
      const m = e instanceof Error ? e.message : "Publish failed";
      setMsg(
        /unknown action/i.test(m)
          ? "Not published: the admin function on Supabase is out of date. Run “supabase functions deploy admin”, then press Publish again."
          : `Not published: ${m}`,
      );
    } finally {
      setBusy(false);
    }
  };
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setMsg(`${what} copied`);
    } catch {
      setJson(text);
      setMsg("Clipboard blocked: it's in the box below");
    }
  };
  const importJson = () => {
    if (!defaults) return;
    try {
      const parsed = JSON.parse(json) as Record<string, unknown>;
      // a whole bot ({ name, chat, config }) or just a config
      const raw = (parsed.config && typeof parsed.config === "object" ? parsed.config : parsed) as Record<string, unknown>;
      const clean: Record<string, unknown> = {};
      for (const k of Object.keys(raw)) if (k in defaults) clean[k] = raw[k];
      update(sel, {
        config: diffFrom(defaults, { ...defaults, ...clean }),
        ...(typeof parsed.name === "string" ? { name: parsed.name.slice(0, 24) } : {}),
        ...(typeof parsed.chat === "number" ? { chat: Math.max(0, Math.min(1, parsed.chat)) } : {}),
      });
      setMsg("Applied to this bot");
    } catch {
      setMsg("That isn't valid JSON");
    }
  };

  const shown = view === "one" ? [sel] : [0, 1, 2, 3];

  return (
    <div className={`slab slab-${theme}`}>
      <div className="slab-main">
        <div className="slab-toolbar">
          <h3>
            Senevi Lab <small>the four CPU bots</small>
          </h3>
          <div className="slab-seg" role="tablist" aria-label="Bot">
            {Array.from({ length: SENEVI_BOTS }, (_, i) => (
              <button key={i} type="button" className={sel === i ? "on" : ""} onClick={() => setSel(i)}>
                Senevi {i + 1}
              </button>
            ))}
          </div>
          <div className="slab-seg">
            <button type="button" className={view === "one" ? "on" : ""} onClick={() => setView("one")}>
              One
            </button>
            <button type="button" className={view === "all" ? "on" : ""} onClick={() => setView("all")}>
              All four
            </button>
          </div>
          <div className="slab-seg">
            {SIZES.map(([l, v]) => (
              <button key={l} type="button" className={size === v ? "on" : ""} onClick={() => setSize(v)}>
                {l}
              </button>
            ))}
          </div>
          <div className="slab-seg">
            <button type="button" className={theme === "light" ? "on" : ""} onClick={() => setTheme("light")}>
              Light
            </button>
            <button type="button" className={theme === "dark" ? "on" : ""} onClick={() => setTheme("dark")}>
              Dark
            </button>
          </div>
          <div className="slab-seg">
            <button type="button" className={halo ? "on" : ""} onClick={() => setHalo((h) => !h)}>
              Halo
            </button>
          </div>
          <span className="slab-fps">{shown.map((i) => `${fps[i] ?? 0}`).join(" · ")} fps</span>
        </div>

        <div className={`slab-stage${halo ? "" : " no-halo"}${view === "all" ? " is-all" : ""}`}>
          {shown.map((i) => (
            <BotStage
              key={`${i}-${size}-${view}`}
              profile={profiles[i]}
              size={view === "all" ? Math.min(size, 230) : size}
              label={`Senevi ${i + 1}`}
              selected={i === sel}
              onPick={() => setSel(i)}
              defaults={defaults}
              onReady={(b) => (bots.current[i] = b)}
            />
          ))}
        </div>

        <div className="slab-where">
          <b>Where they play:</b> games with one CPU (Chess, Eight Ball, Carrom, Connect Four, Noughts) use <b>Senevi 1</b>. Ludo, One Card and Call Break seat <b>Senevi 1, 2, 3</b> in order; Senevi 4 is ready for 4-CPU tables. The eyes and head follow the player's cursor or finger: <i>Eye travel</i> and <i>Head follow</i> set how much (0 = still).
        </div>
      </div>

      <aside className="slab-panel">
        <div className="slab-publish">
          <button type="button" className="slab-btn slab-btn-main" disabled={busy || !dirty} onClick={() => void publish()}>
            {busy ? "Publishing…" : dirty ? "Publish all four" : "Published"}
          </button>
          {dirty ? <span className="slab-dirty">Unsaved changes</span> : null}
          {msg ? <p className="slab-msg" data-bad={msg.startsWith("Not published") ? "1" : undefined}>{msg}</p> : null}
        </div>

        <details open>
          <summary>Senevi {sel + 1}: name &amp; personality</summary>
          <div className="slab-sec">
            <div className="slab-row">
              <label htmlFor="slab-name">Name</label>
              <input id="slab-name" type="text" maxLength={24} value={prof.name} onChange={(e) => update(sel, { name: e.target.value })} />
              <output />
            </div>
            <div className="slab-row">
              <label htmlFor="slab-chat">Chattiness</label>
              <input id="slab-chat" type="range" min={0} max={1} step={0.05} value={prof.chat} onChange={(e) => update(sel, { chat: Number(e.target.value) })} />
              <output>{prof.chat === 0 ? "silent" : prof.chat >= 1 ? "chatty" : fmt(prof.chat)}</output>
            </div>
          </div>
        </details>

        <details open>
          <summary>Triggers</summary>
          <div className="slab-sec">
            <div className="slab-row slab-row-2">
              <label>Send to</label>
              <div className="slab-seg">
                <button type="button" className={target === "sel" ? "on" : ""} onClick={() => setTarget("sel")}>
                  Senevi {sel + 1}
                </button>
                <button type="button" className={target === "all" ? "on" : ""} onClick={() => setTarget("all")}>
                  All shown
                </button>
              </div>
            </div>
            <p className="slab-hint">Expressions (held for 3 s)</p>
            <div className="slab-btns">
              {EXPRS.map((x) => (
                <button key={x} type="button" className="slab-btn" onClick={() => each((b) => b.react(x, 3000, { jump: x === "laugh" || x === "surprised" || x === "love" }))}>
                  {x}
                </button>
              ))}
            </div>
            <p className="slab-hint">Game events</p>
            <div className="slab-btns">
              {EVENTS.map(([label, fn]) => (
                <button key={label} type="button" className="slab-btn" onClick={() => each(fn)}>
                  {label}
                </button>
              ))}
            </div>
            <p className="slab-hint">Mode colours (tap to preview)</p>
            <div className="slab-modes">
              {MODE_NAMES.map((n, i) => {
                const colors = (cfg.modeColors as string[] | undefined) ?? ["#ffaa45", "#52d2ff", "#bf8bff", "#ffd84a"];
                return (
                  <label key={n}>
                    <button type="button" className="slab-mode" style={{ ["--c" as string]: colors[i] }} onClick={() => each((b) => b.setShape(i))}>
                      <i />
                      {n}
                    </button>
                    <input
                      type="color"
                      value={colors[i]}
                      onChange={(e) => {
                        const next = [...colors];
                        next[i] = e.target.value;
                        setKey("modeColors", next);
                      }}
                    />
                  </label>
                );
              })}
            </div>
          </div>
        </details>

        {schema.map(([title, rows], gi) => (
          <details key={title} open={gi < 2}>
            <summary>{title}</summary>
            <div className="slab-sec">
              {rows.map((row) => (
                <Control key={row[0]} row={row} value={cfg[row[0]]} onChange={(v) => setKey(row[0], v)} />
              ))}
            </div>
          </details>
        ))}

        <details>
          <summary>Copy, import, reset</summary>
          <div className="slab-sec">
            <div className="slab-btns slab-btns-2">
              <button type="button" className="slab-btn" onClick={() => void copy(JSON.stringify({ name: prof.name, chat: prof.chat, config: prof.config }, null, 2), "This bot")}>
                Copy this bot
              </button>
              <button type="button" className="slab-btn" onClick={() => void copy(JSON.stringify(cfg, null, 2), "Full config")}>
                Copy full config
              </button>
              <button type="button" className="slab-btn" onClick={() => update(sel, { config: {} })}>
                Reset look to default
              </button>
              <button type="button" className="slab-btn" onClick={() => update(sel, { ...DEFAULT_PROFILES[sel] })}>
                Reset this bot
              </button>
            </div>
            <p className="slab-hint">Copy another bot's look onto Senevi {sel + 1}</p>
            <div className="slab-btns">
              {profiles.map((p, i) =>
                i === sel ? null : (
                  <button key={i} type="button" className="slab-btn" onClick={() => update(sel, { config: { ...p.config } })}>
                    From Senevi {i + 1}
                  </button>
                ),
              )}
            </div>
            <textarea className="slab-json" value={json} onChange={(e) => setJson(e.target.value)} placeholder='Paste a bot ({ "name", "chat", "config" }) or a config here' />
            <button type="button" className="slab-btn" onClick={importJson} disabled={!json.trim()}>
              Apply to Senevi {sel + 1}
            </button>
          </div>
        </details>
      </aside>
    </div>
  );
}
