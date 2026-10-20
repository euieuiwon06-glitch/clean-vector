import fs from 'node:fs';
import { PNG } from 'pngjs';
import { compositeOnWhite, buildPalette, unmix } from '../src/core/palette.js';
import { extractStrokes } from '../src/core/strokes.js';
const png = PNG.sync.read(fs.readFileSync(process.argv[2]));
const img = compositeOnWhite({ width: png.width, height: png.height, data: png.data });
const pal = buildPalette(img, 'auto'); const um = unmix(img, pal);
const w = img.width, h = img.height;
pal.forEach((c, k) => {
  if (k === um.bg) return;
  const r = extractStrokes(um.masks[k], w, h, { binTh: 0.35, maxHalf: 2.2 * Math.sqrt((w * h) / 1.5e6) });
  const near = r.strokes.filter((st) => Math.abs(st.start[1] - 1410) < 30 || st.segs.some((g) => Math.abs(g.y - 1410) < 30));
  console.log(c, 'strokes', r.strokes.length, 'near walkway', near.length, near.slice(0, 4).map((st) => st.start.map(Math.round) + '->' + [st.segs.at(-1).x, st.segs.at(-1).y].map(Math.round) + ' w' + st.width.toFixed(1)));
});
