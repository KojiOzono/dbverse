// main.js — DBVERSE 全体統括
console.log('[DBVERSE] === main.js loaded ===');

import { setupThree, buildER, fitER, fitER3D, tweenCamera, animate } from './er3d.js';
import { build2D, setViewMode, computeForceLayout } from './er2d.js';

export const CONFIG = { shortenTableNames: "auto" };
export const TRUNCATE_LIMIT = 50;

/* ─── モジュール間関数呼び出し用 ─── */
export const api = {};

/* ─── 共有状態 ─── */
export const state = {
  schema: null, currentTable: null,
  layout2d: null,                  // 2D/3D 共有レイアウト
  erCards: [], fkLines: [], hoveredCard: null,
  shortenNames: true,
  shortenPrefixes: [],
  shortenTableNames: "auto",
  scene: null, camera: null, renderer: null, composer: null,
  controls: null, raycaster: null, clock: null, erGroup: null,
  pointer: null, camTween: null, pointerDownPos: null,
};
export const dv = {
  offset: 0, limit: 100, sort: null, dir: 'asc', filter: '',
  hidden: new Set(), widths: new Map(), dense: false, zebra: false,
  lastData: null, selected: new Set(), lastAnchor: null,
  loading: false, tab: 'data',
};
export const er2d = {
  mode: '3d', tx: 0, ty: 0, scale: 1,
  dragging: false, dragStart: null,
};
export const sql = {
  mode: 'sql', history: [], histIdx: -1, histDraft: null, lastQResult: null,
};

/* ─── ユーティリティ ─── */
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}
export function escapeAttr(s) { return escapeHtml(s); }
export function qiJs(n) { return '"' + String(n).replace(/"/g, '""') + '"'; }
export function truncate(s, n) {
  s = String(s); return s.length > n ? s.slice(0, n-1) + '…' : s;
}
export function toast(msg, kind) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.className = 'show ' + (kind || '');
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = kind || ''; }, 1800);
}
export function shortType(t) {
  t = String(t).toUpperCase();
  if (t.startsWith('CHARACTER VARYING')) return 'VARCHAR';
  if (t.startsWith('TIMESTAMP'))  return 'TS';
  if (t.startsWith('DOUBLE'))     return 'DBL';
  if (t.startsWith('BIGINT'))     return 'BIGINT';
  if (t.startsWith('INTEGER'))    return 'INT';
  if (t.startsWith('BOOLEAN'))    return 'BOOL';
  return t;
}
export function colorForTable(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const p = [
    {bg:'#0a2a3e', c:'#4de8ff'},
    {bg:'#0a2e1a', c:'#7dff9b'},
    {bg:'#1a0a2e', c:'#a06bff'},
    {bg:'#2e2410', c:'#ffd166'},
    {bg:'#0a2030', c:'#66ddff'},
    {bg:'#2e0a1a', c:'#ff6b8b'},
  ];
  const e = p[h % p.length];
  return {bg:e.bg, br:e.c, fg:e.c};
}

export function groupKeyForTable(name) {
  const i = name.indexOf('_');
  return i < 0 ? '(no prefix)' : name.slice(0, i);
}

/* ─── スキーマ（構造のみ） ─── */
export async function loadSchema() {
  const r = await fetch('/api/schema');
  state.schema = await r.json();
  if (state.schema.error) throw new Error(state.schema.error);
  document.getElementById('sidebar-db').innerHTML =
    'DB <b>' + escapeHtml(state.schema.name) + '</b>';
  document.getElementById('table-count').textContent =
    String(state.schema.tables.length);
  renderTableList();
  // 件数は非同期で取得（fire-and-forget）
  loadCounts();
}

/* ─── 件数（別API・非同期） ─── */
let countsLoading = false;
export async function loadCounts(force = false) {
  if (!state.schema) return;
  if (countsLoading && !force) return;
  countsLoading = true;
  try {
    const r = await fetch('/api/counts');
    if (!r.ok) return;
    const { counts } = await r.json();
    if (!state.schema || !counts) return;
    state.schema.tables.forEach(t => {
      t.rows = counts[t.name] ?? null;
    });

    // サイドバー再描画
    renderTableList();
    // テーブル一覧の active を復元
    if (state.currentTable) {
      document.querySelectorAll('.titem').forEach(x => {
        x.classList.toggle('act', x.dataset.name === state.currentTable);
      });
    }

    // ER再構築（カードの rows 表示更新）
    if (state.erCards.length > 0) {
      buildER();
      if (er2d.mode === '2d') build2D();
    }

    // ヘッダ更新
    updateHeader();

    document.dispatchEvent(new CustomEvent('counts-ready'));
  } catch (e) {
    console.warn('counts fetch failed', e);
  } finally {
    countsLoading = false;
  }
}

export function computeShortenPrefixes() {
  return (state.shortenPrefixes || [])
    .slice()
    .sort((a, b) => b.length - a.length);
}

export function shortenName(name) {
  if (!state.shortenNames) return name;
  if (state.shortenTableNames === "always") {
    const i = name.indexOf('_');
    return i >= 0 ? name.slice(i + 1) : name;
  }
  const prefixes = computeShortenPrefixes();
  for (let i = 0; i < prefixes.length; i++) {
    if (name.indexOf(prefixes[i]) === 0) return name.slice(prefixes[i].length);
  }
  return name;
}

export function renderTableList() {
  const el = document.getElementById('tlist-body');
  el.innerHTML = state.schema.tables.map(t => {
    const short = shortenName(t.name);
    const cnt = (t.rows == null) ? '—' : t.rows;
    return '<div class="titem" data-name="' + escapeAttr(t.name) +
      '" data-drag-type="table" data-drag-value="' + escapeAttr(t.name) + '"' +
      ' draggable="true"' +
      ' title="' + escapeAttr(t.name) + '">' +
      '<span class="n">' + escapeHtml(short) + '</span>' +
      '<span class="c">' + cnt + '</span>' +
      (t.fks.length ? '<span class="fk">↗</span>' : '') +
      '</div>';
  }).join('');
  el.querySelectorAll('.titem').forEach(x => {
    x.addEventListener('click', () => api.openTable?.(x.dataset.name));
  });
}

/* ─── テーブル項目（カラム一覧） ─── */
export function renderColumnList(name) {
  const el = document.getElementById('clist-body');
  const cntEl = document.getElementById('col-count');
  if (!el) return;

  if (!name || !state.schema) {
    el.innerHTML = '<div class="empty">テーブルを選択してください</div>';
    if (cntEl) cntEl.textContent = '';
    return;
  }
  const t = state.schema.tables.find(x => x.name === name);
  if (!t) {
    el.innerHTML = '<div class="empty">テーブルが見つかりません</div>';
    if (cntEl) cntEl.textContent = '';
    return;
  }

  const fkMap = {};
  t.fks.forEach(fk => { fkMap[fk.from_col] = fk; });

  el.innerHTML = t.columns.map(c => {
    const isPK = c.pk;
    const isFK = !!fkMap[c.name];
    let cls = 'citem';
    if (isPK) cls += ' is-pk';
    if (isFK && !isPK) cls += ' is-fk';
    const badge =
      '<span class="bdg">' +
      (isPK ? '<span class="b pk">PK</span>' : '') +
      (isFK && !isPK ? '<span class="b fk">FK</span>' : '') +
      '</span>';
    return '<div class="' + cls + '"' +
      ' data-drag-type="column" data-drag-value="' + escapeAttr(c.name) + '"' +
      ' draggable="true"' +
      ' title="' + escapeAttr(c.name + ' : ' + (c.type || '')) + '">' +
      badge +
      '<span class="nm">' + escapeHtml(c.name) + '</span>' +
      '<span class="ty">' + escapeHtml(shortType(c.type || '')) + '</span>' +
      '</div>';
  }).join('');

  if (cntEl) cntEl.textContent = String(t.columns.length);
}

export function setActiveItem(name) {
  document.querySelectorAll('.titem').forEach(x => {
    x.classList.toggle('act', x.dataset.name === name);
  });
  renderColumnList(name);
}

export function updateHeader() {
  const nameEl = document.getElementById('dv-name');
  const metaEl = document.getElementById('dv-meta');
  if (dv.tab === 'result' && sql.lastQResult) {
    nameEl.textContent = 'クエリ結果';
    metaEl.innerHTML = '<b>' + sql.lastQResult.rows.length + '</b> 行';
  } else if (state.currentTable) {
    nameEl.textContent = state.currentTable;
    let total = null;
    if (dv.lastData && dv.lastData.name === state.currentTable) total = dv.lastData.total;
    else {
      const t = state.schema.tables.find(x => x.name === state.currentTable);
      if (t) total = t.rows;
    }
    const totalStr = (total == null) ? '—' : total;
    const filtered = dv.filter ? ' <span style="color:#5a7c96">(絞り込み中)</span>' : '';
    metaEl.innerHTML = '<b>' + totalStr + '</b> 行' + filtered;
  } else {
    nameEl.textContent = '—';
    metaEl.innerHTML = '';
  }
}

/* ─── テーブル名短縮トグル ─── */
(function bindShortenToggle() {
  const btn = document.getElementById('btn-shorten');
  if (!btn) return;
  btn.classList.toggle('active', state.shortenNames);
  btn.addEventListener('click', e => {
    e.stopPropagation();
    state.shortenNames = !state.shortenNames;
    btn.classList.toggle('active', state.shortenNames);
    renderTableList();
    if (state.currentTable) {
      document.querySelectorAll('.titem').forEach(x => {
        x.classList.toggle('act', x.dataset.name === state.currentTable);
      });
    }
  });
})();

/* ─── コンテキストメニュー ─── */
const ctxEl = document.getElementById('ctx');
let ctxCleanup = null;

export function closeCtx() {
  ctxEl.classList.remove('open');
  if (ctxCleanup) { ctxCleanup(); ctxCleanup = null; }
}

export function showCtx(x, y, items) {
  closeCtx();
  ctxEl.innerHTML = items.map((it, i) => {
    if (it.sep)   return '<div class="sep"></div>';
    if (it.label) return '<div class="lbl">' + escapeHtml(it.label) + '</div>';
    return '<div class="ci ' + (it.danger?'danger':'') + '" data-i="' + i + '">' +
      '<span>' + escapeHtml(it.text) + '</span>' +
      (it.k ? '<span class="k">' + escapeHtml(it.k) + '</span>' : '') +
      '</div>';
  }).join('');
  ctxEl.classList.add('open');
  const w = ctxEl.offsetWidth, h = ctxEl.offsetHeight;
  ctxEl.style.left = Math.min(x, innerWidth - w - 8) + 'px';
  ctxEl.style.top  = Math.min(y, innerHeight - h - 8) + 'px';
  ctxEl.querySelectorAll('.ci').forEach(el => {
    el.addEventListener('click', ev => {
      ev.stopPropagation();
      const it = items[parseInt(el.dataset.i)];
      closeCtx();
      if (it.fn) it.fn();
    });
  });
  const onDoc = ev => { if (!ctxEl.contains(ev.target)) closeCtx(); };
  setTimeout(() => document.addEventListener('mousedown', onDoc, true), 0);
  const onKey = ev => { if (ev.key === 'Escape') closeCtx(); };
  document.addEventListener('keydown', onKey, true);
  ctxCleanup = () => {
    document.removeEventListener('mousedown', onDoc, true);
    document.removeEventListener('keydown', onKey, true);
  };
}

/* ─── スキーマ再読込 ─── */
export async function refreshSchema() {
  await loadSchema();
  buildER();
  if (er2d.mode === '2d') build2D();
  state.erCards.forEach(c => { c.fadeTarget = state.currentTable ? 0.06 : 1; });
}

/* ─── グローバルキー ─── */
function onKeyDown(e) {
  if (e.target.matches('input,textarea,select')) return;
  if (e.key === 'Escape') {
    const el = document.getElementById('dataview');
    if (el.classList.contains('open')) api.closeTable?.();
  }
  if (e.key === 'f' || e.key === 'F') {
    if (!state.currentTable && er2d.mode === '3d') {
      const c = fitER3D(); tweenCamera(c.pos, c.target, 500);
    }
  }
  if (!state.currentTable) return;
  const k = e.key.toLowerCase();
  if (k === 'd') { e.preventDefault(); api.toggleDense?.(); }
  if (k === 'z') { e.preventDefault(); api.toggleZebra?.(); }
  if (k === 'r') { e.preventDefault(); api.loadTableData?.(); }
  if ((e.ctrlKey||e.metaKey) && e.key === 'a') {
    e.preventDefault(); api.selectAll?.();
  }
  if ((e.ctrlKey||e.metaKey) && e.key === 'c' && dv.selected.size) {
    e.preventDefault(); api.copySelected?.('tsv');
  }
}
addEventListener('keydown', onKeyDown);

/* ─── ビュー切替ボタン ─── */
document.querySelectorAll('#view-toggle button').forEach(b => {
  b.addEventListener('click', () => {
    const el = document.getElementById('dataview');
    if (el.classList.contains('open')) {
      api.closeTable?.();
    }
    setViewMode(b.dataset.view);
  });
});

/* ─── 2D/3D 共有レイアウトの初期化 ─── */
async function initLayout() {
  const CARD_W = 210, CARD_COL_H = 22, CARD_HEAD_H = 36, CARD_MAX_COLS = 30;
  state.schema.tables.forEach(t => {
    const shown = Math.min(t.columns.length, CARD_MAX_COLS);
    const extra = t.columns.length > CARD_MAX_COLS ? 1 : 0;
    t._2d = {
      w: CARD_W,
      h: CARD_HEAD_H + (shown + extra) * CARD_COL_H + 8,
      x: 0, y: 0,
    };
  });

  // サーバーから保存済みを取得
  let saved = {};
  try {
    saved = await fetch('/api/layout2d').then(r => r.json());
  } catch (e) {}

  state.layout2d = { positions: {}, width: 0, height: 0 };

  // 保存済み座標を適用
  state.schema.tables.forEach(t => {
    const p = saved.positions && saved.positions[t.name];
    if (p && typeof p.x === 'number' && typeof p.y === 'number') {
      t._2d.x = p.x;
      t._2d.y = p.y;
      state.layout2d.positions[t.name] = { x: p.x, y: p.y };
    }
  });

  // 座標未設定のテーブルがあれば力指向で計算
  const missing = state.schema.tables.filter(
    t => !state.layout2d.positions[t.name]);
  if (missing.length) {
    computeForceLayout(state.schema.tables);
    state.schema.tables.forEach(t => {
      state.layout2d.positions[t.name] = { x: t._2d.x, y: t._2d.y };
    });
  }

  // bounds 計算
  let maxX = 0, maxY = 0;
  state.schema.tables.forEach(t => {
    maxX = Math.max(maxX, t._2d.x + t._2d.w / 2);
    maxY = Math.max(maxY, t._2d.y + t._2d.h / 2);
  });
  state.layout2d.width  = maxX + 60;
  state.layout2d.height = maxY + 60;

  saveLayoutNow();
}

export async function saveLayoutNow() {
  if (!state.layout2d) return;
  try {
    await fetch('/api/layout2d', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        positions: state.layout2d.positions,
        view: state.layout2d.view || null,
      }),
    });
  } catch (e) {}
}

/* ─── 起動 ─── */
async function boot() {
  setupThree();
  animate();

  // 設定取得
  try {
    const cfg = await fetch('/api/config').then(r => r.json());
    if (Array.isArray(cfg.shorten_prefixes)) {
      state.shortenPrefixes = cfg.shorten_prefixes;
    }
    if (cfg.shorten_table_names) {
      state.shortenTableNames = cfg.shorten_table_names;
    }
    state.shortenNames = state.shortenTableNames !== "never";
  } catch (e) {
    console.warn('[config] fetch failed, using defaults:', e);
  }

  // スキーマだけ取得して、すぐブート画面を閉じる
  try {
    await loadSchema();
  } catch (e) {
    console.error('起動失敗:', e);
    toast('起動失敗: ' + e.message, 'err');
    document.getElementById('boot').classList.add('hide');
    return;
  }

  document.getElementById('boot').classList.add('hide');
  document.getElementById('sqlinput').focus();

  // ここから先はバックグラウンド（画面はもう見えている）
  (async () => {
    try {
      await initLayout();
      buildER();

      const cTop = fitER();
      state.camera.position.copy(cTop.pos);
      state.controls.target.copy(cTop.target);

      setTimeout(() => {
        const c3d = fitER3D();
        tweenCamera(c3d.pos, c3d.target, 1400);
      }, 300);
    } catch (e) {
      console.error('ER初期化失敗:', e);
    }
  })();

  // dataview.js の読み込み（これも待たなくてOK）
  try {
    const m = await import('./dataview.js');
    api.openTable     = m.openTable;
    api.closeTable    = m.closeTable;
    api.loadTableData = m.loadTableData;
    api.toggleDense   = m.toggleDense;
    api.toggleZebra   = m.toggleZebra;
    api.selectAll     = m.selectAll;
    api.copySelected  = m.copySelected;
  } catch (e) {
    console.error('dataview.js 読み込み失敗:', e);
  }
}
boot();