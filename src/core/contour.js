// 부드러운 마스크 → 확대·흐림 → 마칭 스퀘어로 서브픽셀 윤곽선 추출

// 마스크에서 값이 있는 영역의 경계 상자(여백 포함)
export function maskBounds(mask, w, h, pad) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (mask[row + x] > 0.02) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  return {
    x0: Math.max(0, x0 - pad), y0: Math.max(0, y0 - pad),
    x1: Math.min(w - 1, x1 + pad), y1: Math.min(h - 1, y1 + pad),
  };
}

// 원본 좌표계 픽셀 i는 [i, i+1] 구간, 확대 격자 X는 원본 (X+0.5)/s 위치의 샘플
export function upsample(mask, w, b, s) {
  const bw = b.x1 - b.x0 + 1, bh = b.y1 - b.y0 + 1;
  const W = bw * s, H = bh * s;
  const out = new Float32Array(W * H);
  for (let Y = 0; Y < H; Y++) {
    let v = (Y + 0.5) / s - 0.5;
    if (v < 0) v = 0; if (v > bh - 1) v = bh - 1;
    const y0 = Math.floor(v), y1 = Math.min(bh - 1, y0 + 1), fy = v - y0;
    const r0 = (b.y0 + y0) * w + b.x0, r1 = (b.y0 + y1) * w + b.x0;
    for (let X = 0; X < W; X++) {
      let u = (X + 0.5) / s - 0.5;
      if (u < 0) u = 0; if (u > bw - 1) u = bw - 1;
      const x0 = Math.floor(u), x1 = Math.min(bw - 1, x0 + 1), fx = u - x0;
      const a = mask[r0 + x0] * (1 - fx) + mask[r0 + x1] * fx;
      const c = mask[r1 + x0] * (1 - fx) + mask[r1 + x1] * fx;
      out[Y * W + X] = a * (1 - fy) + c * fy;
    }
  }
  return { f: out, W, H };
}

export function gaussianBlur(f, W, H, sigma) {
  if (sigma < 0.05) return f;
  const r = Math.ceil(sigma * 3);
  const k = new Float32Array(r * 2 + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)); sum += k[i + r]; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const tmp = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) {
        let xx = x + i; if (xx < 0) xx = 0; else if (xx >= W) xx = W - 1;
        acc += f[row + xx] * k[i + r];
      }
      tmp[row + x] = acc;
    }
  }
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) {
        let yy = y + i; if (yy < 0) yy = 0; else if (yy >= H) yy = H - 1;
        acc += tmp[yy * W + x] * k[i + r];
      }
      out[y * W + x] = acc;
    }
  }
  return out;
}

// 가로·세로 분리 상자 필터. stride로 같은 코드를 두 방향에 쓴다.
function line(src, dst, base, stride, len, r, isMax) {
  if (isMax) {
    for (let b = 0; b < len; b++) {
      let acc = 0;
      const k1 = b + r < len ? b + r : len - 1;
      for (let k = b - r > 0 ? b - r : 0; k <= k1; k++) {
        const v = src[base + k * stride];
        if (v > acc) acc = v;
      }
      dst[base + b * stride] = acc;
    }
  } else {
    let acc = 0, lo = 0, hi = -1;
    for (let b = 0; b < len; b++) {
      const nh = b + r < len ? b + r : len - 1, nl = b - r > 0 ? b - r : 0;
      while (hi < nh) acc += src[base + ++hi * stride];
      while (lo < nl) acc -= src[base + lo++ * stride];
      dst[base + b * stride] = acc / (hi - lo + 1);
    }
  }
}

function boxFilter(f, W, H, r, op) {
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
  const isMax = op === 'max';
  for (let y = 0; y < H; y++) line(f, tmp, y * W, 1, W, r, isMax);
  for (let x = 0; x < W; x++) line(tmp, out, x, W, H, r, isMax);
  return out;
}

// 얇은 획 보존: 흐림 때문에 진하기가 0.5 아래로 떨어진 가는 선을 국소 최대값으로 나눠
// "반값 폭"을 획 두께로 쓰게 한다. 넓고 옅은 영역은 건드리지 않는다.
export function preserveThin(f, W, H, s) {
  const mx = boxFilter(f, W, H, Math.max(1, Math.round(1.5 * s)), 'max');
  const mean = boxFilter(f, W, H, Math.max(2, Math.round(3 * s)), 'mean');
  const out = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const m = mx[i];
    if (m >= 0.36 && m < 0.8 && mean[i] < m * 0.5) out[i] = Math.min(1, f[i] / m);
    else out[i] = f[i];
  }
  return out;
}

// 방향이 일관된 마칭 스퀘어. 격자 밖은 0으로 보고 모든 윤곽을 닫힌 루프로 만든다.
export function marchingSquares(f, W, H, iso = 0.5) {
  const W2 = W + 2;
  const val = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : f[y * W + x]);
  const next = new Map();
  const pos = new Map();
  const cr = [];
  for (let y = -1; y < H; y++) {
    for (let x = -1; x < W; x++) {
      const a = val(x, y), b = val(x + 1, y), c = val(x + 1, y + 1), d = val(x, y + 1);
      const ia = a >= iso, ib = b >= iso, ic = c >= iso, id = d >= iso;
      if (ia === ib && ib === ic && ic === id) continue;
      cr.length = 0;
      // 시계 방향: 위(a→b), 오른쪽(b→c), 아래(c→d), 왼쪽(d→a)
      if (ia !== ib) cr.push(((y + 1) * W2 + (x + 1)) * 2, ib, x + (iso - a) / (b - a), y);
      if (ib !== ic) cr.push(((y + 1) * W2 + (x + 2)) * 2 + 1, ic, x + 1, y + (iso - b) / (c - b));
      if (ic !== id) cr.push(((y + 2) * W2 + (x + 1)) * 2, id, x + 1 - (iso - c) / (d - c), y + 1);
      if (id !== ia) cr.push(((y + 1) * W2 + (x + 1)) * 2 + 1, ia, x, y + 1 - (iso - d) / (a - d));
      const m = cr.length / 4;
      for (let k = 0; k < m; k++) pos.set(cr[k * 4], [cr[k * 4 + 2], cr[k * 4 + 3]]);
      if (m === 2) {
        if (cr[1]) next.set(cr[0], cr[4]); else next.set(cr[4], cr[0]);
      } else {
        const center = (a + b + c + d) / 4 >= iso;
        for (let k = 0; k < 4; k++) {
          if (!cr[k * 4 + 1]) continue;
          const p = center ? (k + 3) % 4 : (k + 1) % 4;
          next.set(cr[k * 4], cr[p * 4]);
        }
      }
    }
  }
  const seen = new Set();
  const loops = [];
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const pts = [];
    let e = start;
    while (e !== undefined && !seen.has(e)) {
      seen.add(e);
      pts.push(pos.get(e));
      e = next.get(e);
    }
    if (pts.length >= 3) loops.push(pts);
  }
  return loops;
}
