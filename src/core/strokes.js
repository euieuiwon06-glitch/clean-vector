// 선화 중심선 추적: 가는 선을 "테두리 두 개"가 아니라 가운데를 지나는 획(stroke) 하나로 만든다.
// 1) 잉크 덮임 맵에서 가는 부분만 골라 뼈대(skeleton)를 만들고
// 2) 뼈대를 끝점·교차점 사이 선들로 나눠
// 3) 직선은 그림의 주요 방향으로 정렬한 선분, 곡선은 매끈한 베지어로 맞추고
// 4) 선마다 원본 단면에서 굵기·진하기를 재서 일정한 굵기의 획으로 만든다.
import { fitCubic } from './fit.js?v=8e72d564';

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
      if (Math.abs(ang - base) < (o.snapDeg ?? 3.5) * DEG) return { ...s, dx: Math.cos(base), dy: Math.sin(base) };
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
      if (curvy) return { curvy, p: pc };
      const L = segs.map(snap);
      for (let k = L.length - 2; k >= 0; k--) {
        const A = L[k], Bq = L[k + 1];
        // 거의 같은 방향(8° 이내)으로 살짝 꺾이거나 어긋난 직선은 원본 왜곡으로 보고 하나로 편다
        const same = Math.abs(A.dx * Bq.dy - A.dy * Bq.dx) < Math.sin(8 * DEG) && A.dx * Bq.dx + A.dy * Bq.dy > 0;
        const off = Math.abs((Bq.mx - A.mx) * -A.dy + (Bq.my - A.my) * A.dx);
        if (same && off < 1.6) {
          const len = A.len + Bq.len;
          const keep = A.len >= Bq.len ? A : Bq; // 긴 쪽 방향을 따른다
          L.splice(k, 2, { ...A, dx: keep.dx, dy: keep.dy, b: Bq.b, mx: (A.mx * A.len + Bq.mx * Bq.len) / len, my: (A.my * A.len + Bq.my * Bq.len) / len, len });
        }
      }
      return { curvy, p: pc, L };
    });
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
        if (n >= 2) fitCubic(q, t1, t2, o.curveTol ?? 0.6, out); else out.push({ t: 'L', x: q[n][0], y: q[n][1] });
        cur = q[n];
        return;
      }
      const L = pt.L, P = pt.p;
      // 시작점: 앞 조각이 직선이면 교점, 아니면 투영
      if (!start) lineTo(proj(L[0], P[L[0].a]));
      else if (prev && !prev.curvy) { /* 교점은 앞 조각 끝에서 이미 찍음 */ }
      else lineTo(proj(L[0], cur));
      for (let j = 0; j < L.length - 1; j++) {
        // 둥근 모서리: 긴 직선 사이에 낀 짧은 조각들(합쳐 14px 미만) → 두 직선에 접하는 원호
        let t = j + 1, shortLen = 0;
        while (t < L.length && L[t].len < 7 && shortLen + L[t].len < 14) { shortLen += L[t].len; t++; }
        const G2 = L[t];
        if (t > j + 1 && G2 && L[j].len >= 6 && G2.len >= 6) {
          const turnAll = Math.abs(Math.atan2(L[j].dx * G2.dy - L[j].dy * G2.dx, L[j].dx * G2.dx + L[j].dy * G2.dy));
          const X = intersect(L[j], G2);
          if (turnAll > 50 * DEG && turnAll < 150 * DEG && X) {
            const p1 = proj(L[j], P[L[j + 1].a]), p2 = proj(G2, P[L[t - 1].b]);
            const d = (dist2(X, p1) + dist2(X, p2)) / 2;
            // 원래 점들이 꼭짓점 가까이를 지나가면 각진 모서리(흐림 때문에 생긴 짧은 조각일 뿐)
            let dmin = Infinity;
            for (let q = L[j + 1].a; q <= L[t - 1].b; q++) dmin = Math.min(dmin, dist2(P[q], X));
            if (dmin < 1.1) { lineTo(X); cur = X; j = t - 1; continue; }
            if (d < 8) {
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
        const X = intersect(L[j], L[j + 1]), e = P[L[j].b];
        if (X && dist2(X, e) < 3) lineTo(X); else { lineTo(proj(L[j], e)); lineTo(proj(L[j + 1], e)); }
      }
      const last = L[L.length - 1];
      if (next && !next.curvy) {
        const X = intersect(last, next.L[0]), e = P[P.length - 1];
        if (X && dist2(X, e) < 4) lineTo(X); else { lineTo(proj(last, e)); lineTo(proj(next.L[0], e)); }
      } else lineTo(proj(last, P[last.b]));
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
  for (const d of dashes) {
    let s1 = snap({ dx: d.ux, dy: d.uy, mx: d.cx, my: d.cy });
    const hl = d.len / 2;
    strokes.push({ start: [d.cx - s1.dx * hl, d.cy - s1.dy * hl], segs: [{ t: 'L', x: d.cx + s1.dx * hl, y: d.cy + s1.dy * hl }], width: d.width, peak: 1, closed: false, cap: 'butt', fixedWidth: true });
  }
  return { strokes, fillMask };
}

const norm2 = (x, y) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
