import { HeartToggle } from "./anim-icons/toggles";
import { useFavorites } from "../lib/favorites";
import "./favorite-button.css";

/**
 * Heart that saves a game to Favourites (and takes it off again).
 *   variant "round": a round soft button (home page, next to Play)
 *   variant "plain": fits a toolbar of icon buttons (game page header)
 */
export default function FavoriteButton({ id, title, variant = "round" }: { id: string; title: string; variant?: "round" | "plain" }) {
  const { has, toggle } = useFavorites();
  const on = has(id);
  const label = on ? `Remove ${title} from favourites` : `Add ${title} to favourites`;
  return (
    <button
      type="button"
      className={`fav-btn fav-${variant}${on ? " is-on" : ""}`}
      aria-pressed={on}
      aria-label={label}
      title={on ? "In favourites" : "Add to favourites"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle(id);
      }}
    >
      <HeartToggle on={on} size={variant === "round" ? 19 : 15} />
    </button>
  );
}
