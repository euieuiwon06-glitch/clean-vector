// 윤곽선 → 깨끗한 패스
// 1) 직선 구간(run)을 찾아 수평·수직(선택 시 45°)으로 고정
// 2) 직선 사이가 날카로우면 두 직선의 교점으로 코너를 복원
// 3) 나머지는 직선과 접선이 이어지는(G1) 최소 개수의 베지어로 맞춤
// 4) 원에 가까운 윤곽은 정원으로 교체

const DEG = Math.PI / 180;

export function resampleClosed(raw, step) {
  const n = raw.length;
  const cum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const a = raw[i], b = raw[(i + 1) % n];
    cum[i + 1] = cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  const L = cum[n];
  const m = Math.max(8, Math.round(L / step));
  const xs = new Float64Array(m), ys = new Float64Array(m);
  let j = 0;
  for (let k = 0; k < m; k++) {
    const t = (k / m) * L;
    while (j < n - 1 && cum[j + 1] < t) j++;
    const a = raw[j], b = raw[(j + 1) % n];
    const seg = cum[j + 1] - cum[j];
    const f = seg > 1e-12 ? (t - cum[j]) / seg : 0;
    xs[k] = a[0] + (b[0] - a[0]) * f;
    ys[k] = a[1] + (b[1] - a[1]) * f;
  }
  let area = 0;
  for (let i = 0; i < m; i++) {
    const k = (i + 1) % m;
    area += xs[i] * ys[k] - xs[k] * ys[i];
  }
  return { xs, ys, n: m, area: Math.abs(area) / 2, length: L };
}

function fitCircle(xs, ys, n) {
  // Kasa 대수 원 맞춤
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i], y = ys[i], z = x * x + y * y;
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z; sz += z;
  }
  const A = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]];
  const B = [-sxz, -syz, -sz];
  const sol = solve3(A, B);
  if (!sol) return null;
  const [D, E, F] = sol;
  const cx = -D / 2, cy = -E / 2;
  const r2 = cx * cx + cy * cy - F;
  if (r2 <= 0) return null;
  const r = Math.sqrt(r2);
  let maxd = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(Math.hypot(xs[i] - cx, ys[i] - cy) - r);
    if (d > maxd) maxd = d;
  }
  return { cx, cy, r, maxd };
}

// 축 정렬 타원: A x² + C y² + D x + E y = 1 (중심 이동 후)
function fitEllipse(xs, ys, n) {
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
  mx /= n; my /= n;
  const M = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], V = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const x = xs[i] - mx, y = ys[i] - my, r = [x * x, y * y, x, y];
    for (let a = 0; a < 4; a++) { V[a] += r[a]; for (let b = 0; b < 4; b++) M[a][b] += r[a] * r[b]; }
  }
  const sol = solveN(M, V);
  if (!sol) return null;
  const [A, C, D, E] = sol;
  if (A <= 0 || C <= 0) return null;
  const cx = -D / (2 * A), cy = -E / (2 * C);
  const G = 1 + A * cx * cx + C * cy * cy;
  if (G <= 0) return null;
  const rx = Math.sqrt(G / A), ry = Math.sqrt(G / C);
  if (rx / ry > 4 || ry / rx > 4) return null;
  let maxd = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i] - mx - cx, y = ys[i] - my - cy;
    const t = Math.atan2(y / ry, x / rx);
    const d = Math.hypot(x - rx * Math.cos(t), y - ry * Math.sin(t)); // 근사 거리
    if (d > maxd) maxd = d;
  }
  return { cx: cx + mx, cy: cy + my, rx, ry, maxd };
}

function solveN(A, B) {
  const N = B.length;
  const M = A.map((row, i) => [...row, B[i]]);
  for (let c = 0; c < N; c++) {
    let p = c;
    for (let r = c + 1; r < N; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < N; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= N; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[N] / row[i]);
}

function solve3(A, B) {
  const M = A.map((row, i) => [...row, B[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k];
    }
  }
  return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
}

function turningAngles(xs, ys, n, w) {
  const t = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i - w + n * 4) % n, b = (i + w) % n;
    const ax = xs[i] - xs[a], ay = ys[i] - ys[a];
    const bx = xs[b] - xs[i], by = ys[b] - ys[i];
    t[i] = Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by));
  }
  return t;
}

// 윤곽 하나를 분석: 원 / 직선 구간 목록
export function analyzeContour(c, o) {
  const { n } = c;
  const step = o.step;
  const circ = fitCircle(c.xs, c.ys, n);
  if (circ && circ.r >= 0.7 && circ.maxd <= Math.max(o.circleTol, circ.r * 0.035)) {
    return { kind: 'circle', cx: circ.cx, cy: circ.cy, r: circ.r };
  }
  const ell = fitEllipse(c.xs, c.ys, n);
  if (ell && Math.min(ell.rx, ell.ry) >= 1 && ell.maxd <= Math.max(o.circleTol * 1.4, Math.min(ell.rx, ell.ry) * 0.035)) {
    return { kind: 'ellipse', ...ell };
  }
  const w = Math.max(2, Math.round(1.0 / step));
  const turn0 = turningAngles(c.xs, c.ys, n, w);
  // 가장 많이 꺾이는 점을 시작점으로 돌려서, 직선 한가운데서 시작하지 않게 한다
  let s0 = 0;
  for (let i = 1; i < n; i++) if (turn0[i] > turn0[s0]) s0 = i;
  const xs = new Float64Array(n), ys = new Float64Array(n), turn = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const j = (i + s0) % n;
    xs[i] = c.xs[j]; ys[i] = c.ys[j]; turn[i] = turn0[j];
  }
  const X = (i) => xs[i % n], Y = (i) => ys[i % n];

  const tol = o.lineTol;
  const kMin = Math.max(3, Math.ceil(o.minRun / step));

  const chordOK = (i, k) => {
    const ax = X(i), ay = Y(i);
    const dx = X(i + k) - ax, dy = Y(i + k) - ay;
    const L = Math.hypot(dx, dy);
    if (L < 1e-9) return false;
    const ux = dx / L, uy = dy / L;
    let maxu = -Infinity;
    for (let t = 1; t < k; t++) {
      const px = X(i + t) - ax, py = Y(i + t) - ay;
      const v = px * -uy + py * ux;
      if (v > tol || v < -tol) return false;
      const u = px * ux + py * uy;
      if (u < maxu - tol) return false; // 되돌아가는 가시 모양 방지
      if (u > maxu) maxu = u;
    }
    return true;
  };

  const search = (i) => {
    const maxK = n - i;
    if (maxK < kMin || !chordOK(i, kMin)) return 0;
    let lo = kMin, hi = -1, k = kMin;
    while (true) {
      const nk = Math.min(maxK, k * 2);
      if (nk === k) return k;
      if (chordOK(i, nk)) { lo = nk; k = nk; if (nk === maxK) return nk; }
      else { hi = nk; break; }
    }
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (chordOK(i, mid)) lo = mid; else hi = mid;
    }
    return lo;
  };

  const tls = (a, b) => {
    let mx = 0, my = 0;
    const cnt = b - a + 1;
    for (let t = a; t <= b; t++) { mx += X(t); my += Y(t); }
    mx /= cnt; my /= cnt;
    let sxx = 0, syy = 0, sxy = 0;
    for (let t = a; t <= b; t++) {
      const px = X(t) - mx, py = Y(t) - my;
      sxx += px * px; syy += py * py; sxy += px * py;
    }
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    let dx = Math.cos(th), dy = Math.sin(th);
    if ((X(b) - X(a)) * dx + (Y(b) - Y(a)) * dy < 0) { dx = -dx; dy = -dy; }
    return { mx, my, dx, dy };
  };

  const fitRun = (i, k) => {
    let a = i, b = i + k;
    let L = tls(a, b);
    const res = (t) => (X(t) - L.mx) * -L.dy + (Y(t) - L.my) * L.dx;
    while (b - a > kMin && Math.abs(res(a)) > tol * 0.5) a++;
    while (b - a > kMin && Math.abs(res(b)) > tol * 0.5) b--;
    L = tls(a, b);
    // 가운데 구간의 잡음 크기를 재고, 끝에서 그보다 한쪽으로 벗어나기 시작하는 점(곡선 시작)을 잘라낸다
    {
      const q0 = a + Math.floor((b - a) * 0.2), q1 = b - Math.floor((b - a) * 0.2);
      let ss = 0, cnt = 0;
      for (let t = q0; t <= q1; t++) { const r = res(t); ss += r * r; cnt++; }
      const lim = Math.max(2.5 * Math.sqrt(ss / Math.max(1, cnt)), 0.1);
      while (b - a > kMin && Math.abs(res(a)) > lim) a++;
      while (b - a > kMin && Math.abs(res(b)) > lim) b--;
      // 끝 2px 안쪽에서 같은 방향으로 계속 벌어지면 곡선이 시작된 것
      const span = Math.max(2, Math.round(1.5 / step));
      const drift = (from, dir) => {
        let k = from;
        for (let t = 0; t < span && b - a > kMin; t++) {
          const r0 = res(k), r1 = res(k + dir);
          if (Math.abs(r0) > lim * 0.6 && Math.abs(r0) > Math.abs(r1) && Math.sign(r0) === Math.sign(r1)) k += dir; else break;
        }
        return k;
      };
      a = drift(a, 1); b = drift(b, -1);
      L = tls(a, b);
    }
    const proj = (t) => (X(t) - L.mx) * L.dx + (Y(t) - L.my) * L.dy;
    const u0 = proj(a), u1 = proj(b);
    const len = u1 - u0;
    if (len < o.minRun) return null;
    // 활처럼 휜 곡선인지 검사: v = c2·u² + c1·u + c0
    let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, t0 = 0, t1 = 0, t2 = 0;
    for (let t = a; t <= b; t++) {
      const u = proj(t), v = (X(t) - L.mx) * -L.dy + (Y(t) - L.my) * L.dx;
      const u2 = u * u;
      s0++; s1 += u; s2 += u2; s3 += u2 * u; s4 += u2 * u2;
      t0 += v; t1 += v * u; t2 += v * u2;
    }
    const q = solve3([[s4, s3, s2], [s3, s2, s1], [s2, s1, s0]], [t2, t1, t0]);
    if (q) {
      // 휨 깊이가 크거나, 짧아도 일정한 곡률(반지름이 길이에 비해 작음)이면 곡선 조각
      const sag = Math.abs(q[0]) * (len / 2) ** 2;
      const radius = 1 / (2 * Math.abs(q[0]) + 1e-12);
      if (sag > tol * 0.45 || (radius < len * 5 && sag > 0.05)) return { arc: true };
    }
    // 수평·수직(·45°) 고정
    let snap = null, dx = L.dx, dy = L.dy;
    const ang = Math.atan2(dy, dx);
    const targets = o.snap45 ? 8 : 4;
    const unit = (Math.PI * 2) / targets;
    const tgt = Math.round(ang / unit) * unit;
    if (Math.abs(ang - tgt) <= o.snapDeg * DEG) {
      const sx = Math.round(Math.cos(tgt) * 1e9) / 1e9, sy = Math.round(Math.sin(tgt) * 1e9) / 1e9;
      let maxd = 0;
      for (let t = a; t <= b; t++) {
        const d = Math.abs((X(t) - L.mx) * -sy + (Y(t) - L.my) * sx);
        if (d > maxd) maxd = d;
      }
      if (maxd <= Math.max(tol * 1.6, 0.9)) {
        dx = sx; dy = sy;
        snap = Math.abs(sy) < 1e-6 ? 'h' : Math.abs(sx) < 1e-6 ? 'v' : 'd';
      }
    }
    return { a, b, mx: L.mx, my: L.my, dx, dy, snap, len };
  };

  const runs = [];
  let i = 0;
  while (i < n) {
    let k = search(i);
    let run = null;
    while (k >= kMin) {
      const r = fitRun(i, k);
      if (!r) break;
      if (!r.arc) { run = r; break; }
      k = Math.floor(k * 0.7);
    }
    if (run) {
      runs.push(run);
      i = Math.max(i + 1, run.b);
    } else i++;
  }
  // 곡선을 잘게 쪼갠 짧은 직선(이웃과 완만한 각도로 이어짐)은 곡선으로 되돌린다
  const shortLen = Math.max(o.minRun * 3, 8);
  let changed = true;
  while (changed && runs.length > 1) {
    changed = false;
    for (let r = 0; r < runs.length; r++) {
      const R = runs[r];
      if (R.len >= shortLen) continue;
      const P = runs[(r - 1 + runs.length) % runs.length], N = runs[(r + 1) % runs.length];
      const ang = (A, B) => Math.abs(Math.atan2(A.dx * B.dy - A.dy * B.dx, A.dx * B.dx + A.dy * B.dy));
      const gapP = R.a - P.b + (r === 0 ? n : 0), gapN = N.a - R.b + (r === runs.length - 1 ? n : 0);
      const soft = (A, gap) => gap * step <= 2.5 && ang(A, R) < 45 * DEG && ang(A, R) > 1.5 * DEG;
      if (soft(P, gapP) || soft(N, gapN)) { runs.splice(r, 1); changed = true; break; }
    }
  }
  // 앞뒤로 넓혀도 하나의 완만한 곡선으로 설명되는 직선은 곡선의 평평한 부분(타원 위쪽 등)이다
  for (let r = runs.length - 1; r >= 0 && runs.length > 0; r--) {
    const R = runs[r];
    const ext = Math.max(2, Math.round((R.b - R.a) * 0.6));
    const a0 = R.a - ext, b0 = R.b + ext;
    if (b0 - a0 >= n) continue;
    let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, t0 = 0, t1 = 0, t2 = 0, mono = true, prevU = -Infinity;
    const U = [], V = [];
    for (let t = a0; t <= b0; t++) {
      const px = X((t % n + n) % n) - R.mx, py = Y((t % n + n) % n) - R.my;
      const u = px * R.dx + py * R.dy, v = px * -R.dy + py * R.dx;
      if (u < prevU - tol) mono = false;
      prevU = Math.max(prevU, u);
      U.push(u); V.push(v);
      const u2 = u * u;
      s0++; s1 += u; s2 += u2; s3 += u2 * u; s4 += u2 * u2; t0 += v; t1 += v * u; t2 += v * u2;
    }
    if (!mono) continue;
    const q = solve3([[s4, s3, s2], [s3, s2, s1], [s2, s1, s0]], [t2, t1, t0]);
    if (!q) continue;
    let maxr = 0;
    for (let k = 0; k < U.length; k++) maxr = Math.max(maxr, Math.abs(V[k] - (q[0] * U[k] * U[k] + q[1] * U[k] + q[2])));
    const Lx = U[U.length - 1] - U[0];
    const sag = Math.abs(q[0]) * (Lx / 2) ** 2;
    if (maxr <= Math.max(0.22, tol * 0.4) && sag > tol * 0.5 && R.len < 40) runs.splice(r, 1);
  }
  // 같은 선 위에 이어진 직선 두 개는 하나로
  for (let r = 0; runs.length > 1 && r < runs.length; r++) {
    const A = runs[r], B = runs[(r + 1) % runs.length];
    if (r + 1 === runs.length) break;
    const par = Math.abs(A.dx * B.dy - A.dy * B.dx) < Math.sin(3 * DEG) && A.dx * B.dx + A.dy * B.dy > 0;
    const off = Math.abs((B.mx - A.mx) * -A.dy + (B.my - A.my) * A.dx);
    if (par && off < tol && B.a - A.b < Math.max(3, 2 / step)) {
      const len = A.len + B.len;
      runs.splice(r, 2, { ...A, b: B.b, mx: (A.mx * A.len + B.mx * B.len) / len, my: (A.my * A.len + B.my * B.len) / len, len: len + (B.a - A.b) * step });
      r--;
    }
  }
  return { kind: 'poly', n, xs, ys, turn, w, runs, step };
}

// 같은 축 위에 거의 같은 위치에 있는 수평·수직 직선을 한 값으로 정렬
export function alignRuns(shapes, tol) {
  for (const axis of ['h', 'v']) {
    const items = [];
    for (const s of shapes) {
      if (s.kind !== 'poly') continue;
      for (const r of s.runs) if (r.snap === axis) items.push(r);
    }
    const key = axis === 'h' ? 'my' : 'mx';
    items.sort((p, q) => p[key] - q[key]);
    let g = [];
    const flush = () => {
      if (g.length > 1) {
        let sw = 0, sv = 0;
        for (const r of g) { sw += r.len; sv += r[key] * r.len; }
        const v = sv / sw;
        for (const r of g) r[key] = v;
      }
      g = [];
    };
    for (const r of items) {
      if (g.length && (r[key] - g[0][key] > tol * 2 || r[key] - g[g.length - 1][key] > tol)) flush();
      g.push(r);
    }
    flush();
  }
}

// 획 두께 맞춤: 마주보는 평행한 수평·수직 변 사이 거리(획 두께)를 비슷한 값끼리 같게 맞춘다.
// 텍스트 획과 선 굵기를 고르게 만드는 단계.
export function equalizeStrokes(shapesByLayer, o) {
  const pairs = [];
  for (const shapes of shapesByLayer) {
    for (const axis of ['h', 'v']) {
      const key = axis === 'h' ? 'my' : 'mx';
      const other = axis === 'h' ? 'mx' : 'my';
      const items = [];
      for (const s of shapes) {
        if (s.kind !== 'poly') continue;
        for (const r of s.runs) {
          if (r.snap !== axis) continue;
          const half = r.len / 2;
          const sign = axis === 'h' ? r.dx : r.dy;
          items.push({ r, lo: r[other] - half, hi: r[other] + half, sign });
        }
      }
      items.sort((p, q) => p.r[key] - q.r[key]);
      const best = new Map();
      for (let i = 0; i < items.length; i++) {
        const A = items[i];
        for (let j = i + 1; j < items.length; j++) {
          const B = items[j];
          const d = B.r[key] - A.r[key];
          if (d > o.maxStroke) break;
          if (d < 0.6 || A.sign === B.sign) continue;
          const ov = Math.min(A.hi, B.hi) - Math.max(A.lo, B.lo);
          if (ov < 0.5 * Math.min(A.r.len, B.r.len)) continue;
          if (!best.has(A) || best.get(A).d > d) best.set(A, { B, d });
          if (!best.has(B) || best.get(B).d > d) best.set(B, { B: A, d });
        }
      }
      for (const [A, { B, d }] of best) {
        if (best.get(B)?.B === A && A.r[key] < B.r[key]) pairs.push({ A: A.r, B: B.r, key, d });
      }
    }
  }
  pairs.sort((p, q) => p.d - q.d);
  let g = [];
  const flush = () => {
    if (g.length > 1) {
      const mean = g.reduce((s, p) => s + p.d, 0) / g.length;
      for (const p of g) {
        const c = (p.A[p.key] + p.B[p.key]) / 2;
        p.A[p.key] = c - mean / 2;
        p.B[p.key] = c + mean / 2;
      }
    }
    g = [];
  };
  for (const p of pairs) {
    if (g.length && p.d - g[0].d > Math.max(o.strokeTol, g[0].d * 0.06)) flush();
    g.push(p);
  }
  flush();
}

// ---------- 베지어 맞춤 (Schneider, Graphics Gems) ----------

function bez(b, t) {
  const mt = 1 - t;
  const a = mt * mt * mt, c = 3 * mt * mt * t, d = 3 * mt * t * t, e = t * t * t;
  return [a * b[0][0] + c * b[1][0] + d * b[2][0] + e * b[3][0], a * b[0][1] + c * b[1][1] + d * b[2][1] + e * b[3][1]];
}

function chordParam(p) {
  const u = [0];
  for (let i = 1; i < p.length; i++) u.push(u[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
  const L = u[u.length - 1] || 1;
  return u.map((v) => v / L);
}

function generateBezier(p, u, t1, t2) {
  const p0 = p[0], p3 = p[p.length - 1];
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
  for (let i = 0; i < p.length; i++) {
    const t = u[i], mt = 1 - t;
    const b0 = mt * mt * mt, b1 = 3 * mt * mt * t, b2 = 3 * mt * t * t, b3 = t * t * t;
    const a0x = t1[0] * b1, a0y = t1[1] * b1, a1x = t2[0] * b2, a1y = t2[1] * b2;
    c00 += a0x * a0x + a0y * a0y;
    c01 += a0x * a1x + a0y * a1y;
    c11 += a1x * a1x + a1y * a1y;
    const tx = p[i][0] - (p0[0] * (b0 + b1) + p3[0] * (b2 + b3));
    const ty = p[i][1] - (p0[1] * (b0 + b1) + p3[1] * (b2 + b3));
    x0 += a0x * tx + a0y * ty;
    x1 += a1x * tx + a1y * ty;
  }
  const det = c00 * c11 - c01 * c01;
  const seg = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
  let al = det !== 0 ? (x0 * c11 - x1 * c01) / det : 0;
  let ar = det !== 0 ? (c00 * x1 - c01 * x0) / det : 0;
  const eps = 1e-6 * seg;
  if (al < eps || ar < eps || al > seg * 3 || ar > seg * 3) al = ar = seg / 3;
  return [p0, [p0[0] + t1[0] * al, p0[1] + t1[1] * al], [p3[0] + t2[0] * ar, p3[1] + t2[1] * ar], p3];
}

function maxError(p, b, u) {
  let maxd = 0, split = Math.floor(p.length / 2);
  for (let i = 1; i < p.length - 1; i++) {
    const q = bez(b, u[i]);
    const d = Math.hypot(q[0] - p[i][0], q[1] - p[i][1]);
    if (d > maxd) { maxd = d; split = i; }
  }
  return [maxd, split];
}

function reparam(p, u, b) {
  const d1 = [0, 1, 2].map((i) => [3 * (b[i + 1][0] - b[i][0]), 3 * (b[i + 1][1] - b[i][1])]);
  const d2 = [0, 1].map((i) => [2 * (d1[i + 1][0] - d1[i][0]), 2 * (d1[i + 1][1] - d1[i][1])]);
  return u.map((t, i) => {
    const q = bez(b, t);
    const mt = 1 - t;
    const q1 = [mt * mt * d1[0][0] + 2 * mt * t * d1[1][0] + t * t * d1[2][0], mt * mt * d1[0][1] + 2 * mt * t * d1[1][1] + t * t * d1[2][1]];
    const q2 = [mt * d2[0][0] + t * d2[1][0], mt * d2[0][1] + t * d2[1][1]];
    const num = (q[0] - p[i][0]) * q1[0] + (q[1] - p[i][1]) * q1[1];
    const den = q1[0] * q1[0] + q1[1] * q1[1] + (q[0] - p[i][0]) * q2[0] + (q[1] - p[i][1]) * q2[1];
    if (Math.abs(den) < 1e-12) return t;
    const nt = t - num / den;
    return nt < 0 ? 0 : nt > 1 ? 1 : nt;
  });
}

const norm = (x, y) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };

function fitCubic(p, t1, t2, tol, out, depth = 0) {
  const n = p.length;
  const p0 = p[0], p3 = p[n - 1];
  // 거의 직선이면 직선으로
  const L = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
  if (L > 1e-9) {
    const ux = (p3[0] - p0[0]) / L, uy = (p3[1] - p0[1]) / L;
    let ok = true;
    for (let i = 1; i < n - 1 && ok; i++) if (Math.abs((p[i][0] - p0[0]) * -uy + (p[i][1] - p0[1]) * ux) > tol * 0.35) ok = false;
    const ta = Math.abs(t1[0] * -uy + t1[1] * ux), tb = Math.abs(t2[0] * -uy + t2[1] * ux);
    if (ok && ta < 0.05 && tb < 0.05) { out.push({ t: 'L', x: p3[0], y: p3[1] }); return; }
  }
  if (n <= 2 || depth > 10) {
    const d = L / 3;
    out.push({ t: 'C', x1: p0[0] + t1[0] * d, y1: p0[1] + t1[1] * d, x2: p3[0] + t2[0] * d, y2: p3[1] + t2[1] * d, x: p3[0], y: p3[1] });
    return;
  }
  let u = chordParam(p);
  let b = generateBezier(p, u, t1, t2);
  let [err, split] = maxError(p, b, u);
  if (err > tol && err < tol * 6) {
    for (let it = 0; it < 8 && err > tol; it++) {
      u = reparam(p, u, b);
      b = generateBezier(p, u, t1, t2);
      [err, split] = maxError(p, b, u);
    }
  }
  if (err <= tol) {
    out.push({ t: 'C', x1: b[1][0], y1: b[1][1], x2: b[2][0], y2: b[2][1], x: p3[0], y: p3[1] });
    return;
  }
  split = Math.min(n - 2, Math.max(1, split));
  const w = Math.min(3, split, n - 1 - split);
  const tc = norm(p[split - w][0] - p[split + w][0], p[split - w][1] - p[split + w][1]);
  fitCubic(p.slice(0, split + 1), t1, tc, tol, out, depth + 1);
  fitCubic(p.slice(split), [-tc[0], -tc[1]], t2, tol, out, depth + 1);
}

// ---------- 패스 조립 ----------

function intersect(A, B) {
  const den = A.dx * B.dy - A.dy * B.dx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((B.mx - A.mx) * B.dy - (B.my - A.my) * B.dx) / den;
  return [A.mx + A.dx * t, A.my + A.dy * t];
}
const projOn = (R, x, y) => {
  const t = (x - R.mx) * R.dx + (y - R.my) * R.dy;
  return [R.mx + R.dx * t, R.my + R.dy * t];
};
const distLine = (R, x, y) => Math.abs((x - R.mx) * -R.dy + (y - R.my) * R.dx);

export function buildPath(s, o) {
  if (s.kind === 'circle') return { circle: s };
  if (s.kind === 'ellipse') return { ellipse: s };
  const { n, xs, ys, turn, w, runs } = s;
  const P = (i) => [xs[((i % n) + n) % n], ys[((i % n) + n) % n]];
  const T = (i) => turn[((i % n) + n) % n];
  const cornerRad = o.cornerAngle * DEG;

  const stepLen = s.step || 0.35;
  const We = Math.max(w, Math.round(1.5 / stepLen));

  // 구간 안의 자르는 점: 날카로운 코너 + 극점(가장 위·아래·왼쪽·오른쪽, 접선을 수평·수직으로 고정)
  const findCuts = (g0, g1, margin) => {
    const cuts = [];
    for (let i = g0 + Math.min(margin, 1); i <= g1 - Math.min(margin, 1); i++) {
      if (T(i) > cornerRad && T(i) >= T(i - 1) && T(i) >= T(i + 1)) cuts.push({ i, tf: null, corner: true });
    }
    for (let i = g0 + margin; i <= g1 - margin; i++) {
      const p = P(i), a = P(i - We), b = P(i + We), pm = P(i - 1), pp = P(i + 1);
      for (const c of [1, 0]) {
        const o2 = 1 - c, v = p[c];
        const isMax = v > a[c] + 0.03 && v > b[c] + 0.03 && v >= pm[c] && v >= pp[c];
        const isMin = v < a[c] - 0.03 && v < b[c] - 0.03 && v <= pm[c] && v <= pp[c];
        if (!isMax && !isMin) continue;
        const dir = Math.sign(b[o2] - a[o2]);
        if (!dir) continue;
        cuts.push({ i, tf: c === 1 ? [dir, 0] : [0, dir] });
      }
    }
    cuts.sort((p, q) => p.i - q.i);
    const kept = [];
    for (const c of cuts) {
      const last = kept[kept.length - 1];
      if (last && c.i - last.i <= We) {
        if (c.corner && !last.corner) kept[kept.length - 1] = c;
        continue;
      }
      kept.push(c);
    }
    return kept;
  };

  // 경계점 목록 사이를 베지어로 맞춘다. tf = 그 점에서 진행 방향 접선(없으면 데이터로 추정)
  const fitBounds = (bounds, segs) => {
    for (let k = 0; k < bounds.length - 1; k++) {
      const A = bounds[k], B = bounds[k + 1];
      const pts = [];
      for (let i = A.i; i <= B.i; i++) pts.push(P(i));
      pts[0] = A.p; pts[pts.length - 1] = B.p;
      if (pts.length < 2) continue;
      const m = pts.length - 1, ww = Math.max(1, Math.min(w, m));
      const t1 = A.tf || norm(pts[ww][0] - pts[0][0], pts[ww][1] - pts[0][1]);
      const t2 = B.tf ? [-B.tf[0], -B.tf[1]] : norm(pts[m - ww][0] - pts[m][0], pts[m - ww][1] - pts[m][1]);
      fitCubic(pts, t1, t2, o.curveTol, segs);
    }
  };

  const fitSpan = (g0, g1, pStart, pEnd, tStart, tEnd, segs) => {
    const cuts = findCuts(g0, g1, We).map((c) => ({ i: c.i, p: P(c.i), tf: c.tf }));
    fitBounds([{ i: g0, p: pStart, tf: tStart }, ...cuts, { i: g1, p: pEnd, tf: tEnd }], segs);
  };

  if (runs.length === 0) {
    // 직선이 없는 닫힌 곡선: 코너·극점에서 끊는다
    let cuts = findCuts(0, n - 1, 0);
    if (cuts.length > 1 && cuts[cuts.length - 1].i + We >= cuts[0].i + n) cuts.pop();
    const segs = [];
    if (cuts.length < 2) {
      const tang = (i) => norm(P(i + w)[0] - P(i - w)[0], P(i + w)[1] - P(i - w)[1]);
      cuts = [0, n >> 2, n >> 1, (3 * n) >> 2].map((i) => ({ i, tf: tang(i) }));
    }
    const bounds = cuts.map((c) => ({ i: c.i, p: P(c.i), tf: c.tf }));
    bounds.push({ ...bounds[0], i: bounds[0].i + n });
    fitBounds(bounds, segs);
    return { start: bounds[0].p, segs };
  }

  // 두 직선 사이를 정확한 원호(필렛)로 이을 수 있으면 그렇게 한다
  const fillet = (A, B, X, g0, g1) => {
    const dot = A.dx * B.dx + A.dy * B.dy;
    const phi = Math.acos(Math.max(-1, Math.min(1, dot))); // 꺾이는 각
    if (phi < 15 * DEG || phi > 165 * DEG) return null;
    const bis = norm(B.dx - A.dx, B.dy - A.dy);
    const cosh = Math.cos(phi / 2), tanh = Math.tan(phi / 2);
    const pts = [];
    for (let i = g0; i <= g1; i++) pts.push(P(i));
    if (pts.length < 3) return null;
    const err = (r) => {
      const cd = r / cosh, cx = X[0] + bis[0] * cd, cy = X[1] + bis[1] * cd;
      let m = 0;
      for (const p of pts) m = Math.max(m, Math.abs(Math.hypot(p[0] - cx, p[1] - cy) - r));
      return m;
    };
    let dmin = Infinity;
    for (const p of pts) dmin = Math.min(dmin, Math.hypot(p[0] - X[0], p[1] - X[1]));
    const r0 = dmin / (1 / cosh - 1);
    if (!isFinite(r0) || r0 <= 0) return null;
    let lo = r0 * 0.6, hi = r0 * 1.6;
    for (let it = 0; it < 30; it++) {
      const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
      if (err(m1) < err(m2)) hi = m2; else lo = m1;
    }
    const r = (lo + hi) / 2;
    if (err(r) > Math.max(o.curveTol * 1.5, r * 0.04)) return null;
    const d = r * tanh;
    const sA = projOn(A, ...P(A.a)), eB = projOn(B, ...P(B.b));
    if ((X[0] - sA[0]) * A.dx + (X[1] - sA[1]) * A.dy < d - 0.5) return null;
    if ((eB[0] - X[0]) * B.dx + (eB[1] - X[1]) * B.dy < d - 0.5) return null;
    const endA = [X[0] - A.dx * d, X[1] - A.dy * d];
    const startB = [X[0] + B.dx * d, X[1] + B.dy * d];
    const segs = [];
    const arc = (p0, t0, p1, t1, ang) => {
      const k = (4 / 3) * Math.tan(ang / 4) * r;
      segs.push({ t: 'C', x1: p0[0] + t0[0] * k, y1: p0[1] + t0[1] * k, x2: p1[0] - t1[0] * k, y2: p1[1] - t1[1] * k, x: p1[0], y: p1[1] });
    };
    if (phi <= 100 * DEG) arc(endA, [A.dx, A.dy], startB, [B.dx, B.dy], phi);
    else {
      const cd = r / cosh;
      const M = [X[0] + bis[0] * (cd - r), X[1] + bis[1] * (cd - r)];
      const tm = norm(A.dx + B.dx, A.dy + B.dy);
      arc(endA, [A.dx, A.dy], M, tm, phi / 2);
      arc(M, tm, startB, [B.dx, B.dy], phi / 2);
    }
    return { endA, startB, segs, r };
  };

  const m = runs.length;
  const joins = [];
  for (let r = 0; r < m; r++) {
    const A = runs[r], B = runs[(r + 1) % m];
    const g0 = A.b;
    let g1 = B.a + (r + 1 === m ? n : 0);
    if (g1 < g0) g1 = g0;
    const pa = P(g0), pb = P(g1);
    const endA = projOn(A, pa[0], pa[1]);
    const startB = projOn(B, pb[0], pb[1]);
    const sin = A.dx * B.dy - A.dy * B.dx;
    let X = null;
    if (Math.abs(sin) > Math.sin(12 * DEG)) X = intersect(A, B);
    if (X) {
      let gl = 0, maxd = 0;
      for (let i = g0; i <= g1; i++) {
        const p = P(i);
        maxd = Math.max(maxd, Math.min(distLine(A, p[0], p[1]), distLine(B, p[0], p[1])));
        if (i > g0) { const q = P(i - 1); gl += Math.hypot(p[0] - q[0], p[1] - q[1]); }
      }
      const along = (X[0] - endA[0]) * A.dx + (X[1] - endA[1]) * A.dy;
      const alongB = (startB[0] - X[0]) * B.dx + (startB[1] - X[1]) * B.dy;
      const near = Math.hypot(X[0] - pa[0], X[1] - pa[1]) <= gl + o.cornerTol * 3 + 1;
      if (maxd <= o.cornerTol && along >= -o.cornerTol * 2 && alongB >= -o.cornerTol * 2 && near) {
        joins.push({ endA: X, startB: X, segs: [] });
        continue;
      }
    }
    const segs = [];
    if (X) {
      const f = fillet(A, B, X, g0, g1);
      if (f && f.r >= o.minFillet) { joins.push(f); continue; }
      if (f) { joins.push({ endA: X, startB: X, segs: [] }); continue; }
    }
    const sharpA = T(g0) > cornerRad, sharpB = T(g1) > cornerRad;
    if (g1 - g0 <= 1) segs.push({ t: 'L', x: startB[0], y: startB[1] });
    else fitSpan(g0, g1, endA, startB, sharpA ? null : [A.dx, A.dy], sharpB ? null : [B.dx, B.dy], segs);
    joins.push({ endA, startB, segs });
  }
  const start = joins[m - 1].startB;
  const segs = [];
  for (let r = 0; r < m; r++) {
    segs.push({ t: 'L', x: joins[r].endA[0], y: joins[r].endA[1] });
    segs.push(...joins[r].segs);
  }
  return { start, segs };
}
