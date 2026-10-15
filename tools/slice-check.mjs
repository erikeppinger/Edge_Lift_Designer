// Export check: builds a set of models (defaults, extremes, random), writes every export, checks
// the files' structure and slices the STL and the PrusaSlicer 3MF with the PrusaSlicer CLI.
//   node tools/slice-check.mjs outDir [randomCount] [path to prusa-slicer-console.exe]
import { writeFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { DEFAULTS } from "../js/frame.js";
import { buildModel, printSettings } from "../js/model.js";
import { stl, threeMfPrusa, threeMfBambu, threeMfOrca } from "../js/export.js";
import { BAMBU_PRESETS } from "../js/bambu-presets.js";

const [out = "slice-check", nArg = "6", prusa = "C:/Program Files/Prusa3D/PrusaSlicer/prusa-slicer-console.exe"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });

// ---- the cases ----
let seed = 777;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const cases = [
  ["default", {}],
  ["two-hands", { hands: 2, p1IndexL: 41, p1MiddleL: 46.5, p1RingL: 43, p1LittleL: 33.5 }],
  ["level", { unlevel: false }],
  ["deep-edge", { edgeDepth: 35, floorThick: 8 }],
  ["shallow-edge", { edgeDepth: 8, edgeRadius: 2, floorFillet: 0.5 }],
  ["big-radius", { edgeRadius: 6, sideBar: 30 }],
  ["inward-bow", { bow: -8, barThick: 26 }],
  ["outward-bow", { bow: 15, hands: 2 }],
  ["plain-slots", { slotShape: "plain", slotLength: 40 }],
  ["no-chamfer", { chamferLayers: 0, floorFillet: 0 }],
  ["fine-layers", { layerHeight: 0.05, chamferLayers: 8 }],
  ["big-nozzle", { nozzle: 0.8, layerHeight: 0.4, chamferLayers: 2 }],
  ["dense-zones", { denseZones: true, zoneInfill: 80, zonePattern: "cubic" }],
  ["cord-exit", { cordExit: 4, holeX: 1.5, holeY: -6 }],
  ["cord-exit-lens", { cordExit: 3, hands: 2, holeY: 4 }],
  ["wide-hand", { wIndexR: 30, wMiddleR: 30, wRingR: 30, wLittleR: 30, sideMargin: 20 }],
];
for (let i = 0; i < Number(nArg); i++) {
  const p = {};
  const set = (k, a, b, s = 0.5) => { if (rnd() < 0.6) p[k] = Math.round((a + rnd() * (b - a)) / s) * s; };
  set("edgeDepth", 10, 30); set("edgeRadius", 0, 6); set("windowHeight", 22, 50); set("barThick", 14, 28);
  set("sideBar", 20, 32); set("bow", -6, 10); set("stepRadius", 0, 6); set("stepAngle", 60, 90, 1);
  set("p1IndexR", 35, 48); set("p1LittleR", 28, 40); set("kLittleR", -8, 2);
  if (rnd() < 0.5) p.hands = 2;
  cases.push([`random-${i}`, p]);
}

// ---- structural checks ----
const unzip = (bytes) => {
  const files = {}; let o = 0;
  while (bytes.readUInt32LE(o) === 0x04034b50) {
    const method = bytes.readUInt16LE(o + 8), size = bytes.readUInt32LE(o + 18), nl = bytes.readUInt16LE(o + 26), el = bytes.readUInt16LE(o + 28);
    if (method !== 0) throw new Error("compressed entry (writer only stores)");
    const name = bytes.slice(o + 30, o + 30 + nl).toString();
    files[name] = bytes.slice(o + 30 + nl + el, o + 30 + nl + el + size).toString("utf8");
    o += 30 + nl + el + size;
  }
  if (bytes.readUInt32LE(o) !== 0x02014b50) throw new Error("no central directory after the entries");
  return files;
};
const balanced = (xml) => {
  const stack = [];
  for (const m of xml.matchAll(/<(\/?)([A-Za-z_][\w:.-]*)[^>]*?(\/?)>/g)) {
    const [, close, tag, self] = m;
    if (self) continue;
    if (!close) stack.push(tag);
    else if (stack.pop() !== tag) return `tag </${tag}> does not close the open one`;
  }
  return stack.length ? `unclosed <${stack.at(-1)}>` : null;
};
function checkModelXml(xml, where, problems) {
  const err = balanced(xml.replace(/<\?xml[^>]*\?>/, ""));
  if (err) problems.push(`${where}: ${err}`);
  for (const obj of xml.matchAll(/<object id="(\d+)"[\s\S]*?<\/object>/g)) {
    const nv = (obj[0].match(/<vertex /g) ?? []).length;
    for (const t of obj[0].matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)) {
      if ([t[1], t[2], t[3]].some((v) => +v >= nv)) { problems.push(`${where}: object ${obj[1]} triangle index out of range`); break; }
    }
    if (/NaN|Infinity/.test(obj[0])) problems.push(`${where}: object ${obj[1]} has NaN/Infinity`);
  }
}
function check3mf(file, kind) {
  const problems = [];
  const files = unzip(readFileSync(file));
  for (const need of ["[Content_Types].xml", "_rels/.rels", "3D/3dmodel.model"]) if (!files[need]) problems.push(`missing ${need}`);
  checkModelXml(files["3D/3dmodel.model"], "3dmodel.model", problems);
  if (kind === "prusa") {
    const cfg = files["Metadata/Slic3r_PE_model.config"];
    if (!cfg) problems.push("missing Slic3r_PE_model.config");
    else {
      const err = balanced(cfg.replace(/<\?xml[^>]*\?>/, "")); if (err) problems.push(`config: ${err}`);
      const tris = (files["3D/3dmodel.model"].match(/<triangle /g) ?? []).length;
      const vols = [...cfg.matchAll(/firstid="(\d+)" lastid="(\d+)"/g)].map((m) => [+m[1], +m[2]]);
      if (vols[0]?.[0] !== 0 || vols.at(-1)?.[1] !== tris - 1) problems.push(`volume ranges ${JSON.stringify(vols)} do not cover ${tris} triangles`);
      for (let i = 1; i < vols.length; i++) if (vols[i][0] !== vols[i - 1][1] + 1) problems.push("volume ranges have a gap");
    }
  } else {
    const obj = files["3D/Objects/object_1.model"];
    if (!obj) problems.push("missing 3D/Objects/object_1.model"); else checkModelXml(obj, "object_1.model", problems);
    if (!files["3D/_rels/3dmodel.model.rels"]) problems.push("missing 3dmodel.model.rels");
    const cfg = files["Metadata/model_settings.config"];
    if (!cfg) problems.push("missing model_settings.config");
    else {
      const err = balanced(cfg.replace(/<\?xml[^>]*\?>/, "")); if (err) problems.push(`config: ${err}`);
      const partIds = [...cfg.matchAll(/<part id="(\d+)"/g)].map((m) => m[1]);
      const objIds = [...obj.matchAll(/<object id="(\d+)"/g)].map((m) => m[1]);
      if (partIds.join() !== objIds.join()) problems.push(`parts ${partIds} vs objects ${objIds}`);
    }
    const ps = files["Metadata/project_settings.config"];
    if (kind === "bambu" && !ps) problems.push("Bambu export without project_settings.config");
    if (kind === "orca" && ps) problems.push("Orca export with project_settings.config");
    if (ps) try { JSON.parse(ps); } catch { problems.push("project_settings.config is not JSON"); }
  }
  return problems;
}

// ---- run ----
const runPrusa = (args) => {
  try { return { ok: true, out: execFileSync(prusa, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 180000 }) }; }
  catch (e) { return { ok: false, out: `${e.stdout ?? ""}${e.stderr ?? ""}`.trim().split("\n").slice(-3).join(" | ") }; }
};
let failures = 0;
for (const [name, v] of cases) {
  const p = { ...DEFAULTS, ...v };
  let m;
  try { m = buildModel(p); } catch (e) { console.log(`${name}: refused – ${e.message.slice(0, 80)}`); continue; }
  const opts = { name, body: m.body, modifier: m.modifier, settings: printSettings(p), place: [100, 100] };
  const files = {
    stl: [join(out, `${name}.stl`), stl(m.body, name)],
    prusa: [join(out, `${name}_prusa.3mf`), threeMfPrusa(opts)],
    orca: [join(out, `${name}_orca.3mf`), threeMfOrca(opts)],
    bambu: [join(out, `${name}_bambu.3mf`), threeMfBambu({ ...opts, presets: { model: "Bambu Lab P1S", nozzle: "0.4", ...BAMBU_PRESETS["Bambu Lab P1S"]["0.4"] } })],
  };
  const problems = [];
  for (const [kind, [file, bytes]] of Object.entries(files)) {
    writeFileSync(file, bytes);
    if (kind === "stl") { if (statSync(file).size !== 84 + 50 * m.stats.triangles) problems.push("STL size mismatch"); }
    else problems.push(...check3mf(file, kind).map((x) => `${kind}: ${x}`));
  }
  // PrusaSlicer: mesh check and a real slice of the STL and of the 3MF (with its settings)
  const info = runPrusa(["--info", files.stl[0]]);
  if (!/manifold = yes/.test(info.out)) problems.push(`prusa --info: ${info.out.slice(0, 120)}`);
  for (const kind of ["stl", "prusa"]) {
    const g = files[kind][0].replace(/\.(stl|3mf)$/, `_${kind}.gcode`);
    // a 256 mm bed (Bambu/Prusa class), so large parts are not rejected by the CLI's 200 mm default
    const r = runPrusa(["--export-gcode", "--bed-shape", "0x0,256x0,256x256,0x256", "--center", "128,128", "--output", g, files[kind][0]]);
    let gc = null;
    try { gc = readFileSync(g, "utf8"); } catch { /* no G-code written */ }
    if (!r.ok || !gc) problems.push(`slice ${kind}: no G-code. ${r.out.slice(0, 200)}`);
    else {
      const layers = (gc.match(/;LAYER_CHANGE/g) ?? []).length;
      const lh = Number(gc.match(/; layer_height = ([\d.]+)/)?.[1]);
      const first = Number(gc.match(/; first_layer_height = ([\d.]+)/)?.[1] ?? lh);
      // The G-code footer lists the printer-wide settings; the 3MF's per-object settings (layer
      // height, perimeters, infill) do not appear there. They show in the layer count and the filament.
      const objLh = kind === "prusa" ? p.layerHeight : lh;
      const want = 1 + Math.round((m.size.z - Math.min(first, m.size.z)) / objLh);
      if (Math.abs(layers - want) > 2) problems.push(`slice ${kind}: ${layers} layers, expected ${want} (layer ${objLh} mm)`);
      if (kind === "prusa") {
        const cm3 = Number(gc.match(/; filament used \[cm3\] = ([\d.]+)/)?.[1]);
        m.sliced = { g: Math.round(cm3 * 1.24), layers };
        // the CLI printer has a 0.4 mm nozzle; the estimate follows the app's nozzle setting
        if ((p.nozzle ?? 0.4) === 0.4 && Math.abs(m.sliced.g - m.filament.grams) > 0.1 * m.sliced.g) problems.push(`filament estimate ${m.filament.grams.toFixed(0)} g vs PrusaSlicer ${m.sliced.g} g`);
      }
    }
  }
  const est = m.filament.grams, sliced = m.sliced?.g;
  console.log(`${name}: ${problems.length ? "PROBLEMS" : "ok"} · ${m.size.x.toFixed(0)}×${m.size.y.toFixed(0)}×${m.size.z.toFixed(0)} mm · estimate ${est.toFixed(0)} g, PrusaSlicer ${sliced ?? "?"} g${problems.length ? "\n  - " + problems.join("\n  - ") : ""}`);
  if (problems.length) failures++;
}
console.log(failures ? `${failures} case(s) with problems` : "all exports fine");
