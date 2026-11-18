// The page around one of the smaller tools (finger pocket, talon grip): control panel, drawing, 3D
// view, results and exports. The tool brings its parameters, controls, mesh builder and drawing.
//
// tool = { store, defaults, groups, build(p) → model, draw(svg, model, p), rows(model, p) → html,
//          fileBase(p) → string, onSet?(key, p) → patch,
//          highlight(model, p) → { key: predicate(triangle) }, hlViews(model) → views }
// Highlights: hovering a control shows the faces it changes in the accent colour, in the 3D view
// and on the drawing. A triangle comes as { x, y, z, r, nx, ny, nz, pts } (the middle of its extent
// in the tool's plan coordinates = body − model.offset, its normal, its three corners). Drawing views: { project(v) → [sx, sy] or null } fills the
// triangles projected flat; { cut: { axis, map(v) → [sx, sy] } } draws where they cross the plane
// axis = 0 (v: a corner in plan coordinates, [x, y, z]).
// model = { body, size, stats, filament, strength: { sections, worst }, warnings }

import { stl, threeMfPrusa, threeMfBambu, threeMfOrca } from "./export.js";
import { printSettings } from "./model.js";
import { BAMBU_PRESETS } from "./bambu-presets.js";
import { createViewer } from "./viewer.js";

const PATTERNS = [["gyroid", "gyroid"], ["cubic", "cubic"], ["grid", "grid"], ["rectilinear", "rectilinear"], ["honeycomb", "honeycomb"]];

export const PRINT_GROUP = (infillHelp) => ({ title: "Printing",
  note: "Slicer settings: they go into the 3MF files (the STL ignores them) and into the filament estimate. Only layer height × chamfer layers changes the model (the smallest edge rounding at the bed).",
  fields: [
    { key: "nozzle", label: "Nozzle", unit: "mm", min: 0.2, max: 1.2, step: 0.05, help: "Changing it suggests a layer height of half the nozzle." },
    { key: "layerHeight", label: "Layer height", unit: "mm", min: 0.05, max: 0.6, step: 0.01 },
    { key: "chamferLayers", label: "Chamfer", unit: "layers", min: 0, max: 8, step: 1, help: "Smallest rounding at the bed, against elephant foot." },
    { key: "walls", label: "Walls (perimeters)", unit: "", min: 2, max: 12, step: 1 },
    { key: "infill", label: "Infill", unit: "%", min: 5, max: 100, step: 5, help: infillHelp },
    { key: "infillPattern", label: "Infill pattern", type: "select", options: PATTERNS },
    { key: "topBottomLayers", label: "Top/bottom layers", unit: "", min: 2, max: 12, step: 1 },
  ] });

export const STRENGTH_GROUP = { title: "Strength check", fields: [
  { key: "loadKg", label: "Heaviest pull", unit: "kg", min: 5, max: 200, step: 5 },
  { key: "strengthMPa", label: "Material strength", unit: "MPa", min: 10, max: 80, step: 1,
    help: "Printed PLA, load along the layers: about 30–45 MPa. PETG about 25–35." },
] };

export const fmt = (x, n = 1) => x.toLocaleString(undefined, { maximumFractionDigits: n, minimumFractionDigits: n });

export const LABEL_GROUP = (note, modes, autoLabel) => ({ title: "Label", note, fields: [
  { key: "labelMode", label: "Label", type: "select", options: modes },
  { key: "labelAuto", label: autoLabel, type: "check", showIf: (p) => p.labelMode !== "off" },
  { key: "labelText", label: "Own text", type: "text", maxLength: 16, placeholder: "e.g. a name", showIf: (p) => p.labelMode !== "off",
    help: "Added after the size. Letters A–Z, digits and - + . / (other characters are left out)." },
  { key: "labelSize", label: "Letter height", unit: "mm", min: 3, max: 16, step: 0.5, showIf: (p) => p.labelMode !== "off",
    help: "Made smaller automatically if there is not enough room." },
  { key: "labelDepth", label: "Relief", unit: "mm", min: 0.2, max: 1.5, step: 0.1, showIf: (p) => p.labelMode !== "off",
    help: "How far the letters stand out (raised) or are cut in (engraved)." },
] });

export function startTool(tool) {
  const { defaults } = tool;
  let params = load();
  let current = null;
  const fieldEls = [];

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(tool.store) ?? "null");
      if (saved && typeof saved === "object") {
        const out = { ...defaults };
        for (const k of Object.keys(defaults)) if (k in saved && typeof saved[k] === typeof defaults[k]) out[k] = saved[k];
        return out;
      }
    } catch { /* storage unavailable */ }
    return { ...defaults };
  }
  const save = () => { try { localStorage.setItem(tool.store, JSON.stringify(params)); } catch { /* storage unavailable */ } };

  function set(key, value) {
    params = { ...params, [key]: value };
    if (key === "nozzle") params.layerHeight = Math.round(value * 50) / 100;
    if (tool.onSet) params = { ...params, ...tool.onSet(key, params) };
    sync();
    refresh();
  }
  const patch = (values) => { params = { ...params, ...values }; sync(); refresh(); };

  // ---- controls: num (box + slider), select, check, action (a button that patches the parameters)
  function buildControls(root) {
    for (const g of tool.groups) {
      const fs = document.createElement("fieldset");
      const det = document.createElement("details");
      det.open = g.open || window.innerWidth > 820;
      det.innerHTML = `<summary>${g.title}</summary>${g.note ? `<p class="note group-note">${g.note}</p>` : ""}`;
      fs.append(det);
      for (const f of g.fields) {
        const row = document.createElement("div");
        row.className = "field" + (f.type === "check" ? " check" : f.type === "select" ? " sel" : "");
        const id = `f-${f.key}`;
        if (f.type === "select") {
          row.innerHTML = `<label for="${id}">${f.label}</label><select id="${id}"></select>`;
          const sel = row.querySelector("select");
          for (const [v, t] of f.options) sel.add(new Option(t, String(v)));
          sel.addEventListener("change", () => set(f.key, typeof defaults[f.key] === "number" ? Number(sel.value) : sel.value));
        } else if (f.type === "check") {
          row.innerHTML = `<input type="checkbox" id="${id}"><label for="${id}">${f.label}</label>`;
          row.querySelector("input").addEventListener("change", (e) => set(f.key, e.target.checked));
        } else if (f.type === "text") {
          row.innerHTML = `<label for="${id}">${f.label}</label><input type="text" id="${id}" maxlength="${f.maxLength ?? 32}" placeholder="${f.placeholder ?? ""}" autocomplete="off" spellcheck="false">`;
          row.querySelector("input").addEventListener("input", (e) => set(f.key, e.target.value));
        } else if (f.type === "action") {
          row.innerHTML = `<button type="button" class="secondary" style="grid-column: 1 / -1">${f.label}</button>`;
          row.querySelector("button").addEventListener("click", () => patch(f.run(params)));
        } else {
          const unit = f.unit ? ` <span class="hint">${f.unit}</span>` : "";
          row.innerHTML = `<label for="${id}">${f.label}${unit}</label>
            <input type="number" id="${id}" min="${f.min}" max="${f.max}" step="${f.step}">
            <input type="range" min="${f.min}" max="${f.max}" step="${f.step}" aria-label="${f.label}">`;
          const [box, slider] = row.querySelectorAll("input");
          box.addEventListener("change", () => {
            const v = Math.min(f.max, Math.max(f.min, Number(box.value)));
            if (box.value !== "" && Number.isFinite(v)) set(f.key, v); else box.value = params[f.key];
          });
          slider.addEventListener("input", () => set(f.key, Number(slider.value)));
        }
        if (f.help) row.insertAdjacentHTML("beforeend", `<div class="help">${f.help}</div>`);
        det.append(row);
        fieldEls.push({ row, f });
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
    reset.addEventListener("click", () => patch({ ...defaults }));
    root.append(reset);
  }
  function sync() {
    for (const { row, f } of fieldEls) {
      row.hidden = f.showIf ? !f.showIf(params) : false;
      if (f.type === "action") continue;
      for (const el of row.querySelectorAll("input, select")) {
        if (el.type === "checkbox") el.checked = params[f.key];
        else if (document.activeElement !== el) el.value = String(params[f.key]);
      }
    }
  }

  // ---- highlight ----
  let hlKey = null, hlTimer = 0;
  function showHighlight(key) { clearTimeout(hlTimer); hlKey = key; renderHighlight(); }
  function clearHighlight(row) {
    clearTimeout(hlTimer);
    hlTimer = setTimeout(() => {
      if (row.matches(":hover") || row.contains(document.activeElement)) return;
      hlKey = null; renderHighlight();
    }, 250);
  }
  function renderHighlight() {
    const layer = document.getElementById("hlLayer");
    const pred = current && hlKey ? tool.highlight(current, params)[hlKey] : null;
    if (!pred) { viewer.setHighlight(null); if (layer) layer.innerHTML = ""; return; }
    const { positions: Q, indices: I } = current.body, off = current.offset;
    const pos = [], tris = [];
    for (let k = 0; k < I.length; k += 3) {
      const v = [I[k], I[k + 1], I[k + 2]].map((i) => [Q[3 * i] - off.x, Q[3 * i + 1] - off.y, Q[3 * i + 2]]);
      const ux = v[1][0] - v[0][0], uy = v[1][1] - v[0][1], uz = v[1][2] - v[0][2];
      const wx = v[2][0] - v[0][0], wy = v[2][1] - v[0][1], wz = v[2][2] - v[0][2];
      const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, l = Math.hypot(nx, ny, nz) || 1;
      // x, y: the middle of the triangle's extent, not its centroid: the two triangles of a wall
      // quad span the same stretch of outline, so they are judged alike (no saw-tooth)
      const xs = v.map((q) => q[0]), ys = v.map((q) => q[1]);
      const x = (Math.min(...xs) + Math.max(...xs)) / 2, y = (Math.min(...ys) + Math.max(...ys)) / 2, z = (v[0][2] + v[1][2] + v[2][2]) / 3;
      if (!pred({ x, y, z, r: Math.hypot(x, y), nx: nx / l, ny: ny / l, nz: nz / l, pts: v })) continue;
      v.nz = nz / l;
      tris.push(v);
      for (const q of v) pos.push(q[0] + off.x, q[1] + off.y, q[2]);
    }
    viewer.setHighlight(tris.length ? { positions: Float64Array.from(pos), indices: Uint32Array.from({ length: pos.length / 3 }, (_, i) => i) } : null);
    if (!layer) return;
    let fill = "", line = "";
    const pt = ([a, b]) => `${a.toFixed(2)},${b.toFixed(2)}`;
    for (const view of tool.hlViews(current)) {
      if (view.project) for (const v of tris) {
        const q = v.map(view.project); // (null: not shown in this view)
        if (!q.every(Boolean)) continue;
        // walls seen edge-on are lines; faces are filled (one path: overlaps are not doubled)
        if (Math.abs(v.nz) < 0.05) line += `M${q.map(pt).join("L")}`;
        else fill += `M${q.map(pt).join("L")}Z`;
      }
      if (view.cut) {
        const { axis, map } = view.cut;
        for (const v of tris) {
          // where the triangle meets the plane: corners on it, and edges that cross it
          const hits = [];
          for (let i = 0; i < 3; i++) {
            const a = v[i], b = v[(i + 1) % 3], da = a[axis], db = b[axis];
            if (Math.abs(da) < 1e-6) hits.push(a);
            else if (da * db < 0 && Math.abs(db) >= 1e-6) { const t = da / (da - db); hits.push(a.map((c, j) => c + (b[j] - c) * t)); }
          }
          if (hits.length >= 2) line += `M${pt(map(hits[0]))}L${pt(map(hits[1]))}`;
        }
      }
    }
    layer.innerHTML = `<path class="hl" d="${fill}"/><path class="hl-line" d="${line}"/>`;
  }

  // ---- results ----
  function drawResults(el, m) {
    const s = m.strength;
    const cls = (sf) => (sf >= 2 ? "good" : sf >= 1.3 ? "warnc" : "bad");
    const warn = [...m.warnings];
    if (m.stats.badEdges) warn.push(`Mesh check: ${m.stats.badEdges} open edges — please report this combination.`);
    el.innerHTML = `
      <div class="results-grid">
        <div>
          <h2>Part</h2>
          <table>
            <tr><td>Size on the bed</td><td class="num">${fmt(m.size.x)} × ${fmt(m.size.y)} mm</td></tr>
            <tr><td>Height</td><td class="num">${fmt(m.size.z)} mm</td></tr>
            ${tool.rows(m, params)}
            <tr><td>Volume</td><td class="num">${fmt(m.stats.volume / 1000)} cm³</td></tr>
            <tr><td>Filament, estimate (PLA, 1.75 mm)</td><td class="num">≈ ${fmt(m.filament.grams, 0)} g · ${fmt(m.filament.metres, 1)} m</td></tr>
            <tr><td>Mesh</td><td class="num ${m.stats.badEdges ? "bad" : "good"}">${m.stats.triangles} triangles, ${m.stats.badEdges ? "not closed" : "closed"}</td></tr>
          </table>
        </div>
        <div>
          <h2>Strength at ${params.loadKg} kg</h2>
          <table>
            <tr><th>Section</th><th class="num">MPa</th><th class="num">Safety</th></tr>
            ${s.sections.map((x) => `<tr><td>${x.name}</td><td class="num">${fmt(x.stress)}</td><td class="num ${cls(x.safety)}">${fmt(x.safety)}</td></tr>`).join("")}
          </table>
          <p class="note">${tool.strengthNote}</p>
        </div>
      </div>
      ${warn.length ? `<ul class="warnings">${warn.map((w) => `<li>${w}</li>`).join("")}</ul>` : ""}`;
  }

  // ---- layout (same as the edge page) ----
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
  const ROW = 4, GAP = 12;
  function fitMasonry() {
    const on = document.querySelector("main").classList.contains("rows");
    for (const card of document.getElementById("controls").children) {
      card.style.gridRowEnd = on ? `span ${Math.ceil((card.getBoundingClientRect().height + GAP) / ROW)}` : "";
    }
  }
  const masonry = new ResizeObserver(() => fitMasonry());
  new MutationObserver(fitMasonry).observe(document.querySelector("main"), { attributes: true, attributeFilter: ["class"] });

  // ---- main ----
  const viewer = createViewer(document.getElementById("view3d"));
  const controls = document.getElementById("controls");
  buildControls(controls);
  for (const card of controls.children) masonry.observe(card);
  sync();

  let pending = 0;
  function refresh() {
    save();
    clearTimeout(pending);
    pending = setTimeout(() => {
      const status = document.getElementById("plateStatus");
      try {
        current = tool.build(params);
      } catch (err) {
        document.getElementById("stage").classList.add("stale");
        status.innerHTML = `<p class="bad"><b>These settings can't be built:</b> ${err.message}. The drawing and 3D view still show the last valid version; exports use it too.</p>`;
        document.getElementById("results").innerHTML = `<ul class="warnings"><li>These settings do not give a valid shape: ${err.message}</li></ul>`;
        return;
      }
      document.getElementById("stage").classList.remove("stale");
      const w = [...current.warnings];
      if (current.strength.worst.safety < 2) w.push(`Safety factor ${current.strength.worst.safety.toFixed(1)} at ${params.loadKg} kg (aim for 2 or more, see Strength).`);
      status.innerHTML = w.length ? `<ul class="warnings">${w.map((s) => `<li>${s}</li>`).join("")}</ul>` : "";
      tool.draw(document.getElementById("plate"), current, params);
      document.getElementById("plate").insertAdjacentHTML("beforeend", `<g id="hlLayer"></g>`);
      viewer.setMeshes(current.body, null, current.size);
      drawResults(document.getElementById("results"), current);
      renderHighlight();
    });
  }

  // ---- export ----
  function download(bytes, name, type) {
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  const opts = () => ({ name: tool.fileBase(params), body: current.body, modifier: null, settings: printSettings(params), place: [100, 100] });
  const needModel = (fn) => () => {
    if (!current) { document.getElementById("plateStatus").innerHTML = `<p class="bad">Nothing to export yet: these settings can't be built (see above).</p>`; return; }
    fn();
  };
  function bambuPresets() {
    const byNozzle = BAMBU_PRESETS[params.bambuPrinter] ?? Object.values(BAMBU_PRESETS)[0];
    const nozzle = Object.keys(byNozzle).sort((x, y) => Math.abs(x - params.nozzle) - Math.abs(y - params.nozzle))[0];
    return { model: params.bambuPrinter, nozzle, ...byNozzle[nozzle] };
  }
  const name = () => tool.fileBase(params);
  document.getElementById("dlStl").addEventListener("click", needModel(() => download(stl(current.body, name()), `${name()}.stl`, "model/stl")));
  document.getElementById("dlPrusa").addEventListener("click", needModel(() => download(threeMfPrusa(opts()), `${name()}_prusaslicer.3mf`, "model/3mf")));
  document.getElementById("dlBambu").addEventListener("click", needModel(() => download(threeMfBambu({ ...opts(), presets: bambuPresets() }), `${name()}_bambu.3mf`, "model/3mf")));
  document.getElementById("dlOrca").addEventListener("click", needModel(() => download(threeMfOrca(opts()), `${name()}_orca.3mf`, "model/3mf")));
  const bp = document.getElementById("bambuPrinter");
  for (const m of Object.keys(BAMBU_PRESETS)) bp.add(new Option(m.replace("Bambu Lab ", ""), m));
  bp.value = params.bambuPrinter;
  bp.addEventListener("change", () => { params = { ...params, bambuPrinter: bp.value }; save(); });

  refresh();
}
