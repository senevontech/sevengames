import { useState } from "react";
import { Gift } from "lucide-react";
import { BET, betErrorText, giftChips, useGiftLimits } from "../lib/bets";
import { useTokens } from "../lib/tokens";
import TokenIcon from "./TokenIcon";
import "./gift-chips.css";

/**
 * "Gift chips" on another player's profile: earned chips only, up to 500 a day, from accounts at
 * least 3 days old. Sending asks once more before the chips go.
 */
export default function GiftChipsButton({ to, name }: { to: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [limits, setLimits] = useGiftLimits(open);
  const { refresh } = useTokens();
  const [amount, setAmount] = useState("25");
  const [note, setNote] = useState("");
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const left = limits ? Math.max(0, limits.cap - limits.sent_today) : BET.giftDailyCap;
  const max = limits ? Math.min(left, limits.earned) : 0;
  const n = Math.floor(Number(amount));
  const valid = Number.isFinite(n) && n >= 1 && n <= max;

  async function send() {
    if (!valid) return;
    if (!sure) {
      setSure(true);
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const l = await giftChips(to, n, note.trim() || undefined);
      setLimits(l);
      setMsg({ ok: true, text: `Sent ${n} chips to ${name}.` });
      setNote("");
      void refresh();
    } catch (e) {
      setMsg({ ok: false, text: betErrorText(e) });
    } finally {
      setBusy(false);
      setSure(false);
    }
  }

  return (
    <>
      <button type="button" className={`pc-btn${open ? " is-on" : ""}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Gift size={15} aria-hidden="true" /> Gift chips
      </button>
      {open ? (
        <div className="gift-box" role="group" aria-label={`Gift chips to ${name}`}>
          {!limits ? (
            <p className="gift-sub">Loading…</p>
          ) : !limits.old_enough ? (
            <p className="gift-sub">Your account needs to be {limits.min_age_days} days old to send gifts.</p>
          ) : max < 1 ? (
            <p className="gift-sub">
              {limits.earned < 1 ? "You have no earned chips to gift (bought chips can't be gifted)." : `You've sent today's ${limits.cap} chips. More tomorrow.`}
            </p>
          ) : (
            <>
              <div className="gift-row">
                <label className="gift-amount">
                  <TokenIcon size={16} />
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={max}
                    value={amount}
                    onChange={(e) => {
                      setAmount(e.target.value);
                      setSure(false);
                    }}
                    aria-label="Chips to send"
                  />
                </label>
                {[10, 25, 50, 100].filter((x) => x <= max).map((x) => (
                  <button key={x} type="button" className={`gift-pick${n === x ? " is-on" : ""}`} onClick={() => (setAmount(String(x)), setSure(false))}>
                    {x}
                  </button>
                ))}
              </div>
              <input className="gift-note" type="text" maxLength={80} placeholder="Add a note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
              <button type="button" className={`pc-btn pc-primary gift-send${sure ? " is-sure" : ""}`} disabled={!valid || busy} onClick={() => void send()}>
                {busy ? "Sending…" : sure ? `Send ${n} chips to ${name}? Tap to confirm` : `Send ${valid ? n : ""} chips`}
              </button>
              <p className="gift-sub">
                Up to {max} now · {limits.earned} earned chips · {left} of {limits.cap} left today. Gifts can't be undone.
              </p>
            </>
          )}
          {msg ? <p className={`gift-msg${msg.ok ? " ok" : " bad"}`}>{msg.text}</p> : null}
        </div>
      ) : null}
    </>
  );
}
