// The lift edge as a flat frame (like the Ergo Block): a rounded plate with a pocket. The pocket's
// top border is the edge, stepped per finger in the plane of the plate. The cord runs through holes
// in the side bars, at mid-thickness, so it pulls in line with the finger pads. No DOM.
//
// Plane of the plate (print XY), as held for a lift, y up:
//
//    ╭──────────────────────────────────────╮
//    │      top bar                          │
//    │  ┌──┐ ┌─────┐ ┌──────────┐ ┌──┐       │  ← edge: fingers press up on it, one step per
//    │ ▼│   └─┘     └─┘          └─┘  │ ▼    │    finger, steep step walls
//    │  │            pocket            │      │  ▼ cord holes, narrow end towards the load
//    │  └──────────────────────────────┘      │  ← straight border (or a second edge)
//    ╰──────────────────────────────────────╯
//
// z is the plate thickness (print height). The pocket is blind, open at the top face, as deep
// as the edge, with a thin floor at the bed (like the Ergo Block: 20 mm edge on a 23 mm plate). The
// fingers come from the open top face and press on the pocket's stepped wall; the floor stops the
// fingertips like the back wall of a hangboard edge. It prints flat, pocket up, without supports,
// and the bars bend within the layers.

import { HAND_DEFAULTS, fingerLayout, fitLayout, sideOf, otherHand } from "./hand.js";
import { filletClashes, reversed, teardrop, roundedRing, segmentPlan } from "./geom2d.js";
import { pocketBody, chamferProfile, box, mergeMeshes } from "./mesh.js";

export const DEFAULTS = {
  ...HAND_DEFAULTS,
  // edge
  edgeDepth: 20, // pocket depth = how deep the fingers sit on the edge
  floorThick: 3, // pocket floor at the bed; plate = edge depth + floor
  edgeRadius: 4, // where the fingers wrap around (the pocket's top rim)
  floorFillet: 1.5, // 45° fillet where the pocket wall meets the floor
  stepAngle: 85, // step walls between fingers, degrees from the edge line
  stepRadius: 6, // rounding of the step corners; on short steps the two fillets meet (an S-curve)
  windowHeight: 30, // pocket height: room for the fingers (at the middle finger)
  windowRadius: 5, // pocket corner radius
  // frame
  barThick: 18, // edge bar depth at its thinnest (above the highest step)
  sideBar: 22,
  outerRadius: 8, // the cord wraps around the side: keep it round
  bow: 4, // the outer edge of the bar the hand rests on bulges this much in the middle (in a half
  //         crimp the flexed knuckles form an arch); negative curves it inwards. Both bars when
  //         there is a second edge.
  // cord
  slotShape: "auto", // auto: teardrop with one edge, lens with two; teardrop; lens; plain
  cordDia: 6,
  slotLength: 26,
  // printing
  nozzle: 0.4,
  layerHeight: 0.2,
  chamferLayers: 3, // 45° chamfer on the outside and the slots, both faces
  walls: 6,
  infill: 30,
  infillPattern: "gyroid",
  topBottomLayers: 5,
  denseZones: false,
  zoneInfill: 60,
  zonePattern: "gyroid",
  bambuPrinter: "Bambu Lab P1S", // Bambu Studio export: which printer's presets the file names
  // strength
  loadKg: 100,
  strengthMPa: 35,
};

const rad = (deg) => (deg * Math.PI) / 180;

// Exact offset of the pocket outline. The pocket is bounded by a bottom border B(x) and a top
// border T(x) over 0 ≤ x ≤ Ww (rounded corners included), so growing it by d is the envelope of
// circles: top max T(x') + √(d² − (x−x')²), bottom min B(x') − √(…); shrinking uses min/max the
// other way round. Concentric fillet offsets fail here: on short step walls the grown fillets
// overlap. Every ring has the same number of points (fixed x samples), so the rings line up.
// maxOffset: the largest offset that will be asked for (rim round / floor fillet).
export function pocketOffsetter(win, Ww, maxOffset = 0, spacing = 0.15, coarse = 1) {
  const ring0 = roundedRing(win, 0, segmentPlan(win, 0, 0.005));
  const iA = ring0.findIndex((q) => q.x >= Ww - 1e-9); // end of the bottom chain (right side, low)
  const bottom = ring0.slice(0, iA + 1);
  const top = ring0.slice(iA + 1).reverse(); // left → right
  const sampler = (chain) => {
    const xs = chain.map((q) => q.x), ys = chain.map((q) => q.y);
    return (x) => {
      let lo = 0, hi = xs.length - 1;
      if (x <= xs[0]) return ys[0];
      if (x >= xs[hi]) return ys[hi];
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] <= x) lo = mid; else hi = mid; }
      const t = xs[hi] - xs[lo] < 1e-12 ? 1 : (x - xs[lo]) / (xs[hi] - xs[lo]);
      return ys[lo] + t * (ys[hi] - ys[lo]);
    };
  };
  const T = sampler(top), B = sampler(bottom);
  const N = Math.max(80, Math.ceil(Ww / spacing));
  const fine = Array.from({ length: N + 1 }, (_, i) => (Ww * i) / N);
  const Tf = fine.map(T), Bf = fine.map(B);
  // Output samples by shape change: a new sample once either border has moved 0.3 mm in height
  // or 1 mm along the edge since the last one. Straight stretches get few points, steep step walls
  // many. The fractions are the same for every ring, so the rings still line up vertex for vertex.
  // (Rounds only grow with the offset, so sampling the unrounded outline is fine enough.)
  const keep = new Set([0, Ww]);
  let lastJ = 0;
  for (let j = 1; j <= N; j++) {
    if (Math.abs(Tf[j] - Tf[lastJ]) > 0.3 || Math.abs(Bf[j] - Bf[lastJ]) > 0.3 || fine[j] - fine[lastJ] >= coarse) {
      keep.add(+fine[j].toFixed(6));
      lastJ = j;
    }
  }
  // near the ends the offset circles sweep the corners: keep those fine
  for (let j = 0; j <= N; j++) if (fine[j] < maxOffset + 2 || fine[j] > Ww - maxOffset - 2) keep.add(+fine[j].toFixed(6));
  const us = [...keep].sort((a, b) => a - b).map((x) => x / Ww);
  const M = us.length - 1;
  return (d) => {
    const grow = d >= 0, e = Math.abs(d);
    const x0 = grow ? -e : e, x1 = grow ? Ww + e : Ww - e;
    const up = [], dn = [];
    for (let i = 0; i <= M; i++) {
      const x = x0 + (x1 - x0) * us[i];
      if (e < 1e-9) { up.push(T(x)); dn.push(B(x)); continue; }
      let u = grow ? -Infinity : Infinity, l = grow ? Infinity : -Infinity;
      const j0 = Math.max(0, Math.floor(((x - e) / Ww) * N)), j1 = Math.min(N, Math.ceil(((x + e) / Ww) * N));
      for (let j = j0; j <= j1; j++) {
        const dx = x - fine[j];
        if (Math.abs(dx) > e + 1e-9) continue; // tolerance: the end samples sit exactly at the reach
        const h = Math.sqrt(Math.max(0, e * e - dx * dx));
        if (grow) { u = Math.max(u, Tf[j] + h); l = Math.min(l, Bf[j] - h); }
        else { u = Math.min(u, Tf[j] - h); l = Math.max(l, Bf[j] + h); }
      }
      up.push(u); dn.push(l);
    }
    // counter-clockwise: bottom left → right, top right → left; the hole loop runs the other way
    const ccw = [];
    for (let i = 0; i <= M; i++) ccw.push({ x: x0 + (x1 - x0) * us[i], y: dn[i] });
    for (let i = M; i >= 0; i--) ccw.push({ x: x0 + (x1 - x0) * us[i], y: up[i] });
    return ccw.reverse();
  };
}

// One stepped border, from x = 0 to x = Ww, at heights y(seg). Steps are steep walls (stepAngle)
// centred on the boundary between two segments; their corner radius shrinks if the wall is short.
function border(segs, yOf, p) {
  const pts = [];
  const a = rad(Math.min(90, Math.max(30, p.stepAngle)));
  const turn = a; // the outline turns by the wall angle at both ends of a wall
  for (let i = 0; i < segs.length - 1; i++) {
    const sa = segs[i], sb = segs[i + 1];
    const ya = yOf(sa), yb = yOf(sb), dh = yb - ya;
    if (Math.abs(dh) < 0.05) continue;
    const run = Math.abs(dh) / Math.tan(a); // horizontal length of the wall
    const wall = Math.abs(dh) / Math.sin(a);
    const r = Math.min(p.stepRadius, (wall * 0.499) / Math.tan(turn / 2)); // fillets may (just) meet
    pts.push({ x: sa.x1 - run / 2, y: ya, r }, { x: sa.x1 + run / 2, y: yb, r });
  }
  return pts;
}

export function slotShapeOf(p) {
  if (p.slotShape !== "auto") return p.slotShape;
  return p.hands === 2 ? "lens" : "teardrop";
}

// Cord hole centred at (cx, cy), long axis along y. Teardrop: round end up, narrow end towards the
// load (down in a lift). Lens: pointed at both ends, for a plate used either way up.
function slot(p, cx, cy) {
  const L = p.slotLength, sw = p.cordDia + 1;
  const tipR = Math.max(0.5, p.cordDia * 0.3);
  const shape = slotShapeOf(p);
  if (shape === "teardrop") {
    const R = sw / 2 + 0.5;
    const toTip = L - R; // round end centre to the tip
    const wedge = 2 * Math.asin(Math.min(0.95, R / toTip));
    return teardrop(cx, cy + L / 2 - R, R, tipR, wedge); // counter-clockwise, tip at −y
  }
  if (shape === "lens") {
    const edge = Math.hypot(sw / 2, L / 2);
    const sideTurn = Math.PI - 2 * Math.atan(L / sw);
    const tipTurn = Math.PI - 2 * Math.atan(sw / L);
    const tipT = Math.min(tipR, (edge * 0.4) / Math.tan(tipTurn / 2));
    const sideR = (edge * 0.5) / Math.tan(sideTurn / 2);
    return [
      { x: cx, y: cy - L / 2, r: tipT }, { x: cx + sw / 2, y: cy, r: sideR },
      { x: cx, y: cy + L / 2, r: tipT }, { x: cx - sw / 2, y: cy, r: sideR },
    ];
  }
  const r = sw / 2 - 0.01;
  return [{ x: cx - sw / 2, y: cy - L / 2, r }, { x: cx + sw / 2, y: cy - L / 2, r }, { x: cx + sw / 2, y: cy + L / 2, r }, { x: cx - sw / 2, y: cy + L / 2, r }];
}

export function framePlan(p) {
  // Top edge: the chosen hand. Both hands: the bottom edge belongs to the other hand. It is used
  // after turning the plate end over end, so its layout is that hand's top-edge layout rotated by
  // 180° in the plane: x mirrored and heights pointing down.
  const two = p.hands === 2;
  const topSide = sideOf(p.hand), botSide = sideOf(otherHand(p.hand));
  const lt = fingerLayout(p, topSide), lb = two ? fingerLayout(p, botSide) : null;
  const Ww = Math.max(lt.width, lb ? lb.width : 0), Hw = p.windowHeight, sb = p.sideBar;
  const topLayout = fitLayout(lt, Ww), botLayout = lb ? fitLayout(lb, Ww) : null;
  const segs = topLayout.segments;
  const botSegs = botLayout
    ? botLayout.segments.map((q) => ({ ...q, x0: Ww - q.x1, x1: Ww - q.x0 })).reverse()
    : [{ name: "flat", x0: 0, x1: Ww, h: 0, finger: false }];
  const yTop = (q) => Hw + q.h;
  const yBot = (q) => -q.h;
  const layout = topLayout;
  const first = segs[0], last = segs[segs.length - 1], bFirst = botSegs[0], bLast = botSegs[botSegs.length - 1];
  const rw = p.windowRadius;
  const d = p.edgeDepth, F = p.floorThick, T = d + F;

  // Pocket outline, counter-clockwise: bottom border left → right, top border right → left.
  const win = [
    { x: 0, y: yBot(bFirst), r: rw },
    ...border(botSegs, yBot, p),
    { x: Ww, y: yBot(bLast), r: rw },
    { x: Ww, y: yTop(last), r: rw },
    ...border(segs, yTop, p).reverse(),
    { x: 0, y: yTop(first), r: rw },
  ];

  const winTopMax = Math.max(...segs.map(yTop)), winBotMin = Math.min(...botSegs.map(yBot));
  const yOuterTop = winTopMax + p.barThick;
  const yOuterBot = winBotMin - p.barThick;
  // Bowed bar edge: a circular arc through both corners, bulging by `bow` in the middle (inwards
  // when negative).
  const x0 = -sb, x1 = Ww + sb;
  const arcPts = (yBase, dir) => {
    const b = Math.abs(p.bow ?? 0), sgn = Math.sign(p.bow ?? 0);
    if (b < 1e-6) return [];
    const L = x1 - x0, R = (L * L / 4 + b * b) / (2 * b), xc = (x0 + x1) / 2, n = 24;
    const pts = [];
    const m = Math.min(2 * p.outerRadius + 1, L / 4); // keep clear of the corner roundings
    for (let i = 0; i <= n; i++) {
      const x = x1 - m - ((x1 - x0 - 2 * m) * i) / n; // right → left along the top; reversed for the bottom
      pts.push({ x, y: yBase + dir * sgn * (Math.sqrt(R * R - (x - xc) ** 2) - (R - b)), r: 0 });
    }
    return pts;
  };
  const bowBottom = two;
  const outer = [
    { x: x0, y: yOuterBot, r: p.outerRadius },
    ...(bowBottom ? arcPts(yOuterBot, -1).reverse() : []),
    { x: x1, y: yOuterBot, r: p.outerRadius },
    { x: x1, y: yOuterTop, r: p.outerRadius },
    ...arcPts(yOuterTop, 1),
    { x: x0, y: yOuterTop, r: p.outerRadius },
  ];
  const yMax = yOuterTop + Math.max(0, p.bow), yMin = yOuterBot - (bowBottom ? Math.max(0, p.bow) : 0);
  const cy = Hw / 2;
  // Cord holes: centred in the side bar material that is left between the outer edge and the
  // pocket rim, which the front radius widens at the top face.
  const c = p.chamferLayers * p.layerHeight; // 45° chamfers, both faces
  const rim = Math.max(0, p.edgeRadius);
  const slotX = [-(sb + rim) / 2, Ww + (sb + rim) / 2];
  const slots = slotX.map((sx) => slot(p, sx, cy));
  const holeHalf = Math.max(...roundedRing(slots[0], 0, segmentPlan(slots[0], 0)).map((q) => Math.abs(q.x - slotX[0])));
  const sideWall = (sb - rim) / 2 - holeHalf - c; // material left on each side of the hole at the top face

  const outerP = chamferProfile(c, c, T);
  // Pocket wall: a quarter round at the top rim (the fingers wrap it) and a 45° fillet at the floor
  // (the pocket is smaller there, so the inset is negative).
  const r = Math.min(p.edgeRadius, d - p.floorFillet - 0.1);
  const arc = (u) => r - Math.sqrt(Math.max(0, r * r - (r - u) ** 2));
  const wallP = {
    off: (z) => (z < F + p.floorFillet ? -(F + p.floorFillet - z) : T - z < r ? arc(T - z) : 0),
    breaks: [F, F + p.floorFillet, ...Array.from({ length: 9 }, (_, i) => T - (r - r * Math.cos((Math.PI / 2) * (i / 8))))],
  };

  const zsOf = (z0, z1, profiles) => [...new Set([z0, z1, ...profiles.flatMap((q) => q.breaks)]
    .filter((z) => z >= z0 - 1e-9 && z <= z1 + 1e-9).map((z) => +z.toFixed(6)))].sort((x, y) => x - y);
  const solid = [outer, ...slots.map(reversed)];
  const winLoop = reversed(win);
  winLoop.ringAt = pocketOffsetter(win, Ww, Math.max(p.edgeRadius, p.floorFillet));
  const pocketed = [outer, winLoop, ...slots.map(reversed)];
  const below = zsOf(0, F, [outerP]).map((z) => ({ z, loops: solid, off: [outerP.off(z), outerP.off(z), outerP.off(z)] }));
  const above = zsOf(F, T, [outerP, wallP]).map((z) => ({ z, loops: pocketed, off: [outerP.off(z), wallP.off(z), outerP.off(z), outerP.off(z)] }));

  const warnings = [];
  if (filletClashes(win, 0).length) warnings.push("Pocket: corner or step radii too large for the steps.");
  if (p.edgeRadius + p.floorFillet > d) warnings.push("Edge radius and floor fillet together are deeper than the edge.");
  if (c >= F) warnings.push("Floor thinner than the bed chamfer.");
  if (p.bow < 0 && p.barThick + p.bow < 8) warnings.push("The inward bow leaves the edge bar under 8 mm deep in the middle.");
  if (p.slotLength > yOuterTop - yOuterBot - 2 * p.outerRadius) warnings.push("Cord hole longer than the side bar.");
  if (sideWall < 0) throw new Error(`the cord hole does not fit in the side bar next to the rounded pocket rim. Make the side bars wider (at least ${(2 * (holeHalf + c) + rim + 3).toFixed(1)} mm), the front radius or the cord smaller.`);
  if (sideWall < 3) warnings.push(`Side bar thin around the cord hole: ${sideWall.toFixed(1)} mm each side at the top face (the front radius widens the pocket there).`);
  const longest = Math.max(Ww + 2 * sb, yMax - yMin);
  if (longest > 250) warnings.push(`The plate is ${longest.toFixed(0)} mm long: more than most print beds (250–256 mm).`);
  else if (longest > 180) warnings.push(`The plate is ${longest.toFixed(0)} mm long: too big for small printers (Bambu A1 mini, Prusa MINI: 180 mm).`);
  if (Hw < 22) warnings.push("Pocket under 22 mm high: curled fingers may not fit.");

  return {
    layout, segs, botSegs, botLayout, topSide, botSide, two, Ww, Hw, sb, T, d, F, c, below, above, loops: pocketed,
    profiles: { outer: outerP, wall: wallP },
    yTop, yBot, yOuterTop, yOuterBot, winTopMax, warnings,
    sw: p.cordDia + 1, slotX, holeHalf,
    yMax, yMin,
    size: { x: Ww + 2 * sb, y: yMax - yMin, z: T },
  };
}

// Collision check before building: outlines at the bed, at the pocket floor and at the top face
// must not cross each other or themselves. Throws a message that says what collides and what to
// change, instead of a failed triangulation.
function ringsAt(levels, k) {
  const lv = levels[k];
  return lv.loops.map((l, i) => l.ringAt ? l.ringAt(lv.off[i])
    : roundedRing(l, lv.off[i], segmentPlan(l, Math.max(...levels.map((q) => (Array.isArray(q.off) ? q.off[i] : q.off))))));
}
function crossings(a, b, self) {
  const o = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const box = (r) => r.map((p, i) => { const q = r[(i + 1) % r.length]; return [p, q, Math.min(p.x, q.x), Math.max(p.x, q.x), Math.min(p.y, q.y), Math.max(p.y, q.y)]; });
  const A = box(a), B = self ? A : box(b);
  for (let i = 0; i < A.length; i++) {
    const [p, q, ax0, ax1, ay0, ay1] = A[i];
    for (let j = self ? i + 2 : 0; j < B.length; j++) {
      if (self && i === 0 && j === B.length - 1) continue;
      const [r, t, bx0, bx1, by0, by1] = B[j];
      if (bx0 > ax1 || bx1 < ax0 || by0 > ay1 || by1 < ay0) continue;
      if (o(p, q, r) * o(p, q, t) < 0 && o(r, t, p) * o(r, t, q) < 0) return true;
    }
  }
  return false;
}
export function checkCollisions(plan) {
  const names = ["the outer edge", "the pocket", "the left cord hole", "the right cord hole"];
  const tips = {
    "0-1": "the pocket reaches the outer edge: deepen the edge bar, or reduce the bow or the steps",
    "1-2": "the pocket runs into a cord hole: make the side bars wider, the front radius or the cord smaller",
    "1-3": "the pocket runs into a cord hole: make the side bars wider, the front radius or the cord smaller",
    "0-2": "a cord hole runs out of the side bar (a larger front radius pushes it outwards): make the side bars wider, the hole shorter or the front radius smaller",
    "0-3": "a cord hole runs out of the side bar (a larger front radius pushes it outwards): make the side bars wider, the hole shorter or the front radius smaller",
  };
  const checks = [[plan.below, 0, [0, 2, 3]], [plan.above, 0, [0, 1, 2, 3]], [plan.above, plan.above.length - 1, [0, 1, 2, 3]]];
  for (const [levels, k, map] of checks) {
    const rings = ringsAt(levels, k);
    for (let i = 0; i < rings.length; i++) {
      if (crossings(rings[i], null, true)) throw new Error(`${names[map[i]]} crosses itself: corner or step radii too large for the shape. Make the radii smaller.`);
      for (let j = i + 1; j < rings.length; j++) {
        if (crossings(rings[i], rings[j], false)) {
          const key = [map[i], map[j]].sort().join("-");
          throw new Error(tips[key] ?? `${names[map[i]]} and ${names[map[j]]} overlap`);
        }
      }
    }
  }
}

export function buildFrame(p) {
  const plan = framePlan(p);
  checkCollisions(plan);
  const body = pocketBody(plan.below, plan.above, 1);
  let modifier = null;
  if (p.denseZones) {
    // Denser infill in the edge bar (and the bottom bar), through the full thickness.
    const x0 = -plan.sb - 1, x1 = plan.Ww + plan.sb + 1;
    modifier = mergeMeshes([
      box(x0, Math.min(...plan.segs.map(plan.yTop)) - 1, -1, x1, plan.yOuterTop + 1, plan.T + 1),
      box(x0, plan.yOuterBot - 1, -1, x1, Math.max(...plan.botSegs.map(plan.yBot)) + 1, plan.T + 1),
    ]);
  }
  return { plan, body, modifier };
}

// The edge bar carries the fingers between the two cord holes: a beam, simply supported at the
// holes (the frame corners make it stiffer, so this errs on the safe side), loaded over the hand
// width. Bending in the plate's plane. Section: the edge bar at full plate thickness; the floor
// under the pocket adds stiffness and is left out (safe side).
export function strength(p, plan) {
  const F = p.loadKg * 9.81;
  const L = plan.slotX[1] - plan.slotX[0];
  const handW = plan.layout.segments.filter((s) => s.finger).reduce((a, s) => a + s.x1 - s.x0, 0);
  const M = (F * (2 * L - handW)) / 8;
  const B = p.barThick + Math.min(0, p.bow ?? 0); // an inward bow thins the bar where the moment is largest
  const bend = (6 * M) / (plan.T * B * B); // rectangle: plate thickness × bar depth
  // Each side bar carries half the load past its hole: the bar width minus the hole's width.
  const net = p.sideBar - 2 * plan.holeHalf;
  const tension = F / 2 / (net * plan.T);
  const sections = [
    { name: "Edge bar (bending between the cords)", stress: bend },
    { name: "Side bars beside the holes (tension)", stress: tension },
  ];
  for (const s of sections) s.safety = p.strengthMPa / s.stress;
  const worst = sections.reduce((a, b) => (a.safety < b.safety ? a : b));
  return { F, sections, worst, span: L };
}
