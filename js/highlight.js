// Which faces of the model a control changes: a predicate per control on each triangle (centroid,
// corners and normal in plan coordinates). The page shows the selected triangles in the accent
// colour, in the 3D view and projected onto the plate drawing. Areas on the top face come with
// boxes instead, which the views cut the face to (its big triangles would show as slivers). No DOM.

const near = (a, b, tol = 0.05) => Math.abs(a - b) <= tol;
const BIG = 1e4;

export function highlightTriangles(model, params, key) {
  const pl = model.plan, off = model.offset;
  const { Ww, Hw, sb, T, F } = pl;
  const yTopMin = Math.min(...pl.segs.map(pl.yTop)), yBotMax = Math.max(...pl.botSegs.map(pl.yBot));
  const winBotMin = Math.min(...pl.botSegs.map(pl.yBot));
  const midY = (yTopMin + yBotMax) / 2;
  const c = params.chamferLayers * params.layerHeight;
  const dip = Math.abs(Math.min(0, params.bow ?? 0)) + 1; // an inward bow pulls the bar edge in
  const band = params.edgeRadius + 1; // the pocket rim reaches this far past the outline

  // between the pocket's borders (with their rim rounding), in x within the pocket
  const inPocketBand = (t) => t.x > -band && t.x < Ww + band && t.y > winBotMin - band && t.y < pl.winTopMax + band;
  const pocketWall = (t) => inPocketBand(t) && t.z > F - 0.01 && Math.abs(t.nz) < 0.98;
  const topBorder = (t) => pocketWall(t) && t.y > midY;
  const botBorder = (t) => pocketWall(t) && t.y < midY;
  // the stepped border itself, without the pocket's side walls and corners
  const inSpan = (t) => t.x > params.windowRadius && t.x < Ww - params.windowRadius;
  const stepped = (t) => inSpan(t) && (topBorder(t) || (pl.two && botBorder(t)));
  const ofHand = (side) => (t) => inSpan(t) && (pl.topSide === side ? topBorder(t) : pl.two && botBorder(t));
  const topFace = (t) => t.nz > 0.98 && near(t.z, T);
  const outerWall = (t) => Math.abs(t.nz) < 0.98 && !inPocketBand(t)
    && (t.x < -sb + 0.5 || t.x > Ww + sb - 0.5 || t.y > pl.yOuterTop - dip || t.y < pl.yOuterBot + dip);
  const holeWall = (t) => Math.abs(t.nz) < 0.98 && pl.slotX.some((sx) => Math.abs(t.x - sx) < pl.holeHalf + 1)
    && Math.abs(t.y - Hw / 2) < params.slotLength / 2 + 2;
  const chamfer = (t) => Math.abs(t.nz) > 0.3 && Math.abs(t.nz) < 0.95 && (t.z < c + 0.01 || t.z > T - c - 0.01) && !pocketWall(t);
  const corners = [[0, pl.yTop(pl.segs[0])], [Ww, pl.yTop(pl.segs.at(-1))], [0, pl.yBot(pl.botSegs[0])], [Ww, pl.yBot(pl.botSegs.at(-1))]];

  const P = {
    fingersR: ofHand("R"), fingersL: ofHand("L"),
    unlevel: stepped, stepScale: stepped, stepAngle: stepped, stepRadius: stepped, hands: stepped, hand: stepped,
    sideMargin: (t) => stepped(t) && (t.x < params.sideMargin + 1 || t.x > Ww - params.sideMargin - 1),
    edgeDepth: pocketWall,
    windowHeight: pocketWall,
    edgeRadius: (t) => pocketWall(t) && t.z > T - params.edgeRadius - 0.01,
    floorFillet: (t) => pocketWall(t) && t.z < F + params.floorFillet + 0.01,
    floorThick: (t) => t.nz > 0.98 && near(t.z, F),
    windowRadius: (t) => pocketWall(t) && corners.some(([cx, cy]) => Math.hypot(t.x - cx, t.y - cy) < params.windowRadius * 1.5 + 1.5),
    barThick: topFace, sideBar: topFace,
    bow: (t) => outerWall(t) && (t.y > pl.yOuterTop - dip || (pl.two && t.y < pl.yOuterBot + dip)) && t.x > -sb + params.outerRadius && t.x < Ww + sb - params.outerRadius,
    outerRadius: (t) => outerWall(t) && (t.x < -sb + params.outerRadius + 0.5 || t.x > Ww + sb - params.outerRadius - 0.5),
    slotShape: holeWall, cordDia: holeWall, slotLength: holeWall,
    chamferLayers: chamfer, layerHeight: chamfer,
  };
  // the areas those top-face selections are cut to (plan coordinates: x0, x1, y0, y1)
  const REGIONS = {
    barThick: [[-BIG, BIG, yTopMin, BIG], ...(pl.two ? [[-BIG, BIG, -BIG, yBotMax]] : [])],
    sideBar: [[-BIG, 0, -BIG, BIG], [Ww, BIG, -BIG, BIG]],
  };
  const pred = P[key];
  if (!pred) return null;

  const { positions: Q, indices: I } = model.body;
  const pos = [], idx = [];
  for (let k = 0; k < I.length; k += 3) {
    const v = [I[k], I[k + 1], I[k + 2]].map((i) => [Q[3 * i] - off.x, Q[3 * i + 1] - off.y, Q[3 * i + 2]]);
    const ux = v[1][0] - v[0][0], uy = v[1][1] - v[0][1], uz = v[1][2] - v[0][2];
    const wx = v[2][0] - v[0][0], wy = v[2][1] - v[0][1], wz = v[2][2] - v[0][2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, l = Math.hypot(nx, ny, nz) || 1;
    const t = {
      x: (v[0][0] + v[1][0] + v[2][0]) / 3, y: (v[0][1] + v[1][1] + v[2][1]) / 3, z: (v[0][2] + v[1][2] + v[2][2]) / 3,
      nx: nx / l, ny: ny / l, nz: nz / l,
    };
    if (!pred(t)) continue;
    for (const q of v) { pos.push(q[0] + off.x, q[1] + off.y, q[2]); idx.push(idx.length); }
  }
  if (!idx.length) return null;
  const planRegions = REGIONS[key] ?? null;
  const regions = planRegions?.map(([x0, x1, y0, y1]) => [x0 + off.x, x1 + off.x, y0 + off.y, y1 + off.y]) ?? null; // body coordinates
  return { positions: Float64Array.from(pos), indices: Uint32Array.from(idx), offset: off, regions, planRegions };
}
