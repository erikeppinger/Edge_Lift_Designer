// Small schematic diagrams next to the controls: the part in grey, the dimension a control changes
// in the accent colour (class "a"). 48 × 32 viewBox, styled from CSS so they follow light/dark mode.

const svg = (body) => `<svg viewBox="0 0 48 32" aria-hidden="true">${body}</svg>`;
const arrowV = (x, y0, y1) => `<path class="a" d="M${x} ${y0}V${y1}M${x - 2} ${y0 + 2.5}L${x} ${y0}L${x + 2} ${y0 + 2.5}M${x - 2} ${y1 - 2.5}L${x} ${y1}L${x + 2} ${y1 - 2.5}"/>`;
const arrowH = (y, x0, x1) => `<path class="a" d="M${x0} ${y}H${x1}M${x0 + 2.5} ${y - 2}L${x0} ${y}L${x0 + 2.5} ${y + 2}M${x1 - 2.5} ${y - 2}L${x1} ${y}L${x1 - 2.5} ${y + 2}"/>`;

// Section through the edge bar, as printed: floor on the bed, bar on the right, pocket open above.
const SECTION = "M4 28H44V6H30V24H4Z";
// Top view: plate with a pocket whose top border is stepped.
const PLATE = `<rect class="p" x="3" y="3" width="42" height="26" rx="4"/>`;
const POCKET = `<path class="h" d="M11 23H37V10H31V12H22V9H11Z"/>`;

export const ICONS = {
  fingers: svg(`<circle class="p" cx="9" cy="25" r="2.2"/><circle class="p" cx="29" cy="11" r="2.2"/>
    <path class="p" d="M29 11L40 17L43 26"/><path class="a" d="M9 25L29 11"/>
    <text x="13" y="13" class="t">P1</text>`),
  unlevel: svg(`<path class="p" d="M4 24H14V12H24V20H34V16H44"/>`),
  stepScale: svg(`<path class="p" d="M4 20H14V16H24V20H34"/><path class="a" d="M4 28H14V8H24V28H34"/>`),
  sideMargin: svg(`<rect class="p" x="4" y="6" width="40" height="20" rx="3"/><rect class="h" x="11" y="10" width="7" height="12" rx="3"/>
    <rect class="h" x="19" y="10" width="7" height="12" rx="3"/><rect class="h" x="27" y="10" width="7" height="12" rx="3"/>${arrowH(16, 4.5, 10.5)}`),
  edgeDepth: svg(`<path class="p" d="${SECTION}"/>${arrowV(26, 6, 24)}`),
  floorThick: svg(`<path class="p" d="${SECTION}"/><path class="a" d="M8 24V28M4 24H12M4 28H12"/>`),
  edgeRadius: svg(`<path class="p" d="M4 28H44V6H36A6 6 0 0 0 30 12V24H4Z"/><path class="a" d="M36 6A6 6 0 0 0 30 12"/>`),
  floorFillet: svg(`<path class="p" d="M4 28H44V6H30V20L26 24H4Z"/><path class="a" d="M30 20L26 24"/>`),
  stepAngle: svg(`<path class="p" d="M4 24H20L23 8H44"/><path class="a" d="M20 24L23 8M27 24A7 7 0 0 0 21.5 17"/>`),
  stepRadius: svg(`<path class="p" d="M4 24H15Q21 24 21 18V14Q21 8 27 8H44"/><path class="a" d="M15 24Q21 24 21 18M21 14Q21 8 27 8"/>`),
  windowHeight: svg(`${PLATE}${POCKET}${arrowV(26, 12, 23)}`),
  hands: svg(`${PLATE}<path class="h" d="M11 22H20V25H31V22H37V10H31V7H20V10H11Z"/>`),
  windowRadius: svg(`${PLATE}<path class="h" d="M11 23H37V10H11Z"/><path class="a" d="M11 15A5 5 0 0 1 16 10"/>`),
  barThick: svg(`${PLATE}${POCKET}${arrowV(34, 3.5, 11)}`),
  sideBar: svg(`${PLATE}${POCKET}${arrowH(17, 3.5, 10.5)}`),
  bow: svg(`<path class="p" d="M3 9Q24 1 45 9V29H3Z"/><path class="a" d="M3 9Q24 1 45 9"/><path class="p dash" d="M3 9H45"/>`),
  outerRadius: svg(`${PLATE}<path class="a" d="M3 9A6 6 0 0 1 9 3"/>`),
  slotShape: svg(`<path class="p" d="M14 6A5 5 0 0 1 19 11L15.5 26Q14 28 12.5 26L9 11A5 5 0 0 1 14 6Z"/>
    <path class="a" d="M34 4Q39 16 34 28Q29 16 34 4Z"/>`),
  cordDia: svg(`<circle class="p" cx="24" cy="16" r="9"/>${arrowH(16, 15.5, 32.5)}`),
  slotLength: svg(`<path class="p" d="M24 4Q29 16 24 28Q19 16 24 4Z"/>${arrowV(34, 4, 28)}`),
  chamferLayers: svg(`<path class="p" d="M6 28H36L42 22V4"/><path class="p dash" d="M6 25H39M6 22H42"/><path class="a" d="M36 28L42 22"/>`),
  layerHeight: svg(`<path class="p" d="M6 10H42M6 16H42M6 22H42"/>${arrowV(44, 16, 22)}`),
  nozzle: svg(`<path class="p" d="M14 4H34V14L27 24H21L14 14Z"/><path class="a" d="M21 28H27"/>`),
  loadKg: svg(`<path class="p" d="M24 4V14"/><path class="p" d="M14 16H34L37 28H11Z"/><text x="18" y="25" class="t">kg</text>`),
};
ICONS.fingersR = ICONS.fingersL = ICONS.fingers;
