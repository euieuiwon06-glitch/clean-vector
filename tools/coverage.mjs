// 폴더 안 PNG들의 사진 블록 비율: node tools/coverage.mjs <dir>
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { photoBlocks } from '../src/core/trace.js';
const dir = process.argv[2];
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.png'))) {
  const png = PNG.sync.read(fs.readFileSync(path.join(dir, f)));
  const pb = photoBlocks({ width: png.width, height: png.height, data: png.data });
  console.log(f, pb.coverage.toFixed(2), pb.coverage > 0.45 ? 'overlay' : 'graphic');
}
