/* The Seven Game Studio chip in 3D (React Three Fiber). Loaded lazily by ChipShowcase.

   Everything is real geometry, nothing is a picture of the chip:
     body      a lathe (a profile turned round the axis): bevelled rims, a recessed LED channel
               on each face, a raised lip round the centre inset and a groove round the side
     segments  eight extruded annular sectors that wrap over both faces and the side
     LEDs      emissive rings in the face channels and a strip round the side; they are the only
               things bright enough to cross the bloom threshold, so only they glow
     SG        the monogram's bars (sgMark.ts) as boxes, lightly emissive, on the top face only
   Seen at a fixed three-quarter angle, floating (a slow turn and a bob); drag to turn it.
   Units: the chip's radius is 1, the y axis runs through it (top face up). */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { CameraControls, CameraControlsImpl, Environment, Lightformer } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { SG_H, SG_RECTS, SG_W } from "./sgMark";


const LED = new THREE.Color("#ff6500");
/** half the body's thickness */
const HT = 0.13;
const SEG_COUNT = 8;
const SEG_SPAN = (28 * Math.PI) / 180;

/* ---------------- geometry ---------------- */
function bodyGeometry() {
  // the top half of the profile (radius, height), from the centre out to the side groove;
  // small chamfers on every corner keep the edges soft, like moulded material
  const top: Array<[number, number]> = [
    [0, 0.112],
    [0.668, 0.112],
    [0.676, 0.117],
    [0.686, 0.123],
    [0.696, 0.122],
    [0.7, 0.113],
    [0.703, 0.1],
    [0.757, 0.1],
    [0.76, 0.113],
    [0.765, 0.126],
    [0.774, HT],
    [0.962, HT],
    [0.988, 0.12],
    [1.0, 0.097],
    [1.0, 0.031],
    [0.995, 0.024],
    [0.982, 0.021],
  ];
  const bottom = top.map(([r, y]) => new THREE.Vector2(r, -y));
  const upper = [...top].reverse().map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry([...bottom, ...upper], 160);
  g.computeVertexNormals();
  return g;
}

function segmentGeometry() {
  const r0 = 0.79;
  const r1 = 1.02;
  const s = new THREE.Shape();
  const a0 = -SEG_SPAN / 2;
  const a1 = SEG_SPAN / 2;
  s.moveTo(r0 * Math.cos(a0), r0 * Math.sin(a0));
  s.absarc(0, 0, r1, a0, a1, false);
  s.lineTo(r0 * Math.cos(a1), r0 * Math.sin(a1));
  s.absarc(0, 0, r0, a1, a0, true);
  // one cap, from just above the side LED strip to a little proud of the top face
  // (the bottom cap is the same piece mirrored), so the strip shows all the way round
  const from = 0.031;
  const depth = HT + 0.006 - from;
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 3, curveSegments: 24 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, from, 0);
  g.computeVertexNormals();
  return g;
}

function monogramGeometry() {
  const k = 0.0104; // 80 units → 0.83 wide
  const h = 0.022;
  const boxes = SG_RECTS.map(([x0, y0, x1, y1]) => {
    const b = new THREE.BoxGeometry((x1 - x0) * k, h, (y1 - y0) * k);
    // image y runs down = toward the viewer's "up" seen from the top view is −z
    b.translate(((x0 + x1) / 2 - SG_W / 2) * k, 0.112 + h / 2, ((y0 + y1) / 2 - SG_H / 2) * k);
    return b;
  });
  return mergeGeometries(boxes)!;
}

/** fine noise for the slightly textured matte surfaces */
function grainTexture() {
  const n = 128;
  const cv = document.createElement("canvas");
  cv.width = cv.height = n;
  const c = cv.getContext("2d")!;
  const img = c.createImageData(n, n);
  for (let i = 0; i < n * n; i++) {
    const v = 118 + Math.random() * 30;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 6);
  return t;
}

/* ---------------- the chip ---------------- */
function Chip({ hovered }: { hovered: boolean }) {
  const geo = useMemo(() => ({ body: bodyGeometry(), seg: segmentGeometry(), sg: monogramGeometry() }), []);
  const grain = useMemo(grainTexture, []);
  const mats = useMemo(() => {
    const led = new THREE.MeshStandardMaterial({ color: LED, emissive: LED, emissiveIntensity: 3.2, roughness: 0.4, toneMapped: false });
    return {
      body: new THREE.MeshStandardMaterial({ color: "#0f0f11", roughness: 0.72, metalness: 0.25, side: THREE.DoubleSide }),
      inset: new THREE.MeshStandardMaterial({ color: "#121214", roughness: 0.86, metalness: 0.12, roughnessMap: grain, bumpMap: grain, bumpScale: 0.5 }),
      seg: new THREE.MeshStandardMaterial({ color: "#19191c", roughness: 0.5, metalness: 0.38, roughnessMap: grain, bumpMap: grain, bumpScale: 0.3 }),
      groove: new THREE.MeshStandardMaterial({ color: "#050506", roughness: 1, metalness: 0 }),
      led,
      sideLed: led.clone(),
      sg: new THREE.MeshStandardMaterial({ color: "#ff6a12", emissive: LED, emissiveIntensity: 0.9, roughness: 0.42, metalness: 0.1, toneMapped: false }),
    };
  }, [grain]);
  useEffect(
    () => () => {
      Object.values(geo).forEach((g) => g.dispose());
      Object.values(mats).forEach((m) => m.dispose());
      grain.dispose();
    },
    [geo, mats, grain],
  );

  // hovering: the LEDs and their spill brighten a touch (eased, never snapping)
  const glow = useRef(1);
  const spill = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    const target = hovered ? 1.28 : 1;
    glow.current += (target - glow.current) * Math.min(1, dt * 6);
    mats.led.emissiveIntensity = 3.2 * glow.current;
    mats.sideLed.emissiveIntensity = 2.6 * glow.current;
    mats.sg.emissiveIntensity = 0.9 * glow.current;
    spill.current?.children.forEach((l) => ((l as THREE.PointLight).intensity = 0.35 * glow.current));
  });

  const segments = useMemo(() => Array.from({ length: SEG_COUNT }, (_, i) => Math.PI / 8 + (i * Math.PI) / 4), []);
  const flat = -Math.PI / 2;
  return (
    <group>
      <mesh geometry={geo.body} material={mats.body} />
      {segments.map((a) => (
        <group key={a} rotation-y={a}>
          <mesh geometry={geo.seg} material={mats.seg} />
          <mesh geometry={geo.seg} material={mats.seg} scale-y={-1} />
        </group>
      ))}
      {/* the LED rings in the face channels, and the strip round the side */}
      {[1, -1].map((s) => (
        <group key={s} scale-y={s}>
          <mesh material={mats.led} rotation-x={flat} position-y={0.1005}>
            <ringGeometry args={[0.713, 0.747, 160]} />
          </mesh>
          {/* the centre inset: a flat disc with a fine matte grain */}
          <mesh material={mats.inset} rotation-x={flat} position-y={0.1129}>
            <circleGeometry args={[0.668, 96]} />
          </mesh>
          {/* concentric grooves: on the border and round the centre inset */}
          <mesh material={mats.groove} rotation-x={flat} position-y={HT + 0.0006}>
            <ringGeometry args={[0.866, 0.872, 160]} />
          </mesh>
          <mesh material={mats.groove} rotation-x={flat} position-y={0.1136}>
            <ringGeometry args={[0.6, 0.605, 160]} />
          </mesh>
          <mesh material={mats.groove} rotation-x={flat} position-y={0.1136}>
            <ringGeometry args={[0.635, 0.638, 160]} />
          </mesh>
        </group>
      ))}
      <mesh material={mats.sideLed}>
        <cylinderGeometry args={[0.986, 0.986, 0.034, 160, 1, true]} />
      </mesh>
      <mesh geometry={geo.sg} material={mats.sg} />
      {/* the LEDs' light spilling onto the black around them, above and below and round the side */}
      <group ref={spill}>
        {Array.from({ length: 6 }, (_, i) => {
          const a = (i / 6) * Math.PI * 2;
          return [0.2, -0.2].map((y) => <pointLight key={`${i}${y}`} color={LED} intensity={0.35} distance={0.75} decay={2} position={[Math.cos(a) * 0.73, y, Math.sin(a) * 0.73]} />);
        })}
        {Array.from({ length: 4 }, (_, i) => {
          const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
          return <pointLight key={`s${i}`} color={LED} intensity={0.35} distance={0.6} decay={2} position={[Math.cos(a) * 1.18, 0, Math.sin(a) * 1.18]} />;
        })}
      </group>
    </group>
  );
}

/* ---------------- camera ---------------- */
const { ACTION } = CameraControlsImpl;
/** the resting angle: a three-quarter look down at the face */
const REST: [number, number] = [0.3, 1.05];

/** Drag turns the chip (the camera goes round it); let go and it eases back to rest.
 *  No zoom: the wheel keeps scrolling the page. */
function Cam() {
  const ctl = useRef<CameraControlsImpl>(null);
  const size = useThree((s) => s.size);
  // the chip fills ~70% of the box (the edges fade out), leaving room for the glow
  const fit = Math.max(30, Math.min(size.width, size.height) * 0.36);
  const back = useRef(0);
  useEffect(() => {
    const c = ctl.current;
    if (!c) return;
    void c.rotateTo(REST[0], REST[1], false);
    void c.zoomTo(fit, false);
  }, [fit]);
  useEffect(() => () => window.clearTimeout(back.current), []);
  return (
    <CameraControls
      ref={ctl}
      makeDefault
      smoothTime={0.5}
      draggingSmoothTime={0.12}
      azimuthRotateSpeed={0.8}
      polarRotateSpeed={0.8}
      mouseButtons={{ left: ACTION.ROTATE, middle: ACTION.NONE, right: ACTION.NONE, wheel: ACTION.NONE }}
      touches={{ one: ACTION.TOUCH_ROTATE, two: ACTION.NONE, three: ACTION.NONE }}
      onStart={() => window.clearTimeout(back.current)}
      onEnd={() => {
        window.clearTimeout(back.current);
        back.current = window.setTimeout(() => void ctl.current?.rotateTo(REST[0], REST[1], true), 1800);
      }}
    />
  );
}

/** The chip floats: a slow turn and a gentle bob (still when the visitor prefers less motion). */
function Float({ children }: { children: ReactNode }) {
  const g = useRef<THREE.Group>(null);
  const calm = useMemo(() => {
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      return false;
    }
  }, []);
  useFrame(({ clock }, dt) => {
    const o = g.current;
    if (!o || calm) return;
    const t = clock.elapsedTime;
    o.rotation.y += dt * 0.32;
    o.position.y = Math.sin(t * 1.3) * 0.045;
    o.rotation.x = Math.sin(t * 0.9) * 0.05;
    o.rotation.z = Math.cos(t * 0.7) * 0.04;
  });
  return <group ref={g}>{children}</group>;
}

/* ---------------- the scene ---------------- */
export type Chip3DProps = {
  /** lighter rendering: lower pixel ratio, smaller buffers, no MSAA */
  mobile?: boolean;
  /** false while off screen: no frames are drawn */
  active?: boolean;
};

/** Draws a frame `fps` times a second (the canvas is on frameloop "demand"): the slow spin and
    float look the same at 30 fps and cost half as much as at 60 (or 120 on fast phones). */
function FrameCap({ fps }: { fps: number }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const id = window.setInterval(() => invalidate(), 1000 / fps);
    return () => window.clearInterval(id);
  }, [fps, invalidate]);
  return null;
}

/** The chip, floating on a transparent canvas (the page shows through). */
export default function Chip3D({ mobile = false, active = true }: Chip3DProps) {
  const [hovered, setHovered] = useState(false);
  return (
    <Canvas
      orthographic
      camera={{ position: [0, 0, 10], zoom: 100, near: 0.1, far: 100 }}
      dpr={[1, mobile ? 1.75 : 2]}
      frameloop={active ? "demand" : "never"}
      gl={{ alpha: true, antialias: false, powerPreference: "high-performance", toneMapping: THREE.ACESFilmicToneMapping }}
      onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
      onPointerMissed={() => setHovered(false)}
    >
      {/* a dark studio: soft key from above, a little side fill, a rim from behind, a whisper from below */}
      <ambientLight intensity={0.14} />
      <directionalLight position={[0.6, 5, 1.2]} intensity={1.1} />
      <directionalLight position={[-4, 1.2, 2]} intensity={0.35} />
      <directionalLight position={[3, 0.4, 4]} intensity={0.45} />
      <directionalLight position={[0, 1.5, -5]} intensity={0.9} />
      <directionalLight position={[0, -5, 0.5]} intensity={0.35} />
      {/* soft boxes for the reflections (made here: nothing is downloaded) */}
      <Environment resolution={mobile ? 64 : 128} frames={1}>
        <Lightformer form="rect" intensity={0.55} position={[0, 5, 0]} rotation-x={Math.PI / 2} scale={[4, 4, 1]} />
        <Lightformer form="rect" intensity={0.5} position={[-5, 1, 0]} rotation-y={Math.PI / 2} scale={[4, 2, 1]} />
        <Lightformer form="rect" intensity={0.45} position={[0, 0.3, 5]} rotation-y={Math.PI} scale={[6, 0.8, 1]} />
        <Lightformer form="rect" intensity={0.8} position={[0, 1, -5]} scale={[6, 1, 1]} />
      </Environment>
      <Float>
        <group onPointerOver={() => setHovered(true)} onPointerOut={() => setHovered(false)}>
          <Chip hovered={hovered} />
        </group>
      </Float>
      <Cam />
      {active ? <FrameCap fps={30} /> : null}
      {/* anti-aliasing (MSAA) and a bloom that only the LEDs are bright enough to trigger */}
      <EffectComposer multisampling={mobile ? 0 : 4}>
        <Bloom mipmapBlur luminanceThreshold={1} luminanceSmoothing={0.1} intensity={mobile ? 0.7 : 0.8} radius={0.5} />
      </EffectComposer>
    </Canvas>
  );
}
