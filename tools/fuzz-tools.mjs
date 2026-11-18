// Break test for the finger pocket and the talon grip: extremes and random settings, reports
// crashes, open meshes, flat triangles and failing exports. node tools/fuzz-tools.mjs [count]
// The control ranges are read from the page modules, so the test follows the UI.
import { readFileSync } from "node:fs";
import { buildPocket, POCKET_DEFAULTS } from "../js/pocket.js";
import { buildTalon, TALON_DEFAULTS, TALON_SHAPES } from "../js/talon.js";
import { stl, threeMfPrusa, threeMfOrca } from "../js/export.js";
import { printSettings } from "../js/model.js";
import { flatTriangles } from "./mesh-check.mjs";

let seed = 4242;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);


function run(name, page, defaults, build, selects, count) {
  // the page's own controls and the shared ones (label, printing, strength)
  const src = [page, "toolpage.js"].map((f) => readFileSync(new URL(`../js/${f}`, import.meta.url), "utf8")).join("\n");
  const ranges = [...src.matchAll(/key: "(\w+)",[^}]*?min: (-?[\d.]+), max: (-?[\d.]+), step: ([\d.]+)/g)]
    .map(([, key, min, max, step]) => ({ key, min: +min, max: +max, step: +step })).filter((r) => r.key in defaults);
  const pick = (r) => Math.round((r.min + rnd() * (r.max - r.min)) / r.step) * r.step;
  const cases = [];
  for (const r of ranges) for (const v of [r.min, r.max]) cases.push({ ...defaults, [r.key]: v, _what: `${r.key}=${v}` });
  for (const [k, vals] of Object.entries(selects)) for (const v of vals) cases.push({ ...defaults, ...(typeof v === "object" ? v : { [k]: v }), _what: `${k}=${typeof v === "object" ? JSON.stringify(v).slice(0, 30) : v}` });
  for (let i = 0; i < count; i++) {
    const p = { ...defaults, _what: `random #${i}` };
    for (const r of ranges) if (rnd() < 0.5) p[r.key] = pick(r);
    for (const [k, vals] of Object.entries(selects)) if (rnd() < 0.5) { const v = vals[Math.floor(rnd() * vals.length)]; Object.assign(p, typeof v === "object" ? v : { [k]: v }); }
    cases.push(p);
  }
  const problems = new Map();
  const note = (kind, p, detail) => { const k = `${kind}: ${detail}`; if (!problems.has(k)) problems.set(k, []); problems.get(k).push(p._what); };
  let ok = 0, refused = 0;
  for (const p of cases) {
    let m;
    try { m = build(p); } catch (e) {
      // our own messages are plain Errors; anything else (TypeError, triangulation …) is a crash
      if (e.constructor === Error && !/Triangulation|undefined|NaN/.test(e.message)) { refused++; if (!p._what.startsWith("random")) note("REFUSED (single setting)", p, e.message.slice(0, 80)); continue; }
      note("CRASH", p, `${e.constructor.name}: ${e.message.slice(0, 90)}`); continue;
    }
    if (m.body.positions.some((x) => !Number.isFinite(x))) note("NaN", p, "non-finite vertex");
    if (m.stats.badEdges) note("OPEN MESH", p, `${m.stats.badEdges} bad edges`);
    if (!(m.stats.volume > 0)) note("VOLUME", p, `volume ${m.stats.volume}`);
    const flat = flatTriangles(m.body);
    if (flat) note("DEGENERATE", p, `${flat} flat triangles`);
    if (!m.strength.sections.every((s) => Number.isFinite(s.safety) && s.safety > 0)) note("STRENGTH", p, "not a number");
    try {
      const o = { name, body: m.body, modifier: null, settings: printSettings(p), place: [100, 100] };
      stl(m.body, name); threeMfPrusa(o); threeMfOrca(o);
    } catch (e) { note("EXPORT", p, e.message.slice(0, 80)); }
    ok++;
  }
  console.log(`${name}: ${cases.length} cases: ${ok} built, ${refused} refused with a message, ${problems.size} problem kinds`);
  for (const [k, list] of problems) console.log(`- ${k}  (${list.length}×, e.g. ${list.slice(0, 3).join(", ")})`);
  return [...problems.keys()].filter((k) => !k.startsWith("REFUSED")).length;
}

const N = Number(process.argv[2] ?? 300);
const bad = run("pocket", "pocket-page.js", POCKET_DEFAULTS, buildPocket, { style: ["blind", "through"], labelMode: ["raised", "engraved", "off"], labelText: ["", "ERIK", "TEST 123 ABC"], labelAuto: [true, false] }, N)
  + run("talon", "talon-page.js", TALON_DEFAULTS, buildTalon, { shape: Object.values(TALON_SHAPES), labelMode: ["engraved", "off"], labelText: ["", "ERIK", "TEST 123 ABC"], labelAuto: [true, false] }, N);
process.exitCode = bad ? 1 : 0;
