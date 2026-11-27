/* /connect/:id — "Sign in with Senevon" from a partner game's own site (e.g. DroidDoom).
   Signs the player in here if needed, then sends them back to the game with a one-time sign-in
   code (supabase/game_signin.sql). Only games with `signIn` in the catalog. */
import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { getGame } from "../catalog";
import { useAuthContext } from "../context/AuthContext";
import { supabase } from "../supabase";
import "./info-page.css";
import { isExternal } from "../lib/externalGames";

export default function ConnectGame() {
  const { id } = useParams();
  const game = getGame(id);
  const { user, loading } = useAuthContext();
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);
  const ok = isExternal(game) && !!game.signIn;

  useEffect(() => {
    if (!ok || loading) return;
    if (!user) {
      navigate(`/login?next=${encodeURIComponent(`/connect/${id}`)}`, { replace: true });
      return;
    }
    if (!supabase) return setFailed(true);
    void supabase.rpc("create_game_signin", { p_game: id }).then(({ data, error }) => {
      if (error || typeof data !== "string" || !isExternal(game)) return setFailed(true);
      window.location.replace(`${game.embedUrl.split("#")[0]}#senevon_code=${data}`);
    });
  }, [ok, loading, user, id, game, navigate]);

  if (!ok) return <Navigate to="/" replace />;
  return (
    <article className="page narrow info-page callback-page">
      <h1>{failed ? "Couldn't connect" : `Connecting to ${game.title}…`}</h1>
      <p>
        {failed
          ? "Something went wrong signing you in. Go back to the game and try again."
          : "Signing you in with your Senevon account."}
      </p>
    </article>
  );
}
