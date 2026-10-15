// Small WebGL viewer: flat-shaded part on a bed grid, translucent modifier zones, orbit + zoom.
// Z is up (print orientation).

const VS = `
attribute vec3 aPos; attribute vec3 aNrm;
uniform mat4 uMvp; varying vec3 vN; varying vec2 vXY;
void main() { vN = aNrm; vXY = aPos.xy; gl_Position = uMvp * vec4(aPos, 1.0); }`;
const FS = `
precision mediump float;
uniform vec4 uColor; uniform vec3 uLight; uniform float uLit; varying vec3 vN; varying vec2 vXY;
uniform vec4 uBox0; uniform vec4 uBox1; uniform float uBoxes; // highlight clipping: x0, x1, y0, y1
bool inBox(vec4 b) { return vXY.x >= b.x && vXY.x <= b.y && vXY.y >= b.z && vXY.y <= b.w; }
void main() {
  if (uBoxes > 0.5 && !(inBox(uBox0) || (uBoxes > 1.5 && inBox(uBox1)))) discard;
  float d = abs(dot(normalize(vN), uLight));
  float k = mix(1.0, 0.45 + 0.55 * d, uLit);
  gl_FragColor = vec4(uColor.rgb * k, uColor.a);
}`;

function mul(a, b) {
  const o = new Float32Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
    o[i * 4 + j] = s;
  }
  return o;
}
function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}
function lookAt(eye, c, up) {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
  const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const z = norm(sub(eye, c)), x = norm(crs(up, z)), y = crs(z, x);
  const dt = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dt(x, eye), -dt(y, eye), -dt(z, eye), 1]);
}

// Non-indexed triangles with face normals.
function flatten(mesh) {
  const { positions: P, indices: I } = mesh;
  const pos = new Float32Array(I.length * 3), nrm = new Float32Array(I.length * 3);
  for (let t = 0; t < I.length; t += 3) {
    const v = [0, 1, 2].map((k) => [P[3 * I[t + k]], P[3 * I[t + k] + 1], P[3 * I[t + k] + 2]]);
    const u = v[1].map((x, i) => x - v[0][i]), w = v[2].map((x, i) => x - v[0][i]);
    let n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const l = Math.hypot(...n) || 1;
    n = n.map((x) => x / l);
    for (let k = 0; k < 3; k++) {
      pos.set(v[k], (t + k) * 3);
      nrm.set(n, (t + k) * 3);
    }
  }
  return { pos, nrm, count: I.length };
}

const cssColor = (name, fallback) => {
  const c = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  const probe = document.createElement("canvas").getContext("2d");
  probe.fillStyle = c;
  const hex = probe.fillStyle;
  if (hex.startsWith("#")) return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const m = hex.match(/[\d.]+/g).map(Number);
  return [m[0] / 255, m[1] / 255, m[2] / 255];
};

export function createViewer(canvas) {
  const gl = canvas.getContext("webgl", { antialias: true });
  if (!gl) {
    canvas.replaceWith(Object.assign(document.createElement("p"), { className: "note", textContent: "3D preview needs WebGL." }));
    return { setMeshes() {}, setShowZones() {}, setHighlight() {} };
  }
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  const loc = {
    pos: gl.getAttribLocation(prog, "aPos"), nrm: gl.getAttribLocation(prog, "aNrm"),
    mvp: gl.getUniformLocation(prog, "uMvp"), color: gl.getUniformLocation(prog, "uColor"),
    light: gl.getUniformLocation(prog, "uLight"), lit: gl.getUniformLocation(prog, "uLit"),
    box0: gl.getUniformLocation(prog, "uBox0"), box1: gl.getUniformLocation(prog, "uBox1"), boxes: gl.getUniformLocation(prog, "uBoxes"),
  };
  const buffers = {};
  const upload = (key, data) => {
    if (!data) { buffers[key] = null; return; }
    const pb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.bufferData(gl.ARRAY_BUFFER, data.pos, gl.STATIC_DRAW);
    const nb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, nb); gl.bufferData(gl.ARRAY_BUFFER, data.nrm, gl.STATIC_DRAW);
    buffers[key] = { pb, nb, count: data.count, mode: data.mode ?? gl.TRIANGLES };
  };

  let hlBoxes = null;
  let yaw = -0.7, pitch = 0.5, dist = 260, target = [0, 0, 40], showZones = true;

  function grid(size) {
    const pos = [], step = 10, h = Math.ceil(size / 2 / step) * step;
    for (let x = -h; x <= h; x += step) pos.push(x, -h, 0, x, h, 0, -h, x, 0, h, x, 0);
    return { pos: new Float32Array(pos), nrm: new Float32Array(pos.length).fill(0), count: pos.length / 3, mode: gl.LINES };
  }

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
    const bg = cssColor("--bg", "#f6f5f2");
    gl.clearColor(bg[0], bg[1], bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    const eye = [
      target[0] + dist * Math.cos(pitch) * Math.cos(yaw),
      target[1] + dist * Math.cos(pitch) * Math.sin(yaw),
      target[2] + dist * Math.sin(pitch),
    ];
    const view = lookAt(eye, target, [0, 0, 1]);
    const mvp = mul(perspective(0.6, w / Math.max(h, 1), 1, 5000), view);
    gl.uniformMatrix4fv(loc.mvp, false, mvp);
    gl.uniform1f(loc.boxes, 0);
    const L = [eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]];
    const ll = Math.hypot(...L);
    gl.uniform3f(loc.light, L[0] / ll * 0.8 + 0.2, L[1] / ll * 0.8, L[2] / ll * 0.8 + 0.3);
    const drawBuf = (b, color, lit) => {
      if (!b) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, b.pb); gl.enableVertexAttribArray(loc.pos); gl.vertexAttribPointer(loc.pos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, b.nb); gl.enableVertexAttribArray(loc.nrm); gl.vertexAttribPointer(loc.nrm, 3, gl.FLOAT, false, 0, 0);
      gl.uniform4fv(loc.color, color);
      gl.uniform1f(loc.lit, lit);
      gl.drawArrays(b.mode, 0, b.count);
    };
    drawBuf(buffers.grid, [...cssColor("--line", "#ddd"), 1], 0);
    drawBuf(buffers.body, [...cssColor("--part", "#e8e4da").map((x) => x * 0.95), 1], 1);
    if (buffers.hl) {
      // the highlighted faces lie exactly on the body: draw them on top
      gl.depthFunc(gl.LEQUAL); gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-1, -2);
      const bx = hlBoxes ?? [];
      gl.uniform1f(loc.boxes, bx.length);
      if (bx[0]) gl.uniform4fv(loc.box0, bx[0]);
      if (bx[1]) gl.uniform4fv(loc.box1, bx[1]);
      drawBuf(buffers.hl, [...cssColor("--accent", "#c2410c"), 1], 1);
      gl.uniform1f(loc.boxes, 0);
      gl.disable(gl.POLYGON_OFFSET_FILL); gl.depthFunc(gl.LESS);
    }
    if (showZones && buffers.zones) {
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
      drawBuf(buffers.zones, [...cssColor("--zone-line", "#2563eb"), 0.18], 0);
      gl.depthMask(true); gl.disable(gl.BLEND);
    }
  }

  // orbit / zoom
  let drag = null;
  canvas.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag) return;
    yaw -= (e.clientX - drag.x) * 0.01;
    pitch = Math.max(-1.4, Math.min(1.4, pitch + (e.clientY - drag.y) * 0.01));
    drag = { x: e.clientX, y: e.clientY };
    draw();
  });
  canvas.addEventListener("pointerup", () => { drag = null; });
  canvas.addEventListener("wheel", (e) => { e.preventDefault(); dist = Math.max(40, Math.min(2000, dist * Math.exp(e.deltaY * 0.001))); draw(); }, { passive: false });
  new ResizeObserver(draw).observe(canvas);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", draw);

  let framedSize = 0;
  return {
    setMeshes(body, zones, size) {
      upload("body", flatten(body));
      upload("zones", zones ? flatten(zones) : null);
      upload("grid", grid(Math.max(size.x, size.y) * 2 + 40));
      target = [0, 0, size.z / 2];
      const s = Math.max(size.x, size.y, size.z);
      if (!framedSize || Math.abs(s - framedSize) / framedSize > 0.25) { dist = s * 2.2; framedSize = s; }
      draw();
    },
    setShowZones(v) { showZones = v; draw(); },
    setHighlight(mesh) { upload("hl", mesh ? flatten(mesh) : null); hlBoxes = mesh?.regions ?? null; draw(); },
  };
}
