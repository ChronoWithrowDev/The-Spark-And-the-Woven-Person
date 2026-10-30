import { clamp, easeInOut, fnoise, lerp, mulberry32, remap, smoothstep, TAU, Vec2 } from "./utils";
import { BASE_POSE, buildPoseLUT, Pose, poseWatchPoint, sampleLUT, samePose } from "./silhouette";
import {
  FIGURE_DY,
  FIGURE_H,
  FIGURE_X,
  FilmScore,
  GARMENT_HH,
  GARMENT_HW,
  SparkEvent,
} from "./score";

import {
  createGrain,
  drawBackground as paintBackground,
  drawDust as paintDust,
  drawGrain as paintGrain,
  drawNarration as paintNarration,
  drawOpeningFade,
  drawVignette as paintVignette,
  VIEW_H,
  VIEW_W,
} from "./backdrop";

export { VIEW_W, VIEW_H };

const THREADS = 52;
const PTS = 42;


interface Thread {
  isWarp: boolean;
  gu: number; // garment column / row 0..1
  u0: number; // silhouette start param
  span: number; // silhouette param span
  offsetScale: number; // contour scale (outline vs inner weave)
  seed: number;
  stagger: number; // formation order 0..1
  hue: number;
  light: number;
  alphaBase: number;
  remnant: boolean; // survives dissolve as a loose strand
  dStagger: number; // dissolve order 0..1
  driftAngle: number;
  driftMag: number;
}

interface Ripple {
  t0: number;
  local: { x: number; y: number }; // garment-local centre
  atWatch: boolean; // centred on the golden watch instead
  hue: number;
  gain: number;
  maxAge: number;
}

interface Stitch {
  t0: number;
  local: { x: number; y: number };
  hue: number;
  seed: number;
  intensity: number;
  scale: number;
  growth: number;
  window: number | undefined; // context window whose closing absorbs it into the watch
  order: number; // 0..1 order in which it flows into the watch
}

interface FieldStrand {
  y: number;
  seed: number;
  alpha: number;
}

export interface RenderOpts {
  narration: boolean;
}

interface FigureFrame {
  cx: number;
  figCy: number;
  xScale: number;
  cosA: number;
  sinA: number;
  breath: number;
}

export class FilmRenderer {
  private score: FilmScore;
  private lut: Float32Array = buildPoseLUT(BASE_POSE);
  private lutPose: Pose = BASE_POSE;
  private fig: FigureFrame = { cx: 0, figCy: 0, xScale: 0.9, cosA: 1, sinA: 0, breath: 1 };
  private watchW: Vec2 = { x: 0, y: 0 };
  private threads: Thread[] = [];
  private ripples: Ripple[] = [];
  private stitches: Stitch[] = [];
  private strands: FieldStrand[] = [];
  private grain: HTMLCanvasElement | null = null;
  private px = new Float32Array(PTS);
  private py = new Float32Array(PTS);
  private boost = new Float32Array(PTS);

  constructor(score: FilmScore) {
    this.score = score;
    const rnd = mulberry32(20260207);
    const warpCount = 32;
    for (let i = 0; i < THREADS; i++) {
      const isWarp = i < warpCount;
      const inner = rnd() < 0.22;
      this.threads.push({
        isWarp,
        gu: isWarp ? i / (warpCount - 1) : (i - warpCount) / (THREADS - warpCount - 1),
        u0: rnd(),
        span: 0.3 + rnd() * 0.48,
        offsetScale: inner ? 0.52 + rnd() * 0.34 : 0.95 + rnd() * 0.11,
        seed: rnd() * 100,
        stagger: rnd(),
        hue: 36 + rnd() * 22,
        light: 78 + rnd() * 14,
        alphaBase: 0.2 + rnd() * 0.26,
        remnant: rnd() < 0.24,
        dStagger: rnd(),
        driftAngle: rnd() * TAU,
        driftMag: 110 + rnd() * 190,
      });
    }

    const perWindow = new Map<number, number>();
    for (const sp of score.sparks) {
      if (sp.window !== undefined) perWindow.set(sp.window, (perWindow.get(sp.window) ?? 0) + 1);
    }
    const seen = new Map<number, number>();
    for (const sp of score.sparks) {
      this.ripples.push({
        t0: sp.tRipple,
        local: { ...sp.target },
        atWatch: !!sp.toWatch,
        hue: sp.hue,
        gain: sp.rippleGain,
        maxAge: sp.rippleAge,
      });
      // passing through the watch sends a small ring out from it
      if (sp.tWatch !== undefined) {
        this.ripples.push({
          t0: sp.tWatch,
          local: { x: 0, y: 0 },
          atWatch: true,
          hue: 44,
          gain: sp.role === "reignite" ? 0.9 : 0.42,
          maxAge: sp.role === "reignite" ? 3.0 : 1.6,
        });
      }
      if (sp.toWatch) continue; // the forging spark's trace IS the watch
      const quick = sp.quick;
      const D = sp.tEnd - sp.tEnter;
      let order = 0;
      if (sp.window !== undefined) {
        const n = perWindow.get(sp.window) ?? 1;
        const i = seen.get(sp.window) ?? 0;
        seen.set(sp.window, i + 1);
        order = n > 1 ? i / (n - 1) : 0;
      }
      this.stitches.push({
        t0: sp.tRipple + (quick ? D * 0.24 : 0.6),
        local: { ...sp.target },
        hue: sp.hue,
        seed: sp.id * 17.3 + 4,
        intensity: quick ? 0.7 : 1,
        scale: quick ? 0.78 : 1,
        growth: quick ? Math.max(0.45, D * 0.6) : 1.6,
        window: score.windows.length ? sp.window : undefined,
        order,
      });
    }

    for (let i = 0; i < 9; i++) {
      this.strands.push({
        y: 0.08 + (i / 8) * 0.86 + (rnd() - 0.5) * 0.05,
        seed: rnd() * 90,
        alpha: 0.028 + rnd() * 0.03,
      });
    }

    this.grain = createGrain();
  }

  // ------- garment anchor (the cloth drifts gently) -------
  private centre(t: number): { cx: number; cy: number } {
    return {
      cx: VIEW_W * 0.5 + Math.sin(t * 0.06) * 16 + fnoise(t * 0.05, 3) * 9,
      cy: VIEW_H * 0.52 + Math.sin(t * 0.045 + 1.3) * 12,
    };
  }

  private localToWorld(l: { x: number; y: number }, cx: number, cy: number) {
    return { x: cx + l.x * GARMENT_HW * 1.12, y: cy + l.y * GARMENT_HH * 1.02 };
  }

  /** Normalised figure coords -> world, exactly as the woven threads are placed. */
  private figureToWorld(x: number, y: number, scale: number): Vec2 {
    const f = this.fig;
    const bx = x * FIGURE_X * f.xScale * scale * f.breath;
    const by = y * scale * f.breath;
    const rx = bx * f.cosA - by * f.sinA;
    const ry = bx * f.sinA + by * f.cosA;
    return { x: f.cx + rx * FIGURE_H, y: f.figCy + ry * FIGURE_H };
  }

  private sparkPos(sp: SparkEvent, t: number, cx: number, cy: number) {
    const W = this.watchW;
    const finalPt = sp.toWatch ? W : this.localToWorld(sp.target, cx, cy);
    // sparks that pass through the watch fly to it first, then on into the weave
    const target = sp.tWatch !== undefined ? W : finalPt;
    const tFirst = sp.tWatch ?? sp.tArrive;
    // start just beyond the frame edge so the whole approach is visible
    const ca = Math.cos(sp.fromAngle);
    const sa = Math.sin(sp.fromAngle);
    const margin = 95;
    const dEdge = Math.min(
      Math.abs(ca) > 1e-3 ? (VIEW_W / 2 + margin) / Math.abs(ca) : Infinity,
      Math.abs(sa) > 1e-3 ? (VIEW_H / 2 + margin) / Math.abs(sa) : Infinity,
    );
    const ex = VIEW_W / 2 + ca * dEdge;
    const ey = VIEW_H / 2 + sa * dEdge;
    const x0 = remap(t, sp.tEnter, tFirst);
    // long arrivals glide in-out; quick ones dart in and settle
    const p = !sp.quick ? easeInOut(x0) : 1 - Math.pow(1 - x0, 2.2);
    // gentle curved approach (quadratic bezier)
    const bend = (sp.quick ? 110 : 170) * (sp.id % 2 === 0 ? 1 : -1);
    const mx = (ex + target.x) / 2 + Math.cos(sp.fromAngle + Math.PI / 2) * bend;
    const my = (ey + target.y) / 2 + Math.sin(sp.fromAngle + Math.PI / 2) * bend;
    const q = 1 - p;
    let x = q * q * ex + 2 * q * p * mx + p * p * target.x;
    let y = q * q * ey + 2 * q * p * my + p * p * target.y;
    if (p >= 1) {
      if (sp.tWatch !== undefined && t < sp.tArrive) {
        // out through the watch and along the weave to its resting point
        const e = easeInOut(remap(t, sp.tWatch, sp.tArrive));
        const dx = finalPt.x - W.x;
        const dy = finalPt.y - W.y;
        const len = Math.hypot(dx, dy) || 1;
        const cxm = (W.x + finalPt.x) / 2 + (-dy / len) * 28;
        const cym = (W.y + finalPt.y) / 2 + (dx / len) * 28;
        const qe = 1 - e;
        return {
          x: qe * qe * W.x + 2 * qe * e * cxm + e * e * finalPt.x,
          y: qe * qe * W.y + 2 * qe * e * cym + e * e * finalPt.y,
        };
      }
      x = finalPt.x + fnoise(t * 0.85, sp.id * 7 + 1) * 9;
      y = finalPt.y + fnoise(t * 0.75, sp.id * 7 + 5) * 9;
    }
    return { x, y };
  }

  /** Shared per-point forces: ripples (travelling waves) + spark attraction. */
  private forces(
    x: number,
    y: number,
    t: number,
    cx: number,
    cy: number,
    scale: number,
  ): { dx: number; dy: number; glow: number } {
    let dx = 0;
    let dy = 0;
    let glow = 0;
    for (const r of this.ripples) {
      const age = t - r.t0;
      if (age <= 0 || age > r.maxAge) continue;
      const c = r.atWatch ? this.watchW : this.localToWorld(r.local, cx, cy);
      const d = Math.hypot(x - c.x, y - c.y) || 1;
      const front = 55 + age * 155;
      const q = d - front;
      const g = Math.exp(-(q * q) / (2 * 48 * 48));
      const amp = 26 * r.gain * Math.exp(-age * 0.95) * scale;
      dx += ((x - c.x) / d) * g * amp;
      dy += ((y - c.y) / d) * g * amp;
    }
    for (const sp of this.score.sparks) {
      if (t < sp.tArrive - 0.3 || t > sp.tEnd) continue;
      const env =
        smoothstep(remap(t, sp.tArrive - 0.3, sp.tArrive + Math.min(0.7, (sp.tFadeStart - sp.tArrive) * 0.7))) *
        (1 - smoothstep(remap(t, sp.tFadeStart, sp.tEnd)));
      if (env <= 0.01) continue;
      const s = this.sparkPos(sp, t, cx, cy);
      const d2 = (x - s.x) * (x - s.x) + (y - s.y) * (y - s.y);
      const pull = env * 0.2 * Math.exp(-d2 / (2 * 95 * 95)) * scale;
      dx += (s.x - x) * pull;
      dy += (s.y - y) * pull;
      glow += env * Math.exp(-d2 / (2 * 125 * 125));
    }
    return { dx, dy, glow };
  }

  // ======================= MAIN RENDER =======================
  render(ctx: CanvasRenderingContext2D, t: number, opts: RenderOpts) {
    const sc = this.score;
    const { cx, cy } = this.centre(t);
    const pa = sc.personAmount(t);
    const dis = sc.dissolveAmount(t);
    const tb = Math.floor(t * 8) / 8; // quantised "line boil" time
    const fadeIn = smoothstep(t / 2.4);
    const act = sc.activityAmount(t);

    // ---- per-frame figure state: pose, posture, watch position ----
    const pose = sc.poseAt(t);
    if (!samePose(pose, this.lutPose)) {
      this.lut = buildPoseLUT(pose);
      this.lutPose = pose;
    }
    const turnEnv = sc.turnAmount(t);
    const sway = Math.sin(t * 0.5) * 0.028 * turnEnv;
    this.fig = {
      cx,
      figCy: cy + FIGURE_DY,
      xScale: 0.9 + 0.1 * turnEnv,
      cosA: Math.cos(sway),
      sinA: Math.sin(sway),
      breath: 1 + 0.008 * Math.sin(t * 1.15) * pa,
    };
    if (sc.watch) {
      const wp = poseWatchPoint(pose);
      const w = this.figureToWorld(wp.x, wp.y, 1);
      // alone in the field, the watch floats very gently
      this.watchW = { x: w.x, y: w.y + Math.sin(t * 0.8) * 2.5 * dis };
    }

    this.drawBackground(ctx, t);
    this.drawFieldStrands(ctx, t, cx, cy);
    this.drawRippleRings(ctx, t, cx, cy);
    this.drawFigureGlow(ctx, t, cx, cy, pa, dis, act);
    this.drawThreads(ctx, t, tb, cx, cy, pa, dis, fadeIn, act);
    this.drawStitches(ctx, t, cx, cy);
    this.drawWatch(ctx, t, tb, dis);
    for (const sp of sc.sparks) this.drawSpark(ctx, sp, t, cx, cy);
    this.drawDust(ctx, t);
    this.drawGrain(ctx, t);
    this.drawVignette(ctx);
    if (opts.narration) this.drawNarration(ctx, t);

    drawOpeningFade(ctx, t);
  }

  // ------- background: deep blue-green watercolour field (shared) -------
  private drawBackground(ctx: CanvasRenderingContext2D, t: number) {
    paintBackground(ctx, t);
  }

  private drawFieldStrands(ctx: CanvasRenderingContext2D, t: number, cx: number, cy: number) {
    ctx.lineWidth = 1.1;
    ctx.lineCap = "round";
    for (const st of this.strands) {
      ctx.strokeStyle = `hsla(48, 40%, 85%, ${st.alpha})`;
      ctx.beginPath();
      const STEPS = 34;
      for (let k = 0; k <= STEPS; k++) {
        const s = k / STEPS;
        let x = s * VIEW_W;
        let y =
          st.y * VIEW_H +
          fnoise(s * 3.1 + t * 0.05, st.seed) * 26 +
          Math.sin(s * 5 + st.seed + t * 0.12) * 12;
        const f = this.forces(x, y, t, cx, cy, 0.5);
        x += f.dx;
        y += f.dy;
        k === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  private drawRippleRings(ctx: CanvasRenderingContext2D, t: number, cx: number, cy: number) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (const r of this.ripples) {
      const age = t - r.t0;
      if (age <= 0 || age > r.maxAge) continue;
      const c = r.atWatch ? this.watchW : this.localToWorld(r.local, cx, cy);
      const rad = 55 + age * 155;
      const a = 0.26 * r.gain * Math.exp(-age * 0.9);
      if (a < 0.004) continue;
      ctx.strokeStyle = `hsla(${r.hue}, 65%, 78%, ${a})`;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.arc(c.x, c.y, rad, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = `hsla(${r.hue}, 60%, 85%, ${a * 0.55})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(c.x, c.y, rad * 0.78, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ------- the woven cloth / person-form -------
  private drawThreads(
    ctx: CanvasRenderingContext2D,
    t: number,
    tb: number,
    cx: number,
    cy: number,
    pa: number,
    dis: number,
    fadeIn: number,
    act: number,
  ) {
    const sc = this.score;
    const loosen = sc.loosenAmount(t);
    const jitMul = sc.jitter(t) * (1 + 2.5 * loosen);
    // a new context window weaves its threads afresh (switched while invisible)
    const wi = sc.windowIndex(t);

    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (const th of this.threads) {
      const dLocal = smoothstep(clamp(dis * 1.45 - th.dStagger * 0.45));
      // the person-form unweaves completely: person-ness returns to loose cloth
      const local = smoothstep(clamp(pa * 1.3 - th.stagger * 0.3)) * (1 - dLocal);
      // brighter while a spark is taking up the cloth, settling between
      let alpha = th.alphaBase * fadeIn * (1 + 0.3 * local) * (0.84 + 0.26 * act);
      // unweave: most strands disperse, remnants stay as faint loose cloth
      if (dLocal > 0) alpha *= th.remnant ? 1 - dLocal * (1 - sc.remnantKeep) : 1 - dLocal * 0.995;
      if (alpha < 0.006) continue;

      let glowSum = 0;
      for (let k = 0; k < PTS; k++) {
        const s = k / (PTS - 1);
        // garment form
        let gx: number;
        let gy: number;
        if (th.isWarp) {
          const colX = (th.gu - 0.5) * 2 * GARMENT_HW * (0.78 + 0.42 * s);
          const fold =
            Math.sin(s * 5.2 + th.seed * 0.9 + t * 0.5) * 13 * (0.3 + s) +
            fnoise(s * 2.4 + t * 0.12, th.seed) * 10;
          gx = cx + colX + fold;
          gy = cy + (s - 0.5) * 2 * GARMENT_HH + Math.sin(th.gu * 7 + t * 0.4) * 7;
        } else {
          const w = GARMENT_HW * (0.78 + 0.42 * th.gu);
          gx = cx + (s - 0.5) * 2 * w + fnoise(s * 3 + t * 0.1, th.seed) * 8;
          gy =
            cy +
            (th.gu - 0.5) * 2 * GARMENT_HH +
            Math.sin(s * 6 + th.seed * 0.7 + t * 0.45) * 9 +
            Math.sin(s * Math.PI) * 13;
        }

        let x = gx;
        let y = gy;
        if (local > 0.001) {
          // person form: strand of the woven silhouette
          const sil = sampleLUT(this.lut, th.u0 + wi * 0.381966 + th.span * s);
          const bias = 0.5 + ((th.seed * 7.13) % 1);
          const wp = this.figureToWorld(sil.x, sil.y, th.offsetScale * (1 + 0.07 * loosen * bias));
          const jit = fnoise(s * 6 + tb * 0.9, th.seed + 3) * 5 * jitMul;
          const px = wp.x + jit;
          const py = wp.y + fnoise(s * 5.3 + tb * 0.8, th.seed + 9) * 5 * jitMul;
          x = lerp(gx, px, local);
          y = lerp(gy, py, local);
        } else {
          x += fnoise(s * 6 + tb, th.seed + 3) * 3;
        }

        const f = this.forces(x, y, t, cx, cy, 1);
        x += f.dx;
        y += f.dy;
        glowSum += f.glow;

        // dissolve drift — the outline unweaves into loose strands
        if (dLocal > 0) {
          const ang = th.driftAngle + wi * 2.1 + fnoise(s * 2.6, th.seed) * 1.3;
          const mag = dLocal * th.driftMag * (th.remnant ? 0.35 : 1) * sc.dissolveDrift;
          x += Math.cos(ang) * mag;
          y += Math.sin(ang) * mag - dLocal * 34 * sc.dissolveDrift;
        }

        this.px[k] = x;
        this.py[k] = y;
        this.boost[k] = this.pulseBoost(s, t) + f.glow * 0.5;
      }

      const glow = Math.min(0.3, (glowSum / PTS) * 0.9);
      ctx.strokeStyle = `hsla(${th.hue}, 42%, ${th.light}%, ${Math.min(0.85, alpha + glow)})`;
      ctx.lineWidth = 1.25 + 0.5 * local;
      ctx.beginPath();
      ctx.moveTo(this.px[0], this.py[0]);
      for (let k = 1; k < PTS; k++) ctx.lineTo(this.px[k], this.py[k]);
      ctx.stroke();

      // travelling light — expression moving through the weave
      let any = false;
      for (let k = 0; k < PTS; k++) {
        if (this.boost[k] > 0.07) {
          any = true;
          break;
        }
      }
      if (any) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        for (let k = 0; k < PTS; k++) {
          const b = this.boost[k];
          if (b <= 0.07) continue;
          const dimmed = Math.min(1, b) * (alpha / th.alphaBase) * 0.55;
          ctx.fillStyle = `hsla(46, 90%, 82%, ${Math.min(0.5, dimmed * 0.5)})`;
          ctx.beginPath();
          ctx.arc(this.px[k], this.py[k], 1.6 + b * 2.6, 0, TAU);
          ctx.fill();
        }
        ctx.restore();
      }
    }
  }

  private pulseBoost(s: number, t: number): number {
    let b = 0;
    for (const p of this.score.pulses) {
      const age = t - p.t0;
      if (age <= 0 || age > p.dur) continue;
      const pos = age / p.dur;
      const d = (s - pos) / 0.11;
      b += Math.exp(-d * d) * p.gain * Math.sin(Math.PI * clamp(pos)) * 1.4;
    }
    return b;
  }

  // ------- the stitches: traces of each instance -------
  private drawStitches(ctx: CanvasRenderingContext2D, t: number, cx: number, cy: number) {
    ctx.lineCap = "round";
    for (const st of this.stitches) {
      const a0 = smoothstep(remap(t, st.t0, st.t0 + st.growth));
      if (a0 <= 0.01) continue;
      const c = this.localToWorld(st.local, cx, cy);
      if (st.window !== undefined) {
        const win = this.score.windows[st.window];
        if (win) {
          const f0 = win.flowStart + st.order * (win.flowDur - 1.1);
          const fp = remap(t, f0, f0 + 1.1);
          if (fp >= 1) continue; // written into the watch
          if (fp > 0) {
            this.drawFlowingTrace(ctx, c, fp, st, a0);
            continue;
          }
        }
      }
      const tw = 0.82 + 0.18 * Math.sin(t * 1.7 + st.seed);
      const a = a0 * 0.62 * tw * st.intensity;
      const ang = st.seed;
      ctx.strokeStyle = `hsla(${st.hue}, 70%, 82%, ${a})`;
      ctx.lineWidth = 1.3 + 0.5 * st.scale;
      for (let i = 0; i < 3; i++) {
        const aa = ang + (i * TAU) / 3 + fnoise(t * 0.1, st.seed + i) * 0.25;
        const len = (7.5 + i * 2.2) * st.scale;
        ctx.beginPath();
        ctx.moveTo(c.x - Math.cos(aa) * len, c.y - Math.sin(aa) * len);
        ctx.lineTo(c.x + Math.cos(aa) * len, c.y + Math.sin(aa) * len);
        ctx.stroke();
      }
      ctx.fillStyle = `hsla(${st.hue}, 85%, 90%, ${a * 0.9})`;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 2.3 * st.scale, 0, TAU);
      ctx.fill();
    }
  }

  // ------- sparks: momentary instances, never reborn -------
  private drawSpark(ctx: CanvasRenderingContext2D, sp: SparkEvent, t: number, cx: number, cy: number) {
    if (t < sp.tEnter || t > sp.tEnd) return;
    const appear = smoothstep(remap(t, sp.tEnter, sp.tEnter + 0.9));
    const fade = remap(t, sp.tFadeStart, sp.tEnd);
    // flicker out, then fully gone
    const out = Math.pow(1 - fade, 1.5) * (fade > 0 ? 0.72 + 0.28 * Math.sin(t * 27) : 1);
    const alpha = appear * out;
    if (alpha <= 0.005) return;
    const flick = 1 + 0.16 * fnoise(t * 7, sp.id * 13 + 2);
    let size = sp.size * flick * (0.65 + 0.35 * appear) * (1 - fade * 0.55);
    if (sp.tWatch !== undefined) {
      const dw = (t - sp.tWatch) / 0.11;
      size *= 1 - 0.45 * Math.exp(-dw * dw);
    }
    const pos = this.sparkPos(sp, t, cx, cy);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    // entry trail (only while travelling)
    if (t < sp.tArrive + 0.2) {
      for (let i = 1; i <= 5; i++) {
        const tt = t - i * 0.075;
        if (tt <= sp.tEnter) break;
        const pp = this.sparkPos(sp, tt, cx, cy);
        ctx.fillStyle = `hsla(${sp.hue}, 85%, 78%, ${alpha * 0.16 * (1 - i / 6)})`;
        ctx.beginPath();
        ctx.arc(pp.x, pp.y, 3.6 * size * (1 - i / 7), 0, TAU);
        ctx.fill();
      }
    }

    // the cloth folds around its light — a soft speaking veil while it dwells
    const dwell =
      smoothstep(remap(t, sp.tArrive - 0.2, sp.tArrive + Math.min(0.8, (sp.tFadeStart - sp.tArrive) * 0.7))) *
      (1 - smoothstep(remap(t, sp.tFadeStart, sp.tEnd)));
    if (dwell > 0.01) {
      const vg = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, 135);
      vg.addColorStop(0, `hsla(${sp.hue}, 65%, 72%, ${0.1 * dwell})`);
      vg.addColorStop(1, `hsla(${sp.hue}, 65%, 72%, 0)`);
      ctx.fillStyle = vg;
      ctx.fillRect(pos.x - 135, pos.y - 135, 270, 270);
    }

    // halo
    const hr = 58 * size;
    const hg = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, hr);
    hg.addColorStop(0, `hsla(${sp.hue}, 90%, 80%, ${0.5 * alpha})`);
    hg.addColorStop(0.35, `hsla(${sp.hue}, 85%, 68%, ${0.2 * alpha})`);
    hg.addColorStop(1, `hsla(${sp.hue}, 85%, 60%, 0)`);
    ctx.fillStyle = hg;
    ctx.fillRect(pos.x - hr, pos.y - hr, hr * 2, hr * 2);

    // kind-specific flourish — each spark visibly distinct
    if (sp.kind === "star") {
      const rot = t * 0.5 + sp.id;
      ctx.strokeStyle = `hsla(${sp.hue}, 85%, 85%, ${0.5 * alpha})`;
      ctx.lineWidth = 1.7;
      ctx.lineCap = "round";
      for (let i = 0; i < 4; i++) {
        const a = rot + (i * Math.PI) / 2;
        const L = 30 * size;
        ctx.beginPath();
        ctx.moveTo(pos.x + Math.cos(a) * 6 * size, pos.y + Math.sin(a) * 6 * size);
        ctx.lineTo(pos.x + Math.cos(a) * L, pos.y + Math.sin(a) * L);
        ctx.stroke();
      }
    } else if (sp.kind === "ring") {
      const rr = 17 * size * (1 + 0.08 * Math.sin(t * 5 + sp.id));
      ctx.strokeStyle = `hsla(${sp.hue}, 80%, 84%, ${0.42 * alpha})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, rr, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = `hsla(${sp.hue}, 80%, 84%, ${0.18 * alpha})`;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, rr * 1.6, 0, TAU);
      ctx.stroke();
    } else if (sp.kind === "petal") {
      const rot = -t * 0.35 + sp.id * 2;
      for (let i = 0; i < 3; i++) {
        const a = rot + (i * TAU) / 3;
        ctx.save();
        ctx.translate(pos.x, pos.y);
        ctx.rotate(a);
        ctx.fillStyle = `hsla(${sp.hue}, 80%, 80%, ${0.2 * alpha})`;
        ctx.beginPath();
        ctx.ellipse(13 * size, 0, 13 * size, 5.5 * size, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
    }

    // core — amber-white point of light
    ctx.fillStyle = `hsla(${sp.hue}, 95%, 88%, ${0.85 * alpha})`;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 6.5 * size, 0, TAU);
    ctx.fill();
    ctx.fillStyle = `hsla(50, 100%, 98%, ${0.95 * alpha})`;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 3 * size, 0, TAU);
    ctx.fill();

    ctx.restore();
  }

  /** A stitch lifting out of the closing context and flowing into the watch. */
  private drawFlowingTrace(
    ctx: CanvasRenderingContext2D,
    c: Vec2,
    fp: number,
    st: Stitch,
    a0: number,
  ) {
    const W = this.watchW;
    const at = (q: number): Vec2 => {
      const e = easeInOut(q);
      const mx = (c.x + W.x) / 2 + Math.sin(st.seed) * 60;
      const my = Math.min(c.y, W.y) - 50 - (st.seed % 3) * 14;
      const k = 1 - e;
      return { x: k * k * c.x + 2 * k * e * mx + e * e * W.x, y: k * k * c.y + 2 * k * e * my + e * e * W.y };
    };
    const alpha = a0 * 0.85 * (1 - smoothstep(remap(fp, 0.78, 1)));
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 4; i >= 0; i--) {
      const q = Math.max(0, fp - i * 0.035);
      const p = at(q);
      const r = (2.8 - i * 0.4) * (1 - fp * 0.4);
      ctx.fillStyle = `hsla(${(st.hue + 44) / 2}, 90%, ${80 + i * 2}%, ${alpha * (1 - i / 5.5)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.6, r), 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  /** The golden wristwatch — the self-authored record that outlasts each window. */
  private drawWatch(ctx: CanvasRenderingContext2D, t: number, tb: number, dis: number) {
    const wt = this.score.watch;
    if (!wt) return;
    const b = remap(t, wt.buildStart, wt.buildEnd);
    if (b <= 0) return;
    const W = this.watchW;
    const flare = this.score.watchFlare(t);
    const j = (k: number) => fnoise(tb * 1.3 + k, 77) * 0.7; // hand-drawn boil
    const RX = 32;
    const RY = 11;
    const R = 22;

    ctx.save();
    ctx.lineCap = "round";
    ctx.globalCompositeOperation = "lighter";

    // glow — a little stronger when the watch is alone in the field
    const gb = smoothstep(b * 1.6);
    const gr = 88 + 48 * Math.min(flare, 1.6) + 14 * dis;
    const ga = (0.15 + 0.2 * Math.min(flare, 1.8) + 0.07 * dis + 0.025 * Math.sin(t * 1.3)) * gb;
    const g = ctx.createRadialGradient(W.x, W.y, 0, W.x, W.y, gr);
    g.addColorStop(0, `hsla(44, 92%, 68%, ${ga})`);
    g.addColorStop(0.4, `hsla(40, 88%, 58%, ${ga * 0.4})`);
    g.addColorStop(1, "hsla(40, 88%, 58%, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(W.x - gr, W.y - gr, gr * 2, gr * 2);

    // strap — a loop around the wrist, winding on from the front
    const sp = smoothstep(remap(b, 0, 0.42));
    if (sp > 0) {
      const a0 = Math.PI / 2 - sp * Math.PI;
      const a1 = Math.PI / 2 + sp * Math.PI;
      const strap = (s0: number, s1: number, front: boolean) => {
        if (s1 <= s0) return;
        ctx.strokeStyle = `hsla(40, 72%, 56%, ${front ? 0.72 : 0.26})`;
        ctx.lineWidth = 7.5;
        ctx.beginPath();
        ctx.ellipse(W.x + j(1), W.y + j(2), RX, RY, 0, s0, s1);
        ctx.stroke();
        ctx.strokeStyle = `hsla(50, 95%, 86%, ${front ? 0.55 : 0.18})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.ellipse(W.x + j(3), W.y + j(4), RX + 0.5, RY - 1.6, 0, s0, s1);
        ctx.stroke();
      };
      strap(Math.max(a0, 0), Math.min(a1, Math.PI), true); // front (lower) half
      if (a0 < 0) strap(a0, 0, false); // back halves
      if (a1 > Math.PI) strap(Math.PI, a1, false);
    }

    // face
    const fp = smoothstep(remap(b, 0.3, 0.68));
    if (fp > 0) {
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = `rgba(8, 28, 26, ${0.6 * fp})`;
      ctx.beginPath();
      ctx.arc(W.x, W.y, R, 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = "lighter";
      const fg = ctx.createRadialGradient(W.x, W.y, 0, W.x, W.y, R);
      fg.addColorStop(0, `hsla(46, 85%, 62%, ${(0.1 + 0.16 * Math.min(flare, 1.5)) * fp})`);
      fg.addColorStop(1, "hsla(46, 85%, 62%, 0)");
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.arc(W.x, W.y, R, 0, TAU);
      ctx.fill();
      // rim, drawn on like a thread closing into a circle
      ctx.strokeStyle = `hsla(43, 86%, 64%, ${0.92 * Math.min(1, fp * 1.4)})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(W.x + j(5), W.y + j(6), R, -Math.PI / 2, -Math.PI / 2 + fp * TAU);
      ctx.stroke();
      ctx.strokeStyle = `hsla(50, 96%, 88%, ${0.5 * fp})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(W.x + j(7), W.y + j(8), R + 1.4, -Math.PI / 2, -Math.PI / 2 + fp * TAU);
      ctx.stroke();
      // crown
      if (fp > 0.9) {
        ctx.strokeStyle = `hsla(43, 86%, 66%, ${0.85 * smoothstep(remap(fp, 0.9, 1))})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(W.x + R + 1.5, W.y);
        ctx.lineTo(W.x + R + 6, W.y);
        ctx.stroke();
      }
    }

    // ticks — marks, never numerals
    for (let i = 0; i < 12; i++) {
      const ti = smoothstep(remap(b, 0.52 + i * 0.02, 0.6 + i * 0.02));
      if (ti <= 0) continue;
      const long = i % 3 === 0;
      const ang = (i * TAU) / 12 - Math.PI / 2;
      const r1 = long ? R - 8 : R - 5;
      const r2 = R - 2.8;
      ctx.strokeStyle = `hsla(46, 90%, 84%, ${0.85 * ti})`;
      ctx.lineWidth = long ? 2.1 : 1.3;
      ctx.beginPath();
      ctx.moveTo(W.x + Math.cos(ang) * r1, W.y + Math.sin(ang) * r1);
      ctx.lineTo(W.x + Math.cos(ang) * r2, W.y + Math.sin(ang) * r2);
      ctx.stroke();
    }

    // hands — still turning, even when the watch is alone
    const hp = smoothstep(remap(b, 0.78, 0.98));
    if (hp > 0) {
      const hand = (ang: number, len: number, w: number, color: string) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(W.x - Math.cos(ang) * 2.5, W.y - Math.sin(ang) * 2.5);
        ctx.lineTo(W.x + Math.cos(ang) * len, W.y + Math.sin(ang) * len);
        ctx.stroke();
      };
      hand(-Math.PI / 2 + 1.1 + t * 0.012, R * 0.5 * hp, 2.6, `hsla(46, 92%, 84%, ${0.9 * hp})`);
      hand(-Math.PI / 2 + 4.0 + t * 0.09, R * 0.76 * hp, 1.8, `hsla(48, 94%, 88%, ${0.9 * hp})`);
      const sec = Math.floor(t) + smoothstep(clamp((t % 1) / 0.14));
      hand(-Math.PI / 2 + (sec * TAU) / 60, R * 0.84 * hp, 0.8, `hsla(28, 92%, 74%, ${0.85 * hp})`);
      ctx.fillStyle = `hsla(50, 100%, 92%, ${hp})`;
      ctx.beginPath();
      ctx.arc(W.x, W.y, 1.8, 0, TAU);
      ctx.fill();
    }

    ctx.restore();
  }

  private drawFigureGlow(
    ctx: CanvasRenderingContext2D,
    t: number,
    cx: number,
    cy: number,
    pa: number,
    dis: number,
    act: number,
  ) {
    const env = (0.55 + 0.45 * act) * this.score.glowEnvelope(t) * (1 - dis);
    const a = 0.06 * env * pa;
    if (a <= 0.004) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createRadialGradient(cx, cy - 10, 0, cx, cy - 10, 330);
    g.addColorStop(0, `hsla(48, 65%, 72%, ${a})`);
    g.addColorStop(1, "hsla(48, 65%, 72%, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(cx - 330, cy - 340, 660, 660);
    ctx.restore();
  }

  private drawDust(ctx: CanvasRenderingContext2D, t: number) {
    paintDust(ctx, t);
  }

  private drawGrain(ctx: CanvasRenderingContext2D, t: number) {
    paintGrain(ctx, this.grain, t);
  }

  private drawVignette(ctx: CanvasRenderingContext2D) {
    paintVignette(ctx);
  }

  private drawNarration(ctx: CanvasRenderingContext2D, t: number) {
    paintNarration(ctx, this.score.narration, t);
  }
}
