import { test } from "node:test";
import assert from "node:assert/strict";
import { HAND_DEFAULTS, fingerHeights, fingerLayout, fitLayout } from "../js/hand.js";

const hand = (side, p1, k = [0, 0, 0, 0]) => Object.fromEntries(["Index", "Middle", "Ring", "Little"].flatMap((f, i) => [
  [`p1${f}${side}`, p1[i]], [`k${f}${side}`, k[i]]]));

test("edge heights per hand follow P1 + knuckle offset, relative to the middle finger", () => {
  const p = { ...HAND_DEFAULTS, ...hand("R", [40, 45, 43, 33], [0, 0, 0, -5]), ...hand("L", [41, 46.5, 43, 33.5]), stepScale: 1 };
  assert.deepEqual(fingerHeights(p, "R"), { index: 5, middle: 0, ring: 2, little: 17 });
  assert.deepEqual(fingerHeights(p, "L"), { index: 5.5, middle: 0, ring: 3.5, little: 13 });
  assert.deepEqual(fingerHeights({ ...p, unlevel: false }, "R"), { index: 0, middle: 0, ring: 0, little: 0 });
  assert.deepEqual(fingerHeights({ ...p, stepScale: 0.5 }, "R"), { index: 2.5, middle: 0, ring: 1, little: 8.5 });
});

test("finger order: right hand index first, left hand mirrored", () => {
  const names = (side) => fingerLayout(HAND_DEFAULTS, side).segments.map((s) => s.name);
  assert.deepEqual(names("R"), ["margin", "index", "middle", "ring", "little", "margin"]);
  assert.deepEqual(names("L"), ["margin", "little", "ring", "middle", "index", "margin"]);
});

test("width: the hand's finger widths + margins; a narrower hand is centred by wider margins", () => {
  const p = { ...HAND_DEFAULTS, sideMargin: 6, wIndexL: 18, wMiddleL: 18, wRingL: 17, wLittleL: 15 };
  const R = fingerLayout(p, "R"), L = fingerLayout(p, "L");
  assert.equal(R.width, 19.5 + 19.5 + 19 + 17 + 12);
  assert.equal(L.width, 18 + 18 + 17 + 15 + 12);
  const fit = fitLayout(L, R.width);
  assert.equal(fit.segments[0].x1 - fit.segments[0].x0, 6 + (R.width - L.width) / 2);
  assert.equal(fit.segments.at(-1).x1, R.width);
});
