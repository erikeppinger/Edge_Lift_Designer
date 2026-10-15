import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULTS, framePlan, strength } from "../js/frame.js";
import { buildModel } from "../js/model.js";
import { chamferProfile } from "../js/mesh.js";

const close = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b} (±${tol})`);

test("default frame: closed mesh, no warnings, bounding box = plan size", () => {
  const m = buildModel(DEFAULTS);
  assert.equal(m.stats.badEdges, 0);
  assert.ok(m.stats.volume > 0);
  assert.deepEqual(m.warnings, []);
  const P = m.body.positions, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], P[i + k]); hi[k] = Math.max(hi[k], P[i + k]); }
  close(hi[0] - lo[0], m.size.x, 1e-6);
  close(hi[1] - lo[1], m.size.y, 1e-6);
  close(hi[2] - lo[2], m.size.z, 1e-6);
});

test("variants stay closed", () => {
  for (const v of [
    { slotShape: "plain" }, { slotShape: "lens" }, { hands: 2 }, { hands: 1 }, { unlevel: false }, { hand: "left" },
    { hands: 2, hand: "left" }, { hands: 2, p1IndexL: 44, p1LittleL: 30, wLittleL: 15 }, { denseZones: true }, { chamferLayers: 0 }, { edgeRadius: 0 },
    { edgeDepth: 12, edgeRadius: 3 }, { floorThick: 5 }, { stepAngle: 45 }, { stepAngle: 90 }, { floorFillet: 0 }, { bow: -6 }, { bow: -6, hands: 1 }, { bow: 0 },
    { p1IndexR: 44, p1RingR: 46, p1LittleR: 30, kLittleR: -6 },
  ]) {
    const m = buildModel({ ...DEFAULTS, ...v });
    assert.equal(m.stats.badEdges, 0, JSON.stringify(v));
    assert.ok(m.stats.volume > 0, JSON.stringify(v));
  }
});

test("both hands: top edge from the chosen hand, bottom edge from the other, rotated by 180°", () => {
  const p = { ...DEFAULTS, hands: 2, hand: "right", p1IndexR: 40, p1MiddleR: 45, p1RingR: 42, p1LittleR: 33,
    p1IndexL: 41, p1MiddleL: 46.5, p1RingL: 43, p1LittleL: 33.5 };
  const plan = framePlan(p);
  const top = (n) => plan.segs.find((s) => s.name === n), bot = (n) => plan.botSegs.find((s) => s.name === n);
  assert.equal(plan.yTop(top("little")), p.windowHeight + 12); // right little: 45 − 33
  assert.equal(plan.yBot(bot("little")), -13); // left little: 46.5 − 33.5, pointing down
  // right hand: index first along the top; the left hand's own layout (little first) rotated: index first too
  assert.ok(top("index").x0 < top("little").x0);
  assert.ok(bot("index").x0 < bot("little").x0);
  const one = framePlan({ ...p, hands: 1 });
  assert.deepEqual(one.botSegs.map((s) => s.h), [0]); // one hand: straight opposite border
});

test("chamfer profile: 45° at both faces", () => {
  const c = chamferProfile(0.6, 0.6, 20);
  close(c.off(0), 0.6, 1e-12); close(c.off(10), 0, 1e-12); close(c.off(20), 0.6, 1e-12);
});

test("pocket rim: quarter round of the front radius at the top face, 45° fillet at the floor", () => {
  const p = { ...DEFAULTS, edgeRadius: 4, floorFillet: 1.5 };
  const w = framePlan(p).profiles.wall, T = p.edgeDepth + p.floorThick, F = p.floorThick;
  close(w.off(T), 4, 1e-9); // the rim is 4 mm wider at the top face
  close(w.off(T - 4), 0, 1e-9);
  close(w.off(F), -1.5, 1e-9); // the pocket is 1.5 mm smaller at the floor
  close(w.off(F + 1.5), 0, 1e-9);
});

test("steep steps: wall run = Δh / tan(angle)", () => {
  const p = { ...DEFAULTS, p1IndexR: 38, p1MiddleR: 45, stepAngle: 80, stepRadius: 0.1 };
  const plan = framePlan(p);
  const xs = plan.loops[1].map((q) => q.x);
  // the index/middle step wall: 45 − 38 = 7 mm apart in y, run = 7 / tan 80°
  const pts = plan.loops[1];
  let found = false;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (Math.abs(Math.abs(a.y - b.y) - 7) < 1e-9) { close(Math.abs(a.x - b.x), 7 / Math.tan((80 * Math.PI) / 180), 1e-9); found = true; }
  }
  assert.ok(found && xs.length > 0);
});

test("pocket plate without rounding: volume = outer·T − pocket·d − slots·T", () => {
  const p = { ...DEFAULTS, unlevel: false, chamferLayers: 0, edgeRadius: 0, floorFillet: 0, bow: 0, outerRadius: 0.001, windowRadius: 0.5, slotShape: "plain" };
  const m = buildModel(p);
  assert.equal(m.stats.badEdges, 0);
  const pl = m.plan;
  const slot = pl.sw * p.slotLength - (4 - Math.PI) * (pl.sw / 2) ** 2;
  const pocket = pl.Ww * pl.Hw - (4 - Math.PI) * p.windowRadius ** 2;
  const expect = m.size.x * m.size.y * pl.T - pocket * p.edgeDepth - 2 * slot * pl.T;
  close(m.stats.volume, expect, 5); // slot arcs are polygons
  close(pl.T, p.edgeDepth + p.floorThick, 1e-12);
});

test("pocket floor sits at the floor thickness, facing up", () => {
  const m = buildModel({ ...DEFAULTS, unlevel: false, floorFillet: 0 });
  const P = m.body.positions, I = m.body.indices;
  let floorArea = 0;
  for (let k = 0; k < I.length; k += 3) {
    const a = I[k] * 3, b = I[k + 1] * 3, c = I[k + 2] * 3;
    const z = [P[a + 2], P[b + 2], P[c + 2]];
    if (z.every((q) => Math.abs(q - DEFAULTS.floorThick) < 1e-9)) {
      const nz = (P[b] - P[a]) * (P[c + 1] - P[a + 1]) - (P[b + 1] - P[a + 1]) * (P[c] - P[a]);
      floorArea += nz / 2;
    }
  }
  assert.ok(floorArea > 0.9 * m.plan.Ww * m.plan.Hw, "floor faces up and covers the pocket: " + floorArea);
});

test("bar stress = 6·M / (T·b²), M = F(2L − w)/8", () => {
  const p = { ...DEFAULTS, loadKg: 100 };
  const plan = framePlan(p);
  const s = strength(p, plan);
  const w = plan.layout.width - 2 * p.sideMargin;
  const M = (981 * (2 * s.span - w)) / 8;
  close(s.sections[0].stress, (6 * M) / (plan.T * p.barThick ** 2), 1e-9);
});

test("inward bow: bar outline dips by |bow| in the middle, size and strength follow", () => {
  const two = { ...DEFAULTS, hands: 2 };
  const out = buildModel({ ...two, bow: 5 }), inw = buildModel({ ...two, bow: -5 }), flat = buildModel({ ...two, bow: 0 });
  close(out.size.y - flat.size.y, 10, 1e-9); // two bars, each +5
  close(inw.size.y, flat.size.y, 1e-9); // corners still at the full height
  const mid = (m) => Math.max(...m.plan.loops[0].filter((q) => Math.abs(q.x - (m.plan.Ww / 2)) < 3).map((q) => q.y));
  close(mid(inw), flat.plan.yOuterTop - 5, 0.05);
  close(inw.strength.sections[0].stress / flat.strength.sections[0].stress, (DEFAULTS.barThick / (DEFAULTS.barThick - 5)) ** 2, 1e-9);
});

test("side bar tension = (F/2) / ((side bar − hole width) · T)", () => {
  const p = { ...DEFAULTS, loadKg: 100 };
  const plan = framePlan(p);
  const s = strength(p, plan);
  close(s.sections[1].stress, 981 / 2 / ((p.sideBar - 2 * plan.holeHalf) * plan.T), 1e-9);
  assert.ok(plan.holeHalf > p.cordDia / 2); // the teardrop is wider than the cord
});
