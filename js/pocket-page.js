// Finger pocket page: controls, drawing and results around pocket.js.

import { buildPocket, fitWidth, FINGER_SETS, POCKET_DEFAULTS } from "./pocket.js";
import { startTool, PRINT_GROUP, STRENGTH_GROUP, LABEL_GROUP, fmt } from "./toolpage.js";
import { roundedRing, segmentPlan } from "./geom2d.js";

// The hand data the edge designer keeps on this device (finger widths at the end joint).
function savedHand() {
  try { return JSON.parse(localStorage.getItem("edgeLiftDesigner.params.v6") ?? "null"); } catch { return null; }
}

const GROUPS = [
  { title: "Fingers", open: true,
    note: "The pocket's width follows the fingers: their widths at the end joint from the Unlevel edge page (Hand table) on this device, side by side, plus the room each side. Without measurements: average adult widths. You can still set the width yourself under Pocket.",
    fields: [
    { key: "fingerSet", label: "Pocket for", type: "select", options: FINGER_SETS },
    { key: "hand", label: "Hand", type: "select", options: [["right", "right"], ["left", "left"]], help: "Whose finger widths to use." },
    { key: "fitClear", label: "Room each side", unit: "mm", min: 0, max: 5, step: 0.5 },
  ] },
  { title: "Pocket", open: true, fields: [
    { key: "style", label: "Pocket", type: "select", options: [["blind", "blind: floor stops the fingertips"], ["through", "through: a hole right through"]],
      help: "Blind like a hangboard pocket, its depth limits how far the fingers go in. Through like a ring: the block's thickness is how much of the finger lies on the bar." },
    { key: "pocketWidth", label: "Width (across the fingers)", unit: "mm", min: 14, max: 75, step: 0.5 },
    { key: "pocketHeight", label: "Height (along the pull)", unit: "mm", min: 12, max: 40, step: 0.5,
      help: "Room for the finger's thickness: the fingers go in, then pull down on the bar." },
    { key: "pocketCorner", label: "Corner radius", unit: "mm", min: 0.5, max: 20, step: 0.5, help: "Half the height gives round ends." },
    { key: "depth", label: "Depth", unit: "mm", min: 6, max: 40, step: 0.5,
      help: "Blind: how far the fingers go in (first pad about 10–15 mm, to the end joint about 20–25 mm). Through: the block's thickness." },
    { key: "rimRadius", label: "Rim radius", unit: "mm", min: 0, max: 12, step: 0.5,
      help: "The rim the fingers bend over: round on the top face. On the bed face of a through pocket it is round, then 45°, so it prints without support." },
    { key: "floorThick", label: "Floor", unit: "mm", min: 1.5, max: 8, step: 0.5, showIf: (p) => p.style === "blind" },
    { key: "floorRound", label: "Rounded bottom", unit: "mm", min: 0, max: 15, step: 0.5, showIf: (p) => p.style === "blind",
      help: "The pocket's walls curve into the floor like a bowl, under the fingertips. 0 = flat with a sharp corner." },
  ] },
  { title: "Block", fields: [
    { key: "barDepth", label: "Bar under the fingers", unit: "mm", min: 6, max: 30, step: 0.5 },
    { key: "sideWall", label: "Side walls", unit: "mm", min: 4, max: 25, step: 0.5 },
    { key: "neck", label: "Neck to the cord hole", unit: "mm", min: 3, max: 30, step: 0.5 },
    { key: "outerRadius", label: "Lower corner radius", unit: "mm", min: 2, max: 30, step: 0.5 },
    { key: "edgeRound", label: "Edge rounding", unit: "mm", min: 0, max: 6, step: 0.5, help: "All outer edges: round on top, round then 45° at the bed." },
  ] },
  { title: "Cord", fields: [
    { key: "cordDia", label: "Cord diameter", unit: "mm", min: 3, max: 12, step: 0.5, help: "The hole is 1.5 mm wider." },
    { key: "cordWall", label: "Material around the hole", unit: "mm", min: 4, max: 20, step: 0.5, help: "The crown above the hole carries the whole load." },
  ] },
  LABEL_GROUP("On the outer wall of the bar under the fingers, read from outside: the fingers (I index, M middle, R ring, L little) and the depth, e.g. MR 18. Letters have 45° sides so they print without overhangs.",
    [["raised", "raised"], ["engraved", "engraved"], ["off", "off"]], "Fingers and depth, e.g. MR 18"),
  PRINT_GROUP("40 % or more: the bar is small, and the load goes through it."),
  STRENGTH_GROUP,
];

// Front view (as it hangs from the cord) and, to the right, a cut through the middle (thickness across).
function draw(svg, m, p) {
  const pl = m.plan, dy = m.offset.y;
  const ring = (loop) => roundedRing(loop, 0, segmentPlan(loop, 0));
  const path = (pts, X, Y) => "M" + pts.map((q) => `${X(q).toFixed(2)},${Y(q).toFixed(2)}`).join("L") + "Z";
  const fx = (q) => q.x, fy = (q) => -(q.y + dy);
  const front = [pl.outer, pl.pocket, pl.cord].map((l) => path(ring(l), fx, fy)).join(" ");
  // cut at x = 0: z across (bed on the left), y up
  const T = pl.T, top = pl.yc + pl.rc + p.cordWall, gap = 14, x0 = pl.xs + gap;
  const zs = Array.from({ length: 41 }, (_, i) => (T * i) / 40);
  const o = (z) => pl.offs(z);
  const piece = (lo, hi, from = 0) => {
    const z = zs.filter((v) => v >= from - 1e-9);
    return [...z.map((v) => ({ x: v, y: lo(v) })), ...z.slice().reverse().map((v) => ({ x: v, y: hi(v) }))];
  };
  const cut = (pts) => path(pts, (q) => x0 + q.x, (q) => -(q.y + dy));
  const yb = (z) => pl.yb + o(z)[0], yt = (z) => top - o(z)[0];
  const pLo = (z) => -pl.H / 2 - o(z)[1], pHi = (z) => pl.H / 2 + o(z)[1];
  const cLo = (z) => pl.yc - pl.rc - o(z)[2], cHi = (z) => pl.yc + pl.rc + o(z)[2];
  const pieces = [piece(cHi, yt)];
  if (pl.blind) {
    const zp = zs.filter((v) => v >= pl.F - 1e-9);
    pieces.push([
      ...zs.map((z) => ({ x: z, y: yb(z) })),
      ...zp.slice().reverse().map((z) => ({ x: z, y: pLo(z) })),
      ...zp.map((z) => ({ x: z, y: pHi(z) })),
      ...zs.slice().reverse().map((z) => ({ x: z, y: cLo(z) })),
    ]);
  } else pieces.push(piece(yb, pLo), piece(pHi, cLo));
  const yMid = -(dy + pl.yb) + 6;
  svg.setAttribute("viewBox", `${-pl.xs - 6} ${-(top + dy) - 10} ${2 * pl.xs + gap + T + 40} ${top - pl.yb + 26}`);
  svg.innerHTML = `
    <path class="part" fill-rule="evenodd" d="${front}"/>
    ${pieces.map((q) => `<path class="part" d="${cut(q)}"/>`).join("")}
    <text class="dim-text" x="0" y="${-(top + dy) - 3}" text-anchor="middle">front, as it hangs</text>
    <text class="dim-text" x="${x0 + T / 2}" y="${-(top + dy) - 3}" text-anchor="middle">cut through the middle</text>
    <text class="dim-text" x="${x0 - 1}" y="${yMid}" text-anchor="end">bed</text>
    <text class="dim-text" x="${x0 + T + 1}" y="${yMid}">top</text>
    <text class="dim-text" x="0" y="${-dy + 1.2}" text-anchor="middle">${fmt(pl.W)} × ${fmt(pl.H)}</text>
    <text class="force-text" x="0" y="${-(dy + pl.yb) + 6}" text-anchor="middle">fingers pull down on the bar ↓</text>`;
}

// Which faces each control changes (plan coordinates, see toolpage.js).
function highlight(m, p) {
  const pl = m.plan, near = (a, b) => Math.abs(a - b) <= 0.05, c = p.chamferLayers * p.layerHeight;
  // all three corners inside: the outline's long wall triangles reach past the pocket and the hole
  // distance from the pocket's rounded outline (outside it): the rim reaches this far, the outer wall
  // (side walls ≥ rim + edge rounding + 1.2) never does
  const fromPocket = (x, y) => Math.hypot(Math.max(Math.abs(x) - (pl.W / 2 - pl.rp), 0), Math.max(Math.abs(y) - (pl.H / 2 - pl.rp), 0)) - pl.rp;
  const inPocket = (t) => t.pts.every(([x, y]) => fromPocket(x, y) < pl.rim + 0.3);
  const inCord = (t) => t.pts.every(([x, y]) => Math.hypot(x, y - pl.yc) < pl.rc + pl.cordRim + 0.3);
  const wall = (t) => Math.abs(t.nz) < 0.98;
  const pocketWall = (t) => inPocket(t) && wall(t) && t.z > pl.F - 0.01;
  const floor = (t) => pl.blind && inPocket(t) && t.nz > 0.98 && near(t.z, pl.F);
  const pocketAll = (t) => pocketWall(t) || floor(t);
  const outerWall = (t) => wall(t) && !inPocket(t) && !inCord(t);
  const rounded = (t) => !inPocket(t) && !inCord(t) && Math.abs(t.nz) > 0.02 && Math.abs(t.nz) < 0.999;
  const label = (t) => (pl.labels ?? []).some((lb) => lb.contains(t.x, t.y, t.z));
  const corner = (t) => Math.abs(t.x) > pl.W / 2 - pl.rp - 0.5 && Math.abs(t.y) > pl.H / 2 - pl.rp - 0.5;
  return {
    fingerSet: pocketWall, hand: pocketWall, fitClear: pocketWall, pocketWidth: pocketWall, pocketHeight: pocketWall,
    pocketCorner: (t) => pocketWall(t) && corner(t),
    style: pocketAll, depth: pocketAll,
    rimRadius: (t) => pocketWall(t) && (t.z > pl.T - pl.rim - 0.01 || (!pl.blind && t.z < pl.rim + 0.01)),
    floorThick: floor,
    floorRound: (t) => floor(t) || (pocketWall(t) && t.z < pl.F + pl.floorR + 0.01),
    barDepth: (t) => outerWall(t) && t.y < -pl.H / 2 - p.barDepth / 2,
    sideWall: (t) => outerWall(t) && Math.abs(t.x) > pl.W / 2 + p.sideWall / 2 && t.y > pl.yb + pl.Rb && t.y < pl.H / 2,
    neck: (t) => outerWall(t) && t.y > pl.H / 2 && t.y < pl.yc,
    outerRadius: (t) => outerWall(t) && t.y < pl.yb + pl.Rb + 0.3 && Math.abs(t.x) > pl.xs - pl.Rb - 0.3,
    edgeRound: rounded,
    cordDia: (t) => wall(t) && inCord(t),
    cordWall: (t) => outerWall(t) && t.y > pl.yc - 1,
    chamferLayers: (t) => rounded(t) && t.z < c + 0.01, layerHeight: (t) => rounded(t) && t.z < c + 0.01,
    labelMode: label, labelAuto: label, labelText: label, labelSize: label, labelDepth: label,
  };
}

const SET_NAME = Object.fromEntries(FINGER_SETS);
startTool({
  store: "edgeLiftDesigner.pocket.v1",
  defaults: POCKET_DEFAULTS,
  groups: GROUPS,
  build: buildPocket,
  draw,
  highlight,
  // the front view (projected), and the cut through the middle (x = 0) to its right
  hlViews: (m) => [
    { project: ([x, y]) => [x, -(y + m.offset.y)] },
    { cut: { axis: 0, map: ([, y, z]) => [m.plan.xs + 14 + z, -(y + m.offset.y)] } },
  ],
  // the width follows the fingers
  onSet: (key, p) => (["fingerSet", "hand", "fitClear"].includes(key)
    ? { pocketWidth: fitWidth(savedHand() ?? {}, p.fingerSet, p.hand === "left" ? "L" : "R", p.fitClear) } : {}),
  rows: (m, p) => `
    <tr><td>Pocket (${SET_NAME[p.fingerSet]})</td><td class="num">${fmt(m.plan.W)} × ${fmt(m.plan.H)} mm, ${p.style === "blind" ? `${fmt(p.depth)} mm deep` : "through"}</td></tr>`,
  strengthNote: "Simple beam estimates: the fingers pull on the middle of the bar, which bends between the side walls; the side walls carry the load in tension; the cord pulls on the crown above its hole. Safety = material strength ÷ stress, aim for 2 or more. Test a print with a load you can drop safely before trusting it.",
  fileBase: (p) => `pocket_${p.fingerSet.replace(/\+/g, "-")}_${p.pocketWidth}x${p.pocketHeight}_${p.style === "blind" ? `${p.depth}mm` : "through"}_${p.hand === "left" ? "L" : "R"}`,
});
