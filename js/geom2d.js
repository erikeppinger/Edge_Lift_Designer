// 2D profile geometry. No DOM. A profile is a list of loops; every loop runs with the
// material on its left (outer loop counter-clockwise, holes clockwise). Each vertex is a
// sharp corner {x, y, r} with its own fillet radius r.

const EPS_R = 0.05; // smallest fillet kept when an offset eats a convex radius

export function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const len = (v) => Math.hypot(v.x, v.y);
const unit = (v) => { const l = len(v); return { x: v.x / l, y: v.y / l }; };
const cross = (a, b) => a.x * b.y - a.y * b.x;
const dot = (a, b) => a.x * b.x + a.y * b.y;

// Turning direction at each corner: +1 = left turn = convex corner of the material.
function corners(loop) {
  const n = loop.length;
  return loop.map((v, i) => {
    const a = unit(sub(v, loop[(i - 1 + n) % n]));
    const b = unit(sub(loop[(i + 1) % n], v));
    const s = cross(a, b);
    return { a, b, convex: s > 0, theta: Math.atan2(Math.abs(s), dot(a, b)) };
  });
}

// Moves every edge d into the material (sharp, mitered corners).
export function offsetSharp(loop, d) {
  const n = loop.length;
  const lines = loop.map((p, i) => {
    const e = unit(sub(loop[(i + 1) % n], p));
    const nrm = { x: -e.y, y: e.x }; // left normal = into the material
    return { p: { x: p.x + nrm.x * d, y: p.y + nrm.y * d }, e };
  });
  return loop.map((v, i) => {
    const L1 = lines[(i - 1 + n) % n], L2 = lines[i];
    const den = cross(L1.e, L2.e);
    if (Math.abs(den) < 1e-12) return { ...v, x: L2.p.x, y: L2.p.y };
    const t = cross(sub(L2.p, L1.p), L2.e) / den;
    return { ...v, x: L1.p.x + L1.e.x * t, y: L1.p.y + L1.e.y * t };
  });
}

// Segment count per corner, fixed for a loop so that all offset rings line up.
export function segmentPlan(loop, maxOffset, tol = 0.01) {
  return corners(loop).map((c, i) => {
    const r = loop[i].r + maxOffset;
    if (loop[i].r <= 0 || c.theta < 1e-6) return 0; // sharp corner: one point
    const step = 2 * Math.acos(Math.max(-1, 1 - tol / r));
    return Math.max(1, Math.min(48, Math.ceil(c.theta / step)));
  });
}

// Rounded outline of a loop offset by d (into the material). The fillet radius changes
// with the offset so the rounding stays concentric: convex r−d, concave r+d.
export function roundedRing(loop, d, plan) {
  const sharp = offsetSharp(loop, d);
  const cs = corners(sharp);
  const out = [];
  sharp.forEach((v, i) => {
    const c = cs[i];
    const r0 = loop[i].r;
    const rho = r0 <= 0 ? 0 : Math.max(EPS_R, c.convex ? r0 - d : r0 + d);
    const k = plan[i];
    if (rho === 0 || c.theta < 1e-6) {
      for (let j = 0; j <= k; j++) out.push({ x: v.x, y: v.y });
      return;
    }
    const tl = rho * Math.tan(c.theta / 2);
    const p1 = { x: v.x - c.a.x * tl, y: v.y - c.a.y * tl };
    const side = c.convex ? 1 : -1;
    const ctr = { x: p1.x - c.a.y * rho * side, y: p1.y + c.a.x * rho * side };
    const start = Math.atan2(p1.y - ctr.y, p1.x - ctr.x);
    for (let j = 0; j <= k; j++) {
      const ang = start + side * c.theta * (j / k);
      out.push({ x: ctr.x + rho * Math.cos(ang), y: ctr.y + rho * Math.sin(ang) });
    }
  });
  return out;
}

// Problems with a loop's fillets at offset d: two fillets that need more than the edge between them.
export function filletClashes(loop, d) {
  const sharp = offsetSharp(loop, d);
  const cs = corners(sharp);
  const tl = sharp.map((v, i) => {
    const r0 = loop[i].r, c = cs[i];
    const rho = r0 <= 0 ? 0 : Math.max(EPS_R, c.convex ? r0 - d : r0 + d);
    return rho * Math.tan(c.theta / 2);
  });
  const bad = [];
  for (let i = 0; i < sharp.length; i++) {
    const j = (i + 1) % sharp.length;
    const L = len(sub(sharp[j], sharp[i]));
    if (tl[i] + tl[j] > L + 1e-6) bad.push({ from: i, to: j, need: tl[i] + tl[j], have: L });
  }
  return bad;
}

// Circumscribed polygon whose fillets (radius R, centre c) trace a circular arc from angle
// phi0 to phi1 (counter-clockwise). Used to build round hole ends from sharp corners.
function arcCorners(c, R, phi0, phi1, maxTurn = Math.PI / 2) {
  const total = phi1 - phi0;
  const k = Math.max(1, Math.ceil(total / maxTurn - 1e-9));
  const step = total / k;
  const out = [];
  for (let i = 0; i < k; i++) {
    const mid = phi0 + step * (i + 0.5);
    const dist = R / Math.cos(step / 2);
    out.push({ x: c.x + dist * Math.cos(mid), y: c.y + dist * Math.sin(mid), r: R });
  }
  return out;
}

// Teardrop hole, tip pointing down (−y) at the load. Returned counter-clockwise; reverse for a hole.
// R: round-end radius, tipR: radius in the wedge, wedge: full wedge angle (rad).
export function teardrop(cx, cy, R, tipR, wedge) {
  const beta = wedge / 2;
  const L = R / Math.sin(beta); // centre to the sharp tip
  const tip = { x: cx, y: cy - L, r: tipR };
  // Tangent lines from the tip touch the circle where the radius is perpendicular to them.
  // Right tangent touches at angle −beta (measured from +x), left at π+beta.
  const arc = arcCorners({ x: cx, y: cy }, R, -beta, Math.PI + beta);
  return [tip, ...arc];
}

export const reversed = (loop) => loop.slice().reverse();

export function pointInPolygon(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

