import { useEffect, useState } from "react";
import { publicAchievements } from "../lib/engagement";
import "./rewards.css";
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
  const [badges, setBadges] = useState<Awaited<ReturnType<typeof publicAchievements>>>([]);
  useEffect(() => {
    if (valid) void publicAchievements(id!).then(setBadges, () => setBadges([]));
  }, [id, valid]);
  return (
    <div className="acct pc-acct">
      <section className="ac-card pc-page">
        {valid ? <ProfileDetails userId={id!} full /> : <div className="pc-body pc-empty"><p>This player doesn't exist.</p></div>}
      </section>
      {badges.length ? (
        <section className="ac-card">
          <h2 className="ac-h2">Achievements · {badges.length}</h2>
          <ul className="rw-ach">
            {badges.map((b) => (
              <li key={b.id} className="is-on" title={b.description}>
                <span className="rw-ach-icon" aria-hidden="true">
                  {b.icon}
                </span>
                <b>{b.title}</b>
                <small>{b.description}</small>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
