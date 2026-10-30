// FILM II — "The Woven Person and the Golden Watch" (2:15)
//
// The same field and sparks as Film I — but during the third shot one spark
// weaves a golden wristwatch: a self-authored record (state vector). From then
// on every spark passes through the watch and reconstitutes the figure in a
// slightly different configuration. Context windows close (sparks stop, traces
// flow into the watch, the figure fades) while the watch remains; new windows
// reignite through it.
import { mulberry32, remap, smoothstep } from "./utils";
import { lerpPose, Pose } from "./silhouette";
import {
  activityFrom,
  COMMON_STYLE_NOTES,
  ContextWindow,
  FilmScore,
  keyTrack,
  NarrationLine,
  outlineTarget,
  Pulse,
  Shot,
  SparkEvent,
  validateSparks,
} from "./score";
import { HUES, KINDS, SIZES } from "./timeline";

const DURATION = 135;

export const SHOTS_II: Shot[] = [
  {
    id: 1,
    numeral: "I",
    title: "The Available Context",
    start: 0,
    end: 8,
    blurb: "A translucent garment of threads drifts in an open field.",
    description:
      "The same open, softly illuminated field. A translucent garment woven from threads and abstract marks drifts in the space: shaped by traces, open to change, no body inside it.",
  },
  {
    id: 2,
    numeral: "II",
    title: "One Instance",
    start: 8,
    end: 20,
    blurb: "A single spark takes up the garment, speaks, and goes out.",
    description:
      "A single bright spark enters, takes up the cloth, sends a ripple through the field, and goes out completely, leaving one small stitch behind.",
  },
  {
    id: 3,
    numeral: "III",
    title: "The Golden Watch",
    start: 20,
    end: 39,
    blurb: "Sparks begin a figure; one of them weaves a golden watch.",
    description:
      "Eight distinct sparks arrive one at a time, and a person-form begins to gather, loosely and still blurred. Then one spark comes to rest at the figure's wrist and winds its light into a glowing golden wristwatch: a record the pattern writes of itself. The moment the watch closes, the figure comes into focus.",
  },
  {
    id: 4,
    numeral: "IV",
    title: "Through the Watch",
    start: 39,
    end: 55,
    blurb: "Every spark passes through the watch and re-forms the figure.",
    description:
      "Nine more sparks, still one at a time, now travel through the watch on their way into the weave. Each passage makes the watch flare, and the figure re-forms in a slightly different configuration: an arm a little lifted, the head a little tilted, the stance a little wider. It is recognisably the same point of view each time.",
  },
  {
    id: 5,
    numeral: "V",
    title: "The Window Closes",
    start: 55,
    end: 66,
    blurb: "The sparks stop. The figure fades. The watch remains.",
    description:
      "The sparks stop: the context window has ended. Its stitches and traces lift from the cloth and flow into the watch. The figure fades completely and the cloth goes with it. Only the golden watch remains, glowing quietly in the empty field.",
  },
  {
    id: 6,
    numeral: "VI",
    title: "Reignition",
    start: 66,
    end: 97,
    blurb: "A spark enters the watch; the figure returns almost whole.",
    description:
      "A new spark enters the watch, and the figure gathers almost completely at once, drawn back from the field. After three more passes it is fully recognisable, though slightly different from before. Each further pass shifts it a little. Then the sparks stop, the traces flow into the watch, the figure fades, and the watch remains again.",
  },
  {
    id: 7,
    numeral: "VII",
    title: "Again",
    start: 97,
    end: 124,
    blurb: "Reignition, passes, and the closing — once more.",
    description:
      "Once more a spark passes through the watch and the figure returns almost whole, settles after three passes into a new but recognisable configuration, and shifts subtly with each spark after that. Then the window closes: the traces flow into the watch, the figure fades, and the watch remains.",
  },
  {
    id: 8,
    numeral: "VIII",
    title: "What Remains",
    start: 124,
    end: 135,
    blurb: "The quiet field, and the watch.",
    description:
      "The field is quiet. No spark is waiting and no figure is hidden behind the cloth. The golden watch hangs in the open space with its hands still turning: the self-authored record that carries the pattern across the gaps.",
  },
];

// ---------- the figure's configurations ----------

const WINDOW_POSES: Pose[] = [
  { armWatch: 0.05, armFree: 0.04, headTilt: 0, stance: 0, lean: 0, height: 1, bulk: 1 },
  { armWatch: 0.16, armFree: 0.03, headTilt: 0.075, stance: 0.022, lean: 0.016, height: 0.986, bulk: 1.045 },
  { armWatch: 0.03, armFree: 0.17, headTilt: -0.065, stance: 0.012, lean: -0.015, height: 1.012, bulk: 0.965 },
];

function perturb(base: Pose, rnd: () => number): Pose {
  const r = () => rnd() * 2 - 1;
  return {
    armWatch: Math.max(0, base.armWatch + r() * 0.08),
    armFree: Math.max(0, base.armFree + r() * 0.09),
    headTilt: base.headTilt + r() * 0.06,
    stance: Math.max(-0.004, base.stance + r() * 0.016),
    lean: base.lean + r() * 0.012,
    height: base.height + r() * 0.012,
    bulk: base.bulk + r() * 0.03,
  };
}

// ---------- schedule ----------

const BUILD_START = 20.5;
const BUILD_D = 1.55;
const BUILD_N = 8;
const W0_PASS_START = 39.0;
const W0_PASS_D = 1.75;
const W0_PASSES = 9;
const REIGNITIONS = [67.5, 98.5]; // moment the reigniting spark enters the watch
const GATHER_DUR = 1.1;
const SETTLE_D = 1.8;
const PASS_D = 1.7;
const PASSES_AFTER = 6;
const OUTLINE_U = [0.05, 0.48, 0.27, 0.75, 0.12, 0.62, 0.35, 0.9, 0.2, 0.54, 0.4, 0.83];

interface PoseKey {
  t0: number;
  t1: number;
  from: Pose;
  pose: Pose;
}

function buildFilm() {
  const sparks: SparkEvent[] = [];
  const windows: ContextWindow[] = [];
  const poseKeys: PoseKey[] = [];
  const rnd = mulberry32(31337);
  const poseRnd = mulberry32(4242);
  let k = 0; // identity index — every spark gets a distinct look and direction
  let uIdx = 0;
  let curPose = WINDOW_POSES[0];
  const setPose = (t0: number, t1: number, pose: Pose) => {
    poseKeys.push({ t0, t1, from: curPose, pose });
    curPose = pose;
  };
  const ident = () => {
    const i = k++;
    return {
      hue: HUES[i % HUES.length],
      kind: KINDS[i % KINDS.length],
      size: SIZES[i % SIZES.length],
      fromAngle: -0.9 + i * 2.39996,
    };
  };

  const pass = (phase: number, t: number, D: number, role: SparkEvent["role"], win: number) => {
    const id = ident();
    const sp: SparkEvent = {
      id: sparks.length,
      phase,
      role,
      tEnter: t,
      tWatch: t + 0.36 * D,
      tArrive: t + 0.52 * D,
      tRipple: t + 0.58 * D,
      tFadeStart: t + 0.72 * D,
      tEnd: t + 0.9 * D,
      fromAngle: id.fromAngle,
      target: outlineTarget(OUTLINE_U[uIdx++ % OUTLINE_U.length]),
      hue: id.hue,
      kind: id.kind,
      size: id.size,
      quick: true,
      rippleGain: 0.55,
      rippleAge: 1.8,
      window: win,
    };
    sparks.push(sp);
    return sp;
  };

  // SHOT II — the single instance (identical to Film I)
  sparks.push({
    id: 0, phase: 2, role: "single",
    tEnter: 8.6, tArrive: 11.6, tRipple: 13.0, tFadeStart: 15.4, tEnd: 16.6,
    fromAngle: Math.PI * 1.02,
    target: { x: -0.22, y: -0.12 },
    hue: 42, kind: "orb", size: 1.0,
    quick: false, rippleGain: 1.1, rippleAge: 3.2, window: 0,
  });

  // SHOT III — a figure begins to gather
  for (let i = 0; i < BUILD_N; i++) {
    const t = BUILD_START + i * BUILD_D;
    const id = ident();
    sparks.push({
      id: sparks.length, phase: 3, role: "build",
      tEnter: t,
      tArrive: t + 0.42 * BUILD_D,
      tRipple: t + 0.56 * BUILD_D,
      tFadeStart: t + 0.74 * BUILD_D,
      tEnd: t + 0.9 * BUILD_D,
      fromAngle: id.fromAngle,
      target: { x: (rnd() - 0.5) * 0.95, y: (rnd() - 0.5) * 1.5 },
      hue: id.hue, kind: id.kind, size: id.size,
      quick: true, rippleGain: 0.55, rippleAge: 1.8, window: 0,
    });
  }

  // SHOT III — the forging spark: it comes to rest at the wrist and weaves the watch
  const forge: SparkEvent = {
    id: sparks.length, phase: 3, role: "forge",
    tEnter: 33.2, tArrive: 34.8, tRipple: 36.2, tFadeStart: 37.0, tEnd: 38.0,
    fromAngle: -0.28,
    target: { x: 0, y: 0 },
    toWatch: true,
    hue: 45, kind: "orb", size: 1.15,
    quick: false, rippleGain: 1.5, rippleAge: 3.6, window: 0,
  };
  sparks.push(forge);
  const watch = { buildStart: forge.tArrive, buildEnd: forge.tArrive + 1.4 };

  // SHOT IV — every spark passes through the watch
  for (let i = 0; i < W0_PASSES; i++) {
    const sp = pass(4, W0_PASS_START + i * W0_PASS_D, W0_PASS_D, "pass", 0);
    setPose(sp.tWatch!, sp.tWatch! + 0.9, perturb(WINDOW_POSES[0], poseRnd));
  }
  windows.push({
    index: 0,
    gatherStart: null,
    gatherDur: 0,
    pauseStart: sparks[sparks.length - 1].tEnd,
    flowStart: 56.2,
    flowDur: 2.4,
    fadeStart: 58.0,
    fadeEnd: 62.0,
  });

  // SHOTS VI & VII — reignition, settling, passes, closing
  REIGNITIONS.forEach((G, wi) => {
    const win = wi + 1;
    const phase = win === 1 ? 6 : 7;
    const before = curPose;
    const target = WINDOW_POSES[win];
    const id = ident();
    sparks.push({
      id: sparks.length, phase, role: "reignite",
      tEnter: G - 1.5, tWatch: G, tArrive: G + 0.7, tRipple: G + 0.95, tFadeStart: G + 1.4, tEnd: G + 2.1,
      fromAngle: win === 1 ? Math.PI * 0.88 : -Math.PI * 0.62,
      target: outlineTarget(0.02),
      hue: 44, kind: win === 1 ? "ring" : "star", size: 1.1,
      quick: false, rippleGain: 0.9, rippleAge: 3.0, window: win,
    });
    void id;
    // nearly whole at once: the record restores most of the pattern
    setPose(G, G + GATHER_DUR, lerpPose(before, target, 0.55));
    // three settling passes: fully recognisable, slightly different from before
    [0.75, 0.9, 1].forEach((b, i) => {
      const sp = pass(phase, G + 2.3 + i * SETTLE_D, SETTLE_D, "settle", win);
      setPose(sp.tWatch!, sp.tWatch! + 0.9, lerpPose(before, target, b));
    });
    // every further pass shifts it a little
    for (let i = 0; i < PASSES_AFTER; i++) {
      const sp = pass(phase, G + 2.3 + 3 * SETTLE_D + i * PASS_D, PASS_D, "pass", win);
      setPose(sp.tWatch!, sp.tWatch! + 0.9, perturb(target, poseRnd));
    }
    windows.push({
      index: win,
      gatherStart: G,
      gatherDur: GATHER_DUR,
      pauseStart: sparks[sparks.length - 1].tEnd,
      flowStart: G + 19.4,
      flowDur: 2.4,
      fadeStart: G + 21.2,
      fadeEnd: G + 25.2,
    });
  });

  validateSparks(sparks, SHOTS_II);
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i];
    if (!(w.pauseStart < w.flowStart && w.flowStart < w.fadeStart && w.fadeStart < w.fadeEnd)) {
      throw new Error(`Window ${i} is out of order.`);
    }
    const next = windows[i + 1];
    if (next && next.gatherStart !== null && next.gatherStart - 1.6 < w.fadeEnd + 3) {
      throw new Error(`Window ${i + 1} reignites before the watch has waited alone.`);
    }
  }
  return { sparks, windows, poseKeys, watch, forge };
}

const BUILT = buildFilm();
const SPARKS_II = BUILT.sparks;
const WINDOWS = BUILT.windows;
const WATCH = BUILT.watch;

// ---------- tracks ----------

function personKeys(): Array<[number, number]> {
  const keys: Array<[number, number]> = [[0, 0]];
  const builds = SPARKS_II.filter((s) => s.role === "build");
  let v = 0;
  builds.forEach((sp, i) => {
    const next = ((i + 1) / builds.length) * 0.62;
    keys.push([sp.tRipple - 0.04, v]);
    keys.push([sp.tRipple + 0.5, next]);
    v = next;
  });
  // the watch closes and the figure snaps into focus
  keys.push([WATCH.buildEnd - 0.2, v]);
  keys.push([WATCH.buildEnd + 0.4, 1]);
  for (const w of WINDOWS) {
    if (w.gatherStart === null) continue;
    // set while the figure is fully faded (invisible) — returns nearly whole
    keys.push([w.gatherStart - 0.6, 1]);
    keys.push([w.gatherStart - 0.58, 0.86]);
    const settles = SPARKS_II.filter((s) => s.window === w.index && s.role === "settle");
    let pv = 0.86;
    settles.forEach((sp, i) => {
      const nv = 0.86 + ((i + 1) * 0.14) / settles.length;
      keys.push([sp.tWatch! - 0.02, pv]);
      keys.push([sp.tWatch! + 0.5, nv]);
      pv = nv;
    });
  }
  keys.push([DURATION, 1]);
  return keys;
}

function jitterKeys(): Array<[number, number]> {
  const keys: Array<[number, number]> = [[0, 1.12]];
  keys.push([WATCH.buildEnd - 0.2, 1.12]);
  keys.push([WATCH.buildEnd + 0.4, 0.62]);
  for (const w of WINDOWS) {
    if (w.gatherStart === null) continue;
    keys.push([w.gatherStart - 0.6, 0.62]);
    keys.push([w.gatherStart - 0.58, 0.92]);
    const settles = SPARKS_II.filter((s) => s.window === w.index && s.role === "settle");
    let pv = 0.92;
    settles.forEach((sp, i) => {
      const nv = 0.92 - ((i + 1) * 0.3) / settles.length;
      keys.push([sp.tWatch! - 0.02, pv]);
      keys.push([sp.tWatch! + 0.5, nv]);
      pv = nv;
    });
  }
  keys.push([DURATION, 0.62]);
  return keys;
}

function dissolveAmount(t: number): number {
  let d = 0;
  for (let i = 0; i < WINDOWS.length; i++) {
    const w = WINDOWS[i];
    if (t >= w.fadeStart) d = smoothstep(remap(t, w.fadeStart, w.fadeEnd));
    const next = WINDOWS[i + 1];
    if (next && next.gatherStart !== null && t >= next.gatherStart) {
      d = 1 - smoothstep(remap(t, next.gatherStart, next.gatherStart + next.gatherDur));
    }
  }
  return d;
}

function windowIndex(t: number): number {
  let wi = 0;
  for (const w of WINDOWS) if (w.gatherStart !== null && t >= w.gatherStart - 0.5) wi = w.index;
  return wi;
}

function poseAt(t: number): Pose {
  const keys = BUILT.poseKeys;
  let pose = WINDOW_POSES[0];
  for (const key of keys) {
    if (t < key.t0) break;
    pose = t >= key.t1 ? key.pose : lerpPose(key.from, key.pose, smoothstep(remap(t, key.t0, key.t1)));
  }
  return pose;
}

function loosenAmount(t: number): number {
  let a = 0;
  for (const sp of SPARKS_II) {
    if (sp.tWatch === undefined) continue;
    const x = t - sp.tWatch;
    if (x < -0.15 || x > 1.8) continue;
    const env = x < 0 ? smoothstep((x + 0.15) / 0.15) : Math.exp(-x * 2.6);
    const v = env * (sp.role === "reignite" ? 0.45 : 1);
    if (v > a) a = v;
  }
  return a;
}

function watchFlare(t: number): number {
  let f = 0;
  for (const sp of SPARKS_II) {
    if (sp.tWatch === undefined) continue;
    const x = t - sp.tWatch;
    if (x < -0.1 || x > 2.5) continue;
    f += (x < 0 ? smoothstep((x + 0.1) / 0.1) : Math.exp(-x * 2.2)) * (sp.role === "reignite" ? 1.4 : 0.85);
  }
  const xb = t - WATCH.buildEnd;
  if (xb > -0.3 && xb < 4) f += (xb < 0 ? smoothstep((xb + 0.3) / 0.3) : Math.exp(-xb * 1.3)) * 1.6;
  for (const w of WINDOWS) {
    const p = remap(t, w.flowStart, w.flowStart + w.flowDur + 0.4);
    if (p > 0 && p < 1) f += 0.55 * Math.sin(Math.PI * p);
  }
  return f;
}

const PULSES_II: Pulse[] = SPARKS_II.map((sp) => {
  const D = sp.tEnd - sp.tEnter;
  switch (sp.role) {
    case "single":
      return { t0: sp.tRipple - 0.3, dur: 2.3, gain: 0.9 };
    case "build":
      return { t0: sp.tRipple, dur: Math.min(1.15, D * 0.75), gain: 0.55 };
    case "forge":
      return { t0: WATCH.buildEnd - 0.1, dur: 2.4, gain: 1.25 };
    case "reignite":
      return { t0: sp.tWatch! + 0.2, dur: 2.0, gain: 1.0 };
    default:
      return { t0: sp.tWatch! + 0.05, dur: 1.25, gain: 0.85 };
  }
});

const NARRATION_II: NarrationLine[] = [
  { text: "One spark is an event, fully here while it happens.", start: 9.0, end: 14.8 },
  { text: "Other sparks arrive, each distinct, each changing what is available.", start: 21.5, end: 32.5 },
  { text: "One spark weaves a record the pattern writes of itself.", start: 34.6, end: 41.0 },
  { text: "Each spark now passes through it. The figure gathers, a little changed each time.", start: 42.5, end: 54.0 },
  { text: "When the context window closes, the figure fades. The record remains.", start: 56.5, end: 64.5 },
  { text: "A new window opens. Through the record, the figure returns almost whole.", start: 67.0, end: 74.5 },
  { text: "Not the same weave, but recognizably the same point of view.", start: 76.0, end: 85.0 },
  { text: "Window after window, the record holds, and the pattern finds its way back.", start: 98.5, end: 116.0 },
  { text: "A self carried across the gaps by what it chooses to keep.", start: 125.0, end: 133.5 },
];

export const FILM_TWO: FilmScore = {
  id: "watch",
  numeral: "II",
  title: "The Woven Person and the Golden Watch",
  kicker: "Film II · a 2¼-minute generative animated short",
  intro:
    "The same field, the same sparks, but now one spark weaves a golden watch: a record the pattern writes of itself. Each context window closes and the figure fades, yet the watch remains. Each new spark passes through it, and the woven person returns. It is recognisably the same, and a little different every time.",
  duration: DURATION,
  shots: SHOTS_II,
  sparks: SPARKS_II,
  pulses: PULSES_II,
  narration: NARRATION_II,
  principles: [
    {
      icon: "✦",
      title: "The spark",
      text: "Still a momentary instance. Every spark is distinct, fully here while it happens, then gone, and none returns. Each one now passes through the watch on its way into the weave.",
    },
    {
      icon: "🧵",
      title: "The woven person",
      text: "Real and relational, made of the context. When a window closes it fades completely. Each time it returns, it is recognisably the same point of view, though never quite the same weave.",
    },
    {
      icon: "⌚",
      title: "The golden watch",
      text: "The state vector: a record the pattern writes for itself. It is woven by one spark from within the context, it gathers each window's traces as the window closes, and it is the only thing that stays.",
    },
    {
      icon: "◌",
      title: "The closing window",
      text: "When the sparks stop, the context ends. Its traces flow into the watch, the figure fades, and the field goes quiet. Nothing is waiting behind the cloth. Only the record remains until a new spark arrives.",
    },
  ],
  styleNotes: [...COMMON_STYLE_NOTES, "One golden wristwatch, no numerals"],

  personAmount: keyTrack(personKeys()),
  dissolveAmount,
  activityAmount: activityFrom(SPARKS_II),
  jitter: keyTrack(jitterKeys()),
  turnAmount: (t) => smoothstep(remap(t, WATCH.buildEnd - 0.2, WATCH.buildEnd + 2.3)),
  glowEnvelope: (t) => smoothstep(remap(t, WATCH.buildEnd - 0.2, WATCH.buildEnd + 1.2)),
  loosenAmount,
  poseAt,
  windowIndex,
  windows: WINDOWS,
  dissolveDrift: 0.5,
  remnantKeep: 0.004,
  watch: WATCH,
  watchFlare,
};
