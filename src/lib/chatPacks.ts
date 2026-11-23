/* Communication packs: emoji, phrases and stickers players send in online matches, lobbies and
   friends chat. Ready-made items only. Prices / Plus flag come from the shop (kind 'chat_pack',
   supabase/chat.sql); pack and item ids must match there. Custom art packs come from the admin
   panel (chat_custom_packs) as "chat:c:<id>". */
import { useEffect, useState } from "react";
import { supabase } from "../supabase";

export type ChatKind = "emoji" | "phrase" | "sticker" | "image";

export type ChatItem = {
  id: string;
  /** emoji character, the phrase, or the sticker's caption */
  text: string;
  /** sticker: its emoji / icon; image: picture URL */
  art?: string;
  /** sticker look */
  tone?: "fire" | "gold" | "blue" | "pink" | "green" | "purple";
  /** sticker animation */
  anim?: "bounce" | "spin" | "pulse" | "shake" | "float";
};

export type ChatPack = { id: string; name: string; kind: ChatKind; items: ChatItem[] };

const emoji = (list: string[]): ChatItem[] => list.map((e, i) => ({ id: `e${i}`, text: e }));
const phrases = (list: string[]): ChatItem[] => list.map((t, i) => ({ id: `p${i}`, text: t }));

export const BUILTIN_PACKS: ChatPack[] = [
  { id: "chat:emoji", name: "Basic emoji", kind: "emoji", items: emoji(["😀", "😂", "😮", "😢", "😡", "👍", "👏", "❤️"]) },
  {
    id: "chat:phrases",
    name: "Basic phrases",
    kind: "phrase",
    items: phrases(["Hi!", "Good luck", "Good game", "Nice!", "Thanks", "Oops", "Your turn", "Bye"]),
  },
  {
    id: "chat:starter",
    name: "Starter stickers",
    kind: "sticker",
    items: [
      { id: "gg", text: "GG", art: "🤝", tone: "blue", anim: "bounce" },
      { id: "wow", text: "Wow", art: "😲", tone: "pink", anim: "pulse" },
      { id: "fire", text: "On fire", art: "🔥", tone: "fire", anim: "shake" },
    ],
  },
  { id: "chat:party", name: "Party emoji", kind: "emoji", items: emoji(["🥳", "🎉", "😎", "🤩", "🤯", "🫡", "💀", "🙈"]) },
  {
    id: "chat:trash",
    name: "Trash talk",
    kind: "phrase",
    items: phrases(["Too easy", "Is that all?", "Watch this", "Lucky shot", "Not bad… for a beginner", "I'm just warming up", "Rematch?", "Calculated."]),
  },
  {
    id: "chat:cheers",
    name: "Sports cheers",
    kind: "phrase",
    items: phrases(["What a shot!", "Champion!", "Incredible!", "Well played", "So close!", "Unstoppable!", "Legend!", "Respect"]),
  },
  {
    id: "chat:animated",
    name: "Animated pack",
    kind: "sticker",
    items: [
      { id: "fire", text: "Lit", art: "🔥", tone: "fire", anim: "bounce" },
      { id: "bolt", text: "Fast", art: "⚡", tone: "gold", anim: "shake" },
      { id: "boom", text: "Boom", art: "💥", tone: "pink", anim: "pulse" },
      { id: "trophy", text: "Winner", art: "🏆", tone: "gold", anim: "float" },
      { id: "crown", text: "King", art: "👑", tone: "purple", anim: "spin" },
    ],
  },
  {
    id: "chat:games",
    name: "Game pack",
    kind: "sticker",
    items: [
      { id: "check", text: "Check!", art: "♟️", tone: "blue", anim: "shake" },
      { id: "queen", text: "Queen!", art: "🎯", tone: "pink", anim: "pulse" },
      { id: "six", text: "Six!", art: "🎲", tone: "green", anim: "spin" },
      { id: "combo", text: "Combo!", art: "🏹", tone: "fire", anim: "bounce" },
    ],
  },
  {
    id: "chat:royal",
    name: "Royal pack",
    kind: "sticker",
    items: [
      { id: "crown", text: "Bow down", art: "👑", tone: "gold", anim: "float" },
      { id: "diamond", text: "Flawless", art: "💎", tone: "blue", anim: "spin" },
      { id: "trophy", text: "Champion", art: "🏆", tone: "gold", anim: "bounce" },
      { id: "star", text: "Superstar", art: "🌟", tone: "purple", anim: "pulse" },
    ],
  },
];

/* ---------- custom art packs (admin) ---------- */
type CustomRow = { id: string; name: string; items: { id: string; label?: string; url: string }[] };
let customCache: ChatPack[] | null = null;
let customInflight: Promise<ChatPack[]> | null = null;

export function loadCustomPacks(force = false): Promise<ChatPack[]> {
  if (customCache && !force) return Promise.resolve(customCache);
  if (!supabase) return Promise.resolve([]);
  if (force) customInflight = null;
  customInflight ??= Promise.resolve(supabase.from("chat_custom_packs").select("id, name, items").order("created_at")).then(
    ({ data }) => {
      customCache = ((data ?? []) as CustomRow[]).map((r) => ({
        id: `chat:c:${r.id}`,
        name: r.name,
        kind: "image" as const,
        items: (Array.isArray(r.items) ? r.items : [])
          .filter((x) => x && typeof x.url === "string" && /^https:\/\//.test(x.url))
          .map((x) => ({ id: String(x.id).slice(0, 32), text: x.label ?? "", art: x.url })),
      }));
      return customCache;
    },
    () => [],
  );
  return customInflight;
}

/** Every pack (built-in + custom). */
export function useChatPacks() {
  const [custom, setCustom] = useState<ChatPack[]>(customCache ?? []);
  useEffect(() => {
    let alive = true;
    void loadCustomPacks().then((c) => alive && setCustom(c));
    return () => {
      alive = false;
    };
  }, []);
  return [...BUILTIN_PACKS, ...custom];
}

/** The item a message refers to (null = unknown pack / item: not shown). */
export function findItem(packs: ChatPack[], packId: string, itemId: string) {
  const pack = packs.find((p) => p.id === packId);
  const item = pack?.items.find((i) => i.id === itemId);
  return pack && item ? { pack, item } : null;
}

/* ---------- "chat off" (all incoming messages hidden) ---------- */
const OFF_KEY = "senevon:chat-off";
export function chatOff() {
  try {
    return localStorage.getItem(OFF_KEY) === "1";
  } catch {
    return false;
  }
}
export function setChatOff(off: boolean) {
  try {
    if (off) localStorage.setItem(OFF_KEY, "1");
    else localStorage.removeItem(OFF_KEY);
  } catch {
    /* storage blocked */
  }
  window.dispatchEvent(new Event("senevon:chat-off"));
}
export function useChatOff() {
  const [off, setOff] = useState(chatOff);
  useEffect(() => {
    const on = () => setOff(chatOff());
    window.addEventListener("senevon:chat-off", on);
    return () => window.removeEventListener("senevon:chat-off", on);
  }, []);
  return off;
}

/** Friendly text for the chat server errors. */
export function chatErrorText(err: unknown) {
  const m = (err as { message?: string })?.message ?? String(err);
  if (m.includes("slow_down")) return "Slow down a little.";
  if (m.includes("not_owned")) return "Get this pack first.";
  if (m.includes("not_friends")) return "You can only message friends.";
  if (m.includes("not_signed_in")) return "Sign in first.";
  if (m.includes("Could not find the function")) return "Chat isn't set up on the server yet (run supabase/chat.sql).";
  return "Couldn't send. Try again.";
}
