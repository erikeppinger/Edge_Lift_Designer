// Parameters → everything the page and the exporters need. No DOM.

import { buildFrame, strength } from "./frame.js";
import { meshStats, translate } from "./mesh.js";
import { roundedRing, segmentPlan, pointInPolygon } from "./geom2d.js";

export function buildModel(p) {
  const f = buildFrame(p);
  const { plan } = f;
  // Centre the part on the origin in XY so the slicer's bed position is easy to set.
  const cx = (plan.Ww) / 2, cy = (plan.yMax + plan.yMin) / 2;
  const body = translate(f.body, -cx, -cy, 0);
  const modifier = f.modifier ? translate(f.modifier, -cx, -cy, 0) : null;
  const stats = meshStats(body);
  return {
    plan,
    offset: { x: -cx, y: -cy }, // body = plan coordinates + offset (centred for the slicer)
    body,
    modifier,
    size: plan.size,
    stats,
    strength: strength(p, plan),
    filament: filamentEstimate(body, stats.volume, p, p.denseZones ? zoneShare(plan) : 0),
    warnings: plan.warnings,
  };
}

// Share of the part's volume inside the denser-infill zones (the edge bars, full thickness), from
// a 2 mm grid over the plate: full height outside the pocket, floor height inside it.
export function zoneShare(plan) {
  const ring = (l) => (l.ringAt ? l.ringAt(0) : roundedRing(l, 0, segmentPlan(l, 0)));
  const [outer, pocket, ...slots] = plan.loops.map(ring);
  const yTopMin = Math.min(...plan.segs.map(plan.yTop)), yBotMax = Math.max(...plan.botSegs.map(plan.yBot));
  let all = 0, zone = 0;
  for (let x = -plan.sb + 1; x <= plan.Ww + plan.sb; x += 2) for (let y = plan.yMin + 1; y <= plan.yMax; y += 2) {
    const q = { x, y };
    if (!pointInPolygon(q, outer) || slots.some((s) => pointInPolygon(q, s))) continue;
    const h = pointInPolygon(q, pocket) ? plan.F : plan.T;
    all += h;
    if (y > yTopMin - 1 || y < yBotMax + 1) zone += h; // same boxes as the modifier: both bars
  }
  return all ? zone / all : 0;
}

// Rough filament use with the print settings: walls along the side faces, top/bottom layers under
// the flat faces, infill in the rest (denser in the zones). PLA 1.24 g/cm³, 1.75 mm filament.
// Checked against PrusaSlicer (tools/slice-check.mjs): within a few grams for a 0.4 mm nozzle.
export function filamentEstimate(mesh, volume, p, share = 0) {
  const { positions: P, indices: I } = mesh;
  let side = 0, flat = 0;
  for (let k = 0; k < I.length; k += 3) {
    const a = 3 * I[k], b = 3 * I[k + 1], c = 3 * I[k + 2];
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const area = Math.hypot(nx, ny, nz) / 2;
    if (Math.abs(nz) / (2 * area || 1) > 0.7) flat += area; else side += area;
  }
  const line = (p.nozzle ?? 0.4) * 1.125;
  const shell = Math.min(volume, side * p.walls * line + flat * p.topBottomLayers * p.layerHeight);
  const fill = (1 - share) * p.infill + share * (p.zoneInfill ?? p.infill);
  const printed = shell + (volume - shell) * (fill / 100);
  return { grams: (printed / 1000) * 1.24, metres: printed / (Math.PI * 0.875 ** 2) / 1000, printedMm3: printed };
}

export const printSettings = (p) => ({
  layerHeight: p.layerHeight,
  walls: p.walls,
  infill: p.infill,
  infillPattern: p.infillPattern,
  topBottomLayers: p.topBottomLayers,
  zoneInfill: p.zoneInfill,
  zonePattern: p.zonePattern,
});
