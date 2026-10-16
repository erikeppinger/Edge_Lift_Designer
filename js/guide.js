// Measurement guide: an (i) button per hand-table column opens a small card with a diagram and
// how to measure that value. Hover or focus shows it, a click (or tap) pins it until Escape or a
// click elsewhere. Diagrams use the icon classes: part in grey, the measured dimension in accent.

const svg = (body) => `<svg viewBox="0 0 200 100" aria-hidden="true">${body}</svg>`;
const dot = (x, y) => `<circle class="j" cx="${x}" cy="${y}" r="3.2"/>`;
const label = (x, y, t, anchor = "start", cls = "t") => `<text class="${cls}" x="${x}" y="${y}" text-anchor="${anchor}">${t}</text>`;
const tick = (x0, y0, x1, y1) => `<path class="a" d="M${x0} ${y0}L${x1} ${y1}"/>`;

export const GUIDE = {
  p1: {
    title: "P1: knuckle to middle joint",
    // Half fist from the side: back of the hand, knuckle bent 90°, P1 down, middle joint bent 90°.
    svg: svg(`
      <path class="f" d="M8 34H60V76H30"/>
      <path class="f thin" d="M30 76H22"/>
      ${dot(60, 34)}${dot(60, 76)}${dot(34, 76)}
      ${label(8, 16, "back of the hand", "start", "m")}
      <path class="a" d="M80 26V84"/>${tick(74, 26, 86, 26)}${tick(74, 84, 86, 84)}
      <path class="m-line dash" d="M68 26H76M68 84H76"/>
      ${label(94, 29, "knuckle top (MCP)", "start", "m")}
      ${label(94, 59, "P1")}
      ${label(94, 87, "middle joint top (PIP)", "start", "m")}`),
    text: `<p>The finger's first segment (proximal phalanx), from the knuckle to the middle joint.</p>
      <ol>
        <li>Make a half fist: knuckles and middle joints bent to 90°.</li>
        <li>On the back of the finger, measure from the top of the knuckle to the top of the middle joint.</li>
        <li>Ruler or calliper, to 0.5 mm. Measure all four fingers the same way: only the differences between them set the steps.</li>
      </ol>`,
  },
  w: {
    title: "Width: the finger at its end joint",
    // Fingertip from above: end joint crease, width across it.
    svg: svg(`
      <path class="f-body" d="M40 98V34Q40 8 64 8Q88 8 88 34V98Z"/>
      <path class="m-line" d="M42 62Q64 66 86 62"/><path class="m-line" d="M42 92Q64 96 86 92"/>
      <path class="a" d="M30 62H98"/>${tick(30, 55, 30, 69)}${tick(98, 55, 98, 69)}
      ${label(106, 60, "width")}${label(106, 74, "at the end joint (DIP)", "start", "m")}
      ${label(106, 95, "middle joint", "start", "m")}`),
    text: `<p>Sets how much of the edge each finger gets, so the steps line up with your fingers.</p>
      <ol>
        <li>Fingers relaxed and straight.</li>
        <li>Measure side to side across the end joint (the last joint before the fingertip).</li>
        <li>Fingers pressed together on the edge take a bit less room; if the plate comes out too wide, take 0.5–1 mm off each.</li>
      </ol>`,
  },
  k: {
    title: "Knuckle: offset from the middle finger's knuckle",
    // Half fist from above: four knuckles on an arc, the middle finger's as the zero line.
    svg: svg(`
      <path class="f-body" d="M24 100V70Q24 56 40 54L104 44Q118 41 132 44L168 48Q182 50 182 64V100Z"/>
      <path class="m-line dash" d="M6 44H194"/>
      ${dot(48, 62)}${dot(84, 50)}${dot(118, 44)}${dot(154, 48)}
      ${label(48, 80, "little", "middle", "m")}${label(84, 68, "ring", "middle", "m")}${label(118, 62, "middle", "middle", "m")}${label(154, 66, "index", "middle", "m")}
      <path class="a" d="M30 44V62"/>${tick(25, 62, 35, 62)}
      ${label(8, 20, "little: −6 mm, further back", "start")}<path class="m-line" d="M24 24L30 40"/>
      ${label(194, 36, "0 = middle finger's knuckle", "end", "m")}`),
    text: `<p>How far each knuckle sits towards the fingertips (+) or back towards the wrist (−) compared with the middle finger's knuckle. A knuckle further back means that finger reaches less far, so its step comes out higher.</p>
      <ol>
        <li>Make a half fist and look at the back of the hand from above.</li>
        <li>Lay a ruler across the top of the middle finger's knuckle, square to the fingers.</li>
        <li>Measure how far in front of (+) or behind (−) that line each other knuckle sits. Little finger: often −5 to −10 mm.</li>
        <li>Not sure? Leave 0. The photo measurement (half fist) does this for you.</li>
      </ol>`,
  },
};

// One floating card for all (i) buttons inside root.
export function attachGuide(root) {
  const tip = document.createElement("div");
  tip.className = "guide-tip";
  tip.id = "guideTip";
  tip.setAttribute("role", "tooltip");
  tip.hidden = true;
  document.body.append(tip);
  let owner = null, pinned = false;

  const place = (btn) => {
    const r = btn.getBoundingClientRect(), gutter = 16;
    const w = Math.min(360, window.innerWidth - 2 * gutter);
    tip.style.width = `${w}px`;
    const left = Math.min(Math.max(gutter, r.left + r.width / 2 - w / 2), window.innerWidth - gutter - w);
    tip.style.left = `${left}px`;
    // the side with more room; scroll inside the card if it still does not fit
    const roomBelow = window.innerHeight - r.bottom - 16, roomAbove = r.top - 16;
    const down = roomBelow >= tip.scrollHeight || roomBelow >= roomAbove;
    const room = Math.max(120, down ? roomBelow : roomAbove);
    tip.style.maxHeight = `${room}px`;
    const h = Math.min(tip.scrollHeight, room);
    tip.style.top = `${down ? r.bottom + 8 : r.top - 8 - h}px`;
  };
  const show = (btn) => {
    const g = GUIDE[btn.dataset.guide];
    if (!g) return;
    if (owner !== btn) {
      tip.innerHTML = `<b>${g.title}</b>${g.svg}${g.text}`;
      owner?.setAttribute("aria-expanded", "false");
      owner = btn;
    }
    tip.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    btn.setAttribute("aria-describedby", tip.id);
    place(btn);
  };
  const hide = () => {
    tip.hidden = true;
    pinned = false;
    owner?.setAttribute("aria-expanded", "false");
    owner?.classList.remove("pinned");
  };

  root.addEventListener("mouseover", (e) => { const b = e.target.closest(".info"); if (b && !pinned) show(b); });
  root.addEventListener("mouseout", (e) => { const b = e.target.closest(".info"); if (b && !pinned && !b.contains(e.relatedTarget)) hide(); });
  root.addEventListener("focusin", (e) => { const b = e.target.closest(".info"); if (b && !pinned) show(b); });
  root.addEventListener("focusout", (e) => { if (e.target.closest(".info") && !pinned) hide(); });
  root.addEventListener("click", (e) => {
    const b = e.target.closest(".info");
    if (!b) return;
    e.preventDefault();
    if (pinned && owner === b) { hide(); return; }
    owner?.classList.remove("pinned");
    show(b);
    pinned = true;
    b.classList.add("pinned");
  });
  document.addEventListener("click", (e) => { if (pinned && !e.target.closest(".info") && !tip.contains(e.target)) hide(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !tip.hidden) { const b = owner; hide(); b?.focus(); } });
  window.addEventListener("resize", () => { if (!tip.hidden && owner) place(owner); });
  window.addEventListener("scroll", () => { if (!tip.hidden && owner) place(owner); }, { passive: true, capture: true });
}

export const infoButton = (key, what) =>
  `<button type="button" class="info" data-guide="${key}" aria-label="How to measure: ${what}" aria-expanded="false">i</button>`;
