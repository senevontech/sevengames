import { WifiOff } from "lucide-react";
import { useOnline } from "../lib/online";
import "./offline-banner.css";

/** A small pill at the top while there's no connection. */
export default function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div className="offline-banner" role="status">
      <WifiOff size={14} aria-hidden="true" />
      Offline · free games still work; progress is saved and synced later
    </div>
  );
}
