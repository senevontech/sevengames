/* /senevi: meet Senevi, the game CPU. One big live Senevi to play with (only him: the other bots
   appear only at the 4-player tables, to keep this page light), the games you can challenge him
   in, your record against him (this device) and his speech switch. */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { MessageCircle, MessageCircleOff, Swords } from "lucide-react";
import { games } from "../catalog";
import { GamePoster } from "../components/GamePoster";
import { readSeneviRecord, SeneviFace, SeneviIcon, SeneviLine, setSeneviMuted, useSeneviMuted, SENEVI_NAME } from "../senevi/Senevi";
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

export default function SeneviPage() {
  const [bot, setBot] = useState<SeneviInstance | null>(null);
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
          <SeneviFace size={240} seat="page" bot={1} onReady={setBot} />
        </div>
        <div className="snp-intro">
          <span className="snp-kicker">
            <SeneviIcon size={17} /> The Senevon game AI
          </span>
          <h1>Meet {SENEVI_NAME}</h1>
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
