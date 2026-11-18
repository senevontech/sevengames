/* What the shop sells: names, looks and pack sizes. Prices come from the server (shop_items in
   supabase/shop.sql, editable in Admin → Tokens). Keep the item ids in sync with shop.sql. */

export type ShopSlot = "arrow_skin" | "arrow_fx" | "frame";
export type BoosterItem = "arrows_hint" | "arrows_undo";

export type ArrowSkin = {
  name: string;
  blurb: string;
  /** Colours arrows take (at rest when `tinted`, otherwise only while leaving). */
  palette: string[];
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
    tinted: false,
    className: "",
  },
  "skin:pastel": {
    name: "Pastel",
    blurb: "Soft candy colours, always on.",
    palette: ["#ffadad", "#ffd6a5", "#fdffb6", "#caffbf", "#9bf6ff", "#a0c4ff", "#bdb2ff", "#ffc6ff"],
    tinted: true,
    className: "arw-skin-pastel",
  },
  "skin:neon": {
    name: "Neon",
    blurb: "Glowing electric tubes.",
    palette: ["#39ff14", "#00f0ff", "#ff2bd6", "#fff01f", "#ff6b00", "#8a5cff"],
    tinted: true,
    className: "arw-skin-neon",
  },
  "skin:midnight": {
    name: "Midnight",
    blurb: "Deep blues and violets with a moonlit edge.",
    palette: ["#4cc9f0", "#4895ef", "#4361ee", "#3f37c9", "#7209b7", "#b5179e"],
    tinted: true,
    className: "arw-skin-midnight",
  },
  "skin:gold": {
    name: "Gold",
    blurb: "Polished gold, thick and shiny.",
    palette: ["#ffd700", "#ffc53d", "#f0b429", "#e9a23b", "#ffe08a"],
    tinted: true,
    className: "arw-skin-gold",
  },
};

export type ArrowFx = { name: string; blurb: string };

export const ARROW_FX: Record<string, ArrowFx> = {
  "fx:wave": { name: "Wave", blurb: "A soft ripple spreads over the board." },
  "fx:pulse": { name: "Neon pulse", blurb: "A bright glowing ring bursts outward." },
  "fx:ink": { name: "Ink bloom", blurb: "A drop of colour blooms and melts away." },
  "fx:starburst": { name: "Starburst", blurb: "A ring of stars flies out from the edge." },
};

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
