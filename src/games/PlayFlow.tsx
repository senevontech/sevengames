import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { ChevronLeft, Play, Settings2 } from "../components/anim-icons";
import { Link } from "react-router-dom";
import TokenIcon from "../components/TokenIcon";
import { formatTokens } from "../lib/currency";
import "./play-flow.css";

/*
 * Start screen for games with several ways to play, in TWO steps:
 *   1. the board, a row of mode chips (last choice remembered) and ONE Play button
 *      (⚙ beside it opens that mode's settings, also remembered by the game)
 *   2. tap Play → playing. (Online opens its lobby, since it needs an opponent.)
 * On paid games the Play button carries the cost and pays as it starts (PlayGate context,
 * provided by the game page).
 */

/* ---------- paying for a play (provided by the game page) ---------- */

export type PlayGateApi = {
  /** tokens per play; 0 when free (or unlimited) */
  cost: number;
  /** a play is already paid for (e.g. "Play again" was paid) */
  credit: boolean;
  busy: boolean;
  error: ReactNode | null;
  /** pay if needed, then run `start` */
  request: (start: () => void) => void;
};

export const PlayGateContext = createContext<PlayGateApi | null>(null);
export const usePlayGate = () => useContext(PlayGateContext);

/* ---------- modes ---------- */

export type PlayMode = {
  key: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  /** why it's disabled (tooltip) */
  note?: string;
  /** shown behind the ⚙ button */
  settings?: ReactNode;
  /** Play starts the game right away… */
  start?: () => void;
  /** …or opens this panel (online lobby) */
  panel?: ReactNode;
  /** label on the Play button for this mode (default "Play") */
  playLabel?: string;
  /** what this mode can win or lose in chips (<ChipLine />), shown under the Play row */
  chips?: ReactNode;
};

const MODE_KEY = (id: string) => `senevon:mode:${id}`;

function readMode(id: string) {
  try {
    return localStorage.getItem(MODE_KEY(id));
  } catch {
    return null;
  }
}

export default function PlayFlow({
  id,
  modes,
  preview,
  corner,
  notices,
  homeExtra,
}: {
  /** remembers the last mode per game */
  id: string;
  modes: PlayMode[];
  preview?: ReactNode;
  corner?: ReactNode;
  notices?: ReactNode;
  /** under the Play row (e.g. "Resume"); gets `go` so it can pay first too */
  homeExtra?: (go: (start: () => void) => void) => ReactNode;
}) {
  const gate = usePlayGate();
  const [modeKey, setModeKey] = useState(() => {
    const saved = readMode(id);
    const ok = modes.find((m) => m.key === saved && !m.disabled);
    return ok ? ok.key : (modes.find((m) => !m.disabled) ?? modes[0]).key;
  });
  const [gearOpen, setGearOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const mode = modes.find((m) => m.key === modeKey) ?? modes[0];

  // a mode that becomes unavailable (went offline) falls back to the first one that works
  useEffect(() => {
    if (mode.disabled) {
      const next = modes.find((m) => !m.disabled);
      if (next) setModeKey(next.key);
      setPanelOpen(false);
    }
  }, [mode.disabled, modes]);

  const choose = (m: PlayMode) => {
    if (m.disabled) return;
    setModeKey(m.key);
    setGearOpen(false);
    try {
      localStorage.setItem(MODE_KEY(id), m.key);
    } catch {
      /* not remembered */
    }
  };

  /** pay (when needed) and run */
  const go = (start: () => void) => (gate ? gate.request(start) : start());
  const play = () => {
    if (mode.disabled) return;
    go(() => (mode.panel ? setPanelOpen(true) : mode.start?.()));
  };

  const showCost = gate && gate.cost > 0 && !gate.credit;

  if (panelOpen && mode.panel) {
    return (
      <div className="pf">
        <div className="pf-step">
          <div className="pf-head">
            <button type="button" className="pf-back" aria-label="Back" onClick={() => setPanelOpen(false)}>
              <ChevronLeft size={18} />
            </button>
            <span>{mode.label}</span>
          </div>
          <div className="pf-content">{mode.panel}</div>
        </div>
        {notices}
      </div>
    );
  }

  return (
    <div className="pf">
      {corner ? <div className="pf-corner">{corner}</div> : null}
      {preview}

      <div className="pf-bar">
        <div className="pf-line">
        {modes.length > 1 ? (
          <div className="pf-modes" role="radiogroup" aria-label="How to play">
            {modes.map((m) => (
              <button
                key={m.key}
                type="button"
                role="radio"
                aria-checked={m.key === modeKey}
                className={`pf-mode${m.key === modeKey ? " is-on" : ""}`}
                disabled={m.disabled}
                title={m.disabled ? m.note : m.label}
                aria-label={m.label}
                onClick={() => choose(m)}
              >
                {m.icon}
                <span>{m.label}</span>
              </button>
            ))}
          </div>
        ) : null}

        <div className="pf-actions">
          {mode.settings ? (
            <button
              type="button"
              className={`pf-gear${gearOpen ? " is-on" : ""}`}
              aria-label={`${mode.label} settings`}
              aria-expanded={gearOpen}
              onClick={() => setGearOpen((o) => !o)}
            >
              <Settings2 size={18} />
            </button>
          ) : null}
          <button type="button" className="pf-play" disabled={mode.disabled || gate?.busy} onClick={play}>
            <span className="pf-play-icon" aria-hidden="true">
              <Play size={16} fill="currentColor" strokeWidth={0} />
            </span>
            <span>{gate?.busy ? "Starting…" : mode.playLabel ?? "Play"}</span>
            {showCost ? (
              <span className="pf-cost" aria-label={`${formatTokens(gate.cost)} chips`}>
                <TokenIcon size={15} />
                {formatTokens(gate.cost)}
              </span>
            ) : null}
          </button>
        </div>
        </div>

        {mode.chips ?? null}
        {gearOpen && mode.settings ? <div className="pf-settings">{mode.settings}</div> : null}
        {gate?.error ? <p className="pf-error">{gate.error}</p> : null}
        {homeExtra?.(go)}
      </div>

      {notices}
    </div>
  );
}

/** One line of instructions; a "?" opens the full text. */
export function HelpLine({ short, children }: { short: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`pf-help${open ? " is-open" : ""}`}>
      <p className="pf-help-text">{open ? children : short}</p>
      <button
        type="button"
        className="pf-help-btn"
        aria-label={open ? "Hide instructions" : "Show all instructions"}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "×" : "?"}
      </button>
    </div>
  );
}

/** Message + way out when a play can't be paid for (used by the game page's gate). */
export function GateShort({ signIn, gameId }: { signIn: boolean; gameId: string }) {
  return signIn ? (
    <>
      Not enough guest chips. <Link to={`/login?next=/game/${gameId}`}>Sign in</Link> for 100 free.
    </>
  ) : (
    <>
      Not enough chips. <Link to="/chips#buy">Get chips</Link>
    </>
  );
}

