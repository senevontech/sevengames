/* Carrom board, racked and ready, drawn with the player's equipped board / coins / striker.
   Shown behind the "Start game" bar on the game page before a premium play is paid for. */
import { useEffect, useRef } from "react";
import { makeWorld } from "./engine";
import { drawBoard, drawCoin, drawStriker, seatRingColor, setBoardView } from "./render";
import { useCarromProgress } from "./progress";
import { useAuthContext } from "../../context/AuthContext";
import { tierOf } from "./stats";
import "./carrom.css";

/** Just the racked board (canvas in its stage frame). */
export function BoardPreview() {
  const ref = useRef<HTMLCanvasElement>(null);
  const prog = useCarromProgress(useAuthContext().user);
  const { board, coinSet, striker, strikerStats } = prog;

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const world = makeWorld({
      seats: 2,
      players: [
        { name: "You", kind: "human" },
        { name: "Senevi", kind: "cpu" },
      ],
    });
    let raf = 0;
    const paint = () => {
      setBoardView(ctx, canvas.width);
      drawBoard(ctx, board);
      for (const d of world.discs) if (d.alive && d.kind !== "striker") drawCoin(ctx, d, coinSet);
      // the striker waiting on your baseline, gently pulsing
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 420);
      drawStriker(ctx, world.striker, striker, seatRingColor(0), pulse, true, 0, { x: 0, y: -1 }, tierOf(strikerStats));
      raf = requestAnimationFrame(paint);
    };
    paint();
    return () => cancelAnimationFrame(raf);
  }, [board, coinSet, striker, strikerStats]);

  return (
    <div className="carrom-stage">
      <canvas ref={ref} width={1080} height={1080} aria-label="Carrom board, ready to play" />
    </div>
  );
}

/** Game-page preview (behind the premium start bar). */
export default function CarromPreview() {
  return (
    <div className="game-surface carrom-surface carrom-preview">
      <BoardPreview />
    </div>
  );
}
