import { useEffect, useState } from "react";
import type { GameRoom, RoomPeer } from "../lib/gameRoom";
import { useTokens } from "../lib/tokens";
import { ENTRY, matchFee } from "../lib/entries";
import TokenIcon from "./TokenIcon";
import "./room-entry.css";

/** Keep my earned chips in the room's presence (the host needs them to cap the entry). */
export function useRoomChips(room: GameRoom | null) {
  const { wallet } = useTokens();
  const earned = wallet?.earned ?? 0;
  useEffect(() => {
    room?.setMe({ chips: earned });
  }, [room, earned]);
  return earned;
}

/**
 * The match entry in an online waiting room (any game's lobby). Everyone pays it, the winner
 * gets the prize.
 *  - friend rooms: the host sets Free or 5+ chips each, at most what the poorest player has
 *    earned (`chips`: every seated player's earned chips); everyone else sees the choice
 *  - random matches: 3 chips each, when everyone can cover it
 */
export function EntryPicker({
  isHost,
  matched,
  chosen,
  chips,
  onChoose,
}: {
  isHost: boolean;
  matched: boolean;
  /** the host's pick (0 = free match) */
  chosen: number;
  chips: number[];
  onChoose: (n: number) => void;
}) {
  const poorest = chips.length ? Math.min(...chips) : 0;
  const fee = matchFee(matched, chosen, chips);
  const [custom, setCustom] = useState("");

  // someone joined who can't cover the entry: the host drops it to what everyone can afford
  useEffect(() => {
    if (!isHost || matched || !chosen || chips.length < 2) return;
    if (chosen > poorest) onChoose(poorest >= ENTRY.roomMin ? poorest : 0);
  }, [isHost, matched, chosen, poorest, chips.length, onChoose]);

  const prize = fee * Math.max(2, chips.length);
  const summary =
    fee > 0 ? (
      <>
        <TokenIcon size={14} /> <b>{fee}</b> entry each · prize <b>{prize}</b>
      </>
    ) : matched ? (
      chips.length >= 2 ? (
        "Free match: not everyone has 3 earned chips"
      ) : (
        <>
          Random matches: <TokenIcon size={13} /> {ENTRY.randomFee} chip entry each
        </>
      )
    ) : (
      "Free match"
    );

  if (!isHost || matched) {
    return (
      <div className="rentry" role="status">
        <span className="rentry-label">Match entry</span>
        <span className="rentry-sum">{summary}</span>
      </div>
    );
  }

  const options = ENTRY.roomPresets.filter((n) => n <= poorest);
  return (
    <div className="rentry">
      <span className="rentry-label">Match entry (earned chips)</span>
      <div className="rentry-row" role="radiogroup" aria-label="Entry per player">
        <button type="button" className={!chosen ? "is-on" : ""} aria-pressed={!chosen} onClick={() => onChoose(0)}>
          Free
        </button>
        {options.map((n) => (
          <button key={n} type="button" className={chosen === n ? "is-on" : ""} aria-pressed={chosen === n} onClick={() => onChoose(n)}>
            {n}
          </button>
        ))}
        {poorest >= ENTRY.roomMin ? (
          <form
            className="rentry-custom"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Math.floor(Number(custom));
              if (n >= ENTRY.roomMin) onChoose(Math.min(n, poorest));
              setCustom("");
            }}
          >
            <input
              type="number"
              inputMode="numeric"
              min={ENTRY.roomMin}
              max={poorest}
              placeholder={`up to ${poorest}`}
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              aria-label="Your own entry"
            />
          </form>
        ) : null}
      </div>
      <span className="rentry-sum">
        {poorest < ENTRY.roomMin && chips.length >= 2 ? `Someone has fewer than ${ENTRY.roomMin} earned chips, so it's a free match` : summary}
      </span>
    </div>
  );
}

/** EntryPicker for GameRoom lobbies (chess, ludo, pool): the entry travels in the room settings. */
export default function RoomEntry({ room, peers, isHost, matched }: { room: GameRoom; peers: RoomPeer[]; isHost: boolean; matched: boolean }) {
  useRoomChips(room);
  const [, bump] = useState(0);
  return (
    <EntryPicker
      isHost={isHost}
      matched={matched}
      chosen={Number(room.settings.fee) || 0}
      chips={peers.map((p) => p.chips ?? 0)}
      onChoose={(n) => {
        room.setMeta({ fee: n });
        bump((x) => x + 1);
      }}
    />
  );
}
