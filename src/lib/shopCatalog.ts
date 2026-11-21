/* What the shop sells: names, looks and pack sizes. Prices come from the server (shop_items in
   supabase/shop.sql, editable in Admin → Tokens). Keep the item ids in sync with shop.sql. */

export type ShopSlot =
  | "arrow_skin"
  | "arrow_fx"
  | "arrow_board"
  | "arrow_head"
  | "frame"
  | "chess_board"
  | "chess_pieces"
  | "ludo_board"
  | "ludo_dice";
export type BoosterItem = "arrows_hint" | "arrows_undo";

export type ArrowSkin = {
  name: string;
  blurb: string;
  /** Colours arrows take (at rest when `tinted`, otherwise only while leaving). */
  palette: string[];
  /** The same look for the light board (light mode): deeper tones that stay readable on grey. */
  paletteLight: string[];
  /** Arrows show their colour on the board, not just when they leave. */
  tinted: boolean;
  /** Extra CSS class on the board for line weight / glow. */
  className: string;
};

export const ARROW_SKINS: Record<string, ArrowSkin> = {
  "skin:classic": {
    name: "Classic",
    blurb: "Clean lines that light up as they leave.",
    palette: ["#ff5c5c", "#ff922b", "#f5b700", "#40c057", "#12b886", "#22b8cf", "#339af0", "#5c7cfa", "#9775fa", "#cc5de8", "#f06595"],
    paletteLight: ["#e03131", "#e8590c", "#c98a00", "#2f9e44", "#0c8599", "#1098ad", "#1c7ed6", "#4263eb", "#7048e8", "#ae3ec9", "#d6336c"],
    tinted: false,
    className: "",
  },
  "skin:pastel": {
    name: "Pastel",
    blurb: "Soft candy colours, always on.",
    palette: ["#ffadad", "#ffd6a5", "#fdffb6", "#caffbf", "#9bf6ff", "#a0c4ff", "#bdb2ff", "#ffc6ff"],
    paletteLight: ["#ec7f7f", "#eb9c4f", "#c9a62a", "#5fb872", "#3fadc0", "#5f8fe6", "#8c7ced", "#d672cf"],
    tinted: true,
    className: "arw-skin-pastel",
  },
  "skin:neon": {
    name: "Neon",
    blurb: "Glowing electric tubes.",
    palette: ["#39ff14", "#00f0ff", "#ff2bd6", "#fff01f", "#ff6b00", "#8a5cff"],
    paletteLight: ["#16a300", "#009fb8", "#d10f95", "#b89a00", "#e85a00", "#6a35e8"],
    tinted: true,
    className: "arw-skin-neon",
  },
  "skin:midnight": {
    name: "Midnight",
    blurb: "Deep blues and violets with a moonlit edge.",
    palette: ["#4cc9f0", "#4895ef", "#4361ee", "#3f37c9", "#7209b7", "#b5179e"],
    paletteLight: ["#1a8fc0", "#2f6fd6", "#3346d8", "#3a2fb5", "#6a0dad", "#a3127f"],
    tinted: true,
    className: "arw-skin-midnight",
  },
  "skin:gold": {
    name: "Gold",
    blurb: "Polished gold, thick and shiny.",
    palette: ["#ffd700", "#ffc53d", "#f0b429", "#e9a23b", "#ffe08a"],
    paletteLight: ["#b8860b", "#c48a0a", "#a87412", "#946016", "#cf9a12"],
    tinted: true,
    className: "arw-skin-gold",
  },
  "skin:ink": {
    name: "Ink",
    blurb: "Bold single-colour strokes: white on dark, black on light.",
    palette: ["#f4f4f6", "#dcdde3"],
    paletteLight: ["#17181b", "#34363d"],
    tinted: true,
    className: "arw-skin-ink",
  },
  "skin:ice": {
    name: "Ice",
    blurb: "Thin frosty blues with a cold shimmer.",
    palette: ["#e7f5ff", "#a5d8ff", "#74c0fc", "#99e9f2", "#c5f6fa"],
    paletteLight: ["#1971c2", "#1c7ed6", "#0b7285", "#1098ad", "#4dabf7"],
    tinted: true,
    className: "arw-skin-ice",
  },
  "skin:chalk": {
    name: "Chalk",
    blurb: "Hand-drawn chalk lines with a dusty edge.",
    palette: ["#f1f3f5", "#ffd8a8", "#b2f2bb", "#a5d8ff", "#fcc2d7"],
    paletteLight: ["#495057", "#c2410c", "#2b8a3e", "#1864ab", "#a61e4d"],
    tinted: true,
    className: "arw-skin-chalk",
  },
  "skin:lava": {
    name: "Lava",
    blurb: "Molten reds and oranges that glow hot.",
    palette: ["#ff3b30", "#ff6b00", "#ff9500", "#ffcc00", "#ff2d55"],
    paletteLight: ["#c92a2a", "#d9480f", "#e8590c", "#b35c00", "#c2255c"],
    tinted: true,
    className: "arw-skin-lava",
  },
  "skin:rainbow": {
    name: "Rainbow",
    blurb: "A full spectrum sweeps across the whole board.",
    palette: ["#ff5c5c", "#ff922b", "#fcc419", "#51cf66", "#22b8cf", "#4c6ef5", "#be4bdb"],
    paletteLight: ["#e03131", "#e8590c", "#c98a00", "#2f9e44", "#0c8599", "#3b5bdb", "#9c36b5"],
    tinted: true,
    className: "arw-skin-rainbow",
  },
};

export type ArrowFx = { name: string; blurb: string };

export const ARROW_FX: Record<string, ArrowFx> = {
  "fx:wave": { name: "Wave", blurb: "A soft ripple spreads over the board." },
  "fx:pulse": { name: "Neon pulse", blurb: "A bright glowing ring bursts outward." },
  "fx:ink": { name: "Ink bloom", blurb: "A drop of colour blooms and melts away." },
  "fx:starburst": { name: "Starburst", blurb: "A ring of stars flies out from the edge." },
  "fx:bubbles": { name: "Bubbles", blurb: "A stream of bubbles floats up and pops." },
  "fx:petals": { name: "Petals", blurb: "Soft petals drift down and twirl away." },
  "fx:confetti": { name: "Confetti", blurb: "A pop of party confetti." },
  "fx:lightning": { name: "Lightning", blurb: "A bolt cracks across the board." },
  "fx:fireworks": { name: "Fireworks", blurb: "A firework bursts in a shower of sparks." },
};

/* ---------- Arrows: board themes + arrowhead shapes ---------- */

export type ArrowBoard = {
  name: string;
  blurb: string;
  /** "auto" follows light / dark mode; otherwise the board is always this tone (arrow colours follow it). */
  tone: "auto" | "light" | "dark";
};

export const ARROW_BOARDS: Record<string, ArrowBoard> = {
  "board:classic": { name: "Classic", blurb: "The soft standard board, light or dark with the site.", tone: "auto" },
  "board:paper": { name: "Paper", blurb: "Warm notebook paper with faint ruled lines.", tone: "light" },
  "board:blueprint": { name: "Blueprint", blurb: "Engineer's blue with a crisp white grid.", tone: "dark" },
  "board:wood": { name: "Wood", blurb: "A polished wooden tabletop.", tone: "dark" },
  "board:sunset": { name: "Sunset", blurb: "Peach, rose and violet sky.", tone: "dark" },
  "board:space": { name: "Space", blurb: "Deep space with twinkling stars.", tone: "dark" },
};

export type ArrowHead = { name: string; blurb: string };

export const ARROW_HEADS: Record<string, ArrowHead> = {
  "head:classic": { name: "Classic", blurb: "The standard pointed tip." },
  "head:chevron": { name: "Chevron", blurb: "An open, sharp V." },
  "head:dot": { name: "Dot", blurb: "A round bead at the tip." },
  "head:bold": { name: "Bold", blurb: "A big, wide triangle you can't miss." },
  "head:diamond": { name: "Diamond", blurb: "A cut-gem tip." },
  "head:star": { name: "Star", blurb: "A five-point star leads the way." },
};

export const DEFAULT_BOARD = "board:classic";
export const DEFAULT_HEAD = "head:classic";
export const boardIdOf = (id: string | null | undefined) => (id && ARROW_BOARDS[id] ? id : DEFAULT_BOARD);
export const headIdOf = (id: string | null | undefined) => (id && ARROW_HEADS[id] ? id : DEFAULT_HEAD);

export type Frame = { name: string; blurb: string };

export const FRAMES: Record<string, Frame> = {
  "frame:ember": { name: "Ember", blurb: "A warm orange glow that breathes." },
  "frame:neon": { name: "Neon", blurb: "Cyan and pink, always spinning." },
  "frame:gold": { name: "Gold", blurb: "A polished ring with a passing shine." },
  "frame:galaxy": { name: "Galaxy", blurb: "Swirling violet stardust." },
};

export type Booster = { name: string; blurb: string; grants: BoosterItem; qty: number };

export const BOOSTERS: Record<string, Booster> = {
  "pack:hint5": { name: "5 hints", blurb: "Arrows: shows a free arrow when your free hints run out.", grants: "arrows_hint", qty: 5 },
  "pack:hint20": { name: "20 hints", blurb: "Best value hint pack.", grants: "arrows_hint", qty: 20 },
  "pack:undo5": { name: "5 undos", blurb: "Arrows: take back a bump and get the life back (1 per level).", grants: "arrows_undo", qty: 5 },
  "pack:undo20": { name: "20 undos", blurb: "Best value undo pack.", grants: "arrows_undo", qty: 20 },
};

export const DEFAULT_SKIN = "skin:classic";
export const DEFAULT_FX = "fx:wave";

export const skinOf = (id: string | null | undefined) => ARROW_SKINS[id ?? ""] ?? ARROW_SKINS[DEFAULT_SKIN];
export const fxIdOf = (id: string | null | undefined) => (id && ARROW_FX[id] ? id : DEFAULT_FX);
/** CSS class for an avatar frame ("" = none / unknown). */
export const frameClass = (id: string | null | undefined) => (id && FRAMES[id] ? `av-frame av-frame-${id.slice(6)}` : "");

/* ---------------- Chess + Ludo cosmetics ---------------- */

export type BoardGame = "chess" | "ludo";
/** Games whose level can unlock shop items (Arrows: the puzzle level reached). */
export type LevelGame = BoardGame | "arrows";

/** Total XP for `level` (level 1 = 0): 100, 300, 600 … — same curve as Carrom and the server. */
export const xpForLevel = (level: number) => 50 * level * (level - 1);
export const levelForXp = (xp: number) => Math.min(30, Math.max(1, Math.floor((1 + Math.sqrt(1 + (4 * Math.max(0, xp)) / 50)) / 2)));

export type ChessBoardTheme = { name: string; blurb: string; light: string; dark: string; frame: string; accent: string };
export const CHESS_BOARDS: Record<string, ChessBoardTheme> = {
  "cboard:classic": { name: "Tournament", blurb: "The green and cream club board.", light: "#eeeed2", dark: "#769656", frame: "#4e6a36", accent: "#f6f669" },
  "cboard:walnut": { name: "Walnut", blurb: "Warm wood, like a grandfather's set.", light: "#f0d9b5", dark: "#b58863", frame: "#6d4c33", accent: "#f7c873" },
  "cboard:ocean": { name: "Ocean", blurb: "Cool blues and sea foam.", light: "#dee9f2", dark: "#5a8bb0", frame: "#2f5675", accent: "#9fe3ff" },
  "cboard:marble": { name: "Marble", blurb: "Polished stone, grey and white.", light: "#ecebe8", dark: "#9a9894", frame: "#55524d", accent: "#ffd27a" },
  "cboard:midnight": { name: "Midnight", blurb: "Deep violet night squares.", light: "#8f88b7", dark: "#3b3466", frame: "#1d1838", accent: "#ff8a3d" },
};

export type ChessPieceSet = { name: string; blurb: string; white: string; whiteEdge: string; black: string; blackEdge: string; glow?: string };
export const CHESS_PIECES: Record<string, ChessPieceSet> = {
  "cpieces:classic": { name: "Staunton", blurb: "The classic set.", white: "#fbfaf6", whiteEdge: "#2b2b2b", black: "#2f2f33", blackEdge: "#0d0d0f" },
  "cpieces:flat": { name: "Flat", blurb: "Soft modern colours.", white: "#ffd9b0", whiteEdge: "#8a4b1d", black: "#4a5bd1", blackEdge: "#1f2a7a" },
  "cpieces:neon": { name: "Neon", blurb: "Glowing outlines.", white: "#e8fffe", whiteEdge: "#00d9ff", black: "#2a0f33", blackEdge: "#ff2bd6", glow: "drop-shadow(0 0 3px currentColor)" },
  "cpieces:gold": { name: "Gold & Onyx", blurb: "For champions.", white: "#ffe08a", whiteEdge: "#8a6510", black: "#1b1b1f", blackEdge: "#c99a1e" },
};

export type LudoBoardTheme = { name: string; blurb: string; red: string; green: string; yellow: string; blue: string; track: string; bg: string; line: string };
export const LUDO_BOARDS: Record<string, LudoBoardTheme> = {
  "lboard:classic": { name: "Classic", blurb: "Bright primary colours.", red: "#e53935", green: "#43a047", yellow: "#fdd835", blue: "#1e88e5", track: "#ffffff", bg: "#f7f3ea", line: "#2b2b2b" },
  "lboard:candy": { name: "Candy", blurb: "Soft pastel sweets.", red: "#ff8fa3", green: "#7bd8a5", yellow: "#ffd97a", blue: "#8fb8ff", track: "#fffaf3", bg: "#fff1f5", line: "#9a7a86" },
  "lboard:night": { name: "Night", blurb: "Neon on a dark board.", red: "#ff4d6d", green: "#2bd97f", yellow: "#ffd23f", blue: "#3fa7ff", track: "#232039", bg: "#15131f", line: "#5d5880" },
  "lboard:royal": { name: "Royal", blurb: "Jewel tones with gold lines.", red: "#9b1d2c", green: "#16664a", yellow: "#c99a1e", blue: "#1d3f8f", track: "#fbf3df", bg: "#efe2bf", line: "#8a6510" },
};

export type LudoDiceStyle = { name: string; blurb: string; face: string; pip: string; edge: string; tokenShine: boolean };
export const LUDO_DICE: Record<string, LudoDiceStyle> = {
  "ldice:classic": { name: "Classic", blurb: "White die, black pips.", face: "#ffffff", pip: "#1d1d1f", edge: "#d6d6d6", tokenShine: false },
  "ldice:gem": { name: "Gem", blurb: "Translucent ruby die, glossy tokens.", face: "#ff5c7a", pip: "#ffffff", edge: "#b3203f", tokenShine: true },
  "ldice:neon": { name: "Neon", blurb: "Dark die with glowing pips.", face: "#1b1830", pip: "#39ff14", edge: "#00f0ff", tokenShine: true },
  "ldice:gold": { name: "Gold", blurb: "Solid gold, shiny tokens.", face: "#ffd54a", pip: "#5a3d00", edge: "#b8860b", tokenShine: true },
};

export const chessBoardOf = (id: string | null | undefined) => CHESS_BOARDS[id ?? ""] ?? CHESS_BOARDS["cboard:classic"];
export const chessPiecesOf = (id: string | null | undefined) => CHESS_PIECES[id ?? ""] ?? CHESS_PIECES["cpieces:classic"];
export const ludoBoardOf = (id: string | null | undefined) => LUDO_BOARDS[id ?? ""] ?? LUDO_BOARDS["lboard:classic"];
export const ludoDiceOf = (id: string | null | undefined) => LUDO_DICE[id ?? ""] ?? LUDO_DICE["ldice:classic"];
