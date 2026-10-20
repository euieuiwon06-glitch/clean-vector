// AI 2배 확대(Real-ESRGAN animevideov3, BSD-3-Clause, models/LICENSE-Real-ESRGAN.txt)
// 4배로 키운 뒤 2x2 평균으로 줄여 2배 이미지를 만든다. 흐린 선이 또렷해지고 음영 얼룩이 줄어 벡터화가 정확해진다.
const ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/';
let sessionP = null;

async function getSession() {
  if (sessionP) return sessionP;
  sessionP = (async () => {
    const useGpu = typeof navigator !== 'undefined' && !!navigator.gpu;
    const ort = await import(/* @vite-ignore */ ORT + (useGpu ? 'ort.webgpu.min.mjs' : 'ort.wasm.min.mjs'));
    ort.env.wasm.wasmPaths = ORT;
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
    const url = new URL('../../models/realesr-animevideov3.onnx', import.meta.url);
    const providers = useGpu ? ['webgpu', 'wasm'] : ['wasm'];
    try {
      return { ort, s: await ort.InferenceSession.create(url.href, { executionProviders: providers }) };
    } catch (e) {
      if (!useGpu) throw e;
      return { ort, s: await ort.InferenceSession.create(url.href, { executionProviders: ['wasm'] }) };
    }
  })();
  try { return await sessionP; } catch (e) { sessionP = null; throw e; }
}

export async function upscale2x(img, progress = () => {}) {
  const { ort, s } = await getSession();
  const { width: w, height: h, data } = img;
  const W2 = w * 2, H2 = h * 2;
  const out = new Uint8ClampedArray(W2 * H2 * 4);
  const T = 128, P = 8;
  const tiles = Math.ceil(w / T) * Math.ceil(h / T);
  let done = 0;
  for (let ty = 0; ty < h; ty += T) for (let tx = 0; tx < w; tx += T) {
    const x0 = Math.max(0, tx - P), y0 = Math.max(0, ty - P), x1 = Math.min(w, tx + T + P), y1 = Math.min(h, ty + T + P);
    const tw = x1 - x0, th = y1 - y0, n = tw * th;
    const inp = new Float32Array(3 * n);
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      const i = ((y0 + y) * w + x0 + x) * 4, j = y * tw + x;
      inp[j] = data[i] / 255; inp[n + j] = data[i + 1] / 255; inp[2 * n + j] = data[i + 2] / 255;
    }
    const r = await s.run({ input: new ort.Tensor('float32', inp, [1, 3, th, tw]) });
    const o = r.output.data, OW = tw * 4, ON = OW * th * 4;
    // 이 타일이 맡은 영역(여백 제외)만 2배 크기로 줄여 담는다
    const cw = Math.min(T, w - tx), ch = Math.min(T, h - ty);
    for (let y = 0; y < ch * 2; y++) for (let x = 0; x < cw * 2; x++) {
      const sx = (tx - x0) * 4 + x * 2, sy = (ty - y0) * 4 + y * 2;
      const k = ((ty * 2 + y) * W2 + tx * 2 + x) * 4;
      for (let c = 0; c < 3; c++) {
        const b = c * ON;
        const v = (o[b + sy * OW + sx] + o[b + sy * OW + sx + 1] + o[b + (sy + 1) * OW + sx] + o[b + (sy + 1) * OW + sx + 1]) / 4;
        out[k + c] = v * 255 + 0.5;
      }
      out[k + 3] = 255;
    }
    progress('AI 확대', 0.02 + 0.3 * (++done / tiles));
  }
  return { width: W2, height: H2, data: out };
}
