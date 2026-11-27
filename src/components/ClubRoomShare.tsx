import { useState } from "react";
import { useLocation } from "react-router-dom";
import { Users } from "./anim-icons";
import { CLUB_GAMES, clubApi, clubErrorText, setMyClub, useMyClub, type ClubGame } from "../lib/clubs";

/**
 * "Post to my club" in a room's waiting card: puts the room code on the club page so club
 * members can join. Only shows for players in a club, in games clubs support.
 */
export default function ClubRoomShare({ code }: { code: string }) {
  const { pathname } = useLocation();
  const { club, uid } = useMyClub();
  const [state, setState] = useState<{ busy?: boolean; text?: string }>({});
  const game = pathname.match(/^\/game\/([^/]+)/)?.[1] as ClubGame | undefined;
  if (!club || !uid || !game || !(game in CLUB_GAMES) || !/^[A-Z0-9]{4}$/.test(code)) return null;
  const posted = club.rooms.some((r) => r.user_id === uid && r.code === code && r.game === game);

  return (
    <p className="ol-sub">
      <button
        type="button"
        className="ghost-btn"
        disabled={state.busy || posted}
        onClick={async () => {
          setState({ busy: true });
          try {
            setMyClub(uid, await clubApi.postRoom(game, code));
            setState({ text: `Posted to ${club.name}` });
          } catch (e) {
            setState({ text: clubErrorText(e) });
          }
        }}
      >
        <Users size={14} aria-hidden="true" /> {posted ? `Posted to ${club.name}` : "Post to my club"}
      </button>
      {state.text && !posted ? <> {state.text}</> : null}
    </p>
  );
}
