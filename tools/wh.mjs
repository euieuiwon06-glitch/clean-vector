import fs from 'node:fs';
import { PNG } from 'pngjs';
import { compositeOnWhite } from '../src/core/palette.js';
import { inkCoverage, extractStrokes } from '../src/core/strokes.js';
const png = PNG.sync.read(fs.readFileSync(process.argv[2]));
const img = compositeOnWhite({ width: png.width, height: png.height, data: png.data });
const cov = inkCoverage(img, [15, 18, 16]);
const r = extractStrokes(cov, png.width, png.height, {});
const H = {};
for (const s of r.strokes) { const k = Math.round(s.width * 4) / 4; H[k] = (H[k] || 0) + 1; }
console.log(H, r.strokes.length);
let f = 0; for (const v of r.fillMask) if (v > 0.5) f++; console.log('fill px', f);
