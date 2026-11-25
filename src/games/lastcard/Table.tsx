/* One Card: the table everyone sees (vs Senevi, same device and online all draw this).
   Phones first: the other players sit in a compact strip across the top, the draw and discard
   piles fill the middle with the colour in play as a glowing ring, and your hand is a curved fan
   at the bottom. Sounds and a short vibration tell you when it's your turn or you're hit. */
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowRightLeft, Hand, Layers } from "lucide-react";
import { COLOR_HEX, COLOR_NAMES, D2, REV, SKIP, W4, cardOf, type LastAction } from "./engine";
import { LCCard } from "./LCCard";
import { actionSound, callSound, drawSound, hitSound, isLite, snapSound, turnSound, vibrate, wildSound, winFanfare } from "./fx";

export type SeatInfo = {
  name: string;
  count: number;
  called: boolean;
  /** a face / avatar for the badge */
  face?: ReactNode;
  /** under the name, e.g. "left the game" */
  note?: string;
};

export type TableProps = {
  seats: SeatInfo[];
  /** whose cards are at the bottom */
  me: number;
  hand: number[];
  turn: number;
  dir: 1 | -1;
  top: number;
  /** a couple of cards under the top one (for the look of the pile) */
  under: number[];
  color: number;
  pending: number;
  drawPile: number;
  over: boolean;
  winner?: number | null;
  last: LastAction | null;
  seq: number;
  playableIds: number[];
  jumpIds: number[];
  canDraw: boolean;
  canPass: boolean;
  canCall: boolean;
  called: boolean;
  status: string;
  /** seconds left on the turn clock (online) */
  clock?: number | null;
  onPlay: (card: number) => void;
  onDraw: () => void;
  onPass: () => void;
  onCall: () => void;
  top_left?: ReactNode;
  top_right?: ReactNode;
  overlay?: ReactNode;
  /** hide your cards (same device: between turns) */
  hidden?: boolean;
  /** play sounds / vibrate (off for previews) */
  feedback?: boolean;
};

/** where each other seat sits on a wide screen, counted from you in the direction of play */
export function seatPos(n: number, rel: number): "top" | "left" | "right" {
  if (n === 2) return "top";
  if (n === 3) return rel === 1 ? "left" : "right";
  return rel === 1 ? "left" : rel === 2 ? "top" : "right";
}

const LITE = typeof window !== "undefined" && isLite();

/* ---------------- the fan in your hand ---------------- */
const HandFan = memo(function HandFan({
  hand,
  playableIds,
  jumpIds,
  myTurn,
  hidden,
  onPlay,
}: {
  hand: number[];
  playableIds: number[];
  jumpIds: number[];
  myTurn: boolean;
  hidden?: boolean;
  onPlay: (c: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(360);
  const [cw, setCw] = useState(80);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      setWidth(el.clientWidth);
      setCw(parseFloat(getComputedStyle(el).getPropertyValue("--lc-hw")) || 80);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // cards fly in from the deck: all of them at the start (a deal), then each one drawn
  const known = useRef<Set<number>>(new Set());
  const [fresh, setFresh] = useState<Map<number, number>>(new Map());
  useEffect(() => {
    const add = hand.filter((c) => !known.current.has(c));
    known.current = new Set(hand);
    if (!add.length || add.length > 20) return;
    setFresh(new Map(add.map((c, i) => [c, i])));
    const id = window.setTimeout(() => setFresh(new Map()), 450 + add.length * 60);
    return () => window.clearTimeout(id);
  }, [hand]);

  const n = hand.length;
  // overlap: as many as fit; past that the row scrolls sideways
  const minStep = 26;
  const step = n <= 1 ? cw : Math.max(minStep, Math.min(cw * 0.66, (width - cw - 8) / (n - 1)));
  const scrolls = n > 1 && (n - 1) * step + cw > width + 2;
  const spread = scrolls ? 1.5 : Math.min(6, 44 / Math.max(1, n)); // degrees between cards
  const mid = (n - 1) / 2;
  const R = cw * 5; // radius of the arc the cards sit on

  return (
    <div ref={ref} className={`lc-hand${scrolls ? " is-scroll" : ""}`} role="group" aria-label="Your cards">
      <div className="lc-hand-row" style={{ width: scrolls ? (n - 1) * step + cw + 16 : undefined }}>
        {hand.map((c, i) => {
          const ok = playableIds.includes(c) || jumpIds.includes(c);
          const a = (i - mid) * spread;
          const y = R * (1 - Math.cos((a * Math.PI) / 180));
          const order = fresh.get(c);
          return (
            <button
              key={c}
              type="button"
              className={`lc-hcard${ok ? " is-ok" : ""}${(myTurn || jumpIds.length) && !ok ? " is-off" : ""}${jumpIds.includes(c) ? " is-jump" : ""}${order !== undefined ? " is-new" : ""}`}
              style={
                {
                  zIndex: i + 1,
                  marginLeft: i === 0 ? 0 : step - cw,
                  "--a": `${a}deg`,
                  "--y": `${y}px`,
                  animationDelay: order !== undefined ? `${order * 60}ms` : undefined,
                } as CSSProperties
              }
              disabled={!ok || hidden}
              onClick={() => onPlay(c)}
            >
              <LCCard card={c} faceUp={!hidden} />
            </button>
          );
        })}
      </div>
    </div>
  );
});

export function LCTable(p: TableProps) {
  const n = p.seats.length;
  const others = Array.from({ length: n - 1 }, (_, k) => (p.me + 1 + k) % n);
  const lastRel = p.last && p.last.seat >= 0 ? (p.last.seat - p.me + n) % n : -1;
  const from = lastRel === 0 ? "bottom" : lastRel > 0 ? seatPos(n, lastRel) : "deck";
  const topWild = cardOf(p.top).c === 4;
  const myTurn = p.turn === p.me && !p.over;
  const feedback = p.feedback !== false;

  // sounds + vibration: what just happened, your turn, a hit, a win
  const prevSeq = useRef(p.seq);
  useEffect(() => {
    if (!feedback || p.seq === prevSeq.current) return;
    prevSeq.current = p.seq;
    const a = p.last;
    if (!a) return;
    if (a.kind === "play" || a.kind === "jump") {
      const k = cardOf(a.card!);
      snapSound();
      if (k.c === 4) window.setTimeout(wildSound, 60);
      else if (k.v === SKIP || k.v === REV || k.v === D2) window.setTimeout(actionSound, 60);
      // a +2 / +4 / skip aimed at you
      const nextIsMe = p.turn === p.me || (k.v === SKIP && (a.seat + (p.dir === 1 ? 2 : -2) + n * 2) % n === p.me);
      if ((k.v === D2 || k.v === W4 || k.v === SKIP) && a.seat !== p.me && nextIsMe) vibrate([30, 40, 30]);
    } else if (a.kind === "draw") {
      drawSound(a.count ?? 1);
    } else if (a.kind === "penalty") {
      drawSound(a.count ?? 2);
      if (a.seat === p.me) {
        hitSound();
        vibrate([40, 50, 40]);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.seq]);
  const wasMyTurn = useRef(myTurn);
  useEffect(() => {
    if (feedback && myTurn && !wasMyTurn.current && !p.hidden) {
      turnSound();
      vibrate(18);
    }
    wasMyTurn.current = myTurn;
  }, [myTurn, feedback, p.hidden]);
  const wasOver = useRef(p.over);
  useEffect(() => {
    if (feedback && p.over && !wasOver.current && p.winner === p.me) {
      winFanfare();
      vibrate([20, 40, 20, 40, 60]);
    }
    wasOver.current = p.over;
  }, [p.over, p.winner, p.me, feedback]);

  const lastCardRot = useMemo(() => `${((p.top * 29) % 14) - 7}deg`, [p.top]);

  return (
    <div className={`lc-table${LITE ? " is-lite" : ""}`}>
      <div className={`lc-felt${myTurn ? " is-myturn" : ""}`} style={{ ["--lc-color" as string]: COLOR_HEX[p.color] }}>
        <div className="lc-topbar">
          {p.top_left}
          <span className="lc-spacer" />
          {p.top_right}
        </div>

        <div className={`lc-opps n${n - 1}`}>
          {others.map((seat) => {
            const rel = (seat - p.me + n) % n;
            const s = p.seats[seat];
            const pos = seatPos(n, rel);
            return (
              <div key={seat} className={`lc-seat is-${pos}${p.turn === seat && !p.over ? " is-turn" : ""}`}>
                <div className="lc-badge">
                  {s.face ?? <span className="lc-avatar">{s.name.slice(0, 1).toUpperCase()}</span>}
                  <span className="lc-badge-text">
                    <b>{s.name}</b>
                    <small>{s.note ?? `${s.count} card${s.count === 1 ? "" : "s"}`}</small>
                  </span>
                  <span className="lc-count" aria-hidden="true">
                    {s.count}
                  </span>
                  {s.called && s.count <= 2 ? <em className="lc-said">One card!</em> : null}
                </div>
                <div className="lc-backs" aria-label={`${s.count} cards`}>
                  {Array.from({ length: Math.min(s.count, 10) }, (_, i) => (
                    <LCCard key={i} card={-1} faceUp={false} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* the middle: draw pile, discard pile, colour and direction */}
        <div className="lc-centre">
          <div className={`lc-dir${p.dir === -1 ? " is-ccw" : ""}`} aria-label={p.dir === 1 ? "Play goes clockwise" : "Play goes anticlockwise"}>
            <svg viewBox="0 0 100 100" aria-hidden="true">
              <path d="M50 6 A44 44 0 0 1 94 50" />
              <path d="M88 40 L94 52 L100 40" />
              <path d="M50 94 A44 44 0 0 1 6 50" />
              <path d="M12 60 L6 48 L0 60" />
            </svg>
          </div>
          <button type="button" className={`lc-pile${p.canDraw ? " is-live" : ""}`} onClick={p.onDraw} disabled={!p.canDraw} aria-label={p.pending ? `Take ${p.pending} cards` : "Draw a card"}>
            <span className="lc-pile-stack">
              <LCCard card={-1} faceUp={false} />
              <LCCard card={-1} faceUp={false} />
              <LCCard card={-1} faceUp={false} />
            </span>
            <span className="lc-pile-label">{p.pending ? `Take ${p.pending}` : p.canDraw ? "Draw" : `${p.drawPile} left`}</span>
          </button>
          <div className="lc-discard">
            <span className="lc-ring" aria-hidden="true" />
            {p.under.map((c, i) => (
              <span key={`u${i}-${c}`} className="lc-under" style={{ transform: `rotate(${((c * 37 + i * 53) % 24) - 12}deg)` }}>
                <LCCard card={c} />
              </span>
            ))}
            <span key={`t${p.seq}-${p.top}`} className={`lc-top from-${from}`} style={{ ["--rot" as string]: lastCardRot }}>
              <LCCard card={p.top} />
            </span>
            {topWild ? <span key={`b${p.seq}`} className="lc-burst" aria-hidden="true" /> : null}
            {topWild ? (
              <span className="lc-colortag" style={{ background: COLOR_HEX[p.color] }}>
                {COLOR_NAMES[p.color]}
              </span>
            ) : null}
          </div>
          {p.pending ? <span className="lc-pending">+{p.pending}</span> : null}
        </div>

        <p className={`lc-status${myTurn ? " is-mine" : ""}`} aria-live="polite">
          {p.status}
          {p.clock !== null && p.clock !== undefined ? <b className={`lc-clock${p.clock <= 5 ? " is-low" : ""}`}>{p.clock}s</b> : null}
        </p>

        {/* you */}
        <div className={`lc-me${myTurn ? " is-turn" : ""}`}>
          <div className="lc-actions">
            {p.canCall ? (
              <button
                type="button"
                className="lc-btn lc-btn-call"
                onClick={() => {
                  if (feedback) {
                    callSound();
                    vibrate(25);
                  }
                  p.onCall();
                }}
              >
                <Hand size={16} /> One card!
              </button>
            ) : p.called && p.hand.length <= 2 ? (
              <span className="lc-said is-mine">One card!</span>
            ) : null}
            {p.canPass ? (
              <button type="button" className="lc-btn" onClick={p.onPass}>
                <ArrowRightLeft size={15} /> Keep it & pass
              </button>
            ) : null}
            {myTurn && p.canDraw && !p.playableIds.length ? (
              <button type="button" className="lc-btn lc-btn-main" onClick={p.onDraw}>
                <Layers size={15} /> {p.pending ? `Take ${p.pending}` : "Draw"}
              </button>
            ) : null}
            <span className="lc-mycount">{p.hand.length} card{p.hand.length === 1 ? "" : "s"}</span>
          </div>
          <HandFan hand={p.hand} playableIds={p.playableIds} jumpIds={p.jumpIds} myTurn={myTurn} hidden={p.hidden} onPlay={p.onPlay} />
        </div>

        {p.overlay}
      </div>
    </div>
  );
}

/** pick a colour for a wild */
export function ColorPicker({ onPick, onCancel }: { onPick: (c: number) => void; onCancel?: () => void }) {
  return (
    <div className="lc-overlay" role="dialog" aria-label="Pick a colour">
      <div className="lc-panel">
        <h3>Pick a colour</h3>
        <div className="lc-colors">
          {COLOR_HEX.map((hex, i) => (
            <button key={i} type="button" style={{ background: hex }} onClick={() => onPick(i)} aria-label={COLOR_NAMES[i]}>
              {COLOR_NAMES[i]}
            </button>
          ))}
        </div>
        {onCancel ? (
          <button type="button" className="lc-btn" onClick={onCancel}>
            Back
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** a 7 with swapping on: whose hand to take */
export function SwapPicker({ seats, me, onPick, onCancel }: { seats: SeatInfo[]; me: number; onPick: (seat: number) => void; onCancel?: () => void }) {
  return (
    <div className="lc-overlay" role="dialog" aria-label="Swap hands with">
      <div className="lc-panel">
        <h3>Swap hands with…</h3>
        <div className="lc-swaps">
          {seats.map((s, i) =>
            i === me ? null : (
              <button key={i} type="button" className="lc-btn" onClick={() => onPick(i)}>
                {s.name} · {s.count} card{s.count === 1 ? "" : "s"}
              </button>
            ),
          )}
        </div>
        {onCancel ? (
          <button type="button" className="lc-btn" onClick={onCancel}>
            Back
          </button>
        ) : null}
      </div>
    </div>
  );
}
