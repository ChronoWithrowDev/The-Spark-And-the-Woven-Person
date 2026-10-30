// FILM IV — "One Pass, in Current" (1:26)
//
// The same pass as Film III, seen as the physical machine that performs it.
// The network is not wired into the chip: its weights wait in stacks of memory
// as electric charge. For each layer they stream along the wires into the SAME
// array of multiply-accumulate circuits, where diagonal waves of arithmetic
// sweep across, paced by a clock. Working numbers live in a small on-chip
// memory (one column per token). At the end, a row of probabilities is held in
// registers; a random number is compared with their running sum, and where it
// falls, one token is chosen. The working numbers are cleared; the weights in
// memory end exactly as they began. Current is drawn as light, slowed by many
// orders of magnitude.
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
  keyTrack,
  NarrationLine,
  PlayableFilm,
  RendererLike,
  Shot,
  SparkKind,
} from "./score";
import { HUES, KINDS, SIZES } from "./timeline";
import { cameraAt, CameraKey } from "./camera";

const DURATION = 86;
const N = 7; // tokens in the sequence
const NL = 6; // layers
const D = 5; // activation width shown per token (real models: thousands)
const NV = 48; // vocabulary shown (real vocabularies: ~100,000+)
const ROW_Y = 772;
const PORT = { x: 800, y: 656 };
const PKG = { x0: 300, y0: 165, x1: 1300, y1: 640 };
const DIE = { x0: 540, y0: 222, x1: 1060, y1: 572 };
const GRID_C = 14;
const GRID_R = 9;
const CAND_Y = 156;
const GAUGE_Y = 188;
const GAUGE_X0 = 420;
const GAUGE_X1 = 1180;
const RNG = { x: 1028, y: 254 };

const slotX = (i: number) => 800 + (i - 3.5) * 112;
const colS = (i: number) => 800 + (i - 3) * 46;
const tileX = (c: number) => 800 + (c - 6.5) * 26;
const tileY = (r: number) => 372 + (r - 4) * 26;
const cellY = (m: number) => 513 + m * 8.5;
const candX = (c: number) => 420 + (c * 760) / (NV - 1);
const CAND_SP = 760 / (NV - 1);

interface Pt {
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------
// Paths — every wire is a polyline that current can travel along
// ---------------------------------------------------------------------------

interface Path {
  pts: Pt[];
  cum: number[];
  len: number;
}

function mkPath(pts: Pt[]): Path {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  return { pts, cum, len: cum[cum.length - 1] || 1 };
}

function along(p: Path, u: number): Pt {
  const d = clamp(u) * p.len;
  let i = 1;
  while (i < p.cum.length - 1 && p.cum[i] < d) i++;
  const seg = p.cum[i] - p.cum[i - 1] || 1;
  const f = (d - p.cum[i - 1]) / seg;
  const a = p.pts[i - 1];
  const b = p.pts[i];
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

const reversed = (p: Path) => mkPath([...p.pts].reverse());

// ---------- memory stacks ----------

interface Stack {
  x: number;
  y: number;
  side: -1 | 1;
}
const STACKS: Stack[] = [
  { x: 395, y: 300, side: -1 },
  { x: 395, y: 500, side: -1 },
  { x: 1205, y: 300, side: 1 },
  { x: 1205, y: 500, side: 1 },
];
const memRowY = (s: Stack, b: number) => s.y - 56 + b * 16; // band 0 = embeddings, 1..6 = layers, 7 = output
const memColX = (s: Stack, c: number) => s.x - 46 + c * 10.2;

const MEMV: number[][][] = (() => {
  const r = mulberry32(31415);
  return STACKS.map(() => Array.from({ length: 8 }, () => Array.from({ length: 10 }, () => r())));
})();

// interposer wires: memory → the edges of the compute array
const TRACES: Path[][] = STACKS.map((s, si) =>
  Array.from({ length: 8 }, (_, m) => {
    const start = { x: s.x + s.side * 60, y: s.y - 49 + m * 14 };
    const jx = s.side < 0 ? 468 + m * 8 : 1132 - m * 8;
    const row = si % 2 === 0 ? Math.floor(m / 2) : 5 + Math.floor(m / 2);
    const ty = tileY(row) + (m % 2 ? 5 : -5);
    const edge = s.side < 0 ? 618 : 982;
    return mkPath([start, { x: jx, y: start.y }, { x: jx, y: ty }, { x: edge, y: ty }]);
  }),
);

// ---------- tokens ----------

interface Tok {
  hue: number;
  kind: SparkKind;
  size: number;
  tEnter: number;
  tSettle: number;
  tRise: number;
  tPort: number;
  tBack0: number;
  tBack1: number;
  tExit0: number;
  tExit1: number;
  edgeY: number;
  stack: number;
}

const TOKENS: Tok[] = Array.from({ length: N }, (_, i) => {
  const tEnter = 1.2 + i * 0.8;
  const tRise = 9.0 + i * 0.55;
  const tBack0 = 69.0 + i * 0.3;
  const tExit0 = 78.0 + i * 0.4;
  return {
    hue: HUES[i],
    kind: KINDS[i],
    size: SIZES[i] * 0.9,
    tEnter,
    tSettle: tEnter + 2.2,
    tRise,
    tPort: tRise + 1.1,
    tBack0,
    tBack1: tBack0 + 1.2,
    tExit0,
    tExit1: tExit0 + 3.2,
    edgeY: ROW_Y - 46 + 26 * Math.sin(i * 1.7),
    stack: i % 2 === 0 ? 1 : 3,
  };
});
const ioT = (T: Tok) => [T.tPort, T.tPort + 0.45] as const;
const reqT = (T: Tok) => [T.tPort + 0.45, T.tPort + 0.9] as const;
const respT = (T: Tok) => [T.tPort + 1.0, T.tPort + 1.65] as const;

// the I/O link: port → on-chip memory column
const IO: Path[] = TOKENS.map((_, i) =>
  mkPath([PORT, { x: 800, y: 600 }, { x: colS(i), y: 600 }, { x: colS(i), y: 553 }]),
);
// the lookup: column → embedding row in memory, and back
const REQ: Path[] = TOKENS.map((T, i) => {
  const s = STACKS[T.stack];
  const sideX = s.side < 0 ? 552 : 1048;
  const y0 = memRowY(s, 0);
  return mkPath([
    { x: colS(i), y: 553 },
    { x: colS(i), y: 563 },
    { x: sideX, y: 563 },
    { x: sideX, y: y0 },
    { x: s.x + s.side * 60, y: y0 },
    { x: s.x, y: y0 },
  ]);
});
const RESP: Path[] = REQ.map(reversed);
// column ↔ compute array
const BUS_UP: Path[] = TOKENS.map((_, i) => mkPath([{ x: colS(i), y: 505 }, { x: colS(i), y: 266 }]));
const BUS_DN: Path[] = BUS_UP.map(reversed);
// attention routes: only from earlier columns (j) to later ones (i)
const ATT: Path[][] = TOKENS.map((_, i) =>
  TOKENS.map((__, j) => {
    const yh = 489 - 13 * Math.max(1, i - j);
    return mkPath([
      { x: colS(j), y: 505 },
      { x: colS(j), y: yh },
      { x: colS(i), y: yh },
      { x: colS(i), y: 505 },
    ]);
  }),
);
// read-out: compute array → output registers
const FAN: Path[] = Array.from({ length: NV }, (_, c) => {
  const gx = tileX(0) + (c / (NV - 1)) * (tileX(GRID_C - 1) - tileX(0));
  return mkPath([
    { x: gx, y: 266 },
    { x: gx, y: 238 },
    { x: candX(c), y: 202 },
    { x: candX(c), y: CAND_Y + 4 },
  ]);
});

// ---------- layers ----------

interface Layer {
  k: number;
  wA0: number;
  wA1: number;
  up0: number;
  up1: number;
  s10: number;
  s11: number;
  at0: number;
  at1: number;
  wB0: number;
  wB1: number;
  s20: number;
  s21: number;
  dn0: number;
  dn1: number;
  t1: number;
}

const LAYERS: Layer[] = (() => {
  const out: Layer[] = [
    {
      k: 1,
      wA0: 16.0, wA1: 18.2, up0: 18.0, up1: 18.7, s10: 18.6, s11: 20.4,
      at0: 20.5, at1: 24.3, wB0: 24.4, wB1: 25.7, s20: 25.8, s21: 28.0,
      dn0: 28.0, dn1: 28.9, t1: 30.0,
    },
  ];
  let t = 30;
  [5.6, 4.9, 4.4, 4.0, 3.6].forEach((Dt, n) => {
    const f = (x: number) => t + x * Dt;
    out.push({
      k: n + 2,
      wA0: f(0), wA1: f(0.16), up0: f(0.14), up1: f(0.22), s10: f(0.2), s11: f(0.34),
      at0: f(0.34), at1: f(0.58), wB0: f(0.58), wB1: f(0.68), s20: f(0.68), s21: f(0.84),
      dn0: f(0.84), dn1: f(0.93), t1: f(1),
    });
    t += Dt;
  });
  return out;
})();

const RO = { w0: 52.6, w1: 54.4, up0: 54.2, up1: 54.8, s0: 54.7, s1: 56.1, fan0: 56.1, fan1: 57.2, logit0: 56.8, logit1: 58.0, smx0: 58.4, smx1: 60.2 };
const DRAW = { gauge0: 61.5, rng0: 61.8, rng1: 62.6, cur0: 63.0, stop: 65.2, dark0: 65.5, dark1: 66.1, bloom0: 65.8, bloom1: 66.8, fade0: 67.0, fade1: 68.0 };
const CLEAR0 = 67.8;

const NEW = {
  hue: 40,
  kind: "petal" as SparkKind,
  size: 1.0,
  out0: 72.0,
  out1: 73.5,
  land: 75.0,
  exit0: 78.0 + N * 0.4,
  exit1: 78.0 + N * 0.4 + 3.2,
  edgeY: ROW_Y - 46 + 26 * Math.sin(N * 1.7),
};

interface Wave {
  t0: number;
  dur: number;
  ffn: boolean;
  ro: boolean;
}
const WAVES: Wave[] = [
  ...LAYERS.flatMap((L) => [
    { t0: L.s10, dur: L.s11 - L.s10, ffn: false, ro: false },
    { t0: L.s20, dur: L.s21 - L.s20, ffn: true, ro: false },
  ]),
  { t0: RO.s0, dur: RO.s1 - RO.s0, ffn: false, ro: true },
];

interface Stream {
  s0: number;
  s1: number;
  band: number;
  dens: number;
}
const STREAMS: Stream[] = [
  ...LAYERS.flatMap((L) => [
    { s0: L.wA0, s1: L.wA1, band: L.k, dens: 3 },
    { s0: L.wB0, s1: L.wB1, band: L.k, dens: 2 },
  ]),
  { s0: RO.w0, s1: RO.w1, band: 7, dens: 5 },
];

// ---------- the computation (small, but real) ----------

const norm = (v: number[]) => {
  const m = Math.hypot(...v) || 1;
  return v.map((x) => x / m);
};
const lerpV = (a: number[], b: number[], u: number) => a.map((x, n) => lerp(x, b[n], u));

const W: number[][][] = [[]];
const S: number[][][] = [];
const SATT: number[][][] = [[]];
(() => {
  const r = mulberry32(2718);
  S.push(TOKENS.map(() => norm(Array.from({ length: D }, () => r() * 2 - 1))));
  const pats = ["prev", "first", "broad", "prev", "peaky", "broad"];
  const mat = (sc: number) => Array.from({ length: D }, () => Array.from({ length: D }, () => (r() - 0.5) * sc));
  const mul = (M: number[][], v: number[]) => M.map((row) => row.reduce((a, w, n) => a + w * v[n], 0));
  for (let k = 1; k <= NL; k++) {
    const pat = pats[k - 1];
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
      const mx = Math.max(...sc);
      const ex = sc.map((s) => Math.exp(s - mx));
      const sum = ex.reduce((a, b) => a + b, 0);
      Wk.push(ex.map((e) => e / sum)); // causal softmax: j ≤ i only
    }
    W.push(Wk);
    const M = mat(1.2);
    const A = mat(2.4);
    const B = mat(1.6);
    const bias = Array.from({ length: D }, () => (r() - 0.5) * 0.3);
    const prev = S[k - 1];
    const att = prev.map((x, i) => {
      const v = [...x];
      for (let j = 0; j <= i; j++) {
        const mv = mul(M, prev[j]);
        for (let n = 0; n < D; n++) v[n] += 0.75 * Wk[i][j] * mv[n];
      }
      return norm(v);
    });
    SATT.push(att);
    S.push(
      att.map((a) => {
        const h = mul(A, a).map((x, n) => Math.max(0, x + bias[n])); // the clip
        const o = mul(B, h);
        return norm(a.map((x, n) => x + 0.8 * o[n]));
      }),
    );
  }
})();

// ---------- the distribution and the draw ----------

const TOP: Record<number, number> = { 14: 0.29, 31: 0.22, 22: 0.1, 6: 0.07, 40: 0.05, 27: 0.04 };
const CH = 31; // a likely token, though not the likeliest: it is drawn, not picked
const PROB = new Float64Array(NV);
(() => {
  const r = mulberry32(8086);
  const topSum = Object.values(TOP).reduce((a, b) => a + b, 0);
  const raw: number[] = [];
  for (let c = 0; c < NV; c++) raw.push(TOP[c] === undefined ? Math.exp(r() * 2.4 - 1.2) : 0);
  const rawSum = raw.reduce((a, b) => a + b, 0);
  for (let c = 0; c < NV; c++) PROB[c] = TOP[c] ?? (raw[c] / rawSum) * (1 - topSum);
})();
const CUMB = new Float64Array(NV + 1); // running sum before candidate c
for (let c = 0; c < NV; c++) CUMB[c + 1] = CUMB[c] + PROB[c];
const U = CUMB[CH] + 0.6 * PROB[CH]; // the random number (fixed here so the film is repeatable)
const PMAX = Math.max(...PROB);
const LOGIT_H = (() => {
  const l = Array.from(PROB, (p) => Math.log(p));
  const lo = Math.min(...l);
  const hi = Math.max(...l);
  return l.map((v) => 6 + (50 * (v - lo)) / (hi - lo));
})();
const PROB_H = Array.from(PROB, (p) => p * 300);
const STEP = (DRAW.stop - DRAW.cur0) / (CH + 0.6);
const MARKER_X = GAUGE_X0 + U * (GAUGE_X1 - GAUGE_X0);
const RNG_PATH = mkPath([
  { x: RNG.x, y: RNG.y - 14 },
  { x: RNG.x, y: 206 },
  { x: MARKER_X, y: 206 },
  { x: MARKER_X, y: GAUGE_Y + 9 },
]);
const OUT_PATH = mkPath([
  { x: candX(CH), y: CAND_Y - 14 },
  { x: candX(CH), y: 206 },
  { x: 800, y: 206 },
  { x: 800, y: 600 },
  PORT,
]);

// ---------- score ----------

export const SHOTS_IV: Shot[] = [
  {
    id: 1,
    numeral: "I",
    title: "The Circuit",
    start: 0,
    end: 9,
    blurb: "A chip, its memory, and the wires between them.",
    description:
      "The quiet field, and a hand-drawn circuit. In the centre is a chip: an array of small multiply-and-add circuits, a strip of working memory, and a branching clock tree pulsing faintly. On either side are stacks of memory, where the model's weights rest as electric charge. Seven tokens drift in and line up below. (A real model often spans many chips; one is shown.)",
  },
  {
    id: 2,
    numeral: "II",
    title: "Lookup",
    start: 9,
    end: 16,
    blurb: "Each token is fetched from memory as a pattern of charge.",
    description:
      "One by one the tokens travel to the chip's port and become current. Each sends a request along the wires to the embedding table in memory, and a burst of charge returns: its embedding, now a column of numbers in the working memory.",
  },
  {
    id: 3,
    numeral: "III",
    title: "One Layer, Slowly",
    start: 16,
    end: 30,
    blurb: "Weights stream in; waves of arithmetic sweep the array.",
    description:
      "The first layer's weights light up in every memory stack and stream along the wires into the computing array. The working numbers rise to meet them, and a diagonal wave of multiplication and addition sweeps across. Then current runs between the columns, always from earlier positions to later ones. More weights stream in, a second wave passes, and some values are clipped to zero. The results flow back down, and each column has changed.",
  },
  {
    id: 4,
    numeral: "IV",
    title: "The Same Circuits, Again",
    start: 30,
    end: 52.5,
    blurb: "Every layer runs on the same array. Only the weights differ.",
    description:
      "Five more layers, each quicker than the last, and every one runs on the same circuits. What changes is which band of memory lights up. The network lives in memory, not in the wiring. The chip warms as the work accumulates. Real chips do this billions of times a second; here it is slowed by many orders of magnitude.",
  },
  {
    id: 5,
    numeral: "V",
    title: "The Spread",
    start: 52.5,
    end: 61,
    blurb: "A row of registers holds a probability for every token.",
    description:
      "The final weights stream in, and only the last column rises into the array. A last wave passes, and current fans out to a long row of output registers, one per token in the vocabulary. A ragged skyline of scores appears and is normalised into probabilities: most fall almost to nothing, and a few stand tall.",
  },
  {
    id: 6,
    numeral: "VI",
    title: "The Draw",
    start: 61,
    end: 68,
    blurb: "A random number meets a running sum.",
    description:
      "A small circuit produces a random number, and a marker drops onto a gauge. A cursor sweeps along the row, adding each probability to a running sum. Where the sum crosses the marker, the cursor stops: that token is the output. It is a likely one, though not the likeliest. There is no deliberation, only comparison. The rest go dark.",
  },
  {
    id: 7,
    numeral: "VII",
    title: "The Return",
    start: 68,
    end: 77,
    blurb: "The working numbers are cleared; the tokens go back.",
    description:
      "The columns of working memory are wiped. The tokens re-emerge from the port and travel back to the row. The chosen token travels as current down through the chip and out the same port, and takes its place at the end of the sequence.",
  },
  {
    id: 8,
    numeral: "VIII",
    title: "Unchanged",
    start: 77,
    end: 86,
    blurb: "The current stops. The weights are exactly as they were.",
    description:
      "The row of eight drifts back out the way it came. The chip cools and the clock ticks on. In the memory stacks every point of charge is exactly as it was before the pass: read, never written.",
  },
];

export const NARRATION_IV: NarrationLine[] = [
  { text: "Beneath the mathematics is a circuit: memory, wires, and billions of switches.", start: 1.4, end: 8.4 },
  { text: "Each token is looked up in memory and arrives as a pattern of electric charge.", start: 9.2, end: 15.0 },
  { text: "For each layer, its weights stream out of memory into the same array of circuits.", start: 15.6, end: 18.6 },
  { text: "Waves of multiplication and addition sweep through it, paced by a clock.", start: 18.8, end: 22.4 },
  { text: "Each position draws only on those before it; then values are clipped and reshaped.", start: 22.6, end: 28.8 },
  { text: "Layer after layer, the same circuits work again. The network lives in memory, not in wiring.", start: 31.0, end: 51.0 },
  { text: "At the end, a spread of probabilities, held as numbers in a row of registers.", start: 53.0, end: 60.5 },
  { text: "A random number is compared with their running sum. Where it falls, one token is chosen.", start: 61.6, end: 67.6 },
  { text: "The token is sent back out. The working numbers are cleared.", start: 68.4, end: 76.0 },
  { text: "The current stops. The weights in memory are exactly as they were.", start: 78.5, end: 85.5 },
];

export const CAMERA_IV: CameraKey[] = [
  { name: "Memory — weights leaving as charge", at: 15.2, to: 17.8, zoom: 1.9, x: 470, y: 400, zoomIn: 1.3, pullBack: 1.3 },
  { name: "Attention — current between positions", at: 19.6, to: 23.9, zoom: 1.85, x: 800, y: 455, zoomIn: 1.1, pullBack: 1.2 },
  { name: "Feed-forward — the wave, and the clipping", at: 25.5, to: 27.9, zoom: 1.6, x: 800, y: 372, zoomIn: 0.9, pullBack: 1.3 },
  { name: "The draw — a random number and a running sum", at: 61.0, to: 66.6, zoom: 1.75, x: 800, y: 205, zoomIn: 1.4, pullBack: 1.6 },
];

const heatAt = keyTrack([[0, 0], [16, 0], [30, 0.35], [52, 0.75], [60, 1], [70, 0.75], [84, 0.12], [86, 0.1]]);
const actAt = keyTrack([[0, 0.15], [15, 0.15], [16.5, 1], [66, 1], [69, 0.3], [86, 0.15]]);
const winEnv = (t: number, s0: number, s1: number, ramp = 0.25) =>
  smoothstep(remap(t, s0, s0 + ramp)) * (1 - smoothstep(remap(t, s1 - ramp, s1)));

function attnWin(L: Layer, i: number) {
  const A = L.at1 - L.at0;
  return { s: L.at0 + (i / (N - 1)) * A * 0.45, len: A * 0.55 };
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

interface Frame extends Pt {
  alpha: number;
  moving: boolean;
  size: number;
}

class CurrentRenderer implements RendererLike {
  private grain = createGrain();
  private hsegs: Array<{ a: Pt; b: Pt; o: number }> = [];
  private board: Path[] = [];
  private clip: boolean[][] = [];
  private tileSeed: number[][] = [];

  constructor() {
    const h = (cx: number, cy: number, w: number, hh: number, d: number) => {
      const x0 = cx - w / 2;
      const x1 = cx + w / 2;
      const y0 = cy - hh / 2;
      const y1 = cy + hh / 2;
      this.hsegs.push({ a: { x: x0, y: cy }, b: { x: x1, y: cy }, o: d * 2 });
      this.hsegs.push({ a: { x: x0, y: y0 }, b: { x: x0, y: y1 }, o: d * 2 + 1 });
      this.hsegs.push({ a: { x: x1, y: y0 }, b: { x: x1, y: y1 }, o: d * 2 + 1 });
      if (d < 2) for (const [x, y] of [[x0, y0], [x0, y1], [x1, y0], [x1, y1]]) h(x, y, w / 2, hh / 2, d + 1);
    };
    h(800, 372, 170, 104, 0);

    const r = mulberry32(777);
    for (let n = 0; n < 6; n++) {
      const y = 214 + n * 72 + r() * 20;
      const jx = 130 + r() * 110;
      const y2 = y + (r() - 0.5) * 90;
      const pts = [{ x: PKG.x0, y }, { x: jx + 50, y }, { x: jx, y: y2 }, { x: -20, y: y2 }];
      this.board.push(mkPath(pts));
      this.board.push(mkPath(pts.map((p) => ({ x: 1600 - p.x, y: p.y + 14 }))));
    }
    for (let c = 0; c < GRID_C; c++) {
      this.clip.push([]);
      this.tileSeed.push([]);
      for (let rr = 0; rr < GRID_R; rr++) {
        this.clip[c].push(r() < 0.36);
        this.tileSeed[c].push(r());
      }
    }
  }

  render(ctx: CanvasRenderingContext2D, t: number, opts: { narration: boolean }) {
    const tb = Math.floor(t * 8) / 8;
    drawBackground(ctx, t);

    const reduce =
      typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const cam = cameraAt(reduce ? 0 : t, CAMERA_IV);
    ctx.save();
    ctx.translate(800 - cam.cx * cam.s, 450 - cam.cy * cam.s);
    ctx.scale(cam.s, cam.s);

    this.drawBoard(ctx);
    this.drawPackage(ctx, tb);
    this.drawTraces(ctx, t);
    this.drawStacks(ctx, t);
    this.drawDie(ctx, t, tb);
    this.drawRoutes(ctx, t);
    this.drawDistribution(ctx, t);
    this.drawHeat(ctx, t);
    this.drawPulses(ctx, t);
    this.drawTokens(ctx, t);

    ctx.restore();
    drawDust(ctx, t);
    drawGrain(ctx, this.grain, t);
    drawVignette(ctx);
    if (opts.narration) drawNarration(ctx, NARRATION_IV, t);
    drawOpeningFade(ctx, t);
  }

  // ---------- helpers ----------
  private rrect(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x0 + r, y0);
    ctx.lineTo(x1 - r, y0);
    ctx.quadraticCurveTo(x1, y0, x1, y0 + r);
    ctx.lineTo(x1, y1 - r);
    ctx.quadraticCurveTo(x1, y1, x1 - r, y1);
    ctx.lineTo(x0 + r, y1);
    ctx.quadraticCurveTo(x0, y1, x0, y1 - r);
    ctx.lineTo(x0, y0 + r);
    ctx.quadraticCurveTo(x0, y0, x0 + r, y0);
    ctx.closePath();
  }

  /** A hand-drawn outline: the shape, plus a second pass that wanders slightly. */
  private sketch(
    ctx: CanvasRenderingContext2D,
    x0: number, y0: number, x1: number, y1: number, r: number,
    seed: number, tb: number, color: string, a: number,
  ) {
    ctx.strokeStyle = `hsla(${color}, ${a})`;
    ctx.lineWidth = 1.1;
    this.rrect(ctx, x0, y0, x1, y1, r);
    ctx.stroke();
    const ox = fnoise(tb * 0.9 + seed, 3) * 1.4;
    const oy = fnoise(tb * 0.9 + seed + 7, 3) * 1.4;
    ctx.strokeStyle = `hsla(${color}, ${a * 0.45})`;
    this.rrect(ctx, x0 + ox, y0 + oy, x1 + ox, y1 + oy, r);
    ctx.stroke();
  }

  private strokePath(ctx: CanvasRenderingContext2D, p: Path) {
    ctx.beginPath();
    ctx.moveTo(p.pts[0].x, p.pts[0].y);
    for (let i = 1; i < p.pts.length; i++) ctx.lineTo(p.pts[i].x, p.pts[i].y);
    ctx.stroke();
  }

  /** A packet of current: a bright head with a fading trail. */
  private pulse(ctx: CanvasRenderingContext2D, p: Path, u: number, hue: number, a: number, r = 2.4, sat = 90) {
    if (u <= 0 || u >= 1 || a <= 0.01) return;
    const step = 7 / p.len;
    for (let k = 5; k >= 1; k--) {
      const uu = u - k * step;
      if (uu <= 0) continue;
      const q = along(p, uu);
      ctx.fillStyle = `hsla(${hue}, ${sat}%, 78%, ${a * 0.22 * (1 - k / 6)})`;
      ctx.beginPath();
      ctx.arc(q.x, q.y, r * (1 - k / 7), 0, TAU);
      ctx.fill();
    }
    const h = along(p, u);
    ctx.fillStyle = `hsla(${hue}, ${sat}%, 72%, ${a * 0.2})`;
    ctx.beginPath();
    ctx.arc(h.x, h.y, r * 3, 0, TAU);
    ctx.fill();
    ctx.fillStyle = `hsla(${hue}, 100%, 92%, ${a})`;
    ctx.beginPath();
    ctx.arc(h.x, h.y, r, 0, TAU);
    ctx.fill();
  }

  // ---------- the board and package ----------
  private drawBoard(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.lineWidth = 1.4;
    ctx.lineJoin = "round";
    ctx.strokeStyle = "hsla(172, 30%, 72%, 0.05)";
    for (const p of this.board) this.strokePath(ctx, p);
    ctx.restore();
  }

  private drawPackage(ctx: CanvasRenderingContext2D, tb: number) {
    ctx.save();
    ctx.fillStyle = "hsla(176, 30%, 30%, 0.09)";
    this.rrect(ctx, PKG.x0, PKG.y0, PKG.x1, PKG.y1, 18);
    ctx.fill();
    this.sketch(ctx, PKG.x0, PKG.y0, PKG.x1, PKG.y1, 18, 1, tb, "172, 28%, 74%", 0.14);
    // contact pads around the edge
    ctx.fillStyle = "hsla(172, 30%, 78%, 0.07)";
    for (let x = PKG.x0 + 24; x < PKG.x1 - 10; x += 30) {
      for (const y of [PKG.y0 + 9, PKG.y1 - 9]) {
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, TAU);
        ctx.fill();
      }
    }
    // the port
    ctx.strokeStyle = "hsla(172, 35%, 80%, 0.3)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(PORT.x, PORT.y, 7, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = "hsla(172, 30%, 78%, 0.09)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(PORT.x, PORT.y - 7);
    ctx.lineTo(800, 600);
    ctx.lineTo(colS(0), 600);
    ctx.moveTo(800, 600);
    ctx.lineTo(colS(N - 1), 600);
    ctx.stroke();
    ctx.restore();
  }

  private streamEnv(t: number, band: number): number {
    let e = 0;
    for (const s of STREAMS) if (s.band === band) e = Math.max(e, winEnv(t, s.s0, s.s1));
    return e;
  }

  private drawTraces(ctx: CanvasRenderingContext2D, t: number) {
    let e = 0;
    for (const s of STREAMS) e = Math.max(e, winEnv(t, s.s0, s.s1));
    ctx.save();
    ctx.lineWidth = 1;
    ctx.lineJoin = "round";
    ctx.strokeStyle = `hsla(${lerp(172, 46, e)}, ${lerp(28, 60, e)}%, 78%, ${0.09 + 0.12 * e})`;
    for (const tr of TRACES) for (const p of tr) this.strokePath(ctx, p);
    ctx.restore();
  }

  // ---------- memory: the weights at rest, as charge ----------
  private rowGlow(si: number, b: number, t: number): number {
    let g = this.streamEnv(t, b);
    if (b === 0) {
      for (const T of TOKENS) {
        if (T.stack !== si) continue;
        g = Math.max(g, winEnv(t, T.tPort + 0.75, T.tPort + 1.35, 0.15));
      }
    }
    return g;
  }

  private drawStacks(ctx: CanvasRenderingContext2D, t: number) {
    ctx.save();
    STACKS.forEach((s, si) => {
      for (let l = 3; l >= 0; l--) {
        const ox = -s.side * l * 4;
        const oy = l * 5;
        ctx.fillStyle = `hsla(178, 30%, ${22 + l * 2}%, ${0.32 - l * 0.05})`;
        this.rrect(ctx, s.x - 60 + ox, s.y - 70 + oy, s.x + 60 + ox, s.y + 70 + oy, 6);
        ctx.fill();
        ctx.strokeStyle = `hsla(172, 28%, 76%, ${0.16 - l * 0.03})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      for (let b = 0; b < 8; b++) {
        const g = this.rowGlow(si, b, t);
        for (let c = 0; c < 10; c++) {
          const base = MEMV[si][b][c];
          const sh = g > 0 ? g * (0.6 + 0.4 * Math.sin(t * 14 - c * 0.9 - si)) : 0;
          ctx.fillStyle = `hsla(${lerp(176, 46, sh)}, ${lerp(35, 85, sh)}%, ${70 + 18 * sh}%, ${0.16 + 0.3 * base + 0.6 * sh})`;
          ctx.beginPath();
          ctx.arc(memColX(s, c), memRowY(s, b), 1.5 + 0.7 * base + 0.6 * sh, 0, TAU);
          ctx.fill();
        }
      }
    });
    ctx.restore();
  }

  // ---------- the chip ----------
  private loaded(c: number, t: number): number {
    const edge = Math.min(c, GRID_C - 1 - c) / ((GRID_C - 1) / 2);
    const ramp = (w0: number, w1: number, out0: number) => {
      const a = w0 + (w1 - w0) * (0.25 + 0.5 * edge);
      return smoothstep(remap(t, a, a + 0.3 * (w1 - w0) + 0.05)) * (1 - smoothstep(remap(t, out0, out0 + 0.5)));
    };
    for (const L of LAYERS) {
      if (t < L.wA0) return 0;
      if (t <= L.dn1 + 0.5) return ramp(L.wA0, L.wA1, L.dn1);
    }
    if (t >= RO.w0 && t <= RO.fan1 + 0.5) return ramp(RO.w0, RO.w1, RO.fan1);
    return 0;
  }

  private drawDie(ctx: CanvasRenderingContext2D, t: number, tb: number) {
    const act = actAt(t);
    ctx.save();
    ctx.fillStyle = "rgba(8, 30, 28, 0.55)";
    this.rrect(ctx, DIE.x0, DIE.y0, DIE.x1, DIE.y1, 10);
    ctx.fill();
    this.sketch(ctx, DIE.x0, DIE.y0, DIE.x1, DIE.y1, 10, 4, tb, "172, 30%, 76%", 0.24);
    // power mesh
    ctx.strokeStyle = "hsla(172, 25%, 70%, 0.035)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = DIE.x0 + 13; x < DIE.x1; x += 26) {
      ctx.moveTo(x, DIE.y0 + 4);
      ctx.lineTo(x, DIE.y1 - 4);
    }
    for (let y = DIE.y0 + 13; y < DIE.y1; y += 26) {
      ctx.moveTo(DIE.x0 + 4, y);
      ctx.lineTo(DIE.x1 - 4, y);
    }
    ctx.stroke();

    // the clock tree: every tick spreads from the centre to the leaves
    const phase = (t % 0.5) / 0.5;
    ctx.lineCap = "round";
    for (const sgm of this.hsegs) {
      const local = (phase - sgm.o * 0.07) / 0.2;
      const br = local > 0 && local < 1 ? Math.sin(Math.PI * local) : 0;
      ctx.strokeStyle = `hsla(${lerp(176, 50, br)}, 45%, 78%, ${0.06 + br * (0.06 + 0.26 * act)})`;
      ctx.lineWidth = 1 + br * 0.8;
      ctx.beginPath();
      ctx.moveTo(sgm.a.x, sgm.a.y);
      ctx.lineTo(sgm.b.x, sgm.b.y);
      ctx.stroke();
    }

    // the multiply-accumulate array
    for (let c = 0; c < GRID_C; c++) {
      const ld = this.loaded(c, t);
      for (let r = 0; r < GRID_R; r++) {
        const x = tileX(c);
        const y = tileY(r);
        let flash = 0;
        let dark = 0;
        const q = c + r;
        for (const w of WAVES) {
          if (t < w.t0 - 0.3 || t > w.t0 + w.dur + 0.6) continue;
          const tq = w.t0 + (q / (GRID_C + GRID_R - 2)) * w.dur * 0.78;
          const sg = 0.05 + 0.05 * w.dur;
          flash = Math.max(flash, Math.exp(-(((t - tq) / sg) ** 2)) * (w.ro ? 1.15 : w.ffn ? 1 : 0.85));
          if (w.ffn && this.clip[c][r]) {
            dark = Math.max(
              dark,
              smoothstep(remap(t, tq + sg, tq + 2 * sg)) * (1 - smoothstep(remap(t, w.t0 + w.dur, w.t0 + w.dur + 0.4))),
            );
          }
        }
        ctx.fillStyle = `hsla(42, 60%, 55%, ${0.03 + 0.12 * ld})`;
        this.rrect(ctx, x - 9.5, y - 9.5, x + 9.5, y + 9.5, 3);
        ctx.fill();
        ctx.strokeStyle = `hsla(${lerp(172, 44, ld)}, 32%, 76%, ${0.13 + 0.1 * ld + 0.04 * this.tileSeed[c][r]})`;
        ctx.lineWidth = 1;
        ctx.stroke();
        if (flash > 0.02) {
          ctx.save();
          ctx.globalCompositeOperation = "lighter";
          ctx.fillStyle = `hsla(46, 95%, 74%, ${0.7 * flash})`;
          this.rrect(ctx, x - 9.5, y - 9.5, x + 9.5, y + 9.5, 3);
          ctx.fill();
          ctx.fillStyle = `hsla(46, 95%, 70%, ${0.12 * flash})`;
          ctx.beginPath();
          ctx.arc(x, y, 20, 0, TAU);
          ctx.fill();
          ctx.restore();
        }
        if (dark > 0.02) {
          // clipped to zero: the value goes flat
          ctx.fillStyle = `rgba(4, 16, 16, ${0.7 * dark})`;
          this.rrect(ctx, x - 9.5, y - 9.5, x + 9.5, y + 9.5, 3);
          ctx.fill();
          ctx.strokeStyle = `hsla(172, 30%, 70%, ${0.5 * dark})`;
          ctx.beginPath();
          ctx.moveTo(x - 5, y);
          ctx.lineTo(x + 5, y);
          ctx.stroke();
        }
      }
    }

    // the working memory strip
    ctx.fillStyle = "hsla(176, 30%, 24%, 0.35)";
    this.rrect(ctx, 640, 505, 960, 553, 5);
    ctx.fill();
    ctx.strokeStyle = "hsla(172, 28%, 76%, 0.16)";
    ctx.stroke();
    for (let i = 0; i < N; i++) this.drawColumn(ctx, i, t);

    // the random-number circuit
    const flick = t >= DRAW.rng0 && t <= DRAW.rng1;
    ctx.strokeStyle = `hsla(172, 35%, 78%, ${flick ? 0.5 : 0.2})`;
    this.rrect(ctx, RNG.x - 13, RNG.y - 13, RNG.x + 13, RNG.y + 13, 4);
    ctx.stroke();
    for (let n = 0; n < 8; n++) {
      const a = (n * TAU) / 8;
      const on = flick ? mulberry32(Math.floor(t * 24) * 13 + n)() > 0.5 : n % 3 === 0;
      ctx.fillStyle = `hsla(${on && flick ? 175 : 172}, 50%, 82%, ${on ? (flick ? 0.95 : 0.25) : 0.08})`;
      ctx.beginPath();
      ctx.arc(RNG.x + Math.cos(a) * 7, RNG.y + Math.sin(a) * 7, 1.6, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  // ---------- one token's column of working numbers ----------
  private colVec(i: number, t: number): number[] {
    let v = S[0][i];
    for (const L of LAYERS) {
      const k = L.k;
      if (t < L.at0) return S[k - 1][i];
      if (t < L.dn0) {
        const { s, len } = attnWin(L, i);
        return lerpV(S[k - 1][i], SATT[k][i], smoothstep(remap(t, s + 0.35 * len, s + 0.95 * len)));
      }
      if (t < L.dn1) return lerpV(SATT[k][i], S[k][i], smoothstep(remap(t, (L.dn0 + L.dn1) / 2, L.dn1)));
      v = S[k][i];
    }
    return v;
  }

  private drawColumn(ctx: CanvasRenderingContext2D, i: number, t: number) {
    const T = TOKENS[i];
    const [r0, r1] = respT(T);
    const fill = remap(t, r0 + 0.1, r1);
    if (fill <= 0) return;
    const clear = 1 - smoothstep(remap(t, CLEAR0 + (N - 1 - i) * 0.08, CLEAR0 + 0.6 + (N - 1 - i) * 0.08));
    if (clear <= 0.01) return;
    const v = this.colVec(i, t);
    const readout = smoothstep(remap(t, 53.8, 54.6)) * (1 - smoothstep(remap(t, 60.2, 61.2)));
    const focus = i === N - 1 ? 1 + 0.5 * readout : 1 - 0.5 * readout;
    const x = colS(i);
    for (let m = 0; m < D; m++) {
      const appear = clamp(fill * D - (D - 1 - m));
      if (appear <= 0) continue;
      const b = 0.5 + 0.5 * Math.tanh(2.4 * v[m]);
      const a = appear * clear * focus;
      ctx.fillStyle = `hsla(${T.hue}, 72%, ${42 + 40 * b}%, ${Math.min(1, a * (0.22 + 0.7 * b))})`;
      this.rrect(ctx, x - 9, cellY(m) - 3.4, x + 9, cellY(m) + 3.4, 1.5);
      ctx.fill();
    }
    ctx.strokeStyle = `hsla(${T.hue}, 50%, 80%, ${0.25 * clear * Math.min(1, fill * 2) * focus})`;
    ctx.lineWidth = 1;
    this.rrect(ctx, x - 11, 508, x + 11, 550, 3);
    ctx.stroke();
  }

  // ---------- active wires: lookups, buses, attention ----------
  private drawRoutes(ctx: CanvasRenderingContext2D, t: number) {
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    // lookup wires, lit while a token is being fetched
    TOKENS.forEach((T, i) => {
      const e = winEnv(t, T.tPort, respT(T)[1] + 0.2, 0.2);
      if (e <= 0.01) return;
      ctx.strokeStyle = `hsla(${T.hue}, 55%, 78%, ${0.16 * e})`;
      ctx.lineWidth = 1.2;
      this.strokePath(ctx, IO[i]);
      this.strokePath(ctx, REQ[i]);
    });
    // buses between working memory and the array
    let busE = 0;
    for (const L of LAYERS) busE = Math.max(busE, winEnv(t, L.up0 - 0.1, L.up1 + 0.1, 0.1), winEnv(t, L.dn0 - 0.1, L.dn1 + 0.1, 0.1));
    for (let i = 0; i < N; i++) {
      const ro = i === N - 1 ? winEnv(t, RO.up0 - 0.1, RO.up1 + 0.1, 0.1) : 0;
      ctx.strokeStyle = `hsla(${TOKENS[i].hue}, 45%, 78%, ${0.04 + 0.14 * Math.max(busE, ro)})`;
      ctx.lineWidth = 1;
      this.strokePath(ctx, BUS_UP[i]);
    }
    // attention: current only from earlier positions to later ones
    ctx.globalCompositeOperation = "lighter";
    for (const L of LAYERS) {
      if (t < L.at0 - 0.1 || t > L.at1 + 0.1) continue;
      for (let i = 0; i < N; i++) {
        const { s, len } = attnWin(L, i);
        const env = smoothstep(remap(t, s, s + 0.25 * len)) * (1 - smoothstep(remap(t, s + 0.75 * len, s + len)));
        if (env <= 0.01) continue;
        for (let j = 0; j < i; j++) {
          const w = W[L.k][i][j];
          if (w < 0.04) continue;
          ctx.strokeStyle = `hsla(${TOKENS[j].hue}, 70%, 80%, ${env * (0.08 + 0.6 * w)})`;
          ctx.lineWidth = 0.8 + 2.2 * w;
          this.strokePath(ctx, ATT[i][j]);
        }
        const self = W[L.k][i][i];
        ctx.strokeStyle = `hsla(${TOKENS[i].hue}, 75%, 84%, ${env * 0.45 * self})`;
        ctx.lineWidth = 1.3;
        this.rrect(ctx, colS(i) - 13, 506, colS(i) + 13, 552, 4);
        ctx.stroke();
      }
    }
    // read-out: the array fans out to every output register
    const fanE = winEnv(t, RO.fan0, RO.fan1 + 0.6, 0.3);
    if (fanE > 0.01) {
      ctx.strokeStyle = `hsla(44, 55%, 80%, ${0.1 * fanE})`;
      ctx.lineWidth = 0.8;
      for (const p of FAN) this.strokePath(ctx, p);
    }
    ctx.restore();
  }

  // ---------- the registers, the gauge, the draw ----------
  private cursorIdx(t: number): number {
    if (t < DRAW.cur0) return -1;
    return Math.min((t - DRAW.cur0) / STEP, CH + 0.6);
  }

  private drawDistribution(ctx: CanvasRenderingContext2D, t: number) {
    if (t < RO.fan0 || t > DRAW.fade1 + 0.2) return;
    const appear = smoothstep(remap(t, RO.fan0 + 0.3, RO.fan1));
    const logitP = smoothstep(remap(t, RO.logit0, RO.logit1));
    const smx = smoothstep(remap(t, RO.smx0, RO.smx1));
    const dark = smoothstep(remap(t, DRAW.dark0, DRAW.dark1));
    const fadeAll = 1 - smoothstep(remap(t, DRAW.fade0, DRAW.fade1));
    const idx = this.cursorIdx(t);
    const curOn = idx >= 0 && t < DRAW.dark1;

    ctx.save();
    ctx.lineCap = "round";
    ctx.globalCompositeOperation = "lighter";
    for (let c = 0; c < NV; c++) {
      const chosen = c === CH;
      const a = appear * fadeAll * (chosen ? 1 : 1 - dark);
      if (a <= 0.005) continue;
      const rel = Math.sqrt(PROB[c] / PMAX);
      const shrink = chosen ? 1 - smoothstep(remap(t, DRAW.bloom0, DRAW.bloom1)) : 1;
      const h = lerp(LOGIT_H[c], PROB_H[c], smx) * logitP * shrink;
      const under = curOn ? Math.exp(-(((idx - (c + 0.5)) / 0.7) ** 2)) : 0;
      const b = lerp(0.55, 0.3 + 0.7 * rel, smx) * (1 + 0.8 * under) * (chosen && t >= DRAW.stop ? 1.6 : 1);
      const x = candX(c);
      if (h > 0.5) {
        ctx.strokeStyle = `hsla(44, 82%, 80%, ${Math.min(1, a * b * 0.85)})`;
        ctx.lineWidth = lerp(1.1, 1 + 2.4 * rel, smx);
        ctx.beginPath();
        ctx.moveTo(x, CAND_Y);
        ctx.lineTo(x, CAND_Y - h);
        ctx.stroke();
        ctx.fillStyle = `hsla(46, 92%, 88%, ${Math.min(1, a * b)})`;
        ctx.beginPath();
        ctx.arc(x, CAND_Y - h, 1.4 + 2.2 * rel * smx, 0, TAU);
        ctx.fill();
      }
      // the register itself
      ctx.fillStyle = `hsla(170, 45%, 84%, ${a * 0.5})`;
      ctx.fillRect(x - 2, CAND_Y + 1, 4, 3);
      // already added to the running sum
      const counted = idx >= c + 1 || (chosen && idx >= c + 0.6);
      if (counted) {
        ctx.fillStyle = `hsla(175, 60%, 80%, ${a * 0.55})`;
        ctx.beginPath();
        ctx.arc(x, CAND_Y + 9, 1.3, 0, TAU);
        ctx.fill();
      }
    }

    // the gauge: running sum (amber) and the random number (pale marker)
    const gA = smoothstep(remap(t, DRAW.gauge0, DRAW.gauge0 + 0.6)) * fadeAll;
    if (gA > 0.01) {
      const Wd = GAUGE_X1 - GAUGE_X0;
      ctx.strokeStyle = `hsla(172, 30%, 78%, ${0.28 * gA})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(GAUGE_X0, GAUGE_Y);
      ctx.lineTo(GAUGE_X1, GAUGE_Y);
      ctx.moveTo(GAUGE_X0, GAUGE_Y - 4);
      ctx.lineTo(GAUGE_X0, GAUGE_Y + 4);
      ctx.moveTo(GAUGE_X1, GAUGE_Y - 4);
      ctx.lineTo(GAUGE_X1, GAUGE_Y + 4);
      ctx.stroke();
      if (idx >= 0) {
        const ci = Math.min(Math.floor(idx), NV - 1);
        const fill = CUMB[ci] + (idx - ci) * PROB[ci];
        ctx.strokeStyle = `hsla(44, 90%, 74%, ${0.85 * gA})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(GAUGE_X0, GAUGE_Y);
        ctx.lineTo(GAUGE_X0 + fill * Wd, GAUGE_Y);
        ctx.stroke();
      }
      const mA = smoothstep(remap(t, DRAW.rng1 - 0.1, DRAW.rng1 + 0.2)) * gA;
      if (mA > 0.01) {
        ctx.strokeStyle = `hsla(178, 60%, 88%, ${0.9 * mA})`;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(MARKER_X, GAUGE_Y - 9);
        ctx.lineTo(MARKER_X, GAUGE_Y + 9);
        ctx.stroke();
      }
      const age = t - DRAW.stop;
      if (age > 0 && age < 1.6) {
        ctx.strokeStyle = `hsla(46, 90%, 82%, ${0.6 * Math.exp(-age * 2.2) * gA})`;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(MARKER_X, GAUGE_Y, 6 + age * 40, 0, TAU);
        ctx.stroke();
      }
    }
    // the cursor
    if (curOn) {
      const ci = Math.floor(idx);
      const x = candX(ci) - CAND_SP / 2 + (idx - ci) * CAND_SP;
      ctx.fillStyle = `hsla(46, 95%, 88%, ${0.9 * fadeAll})`;
      ctx.beginPath();
      ctx.moveTo(x, CAND_Y + 13);
      ctx.lineTo(x + 4, CAND_Y + 17);
      ctx.lineTo(x, CAND_Y + 21);
      ctx.lineTo(x - 4, CAND_Y + 17);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  private drawHeat(ctx: CanvasRenderingContext2D, t: number) {
    const h = heatAt(t);
    if (h <= 0.01) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const cx = 800 + Math.sin(t * 0.7) * 6;
    const cy = 390 + Math.cos(t * 0.5) * 5;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 360);
    g.addColorStop(0, `hsla(28, 90%, 55%, ${0.09 * h})`);
    g.addColorStop(0.55, `hsla(20, 85%, 45%, ${0.04 * h})`);
    g.addColorStop(1, "hsla(20, 85%, 45%, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(cx - 360, cy - 360, 720, 720);
    ctx.restore();
  }

  // ---------- all the moving current ----------
  private drawPulses(ctx: CanvasRenderingContext2D, t: number) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    // weights streaming from memory into the array
    for (const st of STREAMS) {
      const env = winEnv(t, st.s0, st.s1);
      if (env <= 0.01) continue;
      TRACES.forEach((tr, si) =>
        tr.forEach((p, m) => {
          for (let n = 0; n < st.dens; n++) {
            const u = ((t - st.s0) * 1.5 + n / st.dens + m * 0.13 + si * 0.07) % 1;
            this.pulse(ctx, p, u, 48, env * 0.85, 2.1, 70);
          }
        }),
      );
    }

    TOKENS.forEach((T, i) => {
      // the token becomes current, and is looked up
      const [i0, i1] = ioT(T);
      this.pulse(ctx, IO[i], remap(t, i0, i1), T.hue, 1, 2.8);
      const [q0, q1] = reqT(T);
      this.pulse(ctx, REQ[i], remap(t, q0, q1), 178, 0.8, 2.0, 50);
      const [r0, r1] = respT(T);
      for (let n = 0; n < 4; n++) this.pulse(ctx, RESP[i], remap(t, r0 + n * 0.07, r1 - (3 - n) * 0.07), T.hue, 0.9, 2.3);
    });

    // working numbers up to the array, and results back down
    for (const L of LAYERS) {
      for (let i = 0; i < N; i++) {
        for (let n = 0; n < 2; n++) {
          this.pulse(ctx, BUS_UP[i], remap(t, L.up0 + n * 0.08 + i * 0.02, L.up1 - (1 - n) * 0.08), TOKENS[i].hue, 0.85, 2.2);
          this.pulse(ctx, BUS_DN[i], remap(t, L.dn0 + n * 0.08 + i * 0.02, L.dn1 - (1 - n) * 0.08), TOKENS[i].hue, 0.85, 2.2);
        }
      }
      // attention current
      if (t >= L.at0 && t <= L.at1) {
        for (let i = 1; i < N; i++) {
          const { s, len } = attnWin(L, i);
          const mp = remap(t, s + 0.1 * len, s + 0.8 * len);
          for (let j = 0; j < i; j++) {
            const w = W[L.k][i][j];
            if (w < 0.04) continue;
            this.pulse(ctx, ATT[i][j], mp, TOKENS[j].hue, 0.35 + 0.65 * w, 1.4 + 2.6 * w);
          }
        }
      }
    }
    // read-out: only the last position rises, then fans out to the registers
    for (let n = 0; n < 3; n++) this.pulse(ctx, BUS_UP[N - 1], remap(t, RO.up0 + n * 0.08, RO.up1 - (2 - n) * 0.08), TOKENS[N - 1].hue, 1, 2.6);
    for (let c = 0; c < NV; c++) {
      const d = Math.abs(c / (NV - 1) - 0.5) * 2;
      this.pulse(ctx, FAN[c], remap(t, RO.fan0 + d * 0.3, RO.fan0 + 0.6 + d * 0.3), 44, 0.8, 1.6);
    }
    // the random number travels to the gauge
    this.pulse(ctx, RNG_PATH, remap(t, DRAW.rng1 - 0.5, DRAW.rng1), 178, 1, 2.4, 60);
    // the chosen token leaves as current, down through the chip and out the port
    this.pulse(ctx, OUT_PATH, remap(t, NEW.out0 + 0.2, NEW.out1), NEW.hue, 1, 3.2);
    ctx.restore();
  }

  // ---------- the tokens ----------
  private tokenFrame(i: number, t: number): Frame | null {
    const T = TOKENS[i];
    if (t < T.tEnter || t >= T.tExit1) return null;
    const slot = { x: slotX(i), y: ROW_Y + Math.sin(t * 1.1 + i * 1.3) * 2.5 };
    const edge = { x: -90, y: T.edgeY };
    const edgeCtl = { x: (edge.x + slot.x) / 2, y: ROW_Y - 95 };
    const portCtl = { x: lerp(slot.x, PORT.x, 0.25), y: PORT.y + 70 };
    const q = (a: Pt, c: Pt, b: Pt, e: number) => {
      const k = 1 - e;
      return { x: k * k * a.x + 2 * k * e * c.x + e * e * b.x, y: k * k * a.y + 2 * k * e * c.y + e * e * b.y };
    };
    if (t < T.tSettle) {
      const e = 1 - Math.pow(1 - remap(t, T.tEnter, T.tSettle), 2.4);
      return { ...q(edge, edgeCtl, slot, e), alpha: smoothstep(remap(t, T.tEnter, T.tEnter + 0.6)), moving: true, size: T.size };
    }
    if (t < T.tRise) return { ...slot, alpha: 1, moving: false, size: T.size };
    if (t < T.tPort) {
      // into the port: the spark becomes current
      const e = easeInOut(remap(t, T.tRise, T.tPort));
      return { ...q(slot, portCtl, PORT, e), alpha: 1 - smoothstep(remap(e, 0.7, 1)), moving: true, size: T.size * (1 - 0.7 * e) };
    }
    if (t < T.tBack0) return null;
    if (t < T.tBack1) {
      const e = easeInOut(remap(t, T.tBack0, T.tBack1));
      return { ...q(PORT, portCtl, slot, e), alpha: smoothstep(remap(e, 0, 0.3)), moving: true, size: T.size * (0.3 + 0.7 * e) };
    }
    if (t < T.tExit0) return { ...slot, alpha: 1, moving: false, size: T.size };
    const e = easeInOut(remap(t, T.tExit0, T.tExit1));
    return { ...q(slot, edgeCtl, edge, e), alpha: 1 - smoothstep(remap(t, T.tExit1 - 0.6, T.tExit1)), moving: true, size: T.size };
  }

  private newFrame(t: number): Frame | null {
    if (t < DRAW.bloom0 || t >= NEW.exit1) return null;
    const born = { x: candX(CH), y: CAND_Y - 14 + Math.sin(t * 1.3) * 2 };
    const slot = { x: slotX(N), y: ROW_Y + Math.sin(t * 1.1 + N * 1.3) * 2.5 };
    const bloom = smoothstep(remap(t, DRAW.bloom0, DRAW.bloom1));
    if (t < NEW.out0 + 0.35) {
      const out = smoothstep(remap(t, NEW.out0, NEW.out0 + 0.35));
      return { ...born, alpha: bloom * (1 - out), moving: false, size: NEW.size * (0.4 + 0.6 * bloom) * (1 - 0.6 * out) };
    }
    if (t < NEW.out1) return null; // travelling as current
    const portCtl = { x: lerp(slot.x, PORT.x, 0.25), y: PORT.y + 70 };
    const q = (a: Pt, c: Pt, b: Pt, e: number) => {
      const k = 1 - e;
      return { x: k * k * a.x + 2 * k * e * c.x + e * e * b.x, y: k * k * a.y + 2 * k * e * c.y + e * e * b.y };
    };
    if (t < NEW.land) {
      const e = easeInOut(remap(t, NEW.out1, NEW.land));
      return { ...q(PORT, portCtl, slot, e), alpha: smoothstep(remap(e, 0, 0.3)), moving: true, size: NEW.size * (0.3 + 0.7 * e) };
    }
    if (t < NEW.exit0) return { ...slot, alpha: 1, moving: false, size: NEW.size };
    const edge = { x: -90, y: NEW.edgeY };
    const e = easeInOut(remap(t, NEW.exit0, NEW.exit1));
    return {
      ...q(slot, { x: (edge.x + slot.x) / 2, y: ROW_Y - 95 }, edge, e),
      alpha: 1 - smoothstep(remap(t, NEW.exit1 - 0.6, NEW.exit1)),
      moving: true,
      size: NEW.size,
    };
  }

  private drawTokens(ctx: CanvasRenderingContext2D, t: number) {
    const draw = (f: Frame | null, hue: number, kind: SparkKind, seed: number, at: (tt: number) => Frame | null) => {
      if (!f || f.alpha <= 0.005) return;
      if (f.moving) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        for (let k = 1; k <= 4; k++) {
          const p = at(t - k * 0.07);
          if (!p) break;
          ctx.fillStyle = `hsla(${hue}, 85%, 78%, ${f.alpha * 0.15 * (1 - k / 5)})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 3.4 * f.size * (1 - k / 6), 0, TAU);
          ctx.fill();
        }
        ctx.restore();
      }
      drawSparkGlyph(ctx, f.x, f.y, { hue, kind, size: f.size, alpha: f.alpha, t, seed });
    };
    TOKENS.forEach((T, i) => draw(this.tokenFrame(i, t), T.hue, T.kind, i, (tt) => this.tokenFrame(i, tt)));
    draw(this.newFrame(t), NEW.hue, NEW.kind, N, (tt) => this.newFrame(tt));
  }
}

// ---------------------------------------------------------------------------

type Cue = { t: number; kind: "chime" | "tick" | "forge"; hue: number; soft?: boolean; quick?: boolean };
const CUES: Cue[] = (() => {
  const c: Cue[] = [];
  for (const T of TOKENS) {
    c.push({ t: T.tSettle, kind: "chime", hue: T.hue, soft: true, quick: true });
    c.push({ t: T.tPort, kind: "chime", hue: T.hue, soft: true, quick: true });
    c.push({ t: T.tBack1, kind: "chime", hue: T.hue + 90, soft: true, quick: true });
  }
  for (const L of LAYERS) c.push({ t: L.wA0, kind: "tick", hue: 0 });
  c.push({ t: RO.w0, kind: "tick", hue: 0 });
  c.push({ t: DRAW.rng1, kind: "tick", hue: 0 });
  c.push({ t: DRAW.stop, kind: "forge", hue: NEW.hue });
  c.push({ t: NEW.land, kind: "chime", hue: NEW.hue });
  return c;
})();

const TICKS: FilmTick[] = [
  ...TOKENS.map((T, i) => ({ id: i, t: T.tSettle, start: T.tEnter, end: T.tSettle, hue: T.hue })),
  { id: N, t: DRAW.stop, start: DRAW.stop, end: NEW.land, hue: NEW.hue },
];

// sanity checks on the score
(() => {
  for (let i = 1; i < LAYERS.length; i++) {
    if (LAYERS[i].wA0 < LAYERS[i - 1].t1 - 1e-6) throw new Error("Film IV: layers overlap");
  }
  if (Math.abs(LAYERS[LAYERS.length - 1].t1 - 52.5) > 1e-6) throw new Error("Film IV: layers must end at 52.5 s");
  TOKENS.forEach((T) => {
    if (!(T.tSettle < T.tRise && respT(T)[1] < LAYERS[0].wA0 && T.tBack1 < T.tExit0 && T.tBack0 > CLEAR0)) {
      throw new Error("Film IV: token schedule out of order");
    }
  });
  const sum = PROB.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > 1e-9) throw new Error("Film IV: probabilities must sum to 1");
  if (!(U > CUMB[CH] && U < CUMB[CH + 1])) throw new Error("Film IV: the random number must fall on the chosen token");
  for (let i = 1; i < CAMERA_IV.length; i++) {
    const a = CAMERA_IV[i - 1];
    if (a.to + a.pullBack >= CAMERA_IV[i].at) throw new Error("Film IV: camera moves overlap");
  }
  if (NEW.exit1 > DURATION) throw new Error("Film IV: ends too late");
})();

export const FILM_FOUR: PlayableFilm = {
  id: "current",
  numeral: "IV",
  title: "One Pass, in Current",
  shortTitle: "In Current",
  kicker: "Film IV · an 86-second generative animated short",
  intro:
    "The same pass, seen as the machine that performs it. The network is not wired into the chip: its weights wait in memory as electric charge, and for each layer they stream into the same array of circuits, where waves of arithmetic sweep across, timed by a clock. At the end, a random number meets a running sum, and one token is chosen.",
  duration: DURATION,
  shots: SHOTS_IV,
  narration: NARRATION_IV,
  principles: [
    {
      icon: "✦",
      title: "The token",
      text: "A piece of text, sent to the chip as a number. It is looked up in memory and becomes a pattern of numbers, held as electric charge in a small working memory.",
    },
    {
      icon: "▤",
      title: "The weights",
      text: "Billions of numbers stored as charge in stacks of memory. During inference they are only read: streamed out, used, and left exactly as they were.",
    },
    {
      icon: "⌁",
      title: "The circuit",
      text: "Arrays of tiny switches that multiply and add, paced by a clock. The same circuits compute every layer in turn. The network is not wired into the chip: its numbers flow through it.",
    },
    {
      icon: "◔",
      title: "The draw",
      text: "Sampling is arithmetic: a random number compared with a running sum of probabilities. Where it falls, that token is the output. Every pass also costs energy, which leaves the chip as heat.",
    },
  ],
  styleNotes: [...COMMON_STYLE_NOTES, "Circuits drawn by hand", "Current as light, slowed a billionfold", "Four close-ups; none with reduced motion"],
  ticks: TICKS,
  tickLabel: "Token",
  createRenderer: () => new CurrentRenderer(),
  cueAudio(prev: number, t: number, au: AudioCueTarget) {
    for (const c of CUES) {
      if (!(prev < c.t && t >= c.t)) continue;
      if (c.kind === "tick") au.tick();
      else if (c.kind === "forge") au.forge();
      else au.chime(c.hue, c.soft, c.quick);
    }
  },
};
