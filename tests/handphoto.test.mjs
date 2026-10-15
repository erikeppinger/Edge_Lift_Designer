import { test } from "node:test";
import assert from "node:assert/strict";
import { measureHand, photoSteps } from "../js/handphoto.js";
import { HAND_DEFAULTS, fingerHeights } from "../js/hand.js";

// 10 px per mm; the hand axis (MCP → PIP) points along +y.
const P = (x, y) => ({ x, y });
const fist = {
  rA: P(0, 0), rB: P(0, 1000),
  indexBase: P(-200, 20), indexPip: P(-200, 420),
  middleBase: P(0, 0), middlePip: P(0, 450),
  ringBase: P(150, -20), ringPip: P(150, 400),
  littleBase: P(300, -50), littlePip: P(300, 280),
};

test("half fist: P1 from knuckle to middle joint, knuckle offsets along the hand axis", () => {
  const { values } = measureHand("fist", fist, 100);
  assert.deepEqual(values, {
    p1Index: 40, p1Middle: 45, p1Ring: 42, p1Little: 33,
    kIndex: 2, kMiddle: 0, kRing: -2, kLittle: -5,
  });
});

test("half fist: a rotated photo gives the same values", () => {
  const a = 0.6, rot = (q) => P(q.x * Math.cos(a) - q.y * Math.sin(a), q.x * Math.sin(a) + q.y * Math.cos(a));
  const turned = Object.fromEntries(Object.entries(fist).map(([k, q]) => [k, rot(q)]));
  assert.deepEqual(measureHand("fist", turned, 100).values, measureHand("fist", fist, 100).values);
});

test("half fist values give the steps: h = middle reach − finger reach", () => {
  const { values } = measureHand("fist", fist, 100);
  const withR = Object.fromEntries(Object.entries(values).map(([k, v]) => [k + "R", v]));
  const h = fingerHeights({ ...HAND_DEFAULTS, ...withR }, "R");
  // reach = P1 + knuckle: index 42, middle 45, ring 40, little 28
  assert.deepEqual(h, { index: 3, middle: 0, ring: 5, little: 17 });
});

test("palm mode: widths, no knuckle offsets; fist mode asks for no widths", () => {
  const pts = { rA: P(0, 0), rB: P(0, 1000), indexBase: P(0, 0), indexPip: P(0, 250), indexD1: P(0, 0), indexD2: P(180, 0) };
  assert.deepEqual(measureHand("palm", pts, 100).values, { p1Index: 25, wIndex: 18 });
  assert.equal(photoSteps("fist").length, 2 + 4 * 2);
  assert.equal(photoSteps("palm").length, 2 + 4 * 4);
});

test("detected landmarks map to knuckle, middle joint and an end-joint width across the finger", async () => {
  const { landmarksToPoints, LANDMARKS } = await import("../js/detect.js");
  // fingers pointing up (−y), 20 px apart; image 1000 × 1000, landmarks normalised
  const lm = Array.from({ length: 21 }, () => ({ x: 0, y: 0 }));
  ["index", "middle", "ring", "little"].forEach((f, i) => {
    const x = (100 + 20 * i) / 1000;
    const [m, p, d] = LANDMARKS[f];
    lm[m] = { x, y: 0.8 }; lm[p] = { x, y: 0.5 }; lm[d] = { x, y: 0.3 };
  });
  const pts = landmarksToPoints(lm, 1000, 1000);
  assert.deepEqual(pts.middleBase, { x: 120, y: 800 });
  assert.deepEqual(pts.middlePip, { x: 120, y: 500 });
  // width = spacing of the neighbouring end joints (20 px), centred on the end joint, across the finger
  assert.ok(Math.abs(Math.hypot(pts.middleD1.x - pts.middleD2.x, pts.middleD1.y - pts.middleD2.y) - 20) < 1e-9);
  assert.ok(Math.abs((pts.middleD1.y + pts.middleD2.y) / 2 - 300) < 1e-9 && Math.abs(pts.middleD1.y - pts.middleD2.y) < 1e-9);
});
