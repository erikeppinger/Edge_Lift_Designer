import { test } from "node:test";
import assert from "node:assert/strict";
import { box, extrude, meshStats } from "../js/mesh.js";
import { roundedRing, segmentPlan, signedArea } from "../js/geom2d.js";
import { stl, threeMfPrusa, threeMfBambu } from "../js/export.js";

const close = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b} (±${tol})`);
const square = (r) => [{ x: 0, y: 0, r }, { x: 10, y: 0, r }, { x: 10, y: 10, r }, { x: 0, y: 10, r }];

test("box mesh is closed with volume x·y·z", () => {
  const s = meshStats(box(0, 0, 0, 2, 3, 4));
  assert.equal(s.badEdges, 0);
  close(s.volume, 24, 1e-9);
});

test("square prism without rounding: exact volume", () => {
  const s = meshStats(extrude([square(0)], 5, 0, 0));
  assert.equal(s.badEdges, 0);
  close(s.volume, 500, 1e-9);
});

test("45° chamfer on a sharp square removes the hand-computed frustum volume", () => {
  const c = 1;
  const s = meshStats(extrude([square(0)], 5, c, c));
  const frustum = (c / 3) * (64 + 100 + 80); // 8×8 → 10×10 over height 1
  close(s.volume, 2 * frustum + 100 * (5 - 2 * c), 1e-9);
});

test("rounded corner area: square minus (4 − π)·r²", () => {
  const r = 2, sq = square(r);
  close(signedArea(roundedRing(sq, 0, segmentPlan(sq, 0, 0.0005))), 100 - (4 - Math.PI) * r * r, 0.01);
});

test("STL size and 3MF zips", () => {
  const b = box(0, 0, 0, 1, 1, 1);
  assert.equal(stl(b).length, 84 + 50 * 12);
  const opts = { name: "t", body: b, modifier: box(0, 0, 0, 0.5, 0.5, 0.5), place: [100, 100],
    settings: { layerHeight: 0.2, walls: 6, infill: 40, infillPattern: "gyroid", topBottomLayers: 5, zoneInfill: 60, zonePattern: "gyroid" } };
  for (const z of [threeMfPrusa(opts), threeMfBambu(opts)]) assert.equal(String.fromCharCode(z[0], z[1]), "PK");
});

test("Bambu export names its presets, the Orca export does not", async () => {
  const { threeMfOrca } = await import("../js/export.js");
  const b = box(0, 0, 0, 1, 1, 1);
  const opts = { name: "t", body: b, modifier: null, place: [0, 0],
    settings: { layerHeight: 0.2, walls: 6, infill: 40, infillPattern: "gyroid", topBottomLayers: 5, zoneInfill: 60, zonePattern: "gyroid" } };
  const presets = { model: "Bambu Lab P1S", nozzle: "0.4", printer: "Bambu Lab P1S 0.4 nozzle", print: "p", filament: "f" };
  const txt = (z) => Buffer.from(z).toString("latin1");
  assert.ok(txt(threeMfBambu({ ...opts, presets })).includes('"printer_settings_id": "Bambu Lab P1S 0.4 nozzle"'));
  assert.ok(!txt(threeMfOrca(opts)).includes("project_settings"));
});
