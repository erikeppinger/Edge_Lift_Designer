// Writes sample exports for checking in the slicers: node tools/export-sample.mjs outDir
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DEFAULTS } from "../js/frame.js";
import { buildModel, printSettings } from "../js/model.js";
import { stl, threeMfPrusa, threeMfBambu, threeMfOrca } from "../js/export.js";
import { BAMBU_PRESETS } from "../js/bambu-presets.js";

const out = process.argv[2] ?? "out";
mkdirSync(out, { recursive: true });
const p = { ...DEFAULTS, denseZones: true };
const m = buildModel(p);
const opts = { name: "edge-lift", body: m.body, modifier: m.modifier, settings: printSettings(p), place: [100, 100] };
writeFileSync(join(out, "edge-lift.stl"), stl(m.body));
writeFileSync(join(out, "edge-lift-prusa.3mf"), threeMfPrusa(opts));
writeFileSync(join(out, "edge-lift-orca.3mf"), threeMfOrca(opts));
const model = "Bambu Lab P1S";
writeFileSync(join(out, "edge-lift-bambu.3mf"), threeMfBambu({ ...opts, presets: { model, nozzle: "0.4", ...BAMBU_PRESETS[model]["0.4"] } }));
console.log(m.stats, m.size, m.warnings);
