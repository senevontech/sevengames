import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createAvatar, type Style } from "@dicebear/core";
import { supabase } from "../supabase";

/*
 * Avatar library (DiceBear). Avatars are generated in the browser as SVG, so there are
 * no image downloads and every seed gives a unique character.
 *
 * Only styles that need no attribution are used:
 *   CC0 1.0: pixel-art, lorelei, notionists, thumbs
 *   "Free for personal and commercial use": bottts, avataaars
 *
 * Each style is code-split and only loaded when it is first shown.
 */

type StyleModule = Style<Record<string, unknown>>;

export const AVATAR_STYLES = [
  { id: "pixel-art", label: "Pixel", load: () => import("@dicebear/pixel-art") },
  { id: "bottts", label: "Bots", load: () => import("@dicebear/bottts") },
  { id: "avataaars", label: "Toon", load: () => import("@dicebear/avataaars") },
  { id: "lorelei", label: "Sketch", load: () => import("@dicebear/lorelei") },
  { id: "notionists", label: "Ink", load: () => import("@dicebear/notionists") },
  { id: "thumbs", label: "Blob", load: () => import("@dicebear/thumbs") },
] as const;

export type AvatarStyleId = (typeof AVATAR_STYLES)[number]["id"];
/**
 * A player's avatar. For a generated avatar `seed` picks the character; for `style: "google"`
 * `seed` is the URL of the photo from the player's Google account.
 */
export type AvatarChoice = { style: AvatarStyleId | "google"; seed: string };

// Brand-friendly backgrounds that read well on the dark UI (hex without #).
const BACKGROUNDS = ["1564ff", "f46000", "ff9443", "5e5ce6", "2a1a12", "0f766e", "b4235a"];

const STORAGE_KEY = "senevon:avatar";
const CHANGE_EVENT = "senevon:avatar-change";

const styleCache = new Map<string, Promise<StyleModule>>();

/* Rendered avatars are also kept on the device (most recent first, size-capped), so a returning
   visitor's avatars show instantly without downloading and running the avatar library again. */
const DISK_KEY = "senevon:avatar-cache:v1";
const DISK_MAX_CHARS = 1_500_000;
const uriCache = new Map<string, string>(
  (() => {
    try {
      const raw = localStorage.getItem(DISK_KEY);
      const list = raw ? (JSON.parse(raw) as [string, string][]) : [];
      return Array.isArray(list) ? list.filter((e) => typeof e?.[0] === "string" && typeof e?.[1] === "string" && e[1].startsWith("data:image/svg+xml")) : [];
    } catch {
      return [];
    }
  })(),
);
let saveTimer = 0;
function saveUriCache() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const out: [string, string][] = [];
    let chars = 0;
    for (const e of [...uriCache].reverse()) {
      chars += e[0].length + e[1].length;
      if (chars > DISK_MAX_CHARS) break;
      out.push(e);
    }
    try {
      localStorage.setItem(DISK_KEY, JSON.stringify(out.reverse()));
    } catch {
      /* storage full or unavailable: memory cache only */
    }
  }, 1500);
}

function isStyleId(value: unknown): value is AvatarStyleId {
  return AVATAR_STYLES.some((s) => s.id === value);
}

/**
 * Only Google's own image host is trusted for photos. Avatars are shown to other players on the
 * leaderboard, so an arbitrary URL would let someone show any image (or a tracking pixel).
 * Keep in sync with the profiles_avatar_valid check in supabase/schema.sql.
 */
export function isGooglePhotoUrl(value: unknown): value is string {
  return typeof value === "string" && value.length <= 1024 && /^https:\/\/[a-z0-9-]+\.googleusercontent\.com\//.test(value);
}

/** The photo from the user's Google account, if they signed in with Google. */
export function googlePhoto(user: User | null): string | null {
  const meta = user?.user_metadata ?? {};
  const url = meta.avatar_url ?? meta.picture;
  return isGooglePhotoUrl(url) ? url : null;
}

/** Validate an avatar that came from storage, account metadata or the database. */
export function parseAvatar(value: unknown): AvatarChoice | null {
  const v = value as Partial<AvatarChoice> | null | undefined;
  if (!v || typeof v.seed !== "string") return null;
  if (v.style === "google") return isGooglePhotoUrl(v.seed) ? { style: "google", seed: v.seed } : null;
  return isStyleId(v.style) && v.seed.length <= 64 ? { style: v.style, seed: v.seed } : null;
}

function loadStyle(id: AvatarStyleId): Promise<StyleModule> {
  let p = styleCache.get(id);
  if (!p) {
    const def = AVATAR_STYLES.find((s) => s.id === id)!;
    p = def.load().then((m) => m as unknown as StyleModule);
    styleCache.set(id, p);
  }
  return p;
}

/** Render an avatar to a data: URI (cached per style + seed). */
export async function renderAvatar({ style, seed }: AvatarChoice): Promise<string> {
  if (style === "google") return seed; // already an image URL
  const key = `${style}|${seed}`;
  const hit = uriCache.get(key);
  if (hit) {
    // most recently used last, so it survives the size cap
    uriCache.delete(key);
    uriCache.set(key, hit);
    return hit;
  }
  const mod = await loadStyle(style);
  const uri = createAvatar(mod, {
    seed,
    size: 128,
    backgroundColor: BACKGROUNDS,
    backgroundType: ["gradientLinear", "solid"],
  }).toDataUri();
  uriCache.set(key, uri);
  saveUriCache();
  return uri;
}

/** Async data URI for any style/seed (used by the library grid). */
export function useAvatarUri(choice: AvatarChoice | null) {
  const key = choice ? `${choice.style}|${choice.seed}` : "";
  const [uri, setUri] = useState<string | null>(() =>
    !choice ? null : choice.style === "google" ? choice.seed : uriCache.get(key) ?? null,
  );
  useEffect(() => {
    if (!choice) return;
    let alive = true;
    const cached = choice.style === "google" ? choice.seed : uriCache.get(key);
    if (cached) {
      setUri(cached);
      return;
    }
    setUri(null);
    void renderAvatar(choice).then((u) => alive && setUri(u));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return uri;
}

/** A batch of fresh seeds for the library grid (page = shuffle counter). */
export function seedsFor(base: string, page: number, count: number) {
  return Array.from({ length: count }, (_, i) => `${base}-${page}-${i}`);
}

type Stored = AvatarChoice & { uri?: string };

function readStored(): Stored | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Stored;
    const choice = parseAvatar(v);
    return choice ? { ...choice, uri: typeof v.uri === "string" ? v.uri : undefined } : null;
  } catch {
    return null;
  }
}

function writeStored(v: Stored) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
  } catch {
    /* storage full or blocked: the avatar still works for this session */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function fromMetadata(user: User | null): AvatarChoice | null {
  return parseAvatar(user?.user_metadata?.avatar);
}

/**
 * The avatar the account should show: the one the player picked, otherwise their Google photo.
 * A saved Google choice always uses the current photo URL (Google refreshes it on each sign-in).
 */
function accountChoice(user: User | null): AvatarChoice | null {
  const saved = fromMetadata(user);
  const photo = googlePhoto(user);
  if (saved?.style === "google") return photo ? { style: "google", seed: photo } : null;
  return saved ?? (photo ? { style: "google", seed: photo } : null);
}

const syncedProfiles = new Set<string>();

/** Publish the avatar to the player's profile row so it shows on the leaderboards. */
function syncProfileAvatar(user: User, choice: AvatarChoice) {
  const key = `${user.id}|${choice.style}|${choice.seed}`;
  if (!supabase || syncedProfiles.has(key)) return;
  syncedProfiles.add(key);
  void supabase
    .from("profiles")
    .update({ avatar: { style: choice.style, seed: choice.seed } })
    .eq("id", user.id)
    .then(({ error }) => {
      // Usually means supabase/schema.sql hasn't been re-run yet (no avatar column).
      if (error) console.warn("[avatar] profile sync failed:", error.message);
    });
}

function randomSeed() {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * The current player's avatar. Saved on this device (with the rendered image, so it shows
 * instantly on the next visit) and, when signed in, in the account so it follows them.
 */
export function useAvatar(user: User | null) {
  const [state, setState] = useState<Stored>(() => {
    return readStored() ?? accountChoice(user) ?? { style: "pixel-art", seed: user?.id ?? randomSeed() };
  });
  const prevUserId = useRef<string | null | undefined>(undefined);

  // Other components (nav, profile) changing the avatar.
  useEffect(() => {
    const sync = () => {
      const v = readStored();
      if (v) setState(v);
    };
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  // Signing in: adopt the avatar saved in the account, or the Google photo for a new Google user.
  useEffect(() => {
    const prev = prevUserId.current;
    prevUserId.current = user?.id ?? null;

    const adopt = (next: AvatarChoice) => {
      if (next.style !== state.style || next.seed !== state.seed) {
        void renderAvatar(next).then((uri) => writeStored({ ...next, uri }));
      }
    };

    if (!user) {
      // Signed out: don't leave the previous player's photo on this device.
      if (prev && state.style === "google") adopt({ style: "pixel-art", seed: "guest" });
      return;
    }

    let next = accountChoice(user);
    // This device may hold someone else's Google photo (shared computer): never show it here.
    if (!next && state.style === "google") next = { style: "pixel-art", seed: user.id };
    if (next) adopt(next);
    syncProfileAvatar(user, next ?? { style: state.style, seed: state.seed });
    // Only when the signed-in user changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Make sure the image for the current choice is rendered and cached.
  useEffect(() => {
    if (state.uri) return;
    let alive = true;
    void renderAvatar(state).then((uri) => {
      if (alive) writeStored({ style: state.style, seed: state.seed, uri });
    });
    return () => {
      alive = false;
    };
  }, [state]);

  const choose = useCallback(
    async (choice: AvatarChoice) => {
      const uri = await renderAvatar(choice);
      writeStored({ ...choice, uri });
      if (user && supabase) {
        void supabase.auth.updateUser({ data: { avatar: { style: choice.style, seed: choice.seed } } });
        syncProfileAvatar(user, choice);
      }
    },
    [user],
  );

  return { choice: { style: state.style, seed: state.seed } as AvatarChoice, uri: state.uri ?? null, choose };
}
