import type { ReactNode } from "react";
import { useFrameOf } from "../lib/shop";
import { frameClass } from "../lib/shopCatalog";
import "./avatar-frame.css";

/**
 * Wraps a round avatar in the frame its owner has equipped (bought in the shop). Renders the
 * avatar unchanged when there is no frame, so layouts don't shift for players without one.
 */
export default function AvatarFrame({ userId, children }: { userId: string | null | undefined; children: ReactNode }) {
  const cls = frameClass(useFrameOf(userId));
  return cls ? <span className={cls}>{children}</span> : <>{children}</>;
}
