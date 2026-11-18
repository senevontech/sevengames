/* Live top-7 for the home hero (bottom-right, transparent). Rows glide to their new place when
   ranks change (FLIP), climbers glow, players leaving the top 7 drift up and fade out, and new
   entries rise in from below. Updates arrive in real time (lib/social.ts → useLiveTop).
   Tapping a row opens that player's profile card. */
import { useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import PlayerAvatar from "./PlayerAvatar";
import { PlayerCardModal } from "./PlayerCard";
import { useLiveTop, type TopRow } from "../lib/social";
import "./hero-leaderboard.css";

const MOVE_MS = 650;

function Badge({ rank }: { rank: number }) {
  return <span className={`hl-badge hl-r${Math.min(rank, 4)}`}>{rank}</span>;
}

export default function HeroLeaderboard() {
  const { rows, pulse } = useLiveTop(7);
  const [open, setOpen] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<(TopRow & { top: number; rank: number; key: number })[]>([]);
  const [climbers, setClimbers] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLOListElement>(null);
  const els = useRef(new Map<string, HTMLLIElement>());
  const prev = useRef<{ tops: Map<string, number>; ranks: Map<string, number>; rows: TopRow[] } | null>(null);
  const leaveKey = useRef(0);

  // FLIP: glide rows from where they were to where they are now
  useLayoutEffect(() => {
    if (!rows) return;
    const before = prev.current;
    const tops = new Map<string, number>();
    const ranks = new Map<string, number>();
    rows.forEach((r, i) => {
      const el = els.current.get(r.userId);
      if (el) tops.set(r.userId, el.offsetTop);
      ranks.set(r.userId, i + 1);
    });
    const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (before && !calm) {
      const up = new Set<string>();
      rows.forEach((r, i) => {
        const el = els.current.get(r.userId);
        if (!el) return;
        const was = before.tops.get(r.userId);
        const now = tops.get(r.userId)!;
        if (was === undefined) {
          el.animate([{ opacity: 0, transform: "translateY(18px)" }, { opacity: 1, transform: "none" }], { duration: MOVE_MS, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
        } else if (was !== now) {
          el.animate([{ transform: `translateY(${was - now}px)` }, { transform: "none" }], { duration: MOVE_MS, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
        }
        const oldRank = before.ranks.get(r.userId);
        if (oldRank === undefined || oldRank > i + 1) up.add(r.userId);
      });
      // players who dropped out of the top 7 drift up and fade away
      const gone = before.rows.filter((r) => !ranks.has(r.userId));
      if (gone.length) {
        setLeaving((l) => [
          ...l,
          ...gone.map((r) => ({ ...r, top: before.tops.get(r.userId) ?? 0, rank: before.ranks.get(r.userId) ?? 7, key: ++leaveKey.current })),
        ]);
        window.setTimeout(() => setLeaving((l) => l.slice(gone.length)), 900);
      }
      if (up.size) {
        setClimbers(up);
        window.setTimeout(() => setClimbers(new Set()), 2200);
      }
    }
    prev.current = { tops, ranks, rows };
  }, [rows]);

  if (!rows || rows.length === 0) return null;

  return (
    <aside className="hl" aria-label="Live leaderboard">
      <ol className="hl-list" ref={listRef}>
        {rows.map((r, i) => (
          <li
            key={r.userId}
            ref={(el) => {
              if (el) els.current.set(r.userId, el);
              else els.current.delete(r.userId);
            }}
            className={`${climbers.has(r.userId) ? "is-up" : ""}${pulse === r.userId ? " is-pulse" : ""}`}
            style={{ "--d": `${(rows.length - 1 - i) * 90}ms` } as React.CSSProperties}
          >
            <button type="button" className="hl-row" onClick={() => setOpen(r.userId)} aria-label={`#${i + 1} ${r.name}, ${r.points} points — view profile`}>
              <Badge rank={i + 1} />
              <PlayerAvatar id={r.userId} name={r.name} avatar={r.avatar} size={22} className="lb-initial hl-av" />
              <span className="hl-name">{r.name}</span>
              <small className="hl-pts">{r.points}</small>
            </button>
          </li>
        ))}
        {leaving.map((r) => (
          <li key={`gone-${r.key}`} className="hl-leaving" style={{ top: r.top }} aria-hidden="true">
            <span className="hl-row">
              <Badge rank={r.rank} />
              <PlayerAvatar id={r.userId} name={r.name} avatar={r.avatar} size={22} className="lb-initial hl-av" />
              <span className="hl-name">{r.name}</span>
            </span>
          </li>
        ))}
      </ol>
      <div className="hl-head">
        <span className="hl-live" aria-hidden="true" />
        <b>Live top 7</b>
        <Link to="/leaderboards" className="hl-all">
          All
        </Link>
      </div>
      {open ? <PlayerCardModal userId={open} onClose={() => setOpen(null)} /> : null}
    </aside>
  );
}
