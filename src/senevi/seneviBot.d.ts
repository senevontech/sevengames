/* Types for the ported LED-dome bot (seneviBot.js stays plain JS, as in the original). */
export type SeneviExpression =
  | "happy" | "curious" | "delighted" | "thinking" | "surprised" | "sad" | "laugh"
  | "love" | "dizzy" | "grumpy" | "oops" | "drowsy" | "asleep";

export type SeneviOpts = {
  /** true: chatty (greets, idle jokes). Lines go to `onSay` when given, else a floating caption. */
  speech?: boolean;
  onSay?: (line: string) => void;
  config?: Record<string, unknown>;
};

export interface SeneviInstance {
  destroyed: boolean;
  react(expr: SeneviExpression, ms: number, opts?: { jump?: boolean }): void;
  jump(vy?: number, stretch?: number): void;
  shakeHead(amp?: number, ms?: number): void;
  lookAt(x: number, y: number, ms?: number): void;
  celebrate(): void;
  saySomething(): boolean;
  thinkTurn(ms?: number): void;
  cpuGood(): void;
  playerGood(): void;
  gameOver(result: "cpu" | "player" | "draw"): void;
  gameStart(): void;
  setConfig(patch: Record<string, unknown>): void;
  destroy(): void;
}

declare const Senevi: {
  DEFAULT_CONFIG: Record<string, unknown>;
  EXPRESSIONS: SeneviExpression[];
  isSupported(): boolean;
  create(container: HTMLElement, opts?: SeneviOpts): SeneviInstance;
};
export default Senevi;
