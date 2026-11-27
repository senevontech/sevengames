/* useAnimations' player plus the three icons we use (its own download). */
import UseAnimations from "react-useanimations";
import heart from "react-useanimations/lib/heart";
import loading from "react-useanimations/lib/loading";
import menu from "react-useanimations/lib/menu";

const ICONS = { heart, loading, menu };

export default function UaPlayer({ kind, active, size, className }: { kind: keyof typeof ICONS; active?: boolean; size: number; className?: string }) {
  return (
    <UseAnimations
      animation={ICONS[kind]}
      active={active}
      size={size}
      fillColor="currentColor"
      className={`ua-icon${className ? ` ${className}` : ""}`}
      // the surrounding button handles the click; the icon only shows the state
      style={{ display: "inline-flex", pointerEvents: "none" }}
    />
  );
}
