import { FINGERS, key as handKey, sideOf, otherHand } from "./hand.js";
import { DEFAULTS } from "./frame.js";
import { buildModel, printSettings } from "./model.js";
import { stl, threeMfPrusa, threeMfBambu, threeMfOrca } from "./export.js";
import { BAMBU_PRESETS } from "./bambu-presets.js";
import { ICONS } from "./icons.js";
import { highlightTriangles } from "./highlight.js";
import { roundedRing, segmentPlan } from "./geom2d.js";
import { createViewer } from "./viewer.js";
import { setupPhotoDialog } from "./photo.js";

const STORE = "edgeLiftDesigner.params.v6";

const PATTERNS = [["gyroid", "gyroid"], ["cubic", "cubic"], ["grid", "grid"], ["rectilinear", "rectilinear"], ["honeycomb", "honeycomb"]];

// Control panel definition. type: num (slider + box), select, check, fingers.
const GROUPS = [
  { title: "Hand", open: true, fields: [
    { key: "hands", label: "Hands", type: "select", options: [[1, "one hand: one stepped edge"], [2, "both hands: a stepped edge each"]],
      help: "Both hands: the second edge is opposite the first, fitted to the other hand; turn the plate end over end to use it." },
    { key: "hand", label: "Which hand", type: "select", options: [["right", "right"], ["left", "left"]],
      help: "With both hands: the hand on the top edge." },
    { key: "fingersR", type: "fingers", side: "R", title: "Right hand", photo: true, showIf: (p) => p.hands === 2 || p.hand === "right",
      help: "P1: proximal phalanx, knuckle (MCP) to middle joint (PIP). Width: the finger at its end joint (DIP). Knuckle: how far this finger's knuckle sits towards the fingertips compared with the middle finger's (usually negative for the little finger)." },
    { key: "fingersL", type: "fingers", side: "L", title: "Left hand", photo: true, showIf: (p) => p.hands === 2 || p.hand === "left",
      help: "Same measurements for the left hand." },
    { key: "unlevel", label: "Unlevel edge (height per finger)", type: "check" },
    { key: "stepScale", label: "Step strength", unit: "× P1 difference", min: 0, max: 1.5, step: 0.05, showIf: (p) => p.unlevel,
      help: "1 = the full length difference becomes edge height." },
    { key: "sideMargin", label: "Extra width each side", unit: "mm", min: 0, max: 20, step: 0.5 },
  ] },
  { title: "Edge", open: true, fields: [
    { key: "edgeDepth", label: "Edge depth", unit: "mm", min: 8, max: 35, step: 0.5,
      help: "Depth of the pocket = how deep the fingers sit. The Ergo Block comes in 12, 16, 20 and 24 mm." },
    { key: "floorThick", label: "Floor", unit: "mm", min: 1.5, max: 8, step: 0.5,
      help: "Closes the pocket at the bed and stops the fingertips. Plate = edge depth + floor (Ergo Block: 3 mm)." },
    { key: "edgeRadius", label: "Front radius", unit: "mm", min: 0, max: 10, step: 0.5, help: "The pocket's top rim, where the fingers wrap around." },
    { key: "floorFillet", label: "Floor fillet", unit: "mm", min: 0, max: 5, step: 0.5, help: "45° where the pocket wall meets the floor." },
    { key: "stepAngle", label: "Step wall angle", unit: "°", min: 45, max: 90, step: 1, help: "Steepness of the steps between fingers; 80–90° is a clear step." },
    { key: "stepRadius", label: "Step corner radius", unit: "mm", min: 0, max: 6, step: 0.5 },
    { key: "windowHeight", label: "Pocket height", unit: "mm", min: 15, max: 60, step: 0.5, help: "Room for the fingers, at the middle finger." },
    { key: "windowRadius", label: "Pocket corner radius", unit: "mm", min: 0.5, max: 12, step: 0.5 },
  ] },
  { title: "Frame", fields: [
    { key: "barThick", label: "Edge bar depth", unit: "mm", min: 8, max: 40, step: 0.5, help: "Top and bottom bar at their thinnest (the highest step)." },
    { key: "sideBar", label: "Side bars", unit: "mm", min: 10, max: 40, step: 0.5, help: "Hold the cord holes." },
    { key: "bow", label: "Bowed bar edge", unit: "mm", min: -15, max: 15, step: 0.5,
      help: "Curve of the edge bar's outer edge in the middle: + bulges out (following the knuckle arch in a half crimp), − curves in, 0 = straight." },
    { key: "outerRadius", label: "Outer corner radius", unit: "mm", min: 0.5, max: 20, step: 0.5, help: "The cord wraps around the sides: keep it round." },
  ] },
  { title: "Cord", fields: [
    { key: "slotShape", label: "Hole shape", type: "select",
      options: [["auto", "auto (teardrop with one edge, lens with two)"], ["teardrop", "teardrop (one-sided)"], ["lens", "lens (two-sided)"], ["plain", "plain rounded slot"]],
      help: "Teardrop: the narrow end points to the load, the cord jams there. Lens: pointed at both ends, for a plate used either way up." },
    { key: "cordDia", label: "Cord diameter", unit: "mm", min: 3, max: 12, step: 0.5 },
    { key: "slotLength", label: "Hole length", unit: "mm", min: 12, max: 60, step: 0.5 },
    { key: "holeX", label: "Hole position across", unit: "mm", min: -6, max: 6, step: 0.5,
      help: "Moves both holes across the side bar: + towards the outer edge, − towards the pocket. 0 = centred in the material." },
    { key: "holeY", label: "Hole position along", unit: "mm", min: -25, max: 25, step: 0.5,
      help: "Moves both holes along the side bar: + towards the top edge, − towards the bottom. 0 = level with the pocket's middle." },
    { key: "cordExit", label: "Rounded cord exit", unit: "mm", min: 0, max: 6, step: 0.5,
      help: "Extra rounding where the cord bends out of the hole towards the load, fading out towards the other end: easier on the cord, no sharp edge to crack from. The walls inside stay straight, so the cord still jams. Round on the top face, 45° on the bed face (prints without support). 0 = off." },
  ] },
  { title: "Printing", open: true,
    note: "These are slicer settings: they go into the 3MF files (the STL ignores them) and into the filament estimate. Only layer height × chamfer layers changes the model itself (the chamfer size).",
    fields: [
    { key: "nozzle", label: "Nozzle", unit: "mm", min: 0.2, max: 1.2, step: 0.05, help: "Changing it suggests a layer height of half the nozzle." },
    { key: "layerHeight", label: "Layer height", unit: "mm", min: 0.05, max: 0.6, step: 0.01,
      help: "Also sets the chamfer size: chamfer = layers × layer height, at the top face and at the bed (the bed chamfer is underneath, so the view shows the top one)." },
    { key: "chamferLayers", label: "Chamfer", unit: "layers", min: 0, max: 8, step: 1,
      help: "45° on the outside and the cord holes, both faces: against elephant foot and top-layer shrink." },
    { key: "walls", label: "Walls (perimeters)", unit: "", min: 2, max: 12, step: 1,
      help: "PrusaSlicer calls them perimeters, Bambu Studio and OrcaSlicer wall loops." },
    { key: "infill", label: "Infill", unit: "%", min: 5, max: 100, step: 5 },
    { key: "infillPattern", label: "Infill pattern", type: "select", options: PATTERNS },
    { key: "topBottomLayers", label: "Top/bottom layers", unit: "", min: 2, max: 12, step: 1 },
    { key: "denseZones", label: "Denser infill in the edge bars (3MF modifiers)", type: "check" },
    { key: "zoneInfill", label: "Zone infill", unit: "%", min: 10, max: 100, step: 5, showIf: (p) => p.denseZones },
    { key: "zonePattern", label: "Zone pattern", type: "select", options: PATTERNS, showIf: (p) => p.denseZones },
  ] },
  { title: "Strength check", fields: [
    { key: "loadKg", label: "Heaviest pull", unit: "kg", min: 10, max: 250, step: 5 },
    { key: "strengthMPa", label: "Material strength", unit: "MPa", min: 10, max: 80, step: 1,
      help: "Printed PLA, load along the layers: about 30–45 MPa. PETG about 25–35." },
  ] },
];

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) ?? "null");
    if (saved && typeof saved === "object") {
      const out = { ...DEFAULTS };
      for (const k of Object.keys(DEFAULTS)) if (k in saved && typeof saved[k] === typeof DEFAULTS[k]) out[k] = saved[k];
      return out;
    }
  } catch { /* storage unavailable */ }
  return { ...DEFAULTS };
}
function save(p) {
  try { localStorage.setItem(STORE, JSON.stringify(p)); } catch { /* storage unavailable */ }
}

let params = load();
const fieldEls = {};

function buildControls(root, photo) {
  for (const g of GROUPS) {
    const fs = document.createElement("fieldset");
    const det = document.createElement("details");
    det.open = g.open || window.innerWidth > 820;
    det.innerHTML = `<summary>${g.title}</summary>${g.note ? `<p class="note group-note">${g.note}</p>` : ""}`;
    fs.append(det);
    for (const f of g.fields) {
      const row = document.createElement("div");
      row.className = "field" + (f.type === "check" ? " check" : "");
      const id = `f-${f.key}`;
      if (f.type === "fingers") {
        row.className = "field fingers";
        const cols = [["p1", "P1 mm", 20, 60, 0.5], ["w", "Width mm", 10, 30, 0.5], ["k", "Knuckle mm", -20, 10, 0.5]];
        const cell = (fi, [pre, , mn, mx, st]) => {
          const key = handKey(pre, fi, f.side);
          return `<td><input type="number" data-key="${key}" min="${mn}" max="${mx}" step="${st}" aria-label="${fi} ${pre}"></td>`;
        };
        row.innerHTML = `<table class="finger-table"><caption>${f.title}</caption><tr><th></th>${cols.map((c) => `<th>${c[1]}</th>`).join("")}</tr>${
          FINGERS.map((fi) => `<tr><th>${fi}</th>${cols.map((c) => cell(fi, c)).join("")}</tr>`).join("")}</table>`;
        for (const inp of row.querySelectorAll("input")) {
          inp.value = params[inp.dataset.key];
          inp.addEventListener("change", () => {
            const v = Number(inp.value);
            if (inp.value !== "" && Number.isFinite(v)) set(inp.dataset.key, Math.min(Number(inp.max), Math.max(Number(inp.min), v)));
            else inp.value = params[inp.dataset.key];
          });
        }
      } else if (f.type === "select") {
        row.innerHTML = `<label for="${id}">${f.label}</label><select id="${id}"></select>`;
        const sel = row.querySelector("select");
        for (const [v, t] of f.options) sel.add(new Option(t, String(v)));
        sel.value = String(params[f.key]);
        sel.addEventListener("change", () => set(f.key, typeof DEFAULTS[f.key] === "number" ? Number(sel.value) : sel.value));
      } else if (f.type === "check") {
        row.innerHTML = `<input type="checkbox" id="${id}"><label for="${id}">${f.label}</label>`;
        const cb = row.querySelector("input");
        cb.checked = params[f.key];
        cb.addEventListener("change", () => set(f.key, cb.checked));
      } else {
        const unit = f.unit ? ` <span class="hint">${f.unit}</span>` : "";
        row.innerHTML = `<label for="${id}">${f.label}${unit}</label>
          <input type="number" id="${id}" min="${f.min}" max="${f.max}" step="${f.step}">
          <input type="range" min="${f.min}" max="${f.max}" step="${f.step}" aria-label="${f.label}">`;
        const [box, slider] = row.querySelectorAll("input");
        box.value = slider.value = params[f.key];
        box.addEventListener("change", () => {
          const v = Math.min(f.max, Math.max(f.min, Number(box.value)));
          if (box.value !== "" && Number.isFinite(v)) set(f.key, v); else box.value = params[f.key];
        });
        slider.addEventListener("input", () => set(f.key, Number(slider.value)));
      }
      if (ICONS[f.key]) {
        const target = row.querySelector("label") ?? row;
        target.insertAdjacentHTML("afterbegin", `<span class="ico">${ICONS[f.key]}</span>`);
      }
      if (f.help) row.insertAdjacentHTML("beforeend", `<div class="help">${f.help}</div>`);
      if (f.photo) {
        const b = document.createElement("button");
        b.type = "button"; b.className = "secondary"; b.textContent = "Measure from a photo";
        b.style.gridColumn = "1 / -1";
        b.addEventListener("click", photo.open);
        row.append(b);
      }
      det.append(row);
      fieldEls[f.key] = { row, f };
      row.addEventListener("mouseenter", () => showHighlight(f.key));
      row.addEventListener("focusin", () => showHighlight(f.key));
      row.addEventListener("input", () => showHighlight(f.key));
      row.addEventListener("mouseleave", () => clearHighlight(row));
      row.addEventListener("focusout", () => clearHighlight(row));
    }
    root.append(fs);
  }
  const reset = document.createElement("button");
  reset.className = "secondary"; reset.textContent = "Reset to defaults";
  reset.addEventListener("click", () => { params = { ...DEFAULTS }; syncControls(); refresh(); });
  root.append(reset);
}

function syncControls() {
  for (const { row, f } of Object.values(fieldEls)) {
    row.hidden = f.showIf ? !f.showIf(params) : false;
    for (const el of row.querySelectorAll("input, select")) {
      const key = el.dataset.key ?? f.key;
      if (el.type === "checkbox") el.checked = params[key];
      else if (document.activeElement !== el) el.value = String(params[key]);
    }
  }
}

function set(key, value) {
  params = { ...params, [key]: value };
  if (key === "nozzle") params.layerHeight = Math.round(value * 50) / 100; // half the nozzle
  syncControls();
  refresh();
}

// ---- drawings ----
// The plate as held for a lift: the fingers go into the pocket and press up on the top edge.
// Seen from the palm side, so x runs right to left.
function drawPlate(svg, m) {
  const pl = m.plan;
  const W = pl.size.x, pad = 10;
  const X = (x) => pl.Ww + pl.sb - x; // mirror
  const Y = (y) => -y;
  svg.setAttribute("viewBox", `${-pad} ${-pl.yMax - pad - 8} ${W + 2 * pad} ${pl.yMax - pl.yMin + 2 * pad + 8}`);
  const ringPath = (loop) => {
    const r = roundedRing(loop, 0, segmentPlan(loop, 0));
    return "M" + r.map((q) => `${X(q.x).toFixed(2)},${Y(q.y).toFixed(2)}`).join("L") + "Z";
  };
  const labels = pl.segs.filter((s) => s.finger).map((s) => {
    const xm = X((s.x0 + s.x1) / 2), yt = Y(pl.yTop(s));
    return `<text class="dim-text" x="${xm}" y="${yt + 5}" text-anchor="middle">${s.name}</text>
      <text class="dim-text" x="${xm}" y="${yt + 9}" text-anchor="middle">${s.h > 0 ? "+" : ""}${s.h.toFixed(1)}</text>`;
  }).join("");
  const botLabels = pl.two ? pl.botSegs.filter((s) => s.finger).map((s) => {
    const xm = X((s.x0 + s.x1) / 2), yb = Y(pl.yBot(s));
    return `<text class="dim-text" x="${xm}" y="${yb - 6}" text-anchor="middle">${s.name}</text>
      <text class="dim-text" x="${xm}" y="${yb - 2}" text-anchor="middle">${s.h > 0 ? "+" : ""}${s.h.toFixed(1)}</text>`;
  }).join("") : "";
  const who = `${params.hand} hand`;
  const other = pl.two ? ` · bottom edge: ${otherHand(params.hand)} hand (turn the plate end over end)` : "";
  const mid = pl.yTop(pl.segs.find((s) => s.name === "middle")) / 2; // label height in the pocket
  svg.innerHTML = `
    <path class="part" fill-rule="evenodd" d="${pl.loops.map(ringPath).join(" ")}"/>
    ${labels}
    ${botLabels}
    <text class="dim-text" x="${W / 2}" y="${Y(pl.yMax) - 3}" text-anchor="middle">top edge: ${who}, step per finger in mm (0 = middle finger)${other}</text>
    <text class="force-text" x="${X(pl.Ww / 2)}" y="${Y(mid)}" text-anchor="middle">fingers press up here ↑</text>
    <clipPath id="plateClip"><path fill-rule="evenodd" clip-rule="evenodd" d="${pl.loops.map(ringPath).join(" ")}"/></clipPath>
    <path id="plateHl" class="hl" d=""/>
    <g id="plateHlRegions" clip-path="url(#plateClip)"></g>`;
}

// Cut through the edge bar and the pocket floor at the middle finger: thickness across (bed left),
// up = towards the outside of the bar. The pocket is on the right of the wall, open to the top face.
function drawSection(svg, m) {
  const pl = m.plan, T = pl.T, F = pl.F;
  const mid = pl.segs.find((s) => s.name === "middle");
  const y0 = pl.yTop(mid), y1 = pl.yOuterTop, yIn = y0 - 14; // show 14 mm of the pocket floor
  const W = pl.profiles.wall, O = pl.profiles.outer, n = 60, pts = [];
  pts.push([O.off(0), yIn], [F, yIn]);
  for (let i = 0; i <= n; i++) { const z = F + ((T - F) * i) / n; pts.push([z, y0 + W.off(z)]); }
  for (let i = n; i >= 0; i--) { const z = (T * i) / n; pts.push([z, y1 - O.off(z)]); }
  const pad = 8;
  svg.setAttribute("viewBox", `${-pad - 16} ${-y1 - pad} ${T + 2 * pad + 32} ${y1 - yIn + 2 * pad + 8}`);
  const path = "M" + pts.map(([z, y]) => `${z.toFixed(2)},${(-y).toFixed(2)}`).join("L") + "Z";
  svg.innerHTML = `
    <path class="part" d="${path}"/>
    <text class="dim-text" x="${(F + T) / 2}" y="${-yIn + 6}" text-anchor="middle">pocket ${fmt(pl.d, 1)} mm deep · floor ${fmt(F, 1)} mm</text>
    <text class="dim-text" x="-2" y="${-yIn}" text-anchor="end">bed</text>
    <text class="dim-text" x="${T + 2}" y="${-yIn}">top (open)</text>`;
}

function fmt(x, n = 1) { return x.toLocaleString(undefined, { maximumFractionDigits: n, minimumFractionDigits: n }); }

function drawResults(el, m) {
  const s = m.strength;
  const cls = (sf) => (sf >= 2 ? "good" : sf >= 1.3 ? "warnc" : "bad");
  const rows = s.sections.map((x) => `<tr><td>${x.name}</td><td class="num">${fmt(x.stress)}</td><td class="num ${cls(x.safety)}">${fmt(x.safety)}</td></tr>`).join("");
  const warn = [...m.warnings];
  if (m.stats.badEdges) warn.push(`Mesh check: ${m.stats.badEdges} open edges — please report this combination.`);
  if (s.worst.safety < 1.3) warn.push("Safety factor under 1.3: deepen the edge bar, thicken the plate, or lower the load.");
  el.innerHTML = `
    <div class="results-grid">
      <div>
        <h2>Part</h2>
        <table>
          <tr><td>Size on the bed</td><td class="num">${fmt(m.size.x)} × ${fmt(m.size.y)} mm</td></tr>
          <tr><td>Plate thickness</td><td class="num">${fmt(m.size.z)} mm</td></tr>
          <tr><td>Volume</td><td class="num">${fmt(m.stats.volume / 1000)} cm³</td></tr>
          <tr><td>Filament, estimate (PLA, 1.75 mm)</td><td class="num">≈ ${fmt(m.filament.grams, 0)} g · ${fmt(m.filament.metres, 1)} m</td></tr>
          <tr><td>Chamfer (both faces)</td><td class="num">${fmt(params.chamferLayers * params.layerHeight, 2)} mm</td></tr>
          <tr><td>Mesh</td><td class="num ${m.stats.badEdges ? "bad" : "good"}">${m.stats.triangles} triangles, ${m.stats.badEdges ? "not closed" : "closed"}</td></tr>
        </table>
      </div>
      <div>
        <h2>Strength at ${params.loadKg} kg</h2>
        <table>
          <tr><th>Section</th><th class="num">MPa</th><th class="num">Safety</th></tr>
          ${rows}
        </table>
        <p class="note">Simple beam estimate: the cords hold the plate at its side bars, the fingers pull in
          the middle of the top bar, so it bends like a beam between the cord holes (span ${fmt(s.span, 0)} mm, taken as simply
          supported, which is on the safe side). Safety = material strength ÷ stress: 1 means it breaks at this load,
          aim for 2 or more. Real peaks depend on walls, infill and layer bonding;
          test a print with a load you can drop safely before trusting it.</p>
      </div>
    </div>
    ${warn.length ? `<ul class="warnings">${warn.map((w) => `<li>${w}</li>`).join("")}</ul>` : ""}`;
}

// ---- highlight: the faces a control changes, in the 3D view and on the plate drawing ----
let hlKey = null, hlTimer = 0;
function showHighlight(key) {
  clearTimeout(hlTimer);
  hlKey = key;
  renderHighlight();
}
function clearHighlight(row) {
  clearTimeout(hlTimer);
  hlTimer = setTimeout(() => {
    if (row.matches(":hover") || row.contains(document.activeElement)) return;
    hlKey = null;
    renderHighlight();
  }, 250);
}
function renderHighlight() {
  const layer = document.getElementById("plateHl");
  const regionLayer = document.getElementById("plateHlRegions");
  if (regionLayer) regionLayer.innerHTML = "";
  const hl = current && hlKey ? highlightTriangles(current, params, hlKey) : null;
  viewer.setHighlight(hl);
  if (!layer) return;
  if (!hl) { layer.setAttribute("d", ""); return; }
  // Project onto the plate drawing (same mirror as drawPlate): faces become areas, walls lines.
  const pl = current.plan, X = (x) => pl.Ww + pl.sb - x, P = hl.positions;
  if (hl.planRegions) {
    // areas: boxes clipped to the plate face, like the 3D view
    const big = 1e3;
    regionLayer.innerHTML = hl.planRegions.map(([x0, x1, y0, y1]) => {
      const xa = X(Math.min(Math.max(x1, -big), big)), xb = X(Math.min(Math.max(x0, -big), big));
      const ya = -Math.min(Math.max(y1, -big), big), yb = -Math.min(Math.max(y0, -big), big);
      return `<rect class="hl" x="${Math.min(xa, xb)}" y="${Math.min(ya, yb)}" width="${Math.abs(xb - xa)}" height="${Math.abs(yb - ya)}"/>`;
    }).join("");
    layer.setAttribute("d", "");
    return;
  }
  // Seen from above, walls are thin bands: draw a wall selection as its top outline (one line per
  // edge at the selection's highest level) instead of thousands of sliver triangles. Flat faces
  // (floor, top face) stay filled triangles.
  const pt = (i) => `${X(P[i] - hl.offset.x).toFixed(1)},${(-(P[i + 1] - hl.offset.y)).toFixed(1)}`;
  // the highest level that holds a real share of the selection (a few stray vertices don't count)
  const perZ = new Map();
  for (let i = 2; i < P.length; i += 3) { const z = Math.round(P[i] * 1e4); perZ.set(z, (perZ.get(z) ?? 0) + 1); }
  const enough = Math.max(20, 0.05 * (P.length / 3));
  const zKey = [...perZ].filter(([, n]) => n >= enough).map(([z]) => z).sort((x, y) => y - x)[0];
  const zTop = zKey === undefined ? Infinity : zKey / 1e4;
  const seen = new Set();
  let d = "";
  for (let i = 0; i < P.length; i += 9) {
    const ux = P[i + 3] - P[i], uy = P[i + 4] - P[i + 1], vx = P[i + 6] - P[i], vy = P[i + 7] - P[i + 1];
    const uz = P[i + 5] - P[i + 2], vz = P[i + 8] - P[i + 2];
    const nz = ux * vy - uy * vx, nl = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, nz) || 1;
    if (Math.abs(nz) / nl > 0.999) { d += `M${pt(i)}L${pt(i + 3)}L${pt(i + 6)}Z`; continue; } // truly flat face
    for (const [a1, b1] of [[i, i + 3], [i + 3, i + 6], [i + 6, i]]) {
      if (Math.abs(P[a1 + 2] - zTop) > 1e-4 || Math.abs(P[b1 + 2] - zTop) > 1e-4) continue;
      const [p, q] = [pt(a1), pt(b1)].sort();
      const k = `M${p}L${q}`;
      if (!seen.has(k)) { seen.add(k); d += k; }
    }
  }
  layer.setAttribute("d", d);
}

// ---- export ----
let current = null;
function fileBase() {
  const p = params;
  const who = p.hands === 2 ? "2h" : p.hand === "left" ? "L" : "R";
  return `edge-lift_${p.edgeDepth}mm_${p.unlevel ? "unlevel" : "level"}_${who}`;
}
function download(bytes, name, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
function exportOpts() {
  return { name: fileBase(), body: current.body, modifier: current.modifier, settings: printSettings(params), place: [100, 100] };
}
// The Bambu preset set for the chosen printer, at the available nozzle closest to the app's nozzle.
function bambuPresets() {
  const byNozzle = BAMBU_PRESETS[params.bambuPrinter] ?? Object.values(BAMBU_PRESETS)[0];
  const nozzle = Object.keys(byNozzle).sort((x, y) => Math.abs(x - params.nozzle) - Math.abs(y - params.nozzle))[0];
  return { model: params.bambuPrinter, nozzle, ...byNozzle[nozzle] };
}

// ---- layout ----
const LAYOUT_KEY = "edgeLiftDesigner.layout";
function applyLayout() {
  let pick = "auto";
  try { pick = localStorage.getItem(LAYOUT_KEY) ?? "auto"; } catch { /* storage unavailable */ }
  document.getElementById("layoutPick").value = pick;
  const cols = pick === "cols" || (pick === "auto" && window.innerWidth >= 1000);
  const main = document.querySelector("main");
  main.classList.toggle("cols", cols);
  main.classList.toggle("rows", !cols);
}
document.getElementById("layoutPick").addEventListener("change", (e) => {
  try { localStorage.setItem(LAYOUT_KEY, e.target.value); } catch { /* storage unavailable */ }
  applyLayout();
});
window.addEventListener("resize", applyLayout);
applyLayout();

// ---- main ----
const viewer = createViewer(document.getElementById("view3d"));
// The photo dialog reports values without a hand suffix (p1Index …) and which hand it measured.
const photo = setupPhotoDialog({
  defaultSide: () => sideOf(params.hand),
  onUse: (values, side) => {
    const withSide = Object.fromEntries(Object.entries(values).map(([k, v]) => [k + side, v]));
    params = { ...params, ...withSide };
    if (params.hands === 1 && sideOf(params.hand) !== side) params.hand = side === "L" ? "left" : "right";
    syncControls(); refresh();
  },
});
buildControls(document.getElementById("controls"), photo);
syncControls();

let pending = 0;
function refresh() {
  save(params);
  clearTimeout(pending);
  pending = setTimeout(() => { // a timer, not a frame callback: it also runs while the window is in the background
    const status = document.getElementById("plateStatus");
    try {
      current = buildModel(params);
    } catch (err) {
      // Keep the last valid model on screen, greyed out, and say clearly why the new one fails.
      document.getElementById("stage").classList.add("stale");
      status.innerHTML = `<p class="bad"><b>These settings can't be built:</b> ${err.message}. The plate and 3D view still show the last valid version; exports use it too.</p>`;
      document.getElementById("results").innerHTML = `<ul class="warnings"><li>These settings do not give a valid shape: ${err.message}</li></ul>`;
      return;
    }
    document.getElementById("stage").classList.remove("stale");
    const w = [...current.warnings];
    if (current.strength.worst.safety < 2) w.push(`Safety factor ${current.strength.worst.safety.toFixed(1)} at ${params.loadKg} kg (aim for 2 or more, see Strength).`);
    status.innerHTML = w.length ? `<ul class="warnings">${w.map((s) => `<li>${s}</li>`).join("")}</ul>` : "";
    drawPlate(document.getElementById("plate"), current);
    drawSection(document.getElementById("section"), current);
    viewer.setMeshes(current.body, current.modifier, current.size);
    drawResults(document.getElementById("results"), current);
    renderHighlight();
  });
}

document.getElementById("showZones").addEventListener("change", (e) => viewer.setShowZones(e.target.checked));
// Exports need a model: if not even the first build worked there is nothing to export.
const needModel = (fn) => () => {
  if (!current) { document.getElementById("plateStatus").innerHTML = `<p class="bad">Nothing to export yet: these settings can't be built (see above).</p>`; return; }
  fn();
};
document.getElementById("dlStl").addEventListener("click", needModel(() => download(stl(current.body, fileBase()), `${fileBase()}.stl`, "model/stl")));
document.getElementById("dlPrusa").addEventListener("click", needModel(() => download(threeMfPrusa(exportOpts()), `${fileBase()}_prusaslicer.3mf`, "model/3mf")));
document.getElementById("dlBambu").addEventListener("click", needModel(() => download(threeMfBambu({ ...exportOpts(), presets: bambuPresets() }), `${fileBase()}_bambu.3mf`, "model/3mf")));
document.getElementById("dlOrca").addEventListener("click", needModel(() => download(threeMfOrca(exportOpts()), `${fileBase()}_orca.3mf`, "model/3mf")));
const bp = document.getElementById("bambuPrinter");
for (const m of Object.keys(BAMBU_PRESETS)) bp.add(new Option(m.replace("Bambu Lab ", ""), m));
bp.value = params.bambuPrinter;
bp.addEventListener("change", () => { params = { ...params, bambuPrinter: bp.value }; save(params); });

refresh();
