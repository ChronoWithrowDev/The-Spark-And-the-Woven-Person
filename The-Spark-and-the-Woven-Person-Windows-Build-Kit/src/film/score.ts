import { clamp, smoothstep } from "./utils";
import type { Pose } from "./silhouette";
import { silhouettePoint } from "./silhouette";

// ---------- shared stage geometry (used by renderer and timelines) ----------
export const GARMENT_HW = 158; // garment half width
export const GARMENT_HH = 212; // garment half height
export const FIGURE_H = 470; // person-form height in px
export const FIGURE_X = 0.9; // horizontal slenderness of the person-form
export const FIGURE_DY = -8; // person-form vertical offset from garment centre

export interface Shot {
  id: number;
  numeral: string;
  title: string;
  start: number;
  end: number;
  blurb: string;
  description: string;
}

export type SparkKind = "orb" | "star" | "petal" | "ring";
export type SparkRole = "single" | "build" | "final" | "forge" | "reignite" | "settle" | "pass";

export interface SparkEvent {
  id: number;
  phase: number; // id of the shot it belongs to
  role: SparkRole;
  tEnter: number; // appears at frame edge
  tArrive: number; // reaches its resting point
  tRipple: number; // moment of expression / ripple
  tFadeStart: number; // begins to extinguish
  tEnd: number; // fully gone — never returns
  fromAngle: number; // direction of entry (radians, from frame centre)
  target: { x: number; y: number }; // garment-local resting point
  hue: number;
  kind: SparkKind;
  size: number;
  quick: boolean; // short-cycle instance (darting path, softer ripple and chime)
  rippleGain: number;
  rippleAge: number;
  tWatch?: number; // passes through the golden watch at this moment
  toWatch?: boolean; // the watch itself is its destination (the forging spark)
  window?: number; // context window it belongs to
}

export interface Pulse {
  t0: number;
  dur: number;
  gain: number;
}

export interface NarrationLine {
  text: string;
  start: number;
  end: number;
}

/** A context window: it opens (gathers), holds, then closes into the watch. */
export interface ContextWindow {
  index: number;
  gatherStart: number | null; // null for the first window (it builds from nothing)
  gatherDur: number;
  pauseStart: number; // the sparks stop
  flowStart: number; // traces flow into the watch
  flowDur: number;
  fadeStart: number; // figure fades
  fadeEnd: number;
}

export interface Principle {
  icon: string;
  title: string;
  text: string;
}

export interface FilmScore {
  id: string;
  numeral: string;
  title: string;
  kicker: string;
  intro: string;
  duration: number;
  shots: Shot[];
  sparks: SparkEvent[];
  pulses: Pulse[];
  narration: NarrationLine[];
  principles: Principle[];
  styleNotes: string[];

  personAmount(t: number): number; // 0..1 how woven-into-a-person the cloth is
  dissolveAmount(t: number): number; // 0..1 how unwoven / faded the figure is
  activityAmount(t: number): number; // 0..1 a spark is currently taking up the cloth
  jitter(t: number): number; // line-boil multiplier (lower = more in focus)
  turnAmount(t: number): number; // figure turns toward the viewer
  glowEnvelope(t: number): number; // soft figure glow
  loosenAmount(t: number): number; // momentary re-weaving
  poseAt(t: number): Pose;
  windowIndex(t: number): number;
  windows: ContextWindow[];
  dissolveDrift: number; // how far strands drift when unweaving
  remnantKeep: number; // fraction of remnant strands' alpha kept after dissolve

  watch: { buildStart: number; buildEnd: number } | null;
  watchFlare(t: number): number;
}

// ---------------------------------------------------------------------------

/** Piecewise smooth track through [time, value] keys. */
export function keyTrack(keys: Array<[number, number]>): (t: number) => number {
  return (t: number) => {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 0; i < keys.length - 1; i++) {
      const [t0, v0] = keys[i];
      const [t1, v1] = keys[i + 1];
      if (t <= t1) return v0 + (v1 - v0) * smoothstep((t - t0) / (t1 - t0 || 1));
    }
    return keys[keys.length - 1][1];
  };
}

/** The woven person brightens while a spark is present and settles between. */
export function activityFrom(sparks: SparkEvent[]): (t: number) => number {
  return (t: number) => {
    let a = 0;
    for (const sp of sparks) {
      if (t < sp.tArrive - 0.4 || t > sp.tEnd + 0.9) continue;
      const lead = sp.quick ? 0.18 : 0.4;
      const rise = sp.quick ? 0.32 : 0.7;
      const rest = sp.quick ? 0.28 : 0.9;
      const env =
        smoothstep(clamp((t - (sp.tArrive - lead)) / rise)) *
        (1 - smoothstep(clamp((t - sp.tFadeStart) / (sp.tEnd + rest - sp.tFadeStart))));
      if (env > a) a = env;
    }
    return a;
  };
}

/** Throws if any spark overlaps another, breaks its own cycle, or leaves its shot. */
export function validateSparks(sparks: SparkEvent[], shots: Shot[]): void {
  for (let i = 1; i < sparks.length; i++) {
    if (sparks[i].tEnter <= sparks[i - 1].tEnd) {
      throw new Error(`Spark ${i} overlaps spark ${i - 1}`);
    }
  }
  for (const sp of sparks) {
    const shot = shots.find((s) => s.id === sp.phase);
    const tFirst = sp.tWatch ?? sp.tArrive;
    if (
      !shot ||
      sp.tEnter < shot.start ||
      sp.tEnd > shot.end ||
      sp.tEnter >= tFirst ||
      (sp.tWatch !== undefined && sp.tWatch >= sp.tArrive) ||
      sp.tArrive >= sp.tFadeStart ||
      sp.tRipple >= sp.tFadeStart ||
      sp.tFadeStart >= sp.tEnd
    ) {
      throw new Error(`Spark ${sp.id} has an invalid cycle or shot boundary.`);
    }
  }
}

/**
 * Garment-local coordinates of a point on the person-form's outline (base pose).
 * Sparks that land ON the woven outline never read as a core or heart inside it.
 */
export function outlineTarget(u: number): { x: number; y: number } {
  const p = silhouettePoint(u);
  return {
    x: (p.x * FIGURE_X * FIGURE_H) / (GARMENT_HW * 1.12),
    y: (p.y * FIGURE_H + FIGURE_DY) / (GARMENT_HH * 1.02),
  };
}

export function formatTime(t: number): string {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export const COMMON_STYLE_NOTES = [
  "Hand-drawn, gently textured",
  "Translucent cloth",
  "Fine luminous threads",
  "Soft watercolor fields",
  "Amber-white sparks",
  "Deep blue-green field",
  "Quiet · playful · wondrous",
  "Smooth dissolves",
  "No words, no machines, no ghosts",
];

// ---------------------------------------------------------------------------
// What the player needs from any film, whatever its renderer.
// ---------------------------------------------------------------------------

export interface RendererLike {
  render(ctx: CanvasRenderingContext2D, t: number, opts: { narration: boolean }): void;
}

export interface AudioCueTarget {
  chime(hue: number, soft?: boolean, quick?: boolean): void;
  tick(): void;
  forge(): void;
}

/** A mark on the scrubber: an arrival or birth of a spark / token. */
export interface FilmTick {
  id: number;
  t: number; // where the mark sits
  start: number; // lit from…
  end: number; // …until
  hue: number;
}

export interface PlayableFilm {
  id: string;
  numeral: string;
  title: string;
  shortTitle: string;
  kicker: string;
  intro: string;
  duration: number;
  shots: Shot[];
  narration: NarrationLine[];
  principles: Principle[];
  styleNotes: string[];
  ticks: FilmTick[];
  tickLabel: string;
  createRenderer(): RendererLike;
  cueAudio(prev: number, t: number, au: AudioCueTarget): void;
}
