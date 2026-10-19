// 사진 위 그래픽 모드
// 사진 속에 합성된 색 그래픽(바닥 사인, 로고 등)만 깨끗한 벡터로 바꾸고,
// 그 위에 원본에서 뽑은 그림자(곱하기)·반사광(스크린) 레이어를 얹는다. 배경 사진은 그대로 둔다.
import { compositeOnWhite } from './palette.js';
import { DEFAULTS, vectorize } from './trace.js';

const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) { const v = i / 255; LIN[i] = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }
const hex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function hsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 0) {
    if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [h, mx ? d / mx : 0, mx / 255];
}

// 채도가 높은 색 중 가장 많은 색조 묶음을 찾아, 그늘지지 않은 원래 색(밝은 쪽 중앙값)을 대상 색으로
export function autoTargets(img, max = 2) {
  const { width: w, height: h, data } = img;
  const bins = Array.from({ length: 36 }, () => []);
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 150000)));
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
    const i = (y * w + x) * 4;
    const [hh, s, v] = hsv(data[i], data[i + 1], data[i + 2]);
    if (s > 0.45 && v > 0.25) bins[Math.floor(hh / 10) % 36].push(i);
  }
  const total = Math.ceil(w / step) * Math.ceil(h / step);
  const groups = [];
  const used = new Set();
  const order = bins.map((b, k) => [b.length + (bins[(k + 1) % 36].length + bins[(k + 35) % 36].length) * 0.5, k]).sort((a, b) => b[0] - a[0]);
  for (const [, k] of order) {
    if (used.has(k) || groups.length >= max) continue;
    const idx = [...bins[(k + 35) % 36], ...bins[k], ...bins[(k + 1) % 36]];
    if (idx.length < total * 0.003) break;
    if ([...used].some((u) => Math.min(Math.abs(u - k), 36 - Math.abs(u - k)) <= 3)) continue;
    used.add(k); used.add((k + 1) % 36); used.add((k + 35) % 36);
    const px = idx.map((i) => [data[i], data[i + 1], data[i + 2]]).sort((a, b) => lum(...b) - lum(...a));
    const top = px.slice(0, Math.max(1, Math.floor(px.length * 0.5)));
    const med = [0, 1, 2].map((c) => top.map((p) => p[c]).sort((a, b) => a - b)[Math.floor(top.length / 2)]);
    groups.push(med);
  }
  return groups;
}

// 밝기와 무관한 "색조 비율" 마스크: 그림자로 어두워져도, 회색 바닥과 섞인 경계에서도 비율로 알파를 구한다
function chromaMasks(img, targets) {
  const { width: w, height: h, data } = img;
  const n = w * h;
  const T = targets.map((t) => {
    const l = t.map((v) => LIN[v]);
    const m = (l[0] + l[1] + l[2]) / 3;
    const c = l.map((v) => v - m);
    const cn = Math.hypot(...c) || 1e-6;
    return { u: c.map((v) => v / cn), ratio: cn / Math.max(m, 1e-6) };
  });
  const masks = T.map(() => new Float32Array(n));
  for (let i = 0; i < n; i++) {
    const r = LIN[data[i * 4]], g = LIN[data[i * 4 + 1]], b = LIN[data[i * 4 + 2]];
    const m = (r + g + b) / 3;
    if (m < 0.002) continue;
    const c0 = r - m, c1 = g - m, c2 = b - m;
    let best = -1, ba = 0;
    for (let k = 0; k < T.length; k++) {
      const { u, ratio } = T[k];
      const along = c0 * u[0] + c1 * u[1] + c2 * u[2];
      if (along <= 0) continue;
      const perp = Math.hypot(c0 - along * u[0], c1 - along * u[1], c2 - along * u[2]);
      let a = along / m / ratio;
      const q = perp / along;
      if (q > 0.45) a *= Math.max(0, 1 - (q - 0.45) * 2.5);
      if (a > ba) { ba = a; best = k; }
    }
    if (best >= 0) masks[best][i] = Math.min(1, ba);
  }
  return masks;
}

// 그래픽 안의 작은 구멍(반사광으로 채도가 빠진 곳 등)은 메운다
function fillHoles(mask, w, h, maxArea) {
  const out = new Uint8Array(w * h);
  const seen = new Uint8Array(w * h);
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || mask[s] >= 0.5) continue;
    const st = [s], comp = [];
    seen[s] = 1;
    let border = false;
    while (st.length) {
      const c = st.pop();
      comp.push(c);
      const x = c % w, y = (c / w) | 0;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
      for (const k of [c - 1, c + 1, c - w, c + w]) {
        if (k < 0 || k >= w * h || seen[k] || mask[k] >= 0.5) continue;
        if ((k === c - 1 && x === 0) || (k === c + 1 && x === w - 1)) continue;
        seen[k] = 1; st.push(k);
      }
      if (comp.length > maxArea && border) break;
    }
    if (!border && comp.length <= maxArea) {
      let sum = 0;
      for (const c of comp) sum += mask[c];
      if (sum / comp.length > 0.22) for (const c of comp) out[c] = 1;
    }
  }
  for (let i = 0; i < w * h; i++) if (out[i]) mask[i] = 1;
}

// 알 수 없는 픽셀을 주변에서 양파 껍질처럼 채운다
function onionFill(vals, known, w, h, ch) {
  let frontier = true;
  while (frontier) {
    frontier = false;
    const add = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (known[i]) continue;
      const acc = new Float32Array(ch);
      let cnt = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const k = yy * w + xx;
        if (known[k] !== 1) continue;
        for (let c = 0; c < ch; c++) acc[c] += vals[k * ch + c];
        cnt++;
      }
      if (cnt) { add.push(i, acc.map((v) => v / cnt)); }
    }
    for (let j = 0; j < add.length; j += 2) {
      const i = add[j], v = add[j + 1];
      for (let c = 0; c < ch; c++) vals[i * ch + c] = v[c];
      known[i] = 2;
      frontier = true;
    }
    for (let j = 0; j < add.length; j += 2) known[add[j]] = 1;
  }
}

export function traceOverlay(input, opts = {}, progress = () => {}) {
  const o = { ...DEFAULTS, holeFill: 0.002, shadeStrength: 1, shading: true, ...opts };
  const t0 = Date.now();
  const img = compositeOnWhite(input);
  const { width: w, height: h, data } = img;
  progress('대상 색 찾기', 0.05);
  const targets = o.targets && o.targets.length ? o.targets : autoTargets(img);
  if (!targets.length) {
    return { mode: 'overlay', width: w, height: h, layers: [], shades: [], targets: [], plate: data, photos: [], stats: { anchors: 0, paths: 0, ms: Date.now() - t0 } };
  }
  const masks = chromaMasks(img, targets);
  for (const m of masks) fillHoles(m, w, h, Math.round(w * h * o.holeFill));
  const v = vectorize(masks.map((mask, k) => ({ color: hex(targets[k]), mask })), w, h, { ...o, strokes: false }, progress);

  // 그림자·반사광 레이어
  progress('그림자 추출', 0.9);
  const shades = [];
  if (o.shading) {
    masks.forEach((mask, k) => {
      const b = v.layers.find((l) => l.color === hex(targets[k]))?.bounds;
      if (!b) { shades.push(null); return; }
      const bw = b.x1 - b.x0 + 1, bh = b.y1 - b.y0 + 1;
      const t = targets[k], Yt = Math.max(1, lum(...t));
      const val = new Float32Array(bw * bh), known = new Uint8Array(bw * bh);
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
        const i = (b.y0 + y) * w + b.x0 + x;
        if (mask[i] > 0.92) {
          val[y * bw + x] = lum(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) / Yt;
          known[y * bw + x] = 1;
        } else if (mask[i] < 0.02) known[y * bw + x] = 3; // 그래픽 밖: 채울 필요 없음
      }
      onionFill(val, known, bw, bh, 1);
      const mul = new Uint8Array(bw * bh), scr = new Uint8Array(bw * bh);
      let anyMul = false, anyScr = false;
      const st = o.shadeStrength;
      for (let i = 0; i < bw * bh; i++) {
        const r = val[i];
        if (r < 1) { mul[i] = Math.round(255 * (1 - (1 - r) * st)); if (mul[i] < 250) anyMul = true; }
        else mul[i] = 255;
        if (r > 1) { const s = Math.min(1, ((r - 1) * Yt) / (255 - Yt)) * st; scr[i] = Math.round(255 * s); if (scr[i] > 5) anyScr = true; }
      }
      shades.push({ x: b.x0, y: b.y0, w: bw, h: bh, mul: anyMul ? mul : null, scr: anyScr ? scr : null });
    });
  }

  // 배경 사진: 그래픽 가장자리에 번진 색을 주변 사진으로 메워 깨끗한 바탕을 만든다
  progress('배경 정리', 0.95);
  const plateF = new Float32Array(w * h * 3), known = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    let a = 0;
    for (const m of masks) a = Math.max(a, m[i]);
    plateF[i * 3] = data[i * 4]; plateF[i * 3 + 1] = data[i * 4 + 1]; plateF[i * 3 + 2] = data[i * 4 + 2];
    known[i] = a < 0.04 ? 1 : a > 0.8 ? 3 : 0; // 3 = 벡터가 덮는 안쪽(원본 유지)
  }
  // 1px 팽창한 번짐 띠까지 다시 그린다
  const k2 = known.slice();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (known[i] !== 1) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < w && yy < h && known[yy * w + xx] === 1) k2[yy * w + xx] = 0;
    }
  }
  onionFill(plateF, k2, w, h, 3);
  const plate = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    plate[i * 4] = plateF[i * 3]; plate[i * 4 + 1] = plateF[i * 3 + 1]; plate[i * 4 + 2] = plateF[i * 3 + 2]; plate[i * 4 + 3] = 255;
  }
  progress('완료', 1);
  return {
    mode: 'overlay', width: w, height: h, hasAlpha: false,
    targets: targets.map(hex), palette: targets.map(hex), background: null,
    layers: v.layers, shades, plate, photos: [],
    stats: { ...v.stats, ms: Date.now() - t0 },
  };
}
