/* Spacefall's image art: AI-made ship lines (one picture per evolution stage) and NASA sky photos.
   Images load in the background; until one is ready the code-drawn art (art.ts) stands in, so
   the game never waits and never breaks if a file is missing. */
import { SF_SHIPS, SF_SKIES, sfShipOf, sfSkyOf } from "../../lib/shopCatalog";

const cache = new Map<string, HTMLImageElement>();

/** the image if it has finished loading (starts loading it otherwise) */
export function img(url: string): HTMLImageElement | null {
  let im = cache.get(url);
  if (!im) {
    im = new Image();
    im.decoding = "async";
    im.src = url;
    cache.set(url, im);
  }
  return im.complete && im.naturalWidth > 0 ? im : null;
}

/** the six regions' skies, in region order (config.ts REGIONS) */
export const REGION_SKIES = ["deep", "crimson", "belt", "reach", "alien", "rift"];
const skyUrl = (key: string) => `/games/spacefall/skies/${key}.webp`;

/** what the player has equipped (set by the game from the shop) */
export const looks = { ship: "sfship:aegis", sky: "sfsky:journey" };
export function setLooks(ship: string | null | undefined, sky: string | null | undefined) {
  looks.ship = sfShipOf(ship);
  looks.sky = sfSkyOf(sky);
}

/** the picture for this evolution stage (0-based); a missing stage uses the nearest earlier one */
export function shipImage(stage: number, shipId = looks.ship): HTMLImageElement | null {
  const line = SF_SHIPS[shipId];
  if (!line?.ready || line.stages <= 0) return null;
  const n = Math.min(stage + 1, line.stages);
  return img(`/games/spacefall/ships/${line.key}-${n}.webp`);
}

/** the sky for a region: the equipped one, or the region's own on "Journey" */
export function skyImage(region: number): HTMLImageElement | null {
  const key = SF_SKIES[looks.sky]?.key ?? REGION_SKIES[region % REGION_SKIES.length];
  return img(skyUrl(key));
}

/** start loading what a run needs first */
export function preloadLooks() {
  for (let s = 0; s < 6; s++) shipImage(s);
  skyImage(0);
  skyImage(1);
}
