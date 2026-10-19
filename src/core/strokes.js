// 선화 중심선 추적: 가는 선을 "테두리 두 개"가 아니라 가운데를 지나는 획(stroke) 하나로 만든다.
// 1) 잉크 덮임 맵에서 가는 부분만 골라 뼈대(skeleton)를 만들고
// 2) 뼈대를 끝점·교차점 사이 선들로 나눠
// 3) 직선은 그림의 주요 방향으로 정렬한 선분, 곡선은 매끈한 베지어로 맞추고
// 4) 선마다 원본 단면에서 굵기·진하기를 재서 일정한 굵기의 획으로 만든다.
import { fitCubic } from './fit.js?v=02bfda52';

const DEG = Math.PI / 180;

function bil(m, w, h, x, y) {
  const x0 = Math.max(0, Math.min(w - 1, Math.floor(x))), y0 = Math.max(0, Math.min(h - 1, Math.floor(y)));
  const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), fx = x - x0, fy = y - y0;
  return (m[y0 * w + x0] * (1 - fx) + m[y0 * w + x1] * fx) * (1 - fy) + (m[y1 * w + x0] * (1 - fx) + m[y1 * w + x1] * fx) * fy;
}

function gblur(f, W, H, sg) {
  const r = Math.ceil(sg * 3), k = [];
  let sum = 0;
  for (let i = -r; i <= r; i++) { const v = Math.exp(-(i * i) / (2 * sg * sg)); k.push(v); sum += v; }
  const kk = k.map((v) => v / sum);
  const t = new Float32Array(W * H), o = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let a = 0; for (let i = -r; i <= r; i++) a += f[y * W + Math.min(W - 1, Math.max(0, x + i))] * kk[i + r]; t[y * W + x] = a; }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let a = 0; for (let i = -r; i <= r; i++) a += t[Math.min(H - 1, Math.max(0, y + i)) * W + x] * kk[i + r]; o[y * W + x] = a; }
  return o;
}

function sample(m, w, h, x, y) {
  x -= 0.5; y -= 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const g = (xx, yy) => (xx < 0 || yy < 0 || xx >= w || yy >= h ? 0 : m[yy * w + xx]);
  return (g(x0, y0) * (1 - fx) + g(x0 + 1, y0) * fx) * (1 - fy) + (g(x0, y0 + 1) * (1 - fx) + g(x0 + 1, y0 + 1) * fx) * fy;
}

// 체스판 거리(3-4 근사)
function distance(B, w, h) {
  const D = new Float32Array(w * h);
  const INF = 1e9;
  for (let i = 0; i < w * h; i++) D[i] = B[i] ? INF : 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!D[i]) continue;
    let v = D[i];
    if (x > 0) v = Math.min(v, D[i - 1] + 1);
    if (y > 0) v = Math.min(v, D[i - w] + 1);
    if (x > 0 && y > 0) v = Math.min(v, D[i - w - 1] + 1.414);
    if (x < w - 1 && y > 0) v = Math.min(v, D[i - w + 1] + 1.414);
    D[i] = v;
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x;
    if (!D[i]) continue;
    let v = D[i];
    if (x < w - 1) v = Math.min(v, D[i + 1] + 1);
    if (y < h - 1) v = Math.min(v, D[i + w] + 1);
    if (x < w - 1 && y < h - 1) v = Math.min(v, D[i + w + 1] + 1.414);
    if (x > 0 && y < h - 1) v = Math.min(v, D[i + w - 1] + 1.414);
    D[i] = v;
  }
  return D;
}

// Zhang-Suen 세선화
function thin(B, w, h) {
  const S = B.slice();
  const rm = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      rm.length = 0;
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (!S[i]) continue;
        const p2 = S[i - w], p3 = S[i - w + 1], p4 = S[i + 1], p5 = S[i + w + 1], p6 = S[i + w], p7 = S[i + w - 1], p8 = S[i - 1], p9 = S[i - w - 1];
        const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (b < 2 || b > 6) continue;
        const a = (!p2 && p3) + (!p3 && p4) + (!p4 && p5) + (!p5 && p6) + (!p6 && p7) + (!p7 && p8) + (!p8 && p9) + (!p9 && p2);
        if (a !== 1) continue;
        if (pass === 0 ? (p2 && p4 && p6) || (p4 && p6 && p8) : (p2 && p4 && p8) || (p2 && p6 && p8)) continue;
        rm.push(i);
      }
      for (const i of rm) S[i] = 0;
      if (rm.length) changed = true;
    }
  }
  return S;
}

const N8 = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

// 뼈대 → 끝점·교차점 사이 선(픽셀 좌표 목록)
function traceSkeleton(S, w, h) {
  const deg = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    if (!S[i]) continue;
    // 교차수: 이웃을 한 바퀴 돌며 0→1로 바뀌는 횟수(계단 모양 대각선은 2로 나와 끊기지 않는다)
    let cn = 0;
    for (let k = 0; k < 8; k++) {
      const [ax, ay] = N8[k], [bx, by] = N8[(k + 1) % 8];
      if (!S[i + ay * w + ax] && S[i + by * w + bx]) cn++;
    }
    let d = 0;
    for (const [dx, dy] of N8) d += S[i + dy * w + dx];
    deg[i] = d === 0 ? 0 : cn === 0 ? 2 : cn;
  }
  const visitedEdge = new Set();
  const key = (a, b) => (a < b ? a * 4294967 + b : b * 4294967 + a);
  const paths = [];
  const isNode = (i) => deg[i] !== 2;
  const walk = (start, next) => {
    const pts = [start, next];
    visitedEdge.add(key(start, next));
    let prev = start, cur = next;
    while (!isNode(cur)) {
      const x = cur % w, y = (cur / w) | 0;
      // 다음 점: 이전 점과 이웃이 아닌(모서리를 깎지 않는) 쪽을 우선
      let nx = -1, alt = -1;
      const px = prev % w, py = (prev / w) | 0;
      for (const [dx, dy] of N8) {
        const j = (y + dy) * w + x + dx;
        if (j === prev || !S[j] || visitedEdge.has(key(cur, j))) continue;
        const jx = x + dx, jy = y + dy;
        if (Math.abs(jx - px) <= 1 && Math.abs(jy - py) <= 1) { if (alt < 0) alt = j; continue; }
        if (nx < 0) nx = j;
      }
      if (nx < 0) nx = alt;
      // 건너뛴 모서리 점의 간선도 쓴 것으로 표시
      if (alt >= 0 && alt !== nx) { visitedEdge.add(key(cur, alt)); visitedEdge.add(key(prev, alt)); visitedEdge.add(key(alt, nx)); }
      if (nx < 0) break;
      visitedEdge.add(key(cur, nx));
      pts.push(nx);
      prev = cur; cur = nx;
      if (cur === start) break;
    }
    return pts;
  };
  for (let i = 0; i < w * h; i++) {
    if (!S[i] || !isNode(i)) continue;
    const x = i % w, y = (i / w) | 0;
    for (const [dx, dy] of N8) {
      const j = (y + dy) * w + x + dx;
      if (S[j] && !visitedEdge.has(key(i, j))) paths.push(walk(i, j));
    }
  }
  // 끝점 없는 고리
  for (let i = 0; i < w * h; i++) {
    if (!S[i] || deg[i] !== 2) continue;
    const x = i % w, y = (i / w) | 0;
    for (const [dx, dy] of N8) {
      const j = (y + dy) * w + x + dx;
      if (S[j] && !visitedEdge.has(key(i, j))) { paths.push(walk(i, j)); break; }
    }
  }
  return { paths, deg };
}

// 뼈대 선 정리: 짧은 가지 제거, 교차점에서 같은 방향으로 이어지는 선은 하나로 합친다
function joinPaths(paths, deg, w) {
  const isEnd = (i) => deg[i] <= 1;
  // 한쪽이 끝점이고 짧은 선 = 모서리에 생긴 가지
  let P = paths.filter((p) => p.length >= 2 && !(p.length <= 5 && (isEnd(p[0]) !== isEnd(p[p.length - 1]))));
  const xy = (i) => [i % w, (i / w) | 0];
  // 끝에서 몇 픽셀 안쪽 방향(교차점에서 선 쪽으로)
  const dirAt = (p, atStart) => {
    const k = Math.min(6, p.length - 1);
    const a = xy(atStart ? p[0] : p[p.length - 1]), b = xy(atStart ? p[k] : p[p.length - 1 - k]);
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  };
  // 교차점(또는 서로 맞닿은 끝)별로 끝을 모은다
  const byNode = new Map();
  P.forEach((p, k) => {
    for (const st of [true, false]) {
      const n = st ? p[0] : p[p.length - 1];
      if (isEnd(n)) continue;
      if (!byNode.has(n)) byNode.set(n, []);
      byNode.get(n).push({ k, st, d: dirAt(p, st) });
    }
  });
  const link = new Map(); // "k:st" → {k, st}
  for (const ends of byNode.values()) {
    const pairs = [];
    for (let a = 0; a < ends.length; a++) for (let b = a + 1; b < ends.length; b++) {
      if (ends[a].k === ends[b].k) continue;
      const dot = ends[a].d[0] * ends[b].d[0] + ends[a].d[1] * ends[b].d[1];
      if (dot < -0.93) pairs.push([dot, a, b]);
    }
    pairs.sort((x, y) => x[0] - y[0]);
    const used = new Set();
    for (const [, a, b] of pairs) {
      if (used.has(a) || used.has(b)) continue;
      used.add(a); used.add(b);
      link.set(`${ends[a].k}:${ends[a].st}`, ends[b]);
      link.set(`${ends[b].k}:${ends[b].st}`, ends[a]);
    }
  }
  const seen = new Uint8Array(P.length);
  const out = [];
  const follow = (k0, enterStart) => {
    let chain = [];
    let k = k0, st = enterStart;
    while (k !== undefined && !seen[k]) {
      seen[k] = 1;
      const p = st ? P[k] : P[k].slice().reverse();
      chain = chain.length ? chain.concat(p.slice(1)) : p.slice();
      const nx = link.get(`${k}:${!st}`);
      if (!nx) break;
      k = nx.k; st = nx.st;
    }
    return chain;
  };
  // 사슬의 시작 = 앞쪽에 연결이 없는 끝
  P.forEach((p, k) => {
    if (seen[k]) return;
    if (!link.has(`${k}:true`)) out.push(follow(k, true));
    else if (!link.has(`${k}:false`)) out.push(follow(k, false));
  });
  P.forEach((p, k) => { if (!seen[k]) out.push(follow(k, true)); });
  return out;
}

// 끊긴 선 잇기: 끝과 끝이 maxGap 안에 있고 서로를 향하면(같은 방향으로 이어지면) 하나로.
// 후보를 한 번에 모아 점수순으로 짝짓는다.
function endInfo(p, st) {
  const a = st ? p[0] : p[p.length - 1], k = Math.min(4, p.length - 1), b = st ? p[k] : p[p.length - 1 - k];
  const l = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
  return { pt: a, d: [(a[0] - b[0]) / l, (a[1] - b[1]) / l] }; // 바깥쪽 방향
}

function bridgeGaps(paths, maxGap, strict = null) {
  const P = paths.filter((p) => p.length >= 2);
  const ends = [];
  P.forEach((p, k) => { for (const st of [true, false]) ends.push({ k, st, ...endInfo(p, st) }); });
  const cell = new Map(), key = (x, y) => `${Math.floor(x / maxGap)},${Math.floor(y / maxGap)}`;
  ends.forEach((e, j) => { const kk = key(...e.pt); if (!cell.has(kk)) cell.set(kk, []); cell.get(kk).push(j); });
  const pairs = [];
  ends.forEach((A, ja) => {
    const cx = Math.floor(A.pt[0] / maxGap), cy = Math.floor(A.pt[1] / maxGap);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const jb of cell.get(`${cx + dx},${cy + dy}`) || []) {
      if (jb <= ja) continue;
      const B = ends[jb];
      if (A.k === B.k) continue;
      const gx = B.pt[0] - A.pt[0], gy = B.pt[1] - A.pt[1], g = Math.hypot(gx, gy);
      if (g > maxGap) continue;
      const opp = A.d[0] * B.d[0] + A.d[1] * B.d[1];
      if (opp > -0.9) continue;
      if (strict) {
        // 먼 틈: 거의 한 직선 위(옆으로 0.8px 이내, 방향 4° 이내)이고 틈 사이에 흐린 잉크라도 있어야
        if (opp > -0.9975) continue;
        const lat = Math.abs(gx * A.d[1] - gy * A.d[0]);
        if (lat > 0.8) continue;
        let acc = 0, n = 0;
        for (let t = 0.2; t <= 0.8; t += 0.1) { acc += strict(A.pt[0] + gx * t, A.pt[1] + gy * t); n++; }
        if (acc / n < 0.12) continue;
      }
      if (g > 0.5 && ((gx * A.d[0] + gy * A.d[1]) / g < 0.85 || (-gx * B.d[0] - gy * B.d[1]) / g < 0.85)) continue;
      pairs.push([g - opp, ja, jb]);
    }
  });
  pairs.sort((x, y) => x[0] - y[0]);
  const link = new Map(), used = new Set();
  // 같은 사슬끼리 고리가 되지 않게 집합 관리
  const par = P.map((_, k) => k);
  const find = (k) => { while (par[k] !== k) { par[k] = par[par[k]]; k = par[k]; } return k; };
  for (const [, ja, jb] of pairs) {
    if (used.has(ja) || used.has(jb)) continue;
    const A = ends[ja], B = ends[jb];
    if (find(A.k) === find(B.k)) continue;
    used.add(ja); used.add(jb);
    par[find(A.k)] = find(B.k);
    link.set(`${A.k}:${A.st}`, B); link.set(`${B.k}:${B.st}`, A);
  }
  const seen = new Uint8Array(P.length), out = [];
  const follow = (k0, enterStart) => {
    let chain = [], k = k0, st = enterStart;
    while (k !== undefined && !seen[k]) {
      seen[k] = 1;
      const p = st ? P[k] : P[k].slice().reverse();
      chain = chain.concat(p);
      const nx = link.get(`${k}:${!st}`);
      if (!nx) break;
      k = nx.k; st = nx.st;
    }
    return chain;
  };
  P.forEach((p, k) => {
    if (seen[k]) return;
    if (!link.has(`${k}:true`)) out.push(follow(k, true));
    else if (!link.has(`${k}:false`)) out.push(follow(k, false));
  });
  P.forEach((p, k) => { if (!seen[k]) out.push(follow(k, true)); });
  return out;
}

// 선 끝 연장: 열린 끝에서 진행 방향으로 maxExt 안에 다른 선이 있으면 그 선까지 늘려 붙인다(교차점 틈 제거)
function extendEnds(paths, maxExt) {
  const segs = [];
  paths.forEach((p, k) => { for (let i = 0; i < p.length - 1; i++) segs.push([k, p[i], p[i + 1]]); });
  const C = 4, grid = new Map(), key = (x, y) => `${Math.floor(x / C)},${Math.floor(y / C)}`;
  segs.forEach((sg, j) => {
    const [, a, b] = sg;
    const x0 = Math.floor(Math.min(a[0], b[0]) / C), x1 = Math.floor(Math.max(a[0], b[0]) / C), y0 = Math.floor(Math.min(a[1], b[1]) / C), y1 = Math.floor(Math.max(a[1], b[1]) / C);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) { const kk = `${x},${y}`; if (!grid.has(kk)) grid.set(kk, []); grid.get(kk).push(j); }
  });
  return paths.map((p, k) => {
    if (p.length < 2) return p;
    const q = p.slice();
    for (const st of [true, false]) {
      const e = endInfo(p, st);
      let bestT = Infinity, hit = null;
      const tx = e.pt[0] + e.d[0] * maxExt, ty = e.pt[1] + e.d[1] * maxExt;
      const cand = new Set();
      for (const [x, y] of [e.pt, [tx, ty]]) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const j of grid.get(`${Math.floor(x / C) + dx},${Math.floor(y / C) + dy}`) || []) cand.add(j);
      for (const j of cand) {
        const [kk, a, b] = segs[j];
        if (kk === k) continue;
        const sx = b[0] - a[0], sy = b[1] - a[1];
        const den = e.d[0] * sy - e.d[1] * sx;
        if (Math.abs(den) < 0.2) continue; // 거의 평행
        const t = ((a[0] - e.pt[0]) * sy - (a[1] - e.pt[1]) * sx) / den;
        const u = ((a[0] - e.pt[0]) * e.d[1] - (a[1] - e.pt[1]) * e.d[0]) / den;
        if (t < -0.3 || t > maxExt || u < -0.05 || u > 1.05) continue;
        if (t < bestT) { bestT = t; hit = [e.pt[0] + e.d[0] * t, e.pt[1] + e.d[1] * t]; }
      }
      if (hit && bestT > 0.05) { if (st) q.unshift(hit); else q.push(hit); }
    }
    return q;
  });
}

function smoothPts(p, it = 2) {
  let q = p;
  for (let k = 0; k < it; k++) {
    q = q.map((pt, i) => (i === 0 || i === q.length - 1 ? pt : [(q[i - 1][0] + 2 * pt[0] + q[i + 1][0]) / 4, (q[i - 1][1] + 2 * pt[1] + q[i + 1][1]) / 4]));
  }
  return q;
}

function rdp(p, tol, a = 0, b = p.length - 1, out = [a]) {
  let md = 0, mi = -1;
  const [ax, ay] = p[a], [bx, by] = p[b];
  const L = Math.hypot(bx - ax, by - ay) || 1e-9;
  for (let i = a + 1; i < b; i++) {
    const d = Math.abs((p[i][0] - ax) * (by - ay) - (p[i][1] - ay) * (bx - ax)) / L;
    if (d > md) { md = d; mi = i; }
  }
  if (md > tol && mi > 0) { rdp(p, tol, a, mi, out); rdp(p, tol, mi, b, out); }
  else out.push(b);
  return out;
}

// 점 묶음에 직선 맞추기
function fitLine(p, a, b) {
  let mx = 0, my = 0;
  for (let i = a; i <= b; i++) { mx += p[i][0]; my += p[i][1]; }
  const n = b - a + 1; mx /= n; my /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = a; i <= b; i++) { const dx = p[i][0] - mx, dy = p[i][1] - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { mx, my, dx: Math.cos(th), dy: Math.sin(th) };
}

function dominantAngles(segs) {
  const H = new Float64Array(180);
  for (const s of segs) {
    let a = Math.round(((Math.atan2(s.dy, s.dx) / DEG) % 180 + 180) % 180) % 180;
    H[a] += s.len;
  }
  const sm = new Float64Array(180);
  for (let a = 0; a < 180; a++) for (let d = -2; d <= 2; d++) sm[a] += H[(a + d + 180) % 180];
  const peaks = [];
  const total = sm.reduce((x, y) => x + y, 0) / 5;
  for (let a = 0; a < 180; a++) {
    if (sm[a] < total * 0.04) continue;
    let ok = true;
    for (let d = -4; d <= 4 && ok; d++) if (d && sm[(a + d + 180) % 180] > sm[a]) ok = false;
    if (ok) {
      // 무게중심으로 소수 각도
      let s = 0, c = 0;
      for (let d = -3; d <= 3; d++) { s += H[(a + d + 180) % 180] * d; c += H[(a + d + 180) % 180]; }
      peaks.push(a + (c ? s / c : 0));
    }
  }
  for (const a of [0, 90]) if (!peaks.some((p) => Math.abs(p - a) < 3 || Math.abs(p - a - 180) < 3)) peaks.push(a);
  return peaks.map((a) => a * DEG);
}

const intersect = (A, B) => {
  const den = A.dx * B.dy - A.dy * B.dx;
  if (Math.abs(den) < 1e-6) return null;
  const t = ((B.mx - A.mx) * B.dy - (B.my - A.my) * B.dx) / den;
  return [A.mx + A.dx * t, A.my + A.dy * t];
};

// m: 잉크 덮임(0~1), 원본 크기. 반환: { strokes:[{pts|segs, width, peak}], fillMask }
// 잉크 덮임: 주변(7x7)에서 가장 밝은 색을 바탕으로 보고, 픽셀이 바탕→잉크 사이 어디쯤인지(0~1).
// 바탕→잉크 직선에서 벗어난 색(초록 경계 등)은 잉크가 아니다.
export function inkCoverage(img, ink) {
  const { width: w, height: h, data } = img;
  const L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114;
  // 가로·세로 분리 최대 위치(7x7)
  const R = 3;
  const hx = new Int32Array(w * h), best = new Int32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let bi = y * w + x;
    for (let k = Math.max(0, x - R); k <= Math.min(w - 1, x + R); k++) if (L[y * w + k] > L[bi]) bi = y * w + k;
    hx[y * w + x] = bi;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let bi = hx[y * w + x];
    for (let k = Math.max(0, y - R); k <= Math.min(h - 1, y + R); k++) { const c = hx[k * w + x]; if (L[c] > L[bi]) bi = c; }
    best[y * w + x] = bi;
  }
  const m = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const b = best[i] * 4;
    const br = data[b], bg = data[b + 1], bb = data[b + 2];
    const vx = ink[0] - br, vy = ink[1] - bg, vz = ink[2] - bb;
    const vv = vx * vx + vy * vy + vz * vz;
    if (vv < 900) {
      // 주변이 온통 잉크(두꺼운 글자·면 안쪽): 픽셀이 잉크색에 가까우면 잉크
      const d = Math.hypot(data[i * 4] - ink[0], data[i * 4 + 1] - ink[1], data[i * 4 + 2] - ink[2]);
      if (d < 60) m[i] = 1;
      continue;
    }
    const r = data[i * 4] - br, g = data[i * 4 + 1] - bg, bl = data[i * 4 + 2] - bb;
    let t = (r * vx + g * vy + bl * vz) / vv;
    if (t <= 0.06) continue;
    if (t > 1) t = 1;
    const res = Math.hypot(r - vx * t, g - vy * t, bl - vz * t);
    if (res > 22 + 30 * t) continue;
    m[i] = t;
  }
  return m;
}

export function extractStrokes(m, w, h, o = {}) {
  const maxHalf = o.maxHalf ?? 2.2; // 이보다 두꺼운 곳은 면으로 둔다
  const B = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) B[i] = m[i] >= (o.binTh ?? 0.3) ? 1 : 0;
  const D = distance(B, w, h);
  // 두꺼운 핵 → 원래 크기로 되돌린 영역 = 면
  const core = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) core[i] = D[i] > maxHalf ? 1 : 0;
  // 선이 겹쳐 잠깐 두꺼워진 작은 핵(8px 미만)은 면으로 보지 않는다
  {
    const seen = new Uint8Array(w * h), st = [], cells = [];
    for (let s0 = 0; s0 < w * h; s0++) {
      if (!core[s0] || seen[s0]) continue;
      st.push(s0); seen[s0] = 1; cells.length = 0;
      while (st.length) {
        const c = st.pop(); cells.push(c);
        const cx = c % w, cy = (c / w) | 0;
        for (const [dx, dy] of N8) {
          const xx = cx + dx, yy = cy + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const k = yy * w + xx;
          if (core[k] && !seen[k]) { seen[k] = 1; st.push(k); }
        }
      }
      if (cells.length < 8) for (const c of cells) core[c] = 0;
    }
  }
  const thick = new Uint8Array(w * h);
  const R = Math.ceil(maxHalf) + 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!core[y * w + x]) continue;
    const r = D[y * w + x] + 1.5;
    for (let dy = -R - 1; dy <= R + 1; dy++) for (let dx = -R - 1; dx <= R + 1; dx++) {
      if (dx * dx + dy * dy > (r + 0.5) ** 2) continue;
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < w && yy < h) thick[yy * w + xx] = 1;
    }
  }
  // 잉크 덩어리별 판단: 크고(가로·세로 40px 이상) 대부분 가는 선이면 선화 → 중심선,
  // 글자·점·두꺼운 도형은 면으로 둔다.
  const comp = new Int32Array(w * h).fill(-1);
  const asStroke = [];
  {
    let id = 0;
    const st = [];
    for (let s0 = 0; s0 < w * h; s0++) {
      if (!B[s0] || comp[s0] >= 0) continue;
      st.push(s0); comp[s0] = id;
      let x0 = w, y0 = h, x1 = 0, y1 = 0, area = 0, thickArea = 0;
      while (st.length) {
        const c = st.pop(), cx = c % w, cy = (c / w) | 0;
        area++; if (thick[c]) thickArea++;
        if (cx < x0) x0 = cx; if (cx > x1) x1 = cx; if (cy < y0) y0 = cy; if (cy > y1) y1 = cy;
        for (const [dx, dy] of N8) {
          const xx = cx + dx, yy = cy + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const k = yy * w + xx;
          if (B[k] && comp[k] < 0) { comp[k] = id; st.push(k); }
        }
      }
      asStroke.push(Math.max(x1 - x0, y1 - y0) >= (o.minNet ?? 40) && thickArea < area * 0.35);
      id++;
    }
  }
  const thinB = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) thinB[i] = B[i] && !thick[i] && asStroke[comp[i]] ? 1 : 0;
  // 1px 경계를 비운다(세선화 안전)
  for (let x = 0; x < w; x++) { thinB[x] = 0; thinB[(h - 1) * w + x] = 0; }
  for (let y = 0; y < h; y++) { thinB[y * w] = 0; thinB[y * w + w - 1] = 0; }
  // 능선(ridge) 추적: 덮임 맵을 3배로 키워 선 단면의 꼭대기만 남긴다.
  // 가까이 붙은 두 선도 사이에 조금이라도 골이 있으면 따로 잡힌다.
  const U = 3, W3 = w * U, H3 = h * U;
  const up = new Float32Array(W3 * H3);
  for (let Y = 0; Y < H3; Y++) {
    const v = (Y + 0.5) / U - 0.5, y0 = Math.max(0, Math.min(h - 1, Math.floor(v))), y1 = Math.min(h - 1, y0 + 1), fy = Math.max(0, Math.min(1, v - y0));
    for (let X = 0; X < W3; X++) {
      const u = (X + 0.5) / U - 0.5, x0 = Math.max(0, Math.min(w - 1, Math.floor(u))), x1 = Math.min(w - 1, x0 + 1), fx = Math.max(0, Math.min(1, u - x0));
      up[Y * W3 + X] = (m[y0 * w + x0] * (1 - fx) + m[y0 * w + x1] * fx) * (1 - fy) + (m[y1 * w + x0] * (1 - fx) + m[y1 * w + x1] * fx) * fy;
    }
  }
  const G = gblur(up, W3, H3, 1.1);
  const RG = new Uint8Array(W3 * H3);
  for (let Y = 2; Y < H3 - 2; Y++) for (let X = 2; X < W3 - 2; X++) {
    const i = Y * W3 + X;
    if (G[i] < 0.22) continue;
    if (!thinB[((Y / U) | 0) * w + ((X / U) | 0)] && !thinB[(Math.round(Y / U - 0.5)) * w + Math.round(X / U - 0.5)]) continue;
    const gxx = G[i - 1] - 2 * G[i] + G[i + 1], gyy = G[i - W3] - 2 * G[i] + G[i + W3];
    const gxy = (G[i - W3 - 1] + G[i + W3 + 1] - G[i - W3 + 1] - G[i + W3 - 1]) / 4;
    // 가장 크게 휘는 방향(선을 가로지르는 방향)
    const tr2 = (gxx + gyy) / 2, det = Math.sqrt(((gxx - gyy) / 2) ** 2 + gxy * gxy);
    const l1 = tr2 - det; // 더 음수인 고유값
    if (l1 > -0.002) continue;
    let nx = gxy, ny = l1 - gxx;
    if (Math.abs(nx) + Math.abs(ny) < 1e-9) { nx = l1 - gyy; ny = gxy; }
    const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
    const s1 = bil(G, W3, H3, X + nx, Y + ny), s2 = bil(G, W3, H3, X - nx, Y - ny);
    if (G[i] >= s1 && G[i] >= s2) RG[i] = 1;
  }
  const S = thin(RG, W3, H3);
  const tr = traceSkeleton(S, W3, H3);
  let paths = joinPaths(tr.paths, tr.deg, W3)
    .filter((p) => p.length >= U * 2)
    .map((p) => p.map((i) => [((i % W3) + 0.5) / U, (((i / W3) | 0) + 0.5) / U]));
  // 3배 격자 점은 촘촘하므로 원래 간격(약 1px)으로 솎는다
  paths = paths.map((p) => p.filter((_, k) => k % U === 0 || k === p.length - 1));
  paths = bridgeGaps(paths, 2.5);
  paths = bridgeGaps(paths, 9, (x, y) => sample(m, w, h, x, y));
  paths = extendEnds(paths, 3);

  // 1차: 선분 나누기
  const items = [];
  for (const raw of paths) {
    const p = smoothPts(raw, 2);
    const idx = rdp(p, o.lineTol ?? 0.75);
    const segs = [];
    for (let k = 0; k < idx.length - 1; k++) {
      const a = idx[k], b = idx[k + 1];
      const L = fitLine(p, a, b);
      const len = Math.hypot(p[b][0] - p[a][0], p[b][1] - p[a][1]);
      segs.push({ a, b, ...L, len });
    }
    items.push({ p, segs });
  }
  const doms = dominantAngles(items.flatMap((it) => it.segs.filter((s) => s.len >= 6)));

  const strokes = [];
  for (const { p, segs } of items) {
    let total = 0;
    for (const s of segs) total += s.len;
    if (total < 1.2) continue;
    // 곡선 판정: 짧은 조각이 많고 꺾임이 고르면 곡선
    // 꺾임이 모두 완만하면(다각형으로 근사된 매끈한 곡선) 곡선
    const turns = [];
    for (let k = 0; k < segs.length - 1; k++) {
      const A = segs[k], Bs = segs[k + 1];
      const ax = p[A.b][0] - p[A.a][0], ay = p[A.b][1] - p[A.a][1], bx = p[Bs.b][0] - p[Bs.a][0], by = p[Bs.b][1] - p[Bs.a][1];
      turns.push(Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by)));
    }
    const shortCnt = segs.filter((s) => s.len < 5).length;
    const curvy = segs.length >= 3 && (shortCnt / segs.length > 0.5 || Math.max(...turns) < 32 * DEG);
    // 굵기·진하기: 법선 방향 단면
    let wsum = 0, psum = 0, cnt = 0;
    const ws = [];
    for (let i = 1; i < p.length - 1; i += 1) {
      const tx = p[i + 1][0] - p[i - 1][0], ty = p[i + 1][1] - p[i - 1][1];
      const tl = Math.hypot(tx, ty) || 1;
      const nx = -ty / tl, ny = tx / tl;
      // 가운데서 양쪽으로, 덮임이 끊기거나 다시 올라가면(옆 선) 멈춘다
      let area = sample(m, w, h, p[i][0], p[i][1]) * 0.5, peak = area * 2;
      for (const sg of [-1, 1]) {
        let prevV = peak;
        for (let t = 0.5; t <= 3.001; t += 0.5) {
          const v = sample(m, w, h, p[i][0] + nx * t * sg, p[i][1] + ny * t * sg);
          if (v < 0.05 || v > prevV + 0.05) break;
          area += v * 0.5; prevV = v;
          if (v > peak) peak = v;
        }
      }
      // 진하기는 보간값이 아닌 실제 픽셀 최댓값(3x3)으로
      const cx = Math.floor(p[i][0]), cy = Math.floor(p[i][1]);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = cx + dx, yy = cy + dy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h && m[yy * w + xx] > peak) peak = m[yy * w + xx];
      }
      wsum += area; psum += peak; cnt++;
      ws.push(area / Math.max(peak, 0.35));
    }
    const peak = cnt ? Math.min(1, psum / cnt) : 0.8;
    if (peak < 0.2) continue;
    // 진하기가 낮은 선은 색을 연하게, 굵기는 덮임/진하기
    // 굵기 = 단면 폭의 중앙값(교차점·옆 선 때문에 튀는 값 무시)
    ws.sort((a, b) => a - b);
    const width = Math.max(0.6, Math.min(maxHalf * 2, ws.length ? ws[ws.length >> 1] : 1));
    if (curvy) {
      const q = smoothPts(p, 3);
      const out = [];
      const n = q.length - 1;
      const t1 = norm2(q[Math.min(2, n)][0] - q[0][0], q[Math.min(2, n)][1] - q[0][1]);
      const t2 = norm2(q[Math.max(0, n - 2)][0] - q[n][0], q[Math.max(0, n - 2)][1] - q[n][1]);
      fitCubic(q, t1, t2, o.curveTol ?? 0.6, out);
      strokes.push({ start: q[0], segs: out, width, peak, closed: dist2(q[0], q[n]) < 0.5 });
      continue;
    }
    // 직선: 각도 정렬 후 인접 선분 교점으로 연결
    const L = segs.map((s) => {
      let ang = Math.atan2(s.dy, s.dx);
      for (const d of doms) {
        for (const base of [d, d + Math.PI, d - Math.PI]) {
          if (Math.abs(ang - base) < (o.snapDeg ?? 3.5) * DEG) { ang = base; break; }
        }
      }
      return { ...s, dx: Math.cos(ang), dy: Math.sin(ang) };
    });
    // 같은 각도로 정렬되고 거의 같은 선 위의 이웃 선분은 합친다
    for (let k = L.length - 2; k >= 0; k--) {
      const A = L[k], Bq = L[k + 1];
      const same = Math.abs(A.dx * Bq.dy - A.dy * Bq.dx) < Math.sin(1.5 * DEG) && A.dx * Bq.dx + A.dy * Bq.dy > 0;
      const off = Math.abs((Bq.mx - A.mx) * -A.dy + (Bq.my - A.my) * A.dx);
      if (same && off < 0.8) {
        const len = A.len + Bq.len;
        L.splice(k, 2, { ...A, b: Bq.b, mx: (A.mx * A.len + Bq.mx * Bq.len) / len, my: (A.my * A.len + Bq.my * Bq.len) / len, len });
      }
    }
    const proj = (s, pt) => { const t = (pt[0] - s.mx) * s.dx + (pt[1] - s.my) * s.dy; return [s.mx + s.dx * t, s.my + s.dy * t]; };
    const pts = [proj(L[0], p[L[0].a])];
    for (let k = 0; k < L.length - 1; k++) {
      const X = intersect(L[k], L[k + 1]);
      const e = p[L[k].b];
      if (X && Math.hypot(X[0] - e[0], X[1] - e[1]) < 3) pts.push(X);
      else { pts.push(proj(L[k], e)); pts.push(proj(L[k + 1], e)); }
    }
    pts.push(proj(L[L.length - 1], p[L[L.length - 1].b]));
    strokes.push({ start: pts[0], segs: pts.slice(1).map(([x, y]) => ({ t: 'L', x, y })), width, peak, closed: false });
  }

  // 면으로 남길 것: 두꺼운 부분 + 선화가 아닌 덩어리(글자·점) + 그 가장자리 반투명 픽셀
  const fillB = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (B[i] && (thick[i] || !asStroke[comp[i]])) fillB[i] = 1;
  const fillMask = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (fillB[i]) { fillMask[i] = m[i]; continue; }
    if (B[i] || m[i] <= 0) continue;
    // 가장자리: 이웃 면 픽셀이 있으면 반투명 덮임 유지
    for (const [dx, dy] of N8) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < w && yy < h && fillB[yy * w + xx]) { fillMask[i] = m[i]; break; }
    }
  }
  return { strokes, fillMask };
}

const norm2 = (x, y) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
