// 선화 중심선 추적: 가는 선을 "테두리 두 개"가 아니라 가운데를 지나는 획(stroke) 하나로 만든다.
// 1) 잉크 덮임 맵에서 가는 부분만 골라 뼈대(skeleton)를 만들고
// 2) 뼈대를 끝점·교차점 사이 선들로 나눠
// 3) 직선은 그림의 주요 방향으로 정렬한 선분, 곡선은 매끈한 베지어로 맞추고
// 4) 선마다 원본 단면에서 굵기·진하기를 재서 일정한 굵기의 획으로 만든다.
import { fitCubic } from './fit.js?v=a68ca6f1';

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
  let P = paths.filter((p) => p.length >= 2 && !(p.length <= 12 && (isEnd(p[0]) !== isEnd(p[p.length - 1]))));
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
        if (t < -2.5 || t > maxExt || u < -0.05 || u > 1.05) continue;
        // 앞쪽(틈)과 뒤쪽(삐져나감) 중 끝에서 가장 가까운 교차
        if (Math.abs(t) < Math.abs(bestT)) { bestT = t; hit = [e.pt[0] + e.d[0] * t, e.pt[1] + e.d[1] * t]; }
      }
      if (hit && bestT > 0.05) { if (st) q.unshift(hit); else q.push(hit); }
      else if (hit && bestT < -0.4) {
        // 다른 선을 지나 조금 삐져나간 끝: 교차점에서 자른다
        const cut = -bestT;
        if (st) { while (q.length > 2 && dist2(q[0], e.pt) < cut) q.shift(); q.unshift(hit); }
        else { while (q.length > 2 && dist2(q[q.length - 1], e.pt) < cut) q.pop(); q.push(hit); }
      }
    }
    return q;
  });
}

// 덩어리 하나를 곧은 막대로 맞춰 본다(덮임 무게 주축). 길이 ≥ 폭×3, 축에서 벗어남이 작으면 막대.
function fitDash(px, m, w, h) {
  // 가장자리 반투명 픽셀까지 포함
  const set = new Set(px);
  for (const c of px) { const x = c % w, y = (c / w) | 0; for (const [dx, dy] of N8) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < w && yy < h && m[yy * w + xx] > 0.05) set.add(yy * w + xx); } }
  let sw = 0, mx = 0, my = 0;
  for (const c of set) { const v = m[c]; sw += v; mx += v * ((c % w) + 0.5); my += v * (((c / w) | 0) + 0.5); }
  if (sw < 1) return null;
  mx /= sw; my /= sw;
  let sxx = 0, syy = 0, sxy = 0;
  for (const c of set) { const v = m[c], dx = (c % w) + 0.5 - mx, dy = ((c / w) | 0) + 0.5 - my; sxx += v * dx * dx; syy += v * dy * dy; sxy += v * dx * dy; }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = Math.cos(th), uy = Math.sin(th);
  // 길이: 축 방향 분산으로(균일 막대면 길이² / 12), 폭 = 잉크 양 / 길이
  const vu = (sxx * ux * ux + 2 * sxy * ux * uy + syy * uy * uy) / sw, vv = (sxx * uy * uy - 2 * sxy * ux * uy + syy * ux * ux) / sw;
  const len = Math.sqrt(Math.max(0, 12 * vu - 1)), wid = sw / Math.max(1, len);
  if (len < 3 || len < wid * 3 || wid > 3.2) return null;
  if (Math.sqrt(vv) > wid * 0.45 + 0.35) return null; // 휘었거나 덩어리
  // 가지(ㅏ의 짧은 획 등)가 있으면 막대가 아니다: 진한 픽셀이 모두 축 가까이에 있어야
  for (const c of set) {
    if (m[c] < 0.4) continue;
    const dx = (c % w) + 0.5 - mx, dy = ((c / w) | 0) + 0.5 - my;
    if (Math.abs(dx * -uy + dy * ux) > wid / 2 + 0.9) return null;
  }
  return { cx: mx, cy: my, ux, uy, len, width: wid };
}

// 전체 직선 정렬: 같은 각도이고 옆으로 1.3px 안에 있는 직선들은 한 줄 위에 놓는다(겹침·계단 제거)
function consolidateLines(lines) {
  const groups = new Map();
  for (const L of lines) {
    let a = Math.atan2(L.dy, L.dx) / DEG;
    a = ((a % 180) + 180) % 180;
    const key = Math.round(a * 2) / 2 % 180;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(L);
  }
  for (const [key, arr] of groups) {
    const nx = -Math.sin(key * DEG), ny = Math.cos(key * DEG);
    const items = arr.map((L) => ({ L, off: L.mx * nx + L.my * ny })).sort((a, b) => a.off - b.off);
    let cl = [];
    const flush = () => {
      if (cl.length > 1) {
        let sw = 0, so = 0;
        for (const it of cl) { sw += it.L.len; so += it.off * it.L.len; }
        const target = so / sw;
        for (const it of cl) { const d = target - it.off; it.L.mx += nx * d; it.L.my += ny * d; }
      }
      cl = [];
    };
    for (const it of items) {
      if (cl.length && (it.off - cl[0].off > 1.3)) flush();
      cl.push(it);
    }
    flush();
  }
}

// 끝점 용접(강제 교정): 열린 직선 끝을 주변과 확실히 잇는다.
// 1) 끝점 두 개가 r 안에 있고 방향이 다르면 → 두 끝선의 교점으로 모아 모서리
// 2) 끝점이 다른 직선 옆 r 안에 있으면 → 그 직선까지 늘리거나 잘라 T자로
function weldEnds(strokes, r) {
  // 끝의 짧은 꺾인 조각(둥글게 말린 모서리 반쪽)은 떼어 두고, 긴 직선 방향으로 판단한다
  for (const st of strokes) {
    if (st.closed) continue;
    for (const atStart of [false, true]) {
      // 끝 쪽 조각 목록(끝에서 안쪽 순서): [점, 그 점으로 들어오는 조각]
      const pts = [st.start, ...st.segs.map((g) => [g.x, g.y])];
      const n = pts.length;
      if (n < 3) continue;
      const segAt = (m) => st.segs[m - 1]; // pts[m-1] → pts[m]
      const idx = (k) => (atStart ? k : n - 1 - k); // 끝에서 k번째 점의 인덱스
      const segBetween = (k) => (atStart ? segAt(idx(k)) : segAt(idx(k - 1) + 0 === idx(k - 1) ? idx(k - 1) : idx(k - 1))); // 끝에서 k-1 ↔ k 사이 조각
      void segBetween;
      // 끝에서 안쪽으로 걸어가며 짧은 직선 조각 합산
      let k = 0, acc = 0, ok = true;
      while (k < n - 2) {
        const a = pts[idx(k)], b = pts[idx(k + 1)];
        const g = atStart ? st.segs[idx(k)] : st.segs[idx(k) - 1];
        if (!g || g.t !== 'L') { ok = false; break; }
        const l = dist2(a, b);
        if (l >= 9 || acc + l >= 16) break;
        acc += l; k++;
      }
      if (!ok || k === 0) continue;
      const g2 = atStart ? st.segs[idx(k)] : st.segs[idx(k) - 1];
      if (!g2 || g2.t !== 'L' || dist2(pts[idx(k)], pts[idx(k + 1)]) < 6) continue;
      const P0 = pts[idx(k)], P1 = pts[idx(k + 1)];
      const dx = P0[0] - P1[0], dy = P0[1] - P1[1], dl = Math.hypot(dx, dy);
      const tip = pts[idx(0)];
      if (Math.abs((tip[0] - P0[0]) * dy - (tip[1] - P0[1]) * dx) / dl < 0.8) continue;
      const removed = [];
      for (let q = 0; q < k; q++) removed.push(pts[idx(q)]);
      if (atStart) { st.start = P0; st.segs = st.segs.slice(k); }
      else st.segs = st.segs.slice(0, st.segs.length - k);
      (st.curl ||= {})[atStart ? 'start' : 'end'] = removed;
    }
  }
  const ends = [];
  strokes.forEach((st, k) => {
    if (st.closed || !st.segs.length) return;
    const pts = [st.start, ...st.segs.map((g) => [g.x, g.y])];
    const n = pts.length;
    // 끝 조각이 직선일 때만
    if (st.segs[0].t === 'L') ends.push({ k, st: true, p: pts[0], q: pts[1] });
    if (st.segs[n - 2].t === 'L') ends.push({ k, st: false, p: pts[n - 1], q: pts[n - 2] });
  });
  const setEnd = (e, pt) => {
    const s0 = strokes[e.k];
    if (e.st) s0.start = pt; else { const g = s0.segs[s0.segs.length - 1]; g.x = pt[0]; g.y = pt[1]; }
    e.p = pt;
  };
  const line = (e) => { const dx = e.p[0] - e.q[0], dy = e.p[1] - e.q[1], l = Math.hypot(dx, dy) || 1; return { mx: e.q[0], my: e.q[1], dx: dx / l, dy: dy / l, len: l }; };
  const used = new Set();
    const cl = (e) => { const c = strokes[e.k].curl?.[e.st ? 'start' : 'end']; if (!c) return 0; let t = dist2(c[c.length - 1], e.p); for (let q = 1; q < c.length; q++) t += dist2(c[q], c[q - 1]); return t; };
  // 1) 끝점끼리
  const pairs = [];
  for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length; j++) {
    const A = ends[i], B = ends[j];
    if (A.k === B.k) continue;
    const g = dist2(A.p, B.p);
    if (g > r + cl(A) + cl(B)) continue;
    pairs.push([g, i, j]);
  }
  pairs.sort((a, b) => a[0] - b[0]);
  for (const [, i, j] of pairs) {
    if (used.has(i) || used.has(j)) continue;
    const A = ends[i], B = ends[j], LA = line(A), LB = line(B);
    const sin = Math.abs(LA.dx * LB.dy - LA.dy * LB.dx);
    let X;
    if (sin > Math.sin(25 * DEG)) {
      X = intersect(LA, LB);
      if (!X || dist2(X, A.p) > r * 1.5 + cl(A) || dist2(X, B.p) > r * 1.5 + cl(B)) continue;
      // 교점이 선 안쪽으로 너무 들어가면(선을 깎아먹음) 안 됨
      if ((X[0] - A.q[0]) * LA.dx + (X[1] - A.q[1]) * LA.dy < LA.len * 0.5) continue;
      if ((X[0] - B.q[0]) * LB.dx + (X[1] - B.q[1]) * LB.dy < LB.len * 0.5) continue;
    } else if (LA.dx * LB.dx + LA.dy * LB.dy < -0.9) {
      X = [(A.p[0] + B.p[0]) / 2, (A.p[1] + B.p[1]) / 2]; // 일직선으로 마주봄 → 가운데서 만남
    } else continue;
    const curlA = strokes[A.k].curl?.[A.st ? 'start' : 'end'] || [], curlB = strokes[B.k].curl?.[B.st ? 'start' : 'end'] || [];
    const curl = curlA.concat(curlB);
    let dmin = Infinity;
    for (const c of curl) dmin = Math.min(dmin, dist2(c, X));
    if (sin > Math.sin(25 * DEG) && curl.length && dmin > 1.2) {
      // 원래 둥근 모서리 → 두 직선에 접하는 원호로 잇는다
      const dA = dist2(X, A.p), dB = dist2(X, B.p), d = Math.min(Math.max(dA, dB), Math.min(LA.len, LB.len) * 0.9);
      const pA = [X[0] - LA.dx * d, X[1] - LA.dy * d], pB = [X[0] - LB.dx * d, X[1] - LB.dy * d];
      const turn = Math.acos(Math.max(-1, Math.min(1, -(LA.dx * LB.dx + LA.dy * LB.dy))));
      const ang = Math.PI - turn, rr = d * Math.tan(turn / 2) || d, kk = (4 / 3) * Math.tan(ang / 4) * rr;
      setEnd(A, pA); setEnd(B, pB);
      const sA = strokes[A.k];
      const arcSeg = { t: 'C', x1: pA[0] + LA.dx * kk, y1: pA[1] + LA.dy * kk, x2: pB[0] + LB.dx * kk, y2: pB[1] + LB.dy * kk, x: pB[0], y: pB[1] };
      if (A.st) { // A의 시작에 붙인다: 시작점을 pB로, 첫 조각을 원호(뒤집기)로
        sA.segs.unshift({ t: 'C', x1: arcSeg.x2, y1: arcSeg.y2, x2: arcSeg.x1, y2: arcSeg.y1, x: pA[0], y: pA[1] });
        sA.start = pB;
      } else sA.segs.push(arcSeg);
      used.add(i); used.add(j);
      continue;
    }
    setEnd(A, X); setEnd(B, X);
    used.add(i); used.add(j);
  }
  // 짝을 못 찾은 끝은 떼어 둔 조각을 되돌린다(선이 짧아지지 않게)
  ends.forEach((e, i) => {
    if (used.has(i)) return;
    const st = strokes[e.k], c = st.curl?.[e.st ? 'start' : 'end'];
    if (!c || !c.length) return;
    const back = c.slice().reverse(); // 안쪽→끝 순서
    if (e.st) { const pts = back.reverse(); st.segs.unshift(...[...pts.slice(1), st.start].map(([x, y]) => ({ t: 'L', x, y }))); st.start = pts[0]; e.p = st.start; }
    else { st.segs.push(...back.map(([x, y]) => ({ t: 'L', x, y }))); e.p = back[back.length - 1]; }
    e.q = e.st ? (st.segs[0].t === 'L' ? [st.segs[0].x, st.segs[0].y] : e.q) : e.q;
  });
  // 2) 끝점 → 다른 직선(T자)
  const segs = [];
  strokes.forEach((st, k) => {
    const pts = [st.start, ...st.segs.map((g) => [g.x, g.y])];
    st.segs.forEach((g, m) => { if (g.t === 'L') segs.push({ k, a: pts[m], b: pts[m + 1] }); });
  });
  ends.forEach((e, i) => {
    if (used.has(i)) return;
    const L = line(e);
    let best = null;
    for (const sg of segs) {
      if (sg.k === e.k) continue;
      const sx = sg.b[0] - sg.a[0], sy = sg.b[1] - sg.a[1];
      const den = L.dx * sy - L.dy * sx;
      if (Math.abs(den) < Math.hypot(sx, sy) * Math.sin(20 * DEG)) continue;
      const t = ((sg.a[0] - e.p[0]) * sy - (sg.a[1] - e.p[1]) * sx) / den;
      const u = ((sg.a[0] - e.p[0]) * L.dy - (sg.a[1] - e.p[1]) * L.dx) / den;
      if (u < -0.02 || u > 1.02 || t < -r || t > r) continue;
      if (t < 0 && -t > L.len * 0.5) continue; // 자르면 선이 반 넘게 없어짐
      if (!best || Math.abs(t) < Math.abs(best.t)) best = { t };
    }
    if (best && Math.abs(best.t) > 0.05) setEnd(e, [e.p[0] + L.dx * best.t, e.p[1] + L.dy * best.t]);
  });
}

// 곡선 조각이 원호에 잘 맞으면(오차 ≤ max(0.45, r×6%)) 정확한 원호로. 시작·끝점은 원 위로 옮긴다
function arcFit(q) {
  const n = q.length;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0;
  for (const [x, y] of q) { const z = x * x + y * y; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z; sz += z; }
  const M = [[sxx, sxy, sx, -sxz], [sxy, syy, sy, -syz], [sx, sy, n, -sz]];
  for (let c = 0; c < 3; c++) {
    let pv = c; for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[pv][c])) pv = r;
    if (Math.abs(M[pv][c]) < 1e-9) return null;
    [M[c], M[pv]] = [M[pv], M[c]];
    for (let r = 0; r < 3; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k]; }
  }
  const D = M[0][3] / M[0][0], E = M[1][3] / M[1][1], F = M[2][3] / M[2][2];
  const cx = -D / 2, cy = -E / 2, r2 = cx * cx + cy * cy - F;
  if (r2 <= 0) return null;
  const r = Math.sqrt(r2);
  if (r > 80 || r < 1.5) return null;
  let md = 0;
  for (const [x, y] of q) md = Math.max(md, Math.abs(Math.hypot(x - cx, y - cy) - r));
  if (md > Math.max(0.45, r * 0.06)) return null;
  // 진행 각도(누적)
  let a0 = Math.atan2(q[0][1] - cy, q[0][0] - cx), prev = a0, total = 0;
  for (let i = 1; i < n; i++) { const a = Math.atan2(q[i][1] - cy, q[i][0] - cx); let d = a - prev; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; total += d; prev = a; }
  if (Math.abs(total) < 25 * DEG) return null;
  const pieces = Math.ceil(Math.abs(total) / (Math.PI / 2));
  const da = total / pieces, k = (4 / 3) * Math.tan(da / 4) * r;
  const segs = [];
  let a = a0;
  for (let i = 0; i < pieces; i++) {
    const b = a + da;
    const p0 = [cx + r * Math.cos(a), cy + r * Math.sin(a)], p1 = [cx + r * Math.cos(b), cy + r * Math.sin(b)];
    segs.push({ t: 'C', x1: p0[0] - k * Math.sin(a), y1: p0[1] + k * Math.cos(a), x2: p1[0] + k * Math.sin(b), y2: p1[1] - k * Math.cos(b), x: p1[0], y: p1[1] });
    a = b;
  }
  return { segs, start: [cx + r * Math.cos(a0), cy + r * Math.sin(a0)] };
}

// 마지막 선 끝 정리: 모든 열린 끝을 가장 가까운 다른 선에 정확히 붙이고(틈 메우기·삐져나감 자르기), 꼬다리 제거
function finalizeEnds(strokes, r) {
  const flat = (st) => {
    const pts = [st.start];
    let p = st.start;
    for (const g of st.segs) {
      if (g.t === 'L') pts.push([g.x, g.y]);
      else for (let i = 1; i <= 4; i++) { const t = i / 4, u = 1 - t; pts.push([u * u * u * p[0] + 3 * u * u * t * g.x1 + 3 * u * t * t * g.x2 + t * t * t * g.x, u * u * u * p[1] + 3 * u * u * t * g.y1 + 3 * u * t * t * g.y2 + t * t * t * g.y]); }
      p = [g.x, g.y];
    }
    return pts;
  };
  const lenOf = (pts) => { let L = 0; for (let i = 1; i < pts.length; i++) L += dist2(pts[i], pts[i - 1]); return L; };
  const segs = [];
  const C = 6, grid = new Map();
  strokes.forEach((st, k) => {
    const pts = flat(st);
    for (let i = 0; i < pts.length - 1; i++) {
      const j = segs.length;
      segs.push([k, pts[i], pts[i + 1]]);
      const a = pts[i], b = pts[i + 1];
      for (let x = Math.floor(Math.min(a[0], b[0]) / C); x <= Math.floor(Math.max(a[0], b[0]) / C); x++)
        for (let y = Math.floor(Math.min(a[1], b[1]) / C); y <= Math.floor(Math.max(a[1], b[1]) / C); y++) {
          const kk = x + ',' + y; if (!grid.has(kk)) grid.set(kk, []); grid.get(kk).push(j);
        }
    }
  });
  const drop = new Set();
  strokes.forEach((st, k) => {
    if (st.closed || st.cap === 'butt') return;
    for (const atStart of [true, false]) {
      const pts = flat(st);
      const L = lenOf(pts);
      const seq = atStart ? pts : pts.slice().reverse();
      const e = seq[0];
      // 방향: 끝에서 3px 이상 안쪽 점 기준
      let q = seq[1], acc = dist2(seq[0], seq[1]);
      for (let i = 2; i < seq.length && acc < 3; i++) { acc += dist2(seq[i], seq[i - 1]); q = seq[i]; }
      const dx = e[0] - q[0], dy = e[1] - q[1], dl = Math.hypot(dx, dy);
      if (dl < 0.5) continue;
      const ux = dx / dl, uy = dy / dl;
      const cand = new Set();
      for (let gx = -1; gx <= 1; gx++) for (let gy = -1; gy <= 1; gy++) for (const j of grid.get((Math.floor(e[0] / C) + gx) + ',' + (Math.floor(e[1] / C) + gy)) || []) cand.add(j);
      let bestT = Infinity;
      for (const j of cand) {
        const [kk, a, b] = segs[j];
        if (kk === k || drop.has(kk)) continue;
        const sx = b[0] - a[0], sy = b[1] - a[1], sl = Math.hypot(sx, sy);
        if (sl < 1e-6) continue;
        const den = ux * sy - uy * sx;
        if (Math.abs(den) < sl * Math.sin(20 * DEG)) continue;
        const t = ((a[0] - e[0]) * sy - (a[1] - e[1]) * sx) / den, u = ((a[0] - e[0]) * uy - (a[1] - e[1]) * ux) / den;
        if (u < -0.03 || u > 1.03 || t > r || t < -r) continue;
        if (t < 0 && -t > L * 0.6) continue; // 자르면 선 대부분이 사라짐
        if (Math.abs(t) < Math.abs(bestT)) bestT = t;
      }
      if (bestT === Infinity || Math.abs(bestT) < 0.15) continue;
      const X = [e[0] + ux * bestT, e[1] + uy * bestT];
      if (bestT > 0) {
        // 늘리기: 끝 직선 연장
        if (atStart) { st.segs.unshift({ t: 'L', x: st.start[0], y: st.start[1] }); st.start = X; }
        else st.segs.push({ t: 'L', x: X[0], y: X[1] });
      } else {
        // 자르기: 끝에서 |t|만큼 잘라낸다(직선 조각만 처리)
        let cut = -bestT;
        if (atStart) {
          while (st.segs.length > 1 && st.segs[0].t === 'L' && dist2(st.start, [st.segs[0].x, st.segs[0].y]) <= cut + 1e-6) {
            cut -= dist2(st.start, [st.segs[0].x, st.segs[0].y]); st.start = [st.segs[0].x, st.segs[0].y]; st.segs.shift();
          }
          st.start = X;
        } else {
          const prevPt = (m) => (m === 0 ? st.start : [st.segs[m - 1].x, st.segs[m - 1].y]);
          while (st.segs.length > 1 && st.segs[st.segs.length - 1].t === 'L' && dist2(prevPt(st.segs.length - 1), [st.segs[st.segs.length - 1].x, st.segs[st.segs.length - 1].y]) <= cut + 1e-6) {
            const m = st.segs.length - 1;
            cut -= dist2(prevPt(m), [st.segs[m].x, st.segs[m].y]); st.segs.pop();
          }
          const g = st.segs[st.segs.length - 1];
          if (g.t === 'L') { g.x = X[0]; g.y = X[1]; } else st.segs.push({ t: 'L', x: X[0], y: X[1] });
        }
      }
    }
  });
  // 꼬다리 제거: 5px 미만이고 다른 선에 붙어 있거나, 2.5px 미만 부스러기
  strokes.forEach((st, k) => {
    if (st.closed || st.cap === 'butt') return;
    const pts = flat(st), L = lenOf(pts);
    if (L >= 5) return;
    if (L < 2.5) { drop.add(k); return; }
    for (const e of [pts[0], pts[pts.length - 1]]) {
      for (const j of grid.get(Math.floor(e[0] / C) + ',' + Math.floor(e[1] / C)) || []) {
        const [kk, a, b] = segs[j];
        if (kk === k) continue;
        const sx = b[0] - a[0], sy = b[1] - a[1], l2 = sx * sx + sy * sy || 1;
        const t = Math.max(0, Math.min(1, ((e[0] - a[0]) * sx + (e[1] - a[1]) * sy) / l2));
        if (dist2(e, [a[0] + sx * t, a[1] + sy * t]) < 1.2) { drop.add(k); return; }
      }
    }
  });
  if (drop.size) {
    const keep = strokes.filter((_, k) => !drop.has(k));
    strokes.length = 0; strokes.push(...keep);
  }
}

// 선 끝 펴기: 끝 2.5px 안에서 안쪽 직선(끝에서 2~8px 구간)을 벗어나 굽은 점은 그 직선 위로 옮긴다.
// 교차점 근처에서 뼈대가 휘는 현상 때문에 T자·모서리가 둥글게 나오는 것을 막는다.
function straightenEnds(p) {
  if (p.length < 10) return p;
  const q = p.slice();
  for (const st of [true, false]) {
    const idx = (k) => (st ? k : q.length - 1 - k);
    const a = 3, b = Math.min(10, q.length - 1);
    let mx = 0, my = 0;
    for (let k = a; k <= b; k++) { mx += q[idx(k)][0]; my += q[idx(k)][1]; }
    const n = b - a + 1; mx /= n; my /= n;
    let sxx = 0, syy = 0, sxy = 0, maxr = 0;
    for (let k = a; k <= b; k++) { const dx = q[idx(k)][0] - mx, dy = q[idx(k)][1] - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = Math.cos(th), uy = Math.sin(th);
    for (let k = a; k <= b; k++) maxr = Math.max(maxr, Math.abs((q[idx(k)][0] - mx) * -uy + (q[idx(k)][1] - my) * ux));
    if (maxr > 0.35) continue; // 안쪽이 직선이 아니면(곡선) 그대로
    for (let k = 0; k < a; k++) {
      const pt = q[idx(k)], t = (pt[0] - mx) * ux + (pt[1] - my) * uy;
      q[idx(k)] = [mx + ux * t, my + uy * t];
    }
  }
  return q;
}

// 꺾이는 점(코너) 찾기: 앞뒤 ~2.5px 방향 차이가 크고 그 주변에서 가장 큰 곳
function findCorners(p) {
  const n = p.length, out = [];
  if (n < 11) return out;
  const turn = (i, k) => {
    if (i - k < 0 || i + k >= n) return 0;
    const ax = p[i][0] - p[i - k][0], ay = p[i][1] - p[i - k][1], bx = p[i + k][0] - p[i][0], by = p[i + k][1] - p[i][1];
    return Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by));
  };
  const big = new Float64Array(n), small = new Float64Array(n);
  for (let i = 5; i < n - 5; i++) { big[i] = turn(i, 5); small[i] = turn(i, 2); }
  for (let i = 5; i < n - 5; i++) {
    // 진짜 코너: 넓게 봐도 좁게 봐도 비슷하게 꺾임. 둥근 모서리(원호)는 좁게 보면 조금만 꺾임
    if (big[i] < 38 * DEG || small[i] < big[i] * 0.62) continue;
    let mx = true;
    for (let j = Math.max(5, i - 4); j <= Math.min(n - 6, i + 4); j++) if (big[j] > big[i] || (big[j] === big[i] && j < i)) { mx = false; break; }
    if (mx) out.push(i);
  }
  return out;
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
  for (let i = 0; i < w * h; i++) B[i] = m[i] >= (o.binTh ?? 0.2) ? 1 : 0;
  // 두꺼운 면 판정은 진한 부분만으로(흐린 선이 뭉쳐 면으로 잡히지 않게)
  const BT = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) BT[i] = m[i] >= 0.45 ? 1 : 0;
  const D = distance(BT, w, h);
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
  const dashes = [], isDash = [];
  {
    let id = 0;
    const st = [];
    for (let s0 = 0; s0 < w * h; s0++) {
      if (!B[s0] || comp[s0] >= 0) continue;
      st.push(s0); comp[s0] = id;
      let x0 = w, y0 = h, x1 = 0, y1 = 0, area = 0, thickArea = 0;
      const px = [];
      while (st.length) {
        const c = st.pop(), cx = c % w, cy = (c / w) | 0;
        area++; if (thick[c]) thickArea++;
        if (px.length < 400) px.push(c);
        if (cx < x0) x0 = cx; if (cx > x1) x1 = cx; if (cy < y0) y0 = cy; if (cy > y1) y1 = cy;
        for (const [dx, dy] of N8) {
          const xx = cx + dx, yy = cy + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const k = yy * w + xx;
          if (B[k] && comp[k] < 0) { comp[k] = id; st.push(k); }
        }
      }
      asStroke.push(Math.max(x1 - x0, y1 - y0) >= (o.minNet ?? 40) && thickArea < area * 0.35);
      // 점선 조각·짧은 막대: 곧고 가는 작은 덩어리 → 끝이 각진 직선 하나
      const md = Math.max(x1 - x0, y1 - y0) + 1;
      let dash = null;
      if (!asStroke[id] && md >= 4 && md <= 30 && px.length < 400) dash = fitDash(px, m, w, h);
      isDash.push(!!dash);
      if (dash) dashes.push(dash);
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
    if (G[i] < 0.14) continue;
    if (!thinB[((Y / U) | 0) * w + ((X / U) | 0)] && !thinB[(Math.round(Y / U - 0.5)) * w + Math.round(X / U - 0.5)]) continue;
    const gxx = G[i - 1] - 2 * G[i] + G[i + 1], gyy = G[i - W3] - 2 * G[i] + G[i + W3];
    const gxy = (G[i - W3 - 1] + G[i + W3 + 1] - G[i - W3 + 1] - G[i + W3 - 1]) / 4;
    // 가장 크게 휘는 방향(선을 가로지르는 방향)
    const tr2 = (gxx + gyy) / 2, det = Math.sqrt(((gxx - gyy) / 2) ** 2 + gxy * gxy);
    const l1 = tr2 - det; // 더 음수인 고유값
    if (l1 > -0.0012) continue;
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
  paths = paths.map(straightenEnds);
  paths = extendEnds(paths, 3.5);

  // 1차: 코너에서 조각으로 나누고, 조각마다 다듬은 뒤 선분으로 나눈다(코너는 다듬지 않아 둥글어지지 않음)
  const items = [];
  for (const raw of paths) {
    const cs = findCorners(raw);
    const bounds = [0, ...cs, raw.length - 1];
    const pieces = [];
    for (let k = 0; k < bounds.length - 1; k++) {
      const pc = smoothPts(raw.slice(bounds[k], bounds[k + 1] + 1), 2);
      if (pc.length < 2) continue;
      const idx = rdp(pc, o.lineTol ?? 0.75);
      const segs = [];
      for (let j = 0; j < idx.length - 1; j++) {
        const a = idx[j], b = idx[j + 1];
        const L = fitLine(pc, a, b);
        const len = Math.hypot(pc[b][0] - pc[a][0], pc[b][1] - pc[a][1]);
        // 진행 방향으로 맞춤
        if ((pc[b][0] - pc[a][0]) * L.dx + (pc[b][1] - pc[a][1]) * L.dy < 0) { L.dx = -L.dx; L.dy = -L.dy; }
        segs.push({ a, b, ...L, len });
      }
      pieces.push({ p: pc, segs });
    }
    items.push({ p: raw, pieces });
  }
  const doms = dominantAngles(items.flatMap((it) => it.pieces.flatMap((pc) => pc.segs.filter((s) => s.len >= 6))));
  const snap = (s) => {
    let ang = Math.atan2(s.dy, s.dx);
    for (const d of doms) for (const base of [d, d + Math.PI, d - Math.PI, d - 2 * Math.PI]) {
      if (Math.abs(ang - base) < (s.len !== undefined && s.len < 8 ? 15 : (o.snapDeg ?? 3.5)) * DEG) return { ...s, dx: Math.cos(base), dy: Math.sin(base) };
    }
    return s;
  };
  const proj = (s, pt) => { const t = (pt[0] - s.mx) * s.dx + (pt[1] - s.my) * s.dy; return [s.mx + s.dx * t, s.my + s.dy * t]; };

  const strokes = [];
  const prepared = [];
  for (const { p, pieces } of items) {
    if (!pieces.length) continue;
    let total = 0;
    for (const pc of pieces) for (const sg of pc.segs) total += sg.len;
    if (total < 3) continue; // 짧은 부스러기·잔가지
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
    // 조각별 판정: 꺾임이 모두 완만하고 짧은 조각이 많으면 곡선, 아니면 직선(주요 방향으로 정렬)
    const parts = pieces.map(({ p: pc, segs }) => {
      const turns = [];
      for (let k = 0; k < segs.length - 1; k++) {
        const A = segs[k], Bs = segs[k + 1];
        turns.push(Math.abs(Math.atan2(A.dx * Bs.dy - A.dy * Bs.dx, A.dx * Bs.dx + A.dy * Bs.dy)));
      }
      const shortCnt = segs.filter((sg) => sg.len < 5).length;
      const curvy = segs.length >= 3 && (shortCnt / segs.length > 0.5 || Math.max(...turns) < 25 * DEG);
      // 거의 곧은 곡선(현에서 벗어남이 작음)은 흐림 때문에 흔들린 직선으로 보고 편다
      if (curvy) {
        const a0 = pc[0], a1 = pc[pc.length - 1], cl = dist2(a0, a1);
        let dev = 0;
        if (cl > 1e-6) for (const q of pc) dev = Math.max(dev, Math.abs((q[0] - a0[0]) * (a1[1] - a0[1]) - (q[1] - a0[1]) * (a1[0] - a0[0])) / cl);
        if (cl > 3 && dev < Math.max(1.3, cl * 0.09)) {
          const Lf = fitLine(pc, 0, pc.length - 1);
          if ((a1[0] - a0[0]) * Lf.dx + (a1[1] - a0[1]) * Lf.dy < 0) { Lf.dx = -Lf.dx; Lf.dy = -Lf.dy; }
          const L1 = [snap({ a: 0, b: pc.length - 1, ...Lf, len: cl, pa: a0, pb: a1 })];
          L1[0].pa = a0; L1[0].pb = a1;
          return { curvy: false, p: pc, L: L1 };
        }
        return { curvy, p: pc };
      }
      const L = segs.map(snap);
      for (let k = L.length - 2; k >= 0; k--) {
        const A = L[k], Bq = L[k + 1];
        // 거의 같은 방향(8° 이내)으로 살짝 꺾이거나 어긋난 직선은 원본 왜곡으로 보고 하나로 편다
        const same = Math.abs(A.dx * Bq.dy - A.dy * Bq.dx) < Math.sin(8 * DEG) && A.dx * Bq.dx + A.dy * Bq.dy > 0;
        const off = Math.abs((Bq.mx - A.mx) * -A.dy + (Bq.my - A.my) * A.dx);
        if (same && off < 1.6) {
          const len = A.len + Bq.len;
          const keep = A.len >= Bq.len ? A : Bq; // 긴 쪽 방향을 따른다
          L.splice(k, 2, { ...A, dx: keep.dx, dy: keep.dy, b: Bq.b, pb: Bq.pb, mx: (A.mx * A.len + Bq.mx * Bq.len) / len, my: (A.my * A.len + Bq.my * Bq.len) / len, len });
        }
      }
      for (const l of L) { l.pa = pc[l.a]; l.pb = pc[l.b]; }
      return { curvy, p: pc, L };
    });
    // 짧은 직선 조각이 두 직선 사이에 끼어 있으면(모따기처럼 보이는 둥근 모서리) 한 조각으로 합쳐 원호 처리 대상으로
    for (let k = parts.length - 2; k >= 1; k--) {
      const A = parts[k - 1], M = parts[k], Bp = parts[k + 1];
      if (!A || !M || !Bp) continue;
      if (A.curvy || M.curvy || Bp.curvy) continue;
      const ml = M.L.reduce((t, l) => t + l.len, 0);
      if (ml >= 16) continue;
      parts.splice(k - 1, 3, { curvy: false, p: A.p.concat(M.p, Bp.p), L: A.L.concat(M.L, Bp.L), merged: true });
      k = Math.min(k, parts.length - 1);
    }
    prepared.push({ p, parts, width, peak });
  }
  consolidateLines(prepared.flatMap((it) => it.parts.filter((pt) => !pt.curvy).flatMap((pt) => pt.L)));
  for (const { p, parts, width, peak } of prepared) {
    // 이어 붙이기: 직선끼리 만나는 곳은 두 직선의 교점(날카로운 코너)
    const out = [];
    let start = null, cur = null;
    const lineTo = (pt) => { if (!start) { start = pt; cur = pt; return; } if (dist2(cur, pt) > 1e-3) out.push({ t: 'L', x: pt[0], y: pt[1] }); cur = pt; };
    parts.forEach((pt, k) => {
      const prev = parts[k - 1], next = parts[k + 1];
      if (pt.curvy) {
        const q = smoothPts(pt.p, 2);
        if (start) q[0] = cur; else { start = q[0]; cur = q[0]; }
        const n = q.length - 1;
        const t1 = norm2(q[Math.min(2, n)][0] - q[0][0], q[Math.min(2, n)][1] - q[0][1]);
        const t2 = norm2(q[Math.max(0, n - 2)][0] - q[n][0], q[Math.max(0, n - 2)][1] - q[n][1]);
        const arc = n >= 6 ? arcFit(q) : null;
        if (arc) out.push(...arc.segs);
        else if (n >= 2) fitCubic(q, t1, t2, o.curveTol ?? 0.6, out); else out.push({ t: 'L', x: q[n][0], y: q[n][1] });
        cur = q[n];
        return;
      }
      const L = pt.L, P = pt.p;
      // 시작점: 앞 조각이 직선이면 교점, 아니면 투영
      if (!start) lineTo(proj(L[0], L[0].pa));
      else if (prev && !prev.curvy) { /* 교점은 앞 조각 끝에서 이미 찍음 */ }
      else lineTo(proj(L[0], cur));
      for (let j = 0; j < L.length - 1; j++) {
        // 둥근 모서리: 긴 직선 사이에 낀 짧은 조각들(합쳐 14px 미만) → 두 직선에 접하는 원호
        let t = j + 1, shortLen = 0;
        while (t < L.length && L[t].len < 13 && shortLen + L[t].len < 20) { shortLen += L[t].len; t++; }
        const G2 = L[t];
        if (t > j + 1 && G2 && L[j].len >= 6 && G2.len >= 6) {
          const turnAll = Math.abs(Math.atan2(L[j].dx * G2.dy - L[j].dy * G2.dx, L[j].dx * G2.dx + L[j].dy * G2.dy));
          const X = intersect(L[j], G2);
          if (turnAll > 50 * DEG && turnAll < 150 * DEG && X) {
            const p1 = proj(L[j], L[j + 1].pa), p2 = proj(G2, L[t - 1].pb);
            const d = (dist2(X, p1) + dist2(X, p2)) / 2;
            // 원래 점들이 꼭짓점 가까이를 지나가면 각진 모서리(흐림 때문에 생긴 짧은 조각일 뿐)
            let dmin = Infinity;
            for (let q = j + 1; q < t; q++) { dmin = Math.min(dmin, dist2(L[q].pa, X), dist2(L[q].pb, X)); const mid = [(L[q].pa[0] + L[q].pb[0]) / 2, (L[q].pa[1] + L[q].pb[1]) / 2]; dmin = Math.min(dmin, dist2(mid, X)); }
            if (dmin < 1.1) { lineTo(X); cur = X; j = t - 1; continue; }
            if (d < 14) {
              const a1 = [X[0] - L[j].dx * d, X[1] - L[j].dy * d], a2 = [X[0] + G2.dx * d, X[1] + G2.dy * d];
              // 원호 근사 핸들 길이: r·(4/3)·tan(θ/4), r = d / tan(θ/2)
              const r = d / Math.tan(turnAll / 2), k2 = (4 / 3) * Math.tan(turnAll / 4) * r;
              lineTo(a1);
              out.push({ t: 'C', x1: a1[0] + L[j].dx * k2, y1: a1[1] + L[j].dy * k2, x2: a2[0] - G2.dx * k2, y2: a2[1] - G2.dy * k2, x: a2[0], y: a2[1] });
              cur = a2;
              j = t - 1; // 짧은 조각들 건너뜀
              continue;
            }
          }
        }
        const X = intersect(L[j], L[j + 1]), e = L[j].pb;
        if (X && dist2(X, e) < 3) lineTo(X); else { lineTo(proj(L[j], e)); lineTo(proj(L[j + 1], e)); }
      }
      const last = L[L.length - 1];
      if (next && !next.curvy) {
        const X = intersect(last, next.L[0]), e = last.pb;
        if (X && dist2(X, e) < 4) lineTo(X); else { lineTo(proj(last, e)); lineTo(proj(next.L[0], e)); }
      } else lineTo(proj(last, last.pb));
    });
    if (!start || !out.length) continue;
    strokes.push({ start, segs: out, width, peak, closed: dist2(p[0], p[p.length - 1]) < 0.5 && p.length > 4 });
  }

  // 면으로 남길 것: 두꺼운 부분 + 선화가 아닌 덩어리(글자·점) + 그 가장자리 반투명 픽셀
  const fillB = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (B[i] && (thick[i] || (!asStroke[comp[i]] && !isDash[comp[i]]))) fillB[i] = 1;
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
  // 닫힌(또는 거의 닫힌) 원형 선은 정확한 원으로
  for (const st of strokes) {
    const pts = [st.start, ...st.segs.map((g) => [g.x, g.y])];
    if (pts.length < 5) continue;
    const closedish = st.closed || dist2(pts[0], pts[pts.length - 1]) < 3;
    if (!closedish) continue;
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    let cx = 0, cy = 0; for (const q of pts) { cx += q[0]; cy += q[1]; } cx /= pts.length; cy /= pts.length;
    const rs = pts.map((q) => Math.hypot(q[0] - cx, q[1] - cy)), r = rs.reduce((a, b) => a + b, 0) / rs.length;
    if (r < 2 || r > 60 || Math.max(...rs.map((v) => Math.abs(v - r))) > Math.max(0.8, r * 0.12)) continue;
    void xs; void ys;
    const k = 0.5523 * r;
    st.start = [cx + r, cy];
    st.segs = [
      { t: 'C', x1: cx + r, y1: cy + k, x2: cx + k, y2: cy + r, x: cx, y: cy + r },
      { t: 'C', x1: cx - k, y1: cy + r, x2: cx - r, y2: cy + k, x: cx - r, y: cy },
      { t: 'C', x1: cx - r, y1: cy - k, x2: cx - k, y2: cy - r, x: cx, y: cy - r },
      { t: 'C', x1: cx + k, y1: cy - r, x2: cx + r, y2: cy - k, x: cx + r, y: cy },
    ];
    st.closed = true;
  }
  weldEnds(strokes, 6);
  finalizeEnds(strokes, 5);
  finalizeEnds(strokes, 5);
  for (const d of dashes) {
    let s1 = snap({ dx: d.ux, dy: d.uy, mx: d.cx, my: d.cy });
    const hl = d.len / 2;
    strokes.push({ start: [d.cx - s1.dx * hl, d.cy - s1.dy * hl], segs: [{ t: 'L', x: d.cx + s1.dx * hl, y: d.cy + s1.dy * hl }], width: Math.min(d.width, 2.2), peak: 1, closed: false, cap: 'butt' });
  }
  return { strokes, fillMask };
}

const norm2 = (x, y) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// ---------- 마무리: 이어지는 선 합치기 ----------
function reverseStroke(st) {
  const pts = [st.start, ...st.segs.map((g) => [g.x, g.y])];
  const segs = [];
  for (let i = st.segs.length - 1; i >= 0; i--) {
    const g = st.segs[i], to = pts[i];
    segs.push(g.t === 'C' ? { t: 'C', x1: g.x2, y1: g.y2, x2: g.x1, y2: g.y1, x: to[0], y: to[1] } : { t: 'L', x: to[0], y: to[1] });
  }
  return { ...st, start: pts[pts.length - 1], segs };
}
function strokeLen(st) {
  let p = st.start, L = 0;
  for (const g of st.segs) { L += Math.hypot(g.x - p[0], g.y - p[1]); p = [g.x, g.y]; }
  return L;
}
// 끝의 바깥 방향(끝점에서 밖으로)
function endDir(st, atStart) {
  const pts = [st.start, ...st.segs.map((g) => [g.x, g.y])];
  let e, q;
  if (atStart) {
    e = pts[0]; const g = st.segs[0]; q = g.t === 'C' ? [g.x1, g.y1] : pts[1];
    if (dist2(e, q) < 0.3) q = pts[Math.min(2, pts.length - 1)];
  } else {
    e = pts[pts.length - 1]; const g = st.segs[st.segs.length - 1]; q = g.t === 'C' ? [g.x2, g.y2] : pts[pts.length - 2];
    if (dist2(e, q) < 0.3) q = pts[Math.max(0, pts.length - 3)];
  }
  const l = dist2(e, q) || 1;
  return { p: e, d: [(e[0] - q[0]) / l, (e[1] - q[1]) / l] };
}

// 끝과 끝이 가깝고(r 이내) 서로를 향해 자연스럽게 이어지면 한 패스로 합친다.
// 합친 패스는 굵기·색을 하나로(긴 쪽 기준) — 굵기가 바뀌며 생기던 요철 제거
export function chainStrokes(strokes, r = 6) {
  let S = strokes.filter((st) => st.segs.length);
  for (let pass = 0; pass < 3; pass++) {
    const ends = [];
    S.forEach((st, k) => { if (!st.closed && st.cap !== 'butt') for (const a of [true, false]) ends.push({ k, a, ...endDir(st, a) }); });
    const R3 = r * 3.5; // 긴 직선끼리 한 줄 위면 더 멀리까지 잇는다
    const C = R3, grid = new Map();
    const lens = S.map(strokeLen);
    ends.forEach((e, j) => { const key = Math.floor(e.p[0] / C) + ',' + Math.floor(e.p[1] / C); if (!grid.has(key)) grid.set(key, []); grid.get(key).push(j); });
    const pairs = [];
    ends.forEach((A, ja) => {
      const cx = Math.floor(A.p[0] / C), cy = Math.floor(A.p[1] / C);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const jb of grid.get((cx + dx) + ',' + (cy + dy)) || []) {
        if (jb <= ja) continue;
        const B = ends[jb];
        if (A.k === B.k) continue;
        const gx = B.p[0] - A.p[0], gy = B.p[1] - A.p[1], g = Math.hypot(gx, gy);
        const turn = -(A.d[0] * B.d[0] + A.d[1] * B.d[1]); // 1 = 일직선으로 이어짐
        if (g > r) {
          const lat = Math.abs(gx * A.d[1] - gy * A.d[0]);
          if (!(g <= R3 && turn > 0.996 && lat < r * 0.2 && lens[A.k] >= g * 2.5 && lens[B.k] >= g * 2.5 && (gx * A.d[0] + gy * A.d[1]) > 0)) continue;
          pairs.push([g, ja, jb]);
          continue;
        }
        if (g < 1.2) { if (turn < Math.cos(70 * Math.PI / 180)) continue; }
        else {
          if (turn < Math.cos(45 * Math.PI / 180)) continue;
          if ((gx * A.d[0] + gy * A.d[1]) / g < 0.6 || (-gx * B.d[0] - gy * B.d[1]) / g < 0.6) continue;
        }
        pairs.push([g * 0.5 + (1 - turn) * 4, ja, jb]);
      }
    });
    if (!pairs.length) break;
    pairs.sort((x, y) => x[0] - y[0]);
    const usedEnd = new Set(), dead = new Set();
    const alias = S.map((_, k) => k); // 합쳐진 패스의 새 위치
    let merged = 0;
    for (const [, ja, jb] of pairs) {
      if (usedEnd.has(ja) || usedEnd.has(jb)) continue;
      const A = ends[ja], B = ends[jb];
      if (dead.has(A.k) || dead.has(B.k)) continue;
      // A의 끝 → B의 시작 순서로 만든다
      let sa = S[A.k], sb = S[B.k];
      if (A.a) sa = reverseStroke(sa);
      if (!B.a) sb = reverseStroke(sb);
      const la = strokeLen(sa), lb = strokeLen(sb);
      const join = dist2([sa.segs[sa.segs.length - 1].x, sa.segs[sa.segs.length - 1].y], sb.start) > 0.05 ? [{ t: 'L', x: sb.start[0], y: sb.start[1] }] : [];
      const main = la >= lb ? sa : sb;
      const m = { ...main, start: sa.start, segs: [...sa.segs, ...join, ...sb.segs], width: main.width, color: main.color, closed: false };
      if (dist2(m.start, [m.segs[m.segs.length - 1].x, m.segs[m.segs.length - 1].y]) < 0.6 && strokeLen(m) > 10) m.closed = true;
      S[A.k] = m; dead.add(B.k);
      // 이번 패스에서 A.k의 다른 끝도 바뀌었으니 더 쓰지 않는다
      ends.forEach((e, j) => { if (e.k === A.k || e.k === B.k) usedEnd.add(j); });
      merged++;
    }
    S = S.filter((_, k) => !dead.has(k));
    if (!merged) break;
  }
  return S;
}

// 외톨이 조각 제거: 짧은 선(maxLen 미만)인데 양 끝이 다른 선에 닿지 않고,
// 같은 줄 위에 반복되는 짧은 선(점선)도 3개 미만이면 지운다. 끊긴 잔흔이 남는 것보다 없는 게 낫다.
export function pruneIsolated(strokes, maxLen, touch, cov = null, w = 0, h = 0) {
  const segs = [];
  strokes.forEach((st, k) => { let p = st.start; for (const g of st.segs) { segs.push([k, p, [g.x, g.y]]); p = [g.x, g.y]; } });
  const C = Math.max(4, touch * 2), grid = new Map();
  segs.forEach((sg, j) => {
    const [, a, b] = sg;
    for (let x = Math.floor(Math.min(a[0], b[0]) / C); x <= Math.floor(Math.max(a[0], b[0]) / C); x++)
      for (let y = Math.floor(Math.min(a[1], b[1]) / C); y <= Math.floor(Math.max(a[1], b[1]) / C); y++) { const key = x + ',' + y; if (!grid.has(key)) grid.set(key, []); grid.get(key).push(j); }
  });
  const near = (pt, k, r) => {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const j of grid.get((Math.floor(pt[0] / C) + dx) + ',' + (Math.floor(pt[1] / C) + dy)) || []) {
      const [kk, a, b] = segs[j];
      if (kk === k) continue;
      const sx = b[0] - a[0], sy = b[1] - a[1], l2 = sx * sx + sy * sy || 1;
      const t = Math.max(0, Math.min(1, ((pt[0] - a[0]) * sx + (pt[1] - a[1]) * sy) / l2));
      if (Math.hypot(pt[0] - a[0] - sx * t, pt[1] - a[1] - sy * t) < r) return true;
    }
    return false;
  };
  const shortOnes = [];
  strokes.forEach((st, k) => { if (!st.closed && strokeLen(st) < maxLen) shortOnes.push(k); });
  const info = new Map();
  for (const k of shortOnes) {
    const st = strokes[k], e = [st.segs[st.segs.length - 1].x, st.segs[st.segs.length - 1].y];
    const dx = e[0] - st.start[0], dy = e[1] - st.start[1], l = Math.hypot(dx, dy) || 1;
    info.set(k, { a: st.start, b: e, mx: (st.start[0] + e[0]) / 2, my: (st.start[1] + e[1]) / 2, ux: dx / l, uy: dy / l, len: l });
  }
  const drop = new Set();
  for (const k of shortOnes) {
    const st = strokes[k], I = info.get(k);
    const touchA = near(I.a, k, touch), touchB = near(I.b, k, touch);
    if (touchA || touchB) continue;
    // 점선 판정: 같은 방향·같은 줄 위(옆으로 1.2·touch 이내), 일정 거리 안의 짧은 선 수
    let peers = 0;
    for (const j of shortOnes) {
      if (j === k) continue;
      const J = info.get(j);
      if (Math.abs(I.ux * J.uy - I.uy * J.ux) > 0.2) continue;
      const ox = J.mx - I.mx, oy = J.my - I.my;
      if (Math.abs(ox * -I.uy + oy * I.ux) > touch * 1.2) continue;
      if (Math.hypot(ox, oy) > maxLen * 4) continue;
      peers++;
    }
    if (peers >= 2) continue;
    // 주변(길이 1.5배 반경)에 다른 선이 여럿 있으면 글자·그림의 일부 — 남긴다
    const R = Math.max(I.len * 2, touch * 8);
    const others = new Set();
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) for (const j of grid.get((Math.floor(I.mx / C) + dx) + ',' + (Math.floor(I.my / C) + dy)) || []) {
      const [kk, a, b] = segs[j];
      if (kk === k) continue;
      const sx = b[0] - a[0], sy = b[1] - a[1], l2 = sx * sx + sy * sy || 1;
      const t = Math.max(0, Math.min(1, ((I.mx - a[0]) * sx + (I.my - a[1]) * sy) / l2));
      if (Math.hypot(I.mx - a[0] - sx * t, I.my - a[1] - sy * t) < R) others.add(kk);
    }
    if (others.size >= 2) continue;
    // 원본에서 주변에 잉크(글자 면 등)가 많으면 남긴다
    if (cov) {
      let ink = 0;
      const x0 = Math.max(0, Math.floor(I.mx - R)), x1 = Math.min(w - 1, Math.ceil(I.mx + R)), y0 = Math.max(0, Math.floor(I.my - R)), y1 = Math.min(h - 1, Math.ceil(I.my + R));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        if (cov[y * w + x] < 0.5) continue;
        const px = x + 0.5 - I.a[0], py = y + 0.5 - I.a[1], t = Math.max(0, Math.min(I.len, px * I.ux + py * I.uy));
        if (Math.hypot(px - I.ux * t, py - I.uy * t) > touch * 2 && !near([x + 0.5, y + 0.5], k, touch * 2)) ink++;
      }
      if (ink > touch * touch * 12) continue;
    }
    drop.add(k);
  }
  return strokes.filter((_, k) => !drop.has(k));
}

// 중복 선 제거: 다른(더 진하거나 더 긴) 선 바로 옆을 나란히 따라가는 선은 지운다.
// 흐린 선은 dGray, 진한 선끼리는 dInk 거리 안이면 중복으로 본다.
export function dedupeParallel(strokes, dInk, dGray) {
  const segs = [];
  strokes.forEach((st, k) => { let p = st.start; for (const g of st.segs) { segs.push([k, p, [g.x, g.y]]); p = [g.x, g.y]; } });
  const C = Math.max(4, dGray * 2), grid = new Map();
  segs.forEach((sg, j) => {
    const [, a, b] = sg;
    for (let x = Math.floor(Math.min(a[0], b[0]) / C); x <= Math.floor(Math.max(a[0], b[0]) / C); x++)
      for (let y = Math.floor(Math.min(a[1], b[1]) / C); y <= Math.floor(Math.max(a[1], b[1]) / C); y++) { const key = x + ',' + y; if (!grid.has(key)) grid.set(key, []); grid.get(key).push(j); }
  });
  const lens = strokes.map(strokeLen);
  const order = strokes.map((_, k) => k).sort((a, b) => lens[a] - lens[b]); // 짧은 것부터 검사
  const dead = new Set();
  for (const k of order) {
    const st = strokes[k];
    if (st.closed) continue;
    const pts = [];
    let p = st.start;
    for (const g of st.segs) { const q = [g.x, g.y], n = Math.max(1, Math.ceil(dist2(p, q) / 1.5)); for (let i = 0; i < n; i++) pts.push([p[0] + (q[0] - p[0]) * i / n, p[1] + (q[1] - p[1]) * i / n]); p = q; }
    pts.push(p);
    let cover = 0;
    for (const pt of pts) {
      let hit = false;
      for (let dx = -1; dx <= 1 && !hit; dx++) for (let dy = -1; dy <= 1 && !hit; dy++) for (const j of grid.get((Math.floor(pt[0] / C) + dx) + ',' + (Math.floor(pt[1] / C) + dy)) || []) {
        const [kk, a, b] = segs[j];
        if (kk === k || dead.has(kk)) continue;
        const o = strokes[kk];
        // 기준 선: 진한 선이거나(흐린 선 검사 시), 더 긴 진한 선(진한 선 검사 시)
        const isGray = !!st.gray;
        if (!isGray) continue; // 진한 선은 지우지 않는다(글자 획 보호)
        const r = isGray ? (o.gray ? dInk : dGray) : dInk;
        if (isGray && o.gray && lens[kk] < lens[k]) continue;
        const sx = b[0] - a[0], sy = b[1] - a[1], l2 = sx * sx + sy * sy || 1;
        const t = Math.max(0, Math.min(1, ((pt[0] - a[0]) * sx + (pt[1] - a[1]) * sy) / l2));
        if (Math.hypot(pt[0] - a[0] - sx * t, pt[1] - a[1] - sy * t) < r) hit = true;
      }
      if (hit) cover++;
    }
    if (cover >= pts.length * 0.7) dead.add(k);
  }
  return strokes.filter((_, k) => !dead.has(k));
}

// 점선 재구성: 한 줄 위에 거의 같은 간격으로 늘어선 짧은 직선 조각(3개 이상)을
// 하나의 직선 + 균일한 점선 패턴(stroke-dasharray)으로 바꾼다.
export function rebuildDashes(strokes, maxLen, tol) {
  const cand = [];
  strokes.forEach((st, k) => {
    if (st.closed) return;
    const L = strokeLen(st);
    if (L > maxLen) return;
    const e = [st.segs[st.segs.length - 1].x, st.segs[st.segs.length - 1].y];
    const dx = e[0] - st.start[0], dy = e[1] - st.start[1], l = Math.hypot(dx, dy);
    if (l < L * 0.85 || l < 0.5) return; // 곧지 않으면 제외
    let ux = dx / l, uy = dy / l;
    if (ux < 0 || (ux === 0 && uy < 0)) { ux = -ux; uy = -uy; }
    cand.push({ k, a: st.start, b: e, mx: (st.start[0] + e[0]) / 2, my: (st.start[1] + e[1]) / 2, ux, uy, len: l, st });
  });
  const used = new Set(), out = [], dead = new Set();
  for (const c of cand) {
    if (used.has(c.k)) continue;
    // 같은 방향·같은 줄 위의 조각들
    const grp = cand.filter((d) => !used.has(d.k) && Math.abs(c.ux * d.uy - c.uy * d.ux) < 0.12 && Math.abs((d.mx - c.mx) * -c.uy + (d.my - c.my) * c.ux) < tol);
    if (grp.length < 3) continue;
    // 줄 위 위치로 정렬하고, 간격이 너무 벌어지면 끊는다
    const t = (d) => (d.mx - c.mx) * c.ux + (d.my - c.my) * c.uy;
    grp.sort((p, q) => t(p) - t(q));
    let run = [grp[0]];
    const flush = () => {
      if (run.length >= 3) {
        const lens = run.map((d) => d.len).sort((p, q) => p - q), dash = lens[lens.length >> 1];
        const gaps = [];
        for (let i = 1; i < run.length; i++) gaps.push(t(run[i]) - t(run[i - 1]) - (run[i].len + run[i - 1].len) / 2);
        gaps.sort((p, q) => p - q);
        const gap = Math.max(dash * 0.3, gaps[gaps.length >> 1]);
        // 줄 맞춤: 길이 가중 평균 위치·방향
        let sx = 0, sy = 0, sw = 0; for (const d of run) { sx += d.mx * d.len; sy += d.my * d.len; sw += d.len; }
        const cx = sx / sw, cy = sy / sw;
        const t0 = t(run[0]) - run[0].len / 2, t1 = t(run[run.length - 1]) + run[run.length - 1].len / 2;
        const base = (cx - c.mx) * c.ux + (cy - c.my) * c.uy;
        const ox = cx - c.ux * base, oy = cy - c.uy * base;
        const main = run.reduce((p, q) => (q.st.width > p.st.width ? q : p)).st;
        out.push({ ...main, start: [ox + c.ux * t0, oy + c.uy * t0], segs: [{ t: 'L', x: ox + c.ux * t1, y: oy + c.uy * t1 }], dash: [dash, gap], cap: 'butt', closed: false });
        for (const d of run) { used.add(d.k); dead.add(d.k); }
      }
    };
    for (let i = 1; i < grp.length; i++) {
      const g = t(grp[i]) - t(grp[i - 1]) - (grp[i].len + grp[i - 1].len) / 2;
      if (g > maxLen * 2.5 || g < -0.5) { flush(); run = []; }
      run.push(grp[i]);
    }
    flush();
  }
  return strokes.filter((_, k) => !dead.has(k)).concat(out);
}
