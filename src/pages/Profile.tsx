import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, Check, Eye, Gamepad2, History, LogOut, Medal, Pencil, Share2, ShieldCheck, Trophy, Users } from "../components/anim-icons";
import { promptAdFree } from "../lib/adFreePromo";
import TokenIcon from "../components/TokenIcon";
import { useAuthContext } from "../context/AuthContext";
import { useAvatar } from "../lib/avatar";
import AvatarLibrary from "../components/AvatarLibrary";
import { GamePoster } from "../components/GamePoster";
import { games, scoreLabel } from "../catalog";
import { isLowerBetter, usePersonalScores } from "../lib/scores";
import { useShowAds, useTokens } from "../lib/tokens";
import { PROGRESS_GAMES, useGameProgress } from "../lib/progress";
import { formatTokens } from "../lib/currency";
import "./account.css";
import "./profile.css";
import AvatarFrame from "../components/AvatarFrame";
import FriendsSection from "../components/FriendsSection";
import AchievementGrid from "../components/AchievementGrid";
import ChipHistory from "../components/ChipHistory";
import { achievementsSync, type Achievement } from "../lib/engagement";
import { usePublicProfile } from "../lib/social";
import { clubTagText, useMyClub } from "../lib/clubs";
import { setPerfChoice, usePerf, type PerfChoice } from "../lib/perf";

/** One game's saved level, with a two-step reset. */
function ProgressRow({ gameId }: { gameId: string }) {
  const game = games.find((g) => g.id === gameId);
  const progress = useGameProgress(gameId);
  const [confirming, setConfirming] = useState(false);
  if (!game) return null;
  return (
    <li className="pf-progress-row">
      <Link to={`/game/${game.id}`} className="pf-progress-game">
        <GamePoster game={game} size="thumb" />
        <span className="pf-best-title">{game.title}</span>
      </Link>
      <span className="pf-best-score">
        <small>Level</small>
        <b>{progress.level}</b>
      </span>
      {confirming ? (
        <span className="pf-progress-confirm">
          <button type="button" className="ac-btn ac-btn-sm ac-btn-ghost" onClick={() => setConfirming(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="ac-btn ac-btn-sm pf-progress-danger"
            onClick={() => {
              progress.reset();
              setConfirming(false);
            }}
          >
            Reset to 1
          </button>
        </span>
      ) : (
        <button
          type="button"
          className="ac-btn ac-btn-sm ac-btn-ghost"
          disabled={progress.level <= 1}
          onClick={() => setConfirming(true)}
        >
          Reset
        </button>
      )}
    </li>
  );
}

export default function Profile() {
  const auth = useAuthContext();
  const user = auth.user;
  const navigate = useNavigate();
  const { scores } = usePersonalScores(user);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const { uri: avatarUri } = useAvatar(user);
  const { wallet, loading: walletLoading } = useTokens();
  const showAds = useShowAds();
  const location = useLocation();

  useEffect(() => {
    document.title = "Profile — Senevon Game Studio";
  }, []);

  // achievements: unlock (and pay for) any newly reached, then show them all
  const [ach, setAch] = useState<Achievement[] | null>(null);
  useEffect(() => {
    if (!user) return;
    void achievementsSync().then((r) => setAch(r.list), () => setAch(null));
  }, [user]);

  // "/profile#avatars" (from the nav avatar menu) jumps straight to the library.
  useEffect(() => {
    if (location.hash !== "#avatars" && location.hash !== "#friends") return;
    const target = location.hash.slice(1);
    const id = requestAnimationFrame(() =>
      document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
    return () => cancelAnimationFrame(id);
  }, [location.hash, location.key]);

  // header numbers (friends, followers, rank…) from the public profile, and your club
  const { profile: pub } = usePublicProfile(user?.id ?? null);
  const { club, loaded: clubLoaded } = useMyClub();

  useEffect(() => {
    if (!user) {
      navigate("/login?next=/profile", { replace: true });
      return;
    }
    const meta = user.user_metadata ?? {};
    setDisplayName(
      (meta.full_name as string | undefined) || (meta.name as string | undefined) || (user.email?.split("@")[0] ?? "Player"),
    );
  }, [user, navigate]);

  if (!user) return null;

  const totalPlays = scores.length;
  const playedGameIds = [...new Set(scores.map((score) => score.gameId))];
  const latest = playedGameIds[0] ? games.find((game) => game.id === playedGameIds[0]) : null;
  const since = user.created_at
    ? new Date(user.created_at).toLocaleDateString(undefined, { month: "short", year: "numeric" })
    : null;

  function bestFor(gameId: string) {
    const lowerBetter = isLowerBetter(gameId);
    const rows = scores.filter((score) => score.gameId === gameId);
    if (!rows.length) return null;
    return rows.reduce(
      (best, row) => (lowerBetter ? (row.score < best ? row.score : best) : row.score > best ? row.score : best),
      rows[0].score,
    );
  }

  return (
    <div className="acct pf">
      {/* ---------- identity: on the page itself (no card), then the stat strip ---------- */}
      <section className="pf-hero" aria-label="Your profile">
        <AvatarFrame userId={user.id}>
          <a href="#avatars" className="pf-avatar" aria-label="Change avatar">
            {avatarUri ? (
              <img src={avatarUri} alt="" width={128} height={128} referrerPolicy="no-referrer" />
            ) : (
              <span className="pf-avatar-initial">{(displayName ?? "?").charAt(0).toUpperCase()}</span>
            )}
            <span className="pf-avatar-edit" aria-hidden="true">
              <Pencil size={13} />
            </span>
          </a>
        </AvatarFrame>
        <div className="pf-id">
          <span className="pf-eyebrow">Player profile</span>
          <h1 className="pf-name">{displayName}</h1>
          <p className="pf-meta">
            <span className="pf-email">{user.email}</span>
            {since ? <span>Joined {since}</span> : null}
          </p>
          <div className="pf-chips">
            {club ? (
              <Link className="pf-chip" to={`/clubs/${club.tag}`}>
                <Users size={14} aria-hidden="true" /> {club.name} <span className="pf-chip-tag">{clubTagText(club.tag)}</span>
              </Link>
            ) : clubLoaded ? (
              <Link className="pf-chip pf-chip-ghost" to="/clubs">
                <Users size={14} aria-hidden="true" /> Join a club
              </Link>
            ) : null}
          </div>
        </div>
        <div className="pf-hero-actions">
          <ShareProfile userId={user.id} />
          <Link className="ac-btn ac-btn-sm" to={`/player/${user.id}`}>
            <Eye size={15} aria-hidden="true" /> Public view
          </Link>
          <button
            type="button"
            className="ac-btn ac-btn-sm pf-signout"
            onClick={async () => {
              await auth.signOut();
              navigate("/");
            }}
          >
            <LogOut size={15} aria-hidden="true" />
            Sign out
          </button>
        </div>
      </section>

      {/* friends / followers / following (highlighted, open the Friends section) + leaderboard standing */}
      <ul className="pf-strip" aria-label="Your numbers">
        <li>
          <a className="pf-pill is-social" href="#friends">
            <b>{pub ? formatTokens(pub.friends) : "–"}</b>
            <span>Friends</span>
          </a>
        </li>
        <li>
          <a className="pf-pill is-social" href="#friends">
            <b>{pub ? formatTokens(pub.followers) : "–"}</b>
            <span>Followers</span>
          </a>
        </li>
        <li>
          <a className="pf-pill is-social" href="#friends">
            <b>{pub ? formatTokens(pub.following) : "–"}</b>
            <span>Following</span>
          </a>
        </li>
        <li>
          <Link className="pf-pill" to="/leaderboards">
            <b>{pub?.rank ? `#${pub.rank}` : "–"}</b>
            <span>
              <Trophy size={12} aria-hidden="true" /> Rank
            </span>
          </Link>
        </li>
        <li>
          <Link className="pf-pill" to="/leaderboards">
            <b>{pub ? formatTokens(pub.points) : "–"}</b>
            <span>Points</span>
          </Link>
        </li>
        <li>
          <Link className="pf-pill" to="/leaderboards">
            <b>{pub ? formatTokens(pub.firsts) : "–"}</b>
            <span>
              <Medal size={12} aria-hidden="true" /> 1st places
            </span>
          </Link>
        </li>
      </ul>

      <JumpBar />

      {/* ---------- wallet + stats ---------- */}
      <div className="pf-overview" id="overview">
        <section className="ac-card ac-coin-card pf-wallet" aria-label="Chip wallet">
          <div className="pf-wallet-top">
            <TokenIcon size={52} className="ac-token" />
            <div>
              <span className="pf-wallet-label">Chip balance</span>
              <strong className="pf-wallet-num">
                {wallet ? (wallet.unlimited ? "∞" : formatTokens(wallet.balance)) : walletLoading ? "…" : "—"}
              </strong>
            </div>
          </div>
          <div className="pf-wallet-actions">
            <Link className="ac-btn ac-btn-sm" to="/chips#buy">
              Buy chips
            </Link>
            <Link className="ac-btn ac-btn-sm ac-btn-ghost" to="/chips">
              Wallet <ArrowRight size={14} aria-hidden="true" />
            </Link>
            {showAds ? (
              <button type="button" className="ac-btn ac-btn-sm ac-btn-ghost" onClick={() => promptAdFree("settings")}>
                <ShieldCheck size={14} aria-hidden="true" /> Remove ads
              </button>
            ) : null}
          </div>
        </section>

        <div className="pf-stats">
          <div className="ac-card pf-stat">
            <span className="pf-stat-icon" aria-hidden="true">
              <History size={17} />
            </span>
            <strong>{formatTokens(totalPlays)}</strong>
            <span>Rounds played</span>
          </div>
          <div className="ac-card pf-stat">
            <span className="pf-stat-icon" aria-hidden="true">
              <Gamepad2 size={17} />
            </span>
            <strong>{playedGameIds.length}</strong>
            <span>Games tried</span>
          </div>
          <div className="ac-card pf-stat">
            <span className="pf-stat-icon" aria-hidden="true">
              <Trophy size={17} />
            </span>
            {latest ? (
              <Link to={`/game/${latest.id}`} className="pf-stat-text" title={latest.title}>
                {latest.title}
              </Link>
            ) : (
              <strong>—</strong>
            )}
            <span>Latest game</span>
          </div>
        </div>
      </div>

      {/* ---------- chip usage (collapsible) ---------- */}
      <ChipHistory title="Chip usage" sub="Where your chips came from and where they went." />

      {/* ---------- two independent stacks (wide screens), so a tall card on one side never leaves
           a hole on the other; phones: one column in reading order (see .pf-col in profile.css) ---------- */}
      <div className="pf-columns">
        <div className="pf-col pf-col-main">
          <section className="ac-card pf-avatars" id="avatars">
            <div className="ac-section-head">
              <div>
                <h2 className="ac-h2">Avatar library</h2>
                <p className="ac-sub">Pick a style, then a character. It follows your account to every device.</p>
              </div>
            </div>
            <AvatarLibrary user={user} />
          </section>

          {ach ? (
            <div className="pf-ach" id="achievements">
              <AchievementGrid list={ach} />
            </div>
          ) : null}

          <PerformanceCard />
        </div>

        <div className="pf-col pf-col-side">
          <section className="ac-card pf-bests" id="bests">
            <div className="ac-section-head">
              <h2 className="ac-h2">Your bests</h2>
            </div>
            {playedGameIds.length === 0 ? (
              <div className="pf-empty">
                <p>No rounds yet. Pick a game and set your first record.</p>
                <Link className="ac-btn ac-btn-primary ac-btn-sm" to="/">
                  Browse games
                </Link>
              </div>
            ) : (
              <ul className="pf-best-list">
                {playedGameIds.map((gameId) => {
                  const game = games.find((item) => item.id === gameId);
                  if (!game) return null;
                  return (
                    <li key={gameId}>
                      <Link to={`/game/${game.id}`}>
                        <GamePoster game={game} size="thumb" />
                        <span className="pf-best-title">{game.title}</span>
                        <span className="pf-best-score">
                          <small>{scoreLabel(game)}</small>
                          <b>{bestFor(gameId)}</b>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <FriendsSection />

          <section className="ac-card pf-progress" id="progress">
            <div className="ac-section-head">
              <div>
                <h2 className="ac-h2">Saved progress</h2>
                <p className="ac-sub">Levels you've reached. Resetting sends that game back to level 1.</p>
              </div>
            </div>
            <ul className="pf-best-list">
              {PROGRESS_GAMES.map((id) => (
                <ProgressRow key={id} gameId={id} />
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

/** Copy (or share, on phones) the link to your public profile. */
function ShareProfile({ userId }: { userId: string }) {
  const [done, setDone] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function share() {
    const url = `${window.location.origin}/player/${userId}`;
    try {
      if (navigator.share && window.matchMedia("(pointer: coarse)").matches) {
        await navigator.share({ title: "My Senevon profile", url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setDone(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setDone(false), 1800);
    } catch {
      /* share sheet closed / clipboard blocked: nothing to do */
    }
  }

  return (
    <button type="button" className="ac-btn ac-btn-sm" onClick={() => void share()}>
      {done ? <Check size={15} aria-hidden="true" /> : <Share2 size={15} aria-hidden="true" />}
      {done ? "Link copied" : "Share"}
    </button>
  );
}

const JUMPS = [
  { id: "overview", label: "Overview" },
  { id: "avatars", label: "Avatars" },
  { id: "bests", label: "Bests" },
  { id: "friends", label: "Friends" },
  { id: "progress", label: "Progress" },
  { id: "settings", label: "Settings" },
] as const;

/** Sticky section chips under the header; the one in view is highlighted. */
function JumpBar() {
  const [on, setOn] = useState<string>("overview");
  const barRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const els = JUMPS.map((j) => document.getElementById(j.id)).filter((e): e is HTMLElement => Boolean(e));
    if (!els.length) return;
    // a section counts as "in view" while it crosses a line ~35% down the screen
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (hit) setOn(hit.target.id);
      },
      { rootMargin: "-35% 0px -60% 0px" },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);

  // keep the highlighted chip visible in the bar (phones scroll it sideways)
  useEffect(() => {
    const chip = barRef.current?.querySelector<HTMLElement>(`[data-jump="${on}"]`);
    chip?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [on]);

  return (
    <nav className="pf-jump" aria-label="Profile sections" ref={barRef}>
      {JUMPS.map((j) => (
        <a
          key={j.id}
          href={`#${j.id}`}
          data-jump={j.id}
          className={on === j.id ? "on" : ""}
          aria-current={on === j.id ? "true" : undefined}
          onClick={(e) => {
            const el = document.getElementById(j.id);
            if (!el) return;
            e.preventDefault();
            setOn(j.id);
            el.scrollIntoView({ behavior: "smooth", block: "start" });
            history.replaceState(null, "", `#${j.id}`);
          }}
        >
          {j.label}
        </a>
      ))}
    </nav>
  );
}


const PERF_OPTIONS: { v: PerfChoice; label: string }[] = [
  { v: "auto", label: "Auto" },
  { v: "lite", label: "Smooth (lite)" },
  { v: "full", label: "Full effects" },
];

/** Lite mode switch (lib/perf.ts): saved on this device. */
function PerformanceCard() {
  const { lite, choice } = usePerf();
  return (
    <section className="ac-card pf-perf" id="settings">
      <h2 className="ac-h2">Performance</h2>
      <p className="ac-sub">
        Smooth mode turns off blur and background animations and runs Senevi and the games at a lighter quality, so slower phones stay smooth.
        {choice === "auto" ? (lite ? " Auto has turned it on for this device." : " Auto keeps full effects on this device.") : ""}
      </p>
      <div className="pf-seg" role="radiogroup" aria-label="Performance">
        {PERF_OPTIONS.map((o) => (
          <button key={o.v} type="button" role="radio" aria-checked={choice === o.v} className={choice === o.v ? "is-on" : ""} onClick={() => setPerfChoice(o.v)}>
            {o.label}
          </button>
        ))}
      </div>
      <p className="ac-sub pf-perf-note">Saved on this device. Senevi and games pick it up the next time they open.</p>
    </section>
  );
}
