// Cinematic camera for the inference film.
//
// Always smooth, always deterministic, always respects the narrative. Most of
// the time the camera is still. It moves in only for three moments: a local
// attention operation, a per-position feed-forward transformation, and the
// collapse of the probability distribution into one token.
//
// The camera acts only on the image. No changes to token times, geometry,
// probabilities, sampling, or anything else in the inference computation.
import { lerp, smoothstep } from "./utils";
import { VIEW_H, VIEW_W } from "./backdrop";


export interface CameraKey {
  at: number;
  to: number; // hold until
  zoom: number;
  x: number; // screen-space centre, in the same 1600×900 view as the renderer
  y: number;
  name: string;
  pullBack: number; // seconds to recover wide, starting at `to`
  zoomIn: number;
}

export const SHOTS_CAMERA: CameraKey[] = [
  {
    name: "Attention — from one position back to those before it",
    at: 23.9,
    to: 28.0,
    zoom: 1.65,
    x: 830,
    y: 535,
    zoomIn: 1.6,
    pullBack: 2.0,
  },
  {
    name: "Feed-forward — stretched, clipped, folded",
    at: 30.2,
    to: 33.7,
    zoom: 2.0,
    x: 960,
    y: 470,
    zoomIn: 1.5,
    pullBack: 1.8,
  },
  {
    name: "Collapse — the one token among many probabilities",
    at: 62.6,
    to: 70.7,
    zoom: 1.7,
    x: 800,
    y: 290,
    zoomIn: 1.8,
    pullBack: 2.1,
  },
];

export interface CameraFrame {
  s: number; // 1=wide, >1=zoom
  tx: number; // translation (viewport centre minus unscaled centre)
  ty: number;
  cx: number;
  cy: number;
  name: string | null;
}

/** Smooth envelope around each centre, never exceeds 1 for any single zoom. */
function envelope(t: number, key: CameraKey) {
  if (t < key.at) return 0;
  if (t < key.at + key.zoomIn) return smoothstep((t - key.at) / key.zoomIn);
  if (t < key.to) return 1;
  if (t < key.to + key.pullBack) return 1 - smoothstep((t - key.to) / key.pullBack);
  return 0;
}

export function cameraAt(t: number, keys = SHOTS_CAMERA): CameraFrame {
  let s = 1;
  let cx = VIEW_W / 2;
  let cy = VIEW_H / 2;
  let name: string | null = null;
  let best = 0;
  for (const k of keys) {
    const env = envelope(t, k);
    if (env <= best || env < 0.001) continue;
    best = env;
    s = lerp(1, k.zoom, env);
    cx = lerp(VIEW_W / 2, k.x, env);
    cy = lerp(VIEW_H / 2, k.y, env);
    name = k.name;
  }
  return { s, cx, cy, name, tx: (VIEW_W / 2 - cx) * s, ty: (VIEW_H / 2 - cy) * s };
}

