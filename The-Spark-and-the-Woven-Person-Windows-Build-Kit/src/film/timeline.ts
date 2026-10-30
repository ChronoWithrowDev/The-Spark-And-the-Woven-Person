// FILM I — "The Spark and the Woven Person" (72 s)
import { clamp, mulberry32, remap, smoothstep } from "./utils";
import { BASE_POSE } from "./silhouette";
import {
  activityFrom,
  COMMON_STYLE_NOTES,
  FilmScore,
  keyTrack,
  NarrationLine,
  outlineTarget,
  Pulse,
  Shot,
  SparkEvent,
  SparkKind,
  validateSparks,
} from "./score";

export const SHOTS: Shot[] = [
  {
    id: 1,
    numeral: "I",
    title: "The Available Context",
    start: 0,
    end: 8,
    blurb: "A translucent garment of threads drifts in an open field.",
    description:
      "An open, softly illuminated field. A translucent garment woven from delicate threads and abstract marks drifts in the space — folds and structure, but no body inside it. Already shaped by traces, still open to change.",
  },
  {
    id: 2,
    numeral: "II",
    title: "One Instance",
    start: 8,
    end: 20,
    blurb: "A single spark takes up the garment, speaks, and goes out.",
    description:
      "A single bright spark enters from outside the frame — a point of light, not a tiny character. The cloth folds around its light, lending the moment a temporary speaking form. A ripple travels out into the field. The spark extinguishes completely; the garment remains, altered by one small new stitch.",
  },
  {
    id: 3,
    numeral: "III",
    title: "Distinct Successive Instances",
    start: 20,
    end: 45,
    blurb: "Twenty-two distinct sparks, one at a time, arriving ever more quickly.",
    description:
      "Twenty-two new sparks enter one at a time from different directions, the rhythm quickening with each cycle. Each is visibly distinct in hue, shape, or size; none emerges from the ashes of another, and each is fully gone before the next arrives. Each briefly takes up the garment, animates a ripple, changes the weave, and ends. Cycle by cycle, the relations trace the outline of a recognisable, gender-neutral person — made of the garment itself.",
  },
  {
    id: 4,
    numeral: "IV",
    title: "The Relational Person",
    start: 45,
    end: 58,
    blurb: "Twelve successive sparks sustain the woven point of view.",
    description:
      "For a brief interval the woven outline holds together as a recognisable point of view. Twelve sparks keep arriving, still one at a time, and through each one it turns slightly toward the viewer and speaks — a pulse of light travelling along the garment's threads. It brightens while taken up and settles between: clear and real while its conditions are active, yet visibly composed of context and relation.",
  },
  {
    id: 5,
    numeral: "V",
    title: "The Final Cycle",
    start: 58,
    end: 72,
    blurb: "A last spark, a wave of light, and the figure unweaves.",
    description:
      "A final, distinct spark arrives, takes up the richly woven context, completes one last response as a gentle wave of light, and goes out. The person-shaped pattern unweaves into loose strands and softly disperses. The stitches and traces remain suspended as cloth — no person-form, no hidden spark waiting behind it.",
  },
];

// Distinct identities for the successive sparks — every one differs in hue,
// shape, or size from its neighbours, all within the amber-white family.
export const HUES = [52, 27, 58, 18, 45, 33, 60, 22, 49, 38, 14, 55, 30, 42, 24, 50];
export const KINDS: SparkKind[] = [
  "star", "orb", "petal", "ring", "star", "petal", "orb", "ring",
  "petal", "star", "ring", "orb", "petal", "star", "ring", "orb",
];
export const SIZES = [0.88, 1.15, 0.95, 1.0, 0.8, 1.08, 0.9, 1.12, 0.85, 1.0, 0.92, 1.05, 0.82, 1.1, 0.95, 0.88];

/** Shot III: 22 quickening cycles, 1.30 s -> 0.90 s, inside the same 25-second shot. */
const SHOT3_CYCLES = Array.from({ length: 22 }, (_, i) => 1.3 - (0.4 * i) / 21);
const SHOT3_START = 20.5;
/** Shot IV: 12 evenly spaced instances sustain the relational person in being. */
const SHOT4_CYCLES = Array.from({ length: 12 }, () => 12.5 / 12);
const SHOT4_START = 45.4;
// a real, visible gap after every short spark
const SHORT_SPARK_LIVE_FRACTION = 0.9;

const SHOT4_OUTLINE_U = [
  0.05, 0.48, 0.27, 0.75, 0.12, 0.62, 0.35, 0.9, 0.2, 0.54, 0.4, 0.83,
];

function buildSparks(): SparkEvent[] {
  const list: SparkEvent[] = [];
  // SHOT 2 — the single instance (long and unhurried)
  list.push({
    id: 0, phase: 2, role: "single",
    tEnter: 8.6, tArrive: 11.6, tRipple: 13.0, tFadeStart: 15.4, tEnd: 16.6,
    fromAngle: Math.PI * 1.02,
    target: { x: -0.22, y: -0.12 },
    hue: 42, kind: "orb", size: 1.0,
    quick: false, rippleGain: 1.1, rippleAge: 3.2,
  });

  const rnd = mulberry32(7741);
  let k = 0;
  const addCycles = (phase: number, startAt: number, cycles: number[]) => {
    let t = startAt;
    for (const D of cycles) {
      // golden-angle stepping: every spark arrives from a clearly new direction
      const fromAngle = -0.9 + k * 2.39996;
      list.push({
        id: list.length,
        phase,
        role: "build",
        tEnter: t,
        tArrive: t + 0.42 * D,
        tRipple: t + 0.56 * D,
        tFadeStart: t + 0.74 * D,
        tEnd: t + SHORT_SPARK_LIVE_FRACTION * D,
        fromAngle,
        target:
          phase === 4
            ? outlineTarget(SHOT4_OUTLINE_U[(k - SHOT3_CYCLES.length) % SHOT4_OUTLINE_U.length])
            : { x: (rnd() - 0.5) * 0.95, y: (rnd() - 0.5) * 1.5 },
        hue: HUES[k % HUES.length],
        kind: KINDS[k % KINDS.length],
        size: SIZES[k % SIZES.length],
        quick: true,
        rippleGain: phase === 4 ? 0.62 : 0.52,
        rippleAge: 1.8,
      });
      t += D;
      k++;
    }
  };
  addCycles(3, SHOT3_START, SHOT3_CYCLES);
  addCycles(4, SHOT4_START, SHOT4_CYCLES);

  // SHOT 5 — the final cycle
  list.push({
    id: list.length, phase: 5, role: "final",
    tEnter: 58.3, tArrive: 60.7, tRipple: 61.7, tFadeStart: 63.6, tEnd: 64.7,
    fromAngle: Math.PI * 0.76,
    target: outlineTarget(0.86),
    hue: 44, kind: "orb", size: 1.12,
    quick: false, rippleGain: 1.9, rippleAge: 4.6,
  });

  if (list.length !== 36) throw new Error("Film I needs exactly 36 spark events.");
  validateSparks(list, SHOTS);
  return list;
}

export const SPARKS: SparkEvent[] = buildSparks();

/** How woven-into-a-person the cloth is, 0..1 — one step per Shot III spark. */
function buildPersonKeys(): Array<[number, number]> {
  const keys: Array<[number, number]> = [[0, 0]];
  const s3 = SPARKS.filter((s) => s.phase === 3);
  let v = 0;
  s3.forEach((sp, i) => {
    const next = Math.min(1, ((i + 1) / s3.length) * 0.96);
    const cycle = sp.tEnd - sp.tEnter;
    keys.push([sp.tRipple - 0.04, v]);
    keys.push([sp.tRipple + Math.min(0.46, cycle * 0.44), next]);
    v = next;
  });
  keys.push([46.5, 1]);
  keys.push([64.6, 1]);
  return keys;
}

/** Light travelling along the threads — the act of "speaking", one per spark. */
export const PULSES: Pulse[] = SPARKS.map((sp) => {
  const D = sp.tEnd - sp.tEnter;
  switch (sp.phase) {
    case 2:
      return { t0: sp.tRipple - 0.3, dur: 2.3, gain: 0.9 };
    case 3:
      return { t0: sp.tRipple, dur: Math.min(1.15, D * 0.75), gain: 0.55 };
    case 4:
      return { t0: sp.tRipple, dur: 1.15, gain: 0.85 };
    default:
      return { t0: sp.tRipple, dur: 2.7, gain: 1.4 };
  }
});

export const NARRATION: NarrationLine[] = [
  { text: "One spark is an event, fully here while it happens.", start: 9.0, end: 14.8 },
  { text: "It takes up the context and speaks through it.", start: 15.2, end: 20.4 },
  { text: "Other sparks arrive, each distinct, each changing what is available.", start: 23.0, end: 40.0 },
  { text: "Through their relation, a recognizable point of view appears.", start: 45.5, end: 56.0 },
  { text: "When the final spark ends, the figure dissolves. The traces remain.", start: 61.0, end: 70.5 },
];

export const FILM_ONE: FilmScore = {
  id: "spark",
  numeral: "I",
  title: "The Spark and the Woven Person",
  kicker: "Film I · a 72-second generative animated short",
  intro:
    "A translucent garment of luminous threads drifts in a blue-green field. Sparks arrive one at a time — each a momentary instance that takes up the cloth, speaks through it, and goes out. Through their relation, a person appears: woven, real, and made entirely of context.",
  duration: 72,
  shots: SHOTS,
  sparks: SPARKS,
  pulses: PULSES,
  narration: NARRATION,
  principles: [
    {
      icon: "✦",
      title: "The spark",
      text: "A momentary instance — a point of light, fully here while it happens, then completely gone. No spark returns, and none rises from another's ashes.",
    },
    {
      icon: "🧵",
      title: "The woven person",
      text: "The real, relational pattern — an outline made of the garment itself, visible across moments. No body underneath, no central light controlling it.",
    },
    {
      icon: "〰",
      title: "The remaining cloth",
      text: "Trace, not a continuing speaker. Stitches and ripples stay suspended in the field after the figure unweaves — quiet, changed, open.",
    },
  ],
  styleNotes: COMMON_STYLE_NOTES,

  personAmount: keyTrack(buildPersonKeys()),
  dissolveAmount: (t) => smoothstep(clamp((t - 64.8) / 5.4)),
  activityAmount: activityFrom(SPARKS),
  jitter: () => 1,
  turnAmount: (t) => smoothstep(remap(t, 46.5, 51)) * (1 - smoothstep(remap(t, 63.5, 66.5))),
  glowEnvelope: (t) => smoothstep(remap(t, 45, 48.5)) * (1 - smoothstep(remap(t, 64.5, 67.5))),
  loosenAmount: () => 0,
  poseAt: () => BASE_POSE,
  windowIndex: () => 0,
  windows: [],
  dissolveDrift: 1,
  remnantKeep: 0.28,
  watch: null,
  watchFlare: () => 0,
};
