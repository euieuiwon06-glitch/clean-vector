const $ = (s) => document.querySelector(s);

const stage = $('#stage'), world = $('#world'), vec = $('#vec'), outline = $('#outline');
// 원본 이미지 칸은 파일을 열 때 채운다(빈 img 태그를 두지 않음)
const orig = Object.assign(document.createElement('img'), { id: 'orig', alt: '원본 이미지', draggable: false, hidden: true });
world.prepend(orig);
const cvs = $('#anchors'), wipe = $('#wipe');
let image = null, fileName = 'vector', result = null;
let view = 'vec', Z = 1, TX = 0, TY = 0, wipeX = 0.5, fitZ = 1;

function seg(id, onChange) {
  const root = $(id);
  const set = (v) => root.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    set(b.dataset.v); onChange(b.dataset.v);
  });
  return set;
}
const setView = seg('#view', (v) => { view = v; applyView(); });
let mode = 'auto';
seg('#mode', (v) => { mode = v; run(); });

// ---------- 변환 ----------
let worker = null, busy = false, jobId = 0, timer = 0;
function makeWorker() {
  worker = new Worker(new URL('./worker.js?v=4f4e88f9', import.meta.url), { type: 'module' });
  worker.onmessage = onWorker;
}
makeWorker();
function run() {
  if (!image) return;
  if (busy) { worker.terminate(); makeWorker(); }
  busy = true;
  const id = ++jobId;
  progress(0.02, '변환 중');
  worker.postMessage({ id, image: { width: image.width, height: image.height, data: image.data }, mode });
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
  bar.firstElementChild.style.transform = `scaleX(${p})`;
  if (label) $('#status').textContent = label;
  if (p >= 1) $('#status').textContent = '';
}
function renderInfo(m) {
  const kb = new Blob([m.svg]).size / 1024;
  const st = m.info.stats;
  $('#stats').innerHTML = `<span>패스 <b>${st.paths.toLocaleString()}</b></span><span>앵커 <b>${st.anchors.toLocaleString()}</b></span>` +
    `<span>용량 <b>${kb >= 1024 ? (kb / 1024).toFixed(1) + 'MB' : Math.round(kb) + 'KB'}</b></span><span>${(st.ms / 1000).toFixed(1)}초</span>` +
    (m.info.ai ? '<span>AI 확대 적용</span>' : '') + (m.info.aiNote ? `<span>${m.info.aiNote}</span>` : '') +
    (m.info.mode === 'overlay' ? `<span>${mode === 'auto' ? '자동 → ' : ''}사진+그래픽: 사진은 원본, 그래픽만 벡터</span>` : `<span>${mode === 'auto' ? '자동 → ' : ''}그래픽만${m.info.photos.length ? ` · 사진 영역 <b>${m.info.photos.length}</b>곳은 원본 유지` : ''}</span>`);
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
  result = null; vec.innerHTML = ''; outline.innerHTML = '';
  $('#drop').classList.add('hidden');
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
  Z = fitZ = Math.min((r.width - 48) / image.width, (r.height - 48) / image.height);
  TX = (r.width - image.width * Z) / 2;
  TY = (r.height - image.height * Z) / 2;
  layout();
}
function zoomAt(f, cx, cy) {
  const nz = Math.min(Math.max(16, fitZ * 8), Math.max(fitZ, Z * f));
  if (nz === Z) return;
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
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#111';
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
    const d = Math.max(-100, Math.min(100, e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY));
    zoomAt(Math.exp(-d * (e.ctrlKey ? 0.006 : 0.0012)), e.clientX - r.left, e.clientY - r.top);
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
});
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
