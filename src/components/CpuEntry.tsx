import { Link } from "react-router-dom";
import { ENTRY, entryOutcomeText, type useCpuEntry } from "../lib/entries";
import { useAuthContext } from "../context/AuthContext";
import TokenIcon from "./TokenIcon";
import "./room-entry.css";

type CpuEntry = ReturnType<typeof useCpuEntry>;

/** "Play for chips" switch for the vs-CPU settings (a 1-chip entry each game). */
export function CpuEntryToggle({ entry }: { entry: CpuEntry }) {
  const { user } = useAuthContext();
  if (!user) {
    return (
      <p className="centry-note">
        <Link to="/login">Sign in</Link> to play Senevi for chips.
      </p>
    );
  }
  return (
    <label className="centry">
      <input type="checkbox" checked={entry.enabled} onChange={(e) => entry.setEnabled(e.target.checked)} disabled={!entry.canEnter && !entry.enabled} />
      <span>
        Play for chips: <TokenIcon size={13} /> {ENTRY.cpuFee} chip entry, win +{ENTRY.cpuFee}
        <small>
          {entry.canEnter
            ? `Uses earned chips · up to +${ENTRY.cpuDailyCap} a day`
            : "You need earned chips (bought chips can't be used for entries)"}
        </small>
      </span>
    </label>
  );
}

/** What the CPU match did to your chips, for the result screen. */
export function CpuEntryLine({ entry }: { entry: CpuEntry }) {
  if (entry.error) return <p className="centry-line is-err">{entry.error}</p>;
  if (!entry.entry) return null;
  const e = entry.entry;
  const text = entryOutcomeText(e);
  if (!text) return null;
  const tone = e.status === "won" && e.prize > e.fee ? " is-up" : e.status === "lost" ? " is-down" : "";
  return (
    <p className={`centry-line${tone}`} role="status">
      <TokenIcon size={14} /> {text}
    </p>
  );
}
