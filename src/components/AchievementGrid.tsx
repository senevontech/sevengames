/* Achievement badges with progress (Rewards page, your profile) or just the unlocked ones
   (another player's page). Styles: pages/rewards.css. */
import { Check, Trophy } from "lucide-react";
import TokenIcon from "./TokenIcon";
import type { Achievement } from "../lib/engagement";
import "../pages/account.css";
import "../pages/rewards.css";

export default function AchievementGrid({ list, title = "Achievements" }: { list: Achievement[]; title?: string }) {
  const done = list.filter((a) => a.unlocked_at).length;
  return (
    <section className="ac-card">
      <div className="rw-head">
        <Trophy size={20} aria-hidden="true" />
        <h2 className="ac-h2">{title}</h2>
        <span className="rw-pill">
          {done} / {list.length}
        </span>
      </div>
      <ul className="rw-ach">
        {list.map((a) => (
          <li key={a.id} className={a.unlocked_at ? "is-on" : ""} title={a.description}>
            <span className="rw-ach-icon" aria-hidden="true">
              {a.icon}
            </span>
            <b>{a.title}</b>
            <small>{a.description}</small>
            {a.unlocked_at ? (
              <small className="rw-ach-got">
                <Check size={12} /> {new Date(a.unlocked_at).toLocaleDateString()}
              </small>
            ) : (
              <span className="rw-bar" aria-label={`${a.progress} of ${a.target}`}>
                <i style={{ width: `${(a.progress / a.target) * 100}%` }} />
              </span>
            )}
            <small className="rw-ach-reward">
              <TokenIcon size={11} /> {a.reward}
            </small>
          </li>
        ))}
      </ul>
    </section>
  );
}
