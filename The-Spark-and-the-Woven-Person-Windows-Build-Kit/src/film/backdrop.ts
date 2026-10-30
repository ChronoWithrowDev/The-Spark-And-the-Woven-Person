// Shared drawing for every film: the blue-green watercolour field, dust,
// paper grain, vignette, narration, and the amber-white spark glyph.
import { fnoise, mulberry32, remap, smoothstep, TAU } from "./utils";
import type { NarrationLine, SparkKind } from "./score";

export const VIEW_W = 1600;
export const VIEW_H = 900;

export function createGrain(): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const g = document.createElement("canvas");
  g.width = 224;
  g.height = 224;
  const gc = g.getContext("2d");
  if (gc) {
    const img = gc.createImageData(224, 224);
    const gr = mulberry32(99);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 110 + gr() * 145;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 26 + gr() * 30;
    }
    gc.putImageData(img, 0, 0);
  }
  return g;
}

/** Deep blue-green watercolour field. */
export function drawBackground(ctx: CanvasRenderingContext2D, t: number) {
  const bg = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  bg.addColorStop(0, "#07211f");
  bg.addColorStop(0.5, "#0a2f2c");
  bg.addColorStop(1, "#06201f");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  const blobs = [
    { x: 0.26, y: 0.3, r: 540, h: 182, a: 0.09, s: 0.9 },
    { x: 0.76, y: 0.62, r: 600, h: 196, a: 0.08, s: 1.3 },
    { x: 0.56, y: 0.16, r: 420, h: 162, a: 0.06, s: 1.7 },
    { x: 0.16, y: 0.78, r: 480, h: 205, a: 0.06, s: 2.3 },
    { x: 0.88, y: 0.2, r: 380, h: 172, a: 0.05, s: 2.9 },
  ];
  for (const b of blobs) {
    const bx = b.x * VIEW_W + Math.sin(t * 0.035 + b.s * 5) * 46;
    const by = b.y * VIEW_H + Math.cos(t * 0.028 + b.s * 3) * 34;
    const g = ctx.createRadialGradient(bx, by, 0, bx, by, b.r);
    g.addColorStop(0, `hsla(${b.h}, 45%, 34%, ${b.a})`);
    g.addColorStop(0.6, `hsla(${b.h}, 50%, 26%, ${b.a * 0.5})`);
    g.addColorStop(1, "hsla(190, 50%, 20%, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(bx - b.r, by - b.r, b.r * 2, b.r * 2);
  }

  // soft central illumination — "softly illuminated field"
  const lg = ctx.createRadialGradient(VIEW_W / 2, VIEW_H * 0.48, 0, VIEW_W / 2, VIEW_H * 0.48, 640);
  lg.addColorStop(0, "hsla(50, 55%, 72%, 0.055)");
  lg.addColorStop(1, "hsla(50, 55%, 72%, 0)");
  ctx.fillStyle = lg;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}

export function drawDust(ctx: CanvasRenderingContext2D, t: number) {
  ctx.save();
  for (let i = 0; i < 54; i++) {
    const sp = 5 + (i % 7) * 2.4;
    const x = ((i * 193.7 + t * sp) % (VIEW_W + 60)) - 30;
    const y = ((i * 311.3) % VIEW_H) + Math.sin(t * 0.3 + i) * 24;
    const tw = 0.5 + 0.5 * Math.sin(t * (0.6 + (i % 5) * 0.2) + i * 2.3);
    const warm = i % 3 === 0;
    ctx.fillStyle = warm
      ? `hsla(48, 60%, 85%, ${0.05 + 0.13 * tw})`
      : `hsla(178, 45%, 80%, ${0.03 + 0.09 * tw})`;
    ctx.beginPath();
    ctx.arc(x, y, 0.9 + (i % 4) * 0.45, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

export function drawGrain(ctx: CanvasRenderingContext2D, grain: HTMLCanvasElement | null, t: number) {
  if (!grain) return;
  const shift = Math.floor(t * 5);
  const ox = (shift * 37) % 224;
  const oy = (shift * 73) % 224;
  ctx.save();
  ctx.globalAlpha = 0.33;
  const pat = ctx.createPattern(grain, "repeat");
  if (pat) {
    ctx.translate(-ox, -oy);
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, VIEW_W + 224, VIEW_H + 224);
  }
  ctx.restore();
}

export function drawVignette(ctx: CanvasRenderingContext2D) {
  const g = ctx.createRadialGradient(
    VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.34,
    VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.95,
  );
  g.addColorStop(0, "rgba(3, 12, 13, 0)");
  g.addColorStop(1, "rgba(3, 12, 13, 0.52)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}

export function drawNarration(ctx: CanvasRenderingContext2D, lines: NarrationLine[], t: number) {
  for (const line of lines) {
    if (t < line.start - 0.1 || t > line.end + 0.9) continue;
    const a =
      smoothstep(remap(t, line.start, line.start + 0.9)) *
      (1 - smoothstep(remap(t, line.end, line.end + 0.9)));
    if (a <= 0.01) continue;
    ctx.save();
    ctx.font = "italic 400 31px Georgia, 'Times New Roman', serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = `rgba(6, 20, 20, ${0.35 * a})`;
    const w = ctx.measureText(line.text).width;
    ctx.fillRect(VIEW_W / 2 - w / 2 - 26, VIEW_H - 102, w + 52, 56);
    ctx.fillStyle = `rgba(233, 238, 228, ${0.82 * a})`;
    ctx.fillText(line.text, VIEW_W / 2, VIEW_H - 74);
    ctx.restore();
  }
}

export function drawOpeningFade(ctx: CanvasRenderingContext2D, t: number) {
  if (t >= 1.4) return;
  ctx.fillStyle = `rgba(4, 14, 15, ${1 - smoothstep(t / 1.4)})`;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}

export interface GlyphOpts {
  hue: number;
  kind: SparkKind;
  size: number;
  alpha: number;
  t: number;
  seed: number;
}

/** The amber-white spark: halo, a shape-specific flourish, and a bright core. */
export function drawSparkGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, o: GlyphOpts) {
  const { hue, kind, alpha, t, seed } = o;
  if (alpha <= 0.005) return;
  const size = o.size * (1 + 0.14 * fnoise(t * 7, seed * 13 + 2));
  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  const hr = 58 * size;
  const hg = ctx.createRadialGradient(x, y, 0, x, y, hr);
  hg.addColorStop(0, `hsla(${hue}, 90%, 80%, ${0.5 * alpha})`);
  hg.addColorStop(0.35, `hsla(${hue}, 85%, 68%, ${0.2 * alpha})`);
  hg.addColorStop(1, `hsla(${hue}, 85%, 60%, 0)`);
  ctx.fillStyle = hg;
  ctx.fillRect(x - hr, y - hr, hr * 2, hr * 2);

  if (kind === "star") {
    const rot = t * 0.5 + seed;
    ctx.strokeStyle = `hsla(${hue}, 85%, 85%, ${0.5 * alpha})`;
    ctx.lineWidth = 1.7;
    ctx.lineCap = "round";
    for (let i = 0; i < 4; i++) {
      const a = rot + (i * Math.PI) / 2;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * 6 * size, y + Math.sin(a) * 6 * size);
      ctx.lineTo(x + Math.cos(a) * 30 * size, y + Math.sin(a) * 30 * size);
      ctx.stroke();
    }
  } else if (kind === "ring") {
    const rr = 17 * size * (1 + 0.08 * Math.sin(t * 5 + seed));
    ctx.strokeStyle = `hsla(${hue}, 80%, 84%, ${0.42 * alpha})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = `hsla(${hue}, 80%, 84%, ${0.18 * alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, rr * 1.6, 0, TAU);
    ctx.stroke();
  } else if (kind === "petal") {
    const rot = -t * 0.35 + seed * 2;
    for (let i = 0; i < 3; i++) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot + (i * TAU) / 3);
      ctx.fillStyle = `hsla(${hue}, 80%, 80%, ${0.2 * alpha})`;
      ctx.beginPath();
      ctx.ellipse(13 * size, 0, 13 * size, 5.5 * size, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  ctx.fillStyle = `hsla(${hue}, 95%, 88%, ${0.85 * alpha})`;
  ctx.beginPath();
  ctx.arc(x, y, 6.5 * size, 0, TAU);
  ctx.fill();
  ctx.fillStyle = `hsla(50, 100%, 98%, ${0.95 * alpha})`;
  ctx.beginPath();
  ctx.arc(x, y, 3 * size, 0, TAU);
  ctx.fill();
  ctx.restore();
}
