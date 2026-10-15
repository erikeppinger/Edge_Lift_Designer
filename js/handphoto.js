// Hand measurements from points clicked on a photo. No DOM.
//
// Modes:
//   fist: half fist seen from above (knuckles and middle joints bent 90°, middle finger segments on
//         the table). Per finger the knuckle (MCP) and the middle joint (PIP), both bony bumps.
//         Gives P1 and the knuckle offsets; the hand axis is the mean MCP → PIP direction.
//   palm: hand flat, palm up. Crease at the finger base and at the middle joint (P1 approximation)
//         plus both sides at the end joint (width).
//   back: hand flat, back up. Knuckle and middle-joint wrinkles, plus the width at the end joint.

import { FINGERS, cap } from "./hand.js";

export function photoSteps(mode) {
  const ruler = [
    { id: "rA", label: "ruler: first mark", color: "#2563eb" },
    { id: "rB", label: "ruler: second mark", color: "#2563eb" },
  ];
  const base = {
    fist: (f) => ({ id: `${f}Base`, label: `${f}: knuckle (MCP), the top of the bump`, short: `${f} MCP`, color: "#c2410c" }),
    palm: (f) => ({ id: `${f}Base`, label: `${f}: crease at the finger base`, short: `${f} base`, color: "#c2410c" }),
    back: (f) => ({ id: `${f}Base`, label: `${f}: top of the knuckle (MCP)`, short: `${f} MCP`, color: "#c2410c" }),
  }[mode];
  const pip = {
    fist: (f) => ({ id: `${f}Pip`, label: `${f}: middle joint (PIP), the top of the bump`, short: `${f} PIP`, color: "#c2410c" }),
    palm: (f) => ({ id: `${f}Pip`, label: `${f}: middle-joint crease (PIP)`, short: `${f} PIP`, color: "#c2410c" }),
    back: (f) => ({ id: `${f}Pip`, label: `${f}: middle of the wrinkles over the middle joint (PIP)`, short: `${f} PIP`, color: "#c2410c" }),
  }[mode];
  const width = (f) => mode === "fist" ? [] : [
    { id: `${f}D1`, label: `${f}: one side at the end joint (DIP)`, short: `${f} DIP`, color: "#15803d" },
    { id: `${f}D2`, label: `${f}: other side at the end joint (DIP)`, short: `${f} DIP`, color: "#15803d" },
  ];
  return [...ruler, ...FINGERS.flatMap((f) => [base(f), pip(f), ...width(f)])];
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const half = (x) => Math.round(x * 2) / 2;

// pts: { id: {x, y} } in image pixels. Returns the parameter values that can be filled in
// (p1…, w…, k…), and per-finger text for the status line.
export function measureHand(mode, pts, rulerMm) {
  const values = {}, parts = [];
  if (!pts.rA || !pts.rB) return { values, parts };
  const mm = rulerMm / dist(pts.rA, pts.rB);
  for (const f of FINGERS) {
    const b = pts[`${f}Base`], q = pts[`${f}Pip`], d1 = pts[`${f}D1`], d2 = pts[`${f}D2`];
    if (b && q) values["p1" + cap(f)] = half(dist(b, q) * mm);
    if (d1 && d2) values["w" + cap(f)] = half(dist(d1, d2) * mm);
  }
  // Knuckle offsets: where each MCP sits along the hand axis, relative to the middle finger's.
  if (mode === "fist" && pts.middleBase) {
    let ax = 0, ay = 0;
    for (const f of FINGERS) {
      const b = pts[`${f}Base`], q = pts[`${f}Pip`];
      if (!b || !q) continue;
      const l = dist(b, q);
      ax += (q.x - b.x) / l; ay += (q.y - b.y) / l;
    }
    const al = Math.hypot(ax, ay);
    if (al > 0) {
      ax /= al; ay /= al;
      const m = pts.middleBase;
      for (const f of FINGERS) {
        const b = pts[`${f}Base`];
        if (b) values["k" + cap(f)] = half(((b.x - m.x) * ax + (b.y - m.y) * ay) * mm);
      }
    }
  }
  for (const f of FINGERS) {
    const p1 = values["p1" + cap(f)];
    if (p1 === undefined) continue;
    let t = `${f} P1 ${p1}`;
    if (values["k" + cap(f)] !== undefined && f !== "middle") t += `, knuckle ${values["k" + cap(f)] > 0 ? "+" : ""}${values["k" + cap(f)]}`;
    if (values["w" + cap(f)] !== undefined) t += `, width ${values["w" + cap(f)]}`;
    parts.push(t);
  }
  return { values, parts };
}
