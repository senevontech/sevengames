/* Draw a Tune: draw anything, press Play, and hear it. A bar sweeps left → right; height is pitch
   (always in key), each colour is an instrument, a thicker pen is louder. Tempo, loop, scale/key
   and a backing beat. A daily prompt: post your song, play and like everyone else's, remix one,
   share a link. XP and a posting streak (supabase/tune.sql). Mirror pen and a mixer are free;
   studio instruments, extra beats, world scales and echo are unlocked with chips in the Music
   shop (anyone can always listen to songs that use them). Sharing is free: a vertical video clip
   made on the device (clip.ts) for WhatsApp / Instagram / Facebook, a sound file, and links.

   Layout: the canvas is sized to fill the game window exactly (no scrolling); on wide windows the
   controls sit in a panel beside it, on narrow ones below. Everything follows the site theme. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ChevronLeft, Copy, Dices, Download, Film, Eraser, FlipHorizontal2, Flame, Heart, Library, Lock, Play, Plus, Repeat, Send, Share2, ShoppingBag, SlidersHorizontal, Sparkles, Square, Trash2, Undo2, Volume2, VolumeX, Wand2 } from "lucide-react";
import { Link } from "react-router-dom";
import type { GameProps } from "../index";
import { supabase } from "../../supabase";
import { useAuthContext } from "../../context/AuthContext";
import { useShop } from "../../lib/shop";
import { TUNE_ITEMS, levelForXp } from "../../lib/shopCatalog";
import { useTokens } from "../../lib/tokens";
import { formatTokens } from "../../lib/currency";
import TokenIcon from "../../components/TokenIcon";
import { useGameShop } from "../gameShop";
import PlayerAvatar from "../../components/PlayerAvatar";
import { parseAvatar } from "../../lib/avatar";
import {
  BEATS,
  BEAT_LOCK,
  COL,
  ECHO_ITEM,
  EXTRA_INST,
  H,
  INST_LOCK,
  KIT_ZONES,
  OCT_SHIFT,
  SCALE_LOCK,
  isKit,
  INSTRUMENTS,
  INST_ORDER,
  KEYS,
  POINT_LIMIT,
  SCALES,
  STEPS,
  W,
  cleanSong,
  drumZone,
  emptySong,
  midiOf,
  pointCount,
  rowAt,
  songNotes,
  surpriseSong,
  type BeatId,
  type Inst,
  type ScaleId,
  type Song,
  type Stroke,
} from "./music";
import { Player, playNote, previewSound, renderWav } from "./synth";
import { CLIP_H, CLIP_W, clipSupported, makeClip } from "./clip";
import { ERASE_R, PEN, TuneView, drawThumb, inkOf, type Theme } from "./render";
import "./tune.css";

const SITE = "https://games.senevon.in/game/draw-a-tune";
const DRAFT_KEY = "senevon:tune:draft";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PANEL_W = 300;
const WIDE_AT = 760;
const INST_HINT: Record<Inst, string> = {
  piano: "Melody",
  bells: "Sparkle, an octave up",
  strings: "Long, smooth notes",
  bass: "Two octaves down",
  drums: "Kick · tom · snare · hat by height",
  guitar: "Plucked, an octave down",
  sitar: "Buzzing strings with a bend",
  flute: "Breathy, an octave up",
  synth: "Bright electronic lead",
  tabla: "Ge · na · tin · ti by height",
};

/* ---------------- the daily prompt ---------------- */
const PROMPTS = [
  "Rain on a window", "A mountain range", "Ocean waves", "A heartbeat", "Fireworks", "A spiral staircase", "Your name",
  "A city skyline", "Birds flying south", "Lightning", "A rollercoaster", "Sunrise", "A flower", "Stars at night",
  "A bouncing ball", "A cat", "A rocket launch", "A smile", "Falling leaves", "A train journey", "Your favourite food",
  "Diwali lights", "A kite in the sky", "A rainbow", "Snowflakes", "A dancing robot", "A river", "A storm",
  "Your house", "A butterfly", "Monsoon", "A clock ticking", "A dragon", "Footsteps", "The moon", "A waterfall",
  "A cricket match", "A volcano", "Sleepy Sunday", "A maze",
];
const dayKey = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
function promptFor(day: string) {
  const n = Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000);
  return PROMPTS[(n * 17 + 5) % PROMPTS.length];
}
const noteName = (m: number) => `${KEYS[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;

/* ---------------- server ---------------- */
type SongRow = { id: string; user_id: string; name: string; avatar: unknown; title: string | null; likes: number; liked: boolean; mine: boolean; day: string; song: unknown };
type Tab = "today" | "best" | "mine";

async function listSongs(tab: Tab): Promise<SongRow[] | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("tune_list", { p_tab: tab });
  if (error) return null;
  return (data as SongRow[]) ?? [];
}
async function getSong(id: string): Promise<SongRow | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("tune_get", { p_id: id });
  if (error || !data) return null;
  return data as SongRow;
}
async function shareLink(text: string, url: string) {
  try {
    if (navigator.share) {
      await navigator.share({ text, url });
      return "shared";
    }
  } catch {
    /* cancelled */
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    return "copied";
  } catch {
    return "failed";
  }
}
function readDraft(): Song {
  try {
    const s = localStorage.getItem(DRAFT_KEY);
    return (s && cleanSong(JSON.parse(s))) || emptySong();
  } catch {
    return emptySong();
  }
}

/** light or dark, from the game window's own surface colour */
function themeOf(el: HTMLElement | null): Theme {
  if (!el) return "dark";
  const v = getComputedStyle(el).getPropertyValue("--tn-bg").trim();
  const c = document.createElement("canvas").getContext("2d");
  if (!c || !v) return "dark";
  c.fillStyle = "#000";
  c.fillStyle = v;
  const hex = c.fillStyle; // normalised to #rrggbb (or rgba())
  let r = 0, g = 0, b = 0;
  if (hex.startsWith("#")) {
    const n = parseInt(hex.slice(1, 7), 16);
    r = (n >> 16) & 255;
    g = (n >> 8) & 255;
    b = n & 255;
  } else {
    [r, g, b] = (hex.match(/[\d.]+/g) ?? ["0", "0", "0"]).map(Number);
  }
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 140 ? "light" : "dark";
}

/* ---------------- a gallery card's picture ---------------- */
function Thumb({ song, theme }: { song: Song; theme: Theme }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) drawThumb(ref.current, song, theme);
  }, [song, theme]);
  return <canvas ref={ref} className="tn-thumb" aria-hidden="true" />;
}

/* =================================================================== */
export default function TuneGame(_props: GameProps) {
  const { user } = useAuthContext();
  const shop = useShop();
  const navigate = useNavigate();

  const [draft, setDraft] = useState<Song>(readDraft);
  const [history, setHistory] = useState<Stroke[][]>([]);
  const [inst, setInst] = useState<Inst>("piano");
  const [size, setSize] = useState<0 | 1 | 2>(1);
  const [tool, setTool] = useState<"pen" | "eraser">("pen");
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [bar, setBar] = useState(0);
  const [viewing, setViewing] = useState<null | { row: SongRow; song: Song }>(null);
  const [gallery, setGallery] = useState<Tab | null>(null);
  const [rows, setRows] = useState<SongRow[] | null | "loading">("loading");
  const [posting, setPosting] = useState<null | { title: string; busy: boolean; done?: { id: string; xp: number }; error?: string }>(null);
  const [note, setNote] = useState<string | null>(null);
  const [streak, setStreak] = useState(0);
  const [theme, setTheme] = useState<Theme>("dark");
  const [wide, setWide] = useState(false);
  const [compact, setCompact] = useState(false);
  const [soundOpen, setSoundOpen] = useState(false);
  const [canvasH, setCanvasH] = useState(0);
  const [mirror, setMirror] = useState(false);
  const [muted, setMuted] = useState<Inst[]>([]);
  const [unlock, setUnlock] = useState<null | { item: string; then?: () => void; armed?: boolean; busy?: boolean; error?: string }>(null);
  const [pensOpen, setPensOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [sharing, setSharing] = useState<null | { phase: "making" | "ready" | "failed"; k: number; run: number; file?: File; url?: string }>(null);
  const [postedId, setPostedId] = useState<{ id: string; title: string | null } | null>(null);
  const clipRef = useRef<HTMLCanvasElement>(null);
  const clipAbort = useRef<AbortController | null>(null);
  const { wallet } = useTokens();
  const gameShop = useGameShop();
  /** is this unlocked? (free things always are) */
  const has = useCallback((item?: string) => !item || shop.owns(item), [shop]);
  const day = useMemo(dayKey, []);
  const prompt = promptFor(day);

  const song = viewing?.song ?? draft;
  const allNotes = useMemo(() => songNotes(song), [song]);
  // the mixer: muted instruments don't play
  const notes = useMemo(() => (muted.length ? allNotes.filter((n) => !muted.includes(n.inst)) : allNotes), [allNotes, muted]);
  const used = useMemo(() => [...new Set(song.strokes.map((st) => st.i))], [song]);
  const playOpts = useCallback((s: Song, lp: boolean) => ({ bpm: s.bpm, beat: s.beat, loop: lp, key: s.key, echo: !!s.fx?.echo }), []);

  /* ----- keep the draft ----- */
  const postedFor = useRef<Song | null>(null);
  useEffect(() => {
    if (postedId && postedFor.current && postedFor.current !== draft) setPostedId(null);
  }, [draft, postedId]);
  useEffect(() => {
    if (postedId) postedFor.current = draft;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postedId]);
  useEffect(() => {
    const id = window.setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      } catch {
        /* not saved */
      }
    }, 400);
    return () => window.clearTimeout(id);
  }, [draft]);
  const flash = useCallback((t: string) => {
    setNote(t);
    window.setTimeout(() => setNote((n) => (n === t ? null : n)), 2400);
  }, []);

  /* ----- a shared link opens that song ----- */
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("song");
    if (!id || !UUID.test(id)) return;
    void getSong(id).then((row) => {
      const s = row && cleanSong(row.song);
      if (row && s) setViewing({ row, song: s });
      else flash("That song isn't available");
    });
  }, [flash]);

  /* ----- streak (signed in) ----- */
  useEffect(() => {
    if (!user || !supabase) return;
    let live = true;
    void supabase.rpc("tune_streak").then(({ data }) => live && typeof data === "number" && setStreak(data));
    return () => {
      live = false;
    };
  }, [user]);
  const level = levelForXp(shop.xpOf("tune"));

  /* ----- canvas + layout ----- */
  const surfRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<TuneView | null>(null);
  const playerRef = useRef<Player | null>(null);
  useEffect(() => {
    const v = new TuneView(cvRef.current!);
    viewRef.current = v;
    const p = new Player();
    p.onEnd = () => setPlaying(false);
    playerRef.current = p;
    v.start();
    return () => {
      v.destroy();
      p.stop();
    };
  }, []);

  // size the canvas so the whole game fills the game window without scrolling
  useLayoutEffect(() => {
    const surf = surfRef.current!;
    const box = (surf.closest(".fitbox") as HTMLElement | null) ?? null;
    const fit = () => {
      const availW = surf.clientWidth;
      const availH = Math.max(260, (box?.clientHeight ?? window.innerHeight) - 4);
      const isWide = availW >= WIDE_AT && availH >= 380;
      setWide(isWide);
      const cs = getComputedStyle(surf);
      const padV = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      const gap = parseFloat(cs.rowGap) || 10;
      const top = topRef.current?.offsetHeight ?? 40;
      const well = surf.querySelector(".tn-well");
      const wellPad = well ? 2 * (parseFloat(getComputedStyle(well).paddingTop) || 0) : 16;
      const innerW = availW - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      let w: number;
      if (isWide) {
        const h = availH - padV - top - gap - wellPad;
        w = Math.min(innerW - PANEL_W - 12 - wellPad, (h * W) / H);
      } else {
        // a phone: the canvas takes the full width and every pixel of height the controls leave
        // (taller than 4:3 when there's room; songs keep their notes, the picture just stretches)
        const below = panelRef.current?.offsetHeight ?? 160;
        const room = availH - padV - top - below - gap * 2 - wellPad;
        const cw = Math.max(220, Math.floor(innerW - wellPad));
        const ch = Math.floor(Math.max(cw * 0.75, Math.min(cw * 1.75, room)));
        viewRef.current?.resize(cw, ch);
        setCanvasH(ch + wellPad);
        setCompact(innerW < 600);
        setTheme(themeOf(surf));
        return;
      }
      w = Math.max(220, Math.floor(w));
      const h = Math.floor((w * H) / W);
      viewRef.current?.resize(w, h);
      setCanvasH(h + wellPad);
      setCompact(false);
      setTheme(themeOf(surf));
    };
    fit();
    const ro = new ResizeObserver(() => requestAnimationFrame(fit));
    ro.observe(surf);
    if (box) ro.observe(box);
    // theme switches (light / dark, full screen)
    const mo = new MutationObserver(() => setTheme(themeOf(surf)));
    mo.observe(document.body, { attributes: true, subtree: true, attributeFilter: ["data-gtheme", "class"] });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [viewing, compact]);

  useEffect(() => {
    viewRef.current?.setSong(song, !viewing && tool === "pen" && isKit(inst) ? KIT_ZONES[inst as "drums" | "tabla"] : null, theme);
  }, [song, viewing, tool, inst, theme]);
  useEffect(() => {
    if (viewRef.current) viewRef.current.mirror = mirror && !viewing;
  }, [mirror, viewing]);
  useEffect(() => {
    playerRef.current?.set(notes, playOpts(song, loop));
  }, [notes, song, loop, playOpts]);

  // the bar, and ripples where notes sound
  const notesRef = useRef(notes);
  notesRef.current = notes;
  useEffect(() => {
    if (!playing) {
      if (viewRef.current) viewRef.current.pos = -1;
      setBar(0);
      return;
    }
    let raf = 0;
    let last = -1;
    const tick = () => {
      const p = playerRef.current?.pos() ?? -1;
      const v = viewRef.current;
      if (v) {
        v.pos = p;
        const cur = Math.floor(p);
        if (p >= 0 && cur !== last) {
          for (const n of notesRef.current) if (n.step === cur) v.hit(n.step * COL + COL / 2, n.y, n.inst, n.vel);
          if (cur % 16 === 0 || last < 0) setBar(Math.floor(cur / 16) + 1);
          last = cur;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const togglePlay = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    if (p.playing) {
      p.stop();
      setPlaying(false);
      return;
    }
    p.set(notesRef.current, playOpts(song, loop));
    p.start();
    setPlaying(true);
  }, [song, loop, playOpts]);

  /* ----- drawing ----- */
  const drawing = useRef<{ stroke: Stroke; lane: number; at: number } | null>(null);
  const erasing = useRef(false);
  const laneOf = (y: number) => (isKit(inst) ? drumZone(y) : rowAt(draft.scale, y));
  const labelOf = (lane: number) => {
    if (isKit(inst)) return KIT_ZONES[inst as "drums" | "tabla"][lane];
    return noteName(midiOf(draft.scale, draft.key, lane) + (OCT_SHIFT[inst] ?? 0));
  };
  const audition = (x: number, y: number, force = false) => {
    const d = drawing.current;
    if (!d) return;
    const lane = laneOf(y);
    const now = performance.now();
    if (!force && (lane === d.lane || now - d.at < 70)) return;
    d.lane = lane;
    d.at = now;
    playNote(inst, isKit(inst) ? lane : midiOf(draft.scale, draft.key, lane), [0.45, 0.6, 0.75][size], 0.22, undefined, draft.key);
    viewRef.current?.hit(x, y, inst, 0.4);
  };
  const eraseAt = (x: number, y: number) => {
    const r2 = ERASE_R * ERASE_R;
    const near = (st: Stroke) => {
      for (let k = 0; k + 1 < st.p.length; k += 2) {
        const dx = st.p[k] - x, dy = st.p[k + 1] - y;
        if (dx * dx + dy * dy < r2) return true;
      }
      return false;
    };
    setDraft((d) => {
      if (!d.strokes.some(near)) return d;
      if (!erasing.current) {
        erasing.current = true;
        setHistory((h) => [...h.slice(-49), d.strokes]);
      }
      return { ...d, strokes: d.strokes.filter((s) => !near(s)) };
    });
  };
  const onDown = (e: RPointerEvent<HTMLCanvasElement>) => {
    const v = viewRef.current;
    if (!v || viewing || e.button > 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const { x, y } = v.toCanvas(e.clientX, e.clientY);
    if (tool === "eraser") {
      erasing.current = false;
      v.eraser = { x, y };
      eraseAt(x, y);
      return;
    }
    if (pointCount(draft) >= POINT_LIMIT) {
      flash("The canvas is full: erase something first");
      return;
    }
    const stroke: Stroke = { i: inst, s: size, p: [Math.round(x), Math.round(y)] };
    drawing.current = { stroke, lane: -1, at: 0 };
    v.live = stroke;
    v.hover = null;
    audition(x, y, true);
  };
  const onMove = (e: RPointerEvent<HTMLCanvasElement>) => {
    const v = viewRef.current;
    if (!v || viewing) return;
    const { x, y } = v.toCanvas(e.clientX, e.clientY);
    if (tool === "eraser") {
      v.eraser = { x, y };
      if (e.buttons & 1) eraseAt(x, y);
      return;
    }
    const d = drawing.current;
    if (!d) {
      // the pen's tip, and the note it would play
      if (e.pointerType === "mouse") v.hover = { x, y, inst, size, label: labelOf(laneOf(y)) };
      return;
    }
    const p = d.stroke.p;
    const lx = p[p.length - 2], ly = p[p.length - 1];
    const cx = Math.max(0, Math.min(W, x)), cy = Math.max(0, Math.min(H, y));
    if ((cx - lx) ** 2 + (cy - ly) ** 2 < 25) return;
    if (p.length / 2 + pointCount(draft) >= POINT_LIMIT) return;
    p.push(Math.round(cx), Math.round(cy));
    audition(cx, cy);
  };
  const onUp = () => {
    const v = viewRef.current;
    erasing.current = false;
    const d = drawing.current;
    drawing.current = null;
    if (v) v.live = null;
    if (!d) return;
    setHistory((h) => [...h.slice(-49), draft.strokes]);
    // mirror pen: the same shape again, flipped left ↔ right (a call and its answer)
    const add = mirror ? [d.stroke, { ...d.stroke, p: d.stroke.p.map((v, k) => (k % 2 ? v : W - v)) }] : [d.stroke];
    setDraft((s) => ({ ...s, strokes: [...s.strokes, ...add] }));
  };
  const onLeave = () => {
    const v = viewRef.current;
    if (v) {
      v.eraser = null;
      v.hover = null;
    }
  };

  const undo = useCallback(() => {
    if (!history.length) return;
    const prev = history[history.length - 1];
    setHistory(history.slice(0, -1));
    setDraft((d) => ({ ...d, strokes: prev }));
  }, [history]);
  const clear = () => {
    if (!draft.strokes.length) return;
    setHistory((h) => [...h.slice(-49), draft.strokes]);
    setDraft((d) => ({ ...d, strokes: [] }));
    flash("Cleared · Undo brings it back");
  };
  const surprise = () => {
    setHistory((h) => [...h.slice(-49), draft.strokes]);
    const s = surpriseSong();
    setDraft(s);
    // play it right away
    window.setTimeout(() => {
      const p = playerRef.current;
      if (!p) return;
      p.set(songNotes(s), playOpts(s, loop));
      p.start();
      setPlaying(true);
    }, 50);
  };
  const setOpt = <K extends "bpm" | "scale" | "key" | "beat">(k: K, v: Song[K]) => {
    const lock = k === "scale" ? SCALE_LOCK[v as ScaleId] : k === "beat" ? BEAT_LOCK[v as BeatId] : undefined;
    if (!has(lock)) return askUnlock(lock!, () => setDraft((d) => ({ ...d, [k]: v })));
    setDraft((d) => ({ ...d, [k]: v }));
  };
  const pickInst = (k: Inst) => {
    const lock = INST_LOCK[k];
    const go = () => {
      setTool("pen");
      setInst(k);
      playNote(k, isKit(k) ? 2 : midiOf(draft.scale, draft.key, 7), 0.6, 0.3, undefined, draft.key);
    };
    if (!has(lock)) return askUnlock(lock!, go);
    go();
  };
  const toggleEcho = () => {
    const go = () => setDraft((d) => ({ ...d, fx: d.fx?.echo ? undefined : { echo: true } }));
    if (!has(ECHO_ITEM)) return askUnlock(ECHO_ITEM, go);
    go();
  };
  const toggleMute = (k: Inst) => setMuted((m) => (m.includes(k) ? m.filter((x) => x !== k) : [...m, k]));

  /* ----- unlocking (chips) ----- */
  function askUnlock(item: string, then?: () => void) {
    setUnlock({ item, then });
  }
  const buyUnlock = async () => {
    if (!unlock) return;
    if (!unlock.armed) return setUnlock({ ...unlock, armed: true, error: undefined });
    setUnlock({ ...unlock, busy: true, error: undefined });
    try {
      await shop.buy(unlock.item);
      const t = TUNE_ITEMS[unlock.item];
      unlock.then?.();
      setUnlock(null);
      flash(`${t?.name ?? "Unlocked"} is yours`);
    } catch (e) {
      setUnlock((u) => (u ? { ...u, busy: false, armed: false, error: e instanceof Error ? e.message : "Couldn't unlock it." } : u));
    }
  };
  const hearIt = (item: string) => {
    const inst = (Object.keys(INST_LOCK) as Inst[]).find((k) => INST_LOCK[k] === item);
    const beat = (Object.keys(BEAT_LOCK) as BeatId[]).find((k) => BEAT_LOCK[k] === item);
    if (inst || beat) previewSound({ inst, beat }, draft.key);
    else if (item === "tscale:world") {
      [0, 1, 2, 3, 4, 5, 6, 7].forEach((r, i) => window.setTimeout(() => playNote("piano", midiOf("japanese", draft.key, r + 5), 0.6, 0.3), i * 170));
    } else if (item === ECHO_ITEM) {
      [60, 67, 72].forEach((m, i) => window.setTimeout(() => playNote("bells", m - 12 + draft.key, 0.7, 0.3), i * 160));
    }
  };

  /* ----- save as audio ----- */
  const saveAudio = async () => {
    if (!song.strokes.length) return flash("Draw something first");
    if (exporting) return;
    setExporting(true);
    try {
      const blob = await renderWav(song, notes);
      const name = `${(viewing?.row.title || "draw-a-tune").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.wav`;
      const file = new File([blob], name, { type: "audio/wav" });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.canShare?.({ files: [file] }) && /Android|iPhone|iPad/i.test(navigator.userAgent)) {
        try {
          await navigator.share({ files: [file], title: "Draw a Tune" });
        } catch {
          /* cancelled */
        }
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 4000);
        flash("Saved as a sound file");
      }
    } catch {
      flash("Couldn't save the audio");
    } finally {
      setExporting(false);
    }
  };

  /* ----- keyboard ----- */
  const keyRef = useRef({ togglePlay, undo, pickInst, viewing, posting, gallery });
  keyRef.current = { togglePlay, undo, pickInst, viewing, posting, gallery };
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const k = keyRef.current;
      if (k.posting || k.gallery || document.querySelector(".tn-sound, .tn-unlock, .tn-pensheet, .tn-share")) return;
      if (e.code === "Space") {
        e.preventDefault();
        k.togglePlay();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        if (k.viewing) return;
        e.preventDefault();
        k.undo();
      } else if (!k.viewing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const n = Number(e.key);
        if (n >= 1 && n <= 5) k.pickInst(INST_ORDER[n - 1]);
        else if (e.key.toLowerCase() === "e") setTool("eraser");
        else if (e.key.toLowerCase() === "m") setMirror((v) => !v);
        else if (e.key.toLowerCase() === "l") setLoop((l) => !l);
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  /* ----- gallery ----- */
  useEffect(() => {
    if (!gallery) return;
    let live = true;
    setRows("loading");
    void listSongs(gallery).then((r) => live && setRows(r));
    return () => {
      live = false;
    };
  }, [gallery]);
  const openSong = (row: SongRow) => {
    const s = cleanSong(row.song);
    if (!s) return;
    playerRef.current?.stop();
    setViewing({ row, song: s });
    setGallery(null);
    window.setTimeout(() => {
      const p = playerRef.current;
      if (!p) return;
      p.set(songNotes(s), playOpts(s, true));
      p.start();
      setPlaying(true);
    }, 60);
  };
  const closeViewer = () => {
    playerRef.current?.stop();
    setPlaying(false);
    setViewing(null);
    if (new URLSearchParams(window.location.search).has("song")) {
      const u = new URL(window.location.href);
      u.searchParams.delete("song");
      window.history.replaceState(window.history.state, "", u.pathname + u.search + u.hash);
    }
  };
  const remix = () => {
    if (!viewing) return;
    setHistory((h) => [...h.slice(-49), draft.strokes]);
    setDraft({ ...viewing.song, strokes: viewing.song.strokes.map((s) => ({ ...s, p: [...s.p] })) });
    closeViewer();
    flash("Remixing: it's your copy now");
  };
  const like = async () => {
    if (!viewing) return;
    if (!user) return navigate(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    if (viewing.row.mine || !supabase) return;
    const { data, error } = await supabase.rpc("tune_like", { p_id: viewing.row.id });
    if (error || !data) return flash("Couldn't like it right now");
    const r = data as { liked: boolean; likes: number };
    setViewing((v) => (v ? { ...v, row: { ...v.row, liked: r.liked, likes: r.likes } } : v));
  };
  const shareSong = async (id: string, title: string | null) => {
    const r = await shareLink(`🎵 ${title ? `"${title}"` : "A tune I drew"} · Draw a Tune`, `${SITE}?song=${id}`);
    if (r === "copied") flash("Link copied: paste it anywhere");
    else if (r === "failed") flash("Couldn't share");
  };

  /* ----- posting ----- */
  const post = async () => {
    if (!posting || !supabase) return;
    setPosting({ ...posting, busy: true, error: undefined });
    const { data, error } = await supabase.rpc("tune_post", { p_title: posting.title.trim() || null, p_song: draft });
    if (error || !data) {
      const m = error?.message ?? "";
      const msg = m.includes("too_fast") ? "Wait a few seconds and try again." : m.includes("daily_limit") ? "That's 20 songs today: come back tomorrow." : m.includes("empty") ? "Draw something first." : "Couldn't post it right now.";
      setPosting((p) => (p ? { ...p, busy: false, error: msg } : p));
      return;
    }
    const r = data as { id: string; xp: number; streak: number };
    setStreak(r.streak);
    setPostedId({ id: r.id, title: posting.title.trim() || null });
    void shop.refresh();
    setPosting((p) => (p ? { ...p, busy: false, done: { id: r.id, xp: r.xp } } : p));
  };
  const startPost = () => {
    if (!user) return navigate(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    if (!draft.strokes.length) return flash("Draw something first");
    setPosting({ title: "", busy: false });
  };

  /* ----- sharing: a video clip made right here, plus links ----- */
  const shareLinkUrl = viewing ? `${SITE}?song=${viewing.row.id}` : postedId ? `${SITE}?song=${postedId.id}` : SITE;
  const shareTitle = viewing?.row.title || postedId?.title || null;
  const shareText = `🎵 ${shareTitle ? `"${shareTitle}"` : viewing ? "Listen to this tune" : "I drew this tune"} · Draw a Tune`;
  const openShare = () => {
    if (!song.strokes.length) return flash("Draw something first");
    playerRef.current?.stop();
    setPlaying(false);
    setSharing({ phase: clipSupported() ? "making" : "failed", k: 0, run: Date.now() });
  };
  const closeShare = () => {
    clipAbort.current?.abort();
    clipAbort.current = null;
    if (sharing?.url) URL.revokeObjectURL(sharing.url);
    setSharing(null);
  };
  const run = sharing?.phase === "making" ? sharing.run : 0;
  useEffect(() => {
    if (!run || !clipRef.current) return;
    const ac = new AbortController();
    clipAbort.current = ac;
    makeClip(clipRef.current, song, notes, { title: shareTitle || (viewing ? "Untitled" : prompt), by: viewing ? viewing.row.name : null, prompt: viewing ? null : `Today's prompt: ${prompt}` }, {
      signal: ac.signal,
      audible: true,
      onProgress: (k) => setSharing((sh) => (sh && sh.run === run ? { ...sh, k } : sh)),
    })
      .then(({ blob, ext }) => {
        const name = `${(shareTitle || "draw-a-tune").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.${ext}`;
        const file = new File([blob], name, { type: blob.type });
        setSharing((sh) => (sh && sh.run === run ? { ...sh, phase: "ready", k: 1, file, url: URL.createObjectURL(blob) } : sh));
      })
      .catch((e) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setSharing((sh) => (sh && sh.run === run ? { ...sh, phase: "failed" } : sh));
      });
    return () => ac.abort();
    // the clip is made from the song as it was when Share was pressed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);
  const canShareFile = (f?: File) => {
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    return !!f && !!nav.canShare?.({ files: [f] });
  };
  const shareVideo = async () => {
    if (!sharing?.file) return;
    try {
      await navigator.share({ files: [sharing.file], title: "Draw a Tune", text: `${shareText}\n${shareLinkUrl}` });
    } catch {
      /* cancelled */
    }
  };
  const downloadVideo = () => {
    if (!sharing?.url || !sharing.file) return;
    const a = document.createElement("a");
    a.href = sharing.url;
    a.download = sharing.file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    flash("Video saved");
  };
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${shareText}\n${shareLinkUrl}`);
      flash("Link copied");
    } catch {
      flash("Couldn't copy the link");
    }
  };
  const social = {
    whatsapp: `https://wa.me/?text=${encodeURIComponent(`${shareText}\n${shareLinkUrl}`)}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareLinkUrl)}`,
    x: `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareLinkUrl)}`,
  };

  const empty = !viewing && !draft.strokes.length;
  const tint = viewing ? "#7b5cff" : tool === "eraser" ? "#ff8a3d" : inkOf(inst, theme);
  const bars = STEPS / 16;

  /* ----- pieces ----- */
  const settings = (
    <div className="tn-settings">
      <label className="tn-tempo">
        <span>Tempo</span>
        <input type="range" min={60} max={180} step={5} value={draft.bpm} onChange={(e) => setOpt("bpm", Number(e.target.value))} />
        <b>{draft.bpm}</b>
      </label>
      <label className="tn-select">
        <span>Scale</span>
        <select value={draft.scale} onChange={(e) => setOpt("scale", e.target.value as ScaleId)}>
          {(Object.keys(SCALES) as ScaleId[]).map((k) => (
            <option key={k} value={k}>
              {has(SCALE_LOCK[k]) ? "" : "🔒 "}
              {SCALES[k].name}
            </option>
          ))}
        </select>
      </label>
      <label className="tn-select">
        <span>Key</span>
        <select value={draft.key} onChange={(e) => setOpt("key", Number(e.target.value))}>
          {KEYS.map((k, i) => (
            <option key={k} value={i}>
              {k}
            </option>
          ))}
        </select>
      </label>
      <label className="tn-select">
        <span>Beat</span>
        <select value={draft.beat} onChange={(e) => setOpt("beat", e.target.value as BeatId)}>
          {(Object.keys(BEATS) as BeatId[]).map((k) => (
            <option key={k} value={k}>
              {has(BEAT_LOCK[k]) ? "" : "🔒 "}
              {BEATS[k]}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className={`tn-toggle${draft.fx?.echo ? " is-on" : ""}`} onClick={toggleEcho} aria-pressed={!!draft.fx?.echo}>
        <span>Echo</span>
        {has(ECHO_ITEM) ? <i aria-hidden="true" /> : <Lock size={13} />}
      </button>
      {used.length ? (
        <div className="tn-mixer" aria-label="Mixer: tap to mute">
          {used.map((k) => (
            <button
              key={k}
              type="button"
              className={muted.includes(k) ? "is-muted" : ""}
              style={{ ["--pen" as string]: inkOf(k, theme) } as CSSProperties}
              onClick={() => toggleMute(k)}
              aria-pressed={muted.includes(k)}
              title={muted.includes(k) ? `Unmute ${INSTRUMENTS[k].name}` : `Mute ${INSTRUMENTS[k].name}`}
            >
              {muted.includes(k) ? <VolumeX size={12} /> : <Volume2 size={12} />}
              {INSTRUMENTS[k].name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
  const lockBadge = (item?: string) => (has(item) ? null : <Lock size={11} className="tn-lock" aria-label="Locked" />);
  const extraPens = (
    <div className="tn-extras" role="radiogroup" aria-label="Studio instruments">
      {EXTRA_INST.map((k) => (
        <button
          key={k}
          type="button"
          role="radio"
          aria-checked={tool === "pen" && inst === k}
          className={`tn-pen tn-pen-sm${tool === "pen" && inst === k ? " active" : ""}${has(INST_LOCK[k]) ? "" : " is-locked"}`}
          style={{ ["--pen" as string]: inkOf(k, theme) } as CSSProperties}
          onClick={() => pickInst(k)}
          title={has(INST_LOCK[k]) ? INSTRUMENTS[k].name : `${INSTRUMENTS[k].name} · unlock with chips`}
        >
          <i />
          <span>{INSTRUMENTS[k].name}</span>
          {lockBadge(INST_LOCK[k])}
        </button>
      ))}
    </div>
  );
  const transport = (
    <div className="tn-transport">
      <button type="button" className={`tn-play${playing ? " is-playing" : ""}`} onClick={togglePlay} aria-label={playing ? "Stop (Space)" : "Play (Space)"} title={playing ? "Stop · Space" : "Play · Space"}>
        {playing ? <Square size={18} fill="currentColor" /> : <Play size={22} fill="currentColor" />}
      </button>
      <div className="tn-bars" aria-hidden="true">
        {Array.from({ length: bars }, (_, i) => (
          <i key={i} className={playing && bar === i + 1 ? "on" : ""} />
        ))}
        <small>{playing ? `Bar ${bar} of ${bars}` : `${song.bpm} bpm · ${BEATS[song.beat]}`}</small>
      </div>
      <button type="button" className={`tn-icon${loop ? " is-on" : ""}`} onClick={() => setLoop((l) => !l)} aria-pressed={loop} aria-label="Loop (L)" title="Loop · L">
        <Repeat size={16} />
      </button>
    </div>
  );

  const panel = viewing ? (
    <div className="tn-panel" ref={panelRef} style={wide ? { height: canvasH } : undefined}>
      <div className="tn-card-by">
        <PlayerAvatar id={viewing.row.user_id} name={viewing.row.name} avatar={parseAvatar(viewing.row.avatar)} size={36} className="lb-initial" />
        <span>
          <b>{viewing.row.title || "Untitled"}</b>
          <small>by {viewing.row.mine ? "you" : viewing.row.name}</small>
        </span>
      </div>
      {transport}
      <p className="tn-meta">
        {SCALES[song.scale].name} · {KEYS[song.key]} · {song.bpm} bpm
      </p>
      <div className="tn-row2">
        <button type="button" className={`tn-btn${viewing.row.liked ? " is-liked" : ""}`} onClick={() => void like()} disabled={viewing.row.mine} aria-pressed={viewing.row.liked}>
          <Heart size={15} fill={viewing.row.liked ? "currentColor" : "none"} /> {viewing.row.likes}
        </button>
        <button type="button" className="tn-btn" onClick={openShare}>
          <Share2 size={15} /> Share
        </button>
      </div>
      <button type="button" className="tn-btn tn-btn-main" onClick={remix}>
        <Wand2 size={15} /> Remix it
      </button>

      <button type="button" className="tn-btn" onClick={closeViewer}>
        <ChevronLeft size={16} /> Back to my drawing
      </button>
    </div>
  ) : (
    <div className="tn-panel" ref={panelRef} style={wide ? { height: canvasH } : undefined}>
      {transport}
      <div className="tn-group">
        <span className="tn-label">
          Instrument <em>{tool === "eraser" ? "Eraser: drag over lines" : INST_HINT[inst]}</em>
        </span>
        <div className="tn-pens" role="radiogroup" aria-label="Instrument">
          {INST_ORDER.map((k, n) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={tool === "pen" && inst === k}
              className={`tn-pen${tool === "pen" && inst === k ? " active" : ""}`}
              style={{ ["--pen" as string]: inkOf(k, theme) } as CSSProperties}
              onClick={() => pickInst(k)}
              title={`${INSTRUMENTS[k].name} · ${n + 1}`}
            >
              <i />
              <span>{INSTRUMENTS[k].name}</span>
            </button>
          ))}
          <button type="button" role="radio" aria-checked={tool === "eraser"} className={`tn-pen tn-eraser${tool === "eraser" ? " active" : ""}`} onClick={() => setTool("eraser")} title="Eraser · E">
            <Eraser size={15} />
            <span>Eraser</span>
          </button>
        </div>
        <span className="tn-label">
          Studio <em>Unlock with chips</em>
        </span>
        {extraPens}
      </div>
      <div className="tn-tools">
        <div className="tn-sizes" role="radiogroup" aria-label="Pen size (thicker is louder)">
          {([0, 1, 2] as const).map((s) => (
            <button key={s} type="button" role="radio" aria-checked={size === s} aria-label={["Thin (soft)", "Medium", "Thick (loud)"][s]} title={["Soft", "Medium", "Loud"][s]} className={size === s ? "active" : ""} onClick={() => setSize(s)}>
              <i style={{ width: PEN[s] * 0.9, height: PEN[s] * 0.9, background: inkOf(inst, theme) }} />
            </button>
          ))}
        </div>
        <button type="button" className={`tn-icon${mirror ? " is-on" : ""}`} onClick={() => setMirror((v) => !v)} aria-pressed={mirror} aria-label="Mirror pen (M)" title="Mirror pen · M: draws a flipped copy">
          <FlipHorizontal2 size={16} />
        </button>
        <span className="tn-spacer" />
        <button type="button" className="tn-icon" onClick={undo} disabled={!history.length} aria-label="Undo (Ctrl+Z)" title="Undo · Ctrl+Z">
          <Undo2 size={16} />
        </button>
        <button type="button" className="tn-icon" onClick={clear} disabled={!draft.strokes.length} aria-label="Clear the canvas" title="Clear">
          <Trash2 size={16} />
        </button>
      </div>
      <div className="tn-group">
        <span className="tn-label">Sound</span>
        {settings}
      </div>
      <div className="tn-row2 tn-actions">
        <button type="button" className="tn-btn tn-btn-main" onClick={startPost}>
          <Send size={15} /> Post song
        </button>
        <button type="button" className="tn-btn" onClick={() => setGallery("today")}>
          <Library size={15} /> Listen
        </button>
      </div>
      <div className="tn-row2">
        <button type="button" className="tn-btn" onClick={openShare}>
          <Share2 size={15} /> Share
        </button>
        {gameShop ? (
          <button type="button" className="tn-btn" onClick={gameShop.open}>
            <ShoppingBag size={15} /> Music shop
          </button>
        ) : null}
      </div>
    </div>
  );

  const compactPanel = viewing ? (
    <div className="tn-panel tn-compact" ref={panelRef}>
      <div className="tn-crow tn-crow-by">
        <PlayerAvatar id={viewing.row.user_id} name={viewing.row.name} avatar={parseAvatar(viewing.row.avatar)} size={26} className="lb-initial" />
        <span>
          <b>{viewing.row.title || "Untitled"}</b> <small>by {viewing.row.mine ? "you" : viewing.row.name}</small>
        </span>
      </div>
      <div className="tn-crow">
        <button type="button" className="tn-icon" onClick={closeViewer} aria-label="Back to my drawing">
          <ChevronLeft size={18} />
        </button>
        <button type="button" className={`tn-play tn-play-sm${playing ? " is-playing" : ""}`} onClick={togglePlay} aria-label={playing ? "Stop" : "Play"}>
          {playing ? <Square size={16} fill="currentColor" /> : <Play size={19} fill="currentColor" />}
        </button>
        <button type="button" className={`tn-btn tn-btn-sm${viewing.row.liked ? " is-liked" : ""}`} onClick={() => void like()} disabled={viewing.row.mine} aria-pressed={viewing.row.liked}>
          <Heart size={15} fill={viewing.row.liked ? "currentColor" : "none"} /> {viewing.row.likes}
        </button>
        <button type="button" className="tn-btn tn-btn-sm tn-btn-main" onClick={remix}>
          <Wand2 size={15} /> Remix
        </button>
        <button type="button" className="tn-icon" onClick={openShare} aria-label="Share">
          <Share2 size={16} />
        </button>
      </div>
    </div>
  ) : (
    <div className="tn-panel tn-compact" ref={panelRef}>
      <div className="tn-crow">
        <button type="button" className={`tn-play tn-play-sm${playing ? " is-playing" : ""}`} onClick={togglePlay} aria-label={playing ? "Stop" : "Play"}>
          {playing ? <Square size={16} fill="currentColor" /> : <Play size={19} fill="currentColor" />}
        </button>
        <div className="tn-swatches" role="radiogroup" aria-label="Instrument">
          {INST_ORDER.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={tool === "pen" && inst === k}
              aria-label={INSTRUMENTS[k].name}
              className={`tn-swatch${tool === "pen" && inst === k ? " active" : ""}`}
              style={{ ["--pen" as string]: inkOf(k, theme) } as CSSProperties}
              onClick={() => {
                pickInst(k);
                flash(`${INSTRUMENTS[k].name} · ${INST_HINT[k]}`);
              }}
            >
              <i />
            </button>
          ))}
          <button
            type="button"
            aria-label="More instruments"
            className={`tn-swatch tn-more${tool === "pen" && EXTRA_INST.includes(inst) ? " active" : ""}`}
            style={tool === "pen" && EXTRA_INST.includes(inst) ? ({ ["--pen" as string]: inkOf(inst, theme) } as CSSProperties) : undefined}
            onClick={() => setPensOpen(true)}
          >
            {tool === "pen" && EXTRA_INST.includes(inst) ? <i /> : <Plus size={16} />}
          </button>
          <button type="button" role="radio" aria-checked={tool === "eraser"} aria-label="Eraser" className={`tn-swatch tn-eraser${tool === "eraser" ? " active" : ""}`} onClick={() => setTool("eraser")}>
            <Eraser size={15} />
          </button>
        </div>
      </div>
      <div className="tn-crow">
        <div className="tn-sizes" role="radiogroup" aria-label="Pen size (thicker is louder)">
          {([0, 1, 2] as const).map((sz) => (
            <button key={sz} type="button" role="radio" aria-checked={size === sz} aria-label={["Thin (soft)", "Medium", "Thick (loud)"][sz]} className={size === sz ? "active" : ""} onClick={() => setSize(sz)}>
              <i style={{ width: PEN[sz] * 0.8, height: PEN[sz] * 0.8, background: inkOf(inst, theme) }} />
            </button>
          ))}
        </div>
        <button type="button" className={`tn-icon${mirror ? " is-on" : ""}`} onClick={() => setMirror((v) => !v)} aria-pressed={mirror} aria-label="Mirror pen">
          <FlipHorizontal2 size={16} />
        </button>
        <span className="tn-spacer" />
        <button type="button" className="tn-icon" onClick={undo} disabled={!history.length} aria-label="Undo">
          <Undo2 size={16} />
        </button>
        <button type="button" className="tn-icon" onClick={clear} disabled={!draft.strokes.length} aria-label="Clear the canvas">
          <Trash2 size={16} />
        </button>
        <button type="button" className="tn-icon" onClick={() => setSoundOpen(true)} aria-label="Sound: tempo, scale, key, beat">
          <SlidersHorizontal size={16} />
        </button>
        <button type="button" className="tn-icon tn-icon-main" onClick={startPost} aria-label="Post song">
          <Send size={16} />
        </button>
      </div>
    </div>
  );

  return (
    <div ref={surfRef} className={`tn-surface${wide ? " is-wide" : ""}${playing ? " is-playing" : ""} tn-${theme}`} style={{ ["--tn-tint" as string]: tint } as CSSProperties}>
      <div ref={topRef} className="tn-top">
        <span className="tn-prompt" title="Today's prompt">
          <Sparkles size={14} />
          <span>
            <span className="tn-prompt-lead">Today's prompt</span> <b>{prompt}</b>
          </span>
        </span>
        {!viewing ? (
          <button type="button" className="tn-chip" onClick={surprise} title="Start from a surprise song">
            <Dices size={15} /> Surprise me
          </button>
        ) : null}
        <span className="tn-pill" title="Days in a row with a song posted">
          <Flame size={14} /> {streak}
        </span>
        {user ? <span className="tn-pill">Lv {level}</span> : null}
        <button type="button" className="tn-icon" onClick={() => setGallery("today")} aria-label="Songs gallery" title="Songs">
          <Library size={16} />
        </button>
      </div>

      <div className="tn-main">
        <div ref={wrapRef} className="tn-stage">
          <div className="tn-well">
            <canvas
              ref={cvRef}
              className={viewing ? "" : tool === "eraser" ? "is-erase" : "is-draw"}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              onPointerLeave={onLeave}
              aria-label={viewing ? "A song" : "Drawing canvas: draw with the pen, then press Play"}
            />
            {empty ? (
              <div className="tn-empty">
                <b>Draw anything, then press Play</b>
                <span>Higher lines play higher notes. Every colour is an instrument.</span>
                <button type="button" className="tn-chip" onClick={surprise}>
                  <Dices size={15} /> Or start from a surprise
                </button>
              </div>
            ) : null}
            {note ? <p className="tn-toast">{note}</p> : null}
          </div>
        </div>
        {compact ? compactPanel : panel}
      </div>

      {soundOpen ? (
        <div className="tn-sheet" role="dialog" aria-label="Sound" onClick={() => setSoundOpen(false)}>
          <div className="tn-sheet-card tn-sound" onClick={(e) => e.stopPropagation()}>
            <h3>Sound</h3>
            {settings}
            <div className="tn-row2">
              <button type="button" className={`tn-btn${loop ? " is-on" : ""}`} onClick={() => setLoop((l) => !l)} aria-pressed={loop}>
                <Repeat size={15} /> {loop ? "Loop on" : "Loop off"}
              </button>
              <button
                type="button"
                className="tn-btn"
                onClick={() => {
                  setSoundOpen(false);
                  openShare();
                }}
              >
                <Share2 size={15} /> Share
              </button>
            </div>
            {gameShop ? (
              <button
                type="button"
                className="tn-btn"
                onClick={() => {
                  setSoundOpen(false);
                  gameShop.open();
                }}
              >
                <ShoppingBag size={15} /> Music shop
              </button>
            ) : null}
            <button type="button" className="tn-btn tn-btn-main" onClick={() => setSoundOpen(false)}>
              Done
            </button>
          </div>
        </div>
      ) : null}

      {sharing ? (
        <div className="tn-sheet" role="dialog" aria-label="Share" onClick={() => sharing.phase !== "making" && closeShare()}>
          <div className="tn-sheet-card tn-share" onClick={(e) => e.stopPropagation()}>
            <h3>{sharing.phase === "making" ? "Making your video…" : sharing.phase === "ready" ? "Your video is ready" : "Share your tune"}</h3>
            {sharing.phase === "making" ? (
              <>
                <canvas ref={clipRef} className="tn-clip" width={CLIP_W} height={CLIP_H} aria-label="Recording preview" />
                <span className="tn-clip-bar" aria-label={`${Math.round(sharing.k * 100)}%`}>
                  <i style={{ width: `${sharing.k * 100}%` }} />
                </span>
                <p className="tn-sheet-note">Recording as it plays · keep this open</p>
                <button type="button" className="tn-btn" onClick={closeShare}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                {sharing.phase === "ready" && sharing.url ? <video className="tn-clip" src={`${sharing.url}#t=1.5`} controls playsInline loop preload="metadata" /> : null}
                {sharing.phase === "failed" ? <p className="tn-sheet-note">This browser can't make a video. You can still share the link or save the sound.</p> : null}
                {sharing.phase === "ready" && canShareFile(sharing.file) ? (
                  <button type="button" className="tn-btn tn-btn-main" onClick={() => void shareVideo()}>
                    <Share2 size={15} /> Share video
                  </button>
                ) : null}
                {sharing.phase === "ready" ? (
                  <button type="button" className={`tn-btn${canShareFile(sharing.file) ? "" : " tn-btn-main"}`} onClick={downloadVideo}>
                    <Film size={15} /> Download video
                  </button>
                ) : null}
                <div className="tn-socials">
                  <a className="tn-social is-wa" href={social.whatsapp} target="_blank" rel="noopener noreferrer" aria-label="Share on WhatsApp">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.6-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z" /></svg>
                    WhatsApp
                  </a>
                  <a className="tn-social is-fb" href={social.facebook} target="_blank" rel="noopener noreferrer" aria-label="Share on Facebook">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M13.5 22v-8.2h2.8l.4-3.2h-3.2V8.5c0-.9.3-1.6 1.6-1.6h1.7V4.1a23 23 0 0 0-2.5-.1c-2.5 0-4.2 1.5-4.2 4.3v2.4H7.3v3.2h2.8V22h3.4Z" /></svg>
                    Facebook
                  </a>
                  <a className="tn-social is-x" href={social.x} target="_blank" rel="noopener noreferrer" aria-label="Share on X">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.8 3h3l-6.6 7.6L22 21h-6.1l-4.8-6.3L5.6 21h-3l7.1-8.1L2.2 3h6.2l4.4 5.8L17.8 3Zm-1 16.2h1.7L7.3 4.7H5.5l11.3 14.5Z" /></svg>
                    X
                  </a>
                  <button type="button" className="tn-social" onClick={() => void copyLink()} aria-label="Copy link">
                    <Copy size={18} />
                    Copy link
                  </button>
                </div>
                <p className="tn-sheet-note">
                  {viewing || postedId ? "Links open this song." : "Post your song first to share a link straight to it."}
                  {sharing.phase === "ready" && !canShareFile(sharing.file) ? " For Instagram: download the video, then post it from your phone." : ""}
                </p>
                <button type="button" className="tn-btn" onClick={() => void saveAudio()} disabled={exporting}>
                  <Download size={15} /> {exporting ? "Saving…" : "Save the sound only"}
                </button>
                <button type="button" className="tn-btn" onClick={closeShare}>
                  Done
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}

      {pensOpen ? (
        <div className="tn-sheet" role="dialog" aria-label="Instruments" onClick={() => setPensOpen(false)}>
          <div className="tn-sheet-card tn-pensheet" onClick={(e) => e.stopPropagation()}>
            <h3>Instruments</h3>
            <div className="tn-penlist">
              {[...INST_ORDER, ...EXTRA_INST].map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`tn-pen${tool === "pen" && inst === k ? " active" : ""}${has(INST_LOCK[k]) ? "" : " is-locked"}`}
                  style={{ ["--pen" as string]: inkOf(k, theme) } as CSSProperties}
                  onClick={() => {
                    setPensOpen(false);
                    pickInst(k);
                  }}
                >
                  <i />
                  <span>
                    {INSTRUMENTS[k].name}
                    <small>{INST_HINT[k]}</small>
                  </span>
                  {lockBadge(INST_LOCK[k])}
                </button>
              ))}
            </div>
            <button type="button" className="tn-btn" onClick={() => setPensOpen(false)}>
              Close
            </button>
          </div>
        </div>
      ) : null}

      {unlock ? (
        <div className="tn-sheet" role="dialog" aria-label="Unlock" onClick={() => !unlock.busy && setUnlock(null)}>
          <div className="tn-sheet-card tn-unlock" onClick={(e) => e.stopPropagation()}>
            {(() => {
              const t = TUNE_ITEMS[unlock.item];
              const price = shop.priceOf(unlock.item);
              const balance = wallet?.unlimited ? Infinity : wallet?.balance ?? 0;
              const canHear = t && (t.group !== "studio" || unlock.item === "tscale:world" || unlock.item === ECHO_ITEM);
              return (
                <>
                  <span className="tn-unlock-icon" style={{ ["--pen" as string]: t?.color ?? "#ff8a3d" } as CSSProperties} aria-hidden="true">
                    {t?.icon ?? "🔒"}
                  </span>
                  <h3>{t?.name ?? "Locked"}</h3>
                  <p className="tn-sheet-note">{t?.blurb}</p>
                  {canHear ? (
                    <button type="button" className="tn-btn" onClick={() => hearIt(unlock.item)}>
                      <Volume2 size={15} /> Hear it
                    </button>
                  ) : null}
                  {!shop.available || price === null ? (
                    <p className="tn-sheet-note">The Music shop isn't open yet.</p>
                  ) : !user ? (
                    <Link className="tn-btn tn-btn-main" to={`/login?next=${encodeURIComponent(window.location.pathname)}`}>
                      Sign in to unlock
                    </Link>
                  ) : balance < price ? (
                    <>
                      <p className="tn-sheet-note">
                        Costs <TokenIcon size={13} /> {formatTokens(price)} · you have {formatTokens(wallet?.balance ?? 0)}
                      </p>
                      <Link className="tn-btn tn-btn-main" to="/chips#buy">
                        Get chips
                      </Link>
                    </>
                  ) : (
                    <button type="button" className={`tn-btn tn-btn-main${unlock.armed ? " is-armed" : ""}`} onClick={() => void buyUnlock()} disabled={unlock.busy}>
                      {unlock.busy ? (
                        "Unlocking…"
                      ) : unlock.armed ? (
                        <>
                          <Check size={15} /> Confirm · <TokenIcon size={14} /> {formatTokens(price)}
                        </>
                      ) : (
                        <>
                          Unlock for <TokenIcon size={14} /> {formatTokens(price)}
                        </>
                      )}
                    </button>
                  )}
                  {unlock.error ? <p className="tn-sheet-note tn-err">{unlock.error}</p> : null}
                  {gameShop ? (
                    <button
                      type="button"
                      className="tn-btn"
                      onClick={() => {
                        setUnlock(null);
                        gameShop.open();
                      }}
                    >
                      <ShoppingBag size={15} /> See the Music shop
                    </button>
                  ) : null}
                  <button type="button" className="tn-btn" onClick={() => setUnlock(null)} disabled={unlock.busy}>
                    Not now
                  </button>
                </>
              );
            })()}
          </div>
        </div>
      ) : null}

      {gallery ? (
        <div className="tn-sheet" role="dialog" aria-label="Songs" onClick={() => setGallery(null)}>
          <div className="tn-sheet-card tn-gallery" onClick={(e) => e.stopPropagation()}>
            <h3>Songs</h3>
            <div className="tn-tabs" role="tablist">
              {(["today", "best", "mine"] as Tab[]).map((t) => (
                <button key={t} type="button" role="tab" aria-selected={gallery === t} className={gallery === t ? "active" : ""} onClick={() => setGallery(t)}>
                  {t === "today" ? "Today" : t === "best" ? "Most liked" : "Mine"}
                </button>
              ))}
            </div>
            {gallery === "today" ? <p className="tn-sheet-note">Today's prompt: {prompt}</p> : null}
            {rows === "loading" ? (
              <p className="tn-sheet-note">Loading…</p>
            ) : !rows ? (
              <p className="tn-sheet-note">The gallery isn't available right now.</p>
            ) : gallery === "mine" && !user ? (
              <p className="tn-sheet-note">Sign in to post songs and see them here.</p>
            ) : !rows.length ? (
              <p className="tn-sheet-note">{gallery === "mine" ? "You haven't posted a song yet." : "No songs yet today. Post the first one."}</p>
            ) : (
              <div className="tn-grid">
                {rows.map((r) => {
                  const s = cleanSong(r.song);
                  if (!s) return null;
                  return (
                    <button key={r.id} type="button" className="tn-card" onClick={() => openSong(r)}>
                      <span className="tn-thumb-well">
                        <Thumb song={s} theme={theme} />
                        <span className="tn-thumb-play">
                          <Play size={14} fill="currentColor" />
                        </span>
                      </span>
                      <span className="tn-card-title">{r.title || "Untitled"}</span>
                      <span className="tn-card-sub">
                        <span>{r.mine ? "You" : r.name}</span>
                        <span>
                          <Heart size={11} fill={r.liked ? "currentColor" : "none"} /> {r.likes}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            <button type="button" className="tn-btn" onClick={() => setGallery(null)}>
              Close
            </button>
          </div>
        </div>
      ) : null}

      {posting ? (
        <div className="tn-sheet" role="dialog" aria-label="Post your song" onClick={() => !posting.busy && setPosting(null)}>
          <div className="tn-sheet-card" onClick={(e) => e.stopPropagation()}>
            {posting.done ? (
              <>
                <h3>Posted</h3>
                <p className="tn-sheet-note">
                  It's in today's songs{posting.done.xp ? ` · +${posting.done.xp} XP` : ""}. Share a video of it on WhatsApp, Instagram or Facebook.
                </p>
                <button
                  type="button"
                  className="tn-btn tn-btn-main"
                  onClick={() => {
                    setPosting(null);
                    openShare();
                  }}
                >
                  <Share2 size={15} /> Share it
                </button>
                <button
                  type="button"
                  className="tn-btn"
                  onClick={() => {
                    setPosting(null);
                    setGallery("today");
                  }}
                >
                  See today's songs
                </button>
                <button type="button" className="tn-btn" onClick={() => setPosting(null)}>
                  Keep drawing
                </button>
              </>
            ) : (
              <>
                <h3>Post your song</h3>
                <p className="tn-sheet-note">Today's prompt: {prompt}</p>
                <input
                  className="tn-input"
                  value={posting.title}
                  maxLength={32}
                  placeholder="Name it (optional)"
                  onChange={(e) => setPosting({ ...posting, title: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && void post()}
                  autoFocus
                />
                {posting.error ? <p className="tn-sheet-note tn-err">{posting.error}</p> : null}
                <button type="button" className="tn-btn tn-btn-main" onClick={() => void post()} disabled={posting.busy}>
                  <Send size={15} /> {posting.busy ? "Posting…" : "Post"}
                </button>
                <button type="button" className="tn-btn" onClick={() => setPosting(null)} disabled={posting.busy}>
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
