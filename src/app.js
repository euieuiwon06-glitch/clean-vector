const DEF = {
  mode: 'graphic', colorsMode: 'auto', colorsN: 5, photo: true, background: true,
  shading: true, shadeStrength: 1,
  lineTol: 0.6, snapDeg: 5, snap45: false, align: true, strokes: true,
  cornerTol: 0.9, minFillet: 1.8, curveTol: 0.45,
  blur: 0.5, minArea: 4, thin: true,
};
const STORE = 'clean-vector:settings';
const $ = (s) => document.querySelector(s);

let S = { ...DEF };
try { Object.assign(S, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch {}
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(S)); } catch {} };

const stage = $('#stage'), world = $('#world'), orig = $('#orig'), vec = $('#vec'), outline = $('#outline');
const cvs = $('#anchors'), wipe = $('#wipe');
let image = null, fileName = 'vector', result = null, targets = [];
let view = 'vec', Z = 1, TX = 0, TY = 0, wipeX = 0.5;

// ---------- 패널 ----------
document.querySelectorAll('.slider').forEach((el) => {
  const k = el.dataset.key;
  const input = Object.assign(document.createElement('input'), { type: 'range', min: el.dataset.min, max: el.dataset.max, step: el.dataset.step });
  input.setAttribute('aria-label', el.querySelector('span').textContent);
  const out = document.createElement('output');
  el.append(out, input);
  const show = () => { out.textContent = `${Number(S[k]).toString()}${el.dataset.unit || ''}`; };
  input.value = S[k]; show();
  input.addEventListener('input', () => { S[k] = Number(input.value); show(); save(); schedule(); });
  el._sync = () => { input.value = S[k]; show(); };
});
document.querySelectorAll('.toggle input').forEach((el) => {
  const k = el.dataset.key;
  el.checked = !!S[k];
  el.addEventListener('change', () => { S[k] = el.checked; save(); schedule(); });
});
function seg(id, key, onChange) {
  const root = $(id);
  const set = (v) => root.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    set(b.dataset.v); onChange(b.dataset.v);
  });
  return set;
}
const setMode = seg('#mode', 'mode', (v) => { S.mode = v; save(); applyModeUI(); schedule(); });
const setColors = seg('#colorsMode', 'colorsMode', (v) => { S.colorsMode = v; save(); applyModeUI(); schedule(); });
const setView = seg('#view', null, (v) => { view = v; applyView(); });
function applyModeUI() {
  setMode(S.mode); setColors(S.colorsMode);
  document.querySelectorAll('[data-show]').forEach((el) => { el.hidden = el.dataset.show !== S.mode; });
  document.querySelector('.slider[data-key="colorsN"]').hidden = S.colorsMode !== 'manual';
  stage.classList.toggle('picking', S.mode === 'overlay' && !!image);
}
applyModeUI();
$('#reset').addEventListener('click', () => {
  S = { ...DEF, mode: S.mode }; save();
  document.querySelectorAll('.slider').forEach((el) => el._sync());
  document.querySelectorAll('.toggle input').forEach((el) => { el.checked = !!S[el.dataset.key]; });
  applyModeUI(); schedule();
});

// ---------- 변환 ----------
let worker = null, busy = false, jobId = 0, timer = 0;
function makeWorker() {
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = onWorker;
}
makeWorker();
function schedule() { clearTimeout(timer); timer = setTimeout(run, 220); }
function run() {
  if (!image) return;
  if (busy) { worker.terminate(); makeWorker(); }
  busy = true;
  const id = ++jobId;
  const big = image.width * image.height > 3_500_000;
  const opts = {
    ...S,
    colors: S.colorsMode === 'auto' ? 'auto' : S.colorsN,
    targets: targets.map((t) => t.rgb),
    scale: big ? 1 : 2,
    photoFormat: 'image/jpeg',
  };
  progress(0.02, '변환 중');
  worker.postMessage({ id, image: { width: image.width, height: image.height, data: image.data }, opts });
}
function onWorker(e) {
  const m = e.data;
  if (m.id !== jobId) return;
  if (m.type === 'progress') { progress(m.p, m.label); return; }
  busy = false;
  if (m.type === 'error') { progress(0); $('#status').textContent = '변환 실패'; console.error(m.message); return; }
  result = m;
  progress(1);
  vec.innerHTML = m.svg;
  outline.innerHTML = m.svg;
  outline.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
  $('#save').disabled = $('#copy').disabled = false;
  renderInfo(m);
  layout();
}
function progress(p, label) {
  const bar = $('#progress');
  bar.classList.toggle('on', p > 0 && p < 1);
  bar.firstElementChild.style.width = `${Math.round(p * 100)}%`;
  if (label) $('#status').textContent = label;
  if (p >= 1) $('#status').textContent = '';
}
function renderInfo(m) {
  const kb = new Blob([m.svg]).size / 1024;
  const st = m.info.stats;
  $('#stats').innerHTML = `<span>패스 <b>${st.paths.toLocaleString()}</b></span><span>앵커 <b>${st.anchors.toLocaleString()}</b></span>` +
    `<span>용량 <b>${kb >= 1024 ? (kb / 1024).toFixed(1) + 'MB' : Math.round(kb) + 'KB'}</b></span><span>${(st.ms / 1000).toFixed(1)}초</span>` +
    (m.info.photos.length ? `<span>사진 영역 <b>${m.info.photos.length}</b></span>` : '');
  const pal = $('#palette');
  pal.innerHTML = '';
  if (S.mode === 'graphic') {
    const list = m.info.palette.filter((c) => c !== m.info.background);
    if (m.info.background) list.unshift(m.info.background);
    for (const c of list) pal.append(swatch(c, c === m.info.background ? '배경' : c.toUpperCase()));
  }
  renderTargets(m.info.targets);
}
function swatch(color, label, onRemove) {
  const s = document.createElement('span');
  s.className = 'sw';
  s.innerHTML = `<i style="background:${color}"></i>${label}`;
  if (onRemove) {
    const b = Object.assign(document.createElement('button'), { textContent: '×', title: '빼기' });
    b.setAttribute('aria-label', `${label} 빼기`);
    b.onclick = onRemove;
    s.append(b);
  }
  return s;
}
function renderTargets(auto) {
  const box = $('#targets');
  box.innerHTML = '';
  if (targets.length) {
    targets.forEach((t, i) => box.append(swatch(t.hex, t.hex.toUpperCase(), () => { targets.splice(i, 1); renderTargets(); schedule(); })));
  } else if (auto && auto.length) {
    auto.forEach((c) => box.append(swatch(c, `자동 ${c.toUpperCase()}`)));
  }
}

// ---------- 파일 ----------
async function openFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  fileName = file.name.replace(/\.[^.]+$/, '') || 'vector';
  const bmp = await createImageBitmap(file);
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(bmp, 0, 0);
  image = ctx.getImageData(0, 0, bmp.width, bmp.height);
  if (orig.src) URL.revokeObjectURL(orig.src);
  orig.src = URL.createObjectURL(file);
  orig.hidden = false;
  targets = [];
  result = null; vec.innerHTML = ''; outline.innerHTML = '';
  $('#drop').classList.add('hidden');
  applyModeUI();
  fit();
  run();
}
$('#file').addEventListener('change', (e) => openFile(e.target.files[0]));
window.addEventListener('paste', (e) => {
  const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
  if (f) openFile(f);
});
stage.addEventListener('dragover', (e) => { e.preventDefault(); stage.classList.add('dragover'); });
stage.addEventListener('dragleave', () => stage.classList.remove('dragover'));
stage.addEventListener('drop', (e) => { e.preventDefault(); stage.classList.remove('dragover'); openFile(e.dataTransfer.files[0]); });

$('#save').addEventListener('click', () => {
  if (!result) return;
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([result.svg], { type: 'image/svg+xml' })), download: `${fileName}.svg` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$('#copy').addEventListener('click', async () => {
  if (!result) return;
  try { await navigator.clipboard.writeText(result.svg); flash('#copy', '복사됨'); } catch { flash('#copy', '복사 실패'); }
});
function flash(sel, text) {
  const b = $(sel), t = b.textContent;
  b.textContent = text;
  setTimeout(() => { b.textContent = t; }, 1200);
}

// ---------- 보기: 확대·이동 ----------
function fit() {
  if (!image) return;
  const r = stage.getBoundingClientRect();
  Z = Math.min((r.width - 48) / image.width, (r.height - 48) / image.height);
  TX = (r.width - image.width * Z) / 2;
  TY = (r.height - image.height * Z) / 2;
  layout();
}
function zoomAt(f, cx, cy) {
  const nz = Math.min(64, Math.max(0.05, Z * f));
  TX = cx - (cx - TX) * (nz / Z);
  TY = cy - (cy - TY) * (nz / Z);
  Z = nz;
  layout();
}
function layout() {
  if (!image) return;
  const W = image.width * Z, H = image.height * Z;
  world.style.transform = `translate(${TX}px, ${TY}px)`;
  world.style.width = `${W}px`; world.style.height = `${H}px`;
  orig.style.width = `${W}px`; orig.style.height = `${H}px`;
  orig.classList.toggle('px', Z >= 2);
  for (const box of [vec, outline]) {
    const svg = box.firstElementChild;
    if (svg) { svg.setAttribute('width', W); svg.setAttribute('height', H); }
  }
  $('#zoomFit').textContent = `${Math.round(Z * 100)}%`;
  applyView();
}
function applyView() {
  setView(view);
  stage.dataset.view = view;
  const r = stage.getBoundingClientRect();
  wipe.hidden = view !== 'wipe' || !image;
  if (view === 'wipe' && image) {
    const x = r.width * wipeX;
    wipe.style.left = `${x}px`;
    vec.style.clipPath = `inset(0 0 0 ${Math.max(0, x - TX)}px)`;
  } else vec.style.clipPath = '';
  drawAnchors();
}
function drawAnchors() {
  const r = stage.getBoundingClientRect(), dpr = devicePixelRatio || 1;
  cvs.width = r.width * dpr; cvs.height = r.height * dpr;
  cvs.style.width = `${r.width}px`; cvs.style.height = `${r.height}px`;
  const ctx = cvs.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, r.width, r.height);
  if (view !== 'path' || !result) return;
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#0a7cff';
  const inView = (x, y) => x > -8 && y > -8 && x < r.width + 8 && y < r.height + 8;
  if (Z >= 1.5) {
    const h = result.handles;
    ctx.strokeStyle = accent; ctx.globalAlpha = 0.55; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < h.length; i += 4) {
      const x0 = h[i] * Z + TX, y0 = h[i + 1] * Z + TY, x1 = h[i + 2] * Z + TX, y1 = h[i + 3] * Z + TY;
      if (!inView(x0, y0) && !inView(x1, y1)) continue;
      ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
      ctx.moveTo(x1 + 2, y1); ctx.arc(x1, y1, 2, 0, Math.PI * 2);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  const a = result.anchors, s = Z >= 1 ? 5 : 3;
  ctx.fillStyle = '#fff'; ctx.strokeStyle = accent; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < a.length; i += 2) {
    const x = a[i] * Z + TX, y = a[i + 1] * Z + TY;
    if (!inView(x, y)) continue;
    ctx.rect(Math.round(x - s / 2) + 0.5, Math.round(y - s / 2) + 0.5, s, s);
  }
  ctx.fill(); ctx.stroke();
}

stage.addEventListener('wheel', (e) => {
  if (!image) return;
  e.preventDefault();
  const r = stage.getBoundingClientRect();
  if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > 0 && !e.shiftKey && Math.abs(e.deltaX) < 1) {
    zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)), e.clientX - r.left, e.clientY - r.top);
  } else { TX -= e.deltaX; TY -= e.deltaY; layout(); }
}, { passive: false });

let drag = null;
stage.addEventListener('pointerdown', (e) => {
  if (!image || e.button !== 0) return;
  stage.setPointerCapture(e.pointerId);
  const onWipe = view === 'wipe' && (e.target === wipe || wipe.contains(e.target));
  drag = { x: e.clientX, y: e.clientY, tx: TX, ty: TY, moved: false, wipe: onWipe };
});
stage.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
  if (drag.wipe) {
    const r = stage.getBoundingClientRect();
    wipeX = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    applyView();
    return;
  }
  if (drag.moved) { stage.classList.add('panning'); TX = drag.tx + dx; TY = drag.ty + dy; layout(); }
});
stage.addEventListener('pointerup', (e) => {
  if (!drag) return;
  const d = drag; drag = null;
  stage.classList.remove('panning');
  if (!d.moved && !d.wipe && S.mode === 'overlay') pick(e);
});
function pick(e) {
  const r = stage.getBoundingClientRect();
  const x = Math.floor((e.clientX - r.left - TX) / Z), y = Math.floor((e.clientY - r.top - TY) / Z);
  if (x < 1 || y < 1 || x >= image.width - 1 || y >= image.height - 1) return;
  const acc = [0, 0, 0];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const i = ((y + dy) * image.width + x + dx) * 4;
    acc[0] += image.data[i]; acc[1] += image.data[i + 1]; acc[2] += image.data[i + 2];
  }
  const rgb = acc.map((v) => Math.round(v / 9));
  targets.push({ rgb, hex: '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('') });
  renderTargets();
  schedule();
}
$('#zoomIn').addEventListener('click', () => { const r = stage.getBoundingClientRect(); zoomAt(1.25, r.width / 2, r.height / 2); });
$('#zoomOut').addEventListener('click', () => { const r = stage.getBoundingClientRect(); zoomAt(0.8, r.width / 2, r.height / 2); });
$('#zoomFit').addEventListener('click', fit);
window.addEventListener('resize', () => layout());
window.addEventListener('keydown', (e) => {
  if (e.target.matches('input')) return;
  const map = { 1: 'orig', 2: 'vec', 3: 'wipe', 4: 'path' };
  if (map[e.key]) { view = map[e.key]; applyView(); }
  if (e.key === '0') fit();
});
applyView();
