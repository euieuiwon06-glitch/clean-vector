// 선 끝 품질 측정: node tools/ends.mjs file
// gap: 끝이 다른 선에서 0.6~5px 떨어져 멈춤 / over: 끝이 다른 선을 0.6~5px 넘어감 / stub: 5px 미만 짧은 선
import fs from 'node:fs';
import { PNG } from 'pngjs';
import { trace } from '../src/core/trace.js';
const png = PNG.sync.read(fs.readFileSync(process.argv[2]));
const r = trace({ width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) }, { scale: 1 });
const S = r.strokes || [];
const segs = [];
S.forEach((st, k) => { let p = st.start; for (const g of st.segs) { segs.push([k, p, [g.x, g.y]]); p = [g.x, g.y]; } });
let gap = 0, over = 0, stub = 0, ends = 0;
const len = (st) => { let p = st.start, L = 0; for (const g of st.segs) { L += Math.hypot(g.x - p[0], g.y - p[1]); p = [g.x, g.y]; } return L; };
for (const [k, st] of S.entries()) {
  if (st.closed) continue;
  if (len(st) < 5) stub++;
  const pts = [st.start, ...st.segs.map((g) => [g.x, g.y])];
  for (const [e, q] of [[pts[0], pts[1]], [pts[pts.length - 1], pts[pts.length - 2]]]) {
    ends++;
    const dx = e[0] - q[0], dy = e[1] - q[1], l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l;
    let best = Infinity;
    for (const [kk, a, b] of segs) {
      if (kk === k) continue;
      const sx = b[0] - a[0], sy = b[1] - a[1], den = ux * sy - uy * sx;
      if (Math.abs(den) < 0.3 * Math.hypot(sx, sy)) continue;
      const t = ((a[0] - e[0]) * sy - (a[1] - e[1]) * sx) / den, u = ((a[0] - e[0]) * uy - (a[1] - e[1]) * ux) / den;
      if (u < 0 || u > 1 || Math.abs(t) > 5) continue;
      if (Math.abs(t) < Math.abs(best)) best = t;
    }
    if (best === Infinity) continue;
    if (best > 0.6) gap++; else if (best < -0.6) over++;
  }
}
console.log({ strokes: S.length, ends, gap, over, stub });
