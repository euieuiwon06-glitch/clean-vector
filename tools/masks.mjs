// 색별 마스크를 이미지로: node tools/masks.mjs file x y w h
import fs from 'node:fs';
import { PNG } from 'pngjs';
import { compositeOnWhite, buildPalette, unmix } from '../src/core/palette.js';
const [file, X, Y, W, H] = process.argv.slice(2).map((v, i) => (i ? +v : v));
const png = PNG.sync.read(fs.readFileSync(file));
const img = compositeOnWhite({ width: png.width, height: png.height, data: png.data });
const pal = buildPalette(img, 'auto');
const um = unmix(img, pal);
console.log(pal, 'bg', um.bg);
const K = pal.length, out = new PNG({ width: W * K, height: H });
for (let k = 0; k < K; k++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const v = 255 - Math.round(um.masks[k][(Y + y) * png.width + X + x] * 255);
  const o = (y * W * K + k * W + x) * 4;
  out.data[o] = out.data[o + 1] = out.data[o + 2] = v; out.data[o + 3] = 255;
}
fs.writeFileSync('out/masks.png', PNG.sync.write(out));
