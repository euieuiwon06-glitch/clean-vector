import fs from 'node:fs';
import { PNG } from 'pngjs';
import { compositeOnWhite } from '../src/core/palette.js';
import { findRepeats } from '../src/core/repeat.js';
const png = PNG.sync.read(fs.readFileSync(process.argv[2]));
const img = compositeOnWhite({ width: png.width, height: png.height, data: png.data });
const r = findRepeats(img);
const inBox = r.cand.filter((c) => c.x0 > 80 && c.x1 < 380 && c.y0 > 760 && c.y1 < 960);
console.log('cand total', r.cand.length, 'in room', inBox.length, inBox.map((c) => `${c.x0},${c.y0} ${c.bw}x${c.bh} n${c.n}`).join(' | '));
console.log('links', r.links.length, r.links.slice(0, 20).map((l) => l[2].toFixed(2)).join(' '));
// 덩어리 맵 저장
const o = new PNG({ width: 300, height: 200 });
for (let y = 0; y < 200; y++) for (let x = 0; x < 300; x++) { const i = (760 + y) * png.width + 80 + x, id = r.comp[i], j = (y * 300 + x) * 4; const v = id < 0 ? 255 : (id * 97) % 200; o.data[j] = v; o.data[j + 1] = id < 0 ? 255 : (id * 53) % 200; o.data[j + 2] = id < 0 ? 255 : (id * 29) % 200; o.data[j + 3] = 255; }
fs.writeFileSync('out/comp.png', PNG.sync.write(o));
