// 노드 검증용: node tools/run.mjs samples/x.png [옵션JSON]
// out/에 SVG, 렌더 PNG, 확대 비교 이미지를 만든다.
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { Resvg } from '@resvg/resvg-js';
import { trace, toSVG } from '../src/core/trace.js';
import { traceOverlay, convert } from '../src/core/overlay.js';

const file = process.argv[2];
const opts = process.argv[3] ? JSON.parse(process.argv[3]) : {};
const png = PNG.sync.read(fs.readFileSync(file));
const img = { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) };

const prog = (s, p) => process.stdout.write(`\r${s} ${Math.round(p * 100)}%   `);
// 옵션 없이 실행하면 앱과 같은 자동 변환
const res = opts.mode === 'overlay' ? traceOverlay(img, opts, prog)
  : opts.mode === 'graphic' ? trace(img, opts, prog)
  : convert(img, 'auto', prog);
console.log('\nmode', res.mode, res.palette, 'bg', res.background, res.stats, 'photos', res.photos, res.targets || '');

const toPng = (w, h, rgba) => {
  const c = new PNG({ width: w, height: h });
  c.data = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  return 'data:image/png;base64,' + PNG.sync.write(c).toString('base64');
};
// 그림자: 검정 + 알파(255-곱하기값), 반사광: 흰색 + 알파(스크린값)
const tint = (w, h, g, white) => {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = white ? 255 : 0; d[i * 4 + 3] = white ? g[i] : 255 - g[i]; }
  return toPng(w, h, d);
};
const hrefs = { photos: [], shades: [] };
for (const r of res.photos || []) {
  const d = new Uint8ClampedArray(r.w * r.h * 4);
  for (let y = 0; y < r.h; y++) d.set(png.data.subarray(((r.y + y) * png.width + r.x) * 4, ((r.y + y) * png.width + r.x + r.w) * 4), y * r.w * 4);
  hrefs.photos.push(toPng(r.w, r.h, d));
}
if (res.plate) { hrefs.plate = toPng(res.width, res.height, res.plate); fs.mkdirSync('out', { recursive: true }); fs.writeFileSync('out/plate.png', Buffer.from(hrefs.plate.split(',')[1], 'base64')); }
for (const sh of res.shades || []) hrefs.shades.push(sh ? { mul: sh.mul && tint(sh.w, sh.h, sh.mul, false), scr: sh.scr && tint(sh.w, sh.h, sh.scr, true) } : null);
const svg = toSVG(res, { hrefs });
const base = path.basename(file, path.extname(file));
fs.mkdirSync('out', { recursive: true });
fs.writeFileSync(`out/${base}.svg`, svg);
console.log('svg bytes', svg.length);
const scale = Number(process.env.RENDER_SCALE || 1);
const r = new Resvg(svg, { fitTo: { mode: 'zoom', value: scale } }).render();
fs.writeFileSync(`out/${base}.render.png`, r.asPng());
