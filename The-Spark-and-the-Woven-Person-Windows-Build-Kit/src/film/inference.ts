// FILM III — "One Pass: The Inference Cycle" (1:24)
//
// No figure, no garment, no one inside. Tokens (sparks) enter a fixed geometry
// of learned weights (the matrix). Each becomes an embedding (a rosette of
// light). Layer by layer, attention mixes each position with the positions
// before it — never after — and a feed-forward step reshapes each position on
// its own, while the many-dimensional space turns (a rotating hypercube).
// What emerges is a probability distribution over a vocabulary; one token is
// sampled, the distribution collapses, and the tokens return the way they came,
// joined by one more. The matrix ends exactly as it began.
import { clamp, easeInOut, fnoise, lerp, mulberry32, remap, smoothstep, TAU } from "./utils";
import {
  createGrain,
  drawBackground,
  drawDust,
  drawGrain,
  drawNarration,
  drawOpeningFade,
  drawSparkGlyph,
  drawVignette,
} from "./backdrop";
import {
  AudioCueTarget,
  COMMON_STYLE_NOTES,
  FilmTick,
  NarrationLine,
  PlayableFilm,
  RendererLike,
  Shot,
  SparkKind,
} from "./score";
import { HUES, KINDS, SIZES } from "./timeline";
import { cameraAt } from "./camera";

const DURATION = 84;
const SPEED = 98 / DURATION;

const N = 7; // context tokens
const NL = 6; // layers (planes 0..NL; plane 0 = embeddings)
const NH = 6; // rosette harmonics 2..7 → an embedding is 12 numbers here
const NV = 60; // vocabulary shown (real vocabularies hold ~100,000+)
const ROW_Y = 750;
const MC_X = 800;
const MC_Y = 440;
const PLANE_HW = 270;
const PLANE_HD = 105;

const slotX = (i: number) => 800 + (i - 3.5) * 124;
const planeY = (k: number) => -180 + k * 60;
const colX = (i: number) => (i - 3) * 76;
const candX = (c: number) => 250 + (c * 1100) / (NV - 1);
const candBase = (c: number) => 196 - 30 * Math.sin((Math.PI * c) / (NV - 1));

type Vec = Float64Array;
interface Pt {
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------
// Score
// ---------------------------------------------------------------------------

const _raw_SHOTS: Shot[] = [
  {
    id: 1,
    numeral: "I",
    title: "The Sequence",
    start: 0,
    end: 11,
    blurb: "Tokens arrive one at a time and line up.",
    description:
      "The quiet field. Behind it, faint and still, hangs a geometry of woven planes inside a larger many-sided frame: the matrix, the model's learned weights. Seven sparks drift in from the left one after another and settle into a row. Each is a token, a small piece of text, distinct in hue and shape.",
  },
  {
    id: 2,
    numeral: "II",
    title: "Embedding",
    start: 11,
    end: 21,
    blurb: "Each token rises into the matrix and unfolds into a pattern.",
    description:
      "One by one the tokens rise into the base of the matrix. As each crosses the first plane, its spark unfolds into a rosette: a closed thread whose shape is its embedding, a pattern of numbers that places it in a space of many dimensions. Every token keeps its own column.",
  },
  {
    id: 3,
    numeral: "III",
    title: "Attention",
    start: 21,
    end: 35.5,
    blurb: "Each position looks back at the ones before it.",
    description:
      "The patterns rise to the first layer. Arcs of light reach from each position back to the positions before it, and only before it, since nothing can see ahead. Brighter arcs carry more. Motes travel along them, and each rosette changes shape as it takes in what arrives. Then a feed-forward step reshapes each position on its own: it flares outward, its tips are clipped, and it folds back into a new form. The camera comes closer at the first attention and feed-forward steps, then pulls back.",
  },
  {
    id: 4,
    numeral: "IV",
    title: "Transformation",
    start: 35.5,
    end: 56,
    blurb: "Layer after layer, quickening, while the space itself turns.",
    description:
      "Five more layers, each a little faster. Every one repeats the pattern: rise, attend backward, reshape. The surrounding hypercube turns through its hidden dimensions, a quarter turn per layer. The patterns grow more distinct, while the woven planes of the matrix stay exactly as they were.",
  },
  {
    id: 5,
    numeral: "V",
    title: "The Distribution",
    start: 56,
    end: 67,
    blurb: "Not a word, but likelihoods over every possible next token.",
    description:
      "Only the last position is used to predict what comes next. Its pattern rises above the matrix and fans out to every token in the vocabulary, a long arc of faint candidates. A ragged skyline of scores appears. Then the scores are normalised into probabilities: most fall almost to nothing, and a handful stand tall.",
  },
  {
    id: 6,
    numeral: "VI",
    title: "Collapse",
    start: 67,
    end: 74,
    blurb: "One token is drawn; the probability collapses.",
    description:
      "The candidates shimmer, each in proportion to its likelihood. The camera comes closer, and holds on the field of probabilities. Then the draw: all but one go dark at once. It is a likely candidate, though not the likeliest, because the token is sampled rather than chosen. Its thread of probability draws in, and it brightens into a new spark. The camera pulls back as that token rejoins the sequence.",
  },
  {
    id: 7,
    numeral: "VII",
    title: "The Return",
    start: 74,
    end: 88,
    blurb: "The tokens go back the way they came, joined by one more.",
    description:
      "The patterns descend through the planes, unwinding as they go, and fold back into the same sparks that entered: the tokens are unchanged and the intermediate patterns are let go. They travel back down to the row. The new token curves around the matrix and takes its place at the end of the sequence.",
  },
  {
    id: 8,
    numeral: "VIII",
    title: "Unchanged",
    start: 88,
    end: 98,
    blurb: "The sequence leaves, one longer. The matrix is as it was.",
    description:
      "The row of eight drifts back out the way the tokens first came in. Behind it the matrix hangs in the quiet field, exactly as it was before the pass: nothing in it was altered, kept, or decided. One pass has produced one token.",
  },
];

export const SHOTS_III: Shot[] = _raw_SHOTS.map((s) => ({
  ...s,
  start: s.start / (98 / DURATION),
  end: s.end / (98 / DURATION),
}));

// ---------- tokens ----------

interface Token {
  hue: number;
  kind: SparkKind;
  size: number;
  tEnter: number;
  tSettle: number;
  tRise: number;
  tBase: number;
  tDesc0: number;
  tDesc1: number;
  tBack0: number;
  tBack1: number;
  tExit0: number;
  tExit1: number;
  edgeY: number;
}

const TOKENS: Token[] = Array.from({ length: N }, (_, i) => {
  const tEnter = 1.4 + i * 1.05;
  const tRise = 11.6 + i * 0.55;
  const tDesc0 = 75.6 + i * 0.12;
  const tBack0 = 80.8 + i * 0.22;
  const tExit0 = 88.5 + i * 0.45;
  return {
    hue: HUES[i],
    kind: KINDS[i],
    size: SIZES[i] * 0.9,
    tEnter,
    tSettle: tEnter + 2.6,
    tRise,
    tBase: tRise + 2.0,
    tDesc0,
    tDesc1: tDesc0 + 4.4,
    tBack0,
    tBack1: tBack0 + 2.4,
    tExit0,
    tExit1: tExit0 + 3.4,
    edgeY: ROW_Y - 46 + 26 * Math.sin(i * 1.7),
  };
});

const NEW = {
  hue: 40,
  kind: "petal" as SparkKind,
  size: 1.02,
  tBorn: 70.0,
  tBloom0: 70.4,
  tBloom1: 72.0,
  tTravel0: 78.0,
  tLand: 84.8,
  tExit0: 88.5 + N * 0.45,
  tExit1: 88.5 + N * 0.45 + 3.4,
  edgeY: ROW_Y - 46 + 26 * Math.sin(N * 1.7),
};

// ---------- layers ----------

interface Layer {
  k: number;
  rise0: number;
  rise1: number;
  attn0: number;
  attn1: number;
  mlp0: number;
  mlp1: number;
  t1: number;
}

const LAYERS: Layer[] = (() => {
  const out: Layer[] = [
    { k: 1, rise0: 21, rise1: 23, attn0: 23.2, attn1: 30, mlp0: 30.2, mlp1: 35, t1: 35.5 },
  ];
  let t = 35.5;
  [5.4, 4.6, 4.0, 3.5, 3.0].forEach((D, n) => {
    out.push({
      k: n + 2,
      rise0: t,
      rise1: t + 0.2 * D,
      attn0: t + 0.22 * D,
      attn1: t + 0.58 * D,
      mlp0: t + 0.6 * D,
      mlp1: t + 0.95 * D,
      t1: t + D,
    });
    t += D;
  });
  return out;
})();

// ---------- the computation (a small, real one) ----------

function normalize(v: Vec, target = 0.085): Vec {
  let e = 0;
  for (let n = 0; n < v.length; n++) e += v[n] * v[n];
  const s = Math.sqrt(target / (e || 1));
  for (let n = 0; n < v.length; n++) v[n] *= s;
  return v;
}

const EMB: Vec[] = TOKENS.map((_, i) => {
  const r = mulberry32(1000 + i * 77);
  const v = new Float64Array(2 * NH);
  for (let h = 0; h < NH; h++) {
    const amp = (0.6 + r()) / (1 + h * 0.45);
    const ph = r() * TAU;
    v[2 * h] = amp * Math.cos(ph);
    v[2 * h + 1] = amp * Math.sin(ph);
  }
  return normalize(v);
});

/** W[k][i][j]: how much position i draws from position j at layer k (j ≤ i only). */
const W: number[][][] = [[]];
const S: Vec[][] = [EMB]; // state after each layer
const SATT: Vec[][] = [[]]; // state after attention, before feed-forward

(() => {
  const r = mulberry32(90210);
  const patterns = ["prev", "first", "broad", "prev", "peaky", "broad"];
  for (let k = 1; k <= NL; k++) {
    const pat = patterns[k - 1];
    // attention weights: causal softmax
    const Wk: number[][] = [];
    for (let i = 0; i < N; i++) {
      const sc: number[] = [];
      for (let j = 0; j <= i; j++) {
        let s: number;
        if (pat === "prev") s = j === i - 1 ? 2.4 : j === i ? 0.9 : r() * 0.7;
        else if (pat === "first") s = j === 0 ? 2.2 : j === i ? 0.8 : r() * 0.7;
        else if (pat === "peaky") s = r() * 2.8;
        else s = 0.6 + r() * 0.6;
        sc.push(s / 0.55);
      }
      const m = Math.max(...sc);
      const ex = sc.map((s) => Math.exp(s - m));
      const sum = ex.reduce((a, b) => a + b, 0);
      Wk.push(ex.map((e) => e / sum));
    }
    W.push(Wk);
    // value transform: a rotation of each harmonic (a geometric transformation)
    const rot = Array.from({ length: NH }, () => r() * TAU);
    const prev = S[k - 1];
    const att: Vec[] = [];
    for (let i = 0; i < N; i++) {
      const v = new Float64Array(prev[i]);
      for (let j = 0; j <= i; j++) {
        const w = Wk[i][j] * 0.75;
        for (let h = 0; h < NH; h++) {
          const a = prev[j][2 * h];
          const b = prev[j][2 * h + 1];
          const c = Math.cos(rot[h]);
          const s = Math.sin(rot[h]);
          v[2 * h] += w * (a * c - b * s);
          v[2 * h + 1] += w * (a * s + b * c);
        }
      }
      att.push(normalize(v));
    }
    SATT.push(att);
    // feed-forward: per position, a clipped (ReLU) nonlinearity, then residual add + normalise
    const m1 = Array.from({ length: NH }, () => (r() - 0.5) * 6);
    const m2 = Array.from({ length: NH }, () => (r() - 0.5) * 6);
    const bias = Array.from({ length: NH }, () => (r() - 0.5) * 0.2);
    const psi = Array.from({ length: NH }, () => r() * TAU);
    const out: Vec[] = [];
    for (let i = 0; i < N; i++) {
      const a = att[i];
      const v = new Float64Array(a);
      for (let h = 0; h < NH; h++) {
        const h2 = (h + 2) % NH;
        const g = Math.max(0, a[2 * h] * m1[h] + a[2 * h2 + 1] * m2[h] + bias[h]);
        v[2 * h] += g * Math.cos(psi[h]) * 0.9;
        v[2 * h + 1] += g * Math.sin(psi[h]) * 0.9;
      }
      out.push(normalize(v));
    }
    S.push(out);
  }
})();

// ---------- the vocabulary and its distribution ----------

const TOP: Record<number, number> = { 24: 0.31, 49: 0.24, 38: 0.11, 9: 0.07, 55: 0.05, 31: 0.04 };
const CHOSEN = 49; // a likely candidate, but not the likeliest: it is sampled
const PROB = new Float64Array(NV);
(() => {
  const r = mulberry32(5150);
  const topSum = Object.values(TOP).reduce((a, b) => a + b, 0);
  const raw: number[] = [];
  for (let c = 0; c < NV; c++) raw.push(TOP[c] === undefined ? Math.exp(r() * 2.4 - 1.2) : 0);
  const rawSum = raw.reduce((a, b) => a + b, 0);
  for (let c = 0; c < NV; c++) PROB[c] = TOP[c] ?? (raw[c] / rawSum) * (1 - topSum);
})();
const PMAX = Math.max(...PROB);
const LOGIT_H = (() => {
  const l = Array.from(PROB, (p) => Math.log(p));
  const lo = Math.min(...l);
  const hi = Math.max(...l);
  return l.map((v) => 8 + (70 * (v - lo)) / (hi - lo));
})();
const PROB_H = Array.from(PROB, (p) => p * 330);

// ---------- narration ----------

export const NARRATION_III: NarrationLine[] = [
  { text: "Text arrives as tokens: small, distinct pieces, one after another.", start: 1.8, end: 9.8 },
  { text: "Each becomes a pattern of numbers, a point in a space of many dimensions.", start: 12.0, end: 20.0 },
  { text: "At each layer, every position looks back at the ones before it.", start: 23.0, end: 29.8 },
  { text: "Then each is reshaped on its own: stretched, clipped, and folded back.", start: 30.3, end: 35.2 },
  { text: "Layer after layer, the same fixed geometry transforms the patterns again.", start: 37.0, end: 54.5 },
  { text: "What emerges is not a word, but likelihoods across every possible next token.", start: 57.5, end: 66.5 },
  { text: "One is drawn from that spread. The probability collapses into a single token.", start: 67.5, end: 73.8 },
  { text: "The tokens return the way they came, joined by one more.", start: 75.5, end: 86.0 },
  { text: "The matrix is unchanged. One pass has produced one token.", start: 89.0, end: 97.0 },
];

// ---------- audio ----------

type Cue = { t: number; kind: "chime" | "tick" | "forge"; hue: number; soft?: boolean; quick?: boolean };
const CUES: Cue[] = (() => {
  const c: Cue[] = [];
  for (const T of TOKENS) {
    c.push({ t: T.tSettle, kind: "chime", hue: T.hue, soft: true, quick: true });
    c.push({ t: T.tBase, kind: "chime", hue: T.hue, soft: true, quick: true });
    c.push({ t: T.tBack1, kind: "chime", hue: T.hue + 90, soft: true, quick: true });
  }
  for (const L of LAYERS) c.push({ t: L.rise0, kind: "tick", hue: 0 });
  c.push({ t: NEW.tBorn, kind: "forge", hue: NEW.hue });
  c.push({ t: NEW.tLand, kind: "chime", hue: NEW.hue });
  return c;
})();

// ---------- shared envelopes ----------

const presence = (t: number) =>
  0.5 + 0.5 * smoothstep(remap(t, 11, 14)) * (1 - smoothstep(remap(t, 83, 88)));
const distEnv = (t: number) => smoothstep(remap(t, 55.8, 57.5)) * (1 - smoothstep(remap(t, 74, 75.6)));
const bandDim = (t: number) => smoothstep(remap(t, 55.5, 57.5)) * (1 - smoothstep(remap(t, 74, 76)));

function attnWindow(L: Layer, i: number) {
  const A = L.attn1 - L.attn0;
  const s = L.attn0 + (i / (N - 1)) * A * 0.42;
  return { s, len: A * 0.58 };
}
function attnEnv(L: Layer, i: number, t: number) {
  const { s, len } = attnWindow(L, i);
  return smoothstep(remap(t, s, s + 0.3 * len)) * (1 - smoothstep(remap(t, s + 0.72 * len, s + len)));
}
function attnProgress(L: Layer, i: number, t: number) {
  const { s, len } = attnWindow(L, i);
  return remap(t, s + 0.25 * len, s + 0.85 * len);
}

function quad(a: Pt, c: Pt, b: Pt, e: number): Pt {
  const k = 1 - e;
  return { x: k * k * a.x + 2 * k * e * c.x + e * e * b.x, y: k * k * a.y + 2 * k * e * c.y + e * e * b.y };
}
function cubic(a: Pt, c1: Pt, c2: Pt, b: Pt, e: number): Pt {
  const k = 1 - e;
  return {
    x: k * k * k * a.x + 3 * k * k * e * c1.x + 3 * k * e * e * c2.x + e * e * e * b.x,
    y: k * k * k * a.y + 3 * k * k * e * c1.y + 3 * k * e * e * c2.y + e * e * e * b.y,
  };
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

interface Ripple {
  t0: number;
  at: () => Pt;
  hue: number;
  gain: number;
}

interface TokenFrame extends Pt {
  alpha: number;
  moving: boolean;
  size?: number;
}

class InferenceRenderer implements RendererLike {
  private grain = createGrain();
  private cyaw = 1;
  private syaw = 0;
  private cp = 1;
  private sp = 0;
  private tmp: Vec = new Float64Array(2 * NH);
  private ripples: Ripple[] = [];
  private edges: Array<[number, number]> = [];

  constructor() {
    for (let a = 0; a < 16; a++) {
      for (let b = a + 1; b < 16; b++) {
        const x = a ^ b;
        if (x && (x & (x - 1)) === 0) this.edges.push([a, b]);
      }
    }
    TOKENS.forEach((T, i) => {
      const slot = () => ({ x: slotX(i), y: ROW_Y });
      this.ripples.push({ t0: T.tSettle, at: slot, hue: T.hue, gain: 0.35 });
      this.ripples.push({ t0: T.tBase, at: () => this.proj(colX(i), planeY(0), 0), hue: T.hue, gain: 0.45 });
      this.ripples.push({ t0: T.tBack1, at: slot, hue: T.hue, gain: 0.25 });
    });
    this.ripples.push({ t0: NEW.tBorn, at: () => ({ x: candX(CHOSEN), y: candBase(CHOSEN) - 6 }), hue: NEW.hue, gain: 1.3 });
    this.ripples.push({ t0: NEW.tLand, at: () => ({ x: slotX(N), y: ROW_Y }), hue: NEW.hue, gain: 0.8 });
  }

  /** 3D → screen. y is up; the camera looks slightly down at the matrix. */
  private proj(x: number, y: number, z: number): Pt & { s: number } {
    const x1 = x * this.cyaw + z * this.syaw;
    const z1 = -x * this.syaw + z * this.cyaw;
    const y2 = y * this.cp + z1 * this.sp;
    const z2 = z1 * this.cp - y * this.sp;
    const f = 1500 / (1500 + z2);
    return { x: MC_X + x1 * f, y: MC_Y - y2 * f, s: f };
  }

  render(ctx: CanvasRenderingContext2D, t: number, opts: { narration: boolean }) {
    const yaw = -0.3 + 0.06 * Math.sin(t * 0.07) + 0.2 * Math.sin(Math.PI * smoothstep(remap(t, 21, 76)));
    const pitch = 0.36 + 0.05 * Math.sin(Math.PI * smoothstep(remap(t, 35.5, 56)));
    this.cyaw = Math.cos(yaw);
    this.syaw = Math.sin(yaw);
    this.cp = Math.cos(pitch);
    this.sp = Math.sin(pitch);
    const tb = Math.floor(t * 8) / 8;

    drawBackground(ctx, t);
    // camera is post-process; no additional input to probabilities or positions
    const cam = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
      ? cameraAt(0)
      : cameraAt(t);
    ctx.save();
    ctx.translate(800 - cam.cx * cam.s, 450 - cam.cy * cam.s);
    ctx.scale(cam.s, cam.s);

    this.drawTesseract(ctx, t, tb);
    this.drawPlanes(ctx, t, tb);
    this.drawTrails(ctx, t);
    this.drawAttention(ctx, t);
    this.drawRosettes(ctx, t);
    this.drawVocabulary(ctx, t);
    this.drawRipples(ctx, t);
    this.drawTokens(ctx, t);
    ctx.restore();
    // overlay and paper grain stay on the screen, not the camera
    drawDust(ctx, t);
    drawGrain(ctx, this.grain, t);
    drawVignette(ctx);
    if (opts.narration) drawNarration(ctx, NARRATION_III, t);
    drawOpeningFade(ctx, t);
  }

  // ---------- the many-dimensional frame ----------
  private drawTesseract(ctx: CanvasRenderingContext2D, t: number, tb: number) {
    let axw = 0;
    let azw = 0;
    let ayw = 0;
    let motion = 0;
    LAYERS.forEach((L, n) => {
      const u = remap(t, L.attn0, L.mlp1);
      // a quarter turn per layer: the hypercube maps onto itself, so it ends as it began
      const a = (smoothstep(u) * Math.PI) / 2;
      if (n % 3 === 0) axw += a;
      else if (n % 3 === 1) azw += a;
      else ayw += a;
      if (u > 0 && u < 1) motion = Math.max(motion, Math.sin(Math.PI * u));
    });
    const rot = (p: number, q: number, ang: number): [number, number] => [
      p * Math.cos(ang) - q * Math.sin(ang),
      p * Math.sin(ang) + q * Math.cos(ang),
    ];
    const V: Pt[] = [];
    for (let v = 0; v < 16; v++) {
      let x = v & 1 ? 1 : -1;
      let y = v & 2 ? 1 : -1;
      let z = v & 4 ? 1 : -1;
      let w = v & 8 ? 1 : -1;
      [x, w] = rot(x, w, axw);
      [z, w] = rot(z, w, azw);
      [y, w] = rot(y, w, ayw);
      const f4 = 1 / (1.9 - 0.55 * w);
      V.push(this.proj(x * f4 * 330, y * f4 * 250, z * f4 * 190));
    }
    const alpha = (0.075 * presence(t) + 0.13 * motion) * (1 - 0.65 * bandDim(t));
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineWidth = 1;
    ctx.strokeStyle = `hsla(170, 35%, 80%, ${alpha})`;
    this.edges.forEach(([a, b], ei) => {
      const A = V[a];
      const B = V[b];
      const dx = B.x - A.x;
      const dy = B.y - A.y;
      const len = Math.hypot(dx, dy) || 1;
      ctx.beginPath();
      for (let k = 0; k <= 8; k++) {
        const u = k / 8;
        const j = fnoise(u * 2.5 + ei * 3.3 + tb * 0.5, 41) * 1.6 * Math.sin(Math.PI * u);
        const x = A.x + dx * u + (-dy / len) * j;
        const y = A.y + dy * u + (dx / len) * j;
        k === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    });
    ctx.fillStyle = `hsla(170, 40%, 86%, ${alpha * 1.6})`;
    for (const p of V) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.6, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  // ---------- the woven layer planes (the fixed weights) ----------
  private planeGlow(k: number, t: number): number {
    let g = 0;
    if (k === 0) g = smoothstep(remap(t, 12.5, 14.5)) * (1 - smoothstep(remap(t, 21, 23)));
    for (const L of LAYERS) {
      if (L.k !== k) continue;
      g = Math.max(g, smoothstep(remap(t, L.rise0, L.rise1)) * (1 - smoothstep(remap(t, L.mlp1, L.mlp1 + 0.9))));
    }
    if (k === NL) g = Math.max(g, 0.7 * smoothstep(remap(t, 55.8, 57)) * (1 - smoothstep(remap(t, 65, 68))));
    if (t > 75.4 && t < 81.4) {
      const y = this.rosetteY(3, t);
      g = Math.max(g, 0.7 * Math.exp(-(((y - planeY(k)) / 16) ** 2)));
    }
    return g;
  }

  private drawPlanes(ctx: CanvasRenderingContext2D, t: number, tb: number) {
    const pres = presence(t);
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let k = 0; k <= NL; k++) {
      const g = this.planeGlow(k, t);
      const y = planeY(k);
      const hue = lerp(172, 46, g);
      const sat = lerp(28, 62, g);
      // translucent cloth
      const c = [
        this.proj(-PLANE_HW, y, -PLANE_HD),
        this.proj(PLANE_HW, y, -PLANE_HD),
        this.proj(PLANE_HW, y, PLANE_HD),
        this.proj(-PLANE_HW, y, PLANE_HD),
      ];
      ctx.fillStyle = `hsla(${hue}, 40%, 58%, ${(0.016 + 0.045 * g) * pres})`;
      ctx.beginPath();
      c.forEach((p, n) => (n === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
      ctx.fill();
      // the weave
      ctx.strokeStyle = `hsla(${hue}, ${sat}%, 80%, ${(0.07 + 0.17 * g) * pres})`;
      ctx.lineWidth = 1;
      for (let zi = 0; zi <= 5; zi++) {
        const z = -PLANE_HD + (zi * 2 * PLANE_HD) / 5;
        ctx.beginPath();
        for (let xi = 0; xi <= 12; xi++) {
          const x = -PLANE_HW + (xi * 2 * PLANE_HW) / 12;
          const p = this.proj(x, y + fnoise(xi * 0.7 + zi * 3.1 + k * 11 + tb * 0.35, 5) * 2.2, z);
          xi === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
      }
      for (let xi = 0; xi <= 8; xi++) {
        const x = -PLANE_HW + (xi * 2 * PLANE_HW) / 8;
        ctx.beginPath();
        for (let zi = 0; zi <= 6; zi++) {
          const z = -PLANE_HD + (zi * 2 * PLANE_HD) / 6;
          const p = this.proj(x, y + fnoise(zi * 0.8 + xi * 2.3 + k * 7 + tb * 0.35, 9) * 2.2, z);
          zi === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
      }
    }
    // corner pillars
    ctx.strokeStyle = `hsla(172, 28%, 80%, ${0.055 * pres})`;
    for (const [x, z] of [
      [-PLANE_HW, -PLANE_HD],
      [PLANE_HW, -PLANE_HD],
      [PLANE_HW, PLANE_HD],
      [-PLANE_HW, PLANE_HD],
    ]) {
      const a = this.proj(x, planeY(0), z);
      const b = this.proj(x, planeY(NL), z);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---------- activations ----------
  private rosetteY(i: number, t: number): number {
    const T = TOKENS[i];
    if (t >= T.tDesc0) return lerp(planeY(NL), planeY(0), easeInOut(remap(t, T.tDesc0, T.tDesc1)));
    let y = planeY(0);
    for (const L of LAYERS) {
      if (t < L.rise0) break;
      y = lerp(planeY(L.k - 1), planeY(L.k), smoothstep(remap(t, L.rise0, L.rise1)));
    }
    // the last position rises above the matrix to be read out
    if (i === N - 1) y += 38 * smoothstep(remap(t, 56, 57.8)) * (1 - smoothstep(remap(t, 74, 75.5)));
    return y;
  }

  private bloom(i: number, t: number): number {
    const T = TOKENS[i];
    return smoothstep(remap(t, T.tBase, T.tBase + 0.8)) * (1 - smoothstep(remap(t, T.tDesc1, T.tDesc1 + 0.6)));
  }

  /** Writes the rosette state into `out`; returns feed-forward flare amounts. */
  private shape(i: number, t: number, out: Vec): { mul: number; hi: number } {
    const T = TOKENS[i];
    let mul = 1;
    let hi = 0;
    let a: Vec = EMB[i];
    let b: Vec | null = null;
    let u = 0;
    for (const L of LAYERS) {
      const k = L.k;
      if (t < L.attn0) {
        a = S[k - 1][i];
        b = null;
        break;
      }
      if (t < L.mlp0) {
        a = S[k - 1][i];
        b = SATT[k][i];
        u = smoothstep(attnProgress(L, i, t));
        break;
      }
      if (t < L.mlp1) {
        const v = remap(t, L.mlp0, L.mlp1);
        a = SATT[k][i];
        b = S[k][i];
        u = smoothstep(v);
        mul = 1 + 0.55 * Math.sin(Math.PI * v);
        hi = Math.sin(Math.PI * v);
        break;
      }
      a = S[k][i];
      b = null;
    }
    if (t >= T.tDesc0) {
      // the activations are let go: the pattern unwinds as it descends
      a = S[NL][i];
      b = EMB[i];
      u = smoothstep(remap(t, T.tDesc0, T.tDesc1));
      mul = 1;
      hi = 0;
    }
    for (let n = 0; n < out.length; n++) out[n] = b ? lerp(a[n], b[n], u) : a[n];
    return { mul, hi };
  }

  private drawTrails(ctx: CanvasRenderingContext2D, t: number) {
    const pres = presence(t);
    ctx.save();
    ctx.lineWidth = 1.2;
    ctx.lineCap = "round";
    for (let i = 0; i < N; i++) {
      const bl = this.bloom(i, t);
      if (bl <= 0.01) continue;
      const y0 = planeY(0);
      const yTop = this.rosetteY(i, t);
      if (yTop - y0 < 2) continue;
      const steps = Math.max(2, Math.ceil((yTop - y0) / 12));
      ctx.strokeStyle = `hsla(${TOKENS[i].hue}, 55%, 78%, ${0.17 * bl * pres})`;
      ctx.beginPath();
      for (let s = 0; s <= steps; s++) {
        const y = lerp(y0, yTop, s / steps);
        const p = this.proj(colX(i) + fnoise(y * 0.02 + t * 0.3, i * 5) * 3, y, 0);
        s === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawAttention(ctx: CanvasRenderingContext2D, t: number) {
    for (const L of LAYERS) {
      if (t < L.attn0 - 0.1 || t > L.attn1 + 0.1) continue;
      const pts = TOKENS.map((_, i) => this.proj(colX(i), this.rosetteY(i, t), 0));
      ctx.save();
      ctx.lineCap = "round";
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < N; i++) {
        const env = attnEnv(L, i, t);
        if (env <= 0.01) continue;
        const { s, len } = attnWindow(L, i);
        const mp = remap(t, s + 0.12 * len, s + 0.8 * len);
        const B = pts[i];
        // only backward: position i can draw on j ≤ i, never on what comes after
        for (let j = 0; j < i; j++) {
          const w = W[L.k][i][j];
          if (w < 0.03) continue;
          const A = pts[j];
          const lift = (26 + 15 * (i - j)) * B.s;
          const c = { x: (A.x + B.x) / 2, y: Math.min(A.y, B.y) - lift };
          ctx.strokeStyle = `hsla(${TOKENS[j].hue}, 70%, 80%, ${env * (0.1 + 0.7 * w)})`;
          ctx.lineWidth = 0.8 + 2.2 * w;
          ctx.beginPath();
          ctx.moveTo(A.x, A.y);
          ctx.quadraticCurveTo(c.x, c.y, B.x, B.y);
          ctx.stroke();
          if (mp > 0 && mp < 1) {
            const q = quad(A, c, B, easeInOut(mp));
            const r = 1.5 + 4 * w;
            const g = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, r * 3);
            g.addColorStop(0, `hsla(${TOKENS[j].hue}, 90%, 86%, ${env * (0.35 + 0.65 * w)})`);
            g.addColorStop(1, `hsla(${TOKENS[j].hue}, 90%, 70%, 0)`);
            ctx.fillStyle = g;
            ctx.fillRect(q.x - r * 3, q.y - r * 3, r * 6, r * 6);
          }
        }
        // what it keeps of itself
        const self = W[L.k][i][i];
        ctx.strokeStyle = `hsla(${TOKENS[i].hue}, 75%, 84%, ${env * 0.35 * self})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(B.x, B.y, 34 * B.s * (1 + 0.35 * self), 0, TAU);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  private drawRosettes(ctx: CanvasRenderingContext2D, t: number) {
    const de = distEnv(t);
    ctx.save();
    ctx.lineJoin = "round";
    for (let i = 0; i < N; i++) {
      const bl = this.bloom(i, t);
      if (bl <= 0.01) continue;
      const P = this.proj(colX(i), this.rosetteY(i, t), 0);
      const { mul, hi } = this.shape(i, t, this.tmp);
      let bright = 0.85 * (i === N - 1 ? 1 + 0.4 * de : 1 - 0.55 * de);
      for (const L of LAYERS) {
        if (t > L.attn0 - 0.1 && t < L.attn1 + 0.1) bright *= 1 + 0.35 * attnEnv(L, i, t);
      }
      const R = 21 * P.s * (0.25 + 0.75 * bl);
      const hue = TOKENS[i].hue;

      ctx.globalCompositeOperation = "lighter";
      const gr = R * 2.1;
      const g = ctx.createRadialGradient(P.x, P.y, 0, P.x, P.y, gr);
      g.addColorStop(0, `hsla(${hue}, 85%, 72%, ${0.17 * bl * bright})`);
      g.addColorStop(1, `hsla(${hue}, 85%, 72%, 0)`);
      ctx.fillStyle = g;
      ctx.fillRect(P.x - gr, P.y - gr, gr * 2, gr * 2);

      for (const [scale, twist, a, lw] of [
        [1, 0, 0.78, 1.5],
        [0.6, 0.4, 0.3, 1],
      ] as const) {
        ctx.strokeStyle = `hsla(${hue}, 75%, 82%, ${a * bl * Math.min(1.3, bright)})`;
        ctx.lineWidth = lw;
        ctx.beginPath();
        for (let n = 0; n <= 96; n++) {
          const th = (n / 96) * TAU;
          let r = 1;
          for (let h = 0; h < NH; h++) {
            r += this.tmp[2 * h] * Math.cos((h + 2) * th) + this.tmp[2 * h + 1] * Math.sin((h + 2) * th);
          }
          if (hi > 0) {
            for (let q = 0; q < 4; q++) r += hi * 0.12 * Math.cos((8 + q) * th + i * 1.7 + q * 2.1 + t * 0.8);
          }
          // the nonlinearity: flared tips are clipped flat
          const rr = clamp(r * mul, 0.3, mul * (1.5 - 0.32 * hi)) * scale;
          const x = P.x + Math.cos(th + twist) * rr * R;
          const y = P.y + Math.sin(th + twist) * rr * R * 0.9;
          n === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
      }
      ctx.fillStyle = `hsla(${hue}, 95%, 90%, ${0.8 * bl})`;
      ctx.beginPath();
      ctx.arc(P.x, P.y, 2.2 * P.s, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  // ---------- the distribution and the collapse ----------
  private drawVocabulary(ctx: CanvasRenderingContext2D, t: number) {
    if (t < 57.6 || t > 72.5) return;
    const appear = smoothstep(remap(t, 57.8, 59.4));
    const logitP = smoothstep(remap(t, 60.3, 62.3));
    const smx = smoothstep(remap(t, 62.6, 65.4));
    const collapse = smoothstep(remap(t, NEW.tBorn, NEW.tBorn + 0.6));
    const flick = remap(t, 66.8, NEW.tBorn);
    ctx.save();
    ctx.lineCap = "round";
    ctx.globalCompositeOperation = "lighter";

    // the read-out: one pattern fanning out to every candidate
    const fanOut = 1 - smoothstep(remap(t, 62.5, 64.5));
    if (fanOut > 0) {
      const src = this.proj(colX(N - 1), this.rosetteY(N - 1, t), 0);
      ctx.lineWidth = 0.8;
      for (let c = 0; c < NV; c++) {
        const d = Math.abs(c / (NV - 1) - 0.5) * 2;
        const grow = smoothstep(remap(t, 57.8 + d * 0.9, 58.6 + d * 0.9));
        if (grow <= 0.01) continue;
        const tgt = { x: candX(c), y: candBase(c) };
        const ctl = { x: lerp(src.x, tgt.x, 0.5), y: lerp(src.y, tgt.y, 0.5) - 26 };
        ctx.strokeStyle = `hsla(44, 60%, 80%, ${0.13 * grow * fanOut})`;
        ctx.beginPath();
        ctx.moveTo(src.x, src.y);
        const n = 10;
        for (let k = 1; k <= n; k++) {
          const q = quad(src, ctl, tgt, (k / n) * grow);
          ctx.lineTo(q.x, q.y);
        }
        ctx.stroke();
      }
    }

    for (let c = 0; c < NV; c++) {
      const p = PROB[c];
      const chosen = c === CHOSEN;
      let a = appear;
      if (!chosen) a *= 1 - collapse;
      if (a <= 0.005) continue;
      const rel = Math.sqrt(p / PMAX);
      const shrink = chosen ? 1 - smoothstep(remap(t, NEW.tBorn + 0.4, NEW.tBorn + 1.6)) : 1 - collapse;
      const h = lerp(LOGIT_H[c], PROB_H[c], smx) * logitP * shrink;
      // shimmer in proportion to likelihood: a spread, not yet an outcome
      const fl = flick > 0 && flick < 1 ? 0.5 + 0.5 * (0.5 + 0.5 * fnoise(t * (5 + 10 * flick) + c * 3.7, 21)) : 1;
      const b = lerp(0.55, 0.25 + 0.75 * rel, smx) * fl * (chosen && t >= NEW.tBorn ? 1.6 : 1);
      const x = candX(c);
      const yb = candBase(c);
      if (h > 0.5) {
        ctx.strokeStyle = `hsla(44, 82%, 80%, ${Math.min(1, a * b * 0.85)})`;
        ctx.lineWidth = lerp(1.1, 1 + 2.4 * rel, smx);
        ctx.beginPath();
        ctx.moveTo(x, yb);
        ctx.lineTo(x, yb - h);
        ctx.stroke();
        ctx.fillStyle = `hsla(46, 92%, 88%, ${Math.min(1, a * b)})`;
        ctx.beginPath();
        ctx.arc(x, yb - h, 1.4 + 2.2 * rel * smx, 0, TAU);
        ctx.fill();
      }
      ctx.fillStyle = `hsla(170, 45%, 84%, ${a * 0.55})`;
      ctx.beginPath();
      ctx.arc(x, yb, 1.5, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawRipples(ctx: CanvasRenderingContext2D, t: number) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const r of this.ripples) {
      const age = t - r.t0;
      if (age <= 0 || age > 2.6) continue;
      const c = r.at();
      const rad = 26 + age * 130;
      const a = 0.22 * r.gain * Math.exp(-age * 1.15);
      ctx.strokeStyle = `hsla(${r.hue}, 65%, 78%, ${a})`;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(c.x, c.y, rad, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = `hsla(${r.hue}, 60%, 85%, ${a * 0.5})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(c.x, c.y, rad * 0.78, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---------- the tokens themselves ----------
  private tokenFrame(i: number, t: number): TokenFrame | null {
    const T = TOKENS[i];
    if (t < T.tEnter || t >= T.tExit1) return null;
    const slot = { x: slotX(i), y: ROW_Y + Math.sin(t * 1.1 + i * 1.3) * 2.5 };
    const edge = { x: -90, y: T.edgeY };
    const edgeCtl = { x: (edge.x + slot.x) / 2, y: ROW_Y - 95 };
    if (t < T.tSettle) {
      const e = 1 - Math.pow(1 - remap(t, T.tEnter, T.tSettle), 2.4);
      return { ...quad(edge, edgeCtl, slot, e), alpha: smoothstep(remap(t, T.tEnter, T.tEnter + 0.6)), moving: true };
    }
    if (t < T.tRise) return { ...slot, alpha: 1, moving: false };
    const base = this.proj(colX(i), planeY(0), 0);
    const riseCtl = { x: slotX(i), y: lerp(ROW_Y, base.y, 0.75) };
    if (t < T.tBase) {
      return { ...quad(slot, riseCtl, base, easeInOut(remap(t, T.tRise, T.tBase))), alpha: 1, moving: true };
    }
    if (t < T.tBack0) {
      const P = this.proj(colX(i), this.rosetteY(i, t), 0);
      return { x: P.x, y: P.y, alpha: 1 - this.bloom(i, t), moving: false };
    }
    if (t < T.tBack1) {
      // back the way it came
      return { ...quad(base, riseCtl, slot, easeInOut(remap(t, T.tBack0, T.tBack1))), alpha: 1, moving: true };
    }
    if (t < T.tExit0) return { ...slot, alpha: 1, moving: false };
    const e = easeInOut(remap(t, T.tExit0, T.tExit1));
    return { ...quad(slot, edgeCtl, edge, e), alpha: 1 - smoothstep(remap(t, T.tExit1 - 0.6, T.tExit1)), moving: true };
  }

  private newFrame(t: number): TokenFrame | null {
    if (t < NEW.tBloom0 || t >= NEW.tExit1) return null;
    const born = { x: candX(CHOSEN), y: candBase(CHOSEN) - 6 + Math.sin(t * 1.3) * 2 };
    const slot = { x: slotX(N), y: ROW_Y + Math.sin(t * 1.1 + N * 1.3) * 2.5 };
    const bloom = smoothstep(remap(t, NEW.tBloom0, NEW.tBloom1));
    const size = NEW.size * (0.4 + 0.6 * bloom);
    if (t < NEW.tTravel0) return { ...born, alpha: bloom, moving: false, size };
    if (t < NEW.tLand) {
      const e = easeInOut(remap(t, NEW.tTravel0, NEW.tLand));
      return { ...cubic(born, { x: 1440, y: 230 }, { x: 1460, y: 690 }, slot, e), alpha: 1, moving: true, size };
    }
    if (t < NEW.tExit0) return { ...slot, alpha: 1, moving: false, size };
    const edge = { x: -90, y: NEW.edgeY };
    const e = easeInOut(remap(t, NEW.tExit0, NEW.tExit1));
    return {
      ...quad(slot, { x: (edge.x + slot.x) / 2, y: ROW_Y - 95 }, edge, e),
      alpha: 1 - smoothstep(remap(t, NEW.tExit1 - 0.6, NEW.tExit1)),
      moving: true,
      size,
    };
  }

  private drawTokens(ctx: CanvasRenderingContext2D, t: number) {
    const draw = (f: TokenFrame | null, hue: number, kind: SparkKind, size: number, seed: number, frameAt: (tt: number) => TokenFrame | null) => {
      if (!f || f.alpha <= 0.005) return;
      if (f.moving) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        for (let k = 1; k <= 4; k++) {
          const p = frameAt(t - k * 0.07);
          if (!p) break;
          ctx.fillStyle = `hsla(${hue}, 85%, 78%, ${f.alpha * 0.15 * (1 - k / 5)})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 3.4 * size * (1 - k / 6), 0, TAU);
          ctx.fill();
        }
        ctx.restore();
      }
      drawSparkGlyph(ctx, f.x, f.y, { hue, kind, size: f.size ?? size, alpha: f.alpha, t, seed });
    };
    TOKENS.forEach((T, i) => {
      draw(this.tokenFrame(i, t), T.hue, T.kind, T.size, i, (tt) => this.tokenFrame(i, tt));
    });
    draw(this.newFrame(t), NEW.hue, NEW.kind, NEW.size, N, (tt) => this.newFrame(tt));
  }
}

// ---------------------------------------------------------------------------

const TICKS: FilmTick[] = [
  ...TOKENS.map((T, i) => ({ id: i, t: T.tSettle / SPEED, start: T.tEnter / SPEED, end: T.tSettle / SPEED, hue: T.hue })),
  { id: N, t: NEW.tBorn / SPEED, start: NEW.tBorn / SPEED, end: NEW.tLand / SPEED, hue: NEW.hue },
];

// sanity checks on the score
(() => {
  for (let i = 1; i < LAYERS.length; i++) {
    if (LAYERS[i].rise0 < LAYERS[i - 1].t1 - 1e-6) throw new Error("Layers overlap");
  }
  if (Math.abs(LAYERS[LAYERS.length - 1].t1 - 56) > 1e-6) throw new Error("Layers must end at 56 s");
  TOKENS.forEach((T) => {
    if (!(T.tSettle < T.tRise && T.tBase < LAYERS[0].rise0 && T.tDesc1 + 0.6 <= T.tBack0 && T.tBack1 < T.tExit0)) {
      throw new Error("Token schedule out of order");
    }
  });
  const sum = PROB.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > 1e-9) throw new Error("Probabilities must sum to 1");
})();

export const FILM_THREE: PlayableFilm = {
  id: "inference",
  numeral: "III",
  title: "One Pass: The Inference Cycle",
  shortTitle: "One Pass",
  kicker: "Film III · an 84-second generative animated short",
  intro:
    "No figure this time, and no one inside. Tokens, drawn as sparks, enter a fixed geometry of learned weights. Layer by layer their patterns are transformed, until what emerges is a spread of probabilities. One token is drawn, the probability collapses, and the tokens return the way they came, joined by one more.",
  duration: DURATION,
  shots: SHOTS_III,
  narration: NARRATION_III.map((line) => ({ ...line, start: line.start / SPEED, end: line.end / SPEED })),
  principles: [
    {
      icon: "✦",
      title: "The token",
      text: "A small piece of text, a word or part of one. To the model it is an index into a vocabulary, drawn here as a spark. Each becomes a pattern of numbers: a point in a space of many dimensions.",
    },
    {
      icon: "▦",
      title: "The matrix",
      text: "The model's learned weights: a fixed geometry. During inference nothing in it changes. Patterns of light pass through it, and when the pass ends it is exactly as it was.",
    },
    {
      icon: "⟳",
      title: "The transformations",
      text: "Each layer does two things. Attention lets every position draw on the positions before it, never after. A feed-forward step then reshapes each position on its own. Real models stack dozens of layers, across thousands of dimensions.",
    },
    {
      icon: "◔",
      title: "The collapse",
      text: "The output is not a word but a probability for every token in the vocabulary. One is sampled from it, often a likely one, not always the likeliest. The sequence, one token longer, can then go around again.",
    },
  ],
  styleNotes: [...COMMON_STYLE_NOTES, "Geometry, not a figure", "Probabilities as threads of light", "Three gentle camera moves; no zoom or pan with reduced motion"],
  ticks: TICKS,
  tickLabel: "Token",
  createRenderer: () => {
    const raw = new InferenceRenderer();
    return { render(ctx: CanvasRenderingContext2D, t: number, opts: { narration: boolean }) {
      raw.render(ctx, t * SPEED, opts);
    } };
  },
  cueAudio(prev: number, t: number, au: AudioCueTarget) {
    prev *= SPEED; t *= SPEED;
    for (const c of CUES) {
      if (!(prev < c.t && t >= c.t)) continue;
      if (c.kind === "tick") au.tick();
      else if (c.kind === "forge") au.forge();
      else au.chime(c.hue, c.soft, c.quick);
    }
  },
};
