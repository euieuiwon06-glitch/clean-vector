import fs from 'node:fs';
import { PNG } from 'pngjs';
import { compositeOnWhite, buildPalette, unmix } from '../src/core/palette.js';
import { maskBounds, upsample, gaussianBlur, preserveThin, marchingSquares } from '../src/core/contour.js';
import { resampleClosed, analyzeContour, buildPath } from '../src/core/fit.js';
import { DEFAULTS } from '../src/core/trace.js';
const [file, px, py, ci] = process.argv.slice(2);
const png = PNG.sync.read(fs.readFileSync(file));
const img = compositeOnWhite({ width: png.width, height: png.height, data: png.data });
const pal = buildPalette(img, "auto"); const um = unmix(img, pal);
const w = img.width, h = img.height, o = DEFAULTS;
const c = +ci; const b = maskBounds(um.masks[c], w, h, 3);
const up = upsample(um.masks[c], w, b, 2); let f = gaussianBlur(up.f, up.W, up.H, o.blur * 2); f = preserveThin(f, up.W, up.H, 2);
const loops = marchingSquares(f, up.W, up.H, 0.5);
let best, bd = 1e9;
for (const l of loops) { const raw = l.map(([X, Y]) => [(X + .5) / 2 + b.x0, (Y + .5) / 2 + b.y0]); for (const p of raw) { const d = Math.hypot(p[0] - px, p[1] - py); if (d < bd) { bd = d; best = raw; } } }
const cc = resampleClosed(best, o.step);
const s = analyzeContour(cc, { ...o, debug: true, step: cc.length / cc.n });
console.log('n', cc.n, 'kind', s.kind);
if (s.runs) for (const r of s.runs) console.log('run', r.a, r.b, r.len.toFixed(1), r.snap, r.dx.toFixed(2), r.dy.toFixed(2), r.mx.toFixed(1), r.my.toFixed(1));
const p = buildPath(s, o);
console.log(p.segs?.map(g => g.t + ' ' + g.x.toFixed(1) + ',' + g.y.toFixed(1)).join('\n'));
console.log('start', p.start);
let prev = p.start;
for (const g of p.segs) {
  if (g.t === 'C') console.log('C', [prev, [g.x1, g.y1], [g.x2, g.y2], [g.x, g.y]].map(q => q.map(v => v.toFixed(1)).join(',')).join('  '));
  prev = [g.x, g.y];
}
