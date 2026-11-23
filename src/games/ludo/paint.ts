/* Seat colours for a Ludo game: the board theme's colours, with players' own token colours
   (shop slot ludo_token) on top. When a chosen colour is too close to an opponent's, that
   opponent takes the chooser's seat colour instead, so every seat stays easy to tell apart. */
import { COLOR_KEYS, type Color } from "./engine";
import { ludoTokenOf, type LudoBoardTheme, type LudoTokenEffect } from "../../lib/shopCatalog";

export type SeatPaint = { solid: string; effect?: LudoTokenEffect };
export type SeatPaints = Record<Color, SeatPaint>;

function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Rough perceptual distance between two colours ("redmean"); under ~140 they look alike on the board. */
export function colourDistance(a: string, b: string) {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  const rm = (r1 + r2) / 2;
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}
const CLASH = 140;

/** `tints[i]` = the token-colour id of the player in seat i (who plays colour `colors[i]`). */
export function seatPaints(theme: LudoBoardTheme, colors: Color[], tints: (string | null | undefined)[]): SeatPaints {
  const base = ([0, 1, 2, 3] as Color[]).map((c) => theme[COLOR_KEYS[c]]);
  const out = Object.fromEntries(base.map((solid, c) => [c, { solid }])) as SeatPaints;
  const tinted = new Set<Color>();
  colors.forEach((c, i) => {
    const t = ludoTokenOf(tints[i]);
    if (!t) return;
    // an earlier player already has a colour like this one: keep theirs, skip this one
    if ([...tinted].some((d) => colourDistance(out[d].solid, t.fill) < CLASH)) return;
    out[c] = { solid: t.fill, effect: t.effect };
    tinted.add(c);
    // an opponent without their own colour that now looks the same takes this seat's original colour
    for (const d of colors) {
      if (d !== c && !tinted.has(d) && colourDistance(out[d].solid, t.fill) < CLASH) out[d] = { solid: base[c] };
    }
  });
  return out;
}
