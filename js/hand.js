// Hand data → edge height per finger and the layout of fingers along one edge. No DOM.
//
// Every hand has its own measurements (keys with an L or R suffix): one hand gives one stepped
// edge, both hands give two stepped edges opposite each other, each fitted to its own hand.

export const FINGERS = ["index", "middle", "ring", "little"];
export const SIDES = ["L", "R"];
export const cap = (f) => f[0].toUpperCase() + f.slice(1);
export const key = (kind, finger, side) => `${kind}${cap(finger)}${side}`; // e.g. p1IndexR

// Per finger: the proximal phalanx (MCP → PIP), the finger width at the DIP joint and the knuckle
// offset (MCP position along the hand, + = further towards the fingertips than the middle
// finger's). Defaults are a rough adult hand, placeholders until the user measures.
const PER_HAND = { p1: [40, 45, 42, 33], w: [19.5, 19.5, 19, 17], k: [0, 0, 0, 0] };
export const HAND_DEFAULTS = {
  ...Object.fromEntries(SIDES.flatMap((s) => Object.entries(PER_HAND).flatMap(([kind, vals]) =>
    FINGERS.map((f, i) => [key(kind, f, s), vals[i]])))),
  unlevel: true,
  stepScale: 1, // share of the length differences turned into edge height
  hands: 1, // 1: one stepped edge, 2: one stepped edge per hand, opposite each other
  hand: "right", // one hand: which; both hands: the one on the top edge
  sideMargin: 6,
};

export const sideOf = (hand) => (hand === "left" ? "L" : "R");
export const otherHand = (hand) => (hand === "left" ? "right" : "left");

// Edge height per finger of one hand. In a half crimp the proximal phalanx hangs along the pull and
// the middle phalanx lies under the edge, so a finger whose PIP sits further from the knuckle line
// (longer P1, or a knuckle further out) needs a lower edge. Relative to the middle finger; + = higher.
export function fingerHeights(p, side) {
  const reach = (f) => p[key("p1", f, side)] + p[key("k", f, side)];
  const ref = reach("middle");
  return Object.fromEntries(FINGERS.map((f) => [f, p.unlevel ? (ref - reach(f)) * p.stepScale : 0]));
}

// Segments along one edge, from x = 0, each with its edge height h, for a hand holding that edge.
// A right hand holds it with the thumb forwards, so its index finger comes first.
export function fingerLayout(p, side) {
  const h = fingerHeights(p, side);
  const segs = [];
  let x = 0;
  const add = (name, w, hh, finger) => { segs.push({ name, x0: x, x1: x + w, h: hh, finger }); x += w; };
  add("margin", p.sideMargin, null, false);
  for (const f of side === "L" ? FINGERS.slice().reverse() : FINGERS) add(f, p[key("w", f, side)], h[f], true);
  add("margin", p.sideMargin, null, false);
  // The margins take the neighbouring finger's edge height.
  segs[0].h = segs[1].h;
  segs[segs.length - 1].h = segs[segs.length - 2].h;
  return { segments: segs, width: x, heights: h };
}

// Stretches a layout to `width` by widening its end margins equally (the narrower hand's edge sits
// centred in the pocket).
export function fitLayout(layout, width) {
  const extra = (width - layout.width) / 2;
  if (extra <= 1e-9) return layout;
  const segs = layout.segments.map((s, i, all) => ({
    ...s,
    x0: i === 0 ? 0 : s.x0 + extra,
    x1: i === all.length - 1 ? width : s.x1 + extra,
  }));
  return { ...layout, segments: segs, width };
}
