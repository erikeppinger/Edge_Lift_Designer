// Mono / duo finger pocket: a flat teardrop block with a pocket for one, two or three fingers and a
// cord hole at its narrow end (like the wooden mono-pocket blocks). No DOM.
//
// Plane of the block (print XY), y up as it hangs from the cord:
//
//          ╭─╮
//         │ ○ │      ← cord hole (the cord pulls up on the crown above it)
//        ╱     ╲     ← neck
//       │ ┌───┐ │
//       │ │   │ │    ← pocket: the fingers go in from the top face and pull down on the bar
//       │ └───┘ │
//       ╰───────╯    ← bar
//
// z is the block thickness (print height). "through": the pocket goes right through, the block's
// thickness is how much of the finger lies on the bar. "blind": the pocket stops at a floor at the
// bed, like a hangboard pocket, its depth is how far the finger goes in. The pocket's rim is round
// on the top face; on the bed face it is a printable fillet (round, then 45°). Prints flat, without
// supports.

import { loft, weld, mergeMeshes, meshStats, dropFlat, translate } from "./mesh.js";
import { filamentEstimate } from "./model.js";
import { HAND_DEFAULTS, key as handKey } from "./hand.js";
import { roundedRing, segmentPlan, pointInPolygon } from "./geom2d.js";
import { applyLabel, cleanLabelText } from "./label.js";

export const POCKET_DEFAULTS = {
  fingerSet: "middle+ring", // which fingers the pocket is for (the width follows it)
  hand: "right",
  pocketWidth: 41.5, // inside width across the fingers
  fitClear: 1.5, // room each side when the width is fitted to measured fingers
  pocketHeight: 22, // inside height along the pull: room for the finger's thickness
  pocketCorner: 8, // corner radius of the pocket
  style: "blind", // blind (floor at the bed) or through
  depth: 18, // blind: pocket depth; through: block thickness
  floorThick: 3,
  floorRound: 4, // blind: the pocket's bottom rounds into the floor (a bowl)
  rimRadius: 5, // the rim the fingers bend over
  barDepth: 14, // the bar the fingers pull on
  sideWall: 10,
  neck: 9, // between the pocket and the cord hole (the rims of both take some of it at the faces)
  cordDia: 6,
  cordWall: 8, // material around the cord hole (the crown above it carries the load)
  outerRadius: 10, // the block's lower corners
  edgeRound: 2, // the block's outer edges and the cord hole's rims
  // label on the outer wall of the bar under the fingers
  labelMode: "raised", // raised, engraved or off
  labelAuto: true, // the fingers and the depth, e.g. "MR 18"
  labelText: "",
  labelSize: 7,
  labelDepth: 0.6,
  // printing
  nozzle: 0.4,
  layerHeight: 0.2,
  chamferLayers: 3,
  walls: 6,
  infill: 40,
  infillPattern: "gyroid",
  topBottomLayers: 5,
  zoneInfill: 60,
  zonePattern: "gyroid",
  bambuPrinter: "Bambu Lab P1S",
  // strength
  loadKg: 40,
  strengthMPa: 35,
};

export const FINGER_SETS = [
  ["index", "mono: index"], ["middle", "mono: middle"], ["ring", "mono: ring"], ["little", "mono: little"],
  ["index+middle", "duo: index + middle"], ["middle+ring", "duo: middle + ring"], ["ring+little", "duo: ring + little"],
  ["index+middle+ring", "three: index + middle + ring"], ["middle+ring+little", "three: middle + ring + little"],
];

// Pocket width for the fingers of `set`, from the hand data (finger widths at the end joint, as the
// edge designer stores them): the widths side by side plus the room each side.
export function fitWidth(hand, set, side, clear) {
  const h = { ...HAND_DEFAULTS, ...hand };
  return Math.round((set.split("+").reduce((s, f) => s + h[handKey("w", f, side)], 0) + 2 * clear) * 2) / 2;
}

// Round profile of a rim at the top face (z = T): how far the wall stands back at height z.
const roundTop = (R, T) => (z) => (R > 0 && z > T - R ? R - Math.sqrt(Math.max(0, R * R - (z - (T - R)) ** 2)) : 0);
// Printable fillet at the bottom (z = z0): round from the wall down to 45°, then straight at 45°.
export function printableFillet(R, z0 = 0) {
  if (!(R > 0)) return () => 0;
  const zt = z0 + R * (1 - Math.SQRT1_2); // where the arc reaches 45°
  const ot = R * (1 - Math.SQRT1_2);
  return (z) => {
    if (z >= z0 + R) return 0;
    if (z >= zt) return R - Math.sqrt(Math.max(0, R * R - (z0 + R - z) ** 2));
    return ot + (zt - z);
  };
}
// z stations for the profiles: the ends of each rounded zone, finely in between.
function stations(ranges, z0, z1, step = 0.25) {
  const zs = new Set([z0, z1]);
  for (const [a, b] of ranges) {
    const lo = Math.max(z0, a), hi = Math.min(z1, b);
    if (hi <= lo) continue;
    const n = Math.max(1, Math.ceil((hi - lo) / step));
    for (let i = 0; i <= n; i++) zs.add(lo + ((hi - lo) * i) / n);
  }
  return [...zs].sort((a, b) => a - b).filter((z, i, all) => i === 0 || z - all[i - 1] > 1e-6);
}

// Convex hull (counter-clockwise) of points, Andrew's monotone chain.
function hull(pts) {
  const p = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cr = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 1e-9) lo.pop(); lo.push(q); }
  for (const q of p.slice().reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 1e-9) up.pop(); up.push(q); }
  // drop points that lie almost on the line through their neighbours (where two arcs meet): the
  // triangulation stalls on such near-collinear runs
  const h = lo.slice(0, -1).concat(up.slice(0, -1));
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 0; i < h.length && h.length > 3; i++) {
      const a = h[(i - 1 + h.length) % h.length], b = h[i], c = h[(i + 1) % h.length];
      const L = Math.hypot(c.x - a.x, c.y - a.y);
      if (!b.keep && Math.abs(cr(a, b, c)) / L < 0.004) { h.splice(i, 1); changed = true; i--; }
    }
  }
  return h;
}
// (the lowest point exactly, and kept: the straight bottom edge, where the label goes, ends there)
const circlePts = (cx, cy, r, n = 240) => Array.from({ length: n }, (_, i) => (i === (3 * n) / 4
  ? { x: cx, y: cy - r, keep: true }
  : { x: cx + r * Math.cos((2 * Math.PI * i) / n), y: cy + r * Math.sin((2 * Math.PI * i) / n) }));
// Rounded rectangle as a loop of corners (counter-clockwise), centred on (cx, cy).
const roundRect = (cx, cy, w, h, r) => [
  { x: cx - w / 2, y: cy - h / 2, r }, { x: cx + w / 2, y: cy - h / 2, r },
  { x: cx + w / 2, y: cy + h / 2, r }, { x: cx - w / 2, y: cy + h / 2, r },
];
const rev = (l) => l.slice().reverse();

export function pocketPlan(p) {
  const W = p.pocketWidth, H = p.pocketHeight;
  const blind = p.style === "blind";
  const F = blind ? p.floorThick : 0;
  const T = p.depth + F;
  const rc = p.cordDia / 2 + 0.75; // cord hole radius: 1.5 mm play
  const rp = Math.min(Math.max(p.pocketCorner, 0.5), W / 2, H / 2); // pocket corner (a sharp one would push its rim out diagonally)
  const yc = H / 2 + p.neck + rc; // cord hole centre
  const yb = -H / 2 - p.barDepth; // bottom of the block
  const xs = W / 2 + p.sideWall; // block side
  const chamfer = p.chamferLayers * p.layerHeight;
  const warnings = [];
  // The outer edge rounding moves the outline inwards; every curve of the outline must stay wider
  // than that, or the moved outline crosses itself.
  const edgeWanted = Math.max(chamfer, Math.min(p.edgeRound, T / 3, p.cordWall / 2));
  const Rb = Math.min(Math.max(p.outerRadius, edgeWanted + 1), xs, H / 2 + p.barDepth);
  if (Rb > p.outerRadius + 1e-9) warnings.push(`Lower corners rounded with ${Rb.toFixed(1)} mm: they must stay wider than the edge rounding.`);
  const edge = Math.max(0, Math.min(edgeWanted, Rb - 0.5, rp + p.sideWall - 0.5, rc + p.cordWall - 0.5));
  const outer = hull([
    ...circlePts(-(xs - Rb), yb + Rb, Rb).map((q) => (q.keep ? { ...q, y: yb } : q)), ...circlePts(xs - Rb, yb + Rb, Rb).map((q) => (q.keep ? { ...q, y: yb } : q)),
    ...circlePts(-(W / 2 - rp), H / 2 - rp, rp + p.sideWall), ...circlePts(W / 2 - rp, H / 2 - rp, rp + p.sideWall),
    ...circlePts(0, yc, rc + p.cordWall),
  ].map((q) => (q.keep && q.y !== yb ? { x: q.x, y: q.y } : q))).map((q) => ({ x: q.x, y: q.y, r: 0 }));
  const pocket = rev(roundRect(0, 0, W, H, rp));
  const cord = rev(roundRect(0, yc, 2 * rc, 2 * rc, rc));
  const fail = (msg) => { throw new Error(msg); };
  // limits: the rounded rims must leave a wall and must not meet each other
  const rim = Math.min(p.rimRadius, p.depth / (blind ? 1.5 : 2.5));
  if (rim < p.rimRadius - 1e-9) warnings.push(`Pocket rim rounded with ${rim.toFixed(1)} mm instead of ${p.rimRadius} mm: the pocket is too shallow for more.`);
  const cordRim = Math.max(chamfer, Math.min(1.5, T / 4, p.cordWall / 3));
  const floorR = blind ? Math.min(p.floorRound, H / 2 - 1, W / 2 - 1, p.depth - rim - 1) : 0;
  if (blind && floorR < p.floorRound - 1e-9) warnings.push(`Pocket bottom rounded with ${Math.max(0, floorR).toFixed(1)} mm: there is no room for ${p.floorRound} mm.`);
  const need = (what, have, min, why) => { if (have < min - 1e-9) fail(`${what} (${have} mm) ${why}: at least ${min.toFixed(1)} mm`); };
  need("the side walls", p.sideWall, rim + edge + 1.2, `are too thin for the ${rim.toFixed(1)} mm rim and the ${edge.toFixed(1)} mm edge rounding`);
  need("the bar", p.barDepth, rim + edge + 3, `is too thin for the ${rim.toFixed(1)} mm rim and the ${edge.toFixed(1)} mm edge rounding`);
  need("the neck between pocket and cord hole", p.neck, rim + cordRim + 1.2, `is too short for the ${rim.toFixed(1)} mm rim`);
  need("the material around the cord hole", p.cordWall, cordRim + edge + 1.2, "is too thin for its rounded rims");
  if (H < 2 * rim + 4 || W < 2 * rim + 4) fail(`the pocket (${W} × ${H} mm) is too small for a ${rim.toFixed(1)} mm rim`);

  // wall offsets per loop and height: [outer, pocket, cord] (positive = into the material)
  const outerTop = roundTop(edge, T), outerBot = printableFillet(edge);
  const pocketTop = roundTop(rim, T), pocketBot = blind ? null : printableFillet(rim);
  const cordTop = roundTop(cordRim, T), cordBot = printableFillet(cordRim);
  const floorOff = (z) => (blind && floorR > 0 && z < F + floorR ? -(floorR - Math.sqrt(Math.max(0, floorR ** 2 - (F + floorR - z) ** 2))) : 0);
  const offs = (z) => [Math.max(outerTop(z), outerBot(z)), Math.max(pocketTop(z), pocketBot ? pocketBot(z) : 0) + floorOff(z), Math.max(cordTop(z), cordBot(z))];
  // The rims widen the holes towards the faces and the edge rounding narrows the outline: check the
  // wall that is left at both faces (the holes must stay inside the outline and apart).
  const MIN_WALL = 1.2;
  for (const [z, face] of [[T, "top face"], [0, "bed face"]]) {
    const o = offs(z);
    const [ro, rpk, rcd] = [outer, pocket, cord].map((l, i) => roundedRing(l, o[i], segmentPlan(l, 0, 0.05)));
    const walls = [[rpk, ro, "the pocket and the outside", true], [rcd, ro, "the cord hole and the outside", true]];
    if (!blind || z > 0) walls.push([rcd, rpk, "the pocket and the cord hole", false]);
    if (blind && z === 0) walls.shift();
    for (const [a, b, what, inside] of walls) {
      const w = ringGap(a, b, inside);
      if (w < MIN_WALL) fail(`at the ${face} only ${Math.max(0, w).toFixed(1)} mm are left between ${what} (the rim radius or edge rounding takes the rest): at least ${MIN_WALL} mm; make the rim smaller or the walls thicker`);
    }
  }
  return { W, H, T, F, blind, rc, rp, yc, yb, xs, Rb, outer, pocket, cord, rim, edge, cordRim, floorR, offs, warnings };
}

// Smallest distance from ring a to ring b; negative if a point of a lies on the wrong side (outside
// b when inside = true, inside b when false).
function ringGap(a, b, inside) {
  let best = Infinity;
  for (const q of a) {
    if (pointInPolygon(q, b) !== inside) return -1;
    for (let i = 0; i < b.length; i++) {
      const u = b[i], v = b[(i + 1) % b.length], dx = v.x - u.x, dy = v.y - u.y, L2 = dx * dx + dy * dy;
      const t = L2 ? Math.max(0, Math.min(1, ((q.x - u.x) * dx + (q.y - u.y) * dy) / L2)) : 0;
      best = Math.min(best, Math.hypot(q.x - u.x - t * dx, q.y - u.y - t * dy));
    }
  }
  return best;
}

export function buildPocket(p) {
  const pl = pocketPlan(p);
  const { T, F, blind, outer, pocket, cord, rim, edge, cordRim, floorR, offs } = pl;
  const segOff = Math.max(rim, edge, cordRim, floorR) + 1;
  const level = (z, loops, which) => ({ z, loops, off: which.map((i) => offs(z)[i]) });
  let body;
  if (!blind) {
    const zs = stations([[0, edge], [T - edge, T], [0, rim], [T - rim, T], [0, cordRim], [T - cordRim, T]], 0, T);
    body = loft(zs.map((z) => level(z, [outer, pocket, cord], [0, 1, 2])), { segOff });
  } else {
    const below = stations([[0, edge], [0, cordRim]], 0, F).map((z) => level(z, [outer, cord], [0, 2]));
    const above = stations([[F, F + floorR], [T - rim, T], [T - edge, T], [T - cordRim, T]], F, T).map((z) => level(z, [outer, pocket, cord], [0, 1, 2]));
    // the cord loop must sit in the same place in both lists: [outer, cord] below, [outer, pocket, cord] above
    body = weld(mergeMeshes([loft(below, { top: false, welded: false, segOff }), loft(above, { bottom: false, floorLoop: 1, welded: false, segOff })]));
  }
  // label on the outer wall of the bar, the flat stretch between the lower corners; read from
  // outside with the letters' tops towards the top face
  pl.labels = [];
  if (p.labelMode !== "off") {
    const text = pocketLabelText(p);
    if (text) {
      const half = pl.xs - pl.Rb, pen = Math.max(2.25 * (p.nozzle ?? 0.4), 0.15 * p.labelSize);
      const depth = (p.labelMode === "engraved" ? -1 : 1) * p.labelDepth;
      const r = half > 3 ? applyLabel(body, { text, path: [{ x: -half, y: pl.yb }, { x: half, y: pl.yb }], zRange: [edge, T - edge], size: p.labelSize, pen, depth, maxWidth: 2 * half - 2 }) : { error: "the bar's outer wall has no flat stretch (lower corners too round)" };
      if (r.error) pl.warnings.push(`Label left out: ${r.error}.`);
      else {
        body = r.mesh;
        pl.labels.push({ text, contains: r.contains });
        if (r.size < p.labelSize - 0.05) pl.warnings.push(`Label letters reduced to ${r.size.toFixed(1)} mm to fit the wall.`);
      }
    }
  }
  const dy = -(pl.yc + pl.yb) / 2;
  body = dropFlat(translate(body, 0, dy, 0));
  const stats = meshStats(body);
  let lo = Infinity, hi = -Infinity;
  for (let i = 1; i < body.positions.length; i += 3) { lo = Math.min(lo, body.positions[i]); hi = Math.max(hi, body.positions[i]); }
  const size = { x: 2 * pl.xs, y: hi - lo, z: T }; // (raised letters stick out of the bar)
  return { plan: pl, body, stats, size, offset: { x: 0, y: dy }, filament: filamentEstimate(body, stats.volume, p, 0), strength: pocketStrength(p, pl), warnings: pl.warnings };
}

// The label: the fingers' initials (index I, middle M, ring R, little L) and the depth, then the
// user's own text.
const INITIAL = { index: "I", middle: "M", ring: "R", little: "L" };
export function pocketLabelText(p) {
  const d = Number.isInteger(p.depth) ? String(p.depth) : p.depth.toFixed(1);
  const auto = p.labelAuto === false ? "" : `${p.fingerSet.split("+").map((x) => INITIAL[x]).join("")} ${d}`;
  return [auto, cleanLabelText(p.labelText)].filter(Boolean).join(" ");
}

// Simple beam estimates at the load. The fingers pull on the middle of the bar, which bends between
// the side walls; the side walls carry the load in tension; the cord pulls on the crown above the
// cord hole, which bends across the hole. Rims and fillets are left out (they take a little
// section away, the safety factor covers it).
export function pocketStrength(p, pl) {
  const P = p.loadKg * 9.81, T = pl.T;
  const bend = (L, h) => (P * L / 4) / (T * h * h / 6);
  const sections = [
    { name: "bar under the fingers", stress: bend(pl.W + p.sideWall, p.barDepth) },
    { name: "side walls (tension)", stress: P / (2 * p.sideWall * T) },
    { name: "crown above the cord hole", stress: bend(2 * pl.rc + p.cordWall, p.cordWall) },
  ].map((s) => ({ ...s, safety: p.strengthMPa / s.stress }));
  return { sections, worst: sections.reduce((a, b) => (b.safety < a.safety ? b : a)) };
}
