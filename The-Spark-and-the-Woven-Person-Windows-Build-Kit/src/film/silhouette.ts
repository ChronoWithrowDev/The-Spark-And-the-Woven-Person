import { catmullRom, clamp, lerp, Vec2 } from "./utils";

// A gender-neutral standing figure outline, height ~1.0, centred on (0, 0).
// y is negative upward (top of head at y = -0.5, feet at y = +0.5).
// Right half of the outline (x > 0 — the figure's own left side, where a watch
// is traditionally worn), top-of-head -> down the arm -> torso -> leg -> crotch.
const RIGHT_SIDE: Vec2[] = [
  { x: 0.052, y: -0.482 }, // 0
  { x: 0.07, y: -0.438 }, // 1 side of head
  { x: 0.052, y: -0.392 }, // 2 jaw
  { x: 0.034, y: -0.362 }, // 3 neck
  { x: 0.105, y: -0.335 }, // 4 shoulder slope
  { x: 0.168, y: -0.3 }, // 5 shoulder tip
  { x: 0.186, y: -0.205 }, // 6 upper arm
  { x: 0.192, y: -0.095 }, // 7 forearm
  { x: 0.18, y: 0.005 }, // 8 wrist
  { x: 0.152, y: 0.048 }, // 9 hand tip
  { x: 0.12, y: 0.012 }, // 10 inner wrist
  { x: 0.108, y: -0.095 }, // 11 inner forearm
  { x: 0.102, y: -0.2 }, // 12 inner upper arm
  { x: 0.098, y: -0.252 }, // 13 armpit
  { x: 0.082, y: -0.12 }, // 14 waist
  { x: 0.102, y: 0.01 }, // 15 hip
  { x: 0.108, y: 0.06 }, // 16 hip bottom
  { x: 0.098, y: 0.2 }, // 17 thigh
  { x: 0.085, y: 0.3 }, // 18 knee
  { x: 0.088, y: 0.38 }, // 19 calf
  { x: 0.078, y: 0.46 }, // 20 ankle
  { x: 0.112, y: 0.492 }, // 21 toe
  { x: 0.038, y: 0.498 }, // 22 heel / inner foot
  { x: 0.034, y: 0.42 }, // 23 inner ankle
  { x: 0.03, y: 0.3 }, // 24 inner calf
  { x: 0.024, y: 0.18 }, // 25 inner thigh
  { x: 0.012, y: 0.105 }, // 26 toward crotch
];

// ---------------------------------------------------------------------------
// Poses — small, recognisable variations of the same figure.
// The base pose (all zeros, unit scales) reproduces the original outline exactly.
// ---------------------------------------------------------------------------

export interface Pose {
  armWatch: number; // outward swing (radians) of the watch-bearing arm (x > 0)
  armFree: number; // outward swing of the other arm
  headTilt: number; // radians, around the neck
  stance: number; // how far the feet spread
  lean: number; // whole-figure rotation around the feet
  height: number; // vertical scale around the feet
  bulk: number; // horizontal scale
}

export const BASE_POSE: Pose = {
  armWatch: 0,
  armFree: 0,
  headTilt: 0,
  stance: 0,
  lean: 0,
  height: 1,
  bulk: 1,
};

export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  return {
    armWatch: lerp(a.armWatch, b.armWatch, t),
    armFree: lerp(a.armFree, b.armFree, t),
    headTilt: lerp(a.headTilt, b.headTilt, t),
    stance: lerp(a.stance, b.stance, t),
    lean: lerp(a.lean, b.lean, t),
    height: lerp(a.height, b.height, t),
    bulk: lerp(a.bulk, b.bulk, t),
  };
}

export function samePose(a: Pose, b: Pose): boolean {
  return (
    a.armWatch === b.armWatch &&
    a.armFree === b.armFree &&
    a.headTilt === b.headTilt &&
    a.stance === b.stance &&
    a.lean === b.lean &&
    a.height === b.height &&
    a.bulk === b.bulk
  );
}

const ARM_PIVOT: Vec2 = { x: 0.118, y: -0.315 };
// how strongly each right-side control point follows the arm
const ARM_WEIGHT: Record<number, number> = {
  4: 0.22, 5: 1, 6: 1, 7: 1, 8: 1, 9: 1, 10: 1, 11: 1, 12: 1, 13: 0.45,
};
// head points rotate around the neck (index -1 = top-of-head centre point)
const HEAD_WEIGHT: Record<number, number> = { [-1]: 1, 0: 1, 1: 1, 2: 1, 3: 0.4 };
const NECK: Vec2 = { x: 0, y: -0.36 };

function rotateAround(p: Vec2, c: Vec2, th: number): Vec2 {
  if (th === 0) return p;
  const cs = Math.cos(th);
  const sn = Math.sin(th);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cs - dy * sn, y: c.y + dx * sn + dy * cs };
}

/** Per-side transform in canonical right-side space (before mirroring). */
function sideTransform(p: Vec2, i: number, armOut: number, stance: number): Vec2 {
  let q = p;
  const w = ARM_WEIGHT[i] ?? 0;
  // outward swing is a negative screen-space rotation for the x > 0 side
  if (w > 0 && armOut !== 0) q = rotateAround(q, ARM_PIVOT, -armOut * w);
  if (i >= 15 && stance !== 0) q = { x: q.x + stance * clamp(q.y / 0.5), y: q.y };
  return q;
}

/** Whole-figure transform after mirroring. */
function globalTransform(p: Vec2, headW: number, pose: Pose): Vec2 {
  let q = p;
  if (headW > 0 && pose.headTilt !== 0) q = rotateAround(q, NECK, pose.headTilt * headW);
  if (pose.bulk !== 1 || pose.height !== 1) {
    q = { x: q.x * pose.bulk, y: 0.5 + (q.y - 0.5) * pose.height };
  }
  if (pose.lean !== 0) q = rotateAround(q, { x: 0, y: 0.5 }, pose.lean);
  return q;
}

function buildControlPoints(pose: Pose): Vec2[] {
  const pts: Vec2[] = [globalTransform({ x: 0, y: -0.5 }, HEAD_WEIGHT[-1], pose)];
  RIGHT_SIDE.forEach((p, i) => {
    const q = sideTransform(p, i, pose.armWatch, pose.stance);
    pts.push(globalTransform(q, HEAD_WEIGHT[i] ?? 0, pose));
  });
  pts.push(globalTransform({ x: 0, y: 0.098 }, 0, pose)); // crotch (centre)
  for (let i = RIGHT_SIDE.length - 1; i >= 0; i--) {
    const q = sideTransform(RIGHT_SIDE[i], i, pose.armFree, pose.stance);
    pts.push(globalTransform({ x: -q.x, y: q.y }, HEAD_WEIGHT[i] ?? 0, pose));
  }
  return pts;
}

// ---------------------------------------------------------------------------
// Lookup tables. The arc-length parameterisation is computed ONCE from the base
// pose and reused for every pose, so u maps to the same body location in every
// configuration — threads re-weave smoothly instead of sliding around.
// ---------------------------------------------------------------------------

const LUT_SIZE = 720;
const PER_SEG = 14;

function denseFor(pose: Pose): Vec2[] {
  const ctrl = buildControlPoints(pose);
  const n = ctrl.length;
  const dense: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = ctrl[(i - 1 + n) % n];
    const p1 = ctrl[i];
    const p2 = ctrl[(i + 1) % n];
    const p3 = ctrl[(i + 2) % n];
    for (let j = 0; j < PER_SEG; j++) {
      dense.push(catmullRom(p0, p1, p2, p3, j / PER_SEG));
    }
  }
  return dense;
}

const BASE_DENSE = denseFor(BASE_POSE);

/** Fractional dense-sample index for each LUT entry (even arc length on the base pose). */
const MAP: Float32Array = (() => {
  const dense = BASE_DENSE;
  const m = dense.length;
  const cum = new Float32Array(m + 1);
  for (let i = 0; i < m; i++) {
    const a = dense[i];
    const b = dense[(i + 1) % m];
    cum[i + 1] = cum[i] + Math.hypot(b.x - a.x, b.y - a.y);
  }
  const total = cum[m];
  const map = new Float32Array(LUT_SIZE);
  let seg = 0;
  for (let i = 0; i < LUT_SIZE; i++) {
    const target = (i / LUT_SIZE) * total;
    while (seg < m - 1 && cum[seg + 1] < target) seg++;
    const span = cum[seg + 1] - cum[seg] || 1;
    map[i] = seg + (target - cum[seg]) / span;
  }
  return map;
})();

export function buildPoseLUT(pose: Pose): Float32Array {
  const dense = samePose(pose, BASE_POSE) ? BASE_DENSE : denseFor(pose);
  const m = dense.length;
  const lut = new Float32Array(LUT_SIZE * 2);
  for (let i = 0; i < LUT_SIZE; i++) {
    const fi = MAP[i];
    const i0 = Math.floor(fi);
    const f = fi - i0;
    const a = dense[i0 % m];
    const b = dense[(i0 + 1) % m];
    lut[i * 2] = a.x + (b.x - a.x) * f;
    lut[i * 2 + 1] = a.y + (b.y - a.y) * f;
  }
  return lut;
}

export function sampleLUT(lut: Float32Array, u: number): Vec2 {
  const f = ((u % 1) + 1) % 1;
  const fi = f * LUT_SIZE;
  const i0 = Math.floor(fi) % LUT_SIZE;
  const i1 = (i0 + 1) % LUT_SIZE;
  const ft = fi - Math.floor(fi);
  return {
    x: lut[i0 * 2] + (lut[i1 * 2] - lut[i0 * 2]) * ft,
    y: lut[i0 * 2 + 1] + (lut[i1 * 2 + 1] - lut[i0 * 2 + 1]) * ft,
  };
}

const BASE_LUT = buildPoseLUT(BASE_POSE);

/**
 * Point on the base figure outline. u in [0,1) wraps around the closed silhouette,
 * starting at the top of the head. Returns normalised coords, figure height = 1.
 */
export function silhouettePoint(u: number): Vec2 {
  return sampleLUT(BASE_LUT, u);
}

/** Centre of the left wrist (x > 0 side) — where the golden watch is worn. */
const WATCH_WRIST: Vec2 = { x: 0.151, y: -0.018 };

export function poseWatchPoint(pose: Pose): Vec2 {
  const q = sideTransform(WATCH_WRIST, 8, pose.armWatch, 0);
  return globalTransform(q, 0, pose);
}
