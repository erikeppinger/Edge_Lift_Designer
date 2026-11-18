// Talon grip page: controls, drawing and results around talon.js.

import { buildTalon, TALON_DEFAULTS, TALON_SHAPES } from "./talon.js";
import { startTool, PRINT_GROUP, STRENGTH_GROUP, LABEL_GROUP, fmt } from "./toolpage.js";

const SHAPE_KEYS = Object.keys(TALON_SHAPES.talon);

const GROUPS = [
  { title: "Shape", open: true,
    note: "Hold it from above with the fingertips spread over the dome, knuckles bent and the finger joints fairly straight (the lumbricals' position); the cord runs down to the load. The steeper the side under the widest point, the harder it is to keep.",
    fields: [
    { key: "shape", label: "Start from", type: "select", options: [["talon", "talon grip (tapered)"], ["ball", "ball (printable sphere)"], ["custom", "own values"]],
      help: "Talon grip: Erik Eppinger's design, ⌀100.8 × 79.9 mm (<a href=\"https://www.printables.com/model/1391706-talon-grip-lumbrical-trainer\" target=\"_blank\" rel=\"noopener\">original on Printables</a>). Ball: a sphere whose lower part is a 40° cone, so it prints without support. Changing a value below switches to own values." },
    { key: "diameter", label: "Diameter (widest)", unit: "mm", min: 50, max: 160, step: 0.5,
      help: "The fingertips should reach a little over the widest point. Bigger = more open hand." },
    { key: "height", label: "Height", unit: "mm", min: 30, max: 150, step: 0.5 },
    { key: "taper", label: "Side taper", unit: "°", min: 0, max: 45, step: 0.5,
      help: "How much the side narrows towards the foot (from vertical). 0 = straight side, easy; 10–20 = a real claw; up to 45 still prints without support." },
    { key: "shoulderR", label: "Shoulder radius", unit: "mm", min: 5, max: 80, step: 0.5,
      help: "The dome's curve. Half the diameter gives a ball." },
    { key: "topDia", label: "Top face", unit: "⌀ mm", min: 0, max: 120, step: 0.5, help: "Flat top, where the knot pocket opens." },
  ] },
  { title: "Cord", fields: [
    { key: "holeDia", label: "Cord hole", unit: "⌀ mm", min: 4, max: 20, step: 0.5 },
    { key: "knotDia", label: "Knot pocket", unit: "⌀ mm", min: 0, max: 60, step: 0.5, help: "Hides the knot in the top. 0 = none, the knot sits on the top face." },
    { key: "knotDepth", label: "Knot pocket depth", unit: "mm", min: 5, max: 100, step: 0.5, showIf: (p) => p.knotDia > 0 },
    { key: "exitRound", label: "Rounded cord exit", unit: "mm", min: 0, max: 10, step: 0.5, help: "Where the cord leaves the foot: round, then 45° (prints without support)." },
    { key: "rimRound", label: "Rim rounding at the top", unit: "mm", min: 0, max: 5, step: 0.5 },
  ] },
  LABEL_GROUP("Engraved into the foot, at least two layers deep with wide strokes (the first layer's squish closes thin ones): you read it when you turn the grip over. The diameter and the taper, e.g. 101 T11.",
    [["engraved", "engraved in the foot"], ["off", "off"]], "Diameter and taper, e.g. 101 T11"),
  PRINT_GROUP("A grip this size needs little: 10–20 % with 4 walls."),
  STRENGTH_GROUP,
];

// The foot seen from below sits right of the section: where the label is (it reads upright there).
const footView = (m) => { const rf = m.plan.pts[1][0]; return { rf, cx: m.plan.D / 2 + 30 + rf, cy: -m.plan.H / 2 }; };

// Section through the axis, like a lathe drawing: the shape on both sides of the cord hole; and the
// foot from below.
function draw(svg, m, p) {
  const pr = m.plan, H = pr.H, R = pr.D / 2;
  const side = (s) => "M" + pr.pts.map(([r, z]) => `${(s * r).toFixed(2)},${(-z).toFixed(2)}`).join("L") + "Z";
  const dim = (x1, y1, x2, y2, text, tx, ty, anchor = "middle") =>
    `<path class="cut" d="M${x1},${y1}L${x2},${y2}"/><text class="dim-text" x="${tx}" y="${ty}" text-anchor="${anchor}">${text}</text>`;
  const zw = pr.zc; // height of the widest point
  const fv = footView(m), F = ([x, y]) => `${(fv.cx - x).toFixed(2)},${(fv.cy - y).toFixed(2)}`;
  const circle = (r) => `M${fv.cx - r},${fv.cy}a${r},${r} 0 1 0 ${2 * r},0a${r},${r} 0 1 0 ${-2 * r},0Z`;
  const letters = (pr.labels ?? []).flatMap((lb) => lb.letters.flatMap((g) => [g.hole, ...g.islands]))
    .map((ring) => "M" + ring.map((q) => F([q.x, q.y])).join("L") + "Z").join("");
  svg.setAttribute("viewBox", `${-R - 26} ${-H - 14} ${2 * R + 52 + 2 * fv.rf + 8} ${H + 26}`);
  svg.innerHTML = `
    <path class="part" d="${side(1)}"/><path class="part" d="${side(-1)}"/>
    <path class="cut" d="M0,${-H - 6}L0,6"/>
    ${dim(-R, -zw, R, -zw, `⌀ ${fmt(pr.D)}`, 0, -zw - 1.5)}
    ${dim(-pr.rb, 4, pr.rb, 4, `foot ⌀ ${fmt(2 * pr.rb)}`, 0, 9)}
    ${dim(-pr.rTop, -H - 4, pr.rTop, -H - 4, `top ⌀ ${fmt(2 * pr.rTop)}`, 0, -H - 6)}
    ${dim(R + 6, 0, R + 6, -H, `${fmt(H)}`, R + 8, -H / 2, "start")}
    <text class="dim-text" x="${-R - 2}" y="${-pr.z1 / 2}" text-anchor="end">${fmt(p.taper)}°</text>
    <text class="force-text" x="0" y="${-H - 9.5}" text-anchor="middle">fingertips over the dome ↓ · cord down to the load</text>
    <path class="part" fill-rule="evenodd" d="${circle(fv.rf)}${circle(pr.pts[0][0])}"/>
    ${letters ? `<path class="cut" fill-rule="evenodd" d="${letters}"/>` : ""}
    <text class="dim-text" x="${fv.cx}" y="${fv.cy - fv.rf - 3}" text-anchor="middle">foot, seen from below</text>`;
}

// Which faces each control changes (plan coordinates = body coordinates here, z up from the bed).
function highlight(m, p) {
  const pr = m.plan, H = pr.H, rIn = pr.rk || pr.rh, rr = p.rimRound, c = p.chamferLayers * p.layerHeight;
  const outer = (t) => t.r > rIn + rr + 0.3 && Math.abs(t.nz) < 0.999;
  const top = (t) => t.nz > 0.999 && Math.abs(t.z - H) < 0.05;
  const floorZ = pr.rk ? H - p.knotDepth : H;
  const hole = (t) => t.r < pr.rh + p.exitRound + 0.3 && Math.abs(t.nz) < 0.999 && t.z < floorZ - 0.01;
  const knot = (t) => pr.rk > 0 && t.r < pr.rk + 0.3 && t.r > pr.rh + 0.01 && t.z > floorZ - 1.1 && t.z < H - rr + 0.01;
  const label = (t) => (pr.labels ?? []).some((lb) => lb.contains(t.x, t.y, t.z));
  return {
    shape: (t) => outer(t) || top(t),
    diameter: outer, height: (t) => outer(t) || top(t),
    taper: (t) => outer(t) && t.z < pr.z1 + 0.01,
    shoulderR: (t) => outer(t) && t.z > pr.z1 - 0.01,
    topDia: top,
    holeDia: hole,
    exitRound: (t) => hole(t) && t.z < p.exitRound + 0.01,
    knotDia: knot, knotDepth: knot,
    rimRound: (t) => t.z > H - rr - 0.01 && t.r < rIn + rr + 0.3 && t.nz < 0.999,
    chamferLayers: (t) => outer(t) && t.z < c + 0.01, layerHeight: (t) => outer(t) && t.z < c + 0.01,
    labelMode: label, labelAuto: label, labelText: label, labelSize: label, labelDepth: label,
  };
}

startTool({
  store: "edgeLiftDesigner.talon.v1",
  defaults: TALON_DEFAULTS,
  groups: GROUPS,
  build: buildTalon,
  draw,
  highlight,
  // the section (the plane y = 0), and what lies on the foot in the view from below
  hlViews: (m) => { const fv = footView(m); return [
    { cut: { axis: 1, map: ([x, , z]) => [x, -z] } },
    { project: ([x, y, z]) => (z < 1.5 ? [fv.cx - x, fv.cy - y] : null) },
  ]; },
  onSet: (key, p) => {
    if (key === "shape" && TALON_SHAPES[p.shape]) return { ...TALON_SHAPES[p.shape] };
    if (SHAPE_KEYS.includes(key)) return { shape: "custom" };
    return {};
  },
  rows: (m) => `
    <tr><td>Foot on the bed</td><td class="num">⌀ ${fmt(2 * m.plan.rb)} mm</td></tr>
    <tr><td>Widest point</td><td class="num">${fmt(m.plan.zc)} mm above the bed</td></tr>`,
  strengthNote: "The knot pulls up on the floor of the knot pocket and could only punch a plug out of it: shear over the knot's circumference × the floor thickness, with printed plastic taking about 0.6 × its tensile strength in shear. The shape itself is far stronger than the cord. Safety = allowed ÷ actual stress, aim for 2 or more.",
  fileBase: (p) => `talon-grip_${p.diameter}x${p.height}_taper-${p.taper}`,
});
