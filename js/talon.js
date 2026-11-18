// Talon grip / ball: a round grip for the open-hand claw (fingertips spread over the dome, knuckles
// bent, finger joints straight-ish: the lumbricals' position). A solid of revolution, printed on its
// narrow foot; the cord runs up through the middle and a knot sits in the pocket at the top. No DOM.
//
// Section through the axis (r out, z up):
//
//            knot pocket
//        ╭───┐     ┌───╮   ← top face (flat ring)
//      ╱     │     │     ╲  ← shoulder: an arc of radius Rs
//     │      └─┐ ┌─┘      │ ← widest point, diameter D
//      ╲       │ │       ╱  ← side: a cone, narrowing to the foot by the taper angle
//       ╲______│ │______╱   ← foot on the bed; the cord leaves through the hole here
//
// The taper decides how hard it is: the steeper the cone under the widest point, the more the
// fingertips have to pinch and claw to keep it from slipping out. A ball is the same with a
// shoulder of radius D / 2. Every overhang stays at the taper angle (at most 45°), so no supports.

import { meshStats, dropFlat, cap, loft, weld, mergeMeshes } from "./mesh.js";
import { textField, contourLoops, groupLoops, cleanLabelText } from "./label.js";
import { signedArea } from "./geom2d.js";
import { filamentEstimate } from "./model.js";
import { printableFillet } from "./pocket.js";

export const TALON_SHAPES = {
  // Erik Eppinger's talon grip (drawing Talongrip_dwg1, 2025): ⌀100.8 × 79.9, R32.5 shoulder.
  talon: { diameter: 100.8, height: 79.9, taper: 10.9, shoulderR: 32.5, topDia: 57.9, knotDia: 33, knotDepth: 29.9, holeDia: 10 },
  ball: { diameter: 90, height: 75, taper: 40, shoulderR: 45, topDia: 40, knotDia: 26, knotDepth: 22, holeDia: 10 },
};

export const TALON_DEFAULTS = {
  shape: "talon",
  ...TALON_SHAPES.talon,
  exitRound: 3, // where the cord leaves the foot: rounded, so it does not chafe
  rimRound: 1.5, // knot pocket rim
  // label engraved into the foot (the bed face): you read it when you turn the grip over
  labelMode: "engraved", // engraved or off
  labelAuto: true, // diameter and taper, e.g. "101 T11"
  labelText: "",
  labelSize: 8,
  labelDepth: 0.6,
  // printing
  nozzle: 0.4,
  layerHeight: 0.2,
  chamferLayers: 3,
  walls: 4,
  infill: 15,
  infillPattern: "gyroid",
  topBottomLayers: 5,
  zoneInfill: 60,
  zonePattern: "gyroid",
  bambuPrinter: "Bambu Lab P1S",
  // strength
  loadKg: 60,
  strengthMPa: 35,
};

const rad = (d) => (d * Math.PI) / 180;

// The outline of the section as (r, z) points, counter-clockwise: foot from the hole outwards, up the
// side and the shoulder, in over the top face, down the knot pocket and the cord hole.
export function talonProfile(p) {
  const fail = (msg) => { throw new Error(msg); };
  const D = p.diameter, H = p.height, Rs = Math.min(p.shoulderR, D / 2), a = rad(p.taper);
  const rh = p.holeDia / 2, rk = p.knotDia > 0 ? p.knotDia / 2 : 0;
  const cr = D / 2 - Rs; // shoulder arc centre, distance from the axis
  const rt = p.topDia / 2;
  const tTop = rt > cr ? Math.acos(Math.min(1, (rt - cr) / Rs)) : Math.PI / 2; // arc end angle at the top face
  const rTop = cr + Rs * Math.cos(tTop); // where the top face starts
  const zc = H - Rs * Math.sin(tTop);
  const r1 = cr + Rs * Math.cos(a), z1 = zc - Rs * Math.sin(a); // side meets the shoulder (tangent)
  const rb = r1 - z1 * Math.tan(a); // foot radius
  const warnings = [];
  if (p.shoulderR > D / 2 + 1e-9) warnings.push(`Shoulder radius limited to ${(D / 2).toFixed(1)} mm (half the diameter).`);
  if (rt < cr - 1e-9) warnings.push(`The top face is ⌀${(2 * cr).toFixed(1)} mm, not ${p.topDia} mm: with this shoulder radius the dome ends there.`);
  if (z1 < 3) fail(`the shoulder reaches below the foot: make it taller (height ${H} mm) or the shoulder radius or the taper smaller`);
  if (rb < rh + 8) fail(`the foot is only ⌀${(2 * rb).toFixed(1)} mm: make the taper smaller or the grip taller`);
  if (rk && rk < rh + 2) fail(`the knot pocket (⌀${p.knotDia} mm) must be at least 4 mm wider than the cord hole`);
  const rIn = rk || rh; // what opens in the top face
  if (rIn + p.rimRound + 2 > rTop) fail(`the ${rk ? "knot pocket" : "cord hole"} (⌀${(2 * rIn).toFixed(1)} mm) does not fit in the top face (⌀${(2 * rTop).toFixed(1)} mm)`);
  if (rk && H - p.knotDepth < 8) fail(`the knot pocket (${p.knotDepth} mm deep) leaves ${Math.max(0, H - p.knotDepth).toFixed(1)} mm under it: at least 8 mm`);
  if (rb < 25) warnings.push(`The foot is only ⌀${(2 * rb).toFixed(0)} mm: use a brim so it stays on the bed.`);

  const ch = p.chamferLayers * p.layerHeight;
  const pts = [];
  const add = (r, z) => { const q = pts[pts.length - 1]; if (!q || Math.hypot(q[0] - r, q[1] - z) > 1e-6) pts.push([r, z]); };
  // foot, from the cord hole's rounded exit outwards, with the elephant-foot chamfer at the rim
  const ex = printableFillet(Math.min(p.exitRound, rb - rh - 6));
  const exitR = Math.min(p.exitRound, rb - rh - 6);
  add(rh + ex(0), 0);
  add(rb + ch * Math.tan(a) - ch, 0);
  add(rb + ch * Math.tan(a), ch);
  // side cone up to the shoulder, then the shoulder arc up to the top face
  add(r1, z1);
  const n = Math.max(8, Math.ceil((tTop + a) / rad(2)));
  for (let i = 1; i <= n; i++) { const t = -a + ((tTop + a) * i) / n; add(cr + Rs * Math.cos(t), zc + Rs * Math.sin(t)); }
  // top face in to the opening, rounded rim into it
  const rr = p.rimRound;
  add(rIn + rr, H);
  for (let i = 1; i <= 8; i++) { const t = (Math.PI / 2) * (1 - i / 8); add(rIn + rr - rr * Math.cos(t), H - rr + rr * Math.sin(t)); }
  if (rk) {
    // knot pocket wall and floor, small 45° chamfer into the cord hole
    const zf = H - p.knotDepth, c2 = Math.min(1, rk - rh - 1);
    add(rk, zf);
    add(rh + c2, zf);
    add(rh, zf - c2);
  }
  // down the cord hole, then the rounded exit at the foot (round, then 45°)
  const m = 12;
  for (let i = 0; i <= m; i++) { const z = exitR * (1 - i / m); add(rh + ex(z), z); }
  if (Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-6) pts.pop();
  return { pts, D, H, Rs, cr, zc, rTop, rb, r1, z1, rh, rk, warnings };
}

// Turns the section around the z axis. open: index of a section edge left out (the foot, which then
// gets its own face).
const ringPoint = (r, j, n) => { const f = (2 * Math.PI * j) / n; return { x: r * Math.cos(f), y: r * Math.sin(f) }; };
export function revolve(pts, n = 144, open = -1) {
  const pos = [], idx = [], m = pts.length;
  for (let j = 0; j < n; j++) {
    for (const [r, z] of pts) { const q = ringPoint(r, j, n); pos.push(q.x, q.y, z); }
  }
  for (let j = 0; j < n; j++) {
    const j2 = (j + 1) % n;
    for (let i = 0; i < m; i++) {
      if (i === open) continue;
      const i2 = (i + 1) % m;
      const a = j * m + i, b = j * m + i2, c = j2 * m + i, d = j2 * m + i2;
      idx.push(a, c, d, a, d, b); // counter-clockwise section → outward normals
    }
  }
  return { positions: Float64Array.from(pos), indices: Uint32Array.from(idx) };
}

export const talonLabelText = (p) => [p.labelAuto === false ? "" : `${Math.round(p.diameter)} T${Math.round(p.taper)}`, cleanLabelText(p.labelText)].filter(Boolean).join(" ");

// The label in the foot: one line between the cord hole and the rim, on the side away from you
// when it reads upright with the grip turned over (mirrored here, as the bed face is seen from
// below). Engraved like the insert's label: wide strokes, at least two layers deep.
function footLabel(p, prof, warnings) {
  const text = talonLabelText(p);
  if (p.labelMode === "off" || !text) return null;
  const rIn = prof.pts[0][0] + 1.5, rOut = prof.pts[1][0] - 1.5;
  const depth = Math.max(p.labelDepth, 2 * p.layerHeight);
  let pen = Math.max(3 * p.nozzle, 1.2);
  let size = Math.min(p.labelSize, rOut - rIn - pen - 1);
  for (let tries = 0; tries < 30 && size >= 3; tries++, size *= 0.92) {
    pen = Math.min(Math.max(3 * p.nozzle, 1.2), size / 5.5);
    const field = textField(text, size, pen);
    const yc = -(rIn + rOut) / 2, rot = 2e-3, cs = Math.cos(rot), sn = Math.sin(rot);
    const place = ([x, y]) => { const u = x - field.width / 2 + pen / 2, v = y - size / 2; return { x: -(u * cs - v * sn), y: yc + u * sn + v * cs, r: 0 }; };
    const groups = groupLoops(contourLoops(field, 0)).map((g) => ({ hole: g.outer.map(place), islands: g.holes.map((h) => h.map(place)) }));
    const all = groups.flatMap((g) => g.hole);
    if (!all.every((q) => { const r = Math.hypot(q.x, q.y); return r > rIn && r < rOut; })) continue;
    const ring = (r, cw) => { const out = signedArea(r) > 0 === cw ? r.slice().reverse() : r.slice(); out.ringAt = () => out; return out; };
    const letters = groups.map((g) => ({ hole: ring(g.hole, true), islands: g.islands.map((h) => ring(h, false)) }));
    if (size < p.labelSize - 0.05) warnings.push(`Label letters reduced to ${size.toFixed(1)} mm to fit the foot.`);
    const xs = all.map((q) => q.x), ys = all.map((q) => q.y);
    const box = [Math.min(...xs) - 1, Math.max(...xs) + 1, Math.min(...ys) - 1, Math.max(...ys) + 1];
    return { text, letters, depth, size, contains: (x, y, z) => z > 1e-4 && z < depth + 0.01 && x > box[0] && x < box[1] && y > box[2] && y < box[3] };
  }
  warnings.push("Label left out: the letters do not fit in the foot (shorter text, or a wider foot).");
  return null;
}

export function buildTalon(p) {
  const prof = talonProfile(p);
  const N = 160;
  const label = footLabel(p, prof, prof.warnings);
  let mesh;
  if (!label) mesh = revolve(prof.pts, N);
  else {
    // the foot as its own face, with the letters cut in: around them the face, each letter's walls
    // and its ceiling, and the counters left standing
    const around = (r, cw) => { const q = Array.from({ length: N }, (_, j) => ringPoint(r, j, N)); return cw ? q.reverse() : q; };
    const { letters, depth } = label;
    mesh = weld(mergeMeshes([
      revolve(prof.pts, N, 0),
      cap([around(prof.pts[1][0], false), around(prof.pts[0][0], true), ...letters.map((g) => g.hole)], 0, false),
      ...letters.flatMap((g) => [
        loft([0, depth].map((z) => ({ z, loops: [g.hole, ...g.islands], off: [g.hole, ...g.islands].map(() => 0) })), { bottom: false, top: false, welded: false }),
        cap([g.hole.slice().reverse(), ...g.islands.map((r) => r.slice().reverse())], depth, false),
        ...g.islands.map((r) => cap([r], 0, false)),
      ]),
    ]));
  }
  prof.labels = label ? [label] : [];
  const body = dropFlat(mesh);
  const stats = meshStats(body);
  const size = { x: prof.D, y: prof.D, z: prof.H };
  return { plan: prof, body, stats, size, offset: { x: 0, y: 0 }, filament: filamentEstimate(body, stats.volume, p, 0), strength: talonStrength(p, prof), warnings: prof.warnings };
}

// The knot pulls up on the floor of the knot pocket (or on the top face): it would punch a plug out.
// Shear area = knot circumference × floor thickness; printed plastic takes roughly 0.6 × its tensile
// strength in shear.
export function talonStrength(p, prof) {
  const P = p.loadKg * 9.81;
  const dk = prof.rk ? 2 * prof.rk - 1 : 2.5 * p.holeDia; // the knot about fills its pocket
  const t = prof.rk ? prof.H - p.knotDepth : prof.H;
  const tau = P / (Math.PI * dk * t);
  const sections = [{ name: "floor under the knot (shear)", stress: tau, safety: (0.6 * p.strengthMPa) / tau }];
  return { sections, worst: sections[0] };
}
