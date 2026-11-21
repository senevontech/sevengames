/* The Carrom shop outside the game (Tokens page): same locker, with the player's Carrom progress. */
import { useAuthContext } from "../context/AuthContext";
import { useCarromProgress } from "../games/carrom/progress";
import CarromLocker from "../games/carrom/Locker";
import "../pages/game-neu.css";

export default function CarromShop() {
  const { user } = useAuthContext();
  const prog = useCarromProgress(user);
  return (
    <div className="shop-hub-game">
      <CarromLocker prog={prog} signedIn={Boolean(user)} bare />
    </div>
  );
}
