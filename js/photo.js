// Photo dialog: the user clicks landmarks on a photo with a ruler in it; js/handphoto.js turns them
// into hand measurements. The image is only drawn into a local canvas, never sent anywhere.

import { FINGERS } from "./hand.js";
import { photoSteps, measureHand } from "./handphoto.js";
import { detectHand } from "./detect.js";

let STEPS = photoSteps("fist");
const LINES = [["rA", "rB"], ...FINGERS.flatMap((f) => [[`${f}Base`, `${f}Pip`], [`${f}D1`, `${f}D2`]])];

export function setupPhotoDialog({ onUse, defaultSide }) {
  const dlg = document.getElementById("photoDialog");
  const canvas = document.getElementById("photoCanvas");
  const ctx = canvas.getContext("2d");
  const file = document.getElementById("photoFile");
  const rulerMm = document.getElementById("rulerMm");
  const zoom = document.getElementById("photoZoom");
  const status = document.getElementById("photoStatus");
  const useBtn = document.getElementById("photoUse");
  let img = null, pts = [], dragIdx = -1, result = null;
  const sideSel = document.getElementById("photoSide");
  sideSel.addEventListener("change", () => { STEPS = photoSteps(sideSel.value); pts = pts.slice(0, 2); draw(); update(); });
  const nextIdx = () => { for (let i = 0; i < STEPS.length; i++) if (!pts[i]) return i; return -1; };
  const placed = () => pts.filter(Boolean).length;

  const byId = (id) => pts[STEPS.findIndex((s) => s.id === id)];

  function fitZoom() {
    const avail = canvas.parentElement.clientWidth - 2;
    zoom.value = Math.min(3, Math.max(0.1, avail / img.width)).toFixed(2);
  }

  function draw() {
    if (!img) return;
    const z = Number(zoom.value);
    canvas.width = Math.round(img.width * z);
    canvas.height = Math.round(img.height * z);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const [a, b] of LINES) {
      const p = byId(a), q = byId(b);
      if (!p || !q) continue;
      ctx.strokeStyle = STEPS.find((s) => s.id === a).color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(p.x * z, p.y * z); ctx.lineTo(q.x * z, q.y * z); ctx.stroke();
    }
    pts.forEach((p, i) => {
      if (!p) return;
      const st = STEPS[i];
      ctx.fillStyle = st.color; ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x * z, p.y * z, 6, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
      if (i < 2 || /Base|D1/.test(st.id)) {
        const text = st.short ?? "ruler";
        ctx.font = "bold 12px system-ui"; ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,.7)";
        ctx.strokeText(text, p.x * z + 9, p.y * z - 9); ctx.fillStyle = "#fff"; ctx.fillText(text, p.x * z + 9, p.y * z - 9);
      }
    });
    update();
  }

  function update() {
    result = null;
    if (!img) return;
    const next = nextIdx();
    if (next >= 0) status.textContent = `Point ${placed() + 1} of ${STEPS.length}: click the ${STEPS[next].label}.`;
    if (!pts[0] || !pts[1]) { useBtn.disabled = true; return; }
    const named = Object.fromEntries(pts.map((p, i) => [STEPS[i].id, p]).filter(([, p]) => p));
    const { values, parts } = measureHand(sideSel.value, named, Number(rulerMm.value));
    if (next < 0) status.textContent = `${parts.join(" · ")} mm. Drag a point to adjust.`;
    else if (parts.length) status.textContent += ` So far: ${parts.join(" · ")} mm.`;
    result = Object.keys(values).length ? values : null;
    useBtn.disabled = !result;
  }

  const toImg = (e) => {
    const r = canvas.getBoundingClientRect(), z = Number(zoom.value);
    return { x: (e.clientX - r.left) / z, y: (e.clientY - r.top) / z };
  };
  canvas.addEventListener("pointerdown", (e) => {
    if (!img) return;
    const p = toImg(e), z = Number(zoom.value);
    dragIdx = pts.findIndex((q) => q && Math.hypot(q.x - p.x, q.y - p.y) * z < 12);
    if (dragIdx < 0 && nextIdx() >= 0) { dragIdx = nextIdx(); pts[dragIdx] = p; }
    try { canvas.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    draw();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (dragIdx < 0) return;
    pts[dragIdx] = toImg(e);
    draw();
  });
  canvas.addEventListener("pointerup", () => { dragIdx = -1; });

  file.addEventListener("change", () => {
    const f = file.files[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    const im = new Image();
    im.onload = () => { img = im; pts = []; fitZoom(); draw(); URL.revokeObjectURL(url); };
    im.onerror = () => { status.textContent = "Could not read that image."; };
    im.src = url;
  });
  zoom.addEventListener("input", draw);
  rulerMm.addEventListener("input", update);
  document.getElementById("photoUndo").addEventListener("click", () => {
    for (let i = pts.length - 1; i >= 0; i--) if (pts[i]) { pts[i] = undefined; break; }
    draw();
  });
  const detectBtn = document.getElementById("photoDetect");
  detectBtn.addEventListener("click", async () => {
    if (!img) { status.textContent = "Load a photo first."; return; }
    detectBtn.disabled = true;
    status.textContent = "Detecting the hand… (the first time loads about 20 MB, then it stays in the browser)";
    try {
      const found = await detectHand(img);
      if (!found) { status.textContent = "No hand found. Place the points by hand, or try a photo with the whole hand in view."; return; }
      if (found.handedness === "Left" || found.handedness === "Right") handSel.value = found.handedness[0];
      // The width estimate assumes fingers held together; with spread fingers it is far too wide.
      // Keep it only when it is plausible (needs the ruler for the scale).
      const mm = pts[0] && pts[1] ? Number(rulerMm.value) / Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : null;
      const dropped = [];
      for (const f of FINGERS) {
        const a = found.points[`${f}D1`], b = found.points[`${f}D2`];
        const w = mm ? Math.hypot(a.x - b.x, a.y - b.y) * mm : null;
        if (w === null || w < 12 || w > 26) { delete found.points[`${f}D1`]; delete found.points[`${f}D2`]; dropped.push(f); }
      }
      STEPS.forEach((st, i) => { if (found.points[st.id]) pts[i] = found.points[st.id]; });
      draw();
      const widthNote = dropped.length && sideSel.value !== "fist"
        ? (mm ? "Widths not placed (fingers spread?): click both sides of each end joint. " : "Click the ruler first if you want the widths estimated too. ")
        : "";
      status.textContent = `Hand found (${found.handedness ?? "?"}${found.score ? `, ${Math.round(found.score * 100)}% sure` : ""}). `
        + widthNote + `${pts[0] && pts[1] ? "" : "Now click the two ruler marks. "}Check every point and drag it where it belongs: the model places joint centres from the hand's shape, a few millimetres off is normal. ` + status.textContent;
    } catch (err) {
      status.textContent = `Detection failed: ${err.message}`;
    } finally {
      detectBtn.disabled = false;
    }
  });
  document.getElementById("photoReset").addEventListener("click", () => { pts = []; draw(); });
  const handSel = document.getElementById("photoHand");
  useBtn.addEventListener("click", () => { if (result) { onUse(result, handSel.value); dlg.close(); } });

  return { open: () => { if (!img) handSel.value = defaultSide(); dlg.showModal(); if (img) draw(); } };
}
