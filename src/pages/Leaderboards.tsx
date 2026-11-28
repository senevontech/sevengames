import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarClock, Crown, Gift, Medal, Trophy } from "../components/anim-icons";
import { games, scoreLabel, type Game } from "../catalog";
import { GamePoster } from "../components/GamePoster";
import AdSlot from "../components/AdSlot";
import PlayerAvatar from "../components/PlayerAvatar";
import { useAuthContext } from "../context/AuthContext";
import { isLowerBetter, useLeaderboard, useOverallLeaderboard } from "../lib/scores";
import { formatTokens } from "../lib/currency";
import type { AvatarChoice } from "../lib/avatar";
import { claimMonthPrize, monthName, prizeFor, useMonthBoard, useMyPrizes, type MonthBoard as MonthData, type MyPrize } from "../lib/monthly";
import { useTokens } from "../lib/tokens";
import { celebrate } from "../lib/celebrate";
import TokenIcon from "../components/TokenIcon";
import "./account.css";
import "./leaderboards.css";

// only built-in games report scores
const boardGames = games.filter((g) => g.kind === "builtin");

type Row = { rank: number; userId: string; name: string; value: string; sub?: string; avatar: AvatarChoice | null; prize?: number };

/** a row's monthly prize, in chips */
function PrizeTag({ chips }: { chips?: number }) {
  if (!chips) return null;
  return (
    <span className="lb-prize" title={`${formatTokens(chips)} chips prize`}>
      <TokenIcon size={13} />
      {formatTokens(chips)}
    </span>
  );
}

function Board({ rows, loading, error, you, unit, empty }: { rows: Row[]; loading: boolean; error: string | null; you?: string; unit: string; empty?: string }) {
  if (loading) {
    return (
      <div className="lb-list">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="lb-row is-skeleton" />
        ))}
      </div>
    );
  }
  if (error) return <p className="lb-empty">{error}</p>;
  if (!rows.length) {
    return (
      <div className="lb-empty">
        <Trophy size={28} aria-hidden="true" />
        <p>{empty ?? "No scores yet. Finish a round while signed in to take the top spot."}</p>
        <Link className="ac-btn ac-btn-primary ac-btn-sm" to="/">
          Play a game
        </Link>
      </div>
    );
  }

  const podium = rows.slice(0, 3);
  const rest = rows.slice(3);
  // podium order on screen: 2nd, 1st, 3rd
  const order = [podium[1], podium[0], podium[2]].filter(Boolean) as Row[];

  return (
    <>
      <ol className="lb-podium" aria-label="Top three">
        {order.map((r) => (
          <li key={r.userId} className={`lb-step place-${r.rank}${r.userId === you ? " is-you" : ""}`}>
            <span className="lb-step-badge" aria-hidden="true">
              {r.rank === 1 ? <Crown size={18} /> : <Medal size={16} />}
            </span>
            <PlayerAvatar id={r.userId} name={r.name} avatar={r.avatar} size={r.rank === 1 ? 64 : 52} />
            <b className="lb-step-name" title={r.name}>
              {r.userId === you ? "You" : r.name}
            </b>
            <span className="lb-step-value">
              {r.value}
              <small> {unit}</small>
            </span>
            <PrizeTag chips={r.prize} />
            <span className="lb-step-base">{r.rank}</span>
          </li>
        ))}
      </ol>

      {rest.length ? (
        <ol className="lb-list" start={4}>
          {rest.map((r) => (
            <li key={r.userId} className={`lb-row${r.userId === you ? " is-you" : ""}`}>
              <span className="lb-rank">{r.rank}</span>
              <PlayerAvatar id={r.userId} name={r.name} avatar={r.avatar} />
              <span className="lb-name">
                <b title={r.name}>{r.userId === you ? "You" : r.name}</b>
                {r.sub ? <small>{r.sub}</small> : null}
              </span>
              <PrizeTag chips={r.prize} />
              <span className="lb-value">
                {r.value}
                <small> {unit}</small>
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </>
  );
}

function OverallBoard({ you }: { you?: string }) {
  const { rows, loading, error } = useOverallLeaderboard(50);
  const mapped: Row[] = rows.map((r) => ({
    rank: r.rank,
    userId: r.userId,
    name: r.displayName,
    value: formatTokens(r.points),
    avatar: r.avatar,
    sub: `${r.firsts} first place${r.firsts === 1 ? "" : "s"} · ${r.games} game${r.games === 1 ? "" : "s"} · ${formatTokens(r.rounds)} rounds`,
  }));
  return <Board rows={mapped} loading={loading} error={error} you={you} unit="pts" />;
}

/** "3d 4h" / "5h 12m" / "8m" until the month ends */
function timeLeft(endsAt: string, now: number) {
  const ms = Math.max(0, Date.parse(endsAt) - now);
  const m = Math.floor(ms / 60000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m % 60}m`;
  return `${m}m`;
}

function MonthPrizes({ data }: { data: MonthData }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(t);
  }, []);
  const [p1, p2, p3, rest] = data.prizes;
  return (
    <div className="lb-month-head">
      <p className="lb-month-ends">
        <CalendarClock size={15} aria-hidden="true" />
        {monthName(data.month)} · ends in <b>{timeLeft(data.endsAt, now)}</b>
      </p>
      {data.pays ? (
        <ul className="lb-month-prizes" aria-label="Prizes">
          <li className="place-1">
            1st <PrizeTag chips={p1} />
          </li>
          <li className="place-2">
            2nd <PrizeTag chips={p2} />
          </li>
          <li className="place-3">
            3rd <PrizeTag chips={p3} />
          </li>
          <li>
            4th–10th <PrizeTag chips={rest} />
          </li>
        </ul>
      ) : null}
      {data.me ? (
        <p className="lb-month-me">
          You: <b>#{data.me.rank}</b> · {formatTokens(data.me.points)} pts
          {data.pays && data.me.rank <= 10 ? " · in the prizes!" : ""}
        </p>
      ) : null}
    </div>
  );
}

function MonthBoard({ you }: { you?: string }) {
  const { board, loading, error } = useMonthBoard(50);
  const mapped: Row[] = (board?.top ?? []).map((r) => ({
    rank: r.rank,
    userId: r.userId,
    name: r.name,
    value: formatTokens(r.points),
    avatar: r.avatar,
    prize: board?.pays ? prizeFor(r.rank, board.prizes) : undefined,
    sub: `${r.firsts} first place${r.firsts === 1 ? "" : "s"} · ${r.games} game${r.games === 1 ? "" : "s"} · ${formatTokens(r.rounds)} rounds`,
  }));
  const last = board?.last;
  return (
    <>
      {board ? <MonthPrizes data={board} /> : null}
      <Board rows={mapped} loading={loading} error={error} you={you} unit="pts" empty="No scores this month yet. Finish a round while signed in to get on the board." />
      {last?.winners.length ? (
        <div className="lb-last">
          <h2>{monthName(last.month)} winners</h2>
          <ol>
            {last.winners.map((w) => (
              <li key={w.userId}>
                <span className={`lb-last-rank place-${w.rank}`}>{w.rank}</span>
                <PlayerAvatar id={w.userId} name={w.name} avatar={w.avatar} size={28} />
                <b title={w.name}>{w.userId === you ? "You" : w.name}</b>
                <PrizeTag chips={w.prize} />
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </>
  );
}

/** "You finished #2 in November" + Claim, one per unclaimed month. */
function PrizeClaims({ userId }: { userId?: string }) {
  const { prizes, reload } = useMyPrizes(userId);
  const { refresh } = useTokens();
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<{ month: string; amount: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const claim = async (p: MyPrize) => {
    setBusy(p.month);
    setError(null);
    try {
      const amount = await claimMonthPrize(p.month);
      setDone({ month: p.month, amount });
      celebrate("coins");
      await Promise.all([refresh(), reload()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!prizes.length && !done) return null;
  return (
    <section className="ac-card lb-claim" aria-live="polite">
      {done ? (
        <p className="lb-claim-done">
          <Gift size={18} aria-hidden="true" /> +{formatTokens(done.amount)} chips added for {monthName(done.month)}. Well played!
        </p>
      ) : null}
      {prizes.map((p) => (
        <div key={p.month} className="lb-claim-row">
          <span className={`lb-claim-icon place-${Math.min(p.rank, 4)}`} aria-hidden="true">
            {p.rank === 1 ? <Crown size={22} /> : p.rank <= 3 ? <Medal size={20} /> : <Trophy size={20} />}
          </span>
          <div className="lb-claim-text">
            <b>You finished #{p.rank} in {monthName(p.month)}</b>
            <small>{formatTokens(p.points)} points on the monthly leaderboard</small>
          </div>
          <button type="button" className="ac-btn ac-btn-primary ac-btn-sm" disabled={busy !== null} onClick={() => void claim(p)}>
            {busy === p.month ? (
              "Claiming…"
            ) : (
              <>
                Claim <TokenIcon size={15} /> {formatTokens(p.prize)}
              </>
            )}
          </button>
        </div>
      ))}
      {error ? <p className="lb-claim-error">{error}</p> : null}
    </section>
  );
}

function GameBoard({ game, you }: { game: Game; you?: string }) {
  const { leaders, loading, error } = useLeaderboard(game.id, 25);
  const mapped: Row[] = leaders.map((r) => ({ rank: r.rank, userId: r.userId, name: r.displayName, value: formatTokens(r.score), avatar: r.avatar }));
  return <Board rows={mapped} loading={loading} error={error} you={you} unit={isLowerBetter(game.id) ? "s" : ""} />;
}

export default function Leaderboards() {
  const { user } = useAuthContext();
  const [params, setParams] = useSearchParams();
  const gameId = params.get("game");
  const game = useMemo(() => boardGames.find((g) => g.id === gameId) ?? null, [gameId]);
  const month = !game && params.get("board") === "month";

  useEffect(() => {
    document.title = "Leaderboards — Senevon Game Studio";
  }, []);

  // keep the selected tab in view on narrow screens
  useEffect(() => {
    document.querySelector(".lb-tab.on")?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [gameId, month]);

  const pick = (id: string | null) => setParams(id ? { game: id } : {}, { replace: true });
  const pickMonth = () => setParams({ board: "month" }, { replace: true });

  return (
    <div className="acct lb">
      <section className="ac-card lb-hero">
        <span className="lb-hero-icon" aria-hidden="true">
          <Trophy size={26} />
        </span>
        <div>
          <h1 className="lb-title">Leaderboards</h1>
          <p className="ac-sub">
            {game
              ? `Top players in ${game.title} · ${scoreLabel(game)}, one entry per player.`
              : month
                ? "This month: the same points, from scores set this month only. The top 10 win chips when the month ends."
                : "Overall: points for every top-10 finish in each game (1st = 10 points)."}
          </p>
        </div>
        {!user ? (
          <Link className="ac-btn ac-btn-primary ac-btn-sm lb-hero-cta" to="/login?next=/leaderboards">
            Sign in to compete
          </Link>
        ) : game ? (
          <Link className="ac-btn ac-btn-primary ac-btn-sm lb-hero-cta" to={`/game/${game.id}`}>
            Play {game.title}
          </Link>
        ) : null}
      </section>

      <PrizeClaims userId={user?.id} />

      <nav className="lb-tabs" aria-label="Choose a leaderboard">
        <button type="button" className={`lb-tab${!game && !month ? " on" : ""}`} aria-pressed={!game && !month} onClick={() => pick(null)}>
          <span className="lb-tab-icon" aria-hidden="true">
            <Crown size={16} />
          </span>
          Overall
        </button>
        <button type="button" className={`lb-tab${month ? " on" : ""}`} aria-pressed={month} onClick={pickMonth}>
          <span className="lb-tab-icon" aria-hidden="true">
            <Gift size={16} />
          </span>
          This month
        </button>
        {boardGames.map((g) => (
          <button key={g.id} type="button" className={`lb-tab${game?.id === g.id ? " on" : ""}`} aria-pressed={game?.id === g.id} onClick={() => pick(g.id)}>
            <span className="lb-tab-poster" aria-hidden="true">
              <GamePoster game={g} size="thumb" />
            </span>
            {g.title}
          </button>
        ))}
      </nav>

      <section className="ac-card lb-board" aria-live="polite">
        {game ? <GameBoard key={game.id} game={game} you={user?.id} /> : month ? <MonthBoard you={user?.id} /> : <OverallBoard you={user?.id} />}
      </section>

      <AdSlot placement="leaderboards" />
    </div>
  );
}
