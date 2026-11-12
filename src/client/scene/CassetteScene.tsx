import { ContactShadows, Environment, Lightformer } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type ReactElement, type RefObject } from "react";
import {
  CanvasTexture,
  ExtrudeGeometry,
  MathUtils,
  Path,
  Shape,
  ShapeGeometry,
  SRGBColorSpace,
  type Group,
  type Mesh,
  type MeshBasicMaterial,
  type MeshPhysicalMaterial,
  type MeshStandardMaterial,
  type PointLight,
} from "three";
import { clamp01 } from "../helpers.ts";
import type { Tier } from "./quality.ts";

/**
 * What the 3D cassette shows. Every prop is a fact about the Ode, so nothing in the scene is decoration:
 * `label` is written on the cassette; `progress` (0 to 1) moves tape from the left reel to the right; `playing` turns
 * the reels; `clarity` (0 to 1) is how much of the Ode is unlocked, and clears the frosted window by that much;
 * `flare` is true while a line has just unlocked; `dropped` is the chorus having dropped. `tier` is what the scene may spend.
 */
export interface CassetteSceneProps {
  label: string;
  progress: number;
  playing: boolean;
  clarity: number;
  flare: boolean;
  dropped: boolean;
  tier: Tier;
  /** Called once when the scene has measured itself too slow for `tier` on this device; `hopeless` when no tier would do. */
  onSlow: (hopeless: boolean) => void;
}

/* ---------- Dimensions, in scene units (the cassette is about 4 wide) ---------- */

const SHELL = { width: 4.2, height: 2.7, depth: 0.42, corner: 0.16, bevel: 0.04 };
/** The window is a capsule cut through the shell; the reels sit inside the cut. */
const WINDOW = { width: 2.3, height: 0.66, y: 0.02 };
const LABEL = { width: 3.8, height: 1.9, y: 0.25 };
const REEL_X = 0.62;
/** The tape pack's radius on a full reel and on an empty one. */
const FULL_PACK = 0.52;
const EMPTY_PACK = 0.27;
const HUB_RADIUS = 0.19;

/* ---------- Motion: slow, and eased like something with weight ---------- */

/** How the cassette rests: turned a little so its depth and the light on its edge show. */
const REST = { x: -0.1, y: -0.34, z: 0.03 };
const REEL_SPEED = 2.4;
/** The kick when a line unlocks is a damped spring. */
const KICK = { stiffness: 60, damping: 7, impulse: 3 };
const FLIP_SECONDS = 1.9;
/** The window's frost, as glass roughness (high tier) or as opacity (medium), locked and fully unlocked. */
const FROST = { rough: 0.85, clear: 0.04, opaque: 0.97, seeThrough: 0.06 };

/** A colour from the stylesheet, so the scene and the page share one palette (`ode.css` is its home). */
function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function traceRoundedRect(path: Path, cx: number, cy: number, width: number, height: number, radius: number): void {
  const x = cx - width / 2;
  const y = cy - height / 2;
  path.moveTo(x + radius, y);
  path.lineTo(x + width - radius, y);
  path.absarc(x + width - radius, y + radius, radius, -Math.PI / 2, 0, false);
  path.lineTo(x + width, y + height - radius);
  path.absarc(x + width - radius, y + height - radius, radius, 0, Math.PI / 2, false);
  path.lineTo(x + radius, y + height);
  path.absarc(x + radius, y + height - radius, radius, Math.PI / 2, Math.PI, false);
  path.lineTo(x, y + radius);
  path.absarc(x + radius, y + radius, radius, Math.PI, Math.PI * 1.5, false);
}

/** The shell: one extruded rounded slab with the window cut through it, so the reels are really inside. */
function shellGeometry(): ExtrudeGeometry {
  const outline = new Shape();
  traceRoundedRect(outline, 0, 0, SHELL.width, SHELL.height, SHELL.corner);
  const cut = new Path();
  traceRoundedRect(cut, 0, WINDOW.y, WINDOW.width, WINDOW.height, WINDOW.height / 2);
  outline.holes.push(cut);
  const geometry = new ExtrudeGeometry(outline, {
    depth: SHELL.depth,
    bevelEnabled: true,
    bevelThickness: SHELL.bevel,
    bevelSize: SHELL.bevel,
    bevelSegments: 3,
    curveSegments: 20,
  });
  geometry.translate(0, 0, -SHELL.depth / 2);
  return geometry;
}

/** The thicker foot along the bottom edge, where a cassette meets the player's head: it gives the slab its silhouette. */
function footGeometry(): ExtrudeGeometry {
  const foot = new Shape();
  foot.moveTo(-1.5, -SHELL.height / 2 - SHELL.bevel + 0.02);
  foot.lineTo(1.5, -SHELL.height / 2 - SHELL.bevel + 0.02);
  foot.lineTo(1.3, -0.86);
  foot.lineTo(-1.3, -0.86);
  foot.closePath();
  const depth = SHELL.depth + SHELL.bevel * 2 + 0.07;
  const geometry = new ExtrudeGeometry(foot, { depth, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2 });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

function windowGeometry(grow: number): ShapeGeometry {
  const shape = new Shape();
  traceRoundedRect(shape, 0, WINDOW.y, WINDOW.width + grow, WINDOW.height + grow, (WINDOW.height + grow) / 2);
  return new ShapeGeometry(shape, 20);
}

/**
 * The paper label, drawn on a 2D canvas so it needs no font or image download: the trip's name in the page's display
 * type, ruled lines, the tape-yellow stripe, and a hole where the window is.
 */
function labelTexture(label: string): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const perUnit = canvas.width / LABEL.width;
  const pen = canvas.getContext("2d");
  if (pen !== null) {
    pen.fillStyle = token("--card");
    pen.beginPath();
    pen.roundRect(0, 0, canvas.width, canvas.height, 26);
    pen.fill();
    pen.globalCompositeOperation = "source-atop";

    pen.fillStyle = token("--tape");
    pen.fillRect(0, canvas.height - 84, canvas.width, 84);

    pen.strokeStyle = token("--paper-deep");
    pen.lineWidth = 3;
    for (const y of [128, 166]) {
      pen.beginPath();
      pen.moveTo(52, y);
      pen.lineTo(canvas.width - 52, y);
      pen.stroke();
    }

    pen.fillStyle = token("--ink");
    pen.textBaseline = "alphabetic";
    const display = token("--display");
    let size = 72;
    do {
      pen.font = `650 ${size}px ${display}`;
      size -= 4;
    } while (pen.measureText(label).width > canvas.width - 230 && size > 30);
    pen.fillText(label, 56, 104);

    pen.font = `800 40px ${token("--mono")}`;
    pen.textAlign = "center";
    pen.lineWidth = 5;
    pen.strokeStyle = token("--ink");
    pen.beginPath();
    pen.roundRect(canvas.width - 122, 48, 70, 66, 12);
    pen.stroke();
    pen.fillText("A", canvas.width - 87, 96);

    // The hole for the window, a little larger than the cut so the shell's bevel shows around it.
    pen.globalCompositeOperation = "destination-out";
    const holeWidth = (WINDOW.width + 0.2) * perUnit;
    const holeHeight = (WINDOW.height + 0.2) * perUnit;
    const holeY = canvas.height / 2 + (LABEL.y - WINDOW.y) * perUnit;
    pen.beginPath();
    pen.roundRect(canvas.width / 2 - holeWidth / 2, holeY - holeHeight / 2, holeWidth, holeHeight, holeHeight / 2);
    pen.fill();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** A soft round patch of light, for the warm pool behind the cassette. */
function glowTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const pen = canvas.getContext("2d");
  if (pen !== null) {
    const fade = pen.createRadialGradient(128, 128, 0, 128, 128, 128);
    fade.addColorStop(0, "rgba(255,255,255,1)");
    fade.addColorStop(0.45, "rgba(255,255,255,0.35)");
    fade.addColorStop(1, "rgba(255,255,255,0)");
    pen.fillStyle = fade;
    pen.fillRect(0, 0, 256, 256);
  }
  return new CanvasTexture(canvas);
}

/**
 * The performance budget, measured instead of guessed: the scene counts the frames it draws in each window of wall-clock
 * time, and when two windows in a row fall under what its tier needs it asks to step down. The first window pays for
 * compiling shaders, so it counts only when it is hopeless; and a hopeless device (a few frames a second, which starves the
 * rest of the page) is caught after its first few frames, without waiting for a window to end.
 */
const BUDGET = { windowMs: 2000, highFps: 40, mediumFps: 22, hopelessFps: 5, hopelessAfterFrames: 4 };

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** One reel: the tape pack, whose radius is set every frame, and the hub that turns. */
function Reel({ x, pack, hub, colors }: { x: number; pack: RefObject<Mesh | null>; hub: RefObject<Group | null>; colors: Palette }) {
  return (
    <group position={[x, WINDOW.y, 0]}>
      <mesh ref={pack} rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[1, 1, 0.2, 48]} />
        <meshStandardMaterial color={colors.tape} roughness={0.38} metalness={0.15} />
      </mesh>
      <group ref={hub} position-z={0.02}>
        <mesh rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[HUB_RADIUS, HUB_RADIUS, 0.24, 32]} />
          <meshStandardMaterial color={colors.card} roughness={0.5} />
        </mesh>
        {[0, 1, 2, 3, 4, 5].map((tooth) => (
          <mesh key={tooth} rotation-z={(tooth * Math.PI) / 3} position-z={0.125}>
            <boxGeometry args={[0.04, HUB_RADIUS * 1.7, 0.012]} />
            <meshStandardMaterial color={colors.ink} roughness={0.6} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

interface Palette {
  ink: string;
  card: string;
  tape: string;
  glow: string;
  black: string;
  white: string;
  shell: string;
  key: string;
}

function Tape({ label, progress, playing, clarity, flare, dropped, tier, onSlow, active }: CassetteSceneProps & { active: boolean }) {
  const still = tier === "low";
  const { viewport, invalidate } = useThree();

  const colors = useMemo<Palette>(
    () => ({ ink: token("--ink"), card: token("--card"), tape: token("--tape-brown"), glow: token("--tape"), black: token("--black"), white: token("--white"), shell: token("--shell"), key: token("--light-key") }),
    [],
  );
  const shell = useMemo(shellGeometry, []);
  const foot = useMemo(footGeometry, []);
  const pane = useMemo(() => windowGeometry(0), []);
  const backing = useMemo(() => windowGeometry(0.3), []);
  const labelMap = useMemo(() => labelTexture(label), [label]);
  const glowMap = useMemo(glowTexture, []);
  // Geometry and textures made by hand are not owned by a JSX element, so they are let go by hand.
  useEffect(() => () => labelMap.dispose(), [labelMap]);
  useEffect(
    () => () => {
      shell.dispose();
      foot.dispose();
      pane.dispose();
      backing.dispose();
      glowMap.dispose();
    },
    [shell, foot, pane, backing, glowMap],
  );

  const body = useRef<Group>(null);
  const leftPack = useRef<Mesh>(null);
  const rightPack = useRef<Mesh>(null);
  const leftHub = useRef<Group>(null);
  const rightHub = useRef<Group>(null);
  const frostedGlass = useRef<MeshPhysicalMaterial>(null);
  const plainGlass = useRef<MeshStandardMaterial>(null);
  const lamp = useRef<PointLight>(null);
  const halo = useRef<Mesh>(null);
  const haloPaint = useRef<MeshBasicMaterial>(null);
  const pointer = useRef({ x: 0, y: 0 });

  const now = useRef({
    time: 0,
    spin: 0,
    reelSpeed: 0,
    progress: clamp01(progress),
    clarity: clamp01(clarity),
    glow: 0,
    kick: 0,
    kickSpeed: 0,
    flip: 1,
    tiltX: 0,
    tiltY: 0,
    wasFlaring: false,
    wasDropped: dropped,
  });

  // The cassette leans toward the cursor: the one thing on the page that answers a look. Phones have none, and float only.
  useEffect(() => {
    if (still) return;
    function lean(event: PointerEvent) {
      if (event.pointerType === "touch") return;
      pointer.current.x = (event.clientX / window.innerWidth) * 2 - 1;
      pointer.current.y = (event.clientY / window.innerHeight) * 2 - 1;
    }
    window.addEventListener("pointermove", lean, { passive: true });
    return () => window.removeEventListener("pointermove", lean);
  }, [still]);

  // A still scene draws once more whenever a fact it shows has changed.
  useEffect(() => {
    if (still) invalidate();
  }, [still, invalidate, label, progress, playing, clarity, flare, dropped, viewport.width]);

  const meter = useRef({ since: 0, frames: 0, windows: 0, slow: 0, told: false });
  // A window that spans a pause (the tab hidden, the cassette scrolled away) says nothing about the device: start over.
  useEffect(() => {
    const restart = () => void (meter.current.since = 0);
    restart();
    meter.current.told = false;
    meter.current.slow = 0;
    document.addEventListener("visibilitychange", restart);
    return () => document.removeEventListener("visibilitychange", restart);
  }, [tier, active]);

  useFrame((_, elapsed) => {
    const s = now.current;
    const m = meter.current;
    if (!still && !m.told) {
      const at = performance.now();
      if (m.since === 0) {
        m.since = at;
        m.frames = 0;
      }
      m.frames += 1;
      const span = at - m.since;
      const fps = m.frames > 1 ? ((m.frames - 1) * 1000) / span : Infinity;
      if (m.frames >= BUDGET.hopelessAfterFrames && fps < BUDGET.hopelessFps) {
        m.told = true;
        onSlow(true);
      } else if (span >= BUDGET.windowMs) {
        // The first window pays for compiling shaders, so it is not held against the tier.
        m.slow = m.windows > 0 && fps < (tier === "high" ? BUDGET.highFps : BUDGET.mediumFps) ? m.slow + 1 : 0;
        if (m.slow >= 2) {
          m.told = true;
          onSlow(false);
        }
        m.windows += 1;
        m.since = 0;
      }
    }
    const dt = Math.min(elapsed, 0.05);
    // How far a value moves toward its target this frame: frame-rate independent, and all the way when still.
    const toward = (rate: number) => (still ? 1 : 1 - Math.exp(-dt * rate));
    s.time += still ? 0 : dt;

    // Reels: they take a moment to get going and to coast to a stop, like a motor with a flywheel.
    s.reelSpeed += ((playing && !still ? REEL_SPEED : 0) - s.reelSpeed) * toward(2.5);
    s.spin -= s.reelSpeed * dt;
    s.progress += (clamp01(progress) - s.progress) * toward(6);
    const left = MathUtils.lerp(FULL_PACK, EMPTY_PACK, s.progress);
    const right = MathUtils.lerp(EMPTY_PACK, FULL_PACK, s.progress);
    leftPack.current?.scale.set(left, 1, left);
    rightPack.current?.scale.set(right, 1, right);
    if (leftHub.current) leftHub.current.rotation.z = s.spin;
    if (rightHub.current) rightHub.current.rotation.z = s.spin * (left / right);

    // The window: frosted while lines are locked, clearing slowly as they unlock (the same blur the locked lyrics wear).
    s.clarity += (clamp01(clarity) - s.clarity) * toward(1.4);
    if (frostedGlass.current) frostedGlass.current.roughness = MathUtils.lerp(FROST.rough, FROST.clear, s.clarity);
    if (plainGlass.current) plainGlass.current.opacity = MathUtils.lerp(FROST.opaque, FROST.seeThrough, s.clarity ** 1.6);

    // The warm light inside: a little for every line unlocked, all of it for a fresh unlock or the drop.
    s.glow += ((dropped || flare ? 1 : 0.1 + 0.3 * s.clarity) - s.glow) * toward(3);
    if (lamp.current) lamp.current.intensity = s.glow * 2.2;

    // A fresh unlock kicks the cassette toward the viewer; a damped spring brings it back.
    if (flare && !s.wasFlaring && !still) s.kickSpeed += KICK.impulse;
    s.wasFlaring = flare;
    s.kickSpeed += (-KICK.stiffness * s.kick - KICK.damping * s.kickSpeed) * dt;
    s.kick += s.kickSpeed * dt;

    // The drop, the one big moment: the cassette turns once all the way round, slowly, in a swell of light.
    if (dropped && !s.wasDropped && !still) s.flip = 0;
    s.wasDropped = dropped;
    s.flip = Math.min(1, s.flip + dt / FLIP_SECONDS);
    const turn = easeInOut(s.flip) * Math.PI * 2;
    const swell = Math.sin(s.flip * Math.PI);

    s.tiltX += (pointer.current.y - s.tiltX) * toward(3);
    s.tiltY += (pointer.current.x - s.tiltY) * toward(3);
    if (body.current) {
      const fit = Math.min(1, viewport.width / 5.4);
      body.current.scale.setScalar(fit * (1 + swell * 0.06));
      body.current.position.set(0, 0.12 + Math.sin(s.time * 0.8) * 0.07, s.kick * 0.5 + swell * 0.6);
      body.current.rotation.set(
        REST.x + Math.sin(s.time * 0.6) * 0.025 + s.tiltX * 0.12 - s.kick * 0.15,
        REST.y + Math.sin(s.time * 0.45) * 0.05 + s.tiltY * 0.22 + turn,
        REST.z + Math.sin(s.time * 0.5) * 0.012,
      );
    }
    if (halo.current) halo.current.scale.setScalar(1 + s.glow * 0.25 + swell * 0.5);
    if (haloPaint.current) haloPaint.current.opacity = 0.12 + s.glow * 0.5;
  });

  return (
    <>
      {/* Key, fill and rim: studio light, white from the upper right, a cool fill from the left, a white edge from behind. */}
      <ambientLight intensity={0.55} />
      <directionalLight position={[3.5, 4.5, 6]} intensity={1.9} color={token("--light-key")} />
      <directionalLight position={[-5, 1, 3]} intensity={0.55} color={token("--light-fill")} />
      <directionalLight position={[-1, 3, -6]} intensity={1.2} color={colors.key} />
      {/* What the glossy shell reflects, built from three soft panels instead of a downloaded photo: drawn once. */}
      <Environment resolution={128} frames={1}>
        <Lightformer form="rect" intensity={2.4} color={token("--light-key")} position={[2, 5, 4]} scale={[9, 4, 1]} target={[0, 0, 0]} />
        <Lightformer form="rect" intensity={0.9} color={token("--light-fill")} position={[-6, 1, 2]} scale={[3, 6, 1]} target={[0, 0, 0]} />
        <Lightformer form="circle" intensity={1.2} color={colors.key} position={[0, 1, -6]} scale={4} target={[0, 0, 0]} />
      </Environment>

      <mesh ref={halo} position={[0, 0.1, -1.6]}>
        <planeGeometry args={[8.5, 8.5]} />
        <meshBasicMaterial ref={haloPaint} map={glowMap} color={colors.white} transparent depthWrite={false} toneMapped={false} opacity={0.12} />
      </mesh>

      <group ref={body} rotation={[REST.x, REST.y, REST.z]}>
        <mesh geometry={shell}>
          <meshPhysicalMaterial color={colors.shell} roughness={0.42} clearcoat={0.6} clearcoatRoughness={0.3} />
        </mesh>
        <mesh geometry={foot}>
          <meshPhysicalMaterial color={colors.shell} roughness={0.55} clearcoat={0.3} clearcoatRoughness={0.4} />
        </mesh>
        {[-0.72, 0.72].map((x) => (
          <mesh key={x} position={[x, -1.12, (SHELL.depth + SHELL.bevel * 2 + 0.1) / 2 + 0.002]}>
            <circleGeometry args={[0.085, 24]} />
            <meshStandardMaterial color={colors.black} roughness={0.9} />
          </mesh>
        ))}
        <mesh position={[0, LABEL.y, SHELL.depth / 2 + SHELL.bevel + 0.003]}>
          <planeGeometry args={[LABEL.width, LABEL.height]} />
          {/* Paper holds its own colour under the warm light: a little of the label is lit from within, so cream stays cream. */}
          <meshStandardMaterial map={labelMap} emissiveMap={labelMap} emissive={colors.white} emissiveIntensity={0.3} transparent alphaTest={0.5} roughness={0.85} />
        </mesh>

        {/* Inside the window: a dark back wall, the two reels, the lamp that warms as lines unlock, then the glass. */}
        <mesh geometry={backing} position-z={-SHELL.depth / 2 - SHELL.bevel + 0.01}>
          <meshStandardMaterial color={colors.black} roughness={0.9} />
        </mesh>
        <mesh geometry={backing} position-z={-SHELL.depth / 2 - SHELL.bevel - 0.002} rotation-y={Math.PI}>
          <meshStandardMaterial color={colors.black} roughness={0.9} />
        </mesh>
        <Reel x={-REEL_X} pack={leftPack} hub={leftHub} colors={colors} />
        <Reel x={REEL_X} pack={rightPack} hub={rightHub} colors={colors} />
        <pointLight ref={lamp} position={[0, WINDOW.y, 0.12]} color={colors.glow} intensity={0} distance={2.2} decay={1.4} />
        <mesh geometry={pane} position-z={SHELL.depth / 2 - 0.02}>
          {tier === "high" ? (
            // Real frosted glass (one extra pass over a small scene): the blur is the lock.
            <meshPhysicalMaterial ref={frostedGlass} transmission={1} thickness={0.25} ior={1.35} roughness={FROST.rough} color={colors.card} />
          ) : (
            // Phones and reduced motion: the frost is a milky pane that thins out, at no extra pass.
            <meshStandardMaterial ref={plainGlass} color={colors.card} transparent opacity={FROST.opaque} roughness={0.25} />
          )}
        </mesh>
      </group>

      {/* The shadow grounds the cassette on the paper. It follows the float on the high tier and is drawn once otherwise. */}
      <ContactShadows position={[0, -1.9, 0]} opacity={0.42} scale={9} blur={2.6} far={2.6} resolution={tier === "high" ? 512 : 256} color={colors.ink} frames={tier === "high" ? Infinity : 1} />
    </>
  );
}

/**
 * The 3D cassette: the hero object of every page that plays an Ode. It is loaded on demand (this module is the only one
 * that imports three.js), draws nothing while it is off screen, and under reduced motion draws single still frames.
 * The canvas is a picture of what the page already says in words, so it is hidden from screen readers and takes no clicks.
 *
 * @param props - See {@link CassetteSceneProps}.
 */
export default function CassetteScene(props: CassetteSceneProps): ReactElement {
  const stage = useRef<HTMLDivElement>(null);
  const [onScreen, setOnScreen] = useState(true);

  useEffect(() => {
    const element = stage.current;
    if (element === null || typeof IntersectionObserver === "undefined") return;
    const watcher = new IntersectionObserver(([entry]) => setOnScreen(entry?.isIntersecting ?? true));
    watcher.observe(element);
    return () => watcher.disconnect();
  }, []);

  const still = props.tier === "low";
  return (
    <div ref={stage} className="ode-scene" aria-hidden="true">
      <Canvas
        // Sharp enough on a phone without drawing four times the pixels: the cap is the largest single saving.
        dpr={[1, props.tier === "high" ? 1.75 : props.tier === "medium" ? 1.5 : 1]}
        frameloop={still ? "demand" : onScreen ? "always" : "never"}
        camera={{ fov: 30, position: [0, 0.05, 8] }}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      >
        <Tape {...props} active={onScreen} />
      </Canvas>
    </div>
  );
}
