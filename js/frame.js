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
import { applyLabel, labelText } from "./label.js";

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
  holeX: 0, // shifts both holes from the middle of the side bar: + outwards, − towards the pocket
  holeY: 0, // shifts both holes along the side bar: + towards the top edge, − towards the bottom
  cordExit: 0, // rounded cord exit: extra edge rounding at the hole's load end(s), 0 = off
  // label on the outer wall of each edge bar, read while lifting on that edge
  labelMode: "raised", // raised, engraved or off
  labelAuto: true, // that edge's hand and the edge depth, e.g. "R 20"
  labelText: "", // own text after it (A–Z, 0–9, - + . /)
  labelSize: 8, // letter height, mm (smaller if the wall is too low)
  labelDepth: 0.6, // how far the letters stand out or are cut in, mm
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

// Offsets of the pocket outline for the rim round and the floor fillet. Every point of the outline
// moves along its own normal by d, so a point on a step wall stays on that wall at every height
// and the rings line up vertex for vertex (the loft joins point i of one ring to point i of the
// next). Where a rounding is larger than the corner it runs over (a 4 mm rim on a 3 mm step) the
// moved outline loops back over itself; that loop is cut off at the crossing, which is the crease
// where the round meets itself. maxOffset: the largest |d| that will be asked for.
export function pocketOffsetter(win, Ww, maxOffset = 0) {
  // corners get at least a tiny radius, so every point has a normal; arcs are sampled for the
  // radius they get at the largest offset
  const base = win.map((q) => ({ ...q, r: Math.max(q.r, 0.05) }));
  let pts = roundedRing(base, 0, segmentPlan(base, Math.max(0, maxOffset), 0.01));
  pts = pts.filter((q, i) => { const p = pts[(i - 1 + pts.length) % pts.length]; return Math.hypot(q.x - p.x, q.y - p.y) > 1e-9; });
  // start in the middle of the longest straight piece (never part of a loop, so no loop wraps
  // around the start)
  let best = 0, bestL = -1;
  pts.forEach((q, i) => { const r = pts[(i + 1) % pts.length], L = Math.hypot(r.x - q.x, r.y - q.y); if (L > bestL) { bestL = L; best = i; } });
  const nb = pts[(best + 1) % pts.length];
  pts = [{ x: (pts[best].x + nb.x) / 2, y: (pts[best].y + nb.y) / 2 }, ...pts.slice(best + 1), ...pts.slice(0, best + 1)];
  const n = pts.length;
  // normals: the outline runs counter-clockwise around the pocket, outwards is to the right
  const nrm = pts.map((q, i) => {
    const p = pts[(i - 1 + n) % n], r = pts[(i + 1) % n];
    const d1 = Math.hypot(q.x - p.x, q.y - p.y), d2 = Math.hypot(r.x - q.x, r.y - q.y);
    const tx = (q.x - p.x) / d1 + (r.x - q.x) / d2, ty = (q.y - p.y) / d1 + (r.y - q.y) / d2, l = Math.hypot(tx, ty) || 1;
    return { x: ty / l, y: -tx / l };
  });
  const cross = (p1, p2, p3, p4) => {
    const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
    if (Math.abs(d) < 1e-14) return null;
    const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
    const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
    return t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9 ? { x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t } : null;
  };
  return (d) => {
    const q = pts.map((p, i) => ({ x: p.x + nrm[i].x * d, y: p.y + nrm[i].y * d }));
    if (Math.abs(d) > 1e-9) {
      // cut off loops: the first segment that a later one (within reach) crosses keeps the crossing,
      // the points in between collapse onto it
      const reach = Math.min(n - 3, 600);
      for (let i = 0; i < n - 2; i++) {
        const a = q[i], b = q[i + 1]; // segment j runs q[j] → q[j + 1], the last one back to q[0]
        const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
        let hit = -1, X = null;
        for (let j = i + 2; j <= Math.min(n - (i === 0 ? 2 : 1), i + reach); j++) {
          const c = q[j], e = q[(j + 1) % n];
          if (Math.max(c.x, e.x) < x0 || Math.min(c.x, e.x) > x1 || Math.max(c.y, e.y) < y0 || Math.min(c.y, e.y) > y1) continue;
          const Y = cross(a, b, c, e);
          if (Y) { hit = j; X = Y; }
        }
        if (hit >= 0) { for (let k = i + 1; k <= hit; k++) q[k] = { ...X }; i = hit - 1; }
      }
    }
    return q.reverse(); // the pocket is a hole in the plate: clockwise
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
// The tip roundings sit well inside the sharp construction points (in a narrow wedge a small
// radius moves far up), so the construction length is stretched until the rounded hole is as long
// as asked for (the slot is centred on cy, the teardrop's tip end at cy − length/2). The lens's
// side roundings eat into its width the same way: it is widened until the cord (+1 mm) passes.
function slot(p, cx, cy) {
  const L = p.slotLength, W = p.cordDia + 1, lens = slotShapeOf(p) === "lens";
  const span = (loop) => {
    const r = roundedRing(loop, 0, segmentPlan(loop, 0)), ys = r.map((q) => q.y), xs = r.map((q) => q.x);
    return { y0: Math.min(...ys), y1: Math.max(...ys), w: Math.max(...xs) - Math.min(...xs) };
  };
  let Ls = L, Ws = W, loop = slotOutline(p, cx, cy, Ls, Ws);
  for (let i = 0; i < 12; i++) {
    const s = span(loop), dl = L - (s.y1 - s.y0), dw = lens ? W - s.w : 0;
    if (Math.abs(dl) < 0.01 && Math.abs(dw) < 0.01) break;
    Ls = Math.max(W, Ls + dl);
    Ws += dw;
    loop = slotOutline(p, cx, cy, Ls, Ws);
  }
  const s = span(loop), dy = cy - (s.y0 + s.y1) / 2;
  return loop.map((q) => ({ ...q, y: q.y + dy }));
}

function slotOutline(p, cx, cy, L, sw) {
  const tipR = Math.max(0.5, p.cordDia * 0.3);
  const shape = slotShapeOf(p);
  if (shape === "teardrop") {
    const R = sw / 2 + 0.5;
    const toTip = Math.max(L - R, R / 0.95); // round end centre to the tip
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

// Rounded cord exit: the cord bends over the hole's edge at the load end, so that edge gets a
// larger rounding than the rest of the hole, fading out towards the other end. The wedge walls
// inside the hole stay straight and still grip the cord. Top face: a quarter round of radius e.
// Bed face: a 45° chamfer of the same size instead (a round there would overhang).
// The hole outline is sampled once (fine enough for the fade) and each level moves its points
// outwards by max(chamfer, weight · exit offset); the hole is convex, so the rings stay simple.
function exitRinger(hole, cy, L, twoSided, e, T) {
  const plan = segmentPlan(hole, e + 1);
  const raw = roundedRing(hole, 0, plan), base = [];
  raw.forEach((q, i) => {
    const prev = raw[(i - 1 + raw.length) % raw.length];
    const len = Math.hypot(q.x - prev.x, q.y - prev.y);
    if (len < 1e-9) return;
    const n = Math.ceil(len / 0.5);
    for (let k = 1; k <= n; k++) base.push({ x: prev.x + ((q.x - prev.x) * k) / n, y: prev.y + ((q.y - prev.y) * k) / n });
  });
  const cx = base.reduce((a, q) => a + q.x, 0) / base.length, cyc = base.reduce((a, q) => a + q.y, 0) / base.length;
  const dirs = base.map((q, i) => {
    const a = base[(i - 1 + base.length) % base.length], b = base[(i + 1) % base.length];
    let nx = b.y - a.y, ny = a.x - b.x;
    const l = Math.hypot(nx, ny) || 1;
    nx /= l; ny /= l;
    if (nx * (q.x - cx) + ny * (q.y - cyc) < 0) { nx = -nx; ny = -ny; } // away from the hole: into the material
    const s = (twoSided ? Math.abs(q.y - cy) : cy - q.y) / (L / 2);
    const t = Math.min(1, Math.max(0, (s - 0.2) / 0.7));
    return { nx, ny, w: t * t * (3 - 2 * t) };
  });
  const exit = (z) => {
    if (z < e) return e - z; // bed: 45°
    const u = T - z;
    return u < e ? e - Math.sqrt(Math.max(0, e * e - (e - u) ** 2)) : 0;
  };
  const ringAt = (off, z) => {
    const x = exit(z);
    return base.map((q, i) => { const k = Math.max(off, dirs[i].w * x); return { x: q.x + dirs[i].nx * k, y: q.y + dirs[i].ny * k }; });
  };
  ringAt.breaks = [0, e, ...Array.from({ length: 9 }, (_, i) => T - (e - e * Math.cos((Math.PI / 2) * (i / 8))))];
  return ringAt;
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
  // The outer wall of each edge bar as built (the same points the loft makes), between the corner
  // roundings, in reading order for someone looking down on that edge while lifting on it (letters'
  // tops towards the open side): the labels go there. The ring runs right → left along the top bar
  // and left → right along the bottom bar, which is the reading order on each.
  const barWalls = () => {
    const cPlan = segmentPlan(outer, p.chamferLayers * p.layerHeight);
    const ring = roundedRing(outer, 0, cPlan);
    const start = (i) => cPlan.slice(0, i).reduce((a, k) => a + k + 1, 0);
    const i1 = outer.findIndex((q, i) => i > 0 && q.r > 0), i2 = i1 + 1, i3 = outer.length - 1;
    const run = (from, to) => ring.slice(from, to + 1).filter((q, i, r) => i === 0 || Math.hypot(q.x - r[i - 1].x, q.y - r[i - 1].y) > 1e-9);
    return { top: run(start(i2) + cPlan[i2], start(i3)), bottom: run(start(0) + cPlan[0], start(i1)) };
  };
  const cy = Hw / 2 + (p.holeY ?? 0);
  // Cord holes: centred in the side bar material that is left between the outer edge and the
  // pocket rim (which the front radius widens at the top face), then shifted by holeX / holeY.
  // Both holes move alike: outwards is −x on the left, +x on the right.
  const c = p.chamferLayers * p.layerHeight; // 45° chamfers, both faces
  const rim = Math.max(0, p.edgeRadius);
  const dx = p.holeX ?? 0;
  const slotX = [-(sb + rim) / 2 - dx, Ww + (sb + rim) / 2 + dx];
  const slots = slotX.map((sx) => slot(p, sx, cy));
  const holeHalf = Math.max(...roundedRing(slots[0], 0, segmentPlan(slots[0], 0)).map((q) => Math.abs(q.x - slotX[0])));
  const sideWall = (sb - rim) / 2 - Math.abs(dx) - holeHalf - c; // material on the thinner side of the hole at the top face

  const outerP = chamferProfile(c, c, T);
  // Pocket wall: a quarter round at the top rim (the fingers wrap it) and a 45° fillet at the floor
  // (the pocket is smaller there, so the inset is negative).
  const r = Math.min(p.edgeRadius, d - p.floorFillet - 0.1);
  const arc = (u) => r - Math.sqrt(Math.max(0, r * r - (r - u) ** 2));
  const wallP = {
    off: (z) => (z < F + p.floorFillet ? -(F + p.floorFillet - z) : T - z < r ? arc(T - z) : 0),
    breaks: [F, F + p.floorFillet, ...Array.from({ length: 9 }, (_, i) => T - (r - r * Math.cos((Math.PI / 2) * (i / 8))))],
  };

  // rounded cord exit at the load end(s): teardrop one end, lens both, plain slot one end per hand
  const exitR = Math.min(p.cordExit ?? 0, T / 2 - 0.2);
  const holeLoops = slots.map(reversed);
  const exitBreaks = { breaks: [] };
  if (exitR > 0.05) {
    const shape = slotShapeOf(p), twoSided = shape === "lens" || (shape === "plain" && two);
    for (const h of holeLoops) h.ringAt = exitRinger(h, cy, p.slotLength, twoSided, exitR, T);
    exitBreaks.breaks = holeLoops[0].ringAt.breaks;
  }

  const zsOf = (z0, z1, profiles) => [...new Set([z0, z1, ...profiles.flatMap((q) => q.breaks)]
    .filter((z) => z >= z0 - 1e-9 && z <= z1 + 1e-9).map((z) => +z.toFixed(6)))].sort((x, y) => x - y);
  const solid = [outer, ...holeLoops];
  const winLoop = reversed(win);
  winLoop.ringAt = pocketOffsetter(win, Ww, Math.max(p.edgeRadius, p.floorFillet));
  const pocketed = [outer, winLoop, ...holeLoops];
  const below = zsOf(0, F, [outerP, exitBreaks]).map((z) => ({ z, loops: solid, off: [outerP.off(z), outerP.off(z), outerP.off(z)] }));
  const above = zsOf(F, T, [outerP, wallP, exitBreaks]).map((z) => ({ z, loops: pocketed, off: [outerP.off(z), wallP.off(z), outerP.off(z), outerP.off(z)] }));

  const warnings = [];
  if (filletClashes(win, 0).length) warnings.push("Pocket: corner or step radii too large for the steps.");
  if (p.edgeRadius + p.floorFillet > d) warnings.push("Edge radius and floor fillet together are deeper than the edge.");
  if (c >= F) warnings.push("Floor thinner than the bed chamfer.");
  if (p.bow < 0 && p.barThick + p.bow < 8) warnings.push("The inward bow leaves the edge bar under 8 mm deep in the middle.");
  if (cy + p.slotLength / 2 > yOuterTop - p.outerRadius || cy - p.slotLength / 2 < yOuterBot + p.outerRadius) warnings.push("Cord hole reaches into the rounded corner of the plate: make it shorter or move it back towards the middle.");
  if (exitR > 0.05 && exitR < (p.cordExit ?? 0) - 0.05) warnings.push(`Cord exit rounding limited to ${exitR.toFixed(1)} mm by the plate thickness.`);
  if (sideWall < 0) throw new Error(`the cord hole does not fit in the side bar (between the outer edge and the rounded pocket rim). ${dx ? "Move the holes back towards the middle of the side bar, make" : "Make"} the side bars wider (at least ${(2 * (holeHalf + c + Math.abs(dx)) + rim + 3).toFixed(1)} mm), the front radius or the cord smaller.`);
  if (sideWall < 3) warnings.push(`Side bar thin around the cord hole: ${sideWall.toFixed(1)} mm on its thinner side at the top face (the front radius widens the pocket there).`);
  const longest = Math.max(Ww + 2 * sb, yMax - yMin);
  if (longest > 250) warnings.push(`The plate is ${longest.toFixed(0)} mm long: more than most print beds (250–256 mm).`);
  else if (longest > 180) warnings.push(`The plate is ${longest.toFixed(0)} mm long: too big for small printers (Bambu A1 mini, Prusa MINI: 180 mm).`);
  if (Hw < 22) warnings.push("Pocket under 22 mm high: curled fingers may not fit.");

  return {
    layout, segs, botSegs, botLayout, topSide, botSide, two, Ww, Hw, sb, T, d, F, c, below, above, loops: pocketed,
    profiles: { outer: outerP, wall: wallP },
    yTop, yBot, yOuterTop, yOuterBot, winTopMax, warnings,
    sw: p.cordDia + 1, slotX, slotY: cy, holeHalf,
    yMax, yMin, barWalls, outer,
    size: { x: Ww + 2 * sb, y: yMax - yMin, z: T },
  };
}

// Collision check before building: outlines at the bed, at the pocket floor and at the top face
// must not cross each other or themselves. Throws a message that says what collides and what to
// change, instead of a failed triangulation.
function ringsAt(levels, k) {
  const lv = levels[k];
  return lv.loops.map((l, i) => l.ringAt ? l.ringAt(lv.off[i], lv.z)
    : roundedRing(l, lv.off[i], segmentPlan(l, Math.max(...levels.map((q) => (Array.isArray(q.off) ? q.off[i] : q.off))))));
}
function crossings(a, b, self) {
  const o = (p, q, r) => { const v = (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x); return Math.abs(v) < 1e-9 ? 0 : v; }; // touching ≠ crossing
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
    "0-2": "a cord hole runs out of the side bar: move it back towards the middle (hole position), make the side bars wider, the hole shorter or the front radius smaller",
    "0-3": "a cord hole runs out of the side bar: move it back towards the middle (hole position), make the side bars wider, the hole shorter or the front radius smaller",
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
  let body;
  try { body = pocketBody(plan.below, plan.above, 1); } catch (e) {
    if (!/Triangulation/.test(e.message)) throw e;
    // the outline touches itself somewhere the collision check cannot see (a pinch, not a crossing)
    throw new Error("the pocket crosses itself where its borders come close: make the pocket higher, the steps or the front radius smaller.");
  }
  // labels: one on the outer wall of each edge bar, for that edge's hand
  plan.labels = [];
  if (p.labelMode !== "off") {
    const walls = plan.barWalls();
    const edges = [{ hand: p.hand, path: walls.top }];
    if (plan.two) edges.push({ hand: otherHand(p.hand), path: walls.bottom });
    const depth = (p.labelMode === "engraved" ? -1 : 1) * p.labelDepth;
    const pen = Math.max(2.25 * (p.nozzle ?? 0.4), 0.15 * p.labelSize);
    const zRange = [plan.c, plan.T - plan.c];
    for (const e of edges) {
      const text = labelText(p, e.hand);
      if (!text) continue;
      const r = applyLabel(body, { text, path: e.path, zRange, size: p.labelSize, pen, depth });
      if (r.error) { plan.warnings.push(`Label left out: ${r.error}.`); continue; }
      body = r.mesh;
      plan.labels.push({ text, depth, box: r.box, size: r.size, contains: r.contains });
      if (r.size < p.labelSize - 0.05) plan.warnings.push(`Label letters reduced to ${r.size.toFixed(1)} mm to fit the wall.`);
    }
    // raised letters stick out: the size follows the mesh
    if (depth > 0 && plan.labels.length) {
      const P = body.positions;
      let lo = Infinity, hi = -Infinity, xl = Infinity, xh = -Infinity;
      for (let i = 0; i < P.length; i += 3) { lo = Math.min(lo, P[i + 1]); hi = Math.max(hi, P[i + 1]); xl = Math.min(xl, P[i]); xh = Math.max(xh, P[i]); }
      plan.yMin = Math.min(plan.yMin, lo); plan.yMax = Math.max(plan.yMax, hi);
      plan.size = { ...plan.size, x: xh - xl, y: plan.yMax - plan.yMin };
    }
  }
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
