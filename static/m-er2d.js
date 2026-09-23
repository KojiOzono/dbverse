/* m-er2d.js — モバイル用 2D ER図（PC版 er2d.js の見た目を再現） */

const NS = 'http://www.w3.org/2000/svg';

const CARD_W = 210;
const CARD_COL_H = 22;
const CARD_HEAD_H = 36;

// ─── 内部状態 ────────────────────────────
const st = {
  tx: 0, ty: 0, scale: 1,
  minScale: 0.15, maxScale: 3,
  svg: null, cardsEl: null, viewport: null,
  schema: null, layout: null,
  elements: {},           // name → HTMLElement
  svgPairs: [],           // {path, c1, c2, from, to}
  dragging: false,
  dragStart: null,
  pinchDist: 0, pinchScale: 1,
  pinchTx: 0, pinchTy: 0,
  moved: false,
  initialized: false,
  onTableClick: null,
};

// ─── ヘルパ ─────────────────────────────
function shortenName(name) {
  const i = name.indexOf('_');
  return i >= 0 ? name.slice(i + 1) : name;
}
function shortType(t) {
  t = String(t).toUpperCase();
  if (t.startsWith('CHARACTER VARYING')) return 'VARCHAR';
  if (t.startsWith('TIMESTAMP')) return 'TS';
  if (t.startsWith('DOUBLE')) return 'DBL';
  if (t.startsWith('BIGINT')) return 'BIGINT';
  if (t.startsWith('INTEGER')) return 'INT';
  if (t.startsWith('BOOLEAN')) return 'BOOL';
  return t;
}
function colorForTable(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const p = [
    {br:'#4de8ff'}, {br:'#7dff9b'}, {br:'#a06bff'},
    {br:'#ffd166'}, {br:'#66ddff'}, {br:'#ff6b8b'},
  ];
  return p[h % p.length];
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[c]);
}
function escapeAttr(s) { return escapeHtml(s); }

// ─── API ───────────────────────────────
export function isReady() { return st.initialized; }

export async function init(svgEl, cardsEl, viewportEl, schema, layout, onTableClick) {
  st.svg = svgEl;
  st.cardsEl = cardsEl;
  st.viewport = viewportEl;
  st.schema = schema;
  st.layout = layout && layout.positions ? layout : null;
  st.onTableClick = onTableClick;

  build();
  st.initialized = true;

  setTimeout(fit, 80);
}

export function fit() {
  const cards = Object.values(st.elements);
  if (!cards.length) return;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  cards.forEach(el => {
    const x = parseFloat(el.style.left);
    const y = parseFloat(el.style.top);
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x + w > maxX) maxX = x + w;
    if (y + h > maxY) maxY = y + h;
  });

  const pad = 40;
  const W = maxX - minX + pad * 2;
  const H = maxY - minY + pad * 2;
  const vw = st.viewport.clientWidth;
  const vh = st.viewport.clientHeight;
  const s = Math.min(vw / W, vh / H, 1.0);

  st.scale = s;
  st.tx = (vw - W * s) / 2 - (minX - pad) * s;
  st.ty = (vh - H * s) / 2 - (minY - pad) * s;
  applyTransform();
}

export function reset() {
  st.tx = 0; st.ty = 0; st.scale = 1;
  applyTransform();
  setTimeout(fit, 50);
}

export function resize() {
  if (st.initialized && st.viewport) {
    // 何もしない（fitはユーザー操作）
  }
}

// ─── ビルド ─────────────────────────────
function build() {
  const svg = st.svg;
  const cardsEl = st.cardsEl;
  if (!svg || !cardsEl || !st.schema) return;

  cardsEl.innerHTML = '';
  svg.innerHTML = '';
  st.elements = {};
  st.svgPairs = [];

  const tables = st.schema.tables;
  const nameToTable = {};
  tables.forEach(t => { nameToTable[t.name] = t; });

  // 1) カード生成（DOMを入れてサイズ実測）
  tables.forEach(t => {
    t._2d = {
      w: CARD_W,
      h: CARD_HEAD_H + t.columns.length * CARD_COL_H + 8,
      x: 0, y: 0,
    };
    const el = makeCard(t);
    el.style.left = '0px';
    el.style.top = '0px';
    el.style.visibility = 'hidden';
    cardsEl.appendChild(el);
    st.elements[t.name] = el;
  });

  void cardsEl.offsetHeight;

  tables.forEach(t => {
    const el = st.elements[t.name];
    const h = el.offsetHeight;
    const w = el.offsetWidth;
    if (h > 0) t._2d.h = h;
    if (w > 0) t._2d.w = w;
  });

  // 2) レイアウト決定（サーバー座標を使う / 無ければグリッド）
  const positions = (st.layout && st.layout.positions) ? st.layout.positions : {};
  let maxX = 0, maxY = 0;

  tables.forEach(t => {
    const p = positions[t.name];
    if (p && typeof p.x === 'number') {
      t._2d.x = p.x;
      t._2d.y = p.y;
    } else {
      // グリッド配置
      const i = tables.indexOf(t);
      const cols = Math.ceil(Math.sqrt(tables.length));
      t._2d.x = (i % cols) * (CARD_W + 60) + CARD_W / 2;
      t._2d.y = Math.floor(i / cols) * 260 + 100;
    }
    maxX = Math.max(maxX, t._2d.x + t._2d.w / 2);
    maxY = Math.max(maxY, t._2d.y + t._2d.h / 2);
  });

  const bounds = { width: maxX + 60, height: maxY + 60 };

  // 3) 座標適用
  tables.forEach(t => {
    const el = st.elements[t.name];
    el.style.left = (t._2d.x - t._2d.w / 2) + 'px';
    el.style.top  = (t._2d.y - t._2d.h / 2) + 'px';
    el.style.visibility = '';
  });

  svg.setAttribute('width',  bounds.width  + 'px');
  svg.setAttribute('height', bounds.height + 'px');

  // 4) FK線（直角ルーティング）
  tables.forEach(t => {
    t.fks.forEach(fk => {
      const dst = nameToTable[fk.to_table];
      if (!dst || !dst._2d || !t._2d) return;
      if (t.name === dst.name) return;

      const { startX, startY, endX, endY, pathStr } = computePath(t._2d, dst._2d);

      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', pathStr);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', '#9ca3af');
      path.setAttribute('stroke-width', '1.4');
      path.setAttribute('stroke-opacity', '0.55');
      path.setAttribute('stroke-linejoin', 'round');
      path.dataset.from = t.name;
      path.dataset.to   = dst.name;
      svg.appendChild(path);

      const c1 = makeDot(startX, startY);
      const c2 = makeDot(endX, endY);
      svg.appendChild(c1);
      svg.appendChild(c2);

      st.svgPairs.push({ path, c1, c2, from: t.name, to: dst.name });
    });
  });

  // 5) パン/ズーム配線（初回のみ）
  if (!st.viewport.dataset.bound) {
    st.viewport.dataset.bound = '1';
    bindViewport();
  }
}

function makeDot(x, y) {
  const c = document.createElementNS(NS, 'circle');
  c.setAttribute('cx', x);
  c.setAttribute('cy', y);
  c.setAttribute('r', '3');
  c.setAttribute('fill', '#ffffff');
  c.setAttribute('stroke', '#9ca3af');
  c.setAttribute('stroke-width', '1.4');
  return c;
}

function computePath(A, B) {
  const dx = B.x - A.x, dy = B.y - A.y;
  let startX, startY, endX, endY, pathStr;

  if (Math.abs(dx) > Math.abs(dy)) {
    startX = dx > 0 ? A.x + A.w / 2 : A.x - A.w / 2;
    startY = A.y;
    endX   = dx > 0 ? B.x - B.w / 2 : B.x + B.w / 2;
    endY   = B.y;
    const midX = (startX + endX) / 2;
    pathStr = `M ${startX} ${startY} L ${midX} ${startY} L ${midX} ${endY} L ${endX} ${endY}`;
  } else {
    startX = A.x;
    startY = dy > 0 ? A.y + A.h / 2 : A.y - A.h / 2;
    endX   = B.x;
    endY   = dy > 0 ? B.y - B.h / 2 : B.y + B.h / 2;
    const midY = (startY + endY) / 2;
    pathStr = `M ${startX} ${startY} L ${startX} ${midY} L ${endX} ${midY} L ${endX} ${endY}`;
  }
  return { startX, startY, endX, endY, pathStr };
}

// ─── カード生成（PC版と同じ見た目） ─────
function makeCard(t) {
  const el = document.createElement('div');
  el.className = 'er2d-card';
  el.dataset.name = t.name;
  el.style.width = t._2d.w + 'px';

  const col = colorForTable(t.name);
  const fkMap = {};
  t.fks.forEach(fk => { fkMap[fk.from_col] = fk; });

  let html = '';
  html += '<div class="er2d-head" style="border-top-color:' + col.br + '">';
  html += '<span class="er2d-name">' + escapeHtml(shortenName(t.name)) + '</span>';
  html += '<span class="er2d-meta">' + t.rows + '</span>';
  html += '</div>';
  html += '<div class="er2d-cols">';
  t.columns.forEach(c => {
    const isPK = c.pk;
    const fk   = fkMap[c.name];
    const isFK = !!fk;
    let cls = 'er2d-col';
    if (isPK) cls += ' is-pk';
    if (isFK) cls += ' is-fk';
    html += '<div class="' + cls + '">';
    html += '<span class="badges">';
    if (isPK) html += '<span class="badge pk">PK</span>';
    if (isFK) html += '<span class="badge fk">FK</span>';
    html += '</span>';
    html += '<span class="nm">' + escapeHtml(c.name);
    if (isFK) html += '<span class="ref">(' + escapeHtml(fk.to_table) + ')</span>';
    html += '</span>';
    html += '<span class="ty">' + escapeHtml(shortType(c.type)) + '</span>';
    html += '</div>';
  });
  html += '</div>';

  el.innerHTML = html;

  // タップでテーブル開く（ドラッグと区別）
  let downX = 0, downY = 0, moved = false;
  el.addEventListener('pointerdown', (e) => {
    downX = e.clientX; downY = e.clientY; moved = false;
    e.stopPropagation();
  });
  el.addEventListener('pointermove', (e) => {
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) moved = true;
  });
  el.addEventListener('pointerup', (e) => {
    e.stopPropagation();
    if (moved) return;
    if (st.onTableClick) st.onTableClick(t.name);
  });

  return el;
}

// ─── パン / ピンチ ──────────────────────
function bindViewport() {
  const vp = st.viewport;

  vp.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      st.dragging = true;
      st.moved = false;
      st.dragStart = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        tx: st.tx, ty: st.ty,
      };
    } else if (e.touches.length === 2) {
      st.dragging = false;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      st.pinchDist = Math.hypot(dx, dy);
      st.pinchScale = st.scale;
      st.pinchTx = st.tx;
      st.pinchTy = st.ty;
    }
  }, { passive: false });

  vp.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (e.touches.length === 1 && st.dragging) {
      st.tx = st.dragStart.tx + (e.touches[0].clientX - st.dragStart.x);
      st.ty = st.dragStart.ty + (e.touches[0].clientY - st.dragStart.y);
      st.moved = true;
      applyTransform();
    } else if (e.touches.length === 2 && st.pinchDist > 0) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const ratio = dist / st.pinchDist;
      let ns = st.pinchScale * ratio;
      ns = Math.max(st.minScale, Math.min(st.maxScale, ns));

      const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const rect = vp.getBoundingClientRect();
      const px = cx - rect.left;
      const py = cy - rect.top;

      const k = ns / st.pinchScale;
      st.tx = px - k * (px - st.pinchTx);
      st.ty = py - k * (py - st.pinchTy);
      st.scale = ns;
      applyTransform();
    }
  }, { passive: false });

  vp.addEventListener('touchend', (e) => {
    if (e.touches.length === 0) {
      st.dragging = false;
      st.pinchDist = 0;
    } else if (e.touches.length === 1) {
      st.dragging = true;
      st.dragStart = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        tx: st.tx, ty: st.ty,
      };
    }
  }, { passive: true });

  // マウス（DevTools用）
  vp.addEventListener('mousedown', (e) => {
    if (e.target.closest('.er2d-card')) return;
    st.dragging = true;
    st.dragStart = { x: e.clientX, y: e.clientY, tx: st.tx, ty: st.ty };
  });
  window.addEventListener('mousemove', (e) => {
    if (!st.dragging) return;
    st.tx = st.dragStart.tx + (e.clientX - st.dragStart.x);
    st.ty = st.dragStart.ty + (e.clientY - st.dragStart.y);
    applyTransform();
  });
  window.addEventListener('mouseup', () => { st.dragging = false; });

  // ホイールズーム（DevTools用）
  vp.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = vp.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const oldScale = st.scale;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const newScale = Math.max(st.minScale, Math.min(st.maxScale, oldScale * factor));
    st.tx = mx - (mx - st.tx) * (newScale / oldScale);
    st.ty = my - (my - st.ty) * (newScale / oldScale);
    st.scale = newScale;
    applyTransform();
  }, { passive: false });
}

function applyTransform() {
  if (!st.viewport) return;
  st.viewport.style.transform =
    `translate(${st.tx}px, ${st.ty}px) scale(${st.scale})`;
}