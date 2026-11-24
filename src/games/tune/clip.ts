/* Draw a Tune: a shareable video clip, made on the player's own device (nothing is uploaded).
   A vertical 720×1280 video (Stories / Reels / WhatsApp status shape): the drawing with the glowing
   play bar sweeping across it, notes rippling as they sound, the song's own music, the title and a
   small "Draw a Tune" badge. The browser records the canvas and the audio in real time
   (MediaRecorder): MP4 where the browser can, otherwise WebM. */
import { COL, H, INSTRUMENTS, STEPS, W, type NoteEv, type Song } from "./music";
import { startRecordingAudio } from "./synth";
import { drawGuides, drawStroke } from "./render";

export const CLIP_W = 720;
export const CLIP_H = 1280;
const AREA = { x: 40, y: 260, w: 640, h: 800 };
const LEAD = 0.6; // seconds of title card before the music starts
const TAIL = 1.4; // let the last notes ring

/** can this browser record a clip at all? */
export function clipSupported() {
  return typeof MediaRecorder !== "undefined" && typeof HTMLCanvasElement !== "undefined" && "captureStream" in HTMLCanvasElement.prototype;
}

function pickType() {
  const types = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4;codecs=avc1,mp4a", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

function rgba(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function rounded(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

/** fit a line of text to a width by shrinking the font */
function fitText(g: CanvasRenderingContext2D, text: string, maxW: number, size: number, weight = 800) {
  let s = size;
  do {
    g.font = `${weight} ${s}px Poppins, system-ui, sans-serif`;
    if (g.measureText(text).width <= maxW) break;
    s -= 2;
  } while (s > 18);
  return text;
}

export type ClipInfo = { title: string; by?: string | null; prompt?: string | null };

/**
 * Record the clip into `cv` (shown to the player as a live preview while it records).
 * Resolves with the video file; rejects on cancel (signal) or if recording isn't possible.
 */
export function makeClip(cv: HTMLCanvasElement, song: Song, notes: NoteEv[], info: ClipInfo, opts: { signal: AbortSignal; onProgress: (k: number) => void; audible: boolean }): Promise<{ blob: Blob; ext: "mp4" | "webm" }> {
  return new Promise((resolve, reject) => {
    if (!clipSupported()) return reject(new Error("unsupported"));
    cv.width = CLIP_W;
    cv.height = CLIP_H;
    const g = cv.getContext("2d");
    const audio = startRecordingAudio(song, notes, { lead: LEAD, audible: opts.audible });
    if (!g || !audio) return reject(new Error("unsupported"));

    const type = pickType();
    const video = cv.captureStream(30);
    const stream = new MediaStream([...video.getVideoTracks(), ...audio.stream.getAudioTracks()]);
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), videoBitsPerSecond: 4_000_000, audioBitsPerSecond: 160_000 });
    } catch {
      audio.stop();
      return reject(new Error("unsupported"));
    }
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    let cancelled = false;
    rec.onstop = () => {
      video.getTracks().forEach((t) => t.stop());
      audio.stop();
      if (cancelled) return reject(new DOMException("cancelled", "AbortError"));
      const mime = rec.mimeType || type || "video/webm";
      resolve({ blob: new Blob(chunks, { type: mime.split(";")[0] }), ext: mime.includes("mp4") ? "mp4" : "webm" });
    };

    const sx = AREA.w / W;
    const sy = AREA.h / H;
    const m = { sx, sy };
    const s = Math.sqrt(sx * sy);
    const used = [...new Set(song.strokes.map((st) => st.i))];
    const tints = (used.length ? used : (["piano"] as const)).map((i) => INSTRUMENTS[i].color);
    const ripples: { x: number; y: number; col: string; t: number; v: number }[] = [];
    const songLen = STEPS * audio.stepDur;
    const end = audio.t0 + songLen + TAIL;
    let last = -1;
    let raf = 0;

    // the still parts (background, title, badge, drawing) are painted once
    const base = document.createElement("canvas");
    base.width = CLIP_W;
    base.height = CLIP_H;
    const bg = base.getContext("2d")!;
    {
      const grad = bg.createLinearGradient(0, 0, 0, CLIP_H);
      grad.addColorStop(0, "#141a2e");
      grad.addColorStop(1, "#07080f");
      bg.fillStyle = grad;
      bg.fillRect(0, 0, CLIP_W, CLIP_H);
      tints.slice(0, 3).forEach((c, i) => {
        const x = [120, 620, 360][i];
        const y = [220, 520, 1120][i];
        const r = bg.createRadialGradient(x, y, 0, x, y, 520);
        r.addColorStop(0, rgba(c, 0.22));
        r.addColorStop(1, rgba(c, 0));
        bg.fillStyle = r;
        bg.fillRect(0, 0, CLIP_W, CLIP_H);
      });
      // badge
      bg.font = "800 24px Poppins, system-ui, sans-serif";
      const label = "🎵  Draw a Tune";
      const bw = bg.measureText(label).width + 40;
      rounded(bg, (CLIP_W - bw) / 2, 52, bw, 48, 24);
      bg.fillStyle = "rgba(255,255,255,0.1)";
      bg.fill();
      bg.fillStyle = "#ffffff";
      bg.textAlign = "center";
      bg.textBaseline = "middle";
      bg.fillText(label, CLIP_W / 2, 77);
      // title + by
      const title = info.title || "My tune";
      fitText(bg, title, CLIP_W - 80, 52);
      bg.fillStyle = "#ffffff";
      bg.fillText(title, CLIP_W / 2, 160);
      const sub = [info.by ? `by ${info.by}` : null, info.prompt ? `“${info.prompt}”` : null].filter(Boolean).join("  ·  ");
      if (sub) {
        fitText(bg, sub, CLIP_W - 80, 26, 600);
        bg.fillStyle = "rgba(255,255,255,0.65)";
        bg.fillText(sub, CLIP_W / 2, 212);
      }
      // the drawing in its well
      rounded(bg, AREA.x - 10, AREA.y - 10, AREA.w + 20, AREA.h + 20, 28);
      bg.fillStyle = "rgba(0,0,0,0.35)";
      bg.fill();
      bg.save();
      rounded(bg, AREA.x, AREA.y, AREA.w, AREA.h, 20);
      bg.clip();
      const wg = bg.createLinearGradient(0, AREA.y, 0, AREA.y + AREA.h);
      wg.addColorStop(0, "#161b2b");
      wg.addColorStop(1, "#0c0f19");
      bg.fillStyle = wg;
      bg.fillRect(AREA.x, AREA.y, AREA.w, AREA.h);
      bg.translate(AREA.x, AREA.y);
      drawGuides(bg, song, m, { theme: "dark", labels: false, drums: null });
      for (const st of song.strokes) drawStroke(bg, st, "dark", m);
      bg.restore();
      // footer
      bg.textAlign = "center";
      bg.font = "700 26px Poppins, system-ui, sans-serif";
      bg.fillStyle = "rgba(255,255,255,0.85)";
      bg.fillText("Draw yours, hear it play", CLIP_W / 2, 1150);
      bg.font = "800 28px Poppins, system-ui, sans-serif";
      bg.fillStyle = "#ff9d52";
      bg.fillText("games.senevon.in", CLIP_W / 2, 1192);
    }

    const frame = () => {
      const now = audio.now();
      const pos = (now - audio.t0) / audio.stepDur;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 1;
      g.drawImage(base, 0, 0);
      // fade in from black
      const intro = Math.min(1, Math.max(0, (now - (audio.t0 - LEAD)) / 0.35));
      const t = performance.now();
      if (pos >= 0 && pos < STEPS) {
        const cur = Math.floor(pos);
        if (cur !== last) {
          for (const n of notes) if (n.step === cur) ripples.push({ x: (n.step * COL + COL / 2) * sx, y: n.y * sy, col: INSTRUMENTS[n.inst].color, t, v: n.vel });
          last = cur;
        }
      }
      g.save();
      g.beginPath();
      g.roundRect(AREA.x, AREA.y, AREA.w, AREA.h, 20);
      g.clip();
      g.translate(AREA.x, AREA.y);
      // blooms
      g.globalCompositeOperation = "lighter";
      for (let i = ripples.length - 1; i >= 0; i--) {
        const r = ripples[i];
        const k = (t - r.t) / 1400;
        if (k >= 1) {
          ripples.splice(i, 1);
          continue;
        }
        const rad = (120 + 160 * r.v + k * 80) * s;
        const glow = g.createRadialGradient(r.x, r.y, 0, r.x, r.y, rad);
        glow.addColorStop(0, rgba(r.col, (1 - k) * (1 - k) * 0.16));
        glow.addColorStop(1, rgba(r.col, 0));
        g.fillStyle = glow;
        g.fillRect(r.x - rad, r.y - rad, rad * 2, rad * 2);
      }
      if (pos >= 0 && pos < STEPS) {
        const x = pos * COL * sx;
        const cw = COL * sx;
        g.save();
        g.beginPath();
        g.rect(x - cw * 1.2, 0, cw * 1.6, AREA.h);
        g.clip();
        for (const st of song.strokes) drawStroke(g, st, "dark", m, 0.9);
        g.restore();
        g.globalCompositeOperation = "source-over";
        const tail = g.createLinearGradient(x - 60, 0, x + 4, 0);
        tail.addColorStop(0, "rgba(255,240,220,0)");
        tail.addColorStop(1, "rgba(255,240,220,0.18)");
        g.fillStyle = tail;
        g.fillRect(x - 60, 0, 64, AREA.h);
        g.fillStyle = "rgba(255,246,232,0.95)";
        g.shadowColor = "rgba(255,200,140,0.9)";
        g.shadowBlur = 14;
        g.fillRect(x - 1.5, 0, 3, AREA.h);
        g.shadowBlur = 0;
        g.globalCompositeOperation = "lighter";
      }
      for (const r of ripples) {
        const k = (t - r.t) / 700;
        if (k >= 1) continue;
        g.strokeStyle = rgba(r.col, (1 - k) * 0.8);
        g.lineWidth = 2.5 * (1 - k) + 1;
        g.beginPath();
        g.arc(r.x, r.y, (10 + k * (28 + 30 * r.v)) * s * 1.4, 0, Math.PI * 2);
        g.stroke();
      }
      g.restore();
      // progress line under the drawing
      const k = Math.max(0, Math.min(1, pos / STEPS));
      g.fillStyle = "rgba(255,255,255,0.12)";
      g.fillRect(AREA.x, AREA.y + AREA.h + 26, AREA.w, 4);
      g.fillStyle = "#ff8a3d";
      g.fillRect(AREA.x, AREA.y + AREA.h + 26, AREA.w * k, 4);
      if (intro < 1) {
        g.fillStyle = `rgba(0,0,0,${1 - intro})`;
        g.fillRect(0, 0, CLIP_W, CLIP_H);
      }
      opts.onProgress(Math.max(0, Math.min(1, (now - (audio.t0 - LEAD)) / (end - (audio.t0 - LEAD)))));
      if (now >= end) {
        if (rec.state === "recording") rec.stop();
        return;
      }
      raf = requestAnimationFrame(frame);
    };

    opts.signal.addEventListener("abort", () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      if (rec.state === "recording") rec.stop();
      else audio.stop();
    });
    rec.start(500);
    frame();
  });
}
