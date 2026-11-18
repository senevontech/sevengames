import { useState } from "react";
import { useAvatarUri, type AvatarChoice } from "../lib/avatar";
import "./player-avatar.css";

/** Stable colour per player for their initial badge. */
const hueOf = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
};

/**
 * Another player's avatar (leaderboards): their Google photo or generated avatar, falling back
 * to a coloured initial while it loads, when they have none, or when the photo fails to load.
 */
export default function PlayerAvatar({
  id,
  name,
  avatar,
  size = 36,
  className = "lb-initial",
}: {
  id: string;
  name: string;
  avatar: AvatarChoice | null;
  size?: number;
  className?: string;
}) {
  const uri = useAvatarUri(avatar);
  const [failed, setFailed] = useState<string | null>(null);
  const showImage = uri && failed !== uri;

  return (
    <span
      className={`${className}${showImage ? " has-img" : ""}`}
      style={{ width: size, height: size, "--h": hueOf(id) } as React.CSSProperties}
      aria-hidden="true"
    >
      {showImage ? (
        <img
          src={uri}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(uri)}
        />
      ) : (
        name.charAt(0).toUpperCase()
      )}
    </span>
  );
}
