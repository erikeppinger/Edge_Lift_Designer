// Break test: builds the model for random and extreme settings and reports crashes, open meshes
// and failing exports/highlights. node tools/fuzz.mjs [count]
// The control ranges are read from js/app.js, so the test follows the UI.
import { readFileSync } from "node:fs";
import { DEFAULTS } from "../js/frame.js";
import { buildModel, printSettings } from "../js/model.js";
import { stl, threeMfPrusa, threeMfBambu, threeMfOrca } from "../js/export.js";
import { highlightTriangles } from "../js/highlight.js";
import { BAMBU_PRESETS } from "../js/bambu-presets.js";

const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const ranges = [...app.matchAll(/key: "(\w+)",[^}]*?min: (-?[\d.]+), max: (-?[\d.]+), step: ([\d.]+)/g)]
  .map(([, key, min, max, step]) => ({ key, min: +min, max: +max, step: +step }))
  .filter((r) => r.key in DEFAULTS);
const selects = { hands: [1, 2], hand: ["left", "right"], slotShape: ["auto", "teardrop", "lens", "plain"], unlevel: [true, false], denseZones: [true, false] };
// finger table ranges (from the table definition)
const table = [["p1", 20, 60], ["w", 10, 30], ["k", -20, 10]];
for (const side of ["L", "R"]) for (const f of ["Index", "Middle", "Ring", "Little"]) for (const [pre, min, max] of table) ranges.push({ key: `${pre}${f}${side}`, min, max, step: 0.5 });

let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (r) => Math.round((r.min + rnd() * (r.max - r.min)) / r.step) * r.step;

const cases = [];
for (const r of ranges) for (const v of [r.min, r.max]) cases.push({ ...DEFAULTS, [r.key]: v, _what: `${r.key}=${v}` });
for (const [k, vals] of Object.entries(selects)) for (const v of vals) cases.push({ ...DEFAULTS, [k]: v, _what: `${k}=${v}` });
const N = Number(process.argv[2] ?? 400);
const dump = process.argv[3]; // e.g. "random #0": print that case (settings that differ from the defaults)
for (let i = 0; i < N; i++) {
  const p = { ...DEFAULTS, _what: `random #${i}` };
  for (const r of ranges) if (rnd() < 0.5) p[r.key] = pick(r);
  for (const [k, vals] of Object.entries(selects)) if (rnd() < 0.5) p[k] = vals[Math.floor(rnd() * vals.length)];
  cases.push(p);
}

const userError = (m) => /does not fit|crosses itself|runs into|runs out|reaches the outer|overlap/i.test(m) && !/Triangulation|bridge|undefined|NaN|is not/i.test(m);
const problems = new Map();
const note = (kind, p, detail) => {
  const k = `${kind}: ${detail}`;
  if (!problems.has(k)) problems.set(k, []);
  problems.get(k).push(p._what);
};
if (dump) {
  const p = cases.find((q) => q._what === dump);
  console.log(JSON.stringify(Object.fromEntries(Object.entries(p).filter(([k, v]) => DEFAULTS[k] !== v && k !== "_what"))));
  process.exit(0);
}
let ok = 0, refused = 0;
const keys = ranges.map((r) => r.key).concat(["fingersR", "fingersL", "slotShape", "hands"]);
for (const p of cases) {
  let m;
  try { m = buildModel(p); } catch (e) {
    if (userError(e.message)) { refused++; if (!p._what.startsWith("random")) note("REFUSED (single setting)", p, e.message.slice(0, 70)); continue; }
    note("CRASH", p, e.message.slice(0, 90)); continue;
  }
  const P = m.body.positions;
  if (P.some((x) => !Number.isFinite(x))) note("NaN", p, "non-finite vertex");
  if (m.stats.badEdges) note("OPEN MESH", p, `${m.stats.badEdges} bad edges`);
  if (!(m.stats.volume > 0)) note("VOLUME", p, `volume ${m.stats.volume}`);
  try {
    const opts = { name: "t", body: m.body, modifier: m.modifier, settings: printSettings(p), place: [100, 100] };
    stl(m.body); threeMfPrusa(opts); threeMfOrca(opts);
    threeMfBambu({ ...opts, presets: { model: "Bambu Lab P1S", nozzle: "0.4", ...BAMBU_PRESETS["Bambu Lab P1S"]["0.4"] } });
  } catch (e) { note("EXPORT", p, e.message.slice(0, 90)); }
  for (const k of keys) {
    try { highlightTriangles(m, p, k); } catch (e) { note("HIGHLIGHT", p, `${k}: ${e.message.slice(0, 60)}`); }
  }
  ok++;
}
console.log(`${cases.length} cases: ${ok} built, ${refused} refused with a message, ${problems.size} problem kinds`);
for (const [k, list] of problems) console.log(`- ${k}  (${list.length}×, e.g. ${list.slice(0, 4).join(", ")})`);
