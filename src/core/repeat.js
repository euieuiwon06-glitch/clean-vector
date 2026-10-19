// 반복 형태 통일: 그림 안에서 비슷한 작은 물체(의자·선반 칸 등)를 찾아 묶고,
// 같은 묶음끼리 겹쳐 만든 중앙값 모양(노이즈가 줄어든 대표 모양)으로 원본 픽셀을 바꿔 넣는다.
// 이후 벡터화는 그대로 진행되므로, 같은 물체는 같은 모양으로 나온다.

const lumOf = (d, i) => d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;

// 디테일 맵: 주변(7x7)에서 가장 밝은 값 대비 얼마나 어두운가(0~255)
function detailMap(img) {
  const { width: w, height: h, data } = img;
  const L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = lumOf(data, i * 4);
  const R = 3, t = new Float32Array(w * h), mx = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let m = 0;
    for (let k = Math.max(0, x - R); k <= Math.min(w - 1, x + R); k++) if (L[y * w + k] > m) m = L[y * w + k];
    t[y * w + x] = m;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let m = 0;
    for (let k = Math.max(0, y - R); k <= Math.min(h - 1, y + R); k++) if (t[k * w + x] > m) m = t[k * w + x];
    mx[y * w + x] = m;
  }
  const D = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) D[i] = Math.max(0, mx[i] - L[i]);
  return D;
}

// 긴 직선(구조선) 픽셀: 8방향 중 하나로 24px 이상 이어지는 선
function longLines(B, w, h, minLen) {
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1], [2, 1], [2, -1], [1, 2], [1, -2]];
  const out = new Uint8Array(w * h);
  for (const [dx, dy] of dirs) {
    const step = Math.hypot(dx, dy), need = Math.ceil(minLen / step);
    const fw = new Uint16Array(w * h), bw = new Uint16Array(w * h);
    // 앞쪽 누적: 진행 방향 반대에서부터
    const ys = dy >= 0 ? [...Array(h).keys()] : [...Array(h).keys()].reverse();
    for (const y of ys) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!B[i]) continue;
      const px = x - dx, py = y - dy;
      // 굵은 선·계단 허용: 이전 위치 또는 그 옆 1px
      let prev = 0;
      for (const [ox, oy] of [[0, 0], [dy !== 0 ? 1 : 0, dy === 0 ? 1 : 0], [dy !== 0 ? -1 : 0, dy === 0 ? -1 : 0]]) {
        const qx = px + ox, qy = py + oy;
        if (qx >= 0 && qy >= 0 && qx < w && qy < h && fw[qy * w + qx] > prev) prev = fw[qy * w + qx];
      }
      fw[i] = prev + 1;
    }
    const ys2 = dy >= 0 ? [...Array(h).keys()].reverse() : [...Array(h).keys()];
    for (const y of ys2) for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!B[i]) continue;
      const px = x + dx, py = y + dy;
      let prev = 0;
      for (const [ox, oy] of [[0, 0], [dy !== 0 ? 1 : 0, dy === 0 ? 1 : 0], [dy !== 0 ? -1 : 0, dy === 0 ? -1 : 0]]) {
        const qx = px + ox, qy = py + oy;
        if (qx >= 0 && qy >= 0 && qx < w && qy < h && bw[qy * w + qx] > prev) prev = bw[qy * w + qx];
      }
      bw[i] = prev + 1;
    }
    for (let i = 0; i < w * h; i++) if (B[i] && fw[i] + bw[i] - 1 >= need) out[i] = 1;
  }
  return out;
}

function dilate(B, w, h, r) {
  const t = new Uint8Array(w * h), o = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) { let c = 0; for (let x = -r; x < w + r; x++) { if (x + r < w && x + r >= 0) c += B[y * w + x + r]; if (x - r - 1 >= 0 && x - r - 1 < w) c -= B[y * w + x - r - 1]; if (x >= 0 && x < w) t[y * w + x] = c > 0 ? 1 : 0; } }
  for (let x = 0; x < w; x++) { let c = 0; for (let y = -r; y < h + r; y++) { if (y + r < h && y + r >= 0) c += t[(y + r) * w + x]; if (y - r - 1 >= 0 && y - r - 1 < h) c -= t[(y - r - 1) * w + x]; if (y >= 0 && y < h) o[y * w + x] = c > 0 ? 1 : 0; } }
  return o;
}

// 정규화 상호상관(두 패치를 dx,dy만큼 어긋나게 겹쳐 비교)
function ncc(D, w, a, b, pw, ph, dx, dy) {
  let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, n = 0;
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
    const va = D[(a.y + y) * w + a.x + x], vb = D[(b.y + y + dy) * w + b.x + x + dx];
    sa += va; sb += vb; saa += va * va; sbb += vb * vb; sab += va * vb; n++;
  }
  const cov = sab - (sa * sb) / n, va = saa - (sa * sa) / n, vb = sbb - (sb * sb) / n;
  return va > 1 && vb > 1 ? cov / Math.sqrt(va * vb) : 0;
}

function blur(f, w, h, sg) {
  const r = Math.ceil(sg * 2.5), k = [];
  let sum = 0;
  for (let i = -r; i <= r; i++) { const v = Math.exp(-(i * i) / (2 * sg * sg)); k.push(v); sum += v; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const t = new Float32Array(w * h), o = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let a = 0; for (let i = -r; i <= r; i++) a += f[y * w + Math.min(w - 1, Math.max(0, x + i))] * k[i + r]; t[y * w + x] = a; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let a = 0; for (let i = -r; i <= r; i++) a += t[Math.min(h - 1, Math.max(0, y + i)) * w + x] * k[i + r]; o[y * w + x] = a; }
  return o;
}

// 반복 찾기: 디테일이 몰린 곳(덩어리 중심)을 씨앗으로, 씨앗 주변 창끼리 모양을 비교해 묶는다
export function findRepeats(img, o = {}) {
  const { width: w, height: h } = img;
  const D = detailMap(img);
  const S = o.win ?? 32, half = S >> 1, SH = 3;
  // 덩어리 중심: 작은 흐림 - 큰 흐림(주변보다 디테일이 몰린 곳)의 극대점
  const g1 = blur(D, w, h, S / 8), g2 = blur(D, w, h, S / 3);
  const dog = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) dog[i] = g1[i] - g2[i];
  const seeds = [];
  const R = Math.round(S / 4);
  for (let y = half + SH; y < h - half - SH; y++) for (let x = half + SH; x < w - half - SH; x++) {
    const v = dog[y * w + x];
    if (v < (o.seedTh ?? 4)) continue;
    let ok = true;
    for (let dy = -R; dy <= R && ok; dy++) for (let dx = -R; dx <= R; dx++) if (dog[(y + dy) * w + x + dx] > v) { ok = false; break; }
    if (ok) seeds.push({ x, y, v });
  }
  // 대략 비교용 요약(8x8 평균, 정규화)
  const G = 8, cs = S / G;
  const desc = seeds.map(({ x, y }) => {
    const d = new Float32Array(G * G);
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      let a = 0;
      for (let yy = 0; yy < cs; yy++) for (let xx = 0; xx < cs; xx++) a += D[(y - half + j * cs + yy) * w + x - half + i * cs + xx];
      d[j * G + i] = a;
    }
    let m = 0; for (const v of d) m += v; m /= d.length;
    let n = 0; for (let k = 0; k < d.length; k++) { d[k] -= m; n += d[k] * d[k]; }
    n = Math.sqrt(n) || 1; for (let k = 0; k < d.length; k++) d[k] /= n;
    return d;
  });
  const par = seeds.map((_, i) => i);
  const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  const links = [];
  const pw = S - SH * 2;
  for (let i = 0; i < seeds.length; i++) for (let j = i + 1; j < seeds.length; j++) {
    const A = seeds[i], B = seeds[j];
    if (Math.abs(A.x - B.x) < S * 0.6 && Math.abs(A.y - B.y) < S * 0.6) continue; // 겹치는 이웃
    let c = 0; const da = desc[i], db = desc[j];
    for (let k = 0; k < da.length; k++) c += da[k] * db[k];
    if (c < 0.7) continue;
    const a = { x: A.x - half + SH, y: A.y - half + SH }, b = { x: B.x - half + SH, y: B.y - half + SH };
    let best = -1;
    for (let dy = -SH; dy <= SH; dy++) for (let dx = -SH; dx <= SH; dx++) { const v = ncc(D, w, a, b, pw, pw, dx, dy); if (v > best) best = v; }
    if (best >= (o.minNcc ?? 0.7)) { links.push([i, j, best]); par[find(i)] = find(j); }
  }
  const groups = new Map();
  seeds.forEach((_, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(seeds[i]); });
  const clusters = [...groups.values()].filter((g) => g.length >= (o.minCount ?? 3));
  return { clusters, D, seeds, links, S };
}

// 묶음별 중앙값 모양으로 원본 픽셀을 바꿔 넣는다
export function unifyRepeats(img, o = {}) {
  const { width: w, height: h, data } = img;
  const { clusters, D, S } = findRepeats(img, o);
  const out = new Uint8ClampedArray(data);
  const SH = 3, half = S >> 1, W = S, H = S, pw = S - SH * 2;
  const info = [];
  for (const cl of clusters) {
    const ref = cl.slice().sort((a, b) => b.v - a.v)[0];
    const placed = [];
    for (const m of cl) {
      let best = -1, bx = 0, by = 0;
      const a = { x: ref.x - half + SH, y: ref.y - half + SH }, b = { x: m.x - half + SH, y: m.y - half + SH };
      for (let dy = -SH; dy <= SH; dy++) for (let dx = -SH; dx <= SH; dx++) { const v = ncc(D, w, a, b, pw, pw, dx, dy); if (v > best) { best = v; bx = dx; by = dy; } }
      const px = m.x - half + bx, py = m.y - half + by;
      if (best < 0.6 || px < 0 || py < 0 || px + W > w || py + H > h) continue;
      placed.push({ x: px, y: py });
    }
    if (placed.length < (o.minCount ?? 3)) continue;
    const n = placed.length;
    const tpl = new Uint8ClampedArray(W * H * 3), vote = new Uint8Array(W * H);
    const buf = [[], [], []];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      for (let c = 0; c < 3; c++) buf[c].length = 0;
      let dv = 0;
      for (const p of placed) {
        const i = (p.y + y) * w + p.x + x;
        buf[0].push(data[i * 4]); buf[1].push(data[i * 4 + 1]); buf[2].push(data[i * 4 + 2]);
        if (D[i] > 18) dv++;
      }
      for (let c = 0; c < 3; c++) { buf[c].sort((a, b) => a - b); tpl[(y * W + x) * 3 + c] = buf[c][n >> 1]; }
      vote[y * W + x] = dv >= n * 0.6 ? 1 : 0;
    }
    // 모양 영역: 꾸준히 나타나는 디테일을 1px 넓히고 구멍 메움(창 가운데 덩어리만)
    const foot = dilate(vote, W, H, 1);
    const keep = new Uint8Array(W * H), q = [];
    // 가운데에서 닿는 덩어리만
    let seed = -1, bd = 1e9;
    for (let i = 0; i < W * H; i++) if (foot[i]) { const d = Math.hypot((i % W) - half, ((i / W) | 0) - half); if (d < bd) { bd = d; seed = i; } }
    if (seed < 0 || bd > S / 4) continue;
    keep[seed] = 1; q.push(seed);
    while (q.length) { const c = q.pop(), x = c % W, y = (c / W) | 0; for (const k of [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, y > 0 ? c - W : -1, y < H - 1 ? c + W : -1]) if (k >= 0 && foot[k] && !keep[k]) { keep[k] = 1; q.push(k); } }
    const outside = new Uint8Array(W * H);
    for (let x = 0; x < W; x++) for (const y of [0, H - 1]) if (!keep[y * W + x]) { outside[y * W + x] = 1; q.push(y * W + x); }
    for (let y = 0; y < H; y++) for (const x of [0, W - 1]) if (!keep[y * W + x] && !outside[y * W + x]) { outside[y * W + x] = 1; q.push(y * W + x); }
    while (q.length) { const c = q.pop(), x = c % W, y = (c / W) | 0; for (const k of [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, y > 0 ? c - W : -1, y < H - 1 ? c + W : -1]) if (k >= 0 && !keep[k] && !outside[k]) { outside[k] = 1; q.push(k); } }
    // 바꿔 넣기
    for (const p of placed) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const t = y * W + x;
      if (outside[t]) continue;
      const i = ((p.y + y) * w + p.x + x) * 4;
      for (let c = 0; c < 3; c++) out[i + c] = tpl[t * 3 + c];
    }
    info.push({ count: n, w: W, h: H, at: placed.map((p) => [p.x, p.y]), mask: outside });
  }
  return { img: { ...img, data: out }, clusters: info };
}
