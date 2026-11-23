/* /rewards: everything that earns tokens for free. Daily login streak, today's challenges, the
   weekly competition, friend challenges, tournaments, invite-a-friend and achievements. */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarCheck, Check, Copy, Gift, Swords, Target, Trophy, UserPlus, Users } from "lucide-react";
import { useAuthContext } from "../context/AuthContext";
import { useTokens } from "../lib/tokens";
import { useMyCircle } from "../lib/social";
import { games } from "../catalog";
import { formatTokens } from "../lib/currency";
import TokenIcon from "../components/TokenIcon";
import PlayerAvatar from "../components/PlayerAvatar";
import AchievementGrid from "../components/AchievementGrid";
import {
  achievementsSync,
  challengeClaim,
  challengesToday,
  dailyClaim,
  dailyState,
  engagementErrorText,
  friendChallengeSend,
  friendChallenges,
  referralClaim,
  referralState,
  tournamentJoin,
  tournamentsList,
  weeklyCurrent,
  type Achievement,
  type ChallengeDay,
  type DailyState,
  type FriendChallenge,
  type ReferralState,
  type Tournament,
  type Weekly,
} from "../lib/engagement";
import "./account.css";
import "./rewards.css";

const gameById = (id: string | null | undefined) => games.find((g) => g.id === id);
const gameTitle = (id: string | null | undefined) => gameById(id)?.title ?? id ?? "";

function timeLeft(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "ended";
  const h = Math.floor(ms / 3_600_000);
  if (h >= 48) return `${Math.floor(h / 24)} days left`;
  if (h >= 1) return `${h} h left`;
  return `${Math.max(1, Math.floor(ms / 60_000))} min left`;
}

type Note = { ok: boolean; text: string } | null;

export default function RewardsPage() {
  const { user } = useAuthContext();
  const { refresh: refreshTokens } = useTokens();
  const [note, setNote] = useState<Note>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [daily, setDaily] = useState<DailyState | null>(null);
  const [ch, setCh] = useState<ChallengeDay | null>(null);
  const [weekly, setWeekly] = useState<Weekly | null>(null);
  const [ref, setRef] = useState<ReferralState | null>(null);
  const [fc, setFc] = useState<FriendChallenge[]>([]);
  const [tours, setTours] = useState<{ enabled: boolean; list: Tournament[] } | null>(null);
  const [ach, setAch] = useState<Achievement[] | null>(null);
  const [setupMissing, setSetupMissing] = useState(false);

  useEffect(() => {
    document.title = "Rewards — Senevon Game Studio";
  }, []);

  const load = useCallback(async () => {
    // start fresh each time: a call that failed before the server was set up mustn't stick
    setSetupMissing(false);
    const miss = (e: unknown) => {
      if (String((e as Error)?.message).includes("Could not find the function")) setSetupMissing(true);
    };
    void weeklyCurrent().then(setWeekly, miss);
    void challengesToday().then(setCh, miss);
    void tournamentsList().then(setTours, () => setTours(null));
    if (!user) return;
    void dailyState().then(setDaily, miss);
    void referralState().then(setRef, miss);
    void friendChallenges().then(setFc, () => setFc([]));
    void achievementsSync().then((r) => {
      setAch(r.list);
      if (r.new.length) {
        const sum = r.new.reduce((a, x) => a + x.reward, 0);
        setNote({ ok: true, text: `Unlocked ${r.new.map((x) => `${x.icon} ${x.title}`).join(", ")} · +${formatTokens(sum)} tokens` });
        void refreshTokens();
      }
    }, miss);
  }, [user, refreshTokens]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(key: string, fn: () => Promise<string>) {
    setBusy(key);
    setNote(null);
    try {
      setNote({ ok: true, text: await fn() });
      void refreshTokens();
      void load();
    } catch (e) {
      setNote({ ok: false, text: engagementErrorText(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="acct rw">
      <section className="ac-card rw-hero">
        <span className="rw-hero-icon" aria-hidden="true">
          <Gift size={28} />
        </span>
        <div className="rw-hero-text">
          <h1>Rewards</h1>
          <p className="ac-sub">Free tokens every day: log in, finish challenges, compete and invite friends.</p>
        </div>
        {user && !setupMissing ? (
          <ul className="rw-stats" aria-label="Your progress">
            <li>
              <b>{daily ? daily.run : "–"}</b>
              <small>day streak</small>
            </li>
            <li>
              <b>{ch?.list ? `${ch.list.filter((c) => c.claimed).length}/${ch.list.length}` : "–"}</b>
              <small>challenges today</small>
            </li>
            <li>
              <b>{ach ? `${ach.filter((a) => a.unlocked_at).length}/${ach.length}` : "–"}</b>
              <small>achievements</small>
            </li>
            <li>
              <b>{weekly?.me ? `#${weekly.me.rank}` : "–"}</b>
              <small>this week</small>
            </li>
          </ul>
        ) : null}
      </section>

      {setupMissing || (!user && !weekly && !ch) ? <EarnGuide soon={setupMissing} /> : null}
      {note ? (
        <p className={`tw-note${note.ok ? " ok" : " bad"}`} role="status">
          {note.ok ? <Check size={16} aria-hidden="true" /> : null}
          {note.text}
        </p>
      ) : null}

      {!user ? (
        <section className="ac-card rw-signin">
          <p>
            <b>Sign in to collect rewards.</b> Daily rewards, challenges, invites and achievements are saved to your account.
          </p>
          <Link className="ac-btn ac-btn-primary" to="/login?next=/rewards">
            Sign in
          </Link>
        </section>
      ) : null}

      {/* ---------- daily login ---------- */}
      {user && daily ? (
        <section className="ac-card rw-daily">
          <div className="rw-head">
            <CalendarCheck size={20} aria-hidden="true" />
            <h2 className="ac-h2">Daily reward</h2>
            <span className="rw-pill">{daily.run > 0 ? `${daily.run}-day streak` : "Start a streak"}</span>
          </div>
          <ol className="rw-days">
            {daily.rewards.map((r, i) => {
              const day = i + 1;
              const done = daily.claimed ? day <= daily.day : day < daily.day;
              const today = day === daily.day;
              return (
                <li key={day} className={`${done ? "is-done" : ""}${today ? " is-today" : ""}`}>
                  <small>Day {day}</small>
                  <b>
                    <TokenIcon size={14} /> {daily.plus ? r * 2 + 50 : r}
                  </b>
                  {done ? <Check size={14} aria-label="claimed" /> : null}
                </li>
              );
            })}
          </ol>
          <div className="rw-row">
            <button
              type="button"
              className="ac-btn ac-btn-primary"
              disabled={daily.claimed || busy === "daily"}
              onClick={() => void act("daily", async () => `+${formatTokens((await dailyClaim()).amount)} tokens. See you tomorrow!`)}
            >
              {daily.claimed ? "Claimed today ✓" : `Claim ${formatTokens(daily.reward)} tokens`}
            </button>
            <span className="ac-sub">
              {daily.plus ? "Plus: double rewards + 50 bonus every day." : "Miss a day and the streak starts again. Plus members get double."}
            </span>
          </div>
        </section>
      ) : null}

      {/* ---------- daily challenges ---------- */}
      {ch?.list?.length ? (
        <section className="ac-card">
          <div className="rw-head">
            <Target size={20} aria-hidden="true" />
            <h2 className="ac-h2">Today's challenges</h2>
            <span className="rw-pill">{timeLeft(ch.ends_at)}</span>
          </div>
          <ul className="rw-challenges">
            {ch.list.map((c) => {
              const done = c.progress >= c.target;
              const g = gameById(c.game_id);
              return (
                <li key={c.id} className={c.claimed ? "is-claimed" : done ? "is-done" : ""}>
                  <div className="rw-ch-text">
                    <b>{c.title}</b>
                    <span className="rw-bar" aria-hidden="true">
                      <i style={{ width: `${(c.progress / c.target) * 100}%` }} />
                    </span>
                    <small>
                      {c.target > 50 ? `Best today: ${formatTokens(c.progress)}` : `${c.progress} / ${c.target}`}
                    </small>
                  </div>
                  {c.claimed ? (
                    <span className="rw-claimed">
                      <Check size={14} /> +{c.reward}
                    </span>
                  ) : done && user ? (
                    <button type="button" className="ac-btn ac-btn-sm ac-btn-primary" disabled={busy === c.id} onClick={() => void act(c.id, async () => `+${formatTokens((await challengeClaim(c.id)).amount)} tokens`)}>
                      Claim <TokenIcon size={13} /> {c.reward}
                    </button>
                  ) : (
                    <Link className="ac-btn ac-btn-sm" to={g ? `/game/${g.id}` : "/"}>
                      <TokenIcon size={13} /> {c.reward} · Play
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="ac-sub">
            Finish all three for a <b>+{ch.bonus}</b> bonus{ch.bonus_claimed ? " ✓ (collected)" : ""}. Progress counts saved scores, so sign in before you play.
          </p>
        </section>
      ) : null}

      {/* ---------- weekly competition ---------- */}
      {weekly ? (
        <section className="ac-card">
          <div className="rw-head">
            <Trophy size={20} aria-hidden="true" />
            <h2 className="ac-h2">Weekly competition · {gameTitle(weekly.game_id)}</h2>
            <span className="rw-pill">{timeLeft(weekly.ends_at)}</span>
          </div>
          <p className="ac-sub">
            {weekly.lower_better ? "Lowest" : "Best"} score this week wins. Prizes: 1st <TokenIcon size={12} /> 2,000 · 2nd 1,000 · 3rd 500 · 4th–10th 100.
          </p>
          <ol className="rw-board">
            {weekly.top.length === 0 ? <li className="rw-empty">No scores yet. Be the first!</li> : null}
            {weekly.top.map((r) => (
              <li key={r.user_id} className={r.user_id === user?.id ? "is-me" : ""}>
                <span className="rw-rank">{r.rank}</span>
                <PlayerAvatar id={r.user_id} name={r.name ?? "Player"} avatar={r.avatar} size={26} />
                <span className="rw-name">{r.name ?? "Player"}</span>
                <b>{formatTokens(r.score)}</b>
              </li>
            ))}
          </ol>
          <div className="rw-row">
            <Link className="ac-btn ac-btn-primary" to={`/game/${weekly.game_id}`}>
              Play {gameTitle(weekly.game_id)}
            </Link>
            <span className="ac-sub">
              {weekly.me ? `You: #${weekly.me.rank} with ${formatTokens(weekly.me.score)}` : user ? "No score from you yet this week." : "Sign in to enter."}
            </span>
          </div>
          {weekly.last.winners.length ? (
            <p className="ac-sub">
              Last week ({gameTitle(weekly.last.game_id)}): {weekly.last.winners.map((w) => `${["🥇", "🥈", "🥉"][w.rank - 1]} ${w.name ?? "Player"}`).join("  ")}
            </p>
          ) : null}
        </section>
      ) : null}

      {/* ---------- friend challenges ---------- */}
      {user && !setupMissing ? <FriendChallenges list={fc} onChanged={load} setNote={setNote} /> : null}

      {/* ---------- tournaments ---------- */}
      {tours?.enabled && tours.list.length ? (
        <section className="ac-card">
          <div className="rw-head">
            <Swords size={20} aria-hidden="true" />
            <h2 className="ac-h2">Tournaments</h2>
          </div>
          <ul className="rw-tours">
            {tours.list.map((t) => {
              const upcoming = new Date(t.starts_at) > new Date();
              return (
                <li key={t.id}>
                  <div>
                    <b>{t.title}</b>
                    <small>
                      {gameTitle(t.game_id)} · {t.settled ? "finished" : upcoming ? `starts ${new Date(t.starts_at).toLocaleString()}` : timeLeft(t.ends_at)} · {t.entrants} players · prize
                      pool <TokenIcon size={11} /> {formatTokens(t.pool)}
                    </small>
                    {t.top.length ? (
                      <small className="rw-tour-top">{t.top.slice(0, 3).map((r) => `#${r.rank} ${r.name ?? "Player"} (${formatTokens(r.score)})`).join(" · ")}</small>
                    ) : null}
                  </div>
                  {t.settled ? (
                    t.me ? <span className="rw-pill">You: #{t.me.rank}</span> : null
                  ) : t.joined ? (
                    <Link className="ac-btn ac-btn-sm" to={`/game/${t.game_id}`}>
                      {t.me ? `#${t.me.rank} · Play` : "Joined · Play"}
                    </Link>
                  ) : user ? (
                    <button type="button" className="ac-btn ac-btn-sm ac-btn-primary" disabled={busy === t.id} onClick={() => void act(t.id, async () => (await tournamentJoin(t.id), `You're in: ${t.title}`))}>
                      Join · {t.entry_fee ? <><TokenIcon size={12} /> {formatTokens(t.entry_fee)}</> : "free"}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* ---------- invite friends ---------- */}
      {user && ref ? <Invite state={ref} onApplied={load} setNote={setNote} /> : null}

      {/* ---------- achievements ---------- */}
      {user && ach ? <AchievementGrid list={ach} /> : null}
    </div>
  );
}

function FriendChallenges({ list, onChanged, setNote }: { list: FriendChallenge[]; onChanged: () => void; setNote: (n: Note) => void }) {
  const { friends } = useMyCircle();
  const scoreGames = useMemo(() => games.filter((g) => g.kind === "builtin" && !["chess", "ludo"].includes(g.engine)), []);
  const [to, setTo] = useState("");
  const [game, setGame] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!to || !game) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await friendChallengeSend(to, game);
      setNote({ ok: true, text: `Challenge sent: beat ${formatTokens(r.target)} in ${gameTitle(game)} within 48 hours.` });
      onChanged();
    } catch (e) {
      setNote({ ok: false, text: engagementErrorText(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ac-card">
      <div className="rw-head">
        <Users size={20} aria-hidden="true" />
        <h2 className="ac-h2">Friend challenges</h2>
      </div>
      <p className="ac-sub">Dare a friend to beat your best score within 48 hours. The winner gets 50 tokens.</p>
      {friends.length ? (
        <div className="rw-form">
          <select value={to} onChange={(e) => setTo(e.target.value)} aria-label="Friend">
            <option value="">Pick a friend</option>
            {friends.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <select value={game} onChange={(e) => setGame(e.target.value)} aria-label="Game">
            <option value="">Pick a game</option>
            {scoreGames.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>
          <button type="button" className="ac-btn ac-btn-primary" disabled={!to || !game || busy} onClick={() => void send()}>
            Send challenge
          </button>
        </div>
      ) : (
        <p className="ac-sub">
          Add friends from <Link to="/profile#friends">your profile</Link> to challenge them.
        </p>
      )}
      {list.length ? (
        <ul className="rw-fc">
          {list.map((c) => (
            <li key={c.id} className={`is-${c.status}`}>
              <PlayerAvatar id={c.other.id} name={c.other.name ?? "Player"} avatar={c.other.avatar} size={28} />
              <div>
                <b>
                  {c.mine ? `You → ${c.other.name ?? "Player"}` : `${c.other.name ?? "Player"} → you`} · {gameTitle(c.game_id)}
                </b>
                <small>
                  Score to beat: {formatTokens(c.target)}
                  {c.best !== null ? ` · best try ${formatTokens(c.best)}` : ""}
                  {" · "}
                  {c.status === "open" ? timeLeft(c.expires_at) : c.won ? "you won +50" : "they won"}
                </small>
              </div>
              {c.status === "open" && !c.mine ? (
                <Link className="ac-btn ac-btn-sm ac-btn-primary" to={`/game/${c.game_id}`}>
                  Play
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Invite({ state, onApplied, setNote }: { state: ReferralState; onApplied: () => void; setNote: (n: Note) => void }) {
  const link = `${location.origin}/?ref=${state.code}`;
  const [copied, setCopied] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <section className="ac-card">
      <div className="rw-head">
        <UserPlus size={20} aria-hidden="true" />
        <h2 className="ac-h2">Invite friends</h2>
      </div>
      <p className="ac-sub">
        When a friend signs up with your link, you both get <TokenIcon size={12} /> {state.reward} tokens (up to {state.cap} friends).
      </p>
      <div className="rw-form">
        <input readOnly value={link} aria-label="Your invite link" onFocus={(e) => e.currentTarget.select()} />
        <button
          type="button"
          className="ac-btn ac-btn-primary"
          onClick={() => {
            const share = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
            if (share.share) void share.share({ title: "Senevon Games", text: "Play with me on Senevon Games!", url: link }).catch(() => undefined);
            else void navigator.clipboard?.writeText(link).then(() => setCopied(true));
          }}
        >
          <Copy size={15} aria-hidden="true" /> {copied ? "Copied" : "Share link"}
        </button>
      </div>
      <p className="ac-sub">
        Code <b>{state.code}</b> · {state.joined} joined · {state.paid} rewarded
      </p>
      {!state.referred_by ? (
        <form
          className="rw-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!code.trim()) return;
            setBusy(true);
            void referralClaim(code.trim())
              .then(
                (r) => setNote({ ok: true, text: r.paid ? `+${r.amount} tokens for joining with a friend's code!` : "Code saved." }),
                (err) => setNote({ ok: false, text: engagementErrorText(err) }),
              )
              .finally(() => {
                setBusy(false);
                onApplied();
              });
          }}
        >
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Got a friend's code?" maxLength={12} aria-label="Friend's invite code" />
          <button type="submit" className="ac-btn" disabled={busy || !code.trim()}>
            Use code
          </button>
        </form>
      ) : null}
    </section>
  );
}

/** How players earn: shown while the rewards server isn't ready (or to guests before data loads). */
function EarnGuide({ soon }: { soon: boolean }) {
  const ways = [
    { icon: CalendarCheck, title: "Daily reward", text: "Log in every day: 20 → 100 tokens over a 7-day streak." },
    { icon: Target, title: "Daily challenges", text: "Three quick tasks a day, 30–80 tokens each, +50 for all three." },
    { icon: Trophy, title: "Weekly competition", text: "Top the week's game: 2,000 / 1,000 / 500 tokens for the podium." },
    { icon: Users, title: "Friend challenges", text: "Dare a friend to beat your score in 48 hours. Winner gets 50." },
    { icon: UserPlus, title: "Invite friends", text: "You both get 250 tokens when a friend signs up with your link." },
    { icon: Swords, title: "Achievements", text: "26 badges for playing, winning and streaks, each with a token reward." },
  ];
  return (
    <section className="rw-guide" aria-label="Ways to earn tokens">
      {ways.map(({ icon: Icon, title, text }) => (
        <div key={title} className="ac-card rw-way">
          <span className="rw-way-icon" aria-hidden="true">
            <Icon size={20} />
          </span>
          <b>{title}</b>
          <p className="ac-sub">{text}</p>
          {soon ? <span className="rw-soon">Coming soon</span> : null}
        </div>
      ))}
    </section>
  );
}
