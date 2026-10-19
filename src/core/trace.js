import { compositeOnWhite, buildPalette, unmix } from './palette.js';
import { maskBounds, upsample, gaussianBlur, preserveThin, marchingSquares } from './contour.js';
import { resampleClosed, analyzeContour, alignRuns, equalizeStrokes, buildPath } from './fit.js';

export const DEFAULTS = {
  colors: 'auto',   // 대표색 개수(숫자 또는 auto)
  scale: 2,         // 윤곽 추출 배율
  blur: 0.5,        // 가장자리 잡음 정리(px)
  thin: true,       // 얇은 획 보존
  minArea: 4,       // 이보다 작은 조각은 버림(px²)
  lineTol: 0.6,     // 직선 허용 오차(px)
  minRun: 3,        // 직선으로 인정할 최소 길이(px)
  snapDeg: 5,       // 수평·수직 고정 각도
  snap45: false,
  cornerTol: 0.9,   // 코너 복원 허용 오차(px)
  minFillet: 1.8,   // 이보다 작은 둥글림은 흐림 탓으로 보고 날카로운 코너로 복원(px)
  cornerAngle: 55,  // 곡선 속 코너로 볼 꺾임 각
  curveTol: 0.45,   // 곡선 허용 오차(px)
  circleTol: 0.35,
  align: true, alignTol: 0.4,
  strokes: true, strokeTol: 0.35, maxStroke: 40,
  photo: true, photoSens: 0.5,
  step: 0.35,
};

const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');

// 대표색 혼합으로 설명되지 않는 넓은 영역 = 사진. 블록 단위로 찾아서 직사각형 영역으로 묶는다.
function detectPhotos(img, um, o) {
  const { width: w, height: h } = img;
  const { label, resid } = um;
  const I = new Int32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += label[y * w + x] >= 0 ? 1 : 0;
      I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row;
    }
  }
  const R = 3;
  const coreNear = (x, y) => {
    const x0 = Math.max(0, x - R), y0 = Math.max(0, y - R), x1 = Math.min(w, x + R + 1), y1 = Math.min(h, y + R + 1);
    return I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];
  };
  const B = 16, bw = Math.ceil(w / B), bh = Math.ceil(h / B);
  const blk = new Uint8Array(bw * bh);
  const thr = 0.55 - o.photoSens * 0.4;
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let cnt = 0, tot = 0;
      for (let y = by * B; y < Math.min(h, by * B + B); y += 2) {
        for (let x = bx * B; x < Math.min(w, bx * B + B); x += 2) {
          tot++;
          const i = y * w + x;
          if ((label[i] < 0 && coreNear(x, y) === 0) || resid[i] > 40) cnt++;
        }
      }
      if (cnt / tot > thr) blk[by * bw + bx] = 1;
    }
  }
  // 한 칸 팽창 후 연결 성분 → 경계 상자
  const dil = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    if (!blk[y * bw + x]) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < bw && yy < bh) dil[yy * bw + xx] = 1;
    }
  }
  const seen = new Uint8Array(bw * bh);
  const rects = [];
  for (let s = 0; s < bw * bh; s++) {
    if (!dil[s] || seen[s]) continue;
    const st = [s]; seen[s] = 1;
    let x0 = bw, y0 = bh, x1 = 0, y1 = 0, core = 0;
    while (st.length) {
      const c = st.pop(), cx = c % bw, cy = (c / bw) | 0;
      if (blk[c]) core++;
      x0 = Math.min(x0, cx); x1 = Math.max(x1, cx); y0 = Math.min(y0, cy); y1 = Math.max(y1, cy);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = cx + dx, yy = cy + dy;
        if (xx < 0 || yy < 0 || xx >= bw || yy >= bh) continue;
        const k = yy * bw + xx;
        if (dil[k] && !seen[k]) { seen[k] = 1; st.push(k); }
      }
    }
    if (core >= 8) {
      rects.push({ x: x0 * B, y: y0 * B, w: Math.min(w, (x1 + 1) * B) - x0 * B, h: Math.min(h, (y1 + 1) * B) - y0 * B });
    }
  }
  return rects;
}

export function trace(input, opts = {}, progress = () => {}) {
  const o = { ...DEFAULTS, ...opts };
  const t0 = Date.now();
  let img = compositeOnWhite(input);
  const { width: w, height: h } = img;
  progress('색 정리', 0.05);
  let palette = buildPalette(img, o.colors);
  let um = unmix(img, palette);
  let photos = [];
  if (o.photo) {
    photos = detectPhotos(img, um, o);
    if (photos.length) {
      // 사진 영역을 빼고 대표색을 다시 뽑는다
      const bgc = palette[um.bg];
      const d = new Uint8ClampedArray(img.data);
      for (const r of photos) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
        const i = (y * w + x) * 4; d[i] = bgc[0]; d[i + 1] = bgc[1]; d[i + 2] = bgc[2];
      }
      img = { ...img, data: d };
      palette = buildPalette(img, o.colors);
      um = unmix(img, palette);
    }
  }
  const { masks, bg, counts } = um;
  for (const r of photos) for (const m of masks) for (let y = r.y; y < r.y + r.h; y++) m.fill(0, y * w + r.x, y * w + r.x + r.w);

  const order = palette.map((_, i) => i).filter((i) => i !== bg).sort((a, b) => counts[b] - counts[a]);
  const v = vectorize(order.map((ci) => ({ color: hex(palette[ci]), mask: masks[ci] })), w, h, o, progress);
  progress('완료', 1);
  return {
    mode: 'graphic',
    width: w, height: h, hasAlpha: img.hasAlpha,
    background: hex(palette[bg]), palette: palette.map(hex),
    layers: v.layers, photos,
    stats: { ...v.stats, ms: Date.now() - t0 },
  };
}

// 색별 마스크 → 정리된 패스 레이어
export function vectorize(items, w, h, o, progress = () => {}) {
  const layers = [];
  const allShapes = [];
  items.forEach(({ color, mask }, li) => {
    progress('윤곽 추출', 0.1 + 0.6 * (li / items.length));
    const b = maskBounds(mask, w, h, 3);
    if (!b) return;
    const s = o.scale;
    const up = upsample(mask, w, b, s);
    let f = gaussianBlur(up.f, up.W, up.H, o.blur * s);
    if (o.thin) f = preserveThin(f, up.W, up.H, s);
    const loops = marchingSquares(f, up.W, up.H, 0.5);
    const shapes = [];
    for (const loop of loops) {
      const raw = loop.map(([X, Y]) => [(X + 0.5) / s + b.x0, (Y + 0.5) / s + b.y0]);
      const c = resampleClosed(raw, o.step);
      if (c.area < o.minArea) continue;
      shapes.push(analyzeContour(c, { ...o, step: c.length / c.n }));
    }
    allShapes.push(...shapes);
    layers.push({ color, shapes, bounds: b });
  });
  progress('정렬', 0.75);
  if (o.align) alignRuns(allShapes, o.alignTol);
  if (o.strokes) equalizeStrokes(layers.map((l) => l.shapes), o);
  progress('패스 맞춤', 0.8);
  let anchors = 0, pathCount = 0;
  for (const l of layers) {
    l.paths = l.shapes.map((sh) => buildPath(sh, o));
    delete l.shapes;
    for (const p of l.paths) { pathCount++; anchors += p.circle || p.ellipse ? 4 : p.segs.length; }
  }
  return { layers, stats: { anchors, paths: pathCount } };
}

const f2 = (v) => {
  const s = (Math.round(v * 100) / 100).toString();
  return s === '-0' ? '0' : s;
};

export function pathData(p) {
  if (p.circle) {
    const { cx, cy, r } = p.circle;
    return `M${f2(cx - r)} ${f2(cy)}A${f2(r)} ${f2(r)} 0 1 0 ${f2(cx + r)} ${f2(cy)}A${f2(r)} ${f2(r)} 0 1 0 ${f2(cx - r)} ${f2(cy)}Z`;
  }
  if (p.ellipse) {
    const { cx, cy, rx, ry } = p.ellipse;
    return `M${f2(cx - rx)} ${f2(cy)}A${f2(rx)} ${f2(ry)} 0 1 0 ${f2(cx + rx)} ${f2(cy)}A${f2(rx)} ${f2(ry)} 0 1 0 ${f2(cx - rx)} ${f2(cy)}Z`;
  }
  let d = `M${f2(p.start[0])} ${f2(p.start[1])}`;
  let lx = p.start[0], ly = p.start[1];
  for (const s of p.segs) {
    if (s.t === 'L') {
      if (Math.abs(s.x - lx) < 0.005 && Math.abs(s.y - ly) < 0.005) continue;
      if (Math.abs(s.y - ly) < 0.005) d += `H${f2(s.x)}`;
      else if (Math.abs(s.x - lx) < 0.005) d += `V${f2(s.y)}`;
      else d += `L${f2(s.x)} ${f2(s.y)}`;
    } else d += `C${f2(s.x1)} ${f2(s.y1)} ${f2(s.x2)} ${f2(s.y2)} ${f2(s.x)} ${f2(s.y)}`;
    lx = s.x; ly = s.y;
  }
  return d + 'Z';
}

// hrefs: { photos: [사진 영역 data URI], plate: 배경 사진, shades: [{ mul, scr }] }
export function toSVG(res, { background = true, hrefs = {} } = {}) {
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${res.width} ${res.height}" width="${res.width}" height="${res.height}">`];
  if (res.mode === 'overlay') {
    if (hrefs.plate) out.push(`<image id="photo" width="${res.width}" height="${res.height}" href="${hrefs.plate}"/>`);
    res.layers.forEach((l, i) => {
      if (!l.paths.length) return;
      const d = l.paths.map(pathData).join('');
      out.push(`<g id="graphic-${i + 1}">`);
      out.push(`<path fill="${l.color}" fill-rule="evenodd" d="${d}"/>`);
      const sh = res.shades?.[i], hr = hrefs.shades?.[i];
      if (sh && hr && (hr.mul || hr.scr)) {
        // 그림자 = 검정 반투명(곱하기와 같음), 반사광 = 흰색 반투명(스크린과 같음). 블렌드 모드 없이 어디서나 같게 보인다.
        out.push(`<clipPath id="clip-${i + 1}"><path clip-rule="evenodd" d="${d}"/></clipPath>`);
        out.push(`<g clip-path="url(#clip-${i + 1})">`);
        if (hr.mul) out.push(`<image id="shadow-${i + 1}" x="${sh.x}" y="${sh.y}" width="${sh.w}" height="${sh.h}" href="${hr.mul}"/>`);
        if (hr.scr) out.push(`<image id="light-${i + 1}" x="${sh.x}" y="${sh.y}" width="${sh.w}" height="${sh.h}" href="${hr.scr}"/>`);
        out.push('</g>');
      }
      out.push('</g>');
    });
    out.push('</svg>');
    return out.join('\n');
  }
  if (background && !res.hasAlpha) out.push(`<rect width="${res.width}" height="${res.height}" fill="${res.background}"/>`);
  res.photos.forEach((r, i) => {
    const h = hrefs.photos?.[i];
    if (h) out.push(`<image x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" href="${h}"/>`);
  });
  for (const l of res.layers) {
    if (!l.paths.length) continue;
    out.push(`<path fill="${l.color}" fill-rule="evenodd" d="${l.paths.map(pathData).join('')}"/>`);
  }
  out.push('</svg>');
  return out.join('\n');
}
