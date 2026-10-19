import fs from 'node:fs';
import { PNG } from 'pngjs';
import { trace } from '../src/core/trace.js';
const [file, X, Y] = process.argv.slice(2);
const png = PNG.sync.read(fs.readFileSync(file));
const r = trace({ width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) }, { scale: 2 });
let best = null, bd = 1e9;
for (const st of r.strokes) { const pts = [st.start, ...st.segs.map((g) => [g.x, g.y])]; for (const p of pts) { const d = Math.hypot(p[0] - X, p[1] - Y); if (d < bd) { bd = d; best = st; } } }
console.log('dist', bd.toFixed(1), 'closed', best.closed, 'w', best.width);
console.log(best.start.map((v) => v.toFixed(1)).join(','), best.segs.map((g) => g.t + g.x.toFixed(1) + ',' + g.y.toFixed(1)).join(' '));
