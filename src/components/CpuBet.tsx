import { Link } from "react-router-dom";
import { BET, betOutcomeText, type useCpuBet } from "../lib/bets";
import { useAuthContext } from "../context/AuthContext";
import TokenIcon from "./TokenIcon";
import "./room-bet.css";

type CpuBet = ReturnType<typeof useCpuBet>;

/** "Bet 1 chip on each game" switch for the vs-CPU settings. */
export function CpuBetToggle({ bet }: { bet: CpuBet }) {
  const { user } = useAuthContext();
  if (!user) {
    return (
      <p className="cbet-note">
        <Link to="/login">Sign in</Link> to bet <TokenIcon size={13} /> {BET.cpuStake} chip on each game against the CPU.
      </p>
    );
  }
  return (
    <label className="cbet">
      <input type="checkbox" checked={bet.enabled} onChange={(e) => bet.setEnabled(e.target.checked)} disabled={!bet.canBet && !bet.enabled} />
      <span>
        Bet <TokenIcon size={13} /> {BET.cpuStake} chip a game: win +{BET.cpuStake}, lose −{BET.cpuStake}
        <small>
          {bet.canBet
            ? `Earned chips only · up to +${BET.cpuDailyCap} a day`
            : "You need earned chips to bet (bought chips can't be bet)"}
        </small>
      </span>
    </label>
  );
}

/** What the CPU bet did, for the result screen. */
export function CpuBetLine({ bet }: { bet: CpuBet }) {
  if (bet.error) return <p className="cbet-line is-err">{bet.error}</p>;
  if (!bet.bet) return null;
  const b = bet.bet;
  const text = betOutcomeText(b);
  if (!text) return null;
  const tone = b.status === "won" && b.payout > b.stake ? " is-up" : b.status === "lost" ? " is-down" : "";
  return (
    <p className={`cbet-line${tone}`} role="status">
      <TokenIcon size={14} /> {text}
    </p>
  );
}
