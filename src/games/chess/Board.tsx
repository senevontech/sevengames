/* The chess board: squares, pieces that slide between moves, tap-or-drag to move, legal-move
   hints, last move / check highlights, and the promotion picker. Rules live in engine.ts. */
import { useEffect, useMemo, useRef, useState } from "react";
import { K, P, attacked, type Color, type Move, type State } from "./engine";
import { PieceSvg } from "./pieces";
import type { ChessBoardTheme, ChessPieceSet } from "../../lib/shopCatalog";

type Props = {
  s: State;
  moves: Move[]; // legal moves for the side to move
  canMove: boolean; // it's this player's turn (and the game is on)
  flipped: boolean; // black at the bottom
  lastMove: { from: number; to: number } | null;
  onMove: (m: Move) => void;
  theme: ChessBoardTheme;
  pieces: ChessPieceSet;
};

let nextId = 1;

/** Keeps a stable id per piece across moves, so pieces slide instead of blinking. */
function useIds(b: Int8Array, last: { from: number; to: number } | null) {
  const prev = useRef<{ b: Int8Array; ids: Int32Array } | null>(null);
  return useMemo(() => {
    const ids = new Int32Array(64);
    const old = prev.current;
    if (!old) {
      for (let i = 0; i < 64; i++) if (b[i]) ids[i] = nextId++;
    } else {
      const gone: number[] = [];
      const came: number[] = [];
      for (let i = 0; i < 64; i++) {
        if (b[i] && b[i] === old.b[i]) ids[i] = old.ids[i];
        else {
          if (old.b[i]) gone.push(i);
          if (b[i]) came.push(i);
        }
      }
      for (const to of came) {
        // the moved piece (also through promotion), else the same piece that left a square (castling rook)
        let from = last && last.to === to && gone.includes(last.from) ? last.from : gone.find((g) => old.b[g] === b[to]);
        if (from === undefined) from = -1;
        if (from >= 0) {
          ids[to] = old.ids[from];
          gone.splice(gone.indexOf(from), 1);
        } else ids[to] = nextId++;
      }
    }
    prev.current = { b: new Int8Array(b), ids };
    return ids;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b.join(",")]);
}

export default function Board({ s, moves, canMove, flipped, lastMove, onMove, theme, pieces }: Props) {
  const boardRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ sq: number; x: number; y: number } | null>(null);
  const [promo, setPromo] = useState<{ from: number; to: number } | null>(null);
  const ids = useIds(s.b, lastMove);

  // a new position clears the selection
  useEffect(() => {
    setSelected(null);
    setPromo(null);
  }, [s]);

  const targets = useMemo(() => (selected === null ? [] : moves.filter((m) => m.from === selected)), [moves, selected]);
  const king = s.b.indexOf(s.turn * K);
  // the side to move's king glows red while in check
  const inCheckNow = useMemo(() => king >= 0 && attacked(s, king, -s.turn as Color), [s, king]);

  const toView = (sq: number) => (flipped ? 63 - sq : sq);
  const sqAt = (clientX: number, clientY: number) => {
    const r = boardRef.current!.getBoundingClientRect();
    const c = Math.floor(((clientX - r.left) / r.width) * 8);
    const rr = Math.floor(((clientY - r.top) / r.height) * 8);
    if (c < 0 || c > 7 || rr < 0 || rr > 7) return -1;
    const view = rr * 8 + c;
    return flipped ? 63 - view : view;
  };

  function tryMove(from: number, to: number) {
    const ms = moves.filter((m) => m.from === from && m.to === to);
    if (!ms.length) return false;
    if (ms.length > 1 && Math.abs(ms[0].piece) === P) {
      setPromo({ from, to });
      return true;
    }
    onMove(ms[0]);
    setSelected(null);
    return true;
  }

  const mine = (sq: number) => canMove && s.b[sq] !== 0 && Math.sign(s.b[sq]) === s.turn;

  function onPointerDown(e: React.PointerEvent) {
    if (promo) return;
    const sq = sqAt(e.clientX, e.clientY);
    if (sq < 0) return;
    if (selected !== null && selected !== sq && tryMove(selected, sq)) return;
    if (mine(sq)) {
      setSelected(sq);
      setDrag({ sq, x: e.clientX, y: e.clientY });
      boardRef.current?.setPointerCapture(e.pointerId);
    } else setSelected(null);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (drag) setDrag({ ...drag, x: e.clientX, y: e.clientY });
  }
  function onPointerUp(e: React.PointerEvent) {
    if (!drag) return;
    const sq = sqAt(e.clientX, e.clientY);
    setDrag(null);
    if (sq >= 0 && sq !== drag.sq) tryMove(drag.sq, sq);
  }

  const rect = drag ? boardRef.current?.getBoundingClientRect() : undefined;

  return (
    <div
      className="ch-board"
      ref={boardRef}
      style={{ "--ch-light": theme.light, "--ch-dark": theme.dark, "--ch-frame": theme.frame, "--ch-accent": theme.accent } as React.CSSProperties}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDrag(null)}
      role="grid"
      aria-label="Chess board"
    >
      {/* squares */}
      {Array.from({ length: 64 }, (_, view) => {
        const sq = flipped ? 63 - view : view;
        const dark = ((sq >> 3) + (sq & 7)) & 1;
        const target = targets.find((m) => m.to === sq);
        const cls = [
          "ch-sq",
          dark ? "is-dark" : "is-light",
          lastMove && (lastMove.from === sq || lastMove.to === sq) ? "is-last" : "",
          selected === sq ? "is-sel" : "",
          inCheckNow && sq === king ? "is-check" : "",
        ].join(" ");
        const r = view >> 3;
        const c = view & 7;
        return (
          <div key={view} className={cls}>
            {c === 0 ? <span className="ch-coord ch-rank">{8 - (sq >> 3)}</span> : null}
            {r === 7 ? <span className="ch-coord ch-file">{"abcdefgh"[sq & 7]}</span> : null}
            {target ? <span className={target.captured ? "ch-hint-cap" : "ch-hint"} /> : null}
          </div>
        );
      })}
      {/* pieces */}
      <div className="ch-pieces" aria-hidden="true">
        {Array.from({ length: 64 }, (_, sq) => {
          const p = s.b[sq];
          if (!p) return null;
          const v = toView(sq);
          const dragging = drag?.sq === sq && rect;
          const style: React.CSSProperties = dragging
            ? {
                transform: `translate(${drag!.x - rect!.left - rect!.width / 16}px, ${drag!.y - rect!.top - rect!.height / 16}px) scale(1.12)`,
                transition: "none",
                zIndex: 5,
              }
            : { transform: `translate(${(v & 7) * 100}%, ${(v >> 3) * 100}%)` };
          return (
            <span key={ids[sq]} className="ch-piece" style={style}>
              <PieceSvg type={Math.abs(p)} white={p > 0} set={pieces} />
            </span>
          );
        })}
      </div>
      {promo ? (
        <div className="ch-promo" role="dialog" aria-label="Promote to">
          {[5, 4, 3, 2].map((t) => (
            <button
              key={t}
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => {
                const m = moves.find((x) => x.from === promo.from && x.to === promo.to && x.promo === t);
                setPromo(null);
                if (m) onMove(m);
              }}
              aria-label={["", "", "Knight", "Bishop", "Rook", "Queen"][t]}
            >
              <PieceSvg type={t} white={s.turn === 1} set={pieces} />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
