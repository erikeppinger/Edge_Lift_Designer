// Labels on the outer wall of each edge bar: which hand that edge is for and the edge depth, plus
// optional text, raised from the wall or engraved into it. No DOM.
//
// Text: a small stroke font (centre lines of the letters) drawn with a round pen of the stroke
// width: the pen's outline is the zero line of a distance field, traced with marching squares and
// simplified. Mesh: the wall's triangles are cut out and the wall is triangulated again with the
// letters as holes; each letter gets sloped sides and a top (raised) or a floor (engraved), so the
// part stays one closed surface: no overlapping shells for the slicer to merge. A bowed bar is a
// row of flat facets; the letters follow them.

import { triangulate } from "./mesh.js";

// ---- font: polylines on a 4 × 6 cell (x right, y up), arcs as point lists ----
const arc = (cx, cy, rx, ry, a0, a1, n = 16) => Array.from({ length: n + 1 }, (_, i) => {
  const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
  return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
});
const ring = (cx, cy, rx, ry) => arc(cx, cy, rx, ry, 0, 360, 28);
const P_BOWL = [[0, 0], [0, 6], [2.4, 6], ...arc(2.4, 4.5, 1.6, 1.5, 90, -90, 10), [0, 3]];
const GLYPHS = {
  "0": [ring(2, 3, 2, 3)],
  "1": [[[0.9, 4.8], [2.2, 6], [2.2, 0]]],
  "2": [[...arc(2, 4.2, 2, 1.8, 165, -35, 14), [0, 0], [4, 0]]],
  "3": [[...arc(2, 4.55, 1.8, 1.45, 150, -90, 12), ...arc(2, 1.55, 2, 1.55, 90, -150, 12)]],
  "4": [[[3, 0], [3, 6], [0, 1.8], [4, 1.8]]],
  "5": [[[3.8, 6], [0.4, 6], [0.2, 3.3], ...arc(2, 1.95, 2, 1.95, 135, -145, 14)]],
  "6": [arc(2, 3, 2, 3, 62, 200, 12), ring(2, 1.95, 2, 1.95)],
  "7": [[[0, 6], [4, 6], [1.2, 0]]],
  "8": [ring(2, 4.6, 1.7, 1.4), ring(2, 1.6, 2, 1.6)],
  "9": [arc(2, 3, 2, 3, 242, 380, 12), ring(2, 4.05, 2, 1.95)],
  A: [[[0, 0], [2, 6], [4, 0]], [[0.7, 2], [3.3, 2]]],
  B: [[[0, 3], [2.6, 3], ...arc(2.6, 1.5, 1.4, 1.5, 90, -90, 10), [0, 0], [0, 6], [2.4, 6], ...arc(2.4, 4.5, 1.3, 1.5, 90, -90, 10)]],
  C: [arc(2.2, 3, 2.2, 3, 45, 315, 20)],
  D: [[[0, 0], [0, 6], [1.4, 6], ...arc(1.4, 3, 2.6, 3, 90, -90, 16), [0, 0]]],
  E: [[[4, 6], [0, 6], [0, 0], [4, 0]], [[0, 3], [3, 3]]],
  F: [[[4, 6], [0, 6], [0, 0]], [[0, 3], [3, 3]]],
  G: [[...arc(2.2, 3, 2.2, 3, 45, 335, 20), [4.2, 2.6], [2.4, 2.6]]],
  H: [[[0, 0], [0, 6]], [[4, 0], [4, 6]], [[0, 3], [4, 3]]],
  I: [[[1, 0], [1, 6]], [[0, 6], [2, 6]], [[0, 0], [2, 0]]],
  J: [[[4, 6], [4, 2], ...arc(2, 2, 2, 2, 0, -180, 12)]],
  K: [[[0, 0], [0, 6]], [[4, 6], [0, 2.2]], [[1.3, 3.3], [4, 0]]],
  L: [[[0, 6], [0, 0], [4, 0]]],
  M: [[[0, 0], [0, 6], [2, 2.5], [4, 6], [4, 0]]],
  N: [[[0, 0], [0, 6], [4, 0], [4, 6]]],
  O: [ring(2, 3, 2, 3)],
  P: [P_BOWL],
  Q: [ring(2, 3, 2, 3), [[2.6, 1.4], [4.2, -0.4]]],
  R: [P_BOWL, [[2, 3], [4, 0]]],
  S: [[...arc(2, 4.5, 1.9, 1.5, 15, 270, 14), ...arc(2, 1.5, 2, 1.5, 90, -165, 14)]],
  T: [[[0, 6], [4, 6]], [[2, 6], [2, 0]]],
  U: [[[0, 6], [0, 2], ...arc(2, 2, 2, 2, 180, 360, 12), [4, 6]]],
  V: [[[0, 6], [2, 0], [4, 6]]],
  W: [[[0, 6], [1, 0], [2, 4], [3, 0], [4, 6]]],
  X: [[[0, 0], [4, 6]], [[0, 6], [4, 0]]],
  Y: [[[0, 6], [2, 3], [4, 6]], [[2, 3], [2, 0]]],
  Z: [[[0, 6], [4, 6], [0, 0], [4, 0]]],
  "-": [[[0.8, 3], [3.2, 3]]],
  "+": [[[0.6, 3], [3.4, 3]], [[2, 1.6], [2, 4.4]]],
  "/": [[[0.4, 0], [3.6, 6]]],
  ".": [[[0.5, 0], [0.5, 0.05]]],
  " ": [],
};
const ADVANCE = { ".": 2, " ": 3, I: 4 }; // others: 4 + 2 (cell + gap), in cell units

export const LABEL_CHARS = Object.keys(GLYPHS).join("");
export const cleanLabelText = (s) => [...String(s ?? "").toUpperCase()].filter((ch) => ch in GLYPHS).join("").replace(/\s+/g, " ").trim();

// The text on one edge's label: that edge's hand and the edge depth, then the user's own text.
export function labelText(p, hand) {
  const depth = Number.isInteger(p.edgeDepth) ? String(p.edgeDepth) : p.edgeDepth.toFixed(1);
  return [p.labelAuto === false ? "" : `${hand === "left" ? "L" : "R"} ${depth}`, cleanLabelText(p.labelText)].filter(Boolean).join(" ");
}

// Stroke centre lines of a text, in mm, cap height `size`, starting at x = 0, baseline y = 0.
function strokes(text, size) {
  const k = size / 6, out = [];
  let x = 0;
  for (const ch of text) {
    for (const line of GLYPHS[ch] ?? []) out.push(line.map(([u, v]) => [x + u * k, v * k]));
    x += (ADVANCE[ch] ?? 6) * k;
  }
  return { lines: out, width: Math.max(0, x - 2 * k) };
}

// Distance field of the text: pen radius minus the distance to the nearest stroke centre line
// (> 0 inside the letters; the line where it is t lies t inside the letters' outline).
export function textField(text, size, pen) {
  const { lines, width } = strokes(text, size);
  const segs = [];
  for (const l of lines) for (let i = 0; i < l.length - 1; i++) segs.push([l[i], l[i + 1]]);
  if (!segs.length) return null;
  const r = pen / 2, h = Math.min(0.12, pen / 8);
  const x0 = -r - 2 * h, y0 = -r - 2 * h - size * 0.1, nx = Math.ceil((width + 2 * r + 4 * h) / h) + 1, ny = Math.ceil((size * 1.2 + 2 * r + 4 * h) / h) + 1;
  // field: pen radius minus the distance to the nearest stroke (> 0 inside the letters)
  const f = new Float64Array(nx * ny).fill(-1);
  for (const [a, b] of segs) {
    const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1e-12;
    const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - r - x0) / h) - 1), i1 = Math.min(nx - 1, Math.ceil((Math.max(a[0], b[0]) + r - x0) / h) + 1);
    const j0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - r - y0) / h) - 1), j1 = Math.min(ny - 1, Math.ceil((Math.max(a[1], b[1]) + r - y0) / h) + 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = x0 + i * h, py = y0 + j * h;
      const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / L2));
      const v = r - Math.hypot(px - a[0] - t * dx, py - a[1] - t * dy);
      if (v > f[j * nx + i]) f[j * nx + i] = v;
    }
  }
  return { f, nx, ny, x0, y0, h, width: width + pen };
}

// Outline where the field is `level` (0: the letters' outline; larger: shrunk by that much):
// marching squares, the crossing points keyed by grid edge so the pieces chain exactly; letters
// counter-clockwise, counters clockwise, simplified.
export function contourLoops(field, level = 0) {
  const { f, nx, ny, x0, y0, h } = field;
  const val = (i, j) => { const v = f[j * nx + i] - level; return v === 0 ? 1e-9 : v; };
  const pt = new Map();
  const cross = (i, j, horiz) => {
    const key = (j * nx + i) * 2 + (horiz ? 0 : 1);
    if (!pt.has(key)) {
      const a = val(i, j), b = horiz ? val(i + 1, j) : val(i, j + 1), t = a / (a - b);
      pt.set(key, horiz ? [x0 + (i + t) * h, y0 + j * h] : [x0 + i * h, y0 + (j + t) * h]);
    }
    return key;
  };
  const next = new Map(); // directed piece: from key → to key, inside on the left
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = val(i, j) > 0, b = val(i + 1, j) > 0, c = val(i + 1, j + 1) > 0, d = val(i, j + 1) > 0;
    const code = (a ? 1 : 0) | (b ? 2 : 0) | (c ? 4 : 0) | (d ? 8 : 0);
    if (code === 0 || code === 15) continue;
    const S = () => cross(i, j, true), E = () => cross(i + 1, j, false), N = () => cross(i, j + 1, true), W = () => cross(i, j, false);
    // corners a (bottom left), b (bottom right), c (top right), d (top left). The table lists each
    // piece with the inside on its right; stored reversed, so the loops run with the inside on the
    // left (letters counter-clockwise, counters clockwise).
    const add = (p, q) => next.set(q(), p());
    switch (code) {
      case 1: add(W, S); break;
      case 2: add(S, E); break;
      case 3: add(W, E); break;
      case 4: add(E, N); break;
      case 6: add(S, N); break;
      case 7: add(W, N); break;
      case 8: add(N, W); break;
      case 9: add(N, S); break;
      case 11: add(N, E); break;
      case 12: add(E, W); break;
      case 13: add(E, S); break;
      case 14: add(S, W); break;
      case 5: case 10: {
        const mid = (val(i, j) + val(i + 1, j) + val(i + 1, j + 1) + val(i, j + 1)) / 4 > 0;
        if (code === 5) { if (mid) { add(W, N); add(E, S); } else { add(W, S); add(E, N); } }
        else if (mid) { add(S, W); add(N, E); } else { add(S, E); add(N, W); }
        break;
      }
    }
  }
  const loops = [];
  const seen = new Set();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop = [];
    let k = start;
    while (!seen.has(k)) { seen.add(k); loop.push(pt.get(k)); k = next.get(k); if (k === undefined) break; }
    if (loop.length >= 3) { const l = simplify(loop, 0.03); if (l.length >= 3 && Math.abs(loopArea(l)) > 0.01) loops.push(l); }
  }
  return loops;
}

export const loopArea = (l) => l.reduce((s, p, i) => { const q = l[(i + 1) % l.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;

// Loops (CCW = outline, CW = hole) → polygons: each hole goes with the smallest outline around it.
export function groupLoops(loops) {
  const outers = loops.filter((l) => loopArea(l) > 0), holes = loops.filter((l) => loopArea(l) < 0);
  const polys = outers.map((o) => ({ outer: o, holes: [] }));
  for (const hl of holes) {
    const owner = polys.filter((q) => inside(hl[0], q.outer)).sort((p1, p2) => loopArea(p1.outer) - loopArea(p2.outer))[0];
    if (owner) owner.holes.push(hl);
  }
  return polys;
}

// The letters' outline: { polys: [{ outer, holes }], width }.
export function textOutline(text, size, pen) {
  const field = textField(text, size, pen);
  return field ? { polys: groupLoops(contourLoops(field, 0)), width: field.width } : { polys: [], width: 0 };
}

function inside(p, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

// Douglas–Peucker on a closed loop.
function simplify(loop, tol) {
  const n = loop.length;
  let far = 0;
  for (let i = 1; i < n; i++) if (Math.hypot(loop[i][0] - loop[0][0], loop[i][1] - loop[0][1]) > Math.hypot(loop[far][0] - loop[0][0], loop[far][1] - loop[0][1])) far = i;
  const keep = new Uint8Array(n);
  keep[0] = keep[far] = 1;
  const dp = (i0, i1) => { // i1 may wrap
    let best = -1, bd = tol;
    const a = loop[i0 % n], b = loop[i1 % n], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1e-12;
    for (let i = i0 + 1; i < i1; i++) {
      const p = loop[i % n], d = Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / L;
      if (d > bd) { bd = d; best = i; }
    }
    if (best >= 0) { keep[best % n] = 1; dp(i0, best); dp(best, i1); }
  };
  dp(0, far); dp(far, n);
  return loop.filter((_, i) => keep[i]);
}

// ---- mesh ----
// Puts the label on an outer wall of a closed mesh. The wall is vertical, its plan outline the
// polyline `path` (a straight bar is two points, a bowed one a row of facets), given in reading
// order. The letters' tops point to the open side (+z): that reads upright when you look down on
// the edge you lift on. zRange: the flat band of the
// wall between the chamfers. depth > 0 raises the letters, < 0 engraves them.
// Wall coordinates: u = distance along the path, v = z (so u × v points out of the wall).
// The wall's triangles are cut out and the wall is triangulated again around the letters; every
// inner edge that crosses a facet line is split there, so the faces follow the facets.
// Returns { mesh, box: [u0, u1, v0, v1], size, contains(x, y, z) } or { error }.
export function applyLabel(mesh, { text, path, zRange, size, pen, depth, margin = 1.5, maxWidth = Infinity }) {
  const { positions: P, indices: I } = mesh;
  const n = path.length - 1;
  if (n < 1) return { error: "no wall for the label" };
  const S = [0];
  const nrm = [];
  for (let i = 0; i < n; i++) {
    const dx = path[i + 1].x - path[i].x, dy = path[i + 1].y - path[i].y, L = Math.hypot(dx, dy) || 1e-12;
    S.push(S[i] + L);
    nrm.push({ x: dy / L, y: -dx / L }); // outwards: tangent × z
  }
  // offset direction at a facet line: the bisector, long enough to keep the distance on both facets
  const bis = (k) => { const a = nrm[k - 1], b = nrm[k], d = 1 + a.x * b.x + a.y * b.y; return { x: (a.x + b.x) / d, y: (a.y + b.y) / d }; };
  const seamAt = (s) => { for (let k = 1; k < n; k++) if (Math.abs(s - S[k]) < 1e-9) return k; return -1; };
  const place = (u, v, w) => {
    const k = seamAt(u);
    if (k > 0) { const b = bis(k); return [path[k].x + b.x * w, path[k].y + b.y * w, v]; }
    let i = 0;
    while (i < n - 1 && u > S[i + 1]) i++;
    const t = (u - S[i]) / (S[i + 1] - S[i]);
    return [path[i].x + (path[i + 1].x - path[i].x) * t + nrm[i].x * w, path[i].y + (path[i + 1].y - path[i].y) * t + nrm[i].y * w, v];
  };
  const seamBetween = (a, b) => {
    const lo = Math.min(a, b) + 1e-7, hi = Math.max(a, b) - 1e-7, mid = (a + b) / 2;
    let best = -1;
    for (let k = 1; k < n; k++) if (S[k] > lo && S[k] < hi && (best < 0 || Math.abs(S[k] - mid) < Math.abs(S[best] - mid))) best = k;
    return best;
  };

  // the wall's triangles: all corners on the path within the band, facing out
  const q = (v) => Math.round(v * 1e6);
  const onPath = new Map(path.map((p, i) => [`${q(p.x)},${q(p.y)}`, i]));
  const sOf = (i) => onPath.get(`${q(P[3 * i])},${q(P[3 * i + 1])}`);
  const [za, zb] = zRange;
  const inBand = (i) => sOf(i) !== undefined && P[3 * i + 2] > za - 1e-6 && P[3 * i + 2] < zb + 1e-6;
  const face = [], keep = [];
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    let isFace = false;
    if (inBand(a) && inBand(b) && inBand(c)) {
      const nn = cross3(P, a, b, c), l = Math.hypot(...nn) || 1;
      const k = Math.min(n - 1, sOf(a), sOf(b), sOf(c));
      isFace = Math.abs(nn[2]) < 1e-6 * l && nn[0] * nrm[k].x + nn[1] * nrm[k].y > 0;
    }
    (isFace ? face : keep).push(a, b, c);
  }
  if (!face.length) return { error: "no flat band on the wall for the label" };
  const dir = new Set();
  for (let t = 0; t < face.length; t += 3) for (let k = 0; k < 3; k++) dir.add(`${face[t + k]},${face[t + (k + 1) % 3]}`);
  const nextOf = new Map();
  for (const key of dir) { const [a, b] = key.split(",").map(Number); if (!dir.has(`${b},${a}`)) nextOf.set(a, b); }
  const start = nextOf.keys().next().value;
  const border = [start];
  for (let k = nextOf.get(start); k !== start; k = nextOf.get(k)) {
    if (k === undefined || border.length > nextOf.size) return { error: "the label wall is not one simple face" };
    border.push(k);
  }
  if (border.length !== nextOf.size) return { error: "the label wall is not one simple face" };

  // fit and centre the text
  const roomU = Math.min(S[n] - 2 * margin, maxWidth), roomV = zb - za - 2 * margin;
  let cap = Math.min(size, (roomV - pen) / 1.1);
  let field = cap > 0 ? textField(text, cap, pen) : null;
  if (field && field.width > roomU) { cap *= roomU / field.width; field = textField(text, cap, pen); }
  const base = field ? contourLoops(field, 0) : [];
  if (cap < 3 || !base.length) return { error: `the letters do not fit on ${Math.max(0, roomU).toFixed(0)} × ${Math.max(0, roomV).toFixed(0)} mm of flat wall` };
  const allPts = base.flat();
  const tx0 = Math.min(...allPts.map((p) => p[0])), tx1 = Math.max(...allPts.map((p) => p[0]));
  const ty0 = Math.min(...allPts.map((p) => p[1])), ty1 = Math.max(...allPts.map((p) => p[1]));
  const du = S[n] / 2 - (tx0 + tx1) / 2, dv = (za + zb) / 2 - (ty0 + ty1) / 2;
  // letter outlines in wall coordinates, with a point wherever they cross a facet line
  const toWall = (loop) => {
    const r = [];
    loop.forEach((p, i) => {
      const a = [p[0] + du, p[1] + dv], b0 = loop[(i + 1) % loop.length], b = [b0[0] + du, b0[1] + dv];
      r.push(a);
      const ks = [];
      for (let k = 1; k < n; k++) if (S[k] > Math.min(a[0], b[0]) + 1e-7 && S[k] < Math.max(a[0], b[0]) - 1e-7) ks.push(k);
      ks.sort((k1, k2) => (b[0] > a[0] ? S[k1] - S[k2] : S[k2] - S[k1]));
      for (const k of ks) { const t = (S[k] - a[0]) / (b[0] - a[0]); r.push([S[k], a[1] + (b[1] - a[1]) * t]); }
    });
    return r;
  };
  // 45° sides: the relief is built as thin terraces, each the letters shrunk by its own height
  // (fine enough that the printer smooths them into a slope; no flat overhang under raised letters
  // and no flat ceiling over engraved ones). Thin strokes end in a ridge.
  const steps = Math.max(1, Math.round(Math.abs(depth) / 0.2)), dz = depth / steps;
  const levels = [];
  for (let k = 0; k < steps; k++) {
    if (k * Math.abs(dz) > pen / 2 - 0.06) break; // strokes thinner than 0.12 mm: the ridge ends here
    // Traced on a grid, many outline points share one exact height; three of them in an exact
    // line stall the triangulation or end up as a flat triangle. Each terrace is turned by a
    // hair (1e-4 rad more per terrace, a few µm across the label), so no such lines remain.
    const rot = 1e-4 * (k + 1), cs = Math.cos(rot), sn = Math.sin(rot), ox = (tx0 + tx1) / 2, oy = (ty0 + ty1) / 2;
    const turn = (l) => l.map(([x, y]) => [ox + (x - ox) * cs - (y - oy) * sn, oy + (x - ox) * sn + (y - oy) * cs]);
    const loops = (k === 0 ? base : contourLoops(field, k * Math.abs(dz))).map(turn).map(toWall);
    if (!loops.length) break;
    levels.push(loops);
  }

  // new vertices are kept as (u, v, w) and placed at the end
  const pts2 = [], uvw = new Map();
  for (const i of border) pts2[i] = { x: S[sOf(i)], y: P[3 * i + 2] };
  let nv = P.length / 3;
  const vert = (u, v, w) => { const i = nv++; pts2[i] = { x: u, y: v }; uvw.set(i, [u, v, w]); return i; };
  // split every inner edge that crosses a facet line, at that line (edges kept in a map, updated
  // as triangles change)
  const refine = (tris, w) => {
    const edges = new Map(), key = (a, b) => a * 4194304 + b; // ids stay below 2²²
    const index = (t) => { for (let k = 0; k < 3; k++) edges.set(key(tris[t + k], tris[t + (k + 1) % 3]), t); };
    const unindex = (t) => { for (let k = 0; k < 3; k++) edges.delete(key(tris[t + k], tris[t + (k + 1) % 3])); };
    for (let t = 0; t < tris.length; t += 3) index(t);
    const queue = [];
    for (let t = 0; t < tris.length; t += 3) for (let k = 0; k < 3; k++) queue.push([tris[t + k], tris[t + (k + 1) % 3]]);
    let guard = 0;
    while (queue.length) {
      if (++guard > 2000000) throw new Error("label: refining the wall did not finish");
      const [a, b] = queue.pop();
      const t = edges.get(key(a, b)), t2 = edges.get(key(b, a));
      if (t === undefined || t2 === undefined) continue; // gone, or on the face's border
      const k = seamBetween(pts2[a].x, pts2[b].x);
      if (k < 0) continue;
      const f = (S[k] - pts2[a].x) / (pts2[b].x - pts2[a].x), mv = pts2[a].y + (pts2[b].y - pts2[a].y) * f;
      const third = (tt) => [tris[tt], tris[tt + 1], tris[tt + 2]].find((v) => v !== a && v !== b);
      const c = third(t), d = third(t2);
      unindex(t); unindex(t2);
      const m = vert(S[k], mv, w);
      tris[t] = a; tris[t + 1] = m; tris[t + 2] = c;
      tris[t2] = b; tris[t2 + 1] = m; tris[t2 + 2] = d;
      const t3 = tris.length; tris.push(m, b, c);
      const t4 = tris.length; tris.push(m, a, d);
      index(t); index(t2); index(t3); index(t4);
      queue.push([a, m], [m, b], [m, c], [c, a], [b, c], [m, d], [d, b], [a, d]);
    }
    return tris;
  };
  // The ear clipper can stall on floating-point ties (points exactly on a candidate diagonal). Then
  // it is tried again on copies rounded to 0.01 µm, then 0.1 µm, then nudged by 1 nm: that only
  // steers the choice of triangles, the vertices stay where they are.
  const triangulateSafe = (rings) => {
    try { return triangulate(rings, pts2); } catch (e) {
      for (const tweak of [(p) => ({ x: Math.round(p.x * 1e5) / 1e5, y: Math.round(p.y * 1e5) / 1e5 }), (p) => ({ x: Math.round(p.x * 1e4) / 1e4, y: Math.round(p.y * 1e4) / 1e4 }),
        (p, k) => ({ x: p.x + 1e-6 * Math.sin(k * 12.9898), y: p.y + 1e-6 * Math.cos(k * 78.233) })]) {
        const q = pts2.slice();
        for (const r of rings) for (const k of r) q[k] = tweak(pts2[k], k);
        try { return triangulate(rings, q); } catch { /* next */ }
      }
      throw e;
    }
  };
  // a flat face at height w from loops of vertex ids (CCW outlines, CW holes, any mix)
  const area2 = (r) => r.reduce((s2, k, i) => { const p = pts2[k], q2 = pts2[r[(i + 1) % r.length]]; return s2 + p.x * q2.y - q2.x * p.y; }, 0);
  const faceOf = (rings, w) => {
    const outers = rings.filter((r) => area2(r) > 0), holes = rings.filter((r) => area2(r) < 0);
    const polys = outers.map((o) => ({ outer: o, holes: [] }));
    for (const hl of holes) {
      const p0 = [pts2[hl[0]].x, pts2[hl[0]].y];
      const owner = polys.filter((q2) => inside(p0, q2.outer.map((k) => [pts2[k].x, pts2[k].y]))).sort((p1, p2) => area2(p1.outer) - area2(p2.outer))[0];
      if (owner) owner.holes.push(hl);
    }
    const tris = [];
    for (const q2 of polys) tris.push(...refine(triangulateSafe([q2.outer, ...q2.holes]), w));
    return tris;
  };

  const idx = keep.slice();
  // A[k]: the loops of terrace k at its foot, B[k]: at its top
  const A = [], B = [];
  levels.forEach((loops, k) => {
    A.push(loops.map((l) => l.map(([u, v]) => vert(u, v, k * dz))));
    B.push(loops.map((l) => l.map(([u, v]) => vert(u, v, (k + 1) * dz))));
    // side walls: foot → top, run like the loop (the faces around run it the other way)
    A[k].forEach((a, L) => {
      const b = B[k][L], m = a.length;
      for (let i = 0; i < m; i++) { const j = (i + 1) % m; idx.push(a[i], a[j], b[j], a[i], b[j], b[i]); }
    });
  });
  const rev = (r) => r.slice().reverse();
  // the wall around the letters, and the letters' counters at wall level
  idx.push(...faceOf([border, ...A[0].map(rev)], 0));
  // the ledge on top of each terrace (the next terrace stands on it), and the top of the last
  for (let k = 0; k < levels.length; k++) idx.push(...faceOf([...B[k], ...(k + 1 < levels.length ? A[k + 1].map(rev) : [])], (k + 1) * dz));
  const pos = new Float64Array(nv * 3);
  pos.set(P);
  for (const [i, [u, v, w]] of uvw) pos.set(place(u, v, w), 3 * i);
  const bu = levels[0].flat().map((x) => x[0]), bv = levels[0].flat().map((x) => x[1]);
  const box = [Math.min(...bu), Math.max(...bu), Math.min(...bv), Math.max(...bv)];
  // for highlighting: is a point within the letters' box, at most the relief away from the wall?
  const contains = (x, y, z) => {
    let best = null;
    for (let i = 0; i < n; i++) {
      const ax = path[i].x, ay = path[i].y, dx = path[i + 1].x - ax, dy = path[i + 1].y - ay, L2 = dx * dx + dy * dy || 1e-12;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2));
      const d = Math.hypot(x - ax - t * dx, y - ay - t * dy);
      if (!best || d < best.d) best = { d, s: S[i] + t * (S[i + 1] - S[i]) };
    }
    return best.d <= Math.abs(depth) + 0.05 && best.s > box[0] - 0.3 && best.s < box[1] + 0.3 && z > box[2] - 0.3 && z < box[3] + 0.3;
  };
  return { mesh: { positions: pos, indices: Uint32Array.from(idx) }, box, size: cap, contains };
}

function cross3(P, a, b, c) {
  const ux = P[3 * b] - P[3 * a], uy = P[3 * b + 1] - P[3 * a + 1], uz = P[3 * b + 2] - P[3 * a + 2];
  const vx = P[3 * c] - P[3 * a], vy = P[3 * c + 1] - P[3 * a + 1], vz = P[3 * c + 2] - P[3 * a + 2];
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}
