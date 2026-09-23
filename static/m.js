/* DBVERSE mobile — 画面遷移 + API + SSE + ER図(2D/3D PC品質) v7 */

import * as M_ER2D from './m-er2d.js';
import * as M_ER3D from './m-er3d.js';

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const state = {
  view: 'menu',
  schema: null,
  currentTable: null,
  offset: 0,
  limit: 100,
  filter: '',
  total: 0,
};

const viewTitles = {
  menu:   'DBVERSE',
  tables: 'テーブル一覧',
  data:   'データ',
  er:     'ER図',
  ask:    '自然言語で質問',
};

// ─── トースト ─────────────────────────
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

// ─── 画面遷移 ─────────────────────────
function showView(name) {
  state.view = name;
  $$('.view').forEach(v => v.classList.toggle('active', v.dataset.view === name));
  $('#hdr-title').textContent = viewTitles[name] || 'DBVERSE';
  $('#hdr-sub').textContent = name === 'data' ? (state.currentTable || '') : '';
  $('#btn-back').disabled = (name === 'menu');
}

$('#btn-back').addEventListener('click', () => {
  if (state.view === 'data')        showView('tables');
  else if (state.view === 'tables') showView('menu');
  else if (state.view === 'ask')    showView('menu');
  else if (state.view === 'er')     showView('menu');
  else                              showView('menu');
});

// ─── スキーマ ─────────────────────────
async function loadSchema(force = false) {
  if (state.schema && !force) return state.schema;
  const r = await fetch('/api/schema');
  if (!r.ok) throw new Error('schema fetch failed');
  state.schema = await r.json();
  return state.schema;
}

async function initMenu() {
  try {
    const s = await loadSchema();
    $('#menu-table-count').textContent = `${s.tables.length} テーブル`;
    $('#db-info').textContent = s.name || '';
  } catch (e) {
    toast('スキーマ取得失敗: ' + e.message);
  }
}

// ═══════════════════════════════════════════════════════
// ER図 初期化（2D / 3D 統合）
// ═══════════════════════════════════════════════════════
const ER3D = { currentMode: '3d' };

function openTableFromER(name) {
  state.currentTable = name;
  state.offset = 0;
  state.filter = '';
  $('#data-filter').value = '';
  showView('data');
  loadTableData();
}

async function initER2D() {
  const svg = document.getElementById('er-svg');
  const cardsEl = document.getElementById('er2d-cards');
  const viewport = document.getElementById('er-viewport-inner');
  if (!svg || !cardsEl || !viewport) throw new Error('ER DOM not found');

  const schema = await loadSchema();
  let layout = {};
  try {
    layout = await fetch('/api/layout2d').then(r => r.json());
  } catch (e) {
    console.warn('layout2d fetch failed:', e);
  }

  await M_ER2D.init(svg, cardsEl, viewport, schema, layout, openTableFromER);
}

function fitER() {
  if (M_ER2D.isReady()) M_ER2D.fit();
}
function resetER() {
  if (M_ER2D.isReady()) M_ER2D.reset();
}

async function setERMode(mode) {
  ER3D.currentMode = mode;
  $$('#er-view-toggle button').forEach(b => {
    b.classList.toggle('active', b.dataset.erview === mode);
  });

  const vp2d = document.getElementById('er-viewport');
  const vp3d = document.getElementById('er3d-viewport');

  if (mode === '3d') {
    vp2d.style.display = 'none';
    vp3d.style.display = 'block';

    const canvas = document.getElementById('er3d-canvas');

    try {
      const schema = await loadSchema();
      let layout = {};
      try {
        layout = await fetch('/api/layout2d').then(r => r.json());
      } catch {}

      await M_ER3D.init(canvas, schema, layout, openTableFromER);
      M_ER3D.doFit(500);
    } catch (e) {
      console.error('3D init failed:', e);
      toast('3D表示失敗: ' + e.message);
      vp2d.style.display = 'block';
      vp3d.style.display = 'none';
      // 2D がまだなら初期化してからフォールバック
      if (!M_ER2D.isReady()) {
        try { await initER2D(); } catch {}
      }
      setERMode('2d');
    }
  } else {
    vp3d.style.display = 'none';
    vp2d.style.display = 'block';
    // 2D 未初期化なら初期化
    if (!M_ER2D.isReady()) {
      try { await initER2D(); } catch (e) {
        console.error('2D init failed:', e);
      }
    }
    setTimeout(() => {
      if (M_ER2D.isReady()) M_ER2D.fit();
    }, 50);
  }
}

// ─── メニュー ─────────────────────────
$$('.menu-item').forEach(btn => {
  btn.addEventListener('click', async () => {
    const goto = btn.dataset.goto;
    if (goto === 'tables') {
      await renderTableList($('#table-filter').value);
      showView('tables');
    } else if (goto === 'ask') {
      showView('ask');
    } else if (goto === 'er') {
      showView('er');
      try {
        // 2D を裏で初期化（トグル切替のため）
        if (!M_ER2D.isReady()) {
          initER2D().catch(e => console.warn('2D init failed:', e));
        }
        // 初回は 3D を表示
        await setERMode('3d');
      } catch (e) {
        console.error('ER init failed:', e);
        toast('ER表示失敗: ' + e.message);
      }
    }
  });
});

// ─── 2D/3D切替ボタン ──────────────────
$$('#er-view-toggle button').forEach(btn => {
  btn.addEventListener('click', () => setERMode(btn.dataset.erview));
});

// ─── ERツールバー ─────────────────────
document.getElementById('er-fit')?.addEventListener('click', () => {
  if (ER3D.currentMode === '3d') M_ER3D.doFit(500);
  else fitER();
});
document.getElementById('er-reset')?.addEventListener('click', () => {
  if (ER3D.currentMode === '3d') {
    M_ER3D.doFit(500);
  } else {
    resetER();
  }
});

// リサイズで3D追従
window.addEventListener('resize', () => {
  if (ER3D.currentMode === '3d' && M_ER3D.isReady()) M_ER3D.resize();
});

// ─── テーブル一覧 ─────────────────────
async function renderTableList(filter = '') {
  const list = $('#table-list');
  list.innerHTML = '<div style="padding:20px;color:#8b949e;text-align:center">読み込み中…</div>';
  try {
    const s = await loadSchema();
    const q = filter.trim().toLowerCase();
    const items = s.tables.filter(t => !q || t.name.toLowerCase().includes(q));
    if (!items.length) {
      list.innerHTML = '<div style="padding:20px;color:#8b949e;text-align:center">該当なし</div>';
      return;
    }
    list.innerHTML = items.map(t => `
      <div class="titem" data-table="${escapeAttr(t.name)}">
        <span class="name">${escapeHtml(t.name)}</span>
        <span class="rows">${t.rows}</span>
      </div>
    `).join('');
  } catch (e) {
    list.innerHTML = `<div style="padding:20px;color:#e5534b">${escapeHtml(e.message)}</div>`;
  }
}

$('#table-filter').addEventListener('input', (e) => {
  renderTableList(e.target.value);
});

$('#table-list').addEventListener('click', (e) => {
  const item = e.target.closest('.titem');
  if (!item) return;
  state.currentTable = item.dataset.table;
  state.offset = 0;
  state.filter = '';
  $('#data-filter').value = '';
  showView('data');
  loadTableData();
});

// ─── データ閲覧 ───────────────────────
async function loadTableData() {
  if (!state.currentTable) return;
  const body = $('#data-body');
  body.innerHTML = '<div style="padding:20px;text-align:center;color:#8b949e">読み込み中…</div>';
  $('#data-meta').textContent = '';
  try {
    const r = await fetch('/api/table', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: state.currentTable,
        limit: state.limit,
        offset: state.offset,
        filter: state.filter,
      }),
    });
    const data = await r.json();
    if (data.error) throw new Error(data.error);
    state.total = data.total;
    renderDataTable(data);
    updateFooter();
  } catch (e) {
    body.innerHTML = `<div style="padding:20px;color:#e5534b">${escapeHtml(e.message)}</div>`;
  }
}

function renderDataTable(data) {
  const { columns, rows, total } = data;
  const body = $('#data-body');
  if (!rows.length) {
    body.innerHTML = '<div style="padding:20px;text-align:center;color:#8b949e">データなし</div>';
    return;
  }
  let html = '<table><thead><tr>';
  for (const c of columns) html += `<th>${escapeHtml(c)}</th>`;
  html += '</tr></thead><tbody>';
  for (const row of rows) {
    html += '<tr>';
    for (let i = 0; i < row.length; i++) {
      const v = row[i];
      if (v === null || v === undefined) {
        html += '<td class="null">NULL</td>';
      } else {
        const s = String(v);
        const disp = s.length > 120 ? s.slice(0, 120) + '…' : s;
        html += `<td data-copy="${escapeAttr(s)}">${escapeHtml(disp)}</td>`;
      }
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  body.innerHTML = html;

  $('#data-meta').textContent =
    `${total} 行中 ${state.offset + 1}–${Math.min(state.offset + rows.length, total)}`;
}

$('#data-body').addEventListener('click', async (e) => {
  const td = e.target.closest('td[data-copy]');
  if (!td) return;
  const text = td.dataset.copy;
  try {
    await navigator.clipboard.writeText(text);
    toast('コピー: ' + text.slice(0, 40));
  } catch {
    toast('コピー失敗');
  }
});

function updateFooter() {
  const start = state.total ? state.offset + 1 : 0;
  const end = Math.min(state.offset + state.limit, state.total);
  $('#pg-info').textContent = `${start}–${end} / ${state.total}`;
  const atStart = state.offset === 0;
  const atEnd = end >= state.total;
  $('#pg-first').disabled = atStart;
  $('#pg-prev').disabled  = atStart;
  $('#pg-next').disabled  = atEnd;
  $('#pg-last').disabled  = atEnd;
}

$('#pg-first').addEventListener('click', () => { state.offset = 0; loadTableData(); });
$('#pg-prev').addEventListener('click', () => {
  state.offset = Math.max(0, state.offset - state.limit);
  loadTableData();
});
$('#pg-next').addEventListener('click', () => {
  state.offset += state.limit;
  loadTableData();
});
$('#pg-last').addEventListener('click', () => {
  state.offset = Math.max(0, Math.floor((state.total - 1) / state.limit) * state.limit);
  loadTableData();
});
$('#data-reload').addEventListener('click', loadTableData);

let filterTimer;
$('#data-filter').addEventListener('input', (e) => {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(() => {
    state.filter = e.target.value.trim();
    state.offset = 0;
    loadTableData();
  }, 400);
});

// ═══════════════════════════════════════════════════════
// 自然言語質問（SSE）
// ═══════════════════════════════════════════════════════
const askInput = $('#ask-input');
const askRun = $('#ask-run');
const askLog = $('#ask-log');
const askInputClear = $('#ask-input-clear');

if (askInputClear) {
  askInputClear.addEventListener('click', () => {
    askInput.value = '';
    askInput.focus();
  });
}

let currentES = null;
let currentTimeout = null;
const SSE_TIMEOUT_MS = 60000;

askRun.addEventListener('click', () => {
  if (askRun.classList.contains('running')) {
    cancelCurrentAsk();
    toast('キャンセルしました');
    return;
  }
  const q = askInput.value.trim();
  if (!q) { toast('質問を入力してください'); return; }
  runAsk(q);
});

function cancelCurrentAsk() {
  if (currentES) { try { currentES.close(); } catch {} currentES = null; }
  if (currentTimeout) { clearTimeout(currentTimeout); currentTimeout = null; }
  askRun.disabled = false;
  askRun.textContent = '質問する';
  askRun.classList.remove('running');
}

function runAsk(question) {
  if (currentES) { try { currentES.close(); } catch {} currentES = null; }
  if (currentTimeout) { clearTimeout(currentTimeout); currentTimeout = null; }

  askRun.disabled = true;
  askRun.textContent = '実行中… (タップで中止)';
  askRun.classList.add('running');

  const item = document.createElement('div');
  item.className = 'ask-item';
  item.innerHTML = `
    <div class="ask-q"></div>
    <div class="ask-status">考え中…</div>
    <div class="ask-elapsed" style="color:#8b949e;font-size:11px;margin-top:4px"></div>
    <div class="ask-sql" style="display:none"></div>
    <div class="ask-result"></div>
    <div class="ask-err" style="display:none"></div>
  `;
  item.querySelector('.ask-q').textContent = question;
  askLog.prepend(item);
  askLog.scrollTop = 0;

  const statusEl  = item.querySelector('.ask-status');
  const elapsedEl = item.querySelector('.ask-elapsed');
  const sqlEl     = item.querySelector('.ask-sql');
  const resultEl  = item.querySelector('.ask-result');
  const errEl     = item.querySelector('.ask-err');

  const t0 = Date.now();
  const tick = setInterval(() => {
    const sec = ((Date.now() - t0) / 1000).toFixed(1);
    elapsedEl.textContent = `${sec}s`;
  }, 100);

  let closed = false;
  const finish = (errMsg) => {
    if (closed) return;
    closed = true;
    clearInterval(tick);
    if (currentTimeout) { clearTimeout(currentTimeout); currentTimeout = null; }
    if (currentES) { try { currentES.close(); } catch {} currentES = null; }
    askRun.disabled = false;
    askRun.textContent = '質問する';
    askRun.classList.remove('running');
    if (errMsg) {
      errEl.style.display = 'block';
      errEl.textContent = errMsg;
      statusEl.style.display = 'none';
    }
  };

  const url = '/api/ask_sse?q=' + encodeURIComponent(question);
  const es = new EventSource(url);
  currentES = es;

  currentTimeout = setTimeout(() => {
    finish(`タイムアウト（${SSE_TIMEOUT_MS / 1000}秒）`);
  }, SSE_TIMEOUT_MS);

  es.addEventListener('open', () => {
    statusEl.textContent = 'LLMがSQLを生成中…';
  });
  es.addEventListener('token', () => {
    statusEl.textContent = 'LLMがSQLを生成中…';
  });
  es.addEventListener('sql', (e) => {
    try {
      const d = JSON.parse(e.data);
      sqlEl.style.display = 'block';
      sqlEl.textContent = d.sql;
      statusEl.textContent = 'SQL実行中…';
    } catch {}
  });

  es.addEventListener('done', (e) => {
    try {
      const d = JSON.parse(e.data);
      if (d.error) {
        finish(d.error);
        if (d.raw) {
          const raw = document.createElement('pre');
          raw.style.cssText = 'color:#8b949e;font-size:11px;margin-top:8px;white-space:pre-wrap;word-break:break-all';
          raw.textContent = d.raw;
          item.appendChild(raw);
        }
        return;
      }
      finish();
      statusEl.style.display = 'none';
      elapsedEl.style.display = 'none';
      if (d.sql) {
        sqlEl.style.display = 'block';
        sqlEl.textContent = d.sql;
      }
      if (d.columns && d.rows) {
        resultEl.innerHTML = buildResultTable(d.columns, d.rows);
      }
      if (d.elapsed_ms) {
        const t = document.createElement('div');
        t.className = 'ask-time';
        t.textContent = `${d.elapsed_ms}ms`;
        resultEl.appendChild(t);
      }
    } catch (err) {
      finish('パース失敗');
    }
  });

  es.addEventListener('error', () => {
    if (closed) return;
    finish('接続エラー（通信を確認してください）');
  });
}

function buildResultTable(columns, rows) {
  if (!rows || !rows.length) {
    return '<div style="color:#8b949e;font-size:12px">結果なし</div>';
  }
  let html = '<table><thead><tr>';
  for (const c of columns) html += `<th>${escapeHtml(c)}</th>`;
  html += '</tr></thead><tbody>';
  const max = Math.min(rows.length, 100);
  for (let i = 0; i < max; i++) {
    html += '<tr>';
    for (const v of rows[i]) {
      if (v === null || v === undefined) {
        html += '<td style="color:#8b949e;font-style:italic">NULL</td>';
      } else {
        html += `<td>${escapeHtml(String(v))}</td>`;
      }
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  if (rows.length > max) {
    html += `<div style="color:#8b949e;font-size:11px;margin-top:6px">他 ${rows.length - max} 行</div>`;
  }
  return html;
}

// ─── バックグラウンド復帰時の掃除 ─────
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && currentES) {
    if (currentES.readyState === EventSource.CLOSED) {
      cancelCurrentAsk();
    }
  }
});

// ─── ヘルパ ───────────────────────────
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}
function escapeAttr(s) { return escapeHtml(s); }

// ─── 初期化 ───────────────────────────
(async () => {
  await initMenu();
  showView('menu');
})();