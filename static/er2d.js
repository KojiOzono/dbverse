// er2d.js — 2D ER図  v6
//   ・サーバー保存レイアウト（位置＋パン/ズーム）
//   ・カード単体ドラッグ（クリックで開く / ドラッグで移動）
//   ・FK線リアルタイム追従（カラム基準ルーティング）
import {
  state, er2d, api,
  escapeHtml, escapeAttr, shortType, colorForTable, shortenName,
  toast,
} from './main.js';

const NS = 'http://www.w3.org/2000/svg';
const VERSION = 'v6';

/* ─── モジュール状態 ─── */
let svgPairs  = [];      // {path, c1, c2, from, to, fromCol, toCol}
let saveTimer = null;

/* ═══════════════════════════════════════════════════════
   サーバー入出力
   ═══════════════════════════════════════════════════════ */
async function ensureLayout() {
  return state.layout2d || {};
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveLayout, 500);
}

async function saveLayout() {
  if (!state.layout2d) return;
  state.schema.tables.forEach(t => {
    if (t._2d) {
      state.layout2d.positions[t.name] = {
        x: Math.round(t._2d.x),
        y: Math.round(t._2d.y),
      };
    }
  });
  state.layout2d.view = { tx: er2d.tx, ty: er2d.ty, scale: er2d.scale };

  try {
    await fetch('/api/layout2d', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        positions: state.layout2d.positions,
        view: state.layout2d.view,
      }),
    });
  } catch (e) {}
}

async function resetLayout() {
  if (!confirm('2Dレイアウトを初期配置に戻しますか？')) return;
  try {
    await fetch('/api/layout2d', { method: 'DELETE' });
  } catch (e) {}

  const CARD_W = 210, CARD_COL_H = 22, CARD_HEAD_H = 36;
  state.schema.tables.forEach(t => {
    t._2d = {
      w: CARD_W,
      h: CARD_HEAD_H + t.columns.length * CARD_COL_H + 8,
      x: 0, y: 0,
    };
  });

  computeForceLayout(state.schema.tables);

  state.layout2d = { positions: {}, width: 0, height: 0 };
  let maxX = 0, maxY = 0;
  state.schema.tables.forEach(t => {
    state.layout2d.positions[t.name] = { x: t._2d.x, y: t._2d.y };
    maxX = Math.max(maxX, t._2d.x + t._2d.w / 2);
    maxY = Math.max(maxY, t._2d.y + t._2d.h / 2);
  });
  state.layout2d.width = maxX + 60;
  state.layout2d.height = maxY + 60;

  try {
    await fetch('/api/layout2d', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({positions: state.layout2d.positions, view: null}),
    });
  } catch (e) {}

  build2D();
  toast('レイアウトを初期化', 'ok');
}

document.getElementById('btn-reset-layout')?.addEventListener('click', e => {
  e.stopPropagation();
  if (er2d.mode !== '2d') {
    toast('2D表示中に使えます', 'err');
    return;
  }
  resetLayout();
});

/* ═══════════════════════════════════════════════════════
   AABB分離（Jacobi）
   ═══════════════════════════════════════════════════════ */
function separateAABB(nodes, gap, maxIter) {
  const n = nodes.length;
  for (let iter = 0; iter < maxIter; iter++) {
    let anyOverlap = false;
    const px = new Float64Array(n);
    const py = new Float64Array(n);

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = nodes[i], b = nodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const oX = (a.w + b.w) / 2 + gap - Math.abs(dx);
        const oY = (a.h + b.h) / 2 + gap - Math.abs(dy);

        if (oX > 0 && oY > 0) {
          anyOverlap = true;
          if (oX < oY) {
            const push = oX * 0.9 + 5;
            const s = dx >= 0 ? 1 : -1;
            px[i] -= s * push; px[j] += s * push;
          } else {
            const push = oY * 0.9 + 5;
            const s = dy >= 0 ? 1 : -1;
            py[i] -= s * push; py[j] += s * push;
          }
        }
      }
    }
    if (!anyOverlap) return true;
    for (let i = 0; i < n; i++) {
      nodes[i].x += px[i];
      nodes[i].y += py[i];
    }
  }
  return false;
}

function countOverlaps(nodes, gap) {
  let c = 0;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      const dx = Math.abs(b.x - a.x);
      const dy = Math.abs(b.y - a.y);
      if (dx < (a.w + b.w) / 2 + gap && dy < (a.h + b.h) / 2 + gap) c++;
    }
  }
  return c;
}

/* ─── 力指向レイアウト ─── */
export function computeForceLayout(tables) {
  const n = tables.length;
  if (!n) return {width: 800, height: 600};

  const cols = Math.ceil(Math.sqrt(n));
  const nodes = tables.map((t, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return {
      name: t.name, table: t,
      x: col * 260 + (Math.random() - 0.5) * 20,
      y: row * 240 + (Math.random() - 0.5) * 20,
      vx: 0, vy: 0,
      w: t._2d.w, h: t._2d.h,
    };
  });

  const nodeMap = {};
  nodes.forEach(nd => { nodeMap[nd.name] = nd; });

  const edges = [];
  tables.forEach(t => {
    t.fks.forEach(fk => {
      if (t.name === fk.to_table) return;
      const src = nodeMap[t.name];
      const dst = nodeMap[fk.to_table];
      if (src && dst) edges.push({src, dst});
    });
  });

  const ITER        = 700;
  const REPULSION   = 120000;
  const SPRING_K    = 0.035;
  const SPRING_LEN  = 150;
  const DAMPING     = 0.80;
  const CENTER_PULL = 0.0006;
  const MAX_V       = 60;

  for (let iter = 0; iter < ITER; iter++) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = nodes[i], b = nodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx*dx + dy*dy) || 0.1;
        const force = REPULSION / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx -= fx; a.vy -= fy;
        b.vx += fx; b.vy += fy;
      }
    }
    for (let e = 0; e < edges.length; e++) {
      const a = edges[e].src, b = edges[e].dst;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx*dx + dy*dy) || 0.1;
      const force = (dist - SPRING_LEN) * SPRING_K;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.vx += fx; a.vy += fy;
      b.vx -= fx; b.vy -= fy;
    }
    for (let i = 0; i < n; i++) {
      const nd = nodes[i];
      nd.vx -= nd.x * CENTER_PULL;
      nd.vy -= nd.y * CENTER_PULL;
    }
    for (let i = 0; i < n; i++) {
      const nd = nodes[i];
      nd.vx *= DAMPING; nd.vy *= DAMPING;
      nd.vx = Math.max(-MAX_V, Math.min(MAX_V, nd.vx));
      nd.vy = Math.max(-MAX_V, Math.min(MAX_V, nd.vy));
      nd.x += nd.vx; nd.y += nd.vy;
    }
  }

  let gap = 28;
  for (let attempt = 0; attempt < 20; attempt++) {
    if (separateAABB(nodes, gap, 3000)) break;
    gap = Math.round(gap * 1.25);
  }
  for (let pass = 0; pass < 40; pass++) {
    if (separateAABB(nodes, 16, 800)) break;
  }
  const HARD_GAP = 12;
  for (let pass = 0; pass < 20; pass++) {
    let fixed = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = nodes[i], b = nodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const minDX = (a.w + b.w) / 2 + HARD_GAP;
        const minDY = (a.h + b.h) / 2 + HARD_GAP;
        if (Math.abs(dx) < minDX && Math.abs(dy) < minDY) {
          if (Math.abs(dx) < Math.abs(dy)) {
            const need = minDX - Math.abs(dx) + 1;
            const sx = dx >= 0 ? 1 : -1;
            a.x -= sx * need / 2;
            b.x += sx * need / 2;
          } else {
            const need = minDY - Math.abs(dy) + 1;
            const sy = dy >= 0 ? 1 : -1;
            a.y -= sy * need / 2;
            b.y += sy * need / 2;
          }
          fixed++;
        }
      }
    }
    if (fixed === 0) break;
  }

  const remain = countOverlaps(nodes, 2);
  if (remain > 0) {
    console.warn('[' + VERSION + '] ' + remain + ' overlaps remain');
  }

  let minX = Infinity, minY = Infinity;
  nodes.forEach(nd => {
    minX = Math.min(minX, nd.x - nd.w/2);
    minY = Math.min(minY, nd.y - nd.h/2);
  });
  const PAD = 60;
  let maxX = -Infinity, maxY = -Infinity;
  nodes.forEach(nd => {
    nd.table._2d.x = nd.x - minX + PAD + nd.w/2;
    nd.table._2d.y = nd.y - minY + PAD + nd.h/2;
    maxX = Math.max(maxX, nd.table._2d.x + nd.w/2);
    maxY = Math.max(maxY, nd.table._2d.y + nd.h/2);
  });

  return {width: maxX + PAD, height: maxY + PAD};
}

/* ═══════════════════════════════════════════════════════
   FK線のパス計算（カラム基準）
   ═══════════════════════════════════════════════════════ */
/* カラム行の「カード中心からのYオフセット」を返す。
   実測値 t._2d.colOffsetY があれば優先、無ければ概算。 */
function columnOffsetY(table, colName) {
  const measured = table._2d && table._2d.colOffsetY;
  if (measured && measured[colName] != null) return measured[colName];

  // フォールバック（概算）
  const idx = table.columns.findIndex(c => c.name === colName);
  if (idx < 0) return 0;
  const HEAD = 36, ROW = 22, PAD_TOP = 3;
  return (HEAD + PAD_TOP + idx * ROW + ROW/2) - table._2d.h/2;
}

/* カラム位置同士を結ぶ直角ルート */
function computePath(tableA, tableB, fromCol, toCol) {
  const A = tableA._2d, B = tableB._2d;
  const y1 = A.y + columnOffsetY(tableA, fromCol);
  const y2 = B.y + columnOffsetY(tableB, toCol);

  // 相手が左右どちらにあるかで、接続する辺を決める
  const dx = B.x - A.x;
  let x1, x2;
  if (dx >= 0) {
    x1 = A.x + A.w/2;   // A の右辺
    x2 = B.x - B.w/2;   // B の左辺
  } else {
    x1 = A.x - A.w/2;   // A の左辺
    x2 = B.x + B.w/2;   // B の右辺
  }

  const midX = (x1 + x2) / 2;
  const pathStr = `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;

  return { startX: x1, startY: y1, endX: x2, endY: y2, pathStr };
}

/* ─── 特定テーブルに関係するFK線だけ更新 ─── */
function updateFkLinesFor(tableName) {
  const nameToTable = {};
  state.schema.tables.forEach(t => { nameToTable[t.name] = t; });

  svgPairs.forEach(pair => {
    if (pair.from !== tableName && pair.to !== tableName) return;
    const A = nameToTable[pair.from];
    const B = nameToTable[pair.to];
    if (!A || !B || !A._2d || !B._2d) return;
    const { startX, startY, endX, endY, pathStr } =
      computePath(A, B, pair.fromCol, pair.toCol);
    pair.path.setAttribute('d', pathStr);
    pair.c1.setAttribute('cx', startX);
    pair.c1.setAttribute('cy', startY);
    pair.c2.setAttribute('cx', endX);
    pair.c2.setAttribute('cy', endY);
  });
}

/* ═══════════════════════════════════════════════════════
   2D ER ビルド（async）
   ═══════════════════════════════════════════════════════ */
export async function build2D() {
  console.log('[er2d] build2D ' + VERSION);
  if (!state.schema || !state.schema.tables.length) return;
  const cards = document.getElementById('er2d-cards');
  const svg   = document.getElementById('er2d-svg');
  const viewport = document.getElementById('er2d-viewport');
  if (!cards || !svg) return;

  const savedTransform = viewport ? viewport.style.transform : '';
  if (viewport) viewport.style.transform = 'none';

  cards.innerHTML = '';
  svg.innerHTML   = '';
  svgPairs = [];

  const CARD_W        = 210;
  const CARD_COL_H    = 22;
  const CARD_HEAD_H   = 36;

  const nameToTable = {};
  state.schema.tables.forEach(t => { nameToTable[t.name] = t; });

  const elements = {};
  state.schema.tables.forEach(t => {
    t._2d = {
      w: CARD_W,
      h: CARD_HEAD_H + t.columns.length * CARD_COL_H + 8,
      x: 0, y: 0,
      colOffsetY: {},
    };

    const el = make2DCard(t);
    el.style.left = '0px';
    el.style.top  = '0px';
    el.style.visibility = 'hidden';
    cards.appendChild(el);
    elements[t.name] = el;
  });

  void cards.offsetHeight;

  // カードサイズと、各カラム行の「カード中心からのYオフセット」を実測
  state.schema.tables.forEach(t => {
    const el = elements[t.name];
    const mh = el.offsetHeight;
    const mw = el.offsetWidth;
    if (mh > 0) t._2d.h = mh;
    if (mw > 0) t._2d.w = mw;

    const colsBox = el.querySelector('.er2d-cols');
    const colEls  = colsBox ? colsBox.querySelectorAll('.er2d-col') : [];
    const boxTop  = colsBox ? colsBox.offsetTop : 0;
    const centerY = t._2d.h / 2;

    t._2d.colOffsetY = {};
    t.columns.forEach((c, i) => {
      const colEl = colEls[i];
      if (colEl) {
        // colEl.offsetTop は .er2d-card 基準なので、ヘッダ高さはすでに含まれる
        t._2d.colOffsetY[c.name] =
          colEl.offsetTop + colEl.offsetHeight / 2 - centerY;
      }
    });
  });

  if (viewport) viewport.style.transform = savedTransform;

  // レイアウト
  let bounds;
  if (state.layout2d && state.layout2d.positions) {
    state.schema.tables.forEach(t => {
      const p = state.layout2d.positions[t.name];
      if (p) { t._2d.x = p.x; t._2d.y = p.y; }
    });
    let maxX = 0, maxY = 0;
    state.schema.tables.forEach(t => {
      maxX = Math.max(maxX, t._2d.x + t._2d.w/2);
      maxY = Math.max(maxY, t._2d.y + t._2d.h/2);
    });
    bounds = { width: maxX + 60, height: maxY + 60 };
  } else {
    bounds = computeForceLayout(state.schema.tables);
    state.layout2d = {
      positions: {}, width: bounds.width, height: bounds.height
    };
    state.schema.tables.forEach(t => {
      state.layout2d.positions[t.name] = { x: t._2d.x, y: t._2d.y };
    });
  }

  // 座標適用
  state.schema.tables.forEach(t => {
    const el = elements[t.name];
    el.style.left = (t._2d.x - t._2d.w/2) + 'px';
    el.style.top  = (t._2d.y - t._2d.h/2) + 'px';
    el.style.visibility = '';
  });

  svg.setAttribute('width',  bounds.width  + 'px');
  svg.setAttribute('height', bounds.height + 'px');

  // 直角ルーティング（カラム基準）
  state.schema.tables.forEach(t => {
    t.fks.forEach(fk => {
      const dst = nameToTable[fk.to_table];
      if (!dst || !dst._2d || !t._2d) return;
      if (t.name === dst.name) return;

      const { startX, startY, endX, endY, pathStr } =
        computePath(t, dst, fk.from_col, fk.to_col);

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

      const c1 = document.createElementNS(NS, 'circle');
      c1.setAttribute('cx', startX); c1.setAttribute('cy', startY);
      c1.setAttribute('r', '3');
      c1.setAttribute('fill', '#ffffff');
      c1.setAttribute('stroke', '#9ca3af');
      c1.setAttribute('stroke-width', '1.4');
      svg.appendChild(c1);

      const c2 = document.createElementNS(NS, 'circle');
      c2.setAttribute('cx', endX); c2.setAttribute('cy', endY);
      c2.setAttribute('r', '3');
      c2.setAttribute('fill', '#ffffff');
      c2.setAttribute('stroke', '#9ca3af');
      c2.setAttribute('stroke-width', '1.4');
      svg.appendChild(c2);

      svgPairs.push({
        path, c1, c2,
        from: t.name, to: dst.name,
        fromCol: fk.from_col, toCol: fk.to_col,
      });
    });
  });

  // 保存済みビュー適用 or フィット
  if (state.layout2d && state.layout2d.view &&
      typeof state.layout2d.view.tx === 'number' &&
      typeof state.layout2d.view.ty === 'number' &&
      typeof state.layout2d.view.scale === 'number') {
    er2d.tx = state.layout2d.view.tx;
    er2d.ty = state.layout2d.view.ty;
    er2d.scale = state.layout2d.view.scale;
    apply2DTransform();
  } else {
    fit2D();
  }

  bind2DEvents();
}

/* ═══════════════════════════════════════════════════════
   カード生成（ドラッグ対応）
   ═══════════════════════════════════════════════════════ */
function make2DCard(t) {
  const el = document.createElement('div');
  el.className = 'er2d-card';
  el.dataset.name = t.name;
  el.style.width  = t._2d.w + 'px';

  const col = colorForTable(t.name);
  const fkMap = {};
  t.fks.forEach(fk => { fkMap[fk.from_col] = fk; });

  let html = '';
  html += '<div class="er2d-head" style="border-top-color:' + col.br + '">';
  html += '<span class="er2d-name" title="' + escapeAttr(t.name) + '">' +
          escapeHtml(shortenName(t.name)) + '</span>';
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

  el.addEventListener('mouseenter', () => {
    document.querySelectorAll('#er2d-svg path').forEach(p => {
      const related = (p.dataset.from === t.name || p.dataset.to === t.name);
      p.setAttribute('stroke-opacity', related ? '1' : '0.05');
      p.setAttribute('stroke-width',   related ? '2.2' : '1.4');
      p.setAttribute('stroke',         related ? '#4f46e5' : '#9ca3af');
    });
  });
  el.addEventListener('mouseleave', () => {
    document.querySelectorAll('#er2d-svg path').forEach(p => {
      p.setAttribute('stroke-opacity', '0.55');
      p.setAttribute('stroke-width',   '1.4');
      p.setAttribute('stroke',         '#9ca3af');
    });
  });

  attachCardDrag(el, t);
  return el;
}

/* ═══════════════════════════════════════════════════════
   カードドラッグ
   ═══════════════════════════════════════════════════════ */
function attachCardDrag(el, t) {
  el.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const downX = e.clientX;
    const downY = e.clientY;
    const worldX0 = (e.clientX - er2d.tx) / er2d.scale;
    const worldY0 = (e.clientY - er2d.ty) / er2d.scale;
    const offsetX = worldX0 - t._2d.x;
    const offsetY = worldY0 - t._2d.y;

    let dragging = false;

    const onMove = ev => {
      const dx = ev.clientX - downX;
      const dy = ev.clientY - downY;
      if (!dragging && (dx*dx + dy*dy) > 25) {
        dragging = true;
        el.classList.add('dragging');
        document.body.style.cursor = 'grabbing';
      }
      if (!dragging) return;

      const wx = (ev.clientX - er2d.tx) / er2d.scale;
      const wy = (ev.clientY - er2d.ty) / er2d.scale;
      t._2d.x = wx - offsetX;
      t._2d.y = wy - offsetY;

      el.style.left = (t._2d.x - t._2d.w/2) + 'px';
      el.style.top  = (t._2d.y - t._2d.h/2) + 'px';

      updateFkLinesFor(t.name);
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      el.classList.remove('dragging');
      document.body.style.cursor = '';

      if (dragging) {
        scheduleSave();
      } else {
        api.openTable?.(t.name);
      }
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

/* ═══════════════════════════════════════════════════════
   FIT / TRANSFORM
   ═══════════════════════════════════════════════════════ */
export function fit2D() {
  const cards = document.querySelectorAll('.er2d-card');
  if (!cards.length) return;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  cards.forEach(el => {
    const x = parseFloat(el.style.left);
    const y = parseFloat(el.style.top);
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  });

  const pad = 80;
  const W = maxX - minX + pad * 2;
  const H = maxY - minY + pad * 2;
  const vw = innerWidth - 230;
  const vh = innerHeight - 96;
  const s  = Math.min(vw / W, vh / H, 1.0);
  er2d.scale = s;
  er2d.tx = (vw - W * s) / 2 - (minX - pad) * s;
  er2d.ty = (vh - H * s) / 2 - (minY - pad) * s;
  apply2DTransform();
}

function apply2DTransform() {
  const vp = document.getElementById('er2d-viewport');
  if (!vp) return;
  vp.style.transform = 'translate(' + er2d.tx + 'px,' + er2d.ty +
                       'px) scale(' + er2d.scale + ')';
}

/* ═══════════════════════════════════════════════════════
   VIEWPORT EVENTS
   ═══════════════════════════════════════════════════════ */
function bind2DEvents() {
  const view = document.getElementById('er2d');
  if (!view || view.dataset.bound) return;
  view.dataset.bound = '1';

  view.addEventListener('mousedown', e => {
    if (e.target.closest('.er2d-card')) return;
    er2d.dragging  = true;
    er2d.dragStart = {x: e.clientX, y: e.clientY, tx: er2d.tx, ty: er2d.ty};
    view.classList.add('dragging');
  });
  addEventListener('mousemove', e => {
    if (!er2d.dragging || !er2d.dragStart) return;
    er2d.tx = er2d.dragStart.tx + (e.clientX - er2d.dragStart.x);
    er2d.ty = er2d.dragStart.ty + (e.clientY - er2d.dragStart.y);
    apply2DTransform();
  });
  addEventListener('mouseup', () => {
    if (!er2d.dragging) return;
    er2d.dragging  = false;
    er2d.dragStart = null;
    document.getElementById('er2d').classList.remove('dragging');
    scheduleSave();
    setTimeout(() => { er2d.dragging = false; }, 50);
  });

  let zoomTO = null;
  const viewport = document.getElementById('er2d-viewport');
  view.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = view.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const oldScale = er2d.scale;
    const factor   = e.deltaY < 0 ? 1.15 : 1/1.15;
    const newScale = Math.max(0.15, Math.min(3, oldScale * factor));
    er2d.tx = mx - (mx - er2d.tx) * (newScale / oldScale);
    er2d.ty = my - (my - er2d.ty) * (newScale / oldScale);
    er2d.scale = newScale;
    if (viewport) viewport.classList.add('zooming');
    apply2DTransform();
    clearTimeout(zoomTO);
    zoomTO = setTimeout(() => {
      if (viewport) viewport.classList.remove('zooming');
      er2d.tx = Math.round(er2d.tx * 100) / 100;
      er2d.ty = Math.round(er2d.ty * 100) / 100;
      apply2DTransform();
      scheduleSave();
    }, 180);
  }, {passive: false});
}

/* ═══════════════════════════════════════════════════════
   VIEW MODE
   ═══════════════════════════════════════════════════════ */
export function setViewMode(mode) {
  er2d.mode = mode;
  document.querySelectorAll('#view-toggle button').forEach(b => {
    b.classList.toggle('active', b.dataset.view === mode);
  });
  const canvas = document.getElementById('c');
  const er2dEl = document.getElementById('er2d');
  const hint   = document.getElementById('hint');
  if (mode === '2d') {
    canvas.style.display = 'none';
    er2dEl.classList.add('show');
    if (hint) hint.style.display = 'none';
    build2D();
  } else {
    canvas.style.display = '';
    er2dEl.classList.remove('show');
    if (hint && !state.currentTable) hint.style.display = '';
  }
}