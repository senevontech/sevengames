import { Link } from "react-router-dom";
import { useAuthContext } from "../context/AuthContext";
import { useAvatar } from "../lib/avatar";
import { RiUser3Line } from "./ReIcons";
import AvatarFrame from "./AvatarFrame";

/*
 * Right-hand nav slot of the new UI: a round button. Signed out it shows the account icon and
 * slides open to "Sign in" on hover/focus; signed in it shows the avatar and opens to "Profile".
 */
export default function NavAccount() {
  const { user } = useAuthContext();
  const { uri } = useAvatar(user);

  if (!user) {
    return (
      <Link className="h3-account" to="/login" aria-label="Sign in">
        <span className="h3-account-icon">
          <RiUser3Line size={18} aria-hidden="true" />
        </span>
        <span className="h3-account-label" aria-hidden="true">
          Sign in
        </span>
      </Link>
    );
  }

  const meta = user.user_metadata ?? {};
  const name = (meta.full_name as string | undefined) || (meta.name as string | undefined) || user.email || "Player";
  return (
    <Link className="h3-account" to="/profile" aria-label={`Your profile (${name})`}>
      <AvatarFrame userId={user.id}>
        <span className="h3-account-icon">
          {uri ? <img src={uri} alt="" width={40} height={40} referrerPolicy="no-referrer" /> : <RiUser3Line size={18} aria-hidden="true" />}
        </span>
      </AvatarFrame>
      <span className="h3-account-label" aria-hidden="true">
        Profile
      </span>
    </Link>
  );
}
