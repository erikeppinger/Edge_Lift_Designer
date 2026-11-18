// Triangles that are flat in the STL's 32-bit coordinates (two corners the same point, or all three in
// a line): slicers repair and report them.
export function flatTriangles({ positions, indices: I }) {
  const f = Float32Array.from(positions);
  let n = 0;
  for (let k = 0; k < I.length; k += 3) {
    const [a, b, c] = [I[k], I[k + 1], I[k + 2]].map((i) => [f[3 * i], f[3 * i + 1], f[3 * i + 2]]);
    const u = b.map((x, j) => x - a[j]), w = c.map((x, j) => x - a[j]);
    const area = Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]);
    const longest = Math.max(Math.hypot(...u), Math.hypot(...w), Math.hypot(...c.map((x, j) => x - b[j])));
    if (area <= 1e-12 * longest * longest) n++;
  }
  return n;
}
