/* Spacefall: an endless vertical space shooter. React only runs the screens and the touch
   buttons; the game itself (world.ts) and its drawing (draw.ts) run in one requestAnimationFrame
   loop that never re-renders React. The score goes to the leaderboard through onFinish. */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Bomb, Maximize2, Minimize2, Pause, Play, Rocket, RotateCcw, Volume2, VolumeX, Zap } from "lucide-react";
import type { GameProps } from "../index";
import { H, STAGES, W } from "./config";
import { World, type Stats } from "./world";
import { drawShipPreview, drawWorld } from "./draw";
import { warmArt } from "./art";
import { engineHum, isMuted, setMuted, sfx, suspendAudio, uiClick, unlockAudio } from "./audio";
import { preloadLooks, setLooks } from "./images";
import { useShop } from "../../lib/shop";
import { GameShopButton } from "../gameShop";
import { capDpr, isLite } from "../../lib/perf";
import "./spacefall.css";

type Phase = "ready" | "playing" | "paused" | "over";
type Best = { score: number; distance: number; level: number; kills: number; bosses: number; time: number };

const BEST_KEY = "senevon:spacefall:best";
function readBest(): Best | null {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    return raw ? (JSON.parse(raw) as Best) : null;
  } catch {
    return null;
  }
}
function saveBest(s: Stats): { best: Best; isNew: boolean } {
  const prev = readBest();
  const best: Best = {
    score: Math.max(prev?.score ?? 0, s.score),
    distance: Math.max(prev?.distance ?? 0, s.distance),
    level: Math.max(prev?.level ?? 0, s.level),
    kills: Math.max(prev?.kills ?? 0, s.kills),
    bosses: Math.max(prev?.bosses ?? 0, s.bosses),
    time: Math.max(prev?.time ?? 0, s.time),
  };
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(best));
  } catch {
    /* private mode */
  }
  return { best, isNew: !prev || s.score > prev.score };
}

const fmtTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

export default function SpacefallGame({ onFinish }: GameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<Phase>("ready");
  const phaseRef = useRef<Phase>("ready");
  phaseRef.current = phase;
  const [ready, setReady] = useState(false);
  const [muted, setMutedState] = useState(isMuted);
  const [result, setResult] = useState<{ stats: Stats; best: Best; isNew: boolean } | null>(null);
  const [best, setBest] = useState<Best | null>(readBest);
  const lite = useRef(isLite()).current;
  const world = useRef<World>(null as unknown as World);
  if (!world.current) world.current = new World(lite, sfx);
  // touch buttons, updated straight from the loop (a few times a second)
  const missileBtn = useRef<HTMLButtonElement>(null);
  const bombBtn = useRef<HTMLButtonElement>(null);
  const specialBtn = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // the ship line and sky bought in the shop (looks only)
  const shop = useShop();
  const shipId = shop.equippedIn("sf_ship");
  const skyId = shop.equippedIn("sf_sky");
  useEffect(() => {
    setLooks(shipId, skyId);
    preloadLooks();
  }, [shipId, skyId]);

  /* ----- phones: the run goes full screen ----- */
  const [full, setFull] = useState(false);
  const isPhone = () => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches && Math.min(window.innerWidth, window.innerHeight) < 820;
  // ancestors with a transform / filter / containment trap a fixed layer inside them: while the
  // run is full screen they're switched off (and put back after)
  const unclipped = useRef<{ el: HTMLElement; css: string }[]>([]);
  const unclip = (on: boolean) => {
    if (!on) {
      for (const u of [...unclipped.current].reverse()) u.el.style.cssText = u.css;
      unclipped.current = [];
      return;
    }
    for (let el = rootRef.current?.parentElement; el && el !== document.body; el = el.parentElement) {
      const cs = getComputedStyle(el);
      // a positioned ancestor is its own stacking layer: lift it above the site's header
      if (cs.position !== "static") {
        unclipped.current.push({ el, css: el.style.cssText });
        el.style.zIndex = "2147483000";
      }
      if (cs.transform !== "none" || cs.filter !== "none" || cs.perspective !== "none" || /paint|layout|strict|content/.test(cs.contain) || /transform|filter/.test(cs.willChange) || cs.backdropFilter !== "none") {
        unclipped.current.push({ el, css: el.style.cssText });
        el.style.transform = "none";
        el.style.filter = "none";
        el.style.perspective = "none";
        el.style.contain = "none";
        el.style.willChange = "auto";
        el.style.backdropFilter = "none";
      }
    }
  };
  const enterFull = useCallback(() => {
    setFull(true);
    unclip(true);
    document.documentElement.classList.add("sf-full-on");
    const el = rootRef.current;
    // real fullscreen where the browser allows it (Android); the fixed layer covers the rest
    if (el && el.requestFullscreen && !document.fullscreenElement) {
      void el
        .requestFullscreen({ navigationUI: "hide" })
        .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })?.lock?.("portrait").catch(() => {}))
        .catch(() => {});
    }
  }, []);
  const exitFull = useCallback(() => {
    setFull(false);
    unclip(false);
    document.documentElement.classList.remove("sf-full-on");
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }, []);
  useEffect(() => {
    // the system back gesture / Esc leaves real fullscreen: drop the layer too
    const sync = () => {
      // left real fullscreen (back gesture / Esc): the fixed layer stays unless it was never needed
      if (!document.fullscreenElement && !isPhone()) {
        setFull(false);
        unclip(false);
        document.documentElement.classList.remove("sf-full-on");
      }
    };
    document.addEventListener("fullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      unclip(false);
      document.documentElement.classList.remove("sf-full-on");
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, []);

  // paint all sprites once, behind the start screen
  useEffect(() => {
    const id = window.setTimeout(() => {
      warmArt();
      setReady(true);
    }, 30);
    return () => window.clearTimeout(id);
  }, []);

  /* ----- the loop ----- */
  useEffect(() => {
    const canvas = canvasRef.current!;
    const g = canvas.getContext("2d", { alpha: false })!;
    let dpr = 0;
    const fit = () => {
      const d = capDpr(lite ? 1.5 : 2);
      if (d === dpr && canvas.width) return;
      dpr = d;
      canvas.width = Math.round(W * d);
      canvas.height = Math.round(H * d);
    };
    fit();
    let raf = 0;
    let lastT = performance.now();
    let hudT = 0;
    const btnState = { m: -1, b: -1, s: -1, sp: -1 };
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;
      const w = world.current;
      const ph = phaseRef.current;
      if (ph === "playing") {
        // big frames are split so fast things can't skip through each other
        const steps = dt > 1 / 50 ? 2 : 1;
        for (let i = 0; i < steps; i++) w.update(dt / steps);
        if (w.over) {
          endRunRef.current();
          return;
        }
      } else if (ph === "ready") {
        w.scroll += 60 * dt;
        w.t += dt;
      } else if (ph === "over") {
        return;
      }
      if (ph === "paused") return;
      fit();
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawWorld(g, w, lite, ph === "playing");
      // touch buttons: ammo counts and the special's cooldown
      hudT -= dt;
      if (hudT <= 0 && ph === "playing") {
        hudT = 0.1;
        const spFrac = w.special / w.specialMax;
        const sp = Math.round(spFrac * 40);
        if (btnState.m !== w.missiles && missileBtn.current) {
          btnState.m = w.missiles;
          missileBtn.current.dataset.count = String(w.missiles);
          missileBtn.current.classList.toggle("is-empty", w.missiles <= 0);
        }
        if (btnState.b !== w.bombs && bombBtn.current) {
          btnState.b = w.bombs;
          bombBtn.current.dataset.count = String(w.bombs);
          bombBtn.current.classList.toggle("is-empty", w.bombs <= 0);
        }
        if (btnState.sp !== sp && specialBtn.current) {
          btnState.sp = sp;
          specialBtn.current.style.setProperty("--cd", String(spFrac));
          specialBtn.current.classList.toggle("is-ready", spFrac <= 0);
        }
        const st = STAGES[w.stage].special;
        if (btnState.s !== st && specialBtn.current) {
          btnState.s = st;
          specialBtn.current.dataset.label = st === 0 ? "Blast" : st === 1 ? "Laser" : "Mega";
        }
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ----- the start screen's ship: cycles through the six evolutions ----- */
  useEffect(() => {
    if (phase !== "ready" || !ready) return;
    const c = previewRef.current;
    if (!c) return;
    const d = capDpr(2);
    c.width = 160 * d;
    c.height = 160 * d;
    const g = c.getContext("2d")!;
    let raf = 0;
    const t0 = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      // (a frame's timestamp can be a hair older than t0)
      const t = Math.max(0, now - t0) / 1000;
      g.setTransform(d, 0, 0, d, 0, 0);
      drawShipPreview(g, Math.floor(t / 1.6) % STAGES.length, 160, 160, t);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [phase, ready]);

  const endRun = useCallback(() => {
    const w = world.current;
    const stats = w.stats();
    const saved = saveBest(stats);
    setBest(saved.best);
    setResult({ stats, best: saved.best, isNew: saved.isNew });
    setPhase("over");
    sfx.beam(false);
    engineHum(false);
    onFinish(stats.score);
  }, [onFinish]);
  const endRunRef = useRef(endRun);
  endRunRef.current = endRun;

  function start() {
    if (!ready) return;
    unlockAudio();
    uiClick();
    if (isPhone()) enterFull();
    world.current = new World(lite, sfx);
    // dev only: lets automated checks drive the game (jump levels, call a boss)
    if (import.meta.env.DEV) (window as unknown as { __spacefall: World }).__spacefall = world.current;
    setResult(null);
    setPhase("playing");
    // the engine hum (its file may still be loading on the very first run)
    window.setTimeout(() => phaseRef.current === "playing" && engineHum(true), 400);
    window.setTimeout(() => phaseRef.current === "playing" && engineHum(true), 2500);
  }

  const pause = useCallback((on: boolean) => {
    if (on && phaseRef.current === "playing") {
      setPhase("paused");
      suspendAudio(true);
    } else if (!on && phaseRef.current === "paused") {
      setPhase("playing");
      suspendAudio(false);
      uiClick();
    }
  }, []);

  function toggleSound() {
    setMuted(!muted);
    setMutedState(!muted);
    if (muted) {
      uiClick();
      if (phaseRef.current === "playing") engineHum(true);
    }
  }

  /* ----- keyboard ----- */
  useEffect(() => {
    const keys = new Set<string>();
    const sync = () => {
      const w = world.current;
      w.input.x = (keys.has("right") ? 1 : 0) - (keys.has("left") ? 1 : 0);
      w.input.y = (keys.has("down") ? 1 : 0) - (keys.has("up") ? 1 : 0);
    };
    const dir = (k: string) =>
      k === "ArrowLeft" || k === "a" || k === "A" ? "left" : k === "ArrowRight" || k === "d" || k === "D" ? "right" : k === "ArrowUp" || k === "w" || k === "W" ? "up" : k === "ArrowDown" || k === "s" || k === "S" ? "down" : null;
    const down = (e: KeyboardEvent) => {
      const ph = phaseRef.current;
      if ((e.key === "p" || e.key === "P" || e.key === "Escape") && (ph === "playing" || ph === "paused")) {
        e.preventDefault();
        pause(ph === "playing");
        return;
      }
      if (ph !== "playing") return;
      const d = dir(e.key);
      if (d) {
        keys.add(d);
        sync();
        e.preventDefault();
        return;
      }
      if (e.repeat) return;
      if (e.key === " ") {
        world.current.press("special");
        e.preventDefault();
      } else if (e.key === "q" || e.key === "Q" || e.key === "j" || e.key === "J") world.current.press("missile");
      else if (e.key === "e" || e.key === "E" || e.key === "k" || e.key === "K") world.current.press("bomb");
      else if (e.key === "m" || e.key === "M") {
        setMuted(!isMuted());
        setMutedState(isMuted());
      }
    };
    const up = (e: KeyboardEvent) => {
      const d = dir(e.key);
      if (d) {
        keys.delete(d);
        sync();
      }
    };
    const blur = () => {
      keys.clear();
      sync();
      pause(true);
    };
    const vis = () => {
      if (document.hidden) blur();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", vis);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", vis);
      sfx.beam(false);
      engineHum(false);
    };
  }, [pause]);

  /* ----- pointer: drag anywhere to fly (relative, so your finger never hides the ship) ----- */
  const drag = useRef<{ id: number; sx: number; sy: number; px: number; py: number } | null>(null);
  const toWorld = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  function onDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (phaseRef.current !== "playing") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toWorld(e);
    const w = world.current;
    drag.current = { id: e.pointerId, sx: p.x, sy: p.y, px: w.px, py: w.py };
    w.input.drag = true;
    w.input.tx = w.px;
    w.input.ty = w.py;
  }
  function onMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const p = toWorld(e);
    const w = world.current;
    const k = e.pointerType === "mouse" ? 1 : 1.35;
    w.input.tx = Math.max(24, Math.min(W - 24, d.px + (p.x - d.sx) * k));
    w.input.ty = Math.max(110, Math.min(H - 46, d.py + (p.y - d.sy) * k));
    // keep the anchor inside the field so reversing direction responds at once
    if (w.input.tx === 24 || w.input.tx === W - 24) {
      d.px = w.input.tx;
      d.sx = p.x;
    }
    if (w.input.ty === 110 || w.input.ty === H - 46) {
      d.py = w.input.ty;
      d.sy = p.y;
    }
  }
  function onUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (drag.current?.id !== e.pointerId) return;
    drag.current = null;
    world.current.input.drag = false;
  }

  const press = (what: "missile" | "bomb" | "special") => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (phaseRef.current === "playing") world.current.press(what);
  };

  const r = result?.stats;
  return (
    <div ref={rootRef} className={`game-surface sf-surface${full ? " is-full" : ""}`}>
      <div className="sf-stage">
        <canvas
          ref={canvasRef}
          className="sf-canvas"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onContextMenu={(e) => e.preventDefault()}
          aria-label="Spacefall game field"
        />

        {phase === "playing" || phase === "paused" ? (
          <>
            <div className="sf-top-btns">
              <button type="button" className="sf-icon" onClick={() => pause(phase === "playing")} aria-label={phase === "paused" ? "Resume" : "Pause"}>
                {phase === "paused" ? <Play size={16} /> : <Pause size={16} />}
              </button>
              <button type="button" className="sf-icon" onClick={toggleSound} aria-label={muted ? "Sound on" : "Sound off"}>
                {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </button>
              {full ? (
                <button type="button" className="sf-icon" onClick={exitFull} aria-label="Exit full screen">
                  <Minimize2 size={16} />
                </button>
              ) : isPhone() ? (
                <button type="button" className="sf-icon" onClick={enterFull} aria-label="Full screen">
                  <Maximize2 size={16} />
                </button>
              ) : null}
            </div>
            <div className="sf-weapons">
              <button ref={missileBtn} type="button" className="sf-wpn sf-wpn-missile" data-count="8" onPointerDown={press("missile")} aria-label="Fire missiles (Q)">
                <Rocket size={20} />
                <span className="sf-key">Q</span>
              </button>
              <button ref={bombBtn} type="button" className="sf-wpn sf-wpn-bomb" data-count="2" onPointerDown={press("bomb")} aria-label="Drop a bomb (E)">
                <Bomb size={20} />
                <span className="sf-key">E</span>
              </button>
              <button ref={specialBtn} type="button" className="sf-wpn sf-wpn-special is-ready" data-label="Blast" onPointerDown={press("special")} aria-label="Special attack (Space)">
                <Zap size={22} />
                <span className="sf-key">Space</span>
              </button>
            </div>
          </>
        ) : null}

        {phase === "ready" ? (
          <div className="sf-overlay sf-start">
            <h2 className="sf-title">SPACEFALL</h2>
            <p className="sf-tag">Survive. Evolve. Go further.</p>
            <canvas ref={previewRef} className="sf-preview" aria-hidden="true" />
            <ul className="sf-help">
              <li>
                <b>Move</b> WASD / arrows, or drag anywhere
              </li>
              <li>
                <b>Guns</b> fire on their own
              </li>
              <li>
                <b>Q</b> missiles · <b>E</b> bomb · <b>Space</b> special · <b>P</b> pause
              </li>
              <li>Level up to evolve your ship: Scout → Ultimate Destroyer. A boss every 5 levels.</li>
            </ul>
            {best ? (
              <p className="sf-best">
                Best: {best.score.toLocaleString()} · {best.distance.toLocaleString()} km · level {best.level}
              </p>
            ) : null}
            <div className="sf-row">
              <button type="button" className="sf-btn sf-btn-main" onClick={start} disabled={!ready}>
                {ready ? "Launch" : "Preparing ship…"}
              </button>
              <GameShopButton className="sf-btn" />
            </div>
          </div>
        ) : null}

        {phase === "paused" ? (
          <div className="sf-overlay">
            <h3 className="sf-h3">Paused</h3>
            <div className="sf-row">
              <button type="button" className="sf-btn sf-btn-main" onClick={() => pause(false)}>
                <Play size={16} /> Resume
              </button>
              <button
                type="button"
                className="sf-btn"
                onClick={() => {
                  suspendAudio(false);
                  start();
                }}
              >
                <RotateCcw size={16} /> Restart
              </button>
              {full ? (
                <button type="button" className="sf-btn" onClick={exitFull}>
                  <Minimize2 size={16} /> Exit full screen
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {phase === "over" && r && result ? (
          <div className="sf-overlay sf-over" role="dialog" aria-live="assertive">
            <h3 className="sf-h3">Ship destroyed</h3>
            <p className="sf-score">{r.score.toLocaleString()}</p>
            {result.isNew ? <p className="sf-record">New personal best!</p> : <p className="sf-sub">Best {result.best.score.toLocaleString()}</p>}
            <dl className="sf-stats">
              <div>
                <dt>Distance</dt>
                <dd>{r.distance.toLocaleString()} km</dd>
              </div>
              <div>
                <dt>Level</dt>
                <dd>
                  {r.level} · {STAGES[r.stage].name}
                </dd>
              </div>
              <div>
                <dt>Destroyed</dt>
                <dd>{r.kills}</dd>
              </div>
              <div>
                <dt>Bosses</dt>
                <dd>{r.bosses}</dd>
              </div>
              <div>
                <dt>Survived</dt>
                <dd>{fmtTime(r.time)}</dd>
              </div>
              <div>
                <dt>Crystals</dt>
                <dd>{r.resources}</dd>
              </div>
            </dl>
            <p className="sf-sub">
              Records: {result.best.distance.toLocaleString()} km · level {result.best.level} · {result.best.bosses} bosses · {fmtTime(result.best.time)}
            </p>
            <div className="sf-row">
              <button type="button" className="sf-btn sf-btn-main" onClick={start}>
                <RotateCcw size={16} /> Play again
              </button>
              <GameShopButton className="sf-btn" onOpen={exitFull} />
              <Link to="/" className="sf-btn" onClick={exitFull}>
                All games
              </Link>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
