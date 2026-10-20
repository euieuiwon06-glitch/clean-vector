// 자동 모드 판단 확인: 어떤 방식으로 가는지, 그래픽인데 사진 영역으로 빠지는 곳이 있는지
import fs from 'node:fs';
import { PNG } from 'pngjs';
import { decideMode } from '../src/core/overlay.js';
import { compositeOnWhite } from '../src/core/palette.js';
import { photoBlocks } from '../src/core/trace.js';
for (const f of process.argv.slice(2)) {
  const png = PNG.sync.read(fs.readFileSync(f));
  const img = { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) };
  const m = decideMode(img, 'auto');
  const pb = photoBlocks(compositeOnWhite(img));
  console.log(f.split('/').pop(), 'mode', m, 'photoCoverage', pb.coverage.toFixed(2));
}
