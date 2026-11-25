/* /senevi: meet Senevi, the game CPU. A big live Senevi to play with, the crew (all four bots,
   tap one to bring him up top), the games you can challenge him in, your record against him
   (this device) and his speech switch.
   The crew is kept light: the four small bots only start when the row scrolls into view, run in
   low-power mode, pause when off-screen, and slower phones get drawn faces instead of 3D ones. */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { MessageCircle, MessageCircleOff, Swords } from "lucide-react";
import { games } from "../catalog";
import { GamePoster } from "../components/GamePoster";
import { readSeneviRecord, SeneviFace, SeneviIcon, SeneviLine, setSeneviMuted, useSeneviMuted, useSeneviProfiles, SENEVI_BOTS, SENEVI_NAME, type SeneviProfile } from "../senevi/Senevi";
import type { SeneviExpression, SeneviInstance } from "../senevi/seneviBot";
import "./account.css";
import "./senevi-page.css";

/** The games where you play against Senevi, and how he plays each one. */
const HIS_GAMES: { id: string; how: string }[] = [
  { id: "chess", how: "Three levels: Easy, Medium and Hard. Hard thinks several moves ahead." },
  { id: "pool", how: "Plays at your Eight Ball level, so he gets better as you do." },
  { id: "carrom", how: "Aims for the easiest pot, and goes for the queen when it's on." },
  { id: "ludo", how: "Up to three Senevis at once. Loves a capture." },
  { id: "connect-four", how: "Always blocks your fours, so set up two threats at once." },
  { id: "noughts", how: "Never misses a win or a block. Can you force a draw… or better?" },
];

const MOODS: { expr: SeneviExpression; label: string; ms: number; jump?: boolean }[] = [
  { expr: "thinking", label: "🤔 Think", ms: 2600 },
  { expr: "laugh", label: "😆 Laugh", ms: 2200, jump: true },
  { expr: "love", label: "😍 Love", ms: 2400, jump: true },
  { expr: "surprised", label: "😮 Surprise", ms: 1600, jump: true },
  { expr: "sad", label: "😢 Sad", ms: 2400 },
  { expr: "grumpy", label: "😤 Grumpy", ms: 2400 },
  { expr: "dizzy", label: "😵‍💫 Dizzy", ms: 2400 },
  { expr: "asleep", label: "😴 Sleep", ms: 3200 },
];

/* ---------------- the crew: all four bots side by side ---------------- */
/** each bot steps through this list from a different place, so no two show the same face */
const CREW_EXPRS: SeneviExpression[] = ["happy", "curious", "laugh", "thinking", "love", "surprised", "grumpy", "delighted", "dizzy", "sad", "oops", "drowsy"];
const CREW_STEP_MS = 3400;

function isLowEnd() {
  try {
    const n = navigator as Navigator & { deviceMemory?: number };
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return true;
    return (n.hardwareConcurrency ?? 8) <= 4 || (n.deviceMemory ?? 8) <= 2;
  } catch {
    return false;
  }
}

/** a drawn face for slower phones (no 3D): his dome, in his colours, with a set expression */
function FlatFace({ profile, variant, size }: { profile: SeneviProfile; variant: number; size: number }) {
  const led = ((profile.config.modeColors as string[] | undefined) ?? ["#ffaa45"])[0];
  const tint = String(profile.config.shellTint ?? "#808080");
  const v = variant % 4;
  const eyes =
    v === 0 ? (
      <g>
        <rect x={34} y={36} width={10} height={16} rx={4} />
        <rect x={56} y={36} width={10} height={16} rx={4} />
      </g>
    ) : v === 1 ? (
      <g fill="none">
        <path d="M33 46 L39 39 L45 46" />
        <path d="M55 46 L61 39 L67 46" />
      </g>
    ) : v === 2 ? (
      <g>
        <circle cx={39} cy={44} r={6} />
        <rect x={55} y={42} width={12} height={4} rx={2} />
      </g>
    ) : (
      <g>
        <circle cx={39} cy={44} r={7} />
        <circle cx={61} cy={44} r={7} />
      </g>
    );
  const mouth = v === 0 ? <path d="M38 62 Q50 72 62 62" /> : v === 1 ? <path d="M36 60 Q50 76 64 60" /> : v === 2 ? <path d="M40 64 L60 64" /> : <circle cx={50} cy={66} r={5} />;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" className="snp-flat">
      <defs>
        <radialGradient id={`snp-dome-${variant}`} cx="35%" cy="30%" r="75%">
          <stop offset="0" stopColor={tint} stopOpacity="0.9" />
          <stop offset="0.55" stopColor="#1a1b20" />
          <stop offset="1" stopColor="#0b0c0f" />
        </radialGradient>
      </defs>
      <circle cx={50} cy={50} r={46} fill={`url(#snp-dome-${variant})`} />
      <g fill={led} stroke={led} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round">
        {eyes}
        <g fill="none">{mouth}</g>
      </g>
      <ellipse cx={34} cy={24} rx={14} ry={7} fill="#fff" opacity={0.18} />
    </svg>
  );
}

function Crew({ profiles, main, onPick }: { profiles: SeneviProfile[]; main: number; onPick: (n: number) => void }) {
  const ref = useRef<HTMLElement>(null);
  const lite = useMemo(isLowEnd, []);
  const [near, setNear] = useState(false); // the row has come near the screen (bots start, once)
  const [inView, setInView] = useState(false); // and is on screen right now (expressions run)
  const bots = useRef<(SeneviInstance | null)[]>([null, null, null, null]);
  const size = useMemo(() => (window.matchMedia?.("(max-width: 640px)").matches ? 84 : 108), []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        setInView(e.isIntersecting);
        if (e.isIntersecting) setNear(true);
      },
      { rootMargin: "160px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // every few seconds each bot shows his next expression (staggered, never the same as the others)
  useEffect(() => {
    if (lite || !inView) return;
    let step = 0;
    const timers: number[] = [];
    const tick = () => {
      if (document.hidden) return;
      step++;
      bots.current.forEach((b, i) => {
        if (!b || b.destroyed) return;
        const x = CREW_EXPRS[(step + i * 3) % CREW_EXPRS.length];
        timers.push(window.setTimeout(() => b.react(x, CREW_STEP_MS - 600, { jump: x === "laugh" || x === "surprised" || x === "love" }), i * 260));
      });
    };
    const id = window.setInterval(tick, CREW_STEP_MS);
    return () => {
      window.clearInterval(id);
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [lite, inView]);

  return (
    <section className="snp-crew" ref={ref} aria-label="The crew">
      <h2 className="ac-h2 snp-h2">Meet the crew</h2>
      <p className="ac-sub snp-crew-sub">Four Senevis. You'll meet them all at Ludo, One Card and Call Break tables. Tap one to bring him up top.</p>
      <ul className="snp-crew-row">
        {profiles.slice(0, SENEVI_BOTS).map((p, i) => (
          <li key={i}>
            <button
              type="button"
              className={`snp-crew-card${main === i + 1 ? " is-main" : ""}`}
              onClick={() => {
                onPick(i + 1);
                const b = bots.current[i];
                if (b && !b.destroyed) b.react("delighted", 1800, { jump: true });
              }}
              aria-pressed={main === i + 1}
            >
              <span className="snp-crew-face" style={{ width: size, height: size }}>
                {lite || !near ? (
                  <FlatFace profile={p} variant={i} size={size} />
                ) : (
                  <SeneviFace
                    size={size}
                    seat={`crew-${i + 1}`}
                    bot={i + 1}
                    speech={false}
                    lowPower
                    onReady={(b) => {
                      bots.current[i] = b;
                      // start on a different face from the others
                      window.setTimeout(() => b.react(CREW_EXPRS[i * 3], CREW_STEP_MS - 600), 300 + i * 200);
                    }}
                  />
                )}
              </span>
              <b>{p.name}</b>
              <small>{main === i + 1 ? "Up top now" : i === 0 ? "Your main opponent" : `CPU seat ${i + 1}`}</small>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function SeneviPage() {
  const [bot, setBot] = useState<SeneviInstance | null>(null);
  const profiles = useSeneviProfiles();
  const [main, setMain] = useState(1);
  const mainName = profiles[main - 1]?.name ?? SENEVI_NAME;
  const muted = useSeneviMuted();
  const [record] = useState(readSeneviRecord);

  useEffect(() => {
    const prev = document.title;
    document.title = `${SENEVI_NAME}, the game AI · Senevon Games`;
    return () => {
      document.title = prev;
    };
  }, []);

  const total = Object.values(record).reduce((a, r) => ({ w: a.w + r.w, l: a.l + r.l, d: a.d + r.d }), { w: 0, l: 0, d: 0 });
  const played = total.w + total.l + total.d;

  return (
    <div className="acct snp">
      <section className="snp-hero">
        <div className="snp-stage">
          <SeneviFace key={main} size={240} seat="page" bot={main} onReady={setBot} />
        </div>
        <div className="snp-intro">
          <span className="snp-kicker">
            <SeneviIcon size={17} /> The Senevon game AI
          </span>
          <h1>Meet {mainName}</h1>
          <p className="snp-says" aria-live="polite">
            <SeneviLine seat="page" />
          </p>
          <p className="ac-sub">
            Every time you play against the computer on Senevon Games, you're playing {SENEVI_NAME}. He thinks on his turn, laughs when he scores, sulks when you
            beat him, and never, ever gets tired of a rematch. Move your mouse and he watches. Poke him and he giggles. Poke him too much and… well, try it.
          </p>
          <div className="snp-moods" role="group" aria-label="Make Senevi react">
            {MOODS.map((m) => (
              <button key={m.expr} type="button" className="ac-btn ac-btn-sm" disabled={!bot} onClick={() => bot?.react(m.expr, m.ms, { jump: m.jump })}>
                {m.label}
              </button>
            ))}
            <button type="button" className="ac-btn ac-btn-sm ac-btn-primary" disabled={!bot || muted} onClick={() => bot?.saySomething()}>
              <MessageCircle size={14} aria-hidden="true" /> Say something
            </button>
          </div>
          <label className="snp-mute">
            <input type="checkbox" checked={!muted} onChange={(e) => setSeneviMuted(!e.target.checked)} />
            {muted ? <MessageCircleOff size={15} aria-hidden="true" /> : <MessageCircle size={15} aria-hidden="true" />}
            {SENEVI_NAME} talks during games
          </label>
        </div>
      </section>

      <Crew
        profiles={profiles}
        main={main}
        onPick={(n) => {
          setBot(null);
          setMain(n);
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
      />

      <section className="ac-card">
        <h2 className="ac-h2">Your record against {SENEVI_NAME}</h2>
        {played ? (
          <ul className="snp-record">
            <li>
              <b>{total.w}</b>
              <small>wins</small>
            </li>
            <li>
              <b>{total.l}</b>
              <small>losses</small>
            </li>
            <li>
              <b>{total.d}</b>
              <small>draws</small>
            </li>
            <li>
              <b>{Math.round((total.w / played) * 100)}%</b>
              <small>win rate</small>
            </li>
          </ul>
        ) : (
          <p className="ac-sub">No games against him yet. He's waiting. 👀</p>
        )}
        <p className="ac-sub snp-fine">Counted on this device.</p>
      </section>

      <section>
        <h2 className="ac-h2 snp-h2">
          <Swords size={20} aria-hidden="true" /> Challenge {SENEVI_NAME}
        </h2>
        <ul className="snp-games">
          {HIS_GAMES.map(({ id, how }) => {
            const g = games.find((x) => x.id === id);
            if (!g) return null;
            const r = record[id];
            return (
              <li key={id} className="ac-card snp-game">
                <GamePoster game={g} size="hero" />
                <div className="snp-game-text">
                  <b>{g.title}</b>
                  <p className="ac-sub">{how}</p>
                  {r ? (
                    <small className="snp-game-rec">
                      You {r.w} – {r.l} {SENEVI_NAME}
                      {r.d ? ` · ${r.d} draw${r.d > 1 ? "s" : ""}` : ""}
                    </small>
                  ) : null}
                </div>
                <Link className="ac-btn ac-btn-sm ac-btn-primary" to={`/game/${encodeURIComponent(id)}`}>
                  Play
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
