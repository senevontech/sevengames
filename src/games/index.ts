import type { GameEngine } from "../catalog";
import TicTacToe from "./tictactoe";
import MemoryGame from "./memory";
import ReflexGame from "./reflex";
import SimonGame from "./simon";
import MergeGame from "./merge";
import Minesweeper from "./minesweeper";
import HangmanGame from "./hangman";
import QuizGame from "./quiz";
import MathGame from "./math";
import WordGame from "./word";
import HigherLower from "./higher-lower";
import WhackAMole from "./whack-a-mole";
import ColorMatch from "./color-match";
import SlidingPuzzle from "./sliding-puzzle";
import SnakeGame from "./snake";
import CarromGame from "./carrom/index";
import CarromPreview from "./carrom/Preview";
import StackGame from "./stack";
import DodgeGame from "./dodge";
import ConnectFour from "./connect-four";
import LightsOut from "./lights-out";
import ArrowsGame from "./arrowsGame";
import ChessGame from "./chess/index";
import LudoGame from "./ludo/index";

export type GameProps = {
  /** Call once when the round ends with the final score (or time in seconds for timed games). */
  onFinish: (score: number) => void;
};

export const engines: Record<GameEngine, (props: GameProps) => React.JSX.Element> = {
  tictactoe: TicTacToe,
  memory: MemoryGame,
  reflex: ReflexGame,
  simon: SimonGame,
  "2048": MergeGame,
  minesweeper: Minesweeper,
  hangman: HangmanGame,
  quiz: QuizGame,
  math: MathGame,
  word: WordGame,
  "higher-lower": HigherLower,
  "whack-a-mole": WhackAMole,
  "color-match": ColorMatch,
  "sliding-puzzle": SlidingPuzzle,
  snake: SnakeGame,
  carrom: CarromGame,
  stack: StackGame,
  dodge: DodgeGame,
  "connect-four": ConnectFour,
  "lights-out": LightsOut,
  arrows: ArrowsGame,
  chess: ChessGame,
  ludo: LudoGame,
};

/** What to show behind the premium "Start game" bar (default: the game's own start screen, inert). */
export const previews: Partial<Record<GameEngine, () => React.JSX.Element>> = {
  carrom: CarromPreview,
};

export function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function formatTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}
