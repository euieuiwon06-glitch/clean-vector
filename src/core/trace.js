import { compositeOnWhite, buildPalette, unmix, denoise } from './palette.js?v=563ad31b';
import { extractStrokes, inkCoverage } from './strokes.js?v=563ad31b';
import { maskBounds, upsample, gaussianBlur, preserveThin, marchingSquares } from './contour.js?v=563ad31b';
import { resampleClosed, analyzeContour, alignRuns, equalizeStrokes, buildPath } from './fit.js?v=563ad31b';

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

// 사진 블록: 완만한 색 변화(평평하지도, 또렷한 경계도 아닌 픽셀)가 절반 이상인 16px 블록.
// 그래픽·선화는 평평한 면 + 또렷한 경계라 거의 0%, 사진·3D 렌더는 60% 이상이 된다.
export function photoBlocks(img) {
  const { width: w, height: h, data } = img;
  const B = 16, bw = Math.ceil(w / B), bh = Math.ceil(h / B);
  const cnt = new Uint16Array(bw * bh), tot = new Uint16Array(bw * bh);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      let maxd = 0;
      for (const o of [-4, 4, -w * 4, w * 4]) {
        const d = Math.abs(data[i] - data[i + o]) + Math.abs(data[i + 1] - data[i + 1 + o]) + Math.abs(data[i + 2] - data[i + 2 + o]);
        if (d > maxd) maxd = d;
      }
      const b = ((y / B) | 0) * bw + ((x / B) | 0);
      tot[b]++;
      if (maxd >= 8 && maxd <= 48) cnt[b]++;
    }
  }
  const blk = new Uint8Array(bw * bh);
  let n = 0;
  for (let b = 0; b < bw * bh; b++) if (tot[b] && cnt[b] / tot[b] > 0.5) { blk[b] = 1; n++; }
  return { blk, bw, bh, B, coverage: n / (bw * bh) };
}

function detectPhotos(img, pb) {
  const { width: w, height: h } = img;
  const { blk, bw, bh, B } = pb;
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
    if (core >= Math.max(8, bw * bh * 0.01)) {
      rects.push({ x: x0 * B, y: y0 * B, w: Math.min(w, (x1 + 1) * B) - x0 * B, h: Math.min(h, (y1 + 1) * B) - y0 * B });
    }
  }
  return rects;
}

// 무채색(회색)이면서 가장 진한 색도 배경도 아니고, 5x5가 모두 그 색인 "면 속" 픽셀이 거의 없는 색을 뺀다
function pruneLineGrays(img, palette, um) {
  const { width: w, height: h } = img;
  const { label, bg } = um;
  const K = palette.length;
  const chroma = (c) => Math.max(...c) - Math.min(...c);
  const lumc = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  let ink = -1;
  for (let k = 0; k < K; k++) if (k !== bg && chroma(palette[k]) < 28 && (ink < 0 || lumc(palette[k]) < lumc(palette[ink]))) ink = k;
  if (ink < 0) return palette;
  const interior = new Float64Array(K);
  for (let y = 2; y < h - 2; y += 2) for (let x = 2; x < w - 2; x += 2) {
    const l = label[y * w + x];
    if (l < 0) continue;
    let same = true;
    for (let dy = -2; dy <= 2 && same; dy++) for (let dx = -2; dx <= 2; dx++) if (label[(y + dy) * w + x + dx] !== l) { same = false; break; }
    if (same) interior[l]++;
  }
  const total = (w * h) / 4;
  return palette.filter((c, k) => k === bg || k === ink || chroma(c) >= 28 || interior[k] > total * 0.004);
}

export function trace(input, opts = {}, progress = () => {}) {
  const o = { ...DEFAULTS, ...opts };
  const t0 = Date.now();
  let img = denoise(compositeOnWhite(input));
  const { width: w, height: h } = img;
  progress('색 정리', 0.05);
  let palette = buildPalette(img, o.colors);
  let um = unmix(img, palette);
  let photos = [];
  if (o.photo) {
    photos = detectPhotos(img, o.photoBlocks || photoBlocks(img));
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
  // 선 사이 회색 정리: 넓은 면이 없는 중간 회색은 "검정 선이 덜 덮인 픽셀"이므로 대표색에서 뺀다.
  {
    const keep = pruneLineGrays(img, palette, um);
    if (keep.length < palette.length) { palette = keep; um = unmix(img, palette); }
  }
  const { masks, bg, counts } = um;
  for (const r of photos) for (const m of masks) for (let y = r.y; y < r.y + r.h; y++) m.fill(0, y * w + r.x, y * w + r.x + r.w);

  // 겹쳐 쌓기: 색 c가 배경→d 사이의 연한 색(틴트)이면, c 레이어는 "c만큼 이상 진한 d"까지 포함한다.
  // 진하기가 들쭉날쭉한 선(회색↔검정)이나 연초록 띠 속 초록 점선이 한 레이어 안에서 끊기지 않고,
  // 진한 d는 그 위에 그려진다.
  const B0 = palette[bg];
  const dist = (c) => Math.hypot(c[0] - B0[0], c[1] - B0[1], c[2] - B0[2]);
  const order = palette.map((_, i) => i).filter((i) => i !== bg).sort((a, b) => dist(palette[a]) - dist(palette[b]));
  const lumP = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  let inkC = -1;
  for (const ci of order) { const c = palette[ci]; if (Math.max(...c) - Math.min(...c) < 28 && lumP(c) < 90 && (inkC < 0 || lumP(c) < lumP(palette[inkC]))) inkC = ci; }
  const stacked = order.map((ci) => {
    const pc = palette[ci];
    const parents = [];
    for (const d of order) {
      if (d === ci) continue;
      const pd = palette[d];
      const vx = pd[0] - B0[0], vy = pd[1] - B0[1], vz = pd[2] - B0[2];
      const vv = vx * vx + vy * vy + vz * vz;
      const t = ((pc[0] - B0[0]) * vx + (pc[1] - B0[1]) * vy + (pc[2] - B0[2]) * vz) / vv;
      if (t <= 0.08 || t >= 0.95) continue;
      const r = Math.hypot(pc[0] - B0[0] - vx * t, pc[1] - B0[1] - vy * t, pc[2] - B0[2] - vz * t);
      if (r < 30) parents.push({ m: masks[d] });
    }
    const isInk = ci === inkC;
    if (!parents.length) return { color: hex(pc), mask: masks[ci], ink: isInk, rgb: pc };
    const m = new Float32Array(masks[ci]);
    for (let i = 0; i < m.length; i++) {
      let v = m[i];
      for (const p of parents) v += p.m[i]; // 진한 색의 경계는 그 색 레이어와 같게
      m[i] = v > 1 ? 1 : v;
    }
    return { color: hex(pc), mask: m, ink: ci === inkC, rgb: pc };
  });
  // 잉크(가장 진한 무채색)의 가는 선은 중심선 획으로, 두꺼운 부분만 면으로
  let strokes = [];
  const inkIdx = stacked.findIndex((it) => it.ink);
  if (inkIdx >= 0 && o.centerline !== false) {
    progress('선 추적', 0.1);
    const ink = stacked[inkIdx];
    const cov = inkCoverage(img, ink.rgb);
    if (o.debugCov) o.debugCov(cov);
    const r = extractStrokes(cov, w, h, { lineTol: 0.75, snapDeg: 3.5, binTh: 0.4 });
    const bc = palette[bg], ic = ink.rgb;
    strokes = r.strokes.map((st) => {
      // 진한 선은 잉크색 하나로, 흐린 선만 몇 단계 회색으로
      const pk = st.peak >= 0.7 ? 1 : Math.max(0.3, Math.round(st.peak * 5) / 5);
      const col = ic.map((v, k) => Math.round(bc[k] + (v - bc[k]) * pk));
      return { ...st, color: hex(col), width: Math.round(st.width * 4) / 4 };
    });
    stacked[inkIdx] = { ...ink, mask: r.fillMask };
  }
  const v = vectorize(stacked, w, h, o, progress);
  progress('완료', 1);
  return {
    mode: 'graphic',
    width: w, height: h, hasAlpha: img.hasAlpha,
    background: hex(palette[bg]), palette: palette.map(hex),
    layers: v.layers, photos, strokes,
    stats: { anchors: v.stats.anchors + strokes.reduce((n, st) => n + st.segs.length + 1, 0), paths: v.stats.paths + strokes.length, ms: Date.now() - t0 },
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

export function openPathData(st) {
  let d = `M${f2(st.start[0])} ${f2(st.start[1])}`;
  for (const g of st.segs) d += g.t === 'L' ? `L${f2(g.x)} ${f2(g.y)}` : `C${f2(g.x1)} ${f2(g.y1)} ${f2(g.x2)} ${f2(g.y2)} ${f2(g.x)} ${f2(g.y)}`;
  return st.closed ? d + 'Z' : d;
}

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
  if (res.strokes?.length) {
    const groups = new Map();
    for (const st of res.strokes) {
      const k = `${st.color}|${st.width}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(openPathData(st));
    }
    out.push('<g id="lines" fill="none" stroke-linecap="round" stroke-linejoin="round">');
    for (const [k, ds] of groups) {
      const [c, wd] = k.split('|');
      out.push(`<path stroke="${c}" stroke-width="${wd}" d="${ds.join('')}"/>`);
    }
    out.push('</g>');
  }
  out.push('</svg>');
  return out.join('\n');
}
