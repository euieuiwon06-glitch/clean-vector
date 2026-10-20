// 변환은 워커에서: 화면이 멈추지 않게
import { toSVG } from './core/trace.js?v=c3507fa7';
import { convert, decideMode } from './core/overlay.js?v=c3507fa7';
import { upscale2x } from './core/upscale.js?v=c3507fa7';

async function encode(w, h, rgba, type = 'image/png', quality) {
  const c = new OffscreenCanvas(w, h);
  c.getContext('2d').putImageData(new ImageData(rgba, w, h), 0, 0);
  const blob = await c.convertToBlob({ type, quality });
  return new FileReaderSync().readAsDataURL(blob);
}

function tint(w, h, g, white) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = white ? 255 : 0;
    d[i * 4 + 3] = white ? g[i] : 255 - g[i];
  }
  return d;
}

function collectAnchors(res) {
  const pts = [], hds = [];
  for (const l of res.layers) {
    for (const p of l.paths) {
      const sh = p.circle || p.ellipse;
      if (sh) {
        const rx = sh.r ?? sh.rx, ry = sh.r ?? sh.ry;
        pts.push(sh.cx - rx, sh.cy, sh.cx + rx, sh.cy, sh.cx, sh.cy - ry, sh.cx, sh.cy + ry);
        continue;
      }
      let px = p.start[0], py = p.start[1];
      pts.push(px, py);
      for (const s of p.segs) {
        if (s.t === 'C') hds.push(px, py, s.x1, s.y1, s.x, s.y, s.x2, s.y2);
        pts.push(s.x, s.y);
        px = s.x; py = s.y;
      }
    }
  }
  for (const st of res.strokes || []) {
    let px = st.start[0], py = st.start[1];
    pts.push(px, py);
    for (const s of st.segs) {
      if (s.t === 'C') hds.push(px, py, s.x1, s.y1, s.x, s.y, s.x2, s.y2);
      pts.push(s.x, s.y);
      px = s.x; py = s.y;
    }
  }
  return { anchors: new Float32Array(pts), handles: new Float32Array(hds) };
}

self.onmessage = async (e) => {
  const { id, image, mode } = e.data;
  const t0 = Date.now();
  const opts = { background: true, photoFormat: 'image/jpeg' };
  try {
    const progress = (label, p) => self.postMessage({ id, type: 'progress', label, p });
    // 그래픽은 AI 2배 확대 후 변환(큰 이미지는 생략, 실패하면 원본으로)
    const m = decideMode(image, mode);
    let src = image, k = 1, aiNote = '';
    if (m === 'graphic' && image.width * image.height <= 2_600_000) {
      try { progress('AI 확대 준비', 0.01); src = await upscale2x(image, progress); k = 2; }
      catch (err) { aiNote = 'AI 확대 실패: ' + (err && err.message || err); }
    }
    const res = convert(src, m, progress);
    const hrefs = { photos: [], shades: [] };
    const { width: W, data } = src;
    for (const r of res.photos || []) {
      const d = new Uint8ClampedArray(r.w * r.h * 4);
      for (let y = 0; y < r.h; y++) d.set(data.subarray(((r.y + y) * W + r.x) * 4, ((r.y + y) * W + r.x + r.w) * 4), y * r.w * 4);
      hrefs.photos.push(await encode(r.w, r.h, d, opts.photoFormat, 0.92));
    }
    if (res.plate) hrefs.plate = await encode(res.width, res.height, res.plate, opts.photoFormat, 0.92);
    for (const sh of res.shades || []) {
      hrefs.shades.push(sh ? {
        mul: sh.mul && (await encode(sh.w, sh.h, tint(sh.w, sh.h, sh.mul, false))),
        scr: sh.scr && (await encode(sh.w, sh.h, tint(sh.w, sh.h, sh.scr, true))),
      } : null);
    }
    const svg = toSVG(res, { background: opts.background, hrefs, outW: image.width, outH: image.height });
    const { anchors, handles } = collectAnchors(res);
    if (k !== 1) { for (let i = 0; i < anchors.length; i++) anchors[i] /= k; for (let i = 0; i < handles.length; i++) handles[i] /= k; }
    self.postMessage({
      id, type: 'done', svg, anchors, handles,
      info: { mode: res.mode, ai: k > 1, aiNote, stats: { ...res.stats, ms: Date.now() - t0 }, palette: res.palette, background: res.background, photos: res.photos || [], targets: res.targets || [], width: res.width, height: res.height },
    }, [anchors.buffer, handles.buffer]);
  } catch (err) {
    self.postMessage({ id, type: 'error', message: String(err && err.stack || err) });
  }
};
