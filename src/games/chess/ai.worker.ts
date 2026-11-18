/// <reference lib="webworker" />
/* Runs the chess CPU off the main thread. In: { id, fen, level }. Out: { id, move } (UCI or null). */
import { bestMove, type Level } from "./ai";

self.onmessage = (e: MessageEvent<{ id: number; fen: string; level: Level }>) => {
  const { id, fen, level } = e.data;
  let move: string | null = null;
  try {
    move = bestMove(fen, level);
  } catch {
    move = null;
  }
  (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, move });
};
