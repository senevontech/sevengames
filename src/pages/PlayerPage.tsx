import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { ProfileDetails } from "../components/PlayerCard";
import "./account.css";

/** Public player profile: /player/:id (shareable). */
export default function PlayerPage() {
  const { id } = useParams();
  useEffect(() => {
    document.title = "Player — Senevon Game Studio";
  }, []);
  const valid = id && /^[0-9a-f-]{36}$/i.test(id);
  return (
    <div className="acct pc-acct">
      <section className="ac-card pc-page">
        {valid ? <ProfileDetails userId={id!} full /> : <div className="pc-body pc-empty"><p>This player doesn't exist.</p></div>}
      </section>
    </div>
  );
}
