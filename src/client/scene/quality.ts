/**
 * How much the 3D cassette may spend on this device. `high` has the frosted-glass window and a shadow that follows the
 * cassette; `medium` (phones, narrow panes, few cores) fakes the frost with opacity and draws the shadow once; `low` is
 * for reduced motion: one still frame, drawn again only when the Ode changes.
 */
export type Tier = "high" | "medium" | "low";

/** A page narrower than this, or a device with this few cores or fewer, gets the `medium` tier. */
const NARROW_PX = 700;
const FEW_CORES = 4;

/** Set `localStorage["ode:3d"]` to this to draw the 3D cassette on a machine whose WebGL is software-only (a headless check). */
const FORCE = "force";

/** Where a measured step down is remembered for the rest of the visit, so the next page (or the pane beside this one) starts there. */
const MEASURED = "ode:3d-measured";

let answer: Tier | null | undefined;

function measured(): string | null {
  try {
    return sessionStorage.getItem(MEASURED);
  } catch {
    return null;
  }
}

function forced(): boolean {
  try {
    return localStorage.getItem("ode:3d") === FORCE;
  } catch {
    // Storage is refused in some private windows; nothing is forced there.
    return false;
  }
}

function webglWorks(): boolean {
  try {
    const canvas = document.createElement("canvas");
    // Software-only WebGL cannot hold 60 frames a second, so it counts as none: that device gets the flat cassette.
    const options = { failIfMajorPerformanceCaveat: !forced() };
    return (canvas.getContext("webgl2", options) ?? canvas.getContext("webgl", options)) !== null;
  } catch {
    return false;
  }
}

/**
 * The tier this device draws the 3D cassette at, decided once per page.
 *
 * @returns `null` when the device cannot draw it (no WebGL, or WebGL without a graphics card): the page then shows the
 *   flat cassette instead.
 */
export function sceneTier(): Tier | null {
  if (answer !== undefined) return answer;
  if (typeof window === "undefined" || !webglWorks()) return (answer = null);
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return (answer = "low");
  const before = forced() ? null : measured();
  if (before === "flat") return (answer = null);
  if (before === "medium") return (answer = "medium");
  const small = window.innerWidth < NARROW_PX || navigator.hardwareConcurrency <= FEW_CORES;
  return (answer = small ? "medium" : "high");
}

/**
 * Step down after the scene measured itself too slow on this device: `high` becomes `medium`, and `medium` becomes the
 * flat cassette; a `hopeless` device goes straight to the flat one. The step is remembered for the visit. A forced scene (see `FORCE`) and a still one (`low`) stay as they are.
 *
 * @returns The tier to draw at from now on; `null` for the flat cassette.
 */
export function stepDown(from: Tier, hopeless: boolean): Tier | null {
  if (from === "low" || forced()) return from;
  answer = from === "high" && !hopeless ? "medium" : null;
  try {
    sessionStorage.setItem(MEASURED, answer ?? "flat");
  } catch {
    // Not remembered; the next page measures again.
  }
  return answer;
}
