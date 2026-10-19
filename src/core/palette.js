// 색 정리: 가장자리(안티앨리어싱) 픽셀을 빼고 평탄한 픽셀만으로 대표색을 뽑는다.

// 경계 보존 잡음 제거(양방향 필터): 면 안의 잔 얼룩·압축 잡음은 지우고 선·경계는 그대로 둔다
export function denoise(img, sigmaR = 16) {
  const { width: w, height: h, data } = img;
  const out = new Uint8ClampedArray(data.length);
  const lut = new Float32Array(3 * 256 * 256);
  for (let i = 0; i < lut.length; i++) lut[i] = Math.exp(-i / (2 * sigmaR * sigmaR * 3));
  const sw = [];
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) sw.push(dx, dy, Math.exp(-(dx * dx + dy * dy) / (2 * 1.5 * 1.5)));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r0 = data[i], g0 = data[i + 1], b0 = data[i + 2];
      let ar = 0, ag = 0, ab = 0, aw = 0;
      for (let k = 0; k < sw.length; k += 3) {
        const xx = x + sw[k], yy = y + sw[k + 1];
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = (yy * w + xx) * 4;
        const dr = data[j] - r0, dg = data[j + 1] - g0, db = data[j + 2] - b0;
        const wt = sw[k + 2] * lut[dr * dr + dg * dg + db * db];
        ar += data[j] * wt; ag += data[j + 1] * wt; ab += data[j + 2] * wt; aw += wt;
      }
      out[i] = ar / aw; out[i + 1] = ag / aw; out[i + 2] = ab / aw; out[i + 3] = 255;
    }
  }
  return { ...img, data: out };
}

export function compositeOnWhite(img) {
  const { width: w, height: h, data } = img;
  const out = new Uint8ClampedArray(w * h * 4);
  let transparent = 0;
  for (let i = 0; i < w * h; i++) {
    const a = data[i * 4 + 3] / 255;
    if (a < 0.98) transparent++;
    out[i * 4] = data[i * 4] * a + 255 * (1 - a);
    out[i * 4 + 1] = data[i * 4 + 1] * a + 255 * (1 - a);
    out[i * 4 + 2] = data[i * 4 + 2] * a + 255 * (1 - a);
    out[i * 4 + 3] = 255;
  }
  return { width: w, height: h, data: out, hasAlpha: transparent > w * h * 0.01 };
}

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function kmeans(s, k, rand) {
  const n = s.length / 3;

  // k-means++ 초기화
  const C = [];
  const first = Math.floor(rand() * n);
  C.push([s[first * 3], s[first * 3 + 1], s[first * 3 + 2]]);
  const dist = new Float64Array(n).fill(Infinity);
  while (C.length < k) {
    const c = C[C.length - 1];
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const dr = s[i * 3] - c[0], dg = s[i * 3 + 1] - c[1], db = s[i * 3 + 2] - c[2];
      const d = dr * dr + dg * dg + db * db;
      if (d < dist[i]) dist[i] = d;
      sum += dist[i];
    }
    if (sum === 0) break;
    let r = rand() * sum, pick = 0;
    for (let i = 0; i < n; i++) { r -= dist[i]; if (r <= 0) { pick = i; break; } }
    C.push([s[pick * 3], s[pick * 3 + 1], s[pick * 3 + 2]]);
  }

  const assign = new Int32Array(n);
  for (let iter = 0; iter < 25; iter++) {
    const acc = C.map(() => [0, 0, 0, 0]);
    let changed = 0;
    for (let i = 0; i < n; i++) {
      let best = 0, bd = Infinity;
      for (let j = 0; j < C.length; j++) {
        const dr = s[i * 3] - C[j][0], dg = s[i * 3 + 1] - C[j][1], db = s[i * 3 + 2] - C[j][2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bd) { bd = d; best = j; }
      }
      if (assign[i] !== best) changed++;
      assign[i] = best;
      const a = acc[best];
      a[0] += s[i * 3]; a[1] += s[i * 3 + 1]; a[2] += s[i * 3 + 2]; a[3]++;
    }
    for (let j = 0; j < C.length; j++) {
      if (acc[j][3]) C[j] = [acc[j][0] / acc[j][3], acc[j][1] / acc[j][3], acc[j][2] / acc[j][3]];
    }
    if (changed === 0) break;
  }

  return { C, assign };
}

export function buildPalette(img, kIn) {
  const auto = !kIn || kIn === 'auto';
  const k = auto ? 16 : kIn;
  const { width: w, height: h, data } = img;
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 120000)));
  const s = [];
  for (let y = 1; y < h - 1; y += step) {
    for (let x = 1; x < w - 1; x += step) {
      const i = (y * w + x) * 4;
      let maxd = 0;
      for (const o of [-4, 4, -w * 4, w * 4, -w * 4 - 4, w * 4 + 4]) {
        const d = Math.abs(data[i] - data[i + o]) + Math.abs(data[i + 1] - data[i + 1 + o]) + Math.abs(data[i + 2] - data[i + 2 + o]);
        if (d > maxd) maxd = d;
      }
      if (maxd < 36) s.push(data[i], data[i + 1], data[i + 2]);
    }
  }
  const n = s.length / 3;
  if (n === 0) return [[255, 255, 255]];
  const { C, assign } = kmeans(s, k, mulberry32(7));

  // 군집 크기
  const size = new Float64Array(C.length);
  for (let i = 0; i < n; i++) size[assign[i]]++;
  let cl = C.map((c, j) => ({ c, n: size[j] })).filter((q) => q.n > n * (auto ? 0.0008 : 0.0002));
  // 비슷한 색은 큰 쪽으로 합친다. 음영(밝기 차이)은 덜 따지고 색조·채도 차이는 그대로 본다:
  // 그늘진 바닥은 한 색으로, 바닥 초록과 잎 초록은 다른 색으로.
  cl.sort((a, b) => b.n - a.n);
  const merged = [];
  for (const q of cl) {
    const m = merged.find((p) => colorDist(p.c, q.c) < (auto ? 13 : 6));
    if (m) m.n += q.n; else merged.push({ ...q });
  }
  // 가는 선의 색: 평평한 픽셀이 거의 없어 위에서 빠진다. 주변보다 진한(또는 밝은) 능선 픽셀에서 따로 뽑는다.
  const ridge = ridgeSamples(img);
  const rn = ridge.length / 3;
  if (rn > 30) {
    const { C: RC, assign: ra } = kmeans(ridge, Math.min(7, rn), mulberry32(11));
    const rsize = new Float64Array(RC.length);
    for (let i = 0; i < rn; i++) rsize[ra[i]]++;
    RC.map((c, j) => ({ c, n: rsize[j] })).sort((a, b) => b.n - a.n).forEach((q) => {
      if (q.n < rn * 0.05) return;
      if (merged.some((p) => colorDist(p.c, q.c) < 13)) return;
      merged.push(q);
    });
  }
  // 질감 있는 면의 색(잎, 무늬 등): 지금 대표색 두 개의 혼합으로도 설명이 안 되는 픽셀을 모아 추가한다
  if (auto) {
    const pal = merged.map((q) => q.c);
    const miss = [];
    const st2 = Math.max(1, Math.floor(Math.sqrt((w * h) / 150000)));
    let total = 0;
    for (let y = 0; y < h; y += st2) for (let x = 0; x < w; x += st2) {
      const i = (y * w + x) * 4;
      total++;
      if (pairResidual(pal, data[i], data[i + 1], data[i + 2]) > 34) miss.push(data[i], data[i + 1], data[i + 2]);
    }
    const mn = miss.length / 3;
    if (mn > total * 0.004) {
      const { C: MC, assign: ma } = kmeans(miss, Math.min(4, mn), mulberry32(5));
      const msize = new Float64Array(MC.length);
      for (let i = 0; i < mn; i++) msize[ma[i]]++;
      MC.map((c, j) => ({ c, n: msize[j] })).sort((a, b) => b.n - a.n).forEach((q) => {
        if (q.n < total * 0.003) return;
        if (merged.some((p) => colorDist(p.c, q.c) < 13)) return;
        merged.push(q);
      });
    }
  }
  return merged.map((q) => q.c.map((v) => Math.round(v)));
}

// 색 하나를 대표색 두 개의 혼합으로 설명할 때 남는 오차
function pairResidual(pal, r, g, b) {
  let best = Infinity;
  for (let a = 0; a < pal.length; a++) {
    const pa = pal[a];
    best = Math.min(best, (r - pa[0]) ** 2 + (g - pa[1]) ** 2 + (b - pa[2]) ** 2);
    for (let c = a + 1; c < pal.length; c++) {
      const pc = pal[c];
      const vx = pc[0] - pa[0], vy = pc[1] - pa[1], vz = pc[2] - pa[2];
      const vv = vx * vx + vy * vy + vz * vz;
      if (vv < 1) continue;
      let t = ((r - pa[0]) * vx + (g - pa[1]) * vy + (b - pa[2]) * vz) / vv;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      best = Math.min(best, (r - pa[0] - vx * t) ** 2 + (g - pa[1] - vy * t) ** 2 + (b - pa[2] - vz * t) ** 2);
    }
  }
  return Math.sqrt(best);
}

function lab(c) {
  const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const r = f(c[0]), g = f(c[1]), b = f(c[2]);
  const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.9505, Y = 0.2126 * r + 0.7152 * g + 0.0722 * b, Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.089;
  const t = (v) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  return [116 * t(Y) - 16, 500 * (t(X) - t(Y)), 200 * (t(Y) - t(Z))];
}
// 밝기 차이는 절반만 반영하는 색 거리
export function colorDist(c1, c2) {
  const a = lab(c1), b = lab(c2);
  return Math.hypot((a[0] - b[0]) * 0.5, a[1] - b[1], a[2] - b[2]);
}

const lumAt = (d, i) => d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;

function ridgeSamples(img) {
  const { width: w, height: h, data } = img;
  const out = [];
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 400000)));
  for (let y = 2; y < h - 2; y += step) {
    for (let x = 2; x < w - 2; x += step) {
      const i = (y * w + x) * 4;
      const L = lumAt(data, i);
      const l = lumAt(data, i - 4), r = lumAt(data, i + 4), u = lumAt(data, i - w * 4), d = lumAt(data, i + w * 4);
      const dark = (L <= l && L <= r && (l + r) / 2 - L > 25) || (L <= u && L <= d && (u + d) / 2 - L > 25);
      const bright = (L >= l && L >= r && L - (l + r) / 2 > 25) || (L >= u && L >= d && L - (u + d) / 2 > 25);
      if (!dark && !bright) continue;
      let mn = 255, mx = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const v = lumAt(data, ((y + dy) * w + x + dx) * 4);
        if (v < mn) mn = v; if (v > mx) mx = v;
      }
      if ((dark && mx - L > 60) || (bright && L - mn > 60)) out.push(data[i], data[i + 1], data[i + 2]);
    }
  }
  return out;
}

// 각 픽셀을 가까운 대표색 쌍의 혼합으로 풀어서(언믹싱) 색별 부드러운 마스크를 만든다.
// 경계 픽셀이 "회색 테두리" 같은 가짜 색으로 남지 않고, 경계 위치를 서브픽셀로 보존한다.
export function unmix(img, palette, coreDist = 34) {
  const { width: w, height: h, data } = img;
  const n = w * h, K = palette.length;
  const label = new Int8Array(n).fill(-1);
  const nearest = new Int8Array(n);
  const core2 = coreDist * coreDist;
  const counts = new Float64Array(K);
  for (let i = 0; i < n; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    let best = 0, bd = Infinity;
    for (let j = 0; j < K; j++) {
      const p = palette[j];
      const d = (r - p[0]) ** 2 + (g - p[1]) ** 2 + (b - p[2]) ** 2;
      if (d < bd) { bd = d; best = j; }
    }
    nearest[i] = best;
    counts[best]++;
    if (bd < core2) label[i] = best;
  }
  let bg = 0;
  for (let j = 1; j < K; j++) if (counts[j] > counts[bg]) bg = j;

  // 경계 띠 정리: 주변에 다른 두 색(a, b)이 있고 이 픽셀 색이 그 둘의 중간이면
  // "중간색 레이어"가 아니라 a-b 경계(안티앨리어싱)다. 예: 검정 선 둘레의 회색 테두리
  const mixOf = new Uint8Array(K * K * K); // mixOf[c][a][b] = c가 a-b 사이 색인가
  for (let c = 0; c < K; c++) for (let a = 0; a < K; a++) for (let b = a + 1; b < K; b++) {
    if (a === c || b === c) continue;
    const pa = palette[a], pb = palette[b], pc = palette[c];
    const vx = pb[0] - pa[0], vy = pb[1] - pa[1], vz = pb[2] - pa[2];
    const vv = vx * vx + vy * vy + vz * vz;
    if (vv < 1) continue;
    const t = ((pc[0] - pa[0]) * vx + (pc[1] - pa[1]) * vy + (pc[2] - pa[2]) * vz) / vv;
    if (t < 0.08 || t > 0.92) continue;
    const r = Math.hypot(pc[0] - pa[0] - vx * t, pc[1] - pa[1] - vy * t, pc[2] - pa[2] - vz * t);
    if (r < 26) mixOf[(c * K + a) * K + b] = mixOf[(c * K + b) * K + a] = 1;
  }
  const relabel = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, c = label[i];
    if (c < 0) continue;
    let seen = 0;
    for (let dy = -2; dy <= 2; dy++) {
      const yy = y + dy; if (yy < 0 || yy >= h) continue;
      for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx; if (xx < 0 || xx >= w) continue;
        const l = label[yy * w + xx];
        if (l >= 0 && l !== c) seen |= 1 << l;
      }
    }
    if (!seen || !(seen & (seen - 1))) continue; // 다른 색이 두 개 이상일 때만
    let mixed = false;
    for (let a = 0; a < K && !mixed; a++) {
      if (!(seen & (1 << a))) continue;
      for (let b = a + 1; b < K; b++) if (seen & (1 << b) && mixOf[(c * K + a) * K + b]) { mixed = true; break; }
    }
    if (mixed) relabel.push(i);
  }
  for (const i of relabel) label[i] = -1;

  const masks = palette.map(() => new Float32Array(n));
  const resid = new Float32Array(n); // 대표색 혼합으로 설명되지 않는 정도(사진 영역 판별용)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (label[i] >= 0) { masks[label[i]][i] = 1; continue; }
      let cand = 1 << bg;
      for (let dy = -2; dy <= 2; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= h) continue;
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx; if (xx < 0 || xx >= w) continue;
          const l = label[yy * w + xx];
          if (l >= 0) cand |= 1 << l;
        }
      }
      if (cand === 1 << bg) cand = (1 << K) - 1; // 주변에 확실한 색이 없으면 모든 색 조합을 본다
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      let bestR = Infinity, ba = nearest[i], bb = -1, bt = 0;
      for (let a = 0; a < K; a++) {
        if (!(cand & (1 << a))) continue;
        const pa = palette[a];
        const da = (r - pa[0]) ** 2 + (g - pa[1]) ** 2 + (b - pa[2]) ** 2;
        if (da < bestR) { bestR = da; ba = a; bb = -1; }
        for (let c = a + 1; c < K; c++) {
          if (!(cand & (1 << c))) continue;
          const pc = palette[c];
          const vx = pc[0] - pa[0], vy = pc[1] - pa[1], vz = pc[2] - pa[2];
          const vv = vx * vx + vy * vy + vz * vz;
          if (vv < 1) continue;
          let t = ((r - pa[0]) * vx + (g - pa[1]) * vy + (b - pa[2]) * vz) / vv;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const ex = r - (pa[0] + vx * t), ey = g - (pa[1] + vy * t), ez = b - (pa[2] + vz * t);
          const d = ex * ex + ey * ey + ez * ez;
          if (d < bestR) { bestR = d; ba = a; bb = c; bt = t; }
        }
      }
      resid[i] = Math.sqrt(bestR);
      if (bb < 0) masks[ba][i] = 1;
      else { masks[ba][i] = 1 - bt; masks[bb][i] = bt; }
    }
  }
  return { masks, bg, counts, resid, label };
}
