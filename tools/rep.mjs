// 반복 묶음 시각화: node tools/rep.mjs file
import fs from 'node:fs';
import { PNG } from 'pngjs';
import { compositeOnWhite } from '../src/core/palette.js';
import { unifyRepeats } from '../src/core/repeat.js';
const png = PNG.sync.read(fs.readFileSync(process.argv[2]));
const img = compositeOnWhite({ width: png.width, height: png.height, data: png.data });
const t = Date.now();
const r = unifyRepeats(img, process.argv[3] ? JSON.parse(process.argv[3]) : {});
console.log('ms', Date.now() - t, 'clusters', r.clusters.map((c) => `${c.count}x ${c.w}x${c.h}`).join(' | '));
const o = new PNG({ width: png.width, height: png.height });
o.data = Buffer.from(r.img.data);
const cols = [[255, 0, 0], [0, 0, 255], [255, 128, 0], [160, 0, 200], [0, 160, 160], [200, 0, 120]];
r.clusters.forEach((c, k) => { const col = cols[k % cols.length]; for (const [x, y] of c.at) for (let i = 0; i < c.w; i++) for (const yy of [y, y + c.h - 1]) { const j = (yy * png.width + x + i) * 4; o.data[j] = col[0]; o.data[j + 1] = col[1]; o.data[j + 2] = col[2]; } });
fs.writeFileSync('out/rep.png', PNG.sync.write(o));
