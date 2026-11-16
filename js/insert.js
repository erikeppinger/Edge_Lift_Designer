// The insert: a table that stands on the pocket floor and makes the edge shallower by its height
// (a 30 mm plate with a 10 mm insert is a 20 mm edge). Its outline is the pocket's, a clearance
// smaller. It is hollow: a plate (the new floor for the fingertips) with a wall around its rim,
// printed plate down, walls up, and put into the pocket upside down. No DOM.
//
// Hold: loose (the snug fit), click (bumps on the end walls snap into grooves in the pocket's end
// walls) or magnets (two bosses with holes for 6 × 2 mm magnets, over the holes in the plate floor).

import { loft, cap, weld, mergeMeshes } from "./mesh.js";
import { textField, contourLoops, groupLoops } from "./label.js";
import { pointInPolygon } from "./geom2d.js";

const PLATE = 2; // thickness of the table's plate
const VENT = 1.5; // radius of the two vent holes in the plate, in the pocket's lower corners (away from
//                  the fingertips): they let the air out when the insert goes in, and a hooked wire
//                  or the short leg of an allen key through one pulls the insert out again

// How high an insert may be: it has to stay below the round of the pocket's rim.
export const insertMaxHeight = (p) => Math.max(0, p.edgeDepth - Math.min(p.edgeRadius, p.edgeDepth - p.floorFillet - 0.1) - 1);

// Returns { mesh, height, hold, warnings } in plan coordinates as printed (plate on the bed,
// already mirrored: turned over, it matches the pocket), or null without an insert.
export function buildInsert(p, plan) {
  const h = p.insertHeight ?? 0;
  if (!(h > 0)) return null;
  const warnings = [];
  const max = insertMaxHeight(p);
  if (h > max + 1e-9) return { mesh: null, height: h, hold: "none", warnings: [`Insert left out: at ${h} mm it would reach into the rounded rim of the pocket. With this edge depth and front radius it can be up to ${Math.floor(max * 2) / 2} mm high.`] };
  const clear = p.insertClear ?? 0.2, wall = plan.insertWall;
  const c = Math.min(plan.c, PLATE / 2, h / 3); // bed chamfer (elephant foot); the new floor's rim once turned over
  const foot = Math.max(0, Math.min(p.floorFillet + 0.3, h - c - 0.4)); // 45° at the feet: clears the pocket's floor fillet
  const hollow = h >= PLATE + 1.5;
  const inset = (z) => Math.max(z < c ? c - z : 0, z > h - foot ? z - (h - foot) : 0);

  // click bumps: where the grooves are, a little shorter along the wall, 0.3 mm into the groove
  let hold = p.insertHold ?? "loose";
  const BUMP = clear + 0.3, ck = plan.click;
  if (hold === "click" && (!ck || !hollow || h < PLATE + ck.z + BUMP)) {
    warnings.push(ck ? `Click hold left out on the insert: it needs to be at least ${Math.ceil((PLATE + ck.z + BUMP) * 2) / 2} mm high to reach the grooves.` : "Click hold left out on the insert (the plate has no grooves, see above).");
    hold = "loose";
  }
  const bump = hold === "click" ? (z) => Math.max(0, BUMP - Math.abs(h - z - ck.z)) : () => 0;
  const outerAt = (z) => plan.pocketRing(-(clear + inset(z)), hold === "click" ? ck.wInsert : null, bump(z)).reverse(); // counter-clockwise
  const outer = []; outer.ringAt = (off, z) => outerAt(z);
  const zs = (z0, z1, extra = []) => [...new Set([z0, z1, c, h - foot, ...extra].filter((z) => z >= z0 - 1e-9 && z <= z1 + 1e-9).map((z) => +z.toFixed(6)))].sort((a, b) => a - b);
  const levels = (z0, z1, loops, extra) => zs(z0, z1, extra).map((z) => ({ z, loops, off: loops.map(() => 0) }));

  // vent holes through the plate, in the two lower corners, inside the wall (each left out if
  // there is no room for it there, or a magnet boss is in the way)
  const cavOutline = plan.pocketRing(-(clear + wall));
  const near = (q, ring) => { let best = Infinity; ring.forEach((a, i) => { const b = ring[(i + 1) % ring.length], dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / (dx * dx + dy * dy || 1))); best = Math.min(best, Math.hypot(q.x - a.x - t * dx, q.y - a.y - t * dy)); }); return best; };
  const mgSpots = (p.insertHold === "magnet" && plan.magnets && h >= PLATE + plan.magnets.depth + 0.6) ? plan.magnets.spots : [];
  const reach = clear + wall + VENT + 1 + 0.3 * p.windowRadius;
  const ventAt = plan.pocketCorners.map(([x, y], i) => ({ x: x + (i ? -reach : reach), y: y + reach }))
    .filter((q) => pointInPolygon(q, cavOutline) && near(q, cavOutline) > VENT + 0.6 && mgSpots.every((m) => Math.hypot(m.x - q.x, m.y - q.y) > plan.magnets.boss + VENT + 0.8));
  const vent = ventAt.map((q) => plan.circle(q, VENT, false));
  // The insert's height, engraved two layers deep into the face that shows while the insert is in
  // the pocket (the print's first layer), so you see which one is in without taking it out. It
  // sits at the bottom border, away from the fingertips; on a two-hand plate, where both borders
  // are edges, in the middle between them. Laid out in plan coordinates: it reads the right way
  // round looking into the pocket.
  const ENG = Math.min(0.8, Math.max(2 * (p.layerHeight ?? 0.2), 0.4)); // two layers: one is only a gap in the first layer and hardly shows
  const text = `${Number.isInteger(h) ? h : h.toFixed(1)} MM`;
  let pen = Math.max(3 * (p.nozzle ?? 0.4), 1.2); // wide strokes: the first layer's squish narrows them
  const letters = [];
  const roomY = plan.Hw - 2 * (clear + wall) - 3, roomX = plan.Ww - 2 * (reach + VENT + 2);
  // letters at least 5.5 strokes high (thicker strokes run into each other): bigger letters for a
  // big nozzle, thinner strokes where there is no room for those
  let size = Math.min(Math.max(6, 5.5 * pen), roomY - pen);
  pen = Math.min(pen, size / 5.5);
  let field = size >= 3 ? textField(text, size, pen) : null;
  if (field && field.width > roomX) { size *= roomX / field.width; pen = Math.min(pen, size / 5.5); field = size >= 3 ? textField(text, size, pen) : null; }
  if (field) {
    const rot = 2e-3, cs = Math.cos(rot), sn = Math.sin(rot); // (turned a hair: outline points traced on a grid would line up exactly)
    const yc = plan.two ? plan.Hw / 2 : clear + wall + 1.5 + size / 2 + pen / 2;
    const place = ([x, y]) => { const u = x - field.width / 2 + pen / 2, v = y - size / 2; return { x: plan.Ww / 2 + u * cs - v * sn, y: yc + u * sn + v * cs, r: 0 }; };
    const ringOf = (loop, flip) => { const r = loop.map(place); if (flip) r.reverse(); r.ringAt = () => r; return r; };
    const fits = (r) => r.every((q) => pointInPolygon(q, cavOutline) && ventAt.every((vh) => Math.hypot(vh.x - q.x, vh.y - q.y) > VENT + 1));
    for (const g of groupLoops(contourLoops(field, 0))) {
      // as recesses in the bed face: the letter's outline is a hole there (clockwise), its counters islands
      const hole = ringOf(g.outer, true), islands = g.holes.map((hl) => ringOf(hl, true));
      if (fits(hole)) letters.push({ hole, islands });
    }
  }
  // the bed face with the letters cut in: the face around them, each letter's walls and its
  // ceiling two layers up, and the counters left standing
  const bedFace = () => [
    cap([outerAt(0), ...vent, ...letters.map((g) => g.hole)], 0, false),
    ...letters.flatMap((g) => [
      loft([0, ENG].map((z) => ({ z, loops: [g.hole, ...g.islands], off: [g.hole, ...g.islands].map(() => 0) })), { bottom: false, top: false, welded: false }),
      cap([g.hole.slice().reverse(), ...g.islands.map((r) => r.slice().reverse())], ENG, false),
      ...g.islands.map((r) => cap([r], 0, false)),
    ]),
  ];
  let mesh;
  try {
  if (!hollow) {
    mesh = weld(mergeMeshes([loft(levels(0, h, [outer, ...vent]), { bottom: false, welded: false }), ...bedFace()]));
  } else {
    const cavRing = plan.pocketRing(-(clear + wall)); // clockwise: a hole
    const cavity = []; cavity.ringAt = () => cavRing;
    const clickZ = hold === "click" ? [h - ck.z - BUMP, h - ck.z, h - ck.z + BUMP] : [];
    // magnets: bosses in the cavity, from the plate to the feet, with the magnet holes at the feet
    let mg = hold === "magnet" ? plan.magnets : null;
    if (hold === "magnet" && (!mg || h < PLATE + mg.depth + 0.6)) {
      warnings.push(mg ? `Magnet hold left out on the insert: it needs to be at least ${Math.ceil((PLATE + mg.depth + 0.6) * 2) / 2} mm high for the magnets.` : "Magnet hold left out on the insert (the plate has no magnet holes, see above).");
      mg = null; hold = "loose";
    }
    const bosses = mg ? mg.spots.map((q) => plan.circle(q, mg.boss, true)) : [];
    const holes = mg ? mg.spots.map((q) => plan.circle({ x: q.x, y: q.y + 1e-3 }, mg.r, false)) : []; // (nudged: no points level with the boss's)
    const parts = [
      loft(levels(0, PLATE, [outer, ...vent]), { bottom: false, top: false, welded: false }),
      ...bedFace(),
      loft(levels(PLATE, h, [outer, cavity, ...bosses], clickZ), { bottom: false, top: false, welded: false }),
      cap([cavRing.slice().reverse(), ...bosses.map((b) => b.slice().reverse()), ...vent], PLATE, true), // the tray's floor, around bosses and vents
      cap([outerAt(h), cavRing], h, true), // the feet
    ];
    if (mg) {
      const zm = h - mg.depth;
      parts.push(loft(levels(zm, h, holes), { bottom: false, top: false, welded: false }));
      holes.forEach((hl, i) => parts.push(cap([hl.slice().reverse()], zm, true), cap([bosses[i], hl], h, true)));
    }
    mesh = weld(mergeMeshes(parts));
  }
  } catch (e) {
    if (!/Triangulation|bridge/.test(e.message)) throw e;
    // the pocket is too narrow or too tightly stepped for the insert's wall: its outline pinches
    return { mesh: null, height: h, hold: "none", warnings: ["Insert left out: its walls do not fit into this pocket (too narrow, or stepped too tightly). A smaller floor fillet, clearance or finger scoop, or a higher pocket, makes room."] };
  }
  // mirror in x: turned over to go into the pocket, the outline then matches it
  const P = Float64Array.from(mesh.positions), I = Uint32Array.from(mesh.indices);
  for (let i = 0; i < P.length; i += 3) P[i] = plan.Ww - P[i];
  for (let k = 0; k < I.length; k += 3) { const t = I[k + 1]; I[k + 1] = I[k + 2]; I[k + 2] = t; }
  return { mesh: { positions: P, indices: I }, height: h, hold, warnings };
}
