// Automatic hand landmarks with MediaPipe Hand Landmarker (vendor/mediapipe, Apache-2.0). Runs in
// the browser; the files load only when "Detect" is used. The detected points are a starting
// point: the user drags them where they belong.

import { FINGERS } from "./hand.js";

// MediaPipe landmark numbers per finger: MCP, PIP, DIP.
export const LANDMARKS = { index: [5, 6, 7], middle: [9, 10, 11], ring: [13, 14, 15], little: [17, 18, 19] };

// Landmarks (normalised 0…1) → our photo points (image pixels). Knuckle and middle joint come
// straight from the model. The end-joint width is estimated from the spacing of neighbouring end
// joints (right for fingers held together, an estimate otherwise), placed across the finger.
export function landmarksToPoints(lm, width, height) {
  const P = (i) => ({ x: lm[i].x * width, y: lm[i].y * height });
  const out = {};
  const dip = Object.fromEntries(FINGERS.map((f) => [f, P(LANDMARKS[f][2])]));
  FINGERS.forEach((f, i) => {
    const [m, p] = LANDMARKS[f];
    out[`${f}Base`] = P(m);
    out[`${f}Pip`] = P(p);
    const nb = [FINGERS[i - 1], FINGERS[i + 1]].filter(Boolean).map((g) => Math.hypot(dip[g].x - dip[f].x, dip[g].y - dip[f].y));
    const w = nb.reduce((a, b) => a + b, 0) / nb.length;
    const pip = P(p), d = dip[f];
    const l = Math.hypot(d.x - pip.x, d.y - pip.y) || 1;
    const nx = -(d.y - pip.y) / l, ny = (d.x - pip.x) / l; // across the finger
    out[`${f}D1`] = { x: d.x - (nx * w) / 2, y: d.y - (ny * w) / 2 };
    out[`${f}D2`] = { x: d.x + (nx * w) / 2, y: d.y + (ny * w) / 2 };
  });
  return out;
}

let landmarker = null;
async function load() {
  if (landmarker) return landmarker;
  const { HandLandmarker } = await import("../vendor/mediapipe/vision_bundle.mjs");
  const base = new URL("../vendor/mediapipe/", import.meta.url).href;
  landmarker = await HandLandmarker.createFromOptions(
    { wasmLoaderPath: base + "wasm/vision_wasm_internal.js", wasmBinaryPath: base + "wasm/vision_wasm_internal.wasm" },
    { baseOptions: { modelAssetPath: base + "hand_landmarker.task", delegate: "CPU" }, runningMode: "IMAGE", numHands: 1 },
  );
  return landmarker;
}

// Returns { points, handedness, score } or null when no hand is found.
export async function detectHand(img) {
  const lmk = await load();
  const r = lmk.detect(img);
  if (!r.landmarks?.length) return null;
  const h = r.handednesses?.[0]?.[0] ?? r.handedness?.[0]?.[0];
  return {
    points: landmarksToPoints(r.landmarks[0], img.naturalWidth ?? img.width, img.naturalHeight ?? img.height),
    handedness: h?.categoryName ?? null,
    score: h?.score ?? null,
  };
}
