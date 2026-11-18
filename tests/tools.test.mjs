import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPocket, pocketPlan, fitWidth, printableFillet, pocketLabelText, POCKET_DEFAULTS } from "../js/pocket.js";
import { buildTalon, talonProfile, talonLabelText, TALON_DEFAULTS, TALON_SHAPES } from "../js/talon.js";
import { HAND_DEFAULTS } from "../js/hand.js";
import { flatTriangles } from "../tools/mesh-check.mjs";

const close = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b} (±${tol})`);
const box = ({ positions: P }) => {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i++) { lo[i % 3] = Math.min(lo[i % 3], P[i]); hi[i % 3] = Math.max(hi[i % 3], P[i]); }
  return { lo, hi };
};

test("pocket blocks: closed, positive volume, no flat triangles, size as planned", () => {
  for (const v of [{}, { style: "through" }, { fingerSet: "middle", pocketWidth: 22, pocketHeight: 20, pocketCorner: 10, floorRound: 8 }, { rimRadius: 0, floorRound: 0, edgeRound: 0 }]) {
    const p = { ...POCKET_DEFAULTS, ...v }, m = buildPocket(p);
    assert.equal(m.stats.badEdges, 0, JSON.stringify(v));
    assert.ok(m.stats.volume > 0);
    assert.equal(flatTriangles(m.body), 0, JSON.stringify(v));
    const b = box(m.body);
    close(b.hi[2] - b.lo[2], p.depth + (p.style === "blind" ? p.floorThick : 0), 1e-9);
    close(b.lo[2], 0, 1e-9);
    close(b.hi[0] - b.lo[0], m.size.x, 1e-6);
    close(b.hi[1] - b.lo[1], m.size.y, 0.05); // the outline is a sampled hull of circles
  }
});

test("pocket: blind has a floor, through goes through; the rim widens the pocket at the top face", () => {
  const P = POCKET_DEFAULTS;
  const blind = buildPocket(P), through = buildPocket({ ...P, style: "through" });
  // a vertical line through the pocket centre meets the blind body (floor), not the through one
  const hitsAtCentre = ({ positions: X, indices: I }, y) => {
    let n = 0;
    for (let k = 0; k < I.length; k += 3) {
      const [a, b, c] = [I[k], I[k + 1], I[k + 2]].map((i) => [X[3 * i], X[3 * i + 1]]);
      const s = (u, v) => (v[0] - u[0]) * (y - u[1]) - (v[1] - u[1]) * (0 - u[0]);
      const d1 = s(a, b), d2 = s(b, c), d3 = s(c, a);
      if ((d1 > 0 && d2 > 0 && d3 > 0) || (d1 < 0 && d2 < 0 && d3 < 0)) n++;
    }
    return n;
  };
  assert.equal(hitsAtCentre(blind.body, blind.offset.y), 2); // floor: bottom and top face of it
  assert.equal(hitsAtCentre(through.body, through.offset.y), 0);
  const pl = pocketPlan(P);
  close(pl.offs(pl.T)[1], pl.rim, 1e-9); // fully round at the top face
  close(pl.offs(pl.T / 2)[1], 0, 1e-9); // straight wall in between
  close(pl.offs(pl.F)[1], -pl.floorR, 1e-9); // the bowl: narrower at the floor
});

test("printable fillet: round down to 45°, then a straight 45° line to the face", () => {
  const f = printableFillet(4);
  close(f(4), 0, 1e-12);
  const zt = 4 * (1 - Math.SQRT1_2);
  close(f(zt), 4 * (1 - Math.SQRT1_2), 1e-9);
  close(f(0) - f(0.5), 0.5, 1e-9); // 45° below the tangent point
  close(f(0), 2 * 4 * (1 - Math.SQRT1_2), 1e-9);
});

test("pocket width fitted to the fingers: widths side by side plus the room each side", () => {
  const w = fitWidth({}, "middle+ring", "R", 1.5);
  close(w, HAND_DEFAULTS.wMiddleR + HAND_DEFAULTS.wRingR + 3, 0.25);
  close(fitWidth({ wIndexL: 20 }, "index", "L", 2), 24, 1e-9);
});

test("pocket: too little wall at a face is refused with a message, not built", () => {
  assert.throws(() => buildPocket({ ...POCKET_DEFAULTS, neck: 5 }), /neck/);
  assert.throws(() => buildPocket({ ...POCKET_DEFAULTS, style: "through", rimRadius: 10.5, outerRadius: 29.5, neck: 28.5 }), /side walls/);
});

test("pocket strength: thicker bar, smaller stress", () => {
  const a = buildPocket(POCKET_DEFAULTS).strength.sections[0].stress;
  const b = buildPocket({ ...POCKET_DEFAULTS, barDepth: 20 }).strength.sections[0].stress;
  close(a / b, (20 / 14) ** 2, 1e-9);
});

test("talon grip: the drawing's measures (⌀100.8 × 79.9, R32.5, top ⌀57.9), closed mesh", () => {
  const m = buildTalon(TALON_DEFAULTS);
  assert.equal(m.stats.badEdges, 0);
  assert.equal(flatTriangles(m.body), 0);
  const b = box(m.body);
  close(b.hi[2], 79.9, 1e-9);
  close(b.hi[0] - b.lo[0], 100.8, 0.05);
  close(m.plan.rTop * 2, 57.9, 1e-9);
  close(m.plan.rb * 2, 83.8, 1); // the drawing's foot; here it follows from taper and shoulder
  // the volume of the revolved section (Pappus) matches the mesh
  const pts = m.plan.pts;
  let A = 0, Mr = 0;
  for (let i = 0; i < pts.length; i++) {
    const [r1, z1] = pts[i], [r2, z2] = pts[(i + 1) % pts.length], c = r1 * z2 - r2 * z1;
    A += c / 2; Mr += (r1 + r2) * c / 6;
  }
  close(m.stats.volume, 2 * Math.PI * Mr, 0.01 * m.stats.volume);
  assert.ok(A > 0);
});

test("talon: the ball preset is a sphere above its 45°-or-less cone; nothing overhangs more than the taper", () => {
  for (const shape of Object.values(TALON_SHAPES)) {
    const p = { ...TALON_DEFAULTS, ...shape }, pr = talonProfile(p);
    // walk up the outside: above the 45° foot chamfer the radius may only grow by tan(taper) per mm
    const outside = pr.pts.filter(([r]) => r > pr.rTop - 1e-9 || r > p.knotDia / 2 + p.rimRound + 1e-6);
    for (let i = 1; i < outside.length; i++) {
      const [r1, z1] = outside[i - 1], [r2, z2] = outside[i];
      if (z2 > z1 + 1e-9 && r2 > r1 && z1 >= p.chamferLayers * p.layerHeight - 1e-9) assert.ok((r2 - r1) / (z2 - z1) <= Math.tan((p.taper * Math.PI) / 180) + 1e-6, `${r1},${z1} → ${r2},${z2}`);
    }
    assert.equal(buildTalon(p).stats.badEdges, 0);
  }
});

test("talon: impossible shapes are refused with a message", () => {
  assert.throws(() => buildTalon({ ...TALON_DEFAULTS, height: 30 }), /shoulder reaches below the foot/);
  assert.throws(() => buildTalon({ ...TALON_DEFAULTS, knotDia: 60 }), /does not fit in the top face/);
  assert.throws(() => buildTalon({ ...TALON_DEFAULTS, knotDepth: 100 }), /leaves 0.0 mm under it/);
});

test("pocket label: fingers and depth on the bar's outer wall; raised sticks out, engraved does not; closed", () => {
  assert.equal(pocketLabelText(POCKET_DEFAULTS), "MR 18");
  assert.equal(pocketLabelText({ ...POCKET_DEFAULTS, fingerSet: "index", depth: 12.5, labelText: "erik!" }), "I 12.5 ERIK");
  const lowest = (m) => { let lo = Infinity; for (let i = 1; i < m.body.positions.length; i += 3) lo = Math.min(lo, m.body.positions[i] - m.offset.y); return lo; };
  const off = buildPocket({ ...POCKET_DEFAULTS, labelMode: "off" });
  for (const mode of ["raised", "engraved"]) {
    const m = buildPocket({ ...POCKET_DEFAULTS, labelMode: mode });
    assert.equal(m.plan.labels.length, 1, mode);
    assert.equal(m.stats.badEdges, 0, mode);
    assert.equal(flatTriangles(m.body), 0, mode);
    close(lowest(m), m.plan.yb - (mode === "raised" ? POCKET_DEFAULTS.labelDepth : 0), 1e-6);
    assert.ok(mode === "raised" ? m.stats.volume > off.stats.volume : m.stats.volume < off.stats.volume);
  }
});

test("talon label: engraved into the foot, mirrored so it reads from below; closed", () => {
  assert.equal(talonLabelText(TALON_DEFAULTS), "101 T11");
  const off = buildTalon({ ...TALON_DEFAULTS, labelMode: "off" });
  const m = buildTalon({ ...TALON_DEFAULTS, labelAuto: false, labelText: "AL", labelDepth: 0.9 });
  assert.equal(m.stats.badEdges, 0);
  assert.equal(flatTriangles(m.body), 0);
  assert.ok(m.stats.volume < off.stats.volume);
  // the letters' ceilings, 0.9 mm up: A (first) at +x, L at −x: seen from below, A is on the left
  const P = m.body.positions, ceil = [];
  for (let i = 0; i < P.length; i += 3) if (Math.abs(P[i + 2] - 0.9) < 1e-9) ceil.push(P[i]);
  assert.ok(ceil.length > 10);
  const lb = m.plan.labels[0];
  const mid = (g) => g.hole.reduce((s, q) => s + q.x, 0) / g.hole.length;
  assert.ok(mid(lb.letters[0]) > 0 !== mid(lb.letters[1]) > 0);
  assert.ok(Math.max(...lb.letters.map(mid)) === mid(lb.letters.find((g) => g.islands.length)), "A (with its counter) on the +x side");
});
