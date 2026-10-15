// File writers: binary STL, and 3MF for PrusaSlicer and for Bambu Studio / OrcaSlicer with the
// print settings and the solid-infill modifier volumes attached to the object. No DOM.

export function stl(mesh, name = "edge-lift") {
  const { positions: P, indices: I } = mesh;
  const n = I.length / 3;
  const buf = new ArrayBuffer(84 + 50 * n);
  const dv = new DataView(buf);
  const header = new TextEncoder().encode(name.slice(0, 79));
  new Uint8Array(buf, 0, 80).set(header);
  dv.setUint32(80, n, true);
  let o = 84;
  for (let t = 0; t < I.length; t += 3) {
    const v = [0, 1, 2].map((k) => [P[3 * I[t + k]], P[3 * I[t + k] + 1], P[3 * I[t + k] + 2]]);
    const u = v[1].map((x, i) => x - v[0][i]), w = v[2].map((x, i) => x - v[0][i]);
    const nx = u[1] * w[2] - u[2] * w[1], ny = u[2] * w[0] - u[0] * w[2], nz = u[0] * w[1] - u[1] * w[0];
    const l = Math.hypot(nx, ny, nz) || 1;
    for (const x of [nx / l, ny / l, nz / l]) { dv.setFloat32(o, x, true); o += 4; }
    for (const p of v) for (const x of p) { dv.setFloat32(o, x, true); o += 4; }
    o += 2;
  }
  return new Uint8Array(buf);
}

// ---- minimal ZIP (stored, no compression) ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zip(files) {
  const enc = new TextEncoder();
  const parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = typeof f.data === "string" ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint16(8, 0, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true);
    parts.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
    ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((s, a) => s + a.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, a) => s + a.length, 0));
  let o = 0;
  for (const a of all) { out.set(a, o); o += a.length; }
  return out;
}

// ---- 3MF ----
const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
 <Default Extension="config" ContentType="text/xml"/>
</Types>`;
const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;
const IDENTITY = "1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1";
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const num = (x) => (Math.abs(x) < 5e-5 ? "0" : x.toFixed(4).replace(/\.?0+$/, "")); // 0.1 µm is plenty

function meshXml(mesh, triOffset = 0) {
  const { positions: P, indices: I } = mesh;
  let v = "", t = "";
  for (let i = 0; i < P.length; i += 3) v += `<vertex x="${num(P[i])}" y="${num(P[i + 1])}" z="${num(P[i + 2])}"/>\n`;
  for (let i = 0; i < I.length; i += 3) t += `<triangle v1="${I[i] + triOffset}" v2="${I[i + 1] + triOffset}" v3="${I[i + 2] + triOffset}"/>\n`;
  return { v, t };
}

// settings: { layerHeight, walls, infill, infillPattern, topBottomLayers }
const prusaKeys = (s) => ({
  layer_height: s.layerHeight,
  perimeters: s.walls,
  fill_density: `${s.infill}%`,
  fill_pattern: s.infillPattern,
  top_solid_layers: s.topBottomLayers,
  bottom_solid_layers: s.topBottomLayers,
});
const bambuKeys = (s) => ({
  layer_height: s.layerHeight,
  wall_loops: s.walls,
  sparse_infill_density: `${s.infill}%`,
  sparse_infill_pattern: s.infillPattern,
  top_shell_layers: s.topBottomLayers,
  bottom_shell_layers: s.topBottomLayers,
});

// body, modifier: meshes in object coordinates; place: [x, y] position of the object on the bed.
export function threeMfPrusa({ name, body, modifier, settings, place }) {
  const nb = body.positions.length / 3;
  let v = "", t = "";
  const b = meshXml(body);
  v += b.v; t += b.t;
  const bodyTris = body.indices.length / 3;
  let modTris = 0;
  if (modifier) {
    const m = meshXml(modifier, nb);
    v += m.v; t += m.t;
    modTris = modifier.indices.length / 3;
  }
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06">
 <metadata name="slic3rpe:Version3mf">1</metadata>
 <metadata name="Title">${esc(name)}</metadata>
 <metadata name="Application">Edge Lift Designer</metadata>
 <resources>
  <object id="1" type="model">
   <mesh>
    <vertices>
${v}    </vertices>
    <triangles>
${t}    </triangles>
   </mesh>
  </object>
 </resources>
 <build>
  <item objectid="1" transform="1 0 0 0 1 0 0 0 1 ${num(place[0])} ${num(place[1])} 0" printable="1"/>
 </build>
</model>`;
  const objMeta = Object.entries(prusaKeys(settings))
    .map(([k, val]) => `  <metadata type="object" key="${k}" value="${esc(val)}"/>`).join("\n");
  let config = `<?xml version="1.0" encoding="UTF-8"?>
<config>
 <object id="1" instances_count="1">
  <metadata type="object" key="name" value="${esc(name)}"/>
${objMeta}
  <volume firstid="0" lastid="${bodyTris - 1}">
   <metadata type="volume" key="name" value="${esc(name)}"/>
   <metadata type="volume" key="volume_type" value="ModelPart"/>
   <metadata type="volume" key="matrix" value="${IDENTITY}"/>
  </volume>`;
  if (modifier) {
    config += `
  <volume firstid="${bodyTris}" lastid="${bodyTris + modTris - 1}">
   <metadata type="volume" key="name" value="dense zones"/>
   <metadata type="volume" key="volume_type" value="ParameterModifier"/>
   <metadata type="volume" key="modifier" value="1"/>
   <metadata type="volume" key="matrix" value="${IDENTITY}"/>
   <metadata type="volume" key="fill_density" value="${settings.zoneInfill}%"/>
   <metadata type="volume" key="fill_pattern" value="${esc(settings.zonePattern)}"/>
  </volume>`;
  }
  config += `
 </object>
</config>`;
  return zip([
    { name: "[Content_Types].xml", data: CONTENT_TYPES },
    { name: "_rels/.rels", data: RELS },
    { name: "3D/3dmodel.model", data: model },
    { name: "Metadata/Slic3r_PE_model.config", data: config },
  ]);
}

// presets (Bambu Studio only): { model, nozzle, printer, print, filament } preset names. Bambu Studio
// ignores every per-object setting of a 3MF without a project config naming them ("invalid
// configuration, only geometry loaded"); OrcaSlicer reads the file fine without and would switch
// to those presets with it, so the Orca export leaves them out.
export function threeMfBambu({ name, body, modifier, settings, place, presets = null }) {
  const parts = [{ id: 1, mesh: body, name, subtype: "normal_part" }];
  if (modifier) parts.push({ id: 2, mesh: modifier, name: "dense zones", subtype: "modifier_part", extra: { sparse_infill_density: `${settings.zoneInfill}%`, sparse_infill_pattern: settings.zonePattern } });
  const objId = parts.length + 1;
  const objects = parts.map((p) => {
    const m = meshXml(p.mesh);
    return `  <object id="${p.id}" p:UUID="${String(p.id).padStart(8, "0")}-81cb-4c03-9d28-80fed5dfa1dc" type="model">
   <mesh>
    <vertices>
${m.v}    </vertices>
    <triangles>
${m.t}    </triangles>
   </mesh>
  </object>`;
  }).join("\n");
  // Same layout as Bambu Studio / OrcaSlicer write it: meshes in a separate object file,
  // referenced through the 3MF production extension (the slicers expect this).
  const uuid = (n) => `${String(n).padStart(8, "0")}-61cb-4c03-9d28-80fed5dfa1dc`;
  const comps = parts.map((p) => `    <component p:path="/3D/Objects/object_1.model" objectid="${p.id}" p:UUID="${uuid(0x10000 + p.id)}" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>`).join("\n");
  const NS = `xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p"`;
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" ${NS}>
 <metadata name="Application">BambuStudio-02.06.00.51</metadata>
 <metadata name="BambuStudio:3mfVersion">1</metadata>
 <metadata name="Title">${esc(name)}</metadata>
 <resources>
  <object id="${objId}" p:UUID="${uuid(objId)}" type="model">
   <components>
${comps}
   </components>
  </object>
 </resources>
 <build p:UUID="2c7c17d8-22b5-4d84-8835-1976022ea369">
  <item objectid="${objId}" p:UUID="${uuid(0x20000 + objId)}" transform="1 0 0 0 1 0 0 0 1 ${num(place[0])} ${num(place[1])} 0" printable="1"/>
 </build>
</model>`;
  const objectModel = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" ${NS}>
 <metadata name="BambuStudio:3mfVersion">1</metadata>
 <resources>
${objects}
 </resources>
 <build/>
</model>`;
  const objRels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/Objects/object_1.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;
  const objMeta = Object.entries(bambuKeys(settings))
    .map(([k, val]) => `    <metadata key="${k}" value="${esc(val)}"/>`).join("\n");
  const partXml = parts.map((p) => {
    const extra = Object.entries(p.extra ?? {}).map(([k, val]) => `\n      <metadata key="${k}" value="${esc(val)}"/>`).join("");
    return `    <part id="${p.id}" subtype="${p.subtype}">
      <metadata key="name" value="${esc(p.name)}"/>
      <metadata key="matrix" value="${IDENTITY}"/>${extra}
    </part>`;
  }).join("\n");
  const config = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="${objId}">
    <metadata key="name" value="${esc(name)}"/>
    <metadata key="extruder" value="1"/>
${objMeta}
${partXml}
  </object>
  <plate>
    <metadata key="plater_id" value="1"/>
    <metadata key="plater_name" value=""/>
    <metadata key="locked" value="false"/>
    <model_instance>
      <metadata key="object_id" value="${objId}"/>
      <metadata key="instance_id" value="0"/>
      <metadata key="identify_id" value="1"/>
    </model_instance>
  </plate>
  <assemble>
   <assemble_item object_id="${objId}" instance_id="0" transform="1 0 0 0 1 0 0 0 1 ${num(place[0])} ${num(place[1])} 0" offset="0 0 0" />
  </assemble>
</config>`;
  return zip([
    { name: "[Content_Types].xml", data: CONTENT_TYPES },
    { name: "_rels/.rels", data: RELS },
    { name: "3D/3dmodel.model", data: model },
    { name: "3D/_rels/3dmodel.model.rels", data: objRels },
    { name: "3D/Objects/object_1.model", data: objectModel },
    { name: "Metadata/model_settings.config", data: config },
    ...(presets ? [{ name: "Metadata/project_settings.config", data: JSON.stringify({
      version: "02.08.02.61", from: "project", name: "project_settings",
      printer_settings_id: presets.printer, print_settings_id: presets.print, filament_settings_id: [presets.filament],
      printer_model: presets.model, printer_variant: presets.nozzle, nozzle_diameter: [presets.nozzle], printer_technology: "FFF",
    }, null, 4) }] : []),
  ]);
}

export const threeMfOrca = (opts) => threeMfBambu({ ...opts, presets: null });
