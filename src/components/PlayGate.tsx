import { useState } from "react";
import { useOnline } from "../lib/online";
import { Link } from "react-router-dom";
import { LogIn, Play, Plus, RotateCcw, Tv, WifiOff } from "lucide-react";
import { useAuthContext } from "../context/AuthContext";
import { useTokens } from "../lib/tokens";
import { formatTokens } from "../lib/currency";
import AdRewardModal from "./AdRewardModal";
import TokenIcon from "./TokenIcon";
import "../pages/tokens.css";

/*
 * Premium game start bar: sits at the bottom of the game screen, over a preview of the game
 * (not in place of it).
 *  - enough tokens: "Start game · ⬤ N" (or "Play again" after a match)
 *  - not enough: watch an ad or get tokens
 *  - guests pay from their browser guest wallet; once it runs out, sign in
 */
export default function PlayGate({
  gameId,
  cost,
  again,
  onPaid,
}: {
  gameId: string;
  gameTitle?: string;
  cost: number;
  again: boolean;
  onPaid: () => void;
}) {
  const { user } = useAuthContext();
  const { wallet, guestBalance, spendForPlay, adFree } = useTokens();
  const online = useOnline();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adOpen, setAdOpen] = useState(false);

  const balance = user ? (wallet?.balance ?? null) : guestBalance;
  const short = balance !== null && balance < cost;

  async function pay() {
    setBusy(true);
    setError(null);
    const res = await spendForPlay(gameId);
    setBusy(false);
    if (res.ok) onPaid();
    else if (res.reason === "insufficient") setError("Not enough tokens.");
    else if (res.reason === "signin") setError("Sign in to play.");
    else setError(res.message ?? "Something went wrong.");
  }

  const Cost = (
    <span className="tk-cost" aria-label={`${formatTokens(cost)} tokens`}>
      <TokenIcon size={18} />
      {formatTokens(cost)}
    </span>
  );

  // premium games need the server to take the tokens: locked while offline
  if (!online)
    return (
      <div className={`tk-gatebar${again ? " is-again" : ""}`} role="region" aria-label="Start game">
        <div className="tk-gatebar-inner">
          <span className="tk-start is-offline" aria-disabled="true">
            <WifiOff size={18} aria-hidden="true" />
            <span>Connect to play</span>
            {Cost}
          </span>
        </div>
        <p className="tk-gatebar-note">Premium games need an internet connection. Free games work offline.</p>
      </div>
    );

  return (
    <div className={`tk-gatebar${again ? " is-again" : ""}`} role="region" aria-label="Start game">
      <div className="tk-gatebar-inner">
        <span className="tk-balance-chip" title={user ? "Your tokens" : "Guest tokens"}>
          <TokenIcon size={16} title={user ? "Your tokens" : "Guest tokens"} />
          <b>{balance === null ? "…" : formatTokens(balance)}</b>
        </span>

        {!short ? (
          <button type="button" className="tk-start" disabled={busy || balance === null} onClick={() => void pay()}>
            {again ? <RotateCcw size={18} aria-hidden="true" /> : <Play size={18} fill="currentColor" aria-hidden="true" />}
            <span>{busy ? "Starting…" : again ? "Play again" : "Start game"}</span>
            {Cost}
          </button>
        ) : !user ? (
          <Link className="tk-start" to={`/login?next=/game/${gameId}`}>
            <LogIn size={18} aria-hidden="true" />
            <span>Sign in · get 1,000</span>
            <TokenIcon size={18} />
          </Link>
        ) : (
          <span className="tk-short">
            Need {formatTokens(cost - (balance ?? 0))} more <TokenIcon size={15} />
          </span>
        )}

        {user && (short || again) ? (
          <span className="tk-gatebar-earn">
            {!adFree?.active ? (
              <button type="button" className="tk-mini" onClick={() => setAdOpen(true)} title="Watch an ad">
                <Tv size={15} aria-hidden="true" />+{wallet?.ad_reward ?? 50}
                <TokenIcon size={14} />
              </button>
            ) : null}
            <Link className="tk-mini" to="/tokens#buy" title="Get tokens" aria-label="Get tokens">
              <Plus size={15} aria-hidden="true" />
              <TokenIcon size={14} />
            </Link>
          </span>
        ) : null}
      </div>
      {error ? <p className="tk-gatebar-error">{error}</p> : null}
      {!user && !short ? (
        <p className="tk-gatebar-note">
          Guest tokens. <Link to={`/login?next=/game/${gameId}`}>Sign in</Link> for 1,000 free; leftovers come with you.
        </p>
      ) : null}
      <AdRewardModal open={adOpen} onClose={() => setAdOpen(false)} />
    </div>
  );
}
