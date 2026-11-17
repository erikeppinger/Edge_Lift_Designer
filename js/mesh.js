// 2D outlines → closed triangle meshes. Outlines lie in XY (the bed); `loft` skins a stack of
// them along Z, each loop with its own inset per height (chamfers, rounds), and closes the ends;
// `pocketBody` joins a closed slab and a pocketed slab. Also triangulation, welding and checks.
// No DOM.

import { roundedRing, segmentPlan } from "./geom2d.js";

// Ear clipping of one simple polygon given as indices into pts (counter-clockwise).
function earClip(idx, pts, out) {
  const P = (k) => pts[idx[k]];
  const n0 = idx.length;
  const prev = [], next = [];
  for (let i = 0; i < n0; i++) { prev[i] = (i - 1 + n0) % n0; next[i] = (i + 1) % n0; }
  const area2 = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const isEar = (i) => {
    const a = P(prev[i]), b = P(i), c = P(next[i]);
    if (area2(a, b, c) <= 1e-12) return false;
    for (let j = next[next[i]]; j !== prev[i]; j = next[j]) {
      const q = P(j);
      if ((q.x === a.x && q.y === a.y) || (q.x === b.x && q.y === b.y) || (q.x === c.x && q.y === c.y)) continue;
      // a point inside or on the ear blocks it (straight runs are removed before, see triangulate)
      if (area2(a, b, q) >= 0 && area2(b, c, q) >= 0 && area2(c, a, q) >= 0) return false;
    }
    return true;
  };
  let remaining = n0, i = 0, guard = 0;
  while (remaining > 3) {
    if (isEar(i)) {
      out.push(idx[prev[i]], idx[i], idx[next[i]]);
      next[prev[i]] = next[i]; prev[next[i]] = prev[i];
      remaining--; guard = 0;
      i = prev[i];
    } else {
      i = next[i];
      if (++guard > remaining * 2) throw new Error("Triangulation failed (self-intersecting outline?)");
    }
  }
  out.push(idx[prev[i]], idx[i], idx[next[i]]);
}

function segmentsCross(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

// Joins the holes into the outer loop with zero-width bridges, then ear-clips.
// rings: [outerIdx, ...holeIdx] (index arrays into pts); outer CCW, holes CW.
export function triangulate(rings, pts) {
  const uniq = (r) => r.filter((k, i) => k !== r[(i - 1 + r.length) % r.length]);
  // Points exactly on a straight run (dense samples of a straight border) make ear clipping stall.
  // Triangulate without them, then put each one back by splitting the triangle on its edge, so the
  // cap still shares every vertex with the walls (closed mesh, no zero-area triangles).
  const removed = [];
  const simplify = (r) => {
    const ring = r.slice();
    let changed = true;
    while (changed && ring.length > 3) {
      changed = false;
      for (let i = 0; i < ring.length && ring.length > 3; i++) {
        const a = pts[ring[(i - 1 + ring.length) % ring.length]], v = pts[ring[i]], b = pts[ring[(i + 1) % ring.length]];
        const cr = (v.x - a.x) * (b.y - a.y) - (v.y - a.y) * (b.x - a.x);
        const dt = (v.x - a.x) * (b.x - v.x) + (v.y - a.y) * (b.y - v.y);
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (Math.abs(cr) <= 2e-5 * len && dt > 0) { // within 0.02 µm of the line: one line in the STL's 32-bit coordinates
          removed.push({ v: ring[i], a: ring[(i - 1 + ring.length) % ring.length], b: ring[(i + 1) % ring.length] });
          ring.splice(i, 1); i--; changed = true;
        }
      }
    }
    return ring;
  };
  let poly = simplify(uniq(rings[0]));
  const holes = rings.slice(1).map(uniq).map(simplify);
  holes.sort((h1, h2) => Math.max(...h2.map((k) => pts[k].x)) - Math.max(...h1.map((k) => pts[k].x)));
  for (const hole of holes) {
    let mi = 0;
    hole.forEach((k, j) => { if (pts[k].x > pts[hole[mi]].x) mi = j; });
    const M = pts[hole[mi]];
    const allEdges = () => {
      const es = [];
      const add = (r) => r.forEach((k, j) => es.push([pts[k], pts[r[(j + 1) % r.length]]]));
      add(poly); holes.forEach(add);
      return es;
    };
    const edges = allEdges();
    let best = -1, bestD = Infinity;
    const used = new Map();
    for (const k of poly) used.set(k, (used.get(k) ?? 0) + 1);
    poly.forEach((k, j) => {
      // a vertex that already ends a bridge would make the outline touch itself there again,
      // which ear clipping cannot see through (it skips duplicates): take the next best one
      if (used.get(k) > 1) return;
      const P = pts[k];
      const dd = (P.x - M.x) ** 2 + (P.y - M.y) ** 2;
      if (dd >= bestD) return;
      for (const [a, b] of edges) if (segmentsCross(M, P, a, b)) return;
      best = j; bestD = dd;
    });
    if (best < 0) throw new Error("No bridge to a hole");
    const rot = hole.slice(mi).concat(hole.slice(0, mi));
    poly = poly.slice(0, best + 1).concat(rot, [hole[mi], poly[best]], poly.slice(best + 1));
  }
  const tris = [];
  earClip(poly, pts, tris);
  // Re-insert the removed points, last removed first: each splits the triangle on edge a → b.
  const byEdge = new Map();
  const index = (t) => { for (let k = 0; k < 3; k++) byEdge.set(`${tris[t + k]},${tris[t + (k + 1) % 3]}`, t); };
  for (let t = 0; t < tris.length; t += 3) index(t);
  for (let r = removed.length - 1; r >= 0; r--) {
    const { v, a, b } = removed[r];
    const t = byEdge.get(`${a},${b}`);
    if (t === undefined) throw new Error("Triangulation failed (lost edge while re-inserting a point)");
    const k = [0, 1, 2].find((q) => tris[t + q] === a && tris[t + (q + 1) % 3] === b);
    const c = tris[t + (k + 2) % 3];
    byEdge.delete(`${a},${b}`);
    tris[t] = a; tris[t + 1] = v; tris[t + 2] = c;
    const t2 = tris.length;
    tris.push(v, b, c);
    index(t); index(t2);
  }
  return tris;
}

// Returns { positions: Float64Array (xyz), indices: Uint32Array }.
export function extrude(loops, width, chamferBottom, chamferTop) {
  return loft(chamferLevels([{ z: 0, loops }, { z: width, loops }], chamferBottom, chamferTop));
}

// 45° chamfers of size cb at z = 0 and ct at z = T.
export function chamferProfile(cb, ct, T) {
  return { off: (z) => Math.max(0, cb - z, ct - (T - z)), breaks: [cb, T - ct] };
}

// Adds the 45° chamfer rings at both ends of a list of {z, loops} stations (z ascending,
// first at 0, last at the full width). Each chamfer ring uses the profile of its end.
export function chamferLevels(stations, chamferBottom, chamferTop) {
  const first = stations[0], last = stations[stations.length - 1];
  const out = [];
  if (chamferBottom > 0) out.push({ z: first.z, off: chamferBottom, loops: first.loops });
  for (const s of stations) {
    const z = Math.min(Math.max(s.z, first.z + chamferBottom), last.z - chamferTop);
    if (out.length && Math.abs(out[out.length - 1].z - z) < 1e-9 && out[out.length - 1].off === 0) continue;
    out.push({ z, off: 0, loops: s.loops });
  }
  if (chamferTop > 0) out.push({ z: last.z, off: chamferTop, loops: last.loops });
  return out;
}

// Skins a list of profile stations {z, off, loops}. All stations must have the same loops with the
// same corners (only positions may change), so their rings line up vertex for vertex.
// `off` is one offset for all loops or an array with one per loop.
// caps: bottom/top false leaves that end open; floorLoop = loop index closes only that loop's
// first ring, facing up (the floor of a pocket whose walls are that loop).
// segOff: the largest offset of the stack this loft is a part of, so its rounded corners get the
// same points as the parts above and below it.
export function loft(levels, { bottom = true, top = true, floorLoop = null, welded = true, segOff = 0 } = {}) {
  const offOf = (lv, li) => (Array.isArray(lv.off) ? lv.off[li] : lv.off);
  const plans = levels[0].loops.map((l, li) => segmentPlan(l, Math.max(segOff, ...levels.map((lv) => offOf(lv, li)))));
  const loops = levels[0].loops;
  const pos = [];
  const ringIdx = levels.map((lv) => lv.loops.map((loop, li) => {
    // A loop may bring its own exact offset (ringAt), e.g. the stepped pocket outline.
    const ring = loop.ringAt ? loop.ringAt(offOf(lv, li), lv.z) : roundedRing(loop, offOf(lv, li), plans[li]);
    // Fillets that meet exactly (e.g. a round hole end) give repeated points: share one vertex.
    const same = (a, b) => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;
    const ids = [];
    ring.forEach((p, i) => {
      if (i > 0 && same(p, ring[i - 1])) { ids.push(ids[i - 1]); return; }
      pos.push(p.x, p.y, lv.z); ids.push(pos.length / 3 - 1);
    });
    if (ring.length > 1 && same(ring[ring.length - 1], ring[0])) {
      for (let i = ring.length - 1; i > 0 && ids[i] === ids[ring.length - 1]; i--) ids[i] = ids[0];
    }
    return ids;
  }));

  const idx = [];
  for (let l = 0; l < levels.length - 1; l++) {
    loops.forEach((_, li) => {
      const A = ringIdx[l][li], B = ringIdx[l + 1][li], n = A.length;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        if (A[i] !== A[j]) idx.push(A[i], A[j], B[j]);
        if (B[i] !== B[j]) idx.push(A[i], B[j], B[i]);
      }
    });
  }

  const pts2 = [];
  for (let k = 0; k < pos.length / 3; k++) pts2.push({ x: pos[3 * k], y: pos[3 * k + 1] });
  if (bottom) {
    const b = triangulateSafe(ringIdx[0], pts2);
    for (let k = 0; k < b.length; k += 3) idx.push(b[k], b[k + 2], b[k + 1]);
  }
  if (floorLoop !== null) {
    const ccw = ringIdx[0][floorLoop].slice().reverse();
    idx.push(...triangulateSafe([ccw], pts2));
  }
  if (top) idx.push(...triangulateSafe(ringIdx[levels.length - 1], pts2));

  const mesh = { positions: Float64Array.from(pos), indices: Uint32Array.from(idx) };
  return welded ? weld(mesh) : mesh;
}

// triangulate, with a second and third try: the ear clipper can stall on floating-point ties
// (a point exactly on a candidate diagonal). It is then run on copies of the points rounded to
// 0.01 µm, to 0.1 µm, and nudged by a nanometre: that only steers the choice of triangles, the
// vertices stay where they are.
export function triangulateSafe(rings, pts) {
  try { return triangulate(rings, pts); } catch (e) {
    const tweaks = [(p) => ({ x: Math.round(p.x * 1e5) / 1e5, y: Math.round(p.y * 1e5) / 1e5 }), (p) => ({ x: Math.round(p.x * 1e4) / 1e4, y: Math.round(p.y * 1e4) / 1e4 }),
      (p, k) => ({ x: p.x + 1e-6 * Math.sin(k * 12.9898), y: p.y + 1e-6 * Math.cos(k * 78.233) })];
    for (const tweak of tweaks) {
      const q = pts.slice();
      for (const r of rings) for (const k of r) q[k] = tweak(pts[k], k);
      try { return triangulate(rings, q); } catch { /* next */ }
    }
    throw e;
  }
}

// A flat face at height z from rings of points: the first counter-clockwise (the outline), the
// rest clockwise (holes). Points must be the very ones of the walls around it (the weld joins
// them). up: facing +z, else −z.
export function cap(rings, z, up = true) {
  const same = (p, q) => Math.abs(p.x - q.x) < 1e-9 && Math.abs(p.y - q.y) < 1e-9;
  const pts = [], idxRings = rings.map((r) => {
    const u = r.filter((q, i) => !same(q, r[(i - 1 + r.length) % r.length]));
    return u.map((q) => { pts.push({ x: q.x, y: q.y }); return pts.length - 1; });
  });
  const t = triangulateSafe(idxRings, pts);
  if (!up) for (let k = 0; k < t.length; k += 3) [t[k + 1], t[k + 2]] = [t[k + 2], t[k + 1]];
  return { positions: Float64Array.from(pts.flatMap((q) => [q.x, q.y, z])), indices: Uint32Array.from(t) };
}

// A plate with a blind pocket: `below` (closed at the bed, open on top) runs up to the pocket floor,
// `above` (open below) carries the pocket loop `pocketLoop` and gets the pocket floor as its bottom.
// Both must share their rings at the floor height, so the weld joins them.
export function pocketBody(below, above, pocketLoop) {
  // weld once, after joining (each part on its own would only be welded again)
  return weld(mergeMeshes([loft(below, { top: false, welded: false }), loft(above, { bottom: false, floorLoop: pocketLoop, welded: false })]));
}

// Merges vertices at the same position and drops the triangles that collapse. Two stations at the
// same z (a ledge where the outline changes) share their unchanged points this way.
export function weld(mesh) {
  const { positions: P, indices: I } = mesh;
  // Positions on a 1e-6 mm grid as integers: x selects a map, y·2²⁶ + z the entry (no strings).
  const byX = new Map(), remap = new Uint32Array(P.length / 3), pos = [];
  const q = (x) => Math.round(x * 1e6);
  for (let v = 0; v < P.length / 3; v++) {
    const qx = q(P[3 * v]), yz = q(P[3 * v + 1]) * 67108864 + q(P[3 * v + 2]);
    let m = byX.get(qx);
    if (!m) byX.set(qx, (m = new Map()));
    let id = m.get(yz);
    if (id === undefined) { id = pos.length / 3; m.set(yz, id); pos.push(P[3 * v], P[3 * v + 1], P[3 * v + 2]); }
    remap[v] = id;
  }
  const idx = [];
  for (let t = 0; t < I.length; t += 3) {
    const a = remap[I[t]], b = remap[I[t + 1]], c = remap[I[t + 2]];
    if (a !== b && b !== c && a !== c) idx.push(a, b, c);
  }
  return { positions: Float64Array.from(pos), indices: Uint32Array.from(idx) };
}

// Removes triangles that are flat in the STL's 32-bit coordinates: three corners in one line
// (slicers report them as degenerate and repair the file). The middle corner b sits on the long
// edge a–c: the triangle goes, and the neighbour across a–c is split at b, so the surface stays
// closed. Run on the finished part.
export function dropFlat({ positions: P, indices }) {
  const idx = Array.from(indices), f = Float32Array.from(P);
  const at = (i) => [f[3 * i], f[3 * i + 1], f[3 * i + 2]];
  const flatAt = (t) => {
    const v = [at(idx[t]), at(idx[t + 1]), at(idx[t + 2])];
    const len = [0, 1, 2].map((k) => Math.hypot(...v[(k + 1) % 3].map((x, j) => x - v[(k + 2) % 3][j]))); // len[k]: the edge opposite corner k
    const u = v[1].map((x, j) => x - v[0][j]), w = v[2].map((x, j) => x - v[0][j]), L = Math.max(...len);
    const n = Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]);
    return n <= 1e-12 * L * L ? len.indexOf(L) : -1;
  };
  let from = 0;
  for (let guard = 0; guard < 2000; guard++) {
    let found = -1, mid = -1;
    for (let t = from; t < idx.length; t += 3) { mid = flatAt(t); if (mid >= 0) { found = t; break; } }
    if (found < 0) break;
    const b = idx[found + mid], a = idx[found + (mid + 1) % 3], c = idx[found + (mid + 2) % 3]; // the triangle runs b → a → c
    let nb = -1, k0 = 0; // the neighbour holds the edge c → a
    for (let t = 0; t < idx.length && nb < 0; t += 3) for (let k = 0; k < 3; k++) if (t !== found && idx[t + k] === c && idx[t + (k + 1) % 3] === a) { nb = t; k0 = k; }
    if (nb < 0 || a === b || b === c || a === c) { from = found + 3; continue; } // nothing to split against: leave it
    const x = idx[nb + (k0 + 2) % 3];
    idx[nb] = c; idx[nb + 1] = b; idx[nb + 2] = x;
    idx[found] = b; idx[found + 1] = a; idx[found + 2] = x;
    from = 0;
  }
  return { positions: P, indices: Uint32Array.from(idx) };
}

// Axis-aligned box mesh (modifier volumes).
export function box(x0, y0, z0, x1, y1, z1) {
  const positions = Float64Array.from([
    x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0,
    x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1,
  ]);
  const indices = Uint32Array.from([
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4,
    1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7,
  ]);
  return { positions, indices };
}

export function mergeMeshes(meshes) {
  let nv = 0;
  const pos = [], idx = [];
  for (const m of meshes) {
    pos.push(...m.positions);
    for (const k of m.indices) idx.push(k + nv);
    nv += m.positions.length / 3;
  }
  return { positions: Float64Array.from(pos), indices: Uint32Array.from(idx) };
}

export function translate(mesh, dx, dy, dz) {
  const p = Float64Array.from(mesh.positions);
  for (let i = 0; i < p.length; i += 3) { p[i] += dx; p[i + 1] += dy; p[i + 2] += dz; }
  return { positions: p, indices: mesh.indices };
}

// Mesh checks used by the tests and the UI: every edge shared by exactly two triangles in
// opposite directions, and the enclosed volume.
export function meshStats(mesh) {
  const { positions: P, indices: I } = mesh;
  const edges = new Map();
  let vol = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const key = `${u},${v}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
    const ax = P[3 * a], ay = P[3 * a + 1], az = P[3 * a + 2];
    const bx = P[3 * b], by = P[3 * b + 1], bz = P[3 * b + 2];
    const cx = P[3 * c], cy = P[3 * c + 1], cz = P[3 * c + 2];
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  let open = 0;
  for (const [key, n] of edges) {
    const [u, v] = key.split(",");
    if (n !== 1 || edges.get(`${v},${u}`) !== 1) open++;
  }
  return { triangles: I.length / 3, vertices: P.length / 3, volume: vol, badEdges: open };
}

