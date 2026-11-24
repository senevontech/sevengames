import { useEffect, useState } from "react";
import type { GameRoom, RoomPeer } from "../lib/gameRoom";
import { useTokens } from "../lib/tokens";
import { BET, matchStake } from "../lib/bets";
import TokenIcon from "./TokenIcon";
import "./room-bet.css";

/** Keep my earned chips in the room's presence (the host needs them to cap the stake). */
export function useRoomChips(room: GameRoom | null) {
  const { wallet } = useTokens();
  const earned = wallet?.earned ?? 0;
  useEffect(() => {
    room?.setMe({ chips: earned });
  }, [room, earned]);
  return earned;
}

/**
 * The chip stake in an online waiting room (any game's lobby).
 *  - friend rooms: the host picks Off or 5+ chips each, at most what the poorest player has
 *    earned (`chips`: every seated player's earned chips); everyone else sees the choice
 *  - random matches: 3 chips each, when everyone can cover it
 */
export function StakePicker({
  isHost,
  matched,
  chosen,
  chips,
  onChoose,
}: {
  isHost: boolean;
  matched: boolean;
  /** the host's pick (0 = no bet) */
  chosen: number;
  chips: number[];
  onChoose: (n: number) => void;
}) {
  const poorest = chips.length ? Math.min(...chips) : 0;
  const stake = matchStake(matched, chosen, chips);
  const [custom, setCustom] = useState("");

  // someone joined who can't cover the stake: the host drops it to what everyone can afford
  useEffect(() => {
    if (!isHost || matched || !chosen || chips.length < 2) return;
    if (chosen > poorest) onChoose(poorest >= BET.roomMin ? poorest : 0);
  }, [isHost, matched, chosen, poorest, chips.length, onChoose]);

  const pot = stake * Math.max(2, chips.length);
  const summary =
    stake > 0 ? (
      <>
        <TokenIcon size={14} /> <b>{stake}</b> each · winner takes <b>{pot}</b>
      </>
    ) : matched ? (
      chips.length >= 2 ? (
        "No bet: not everyone has 3 earned chips"
      ) : (
        <>
          Random matches bet <TokenIcon size={13} /> {BET.randomStake} each
        </>
      )
    ) : (
      "No bet"
    );

  if (!isHost || matched) {
    return (
      <div className="rbet" role="status">
        <span className="rbet-label">Stake</span>
        <span className="rbet-sum">{summary}</span>
      </div>
    );
  }

  const options = BET.roomPresets.filter((n) => n <= poorest);
  return (
    <div className="rbet">
      <span className="rbet-label">Stake (earned chips)</span>
      <div className="rbet-row" role="radiogroup" aria-label="Stake per player">
        <button type="button" className={!chosen ? "is-on" : ""} aria-pressed={!chosen} onClick={() => onChoose(0)}>
          Off
        </button>
        {options.map((n) => (
          <button key={n} type="button" className={chosen === n ? "is-on" : ""} aria-pressed={chosen === n} onClick={() => onChoose(n)}>
            {n}
          </button>
        ))}
        {poorest >= BET.roomMin ? (
          <form
            className="rbet-custom"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Math.floor(Number(custom));
              if (n >= BET.roomMin) onChoose(Math.min(n, poorest));
              setCustom("");
            }}
          >
            <input
              type="number"
              inputMode="numeric"
              min={BET.roomMin}
              max={poorest}
              placeholder={`up to ${poorest}`}
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              aria-label="Your own stake"
            />
          </form>
        ) : null}
      </div>
      <span className="rbet-sum">
        {poorest < BET.roomMin && chips.length >= 2 ? `Someone has fewer than ${BET.roomMin} earned chips, so no bet` : summary}
      </span>
    </div>
  );
}

/** StakePicker for GameRoom lobbies (chess, ludo, pool): the stake travels in the room settings. */
export default function RoomBet({ room, peers, isHost, matched }: { room: GameRoom; peers: RoomPeer[]; isHost: boolean; matched: boolean }) {
  useRoomChips(room);
  const [, bump] = useState(0);
  return (
    <StakePicker
      isHost={isHost}
      matched={matched}
      chosen={Number(room.settings.bet) || 0}
      chips={peers.map((p) => p.chips ?? 0)}
      onChoose={(n) => {
        room.setMeta({ bet: n });
        bump((x) => x + 1);
      }}
    />
  );
}
