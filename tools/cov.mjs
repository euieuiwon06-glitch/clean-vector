// 잉크 덮임 맵 저장: node tools/cov.mjs file x y w h
import fs from 'node:fs';
import { PNG } from 'pngjs';
import { trace } from '../src/core/trace.js';
const [file, X, Y, W, H] = process.argv.slice(2).map((v, i) => (i ? +v : v));
const png = PNG.sync.read(fs.readFileSync(file));
trace({ width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) }, {
  scale: 2, debugCov: (m) => {
    const out = new PNG({ width: W, height: H });
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = 255 - Math.round(m[(Y + y) * png.width + X + x] * 255), o = (y * W + x) * 4;
      out.data[o] = out.data[o + 1] = out.data[o + 2] = v; out.data[o + 3] = 255;
    }
    fs.writeFileSync('out/cov.png', PNG.sync.write(out));
  },
});
