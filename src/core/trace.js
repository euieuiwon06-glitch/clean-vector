import { compositeOnWhite, buildPalette, unmix, denoise } from './palette.js?v=37556a61';
import { extractStrokes, inkCoverage } from './strokes.js?v=37556a61';
import { maskBounds, upsample, gaussianBlur, preserveThin, marchingSquares } from './contour.js?v=37556a61';
import { resampleClosed, analyzeContour, alignRuns, equalizeStrokes, buildPath, fitCircle, snapConcentric } from './fit.js?v=37556a61';

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
  minFillet: 6,   // 이보다 작은 둥글림은 흐림 탓으로 보고 날카로운 코너로 복원(px)
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

function boxMean(m, w, h, r) {
  const t = new Float32Array(w * h), o = new Float32Array(w * h);
  for (let y = 0; y < h; y++) { let acc = 0; for (let x = -r; x < w + r; x++) { if (x + r < w && x + r >= 0) acc += m[y * w + x + r]; if (x - r - 1 >= 0 && x - r - 1 < w) acc -= m[y * w + x - r - 1]; if (x >= 0 && x < w) t[y * w + x] = acc; } }
  for (let x = 0; x < w; x++) { let acc = 0; for (let y = -r; y < h + r; y++) { if (y + r < h && y + r >= 0) acc += t[(y + r) * w + x]; if (y - r - 1 >= 0 && y - r - 1 < h) acc -= t[(y - r - 1) * w + x]; if (y >= 0 && y < h) o[y * w + x] = acc; } }
  return o;
}

// 면 얼룩 정리: 원본에서 두 색 사이 경계가 흐릿하게 번져 있으면(음영·그라데이션) 진짜 경계가 아니다.
// 같은 색 계열끼리 흐린 경계로 맞닿은 조각은 더 큰 면으로 합치고, 아주 작은 얼룩은 크기만으로도 흡수한다.
function cleanRegions(masks, palette, bg, w, h, img) {
  const K = palette.length, n = w * h, d = img.data;
  const lab = new Int8Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    let b = -1, bv = 0.5;
    for (let k = 0; k < K; k++) if (masks[k][i] > bv) { bv = masks[k][i]; b = k; }
    lab[i] = b;
  }
  const hue = palette.map((c) => {
    const mx = Math.max(...c), mn = Math.min(...c), dd = mx - mn;
    if (dd < 25) return null;
    const hh = mx === c[0] ? ((c[1] - c[2]) / dd) % 6 : mx === c[1] ? (c[2] - c[0]) / dd + 2 : (c[0] - c[1]) / dd + 4;
    return (hh * 60 + 360) % 360;
  });
  const lumc = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  const chromatic = (k) => hue[k] != null;
  // 같은 계열: 색조가 비슷한 유채색끼리, 또는 유채색의 아주 옅은 틴트와 배경
  const B0 = palette[bg];
  // 옅은 틴트: 배경과의 차이가 작은 유채색(유리·은은한 음영). 배경과 흐리게 맞닿으면 배경으로 흡수
  const pale = palette.map((c, k) => k !== bg && chromatic(k) && Math.hypot(c[0] - B0[0], c[1] - B0[1], c[2] - B0[2]) < 90);
  const family = (a, b) => {
    if (chromatic(a) && chromatic(b)) return Math.min(Math.abs(hue[a] - hue[b]), 360 - Math.abs(hue[a] - hue[b])) < 25;
    if ((a === bg && pale[b]) || (b === bg && pale[a])) return true;
    return false;
  };
  // 원본 기울기(2px 간격 색 차이)
  const g = new Float32Array(n);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const cd = (p, q) => Math.abs(d[p * 4] - d[q * 4]) + Math.abs(d[p * 4 + 1] - d[q * 4 + 1]) + Math.abs(d[p * 4 + 2] - d[q * 4 + 2]);
    g[i] = Math.max(cd(i - 1, i + 1), cd(i - w, i + w));
  }
  // 영역 나누기
  const comp = new Int32Array(n).fill(-1), st = [], areas = [], colors = [], pix = [];
  for (let s0 = 0; s0 < n; s0++) {
    if (lab[s0] < 0 || comp[s0] >= 0) continue;
    const id = areas.length, c = lab[s0], px = [];
    st.push(s0); comp[s0] = id;
    while (st.length) {
      const q = st.pop(); px.push(q);
      const x = q % w, y = (q / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const k = yy * w + xx;
        if (lab[k] === c && comp[k] < 0) { comp[k] = id; st.push(k); }
      }
    }
    areas.push(px.length); colors.push(c); pix.push(px);
  }
  const R = areas.length;
  // 맞닿은 경계: 쌍마다 경계 길이와 흐린 경계 수
  const pair = new Map();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, a = comp[i];
    if (a < 0) continue;
    for (const k of [x + 1 < w ? i + 1 : -1, y + 1 < h ? i + w : -1]) {
      if (k < 0) continue;
      const b = comp[k];
      if (b < 0 || b === a) continue;
      const ca = palette[colors[a]], cb = palette[colors[b]];
      const D = Math.abs(ca[0] - cb[0]) + Math.abs(ca[1] - cb[1]) + Math.abs(ca[2] - cb[2]);
      const gm = Math.max(g[i], g[k]);
      const key = a < b ? a * R + b : b * R + a;
      let e = pair.get(key);
      if (!e) pair.set(key, (e = { a: Math.min(a, b), b: Math.max(a, b), len: 0, soft: 0 }));
      e.len++;
      if (gm < D * 0.45) e.soft++; // 경계를 가로지르는 변화가 색 차이의 절반도 안 됨 = 번진 경계
    }
  }
  const nb = Array.from({ length: R }, () => []);
  for (const e of pair.values()) { nb[e.a].push(e); nb[e.b].push(e); }
  const par = new Int32Array(R).map((_, i) => i);
  const find = (x) => { while (x < R && par[x] !== x) x = par[x]; return x; };
  const area = areas.slice();
  // 배경으로 보낼 때 쓰는 가상의 배경 영역(색 = bg)
  let bgVirtual = -1;
  const bgRoot = () => {
    if (bgVirtual < 0) { bgVirtual = par.length; }
    return bgVirtual;
  };
  const order = [...Array(R).keys()].sort((p, q) => areas[p] - areas[q]);
  const tiny = n * 0.0004, big = n * 0.08;
  for (const r of order) {
    if (find(r) !== r || (area[r] > big && !pale[colors[r]])) continue;
    const c = colors[r];
    let best = -1, bv = 0, tot = 0;
    for (const e of nb[r]) {
      const o = find(e.a === r ? e.b : e.a);
      if (o === r) continue;
      tot += e.len;
      const oc = colors[o];
      const softFrac = e.soft / e.len;
      let ok = false;
      if (family(c, oc) && softFrac > 0.6 && (area[o] >= area[r] || oc === bg)) ok = true; // 같은 계열의 음영 얼룩·배경으로 번지는 옅은 틴트
      else if (area[r] < tiny && chromatic(c) && softFrac > 0.6 && area[o] > area[r] * 4) ok = true; // 아주 작은 번짐 점
      if (ok && e.len > bv) { bv = e.len; best = o; }
    }
    // 옅은 틴트가 배경 쪽으로 흐리게 번져 있으면(번진 경계가 둘레의 20% 이상) 워시(물감 번짐)로 보고 배경으로
    if (pale[c]) {
      let softBg = 0;
      for (const e of nb[r]) { const o = find(e.a === r ? e.b : e.a); if (colors[o] === bg) softBg += e.soft; }
      if (softBg >= tot * 0.2) { best = -2; }
    }
    if (best === -2) { par[r] = bgRoot(r); continue; }
    if (best < 0 || bv < tot * 0.3) continue;
    par[r] = best; area[best] += area[r];
  }
  for (let r = 0; r < R; r++) {
    let t = r, hops = 0;
    while (t < R && par[t] !== t && hops++ < R) t = par[t];
    if (t === r) continue;
    const from = colors[r], to = t >= R ? bg : colors[t];
    if (from === to) continue;
    const mf = masks[from], mt = masks[to];
    for (const q of pix[r]) { mt[q] = Math.min(1, mt[q] + mf[q]); mf[q] = 0; }
  }
}

// 선이 이미 찾은 원(마커 점 등)과 같은 중심을 돌면 그 부분을 정확한 원호로 바꾼다
function snapStrokeCircles(strokes, centers) {
  const flat = (st) => {
    const pts = [st.start];
    let p = st.start;
    for (const g of st.segs) {
      if (g.t === 'L') pts.push([g.x, g.y]);
      else for (let i = 1; i <= 8; i++) {
        const t = i / 8, u = 1 - t;
        pts.push([u * u * u * p[0] + 3 * u * u * t * g.x1 + 3 * u * t * t * g.x2 + t * t * t * g.x, u * u * u * p[1] + 3 * u * u * t * g.y1 + 3 * u * t * t * g.y2 + t * t * t * g.y]);
      }
      p = [g.x, g.y];
    }
    return pts;
  };
  for (const st of strokes) {
    if (st.cap === 'butt') continue;
    for (const { cx, cy, r0 } of centers) {
      const pts = flat(st);
      const rs = pts.map((q) => Math.hypot(q[0] - cx, q[1] - cy));
      const lim = r0 * 4 + 8;
      const near = rs.filter((r) => r < lim && r > r0 + 0.8);
      if (near.length < 4) continue;
      const H = new Map();
      for (const r of near) { const k = Math.round(r * 2); H.set(k, (H.get(k) || 0) + 1); }
      let bk = 0, bv = 0;
      for (const [k] of H) { const v = (H.get(k - 1) || 0) + (H.get(k) || 0) + (H.get(k + 1) || 0); if (v > bv) { bv = v; bk = k; } }
      const R = bk / 2;
      // 띠 안의 연속 구간
      let a = -1, best = null;
      for (let i = 0; i <= pts.length; i++) {
        const inb = i < pts.length && Math.abs(rs[i] - R) < 1.4;
        if (inb && a < 0) a = i;
        if (!inb && a >= 0) {
          const b = i - 1;
          let sweep = 0;
          for (let j = a + 1; j <= b; j++) { let d = Math.atan2(pts[j][1] - cy, pts[j][0] - cx) - Math.atan2(pts[j - 1][1] - cy, pts[j - 1][0] - cx); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; sweep += d; }
          if (!best || Math.abs(sweep) > Math.abs(best.sweep)) best = { a, b, sweep };
          a = -1;
        }
      }
      if (!best || Math.abs(best.sweep) < Math.PI / 3) continue;
      const a0 = Math.atan2(pts[best.a][1] - cy, pts[best.a][0] - cx);
      const n = Math.ceil(Math.abs(best.sweep) / (Math.PI / 2)), da = best.sweep / n, k = (4 / 3) * Math.tan(da / 4) * R;
      const arc = [];
      let an = a0;
      for (let i = 0; i < n; i++) {
        const b2 = an + da;
        const p0 = [cx + R * Math.cos(an), cy + R * Math.sin(an)], p1 = [cx + R * Math.cos(b2), cy + R * Math.sin(b2)];
        arc.push({ t: 'C', x1: p0[0] - k * Math.sin(an), y1: p0[1] + k * Math.cos(an), x2: p1[0] + k * Math.sin(b2), y2: p1[1] - k * Math.cos(b2), x: p1[0], y: p1[1] });
        an = b2;
      }
      const startArc = [cx + R * Math.cos(a0), cy + R * Math.sin(a0)];
      const before = pts.slice(0, best.a), after = pts.slice(best.b + 1);
      const segs = [];
      const start = before.length ? before[0] : startArc;
      for (const q of before.slice(1)) segs.push({ t: 'L', x: q[0], y: q[1] });
      if (before.length) segs.push({ t: 'L', x: startArc[0], y: startArc[1] });
      segs.push(...arc);
      for (const q of after) segs.push({ t: 'L', x: q[0], y: q[1] });
      st.start = start; st.segs = segs;
      break;
    }
  }
}

function flattenFaces(masks, palette, bg, ink, cov, w, h, img) {
  const n = w * h, K = palette.length, d = img.data;
  const cdiff = (p, q) => Math.abs(d[p * 4] - d[q * 4]) + Math.abs(d[p * 4 + 1] - d[q * 4 + 1]) + Math.abs(d[p * 4 + 2] - d[q * 4 + 2]);
  const grad = (i) => { const x = i % w, y = (i / w) | 0; if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) return 0; return Math.max(cdiff(i - 1, i + 1), cdiff(i - w, i + w)); };
  const lab = new Int8Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    let b = -1, bv = 0.5;
    for (let k = 0; k < K; k++) if (masks[k][i] > bv) { bv = masks[k][i]; b = k; }
    lab[i] = b;
  }
  // 면 = 잉크가 아닌 픽셀의 4방향 연결 덩어리
  const wall = new Uint8Array(n);
  for (let i = 0; i < n; i++) wall[i] = cov[i] >= 0.3 || lab[i] === ink ? 1 : 0;
  const face = new Int32Array(n).fill(-1), st = [];
  const faces = [];
  for (let s0 = 0; s0 < n; s0++) {
    if (wall[s0] || face[s0] >= 0) continue;
    const id = faces.length, px = [];
    st.push(s0); face[s0] = id;
    while (st.length) {
      const q = st.pop(); px.push(q);
      const x = q % w, y = (q / w) | 0;
      if (x > 0 && !wall[q - 1] && face[q - 1] < 0) { face[q - 1] = id; st.push(q - 1); }
      if (x < w - 1 && !wall[q + 1] && face[q + 1] < 0) { face[q + 1] = id; st.push(q + 1); }
      if (y > 0 && !wall[q - w] && face[q - w] < 0) { face[q - w] = id; st.push(q - w); }
      if (y < h - 1 && !wall[q + w] && face[q + w] < 0) { face[q + w] = id; st.push(q + w); }
    }
    faces.push(px);
  }
  const B0 = palette[bg];
  const pale = palette.map((c, k) => k !== bg && Math.max(...c) - Math.min(...c) >= 25 && Math.hypot(c[0] - B0[0], c[1] - B0[1], c[2] - B0[2]) < 90);
  for (const px of faces) {
    if (px.length < 30) continue;
    const cnt = new Float64Array(K);
    for (const q of px) if (lab[q] >= 0) cnt[lab[q]]++;
    let M = 0;
    for (let k = 1; k < K; k++) if (cnt[k] > cnt[M]) M = k;
    // 면 안의 다른 색 덩어리
    const seen = new Uint8Array(0);
    const inFace = new Map();
    for (const q of px) inFace.set(q, 1);
    const done = new Set();
    for (const q0 of px) {
      const c = lab[q0];
      if (c < 0 || c === M || c === ink || done.has(q0)) continue;
      const comp = [q0];
      done.add(q0);
      for (let j = 0; j < comp.length; j++) {
        const q = comp[j], x = q % w;
        for (const k of [x > 0 ? q - 1 : -1, x < w - 1 ? q + 1 : -1, q - w, q + w]) {
          if (k < 0 || k >= n || done.has(k) || lab[k] !== c || !inFace.has(k)) continue;
          done.add(k); comp.push(k);
        }
      }
      const A = comp.length;
      // 경계가 또렷하면(원본에서 색이 확 바뀜) 진짜 도형이므로 그대로 둔다. 흐리게 번진 얼룩만 면 색으로
      const pc = palette[c], pm = palette[M];
      const D = Math.abs(pc[0] - pm[0]) + Math.abs(pc[1] - pm[1]) + Math.abs(pc[2] - pm[2]);
      let bl = 0, soft = 0;
      for (const q of comp) {
        const x = q % w;
        for (const k of [x > 0 ? q - 1 : -1, x < w - 1 ? q + 1 : -1, q - w, q + w]) {
          if (k < 0 || k >= n || lab[k] !== M) continue;
          bl++; if (Math.max(grad(q), grad(k)) < D * 0.45) soft++;
        }
      }
      if (!bl || soft < bl * 0.5) continue;
      // 옅은 틴트 얼룩은 면 절반 미만이면, 그 외 색은 면의 30% 미만·작은 조각일 때만 면 색으로
      const replace = (pale[c] && (M === bg || pale[M]) && A < px.length * 0.5) || (A < px.length * 0.3 && A < n * 0.003);
      if (!replace) continue;
      for (const q of comp) { masks[M][q] = Math.min(1, masks[M][q] + masks[c][q]); masks[c][q] = 0; }
    }
    void seen;
  }
}

function fillUnderInk(items, cov, w, h) {
  if (!items.length) return;
  // 선 아래 픽셀은 주변(7x7)에서 잉크가 아닌 픽셀 중 가장 많은 색(배경 포함)으로 정한다.
  // 초록과 흰 바탕 사이 선이면 경계가 선 한가운데에 오게 되어 어느 쪽으로도 색이 새지 않는다.
  const near = items.map((it) => boxMean(it.mask, w, h, 3));
  const nonInk = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) nonInk[i] = 1 - Math.min(1, cov[i]);
  const total = boxMean(nonInk, w, h, 3);
  for (let i = 0; i < w * h; i++) {
    const c = cov[i];
    if (c < 0.03) continue;
    let sum = 0, best = -1, bv = 0;
    for (let k = 0; k < items.length; k++) { sum += near[k][i]; if (near[k][i] > bv) { bv = near[k][i]; best = k; } }
    const bgv = total[i] - sum; // 배경색 몫
    if (best < 0 || bv <= bgv || bv < 2) continue;
    const m = items[best].mask;
    m[i] = Math.min(1, m[i] + c);
  }
}

function widthLevels(strokes) {
  const ws = strokes.map((s) => [s.width, s.segs.length + 1]);
  if (!ws.length) return [1];
  let c = [1, 1.6];
  for (let it = 0; it < 15; it++) {
    const acc = c.map(() => [0, 0]);
    for (const [v, wt] of ws) { let b = 0; for (let k = 1; k < c.length; k++) if (Math.abs(c[k] - v) < Math.abs(c[b] - v)) b = k; acc[b][0] += v * wt; acc[b][1] += wt; }
    c = c.map((x, k) => (acc[k][1] ? acc[k][0] / acc[k][1] : x));
  }
  // 거의 같은 단계는 합치고 0.25 단위로
  const out = [];
  for (const x of c.sort((a, b) => a - b)) { const q = Math.round(x * 4) / 4; if (!out.length || q - out[out.length - 1] > 0.3) out.push(q); }
  return out;
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
  cleanRegions(masks, palette, bg, w, h, img);
  {
    // 선으로 둘러싸인 면마다 색 하나로(물감 번짐·음영 얼룩 제거)
    const lumP0 = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
    let ink0 = -1;
    for (let k = 0; k < palette.length; k++) { const c = palette[k]; if (k !== bg && Math.max(...c) - Math.min(...c) < 28 && lumP0(c) < 90 && (ink0 < 0 || lumP0(c) < lumP0(palette[ink0]))) ink0 = k; }
    if (ink0 >= 0) flattenFaces(masks, palette, bg, ink0, inkCoverage(img, palette[ink0]), w, h, img);
  }
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
    // 선 아래로 색 면을 이어 칠한다: 선을 빼도 초록 면에 구멍(흰 테두리)이 남지 않게
    fillUnderInk(stacked.filter((it) => !it.ink), cov, w, h);
    if (o.debugCov) o.debugCov(cov);
    const r = extractStrokes(cov, w, h, { lineTol: 0.75, snapDeg: 8, binTh: 0.2 });
    const bc = palette[bg], ic = ink.rgb;
    // 색은 검정·회색 두 가지, 굵기는 길이 가중 2~3단계로 통일
    const gray = hex(ic.map((v, k) => Math.round(bc[k] + (v - bc[k]) * 0.5)));
    // 흐림 때문에 재는 폭이 실제보다 굵게 나와 0.8배로 보정
    for (const st of r.strokes) if (!st.fixedWidth) st.width *= 0.95;
    const levels = widthLevels(r.strokes.filter((st) => !st.fixedWidth));
    strokes = r.strokes.map((st) => {
      const wq = st.fixedWidth ? Math.round(st.width * 4) / 4 : levels.reduce((a, b) => (Math.abs(b - st.width) < Math.abs(a - st.width) ? b : a));
      return { ...st, color: st.peak >= 0.5 ? ink.color : gray, width: wq };
    });
    stacked[inkIdx] = { ...ink, mask: r.fillMask };
  }
  const v = vectorize(stacked, w, h, o, progress);
  if (strokes.length && v.centers?.length) snapStrokeCircles(strokes, v.centers);
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
  const pending = [];
  items.forEach(({ color, mask }, li) => {
    progress('윤곽 추출', 0.1 + 0.6 * (li / items.length));
    const b = maskBounds(mask, w, h, 3);
    if (!b) return;
    const s = o.scale;
    const up = upsample(mask, w, b, s);
    let f = gaussianBlur(up.f, up.W, up.H, o.blur * s);
    if (o.thin) f = preserveThin(f, up.W, up.H, s);
    const loops = marchingSquares(f, up.W, up.H, 0.5);
    const cs = [];
    for (const loop of loops) {
      const raw = loop.map(([X, Y]) => [(X + 0.5) / s + b.x0, (Y + 0.5) / s + b.y0]);
      const c = resampleClosed(raw, o.step);
      if (c.area < o.minArea) continue;
      cs.push(c);
    }
    pending.push({ color, cs, bounds: b });
  });
  // 작은 원(점·마커 중심)을 먼저 찾아 기준 중심으로 삼는다
  const centers = [];
  for (const L of pending) for (const c of L.cs) {
    const ci = fitCircle(c.xs, c.ys, c.n);
    if (!ci || ci.r < 1.5 || ci.r > 40) continue;
    if (ci.maxd <= Math.max(0.6, ci.r * 0.12) && Math.abs(c.area - Math.PI * ci.r * ci.r) < Math.PI * ci.r * ci.r * 0.2) centers.push({ cx: ci.cx, cy: ci.cy, r0: ci.r });
  }
  for (const L of pending) {
    const shapes = [];
    for (const c of L.cs) {
      // 거의 원이면(작은 도형) 정확한 원으로
      const ci = fitCircle(c.xs, c.ys, c.n);
      if (ci && ci.r >= 1.5 && ci.r <= 40 && ci.maxd <= Math.max(0.9, ci.r * (ci.r < 8 ? 0.2 : 0.12)) && Math.abs(c.area - Math.PI * ci.r * ci.r) < Math.PI * ci.r * ci.r * 0.22) {
        // 가까운 기준 중심이 있으면 그 중심에 맞춘다(동심원 정렬)
        const ctr = centers.find((q) => Math.hypot(q.cx - ci.cx, q.cy - ci.cy) < Math.max(1.2, ci.r * 0.25));
        shapes.push({ kind: 'circle', cx: ctr ? ctr.cx : ci.cx, cy: ctr ? ctr.cy : ci.cy, r: ci.r });
        continue;
      }
      const sc = centers.length ? snapConcentric(c, centers) : null;
      if (sc && sc.full) { shapes.push({ kind: 'circle', cx: sc.cx, cy: sc.cy, r: sc.R }); continue; }
      shapes.push(analyzeContour(c, { ...o, step: c.length / c.n }));
    }
    allShapes.push(...shapes);
    layers.push({ color: L.color, shapes, bounds: L.bounds });
  }
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
  return { layers, centers, stats: { anchors, paths: pathCount } };
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
      const k = `${st.color}|${st.width}|${st.cap || 'round'}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(openPathData(st));
    }
    out.push('<g id="lines" fill="none" stroke-linecap="round" stroke-linejoin="round">');
    for (const [k, ds] of groups) {
      const [c, wd, cap] = k.split('|');
      out.push(`<path stroke="${c}" stroke-width="${wd}"${cap === 'butt' ? ' stroke-linecap="butt"' : ''} d="${ds.join('')}"/>`);
    }
    out.push('</g>');
  }
  out.push('</svg>');
  return out.join('\n');
}
