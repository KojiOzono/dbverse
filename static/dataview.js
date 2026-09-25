// dataview.js — データビュー / SQLバー / 自然言語 / セルビュー
import { format as formatSql }
  from 'https://cdn.jsdelivr.net/npm/sql-formatter@15.4.1/+esm';

import {
  state, dv, er2d, sql, api,
  escapeHtml, escapeAttr, qiJs, toast, shortType,
  updateHeader, closeCtx, showCtx, setActiveItem, refreshSchema,
} from './main.js';

const sqlinput   = document.getElementById('sqlinput');
const askinput   = document.getElementById('askinput');
const sqlbar     = document.getElementById('sqlbar');
const sqlstatus  = document.getElementById('sqlstatus');
const sqlhistEl  = document.getElementById('sqlhist');
const resultPaneBody = document.getElementById('dv-result-body');
const selectBtn  = document.getElementById('sql-select');

function switchDvTab(view) {
  dv.tab = view;
  document.querySelectorAll('#dv-tabs .vtab').forEach(t => {
    t.classList.toggle('active', t.dataset.view === view);
  });
  document.querySelectorAll('#dv-panes .dvpane').forEach(p => {
    p.classList.toggle('active', p.id === 'pane-' + view);
  });
  document.getElementById('foot-data').style.display =
    view === 'data' ? 'flex' : 'none';
  document.getElementById('foot-result').style.display =
    view === 'result' ? 'flex' : 'none';
  updateHeader();

  if (view === 'graph' && sql.lastQResult) {
    import('./graph.js').then(m => m.renderGraph(sql.lastQResult));
  }
}
document.querySelectorAll('#dv-tabs .vtab').forEach(t => {
  t.addEventListener('click', () => switchDvTab(t.dataset.view));
});

export async function openTable(name) {
  dv.widths.clear();   // ← キャッシュをクリア（変更点）
  state.currentTable = name;
  dv.offset = 0; dv.sort = null; dv.dir = 'asc';
  dv.filter = ''; dv.selected.clear();
  document.getElementById('dv-filter').value = '';
  setActiveItem(name);
  document.getElementById('er-link').classList.remove('act');
  document.getElementById('hint').style.display = 'none';

  state.erCards.forEach(c => { c.fadeTarget = 0.06; });
  state.fkLines.forEach(b => {
    b.mesh.visible = false;
    b.dots.forEach(d => { d.visible = false; });
  });

  const el = document.getElementById('dataview');
  el.classList.add('open');
  requestAnimationFrame(() => el.classList.add('vis'));
  switchDvTab('data');
  await loadTableData();

  if (selectBtn) selectBtn.disabled = false;
}

export async function closeTable() {
  const wasOpen = !!state.currentTable;
  state.currentTable = null;
  dv.selected.clear();
  setActiveItem(null);
  document.getElementById('er-link').classList.add('act');
  if (er2d.mode === '3d') document.getElementById('hint').style.display = '';
  state.erCards.forEach(c => { c.fadeTarget = 1; });
  closeCtx();

  const el = document.getElementById('dataview');
  el.classList.remove('vis');
  setTimeout(() => el.classList.remove('open'), 300);

  if (selectBtn) selectBtn.disabled = true;

  if (wasOpen && er2d.mode === '3d') {
    const c = api.fitER?.();
    if (c) api.tweenCamera?.(c.pos, c.target, 600);
  }
}

function generateSelect() {
  if (!state.currentTable) return;
  const text = 'SELECT * FROM ' + qiJs(state.currentTable) +
               ' LIMIT ' + dv.limit + ';';

  sql.mode = 'sql';
  document.querySelectorAll('#sqlmodes button').forEach(x => {
    x.classList.toggle('active', x.dataset.mode === 'sql');
  });
  askinput.style.display = 'none';
  sqlinput.style.display = '';

  sqlinput.value = text;
  autosize();
  sqlinput.focus();
  sqlinput.setSelectionRange(text.length, text.length);

  toast('SELECT文をセット', 'ok');
}
if (selectBtn) {
  selectBtn.addEventListener('click', generateSelect);
}

function setLoading(on) {
  dv.loading = on;
  document.getElementById('dv-loading').classList.toggle('show', on);
}

export async function loadTableData() {
  if (!state.currentTable) return;
  setLoading(true);
  try {
    const r = await fetch('/api/table', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        name: state.currentTable, limit: dv.limit, offset: dv.offset,
        sort: dv.sort, dir: dv.dir, filter: dv.filter,
      }),
    }).then(x => x.json());
    if (r.error) { toast(r.error, 'err'); return; }
    dv.lastData = r;
    renderData(r);
  } finally {
    setLoading(false);
  }
}

function renderData(r) {
  const tbl = state.schema.tables.find(t => t.name === state.currentTable);
  const pkCols = new Set(tbl.columns.filter(c => c.pk).map(c => c.name));
  const fkCols = new Set(tbl.fks.map(f => f.from_col));

  // rowid を除いて幅を計算（変更点）
  r.columns.forEach(c => {
    if (c === 'rowid') return;
    if (!dv.widths.has(c)) {
      dv.widths.set(c, estimateColWidth(c, r.columns, r.rows));
    }
  });

  // rowid を表示から除外（変更点）
  const visible = r.columns.filter(c => c !== 'rowid' && !dv.hidden.has(c));
  let cg = '<colgroup><col class="col-action" style="width:42px">';
  visible.forEach(c => {
    cg += '<col data-col="' + escapeAttr(c) + '" style="width:' +
          dv.widths.get(c) + 'px">';
  });
  cg += '</colgroup>';

  let html = cg + '<thead><tr>';
  html += '<th class="action frozen"><input type="checkbox" class="rowchk" id="dv-checkall"></th>';
  visible.forEach(c => {
    const isPK = pkCols.has(c);
    const isFK = fkCols.has(c);
    const mark = dv.sort === c
      ? '<span class="dir">' + (dv.dir === 'asc' ? '▲' : '▼') + '</span>' : '';
    const col = tbl.columns.find(x => x.name === c);
    const typeStr = col ? col.type : '';
    html += '<th data-col="' + escapeAttr(c) + '">' +
            '<span class="col-name">' + escapeHtml(c) + mark + '</span>' +
            '<span class="col-meta">' +
            (isPK ? '<span class="b pk">PK</span>' : '') +
            (isFK && !isPK ? '<span class="b fk">FK</span>' : '') +
            '<span class="ty">' + escapeHtml(typeStr) + '</span>' +
            '</span>' +
            '<span class="resizer" data-col="' + escapeAttr(c) + '"></span></th>';
  });
  html += '</tr></thead><tbody>';
  r.rows.forEach(row => {
    const rid = row[0];
    const sel = dv.selected.has(String(rid));
    html += '<tr data-rid="' + rid + '" class="' + (sel?'selected':'') + '">';
    html += '<td class="action frozen">' +
            '<input type="checkbox" class="rowchk rowsel" data-rid="' + rid + '"' +
            (sel?' checked':'') + '></td>';
    r.columns.forEach((col, i) => {
      if (col === 'rowid') return;              // rowid は表示しない（変更点）
      if (dv.hidden.has(col)) return;
      const v = row[i];
      let cls = (v === null ? 'null' : typeof v === 'number' ? 'num' : '');
      if (pkCols.has(col)) cls += ' pk';
      if (!pkCols.has(col) && fkCols.has(col)) cls += ' fk';
      cls += ' editable';                        // 全列編集可能（変更点）

      let txt = v === null ? 'NULL' : String(v);
      const truncated = txt.length > 50;
      const titleSrc = txt.length > 200 ? txt.slice(0, 200) + '…' : txt;
      const title = titleSrc.replace(/"/g, '&quot;');

      if (truncated) {
        const head = txt.slice(0, 50);
        html += '<td class="' + cls + ' truncated" data-col="' + escapeAttr(col) +
                '" data-rid="' + rid + '" data-len="' + txt.length + '"' +
                ' title="' + escapeAttr(title) + '">' +
                escapeHtml(head) +
                '<span class="more" title="全' + txt.length + '文字 — クリックで全文表示">…</span>' +
                '</td>';
      } else {
        html += '<td class="' + cls + '" data-col="' + escapeAttr(col) +
                '" data-rid="' + rid + '" title="' + escapeAttr(title) + '">' +
                escapeHtml(txt) + '</td>';
      }
    });
    html += '</tr>';
  });
  html += '</tbody>';

  const body = document.getElementById('dv-body');
  const loadEl = document.getElementById('dv-loading');
  body.innerHTML = '<table>' + html + '</table>';
  body.appendChild(loadEl);
  body.classList.toggle('dense', dv.dense);
  body.classList.toggle('zebra', dv.zebra);

  bindTableEvents();
  updatePager(r);
  updateSelBar();
  updateHiddenNote();
  updateHeader();
}

function estimateColWidth(colName, cols, rows) {
  let maxLen = colName.length + 2;
  const tbl = state.schema.tables.find(t => t.name === state.currentTable);
  const colDef = tbl ? tbl.columns.find(c => c.name === colName) : null;
  const typeLen = colDef ? colDef.type.length + 4 : 0;
  if (typeLen > maxLen) maxLen = typeLen;
  const idx = cols.indexOf(colName);
  const sample = Math.min(rows.length, 40);
  for (let i = 0; i < sample; i++) {
    const v = rows[i][idx];
    const s = v === null ? 4 : String(v).length;
    if (s > maxLen) maxLen = s;
  }
  return Math.min(360, Math.max(50, maxLen * 8 + 22));   // ← 最小50に
}

function bindTableEvents() {
  const body = document.getElementById('dv-body');

  body.querySelectorAll('thead th[data-col]').forEach(th => {
    const col = th.dataset.col;
    th.addEventListener('click', e => {
      if (e.target.classList.contains('resizer')) return;
      if (dv.sort === col) dv.dir = dv.dir === 'asc' ? 'desc' : 'asc';
      else { dv.sort = col; dv.dir = 'asc'; }
      dv.offset = 0; loadTableData();
    });
    th.addEventListener('contextmenu', e => {
      e.preventDefault();
      const isHidden = dv.hidden.has(col);
      showCtx(e.clientX, e.clientY, [
        {label: col},
        {text: '昇順ソート', k: '▲', fn: () => {
          dv.sort = col; dv.dir = 'asc'; dv.offset = 0; loadTableData();
        }},
        {text: '降順ソート', k: '▼', fn: () => {
          dv.sort = col; dv.dir = 'desc'; dv.offset = 0; loadTableData();
        }},
        {sep: true},
        {text: '列名をコピー', fn: async () => {
          await navigator.clipboard.writeText(col); toast('コピー', 'ok');
        }},
        {text: 'この列のユニーク値を取得', fn: () => {
          const sql2 = 'SELECT ' + qiJs(col) + ', COUNT(*) AS n FROM ' +
                       qiJs(state.currentTable) + ' GROUP BY ' + qiJs(col) +
                       ' ORDER BY n DESC LIMIT 100;';
          sqlinput.value = sql2; runSQL();
        }},
        {sep: true},
        {text: isHidden ? '列を表示' : '列を非表示', fn: () => {
          if (isHidden) dv.hidden.delete(col); else dv.hidden.add(col);
          renderData(dv.lastData);
        }},
      ]);
    });
  });

  body.querySelectorAll('.resizer').forEach(rz => {
    rz.addEventListener('click', e => e.stopPropagation());
    rz.addEventListener('mousedown', e => {
      e.preventDefault(); e.stopPropagation();
      const colName = rz.dataset.col;
      const colEl = body.querySelector('col[data-col="' + CSS.escape(colName) + '"]');
      if (!colEl) return;
      const startX = e.clientX;
      const startW = dv.widths.get(colName) || 100;
      rz.classList.add('active');
      document.body.style.cursor = 'col-resize';
      const onMove = ev => {
        const nw = Math.max(50, startW + (ev.clientX - startX));
        dv.widths.set(colName, nw);
        colEl.style.width = nw + 'px';
      };
      const onUp = () => {
        rz.classList.remove('active');
        document.body.style.cursor = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });

  const chkAll = body.querySelector('#dv-checkall');
  if (chkAll && dv.lastData) {
    const rows = dv.lastData.rows;
    const selCount = rows.filter(r => dv.selected.has(String(r[0]))).length;
    chkAll.checked = rows.length > 0 && selCount === rows.length;
    chkAll.indeterminate = selCount > 0 && selCount < rows.length;
    chkAll.addEventListener('change', () => {
      if (chkAll.checked) rows.forEach(r => dv.selected.add(String(r[0])));
      else dv.selected.clear();
      updateSelectionUI();
    });
  }

  body.querySelectorAll('.rowsel').forEach(chk => {
    chk.addEventListener('click', e => e.stopPropagation());
    chk.addEventListener('change', () => {
      const rid = chk.dataset.rid;
      if (chk.checked) { dv.selected.add(rid); dv.lastAnchor = rid; }
      else dv.selected.delete(rid);
      updateSelectionUI();
    });
  });

  body.querySelectorAll('tbody tr').forEach(tr => {
    tr.addEventListener('click', e => {
      if (e.target.matches('input,button')) return;
      if (e.target.closest('td.action')) return;
      const rid = String(tr.dataset.rid);
      if (e.shiftKey && dv.lastAnchor) {
        const all = Array.from(body.querySelectorAll('tbody tr'));
        const a = all.findIndex(t => t.dataset.rid === dv.lastAnchor);
        const b = all.findIndex(t => t.dataset.rid === rid);
        const s = Math.min(a, b), e2 = Math.max(a, b);
        for (let i = s; i <= e2; i++) dv.selected.add(all[i].dataset.rid);
      } else if (e.ctrlKey || e.metaKey) {
        if (dv.selected.has(rid)) dv.selected.delete(rid);
        else dv.selected.add(rid);
        dv.lastAnchor = rid;
      } else {
        if (dv.selected.size === 1 && dv.selected.has(rid)) dv.selected.clear();
        else { dv.selected.clear(); dv.selected.add(rid); dv.lastAnchor = rid; }
      }
      updateSelectionUI();
    });

    tr.addEventListener('contextmenu', e => {
      if (e.target.closest('input')) return;
      e.preventDefault();
      const rid = String(tr.dataset.rid);
      if (!dv.selected.has(rid)) {
        dv.selected.clear(); dv.selected.add(rid);
        dv.lastAnchor = rid; updateSelectionUI();
      }
      const n = dv.selected.size;
      showCtx(e.clientX, e.clientY, [
        {label: 'rowid ' + rid},
        {text: 'この行を削除', danger: true, fn: () => deleteRow(rid)},
        {sep: true},
        {text: '選択 ' + n + ' 行をコピー (TSV)', fn: () => copySelected('tsv')},
        {text: '選択 ' + n + ' 行をSQLでコピー', fn: () => copySelected('sql')},
        {sep: true},
        {text: '選択 ' + n + ' 行を削除', danger: true, fn: deleteSelected},
      ]);
    });
  });

  body.querySelectorAll('td .more').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      const td = el.closest('td');
      openCellView(td.dataset.col, td.dataset.rid);
    });
  });

  body.querySelectorAll('td.editable').forEach(td => {
    td.addEventListener('dblclick', startEditCell);
  });
}

function updateSelectionUI() {
  const body = document.getElementById('dv-body');
  body.querySelectorAll('tbody tr').forEach(tr => {
    const sel = dv.selected.has(String(tr.dataset.rid));
    tr.classList.toggle('selected', sel);
    const chk = tr.querySelector('.rowsel');
    if (chk) chk.checked = sel;
  });
  const chkAll = body.querySelector('#dv-checkall');
  if (chkAll && dv.lastData) {
    const rows = dv.lastData.rows;
    const selCount = rows.filter(r => dv.selected.has(String(r[0]))).length;
    chkAll.checked = rows.length > 0 && selCount === rows.length;
    chkAll.indeterminate = selCount > 0 && selCount < rows.length;
  }
  updateSelBar();
}

function updateSelBar() {
  const el = document.getElementById('dv-selinfo');
  const n = dv.selected.size;
  if (n > 0) {
    el.innerHTML =
      '<b>' + n + '</b> 行選択中' +
      '<button class="dbtn" data-sel="tsv">TSV</button>' +
      '<button class="dbtn" data-sel="csv">CSV</button>' +
      '<button class="dbtn" data-sel="json">JSON</button>' +
      '<button class="dbtn" data-sel="sql">SQL</button>' +
      '<button class="dbtn" data-sel="clear">解除</button>' +
      '<button class="dbtn danger" data-sel="delete">削除</button>';
    el.querySelectorAll('.dbtn').forEach(b => {
      b.addEventListener('click', () => {
        const a = b.dataset.sel;
        if (a === 'tsv') copySelected('tsv');
        else if (a === 'csv') copySelected('csv');
        else if (a === 'json') copySelected('json');
        else if (a === 'sql') copySelected('sql');
        else if (a === 'clear') { dv.selected.clear(); updateSelectionUI(); }
        else if (a === 'delete') deleteSelected();
      });
    });
    el.classList.add('show');
  } else {
    el.innerHTML = '';
    el.classList.remove('show');
  }
}

function updateHiddenNote() {
  const el = document.getElementById('dv-hidden-note');
  const n = dv.hidden.size;
  if (n > 0) { el.textContent = n + ' 列非表示'; el.classList.add('show'); }
  else { el.classList.remove('show'); }
}

export function selectAll() {
  if (!dv.lastData) return;
  dv.lastData.rows.forEach(r => dv.selected.add(String(r[0])));
  updateSelectionUI();
}

function invertSelection() {
  if (!dv.lastData) return;
  dv.lastData.rows.forEach(r => {
    const rid = String(r[0]);
    if (dv.selected.has(rid)) dv.selected.delete(rid);
    else dv.selected.add(rid);
  });
  updateSelectionUI();
}

async function deleteRow(rid) {
  if (!confirm('rowid ' + rid + ' を削除？')) return;
  const r = await fetch('/api/delete', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({table: state.currentTable, rowid: rid}),
  }).then(x => x.json());
  if (r.ok) { toast('削除', 'ok'); await refreshSchema(); loadTableData(); }
  else toast(r.error, 'err');
}

async function deleteSelected() {
  const ids = Array.from(dv.selected);
  if (!ids.length) return;
  if (!confirm(ids.length + ' 行を削除？')) return;
  const r = await fetch('/api/delete_many', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({table: state.currentTable, rowids: ids}),
  }).then(x => x.json());
  if (r.ok) {
    toast(r.deleted + ' 行削除', 'ok');
    dv.selected.clear();
    await refreshSchema(); loadTableData();
  } else toast(r.error, 'err');
}

function updatePager(r) {
  const total = r.total;
  const start = total ? r.offset + 1 : 0;
  const end   = Math.min(r.offset + r.limit, total);
  document.getElementById('pg-info').textContent = start + '–' + end + ' / ' + total;
  document.getElementById('pg-first').disabled = r.offset === 0;
  document.getElementById('pg-prev').disabled  = r.offset === 0;
  document.getElementById('pg-next').disabled  = end >= total;
  document.getElementById('pg-last').disabled  = end >= total;
  document.getElementById('dv-foot-right').innerHTML =
    'offset <b>' + r.offset + '</b> · limit <b>' + r.limit + '</b>';
}

function startEditCell(e, initialDir) {
  const td = e.currentTarget || e;
  if (td.querySelector('input')) return;

  let old = td.textContent.replace(/…$/, '');
  if (td.classList.contains('truncated') && dv.lastData) {
    const row = dv.lastData.rows.find(r => String(r[0]) === td.dataset.rid);
    if (row) {
      const idx = dv.lastData.columns.indexOf(td.dataset.col);
      if (idx >= 0) old = row[idx] === null ? 'NULL' : String(row[idx]);
    }
  }

  const col = td.dataset.col, rid = td.dataset.rid;
  td.innerHTML = '';
  const inp = document.createElement('input');
  inp.value = old === 'NULL' ? '' : old;
  td.appendChild(inp); inp.focus();
  if (initialDir === 'left') inp.setSelectionRange(0, 0);
  else inp.select();

  let done = false;
  const finish = async (save, move) => {
    if (done) return; done = true;
    if (!save) { td.textContent = old; if (move) navigateFromCell(td, move); return; }
    const val = inp.value === '' ? null : inp.value;
    if (String(val) === String(old === 'NULL' ? null : old)) {
      td.textContent = old;
      if (move) navigateFromCell(td, move);
      return;
    }
    const r = await fetch('/api/update', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        table: state.currentTable, rowid: rid, col: col, val: val,
      }),
    }).then(x => x.json());
    if (r.ok) {
      td.textContent = val === null ? 'NULL' : String(val);
      td.classList.toggle('null', val === null);
      td.classList.toggle('num', typeof val === 'number' ||
        (val !== null && !isNaN(val) && String(val).trim() !== ''));
      if (r.new_rid !== undefined && String(r.new_rid) !== String(rid)) {
        await loadTableData(); return;
      }
      toast('更新', 'ok');
    } else {
      td.textContent = old;
      toast(r.error, 'err');
    }
    if (move) navigateFromCell(td, move);
  };
  inp.addEventListener('blur', () => finish(true));
  inp.addEventListener('keydown', ev => {
    if (ev.key === 'Enter')  { ev.preventDefault(); inp.blur(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
    else if (ev.key === 'Tab') {
      ev.preventDefault();
      finish(true, ev.shiftKey ? 'left' : 'right');
    }
  });
}

function navigateFromCell(td, dir) {
  const tr = td.closest('tr');
  const cells = Array.from(tr.querySelectorAll('td.editable'));
  const idx = cells.indexOf(td);
  const nextIdx = dir === 'left' ? idx - 1 : idx + 1;
  if (nextIdx >= 0 && nextIdx < cells.length) {
    setTimeout(() => startEditCell(cells[nextIdx], dir), 30);
  } else {
    const allRows = Array.from(document.querySelectorAll('#dv-body tbody tr'));
    const rIdx = allRows.indexOf(tr);
    const nIdx = dir === 'left' ? rIdx - 1 : rIdx + 1;
    if (nIdx >= 0 && nIdx < allRows.length) {
      const target = allRows[nIdx].querySelectorAll('td.editable');
      if (target.length) {
        const t2 = dir === 'left' ? target[target.length-1] : target[0];
        setTimeout(() => startEditCell(t2, dir), 30);
      }
    }
  }
}

function rowsForOutput() {
  const r = dv.lastData;
  if (!r) return {columns: [], indices: [], rows: []};
  const visible = r.columns.filter(c => c !== 'rowid' && !dv.hidden.has(c));
  const indices = visible.map(c => r.columns.indexOf(c));
  const source = dv.selected.size
    ? r.rows.filter(row => dv.selected.has(String(row[0])))
    : r.rows;
  return {columns: visible, indices, rows: source};
}

function toTSV() {
  const o = rowsForOutput();
  const head = o.columns.join('\t');
  const body = o.rows.map(row => o.indices.map(i => {
    const v = row[i];
    return v === null ? '' : String(v).replace(/[\t\n]/g, ' ');
  }).join('\t')).join('\n');
  return head + '\n' + body;
}

function toCSV() {
  const o = rowsForOutput();
  const q = s => {
    const t = s === null ? '' : String(s);
    return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  };
  const head = o.columns.map(q).join(',');
  const body = o.rows.map(row =>
    o.indices.map(i => q(row[i])).join(',')).join('\n');
  return head + '\n' + body;
}

function toJSON() {
  const o = rowsForOutput();
  return JSON.stringify(o.rows.map(row => {
    const out = {};
    o.columns.forEach((c, k) => { out[c] = row[o.indices[k]]; });
    return out;
  }), null, 2);
}

function toSQLInsert() {
  const r = dv.lastData;
  if (!r) return '';
  const visible = r.columns.filter(c =>
    c !== 'rowid' && !dv.hidden.has(c));
  const source = dv.selected.size
    ? r.rows.filter(row => dv.selected.has(String(row[0])))
    : r.rows;
  return source.map(row => {
    const vals = visible.map(c => {
      const i = r.columns.indexOf(c);
      const v = row[i];
      if (v === null) return 'NULL';
      if (typeof v === 'number') return String(v);
      return "'" + String(v).replace(/'/g, "''") + "'";
    });
    return 'INSERT INTO ' + state.currentTable + ' (' + visible.join(',') +
           ') VALUES (' + vals.join(',') + ');';
  }).join('\n');
}

export async function copySelected(kind) {
  const map = {tsv: toTSV, csv: toCSV, json: toJSON, sql: toSQLInsert};
  const fn = map[kind];
  if (!fn) return;
  const text = fn();
  try {
    await navigator.clipboard.writeText(text);
    const n = dv.selected.size || (dv.lastData ? dv.lastData.rows.length : 0);
    toast(n + ' 行をコピー (' + kind.toUpperCase() + ')', 'ok');
  } catch (e) { toast('コピー失敗', 'err'); }
}

function download(text, filename, mime) {
  const blob = new Blob([text], {type: mime});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
}

export function toggleDense() {
  dv.dense = !dv.dense;
  document.getElementById('dv-body').classList.toggle('dense', dv.dense);
  document.getElementById('dv-density').classList.toggle('active', dv.dense);
}
export function toggleZebra() {
  dv.zebra = !dv.zebra;
  document.getElementById('dv-body').classList.toggle('zebra', dv.zebra);
  document.getElementById('dv-zebra').classList.toggle('active', dv.zebra);
}

document.getElementById('er-link').addEventListener('click', () => {
  if (state.currentTable) closeTable();
  else if (er2d.mode === '3d') {
    const c = api.fitER?.();
    if (c) api.tweenCamera?.(c.pos, c.target, 500);
  }
});
document.getElementById('pg-first').addEventListener('click', () => {
  dv.offset = 0; loadTableData();
});
document.getElementById('pg-prev').addEventListener('click', () => {
  dv.offset = Math.max(0, dv.offset - dv.limit); loadTableData();
});
document.getElementById('pg-next').addEventListener('click', () => {
  dv.offset += dv.limit; loadTableData();
});
document.getElementById('pg-last').addEventListener('click', async () => {
  const r = await fetch('/api/table', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({name: state.currentTable, limit: 1, offset: 0}),
  }).then(x => x.json());
  dv.offset = Math.max(0, Math.floor((r.total-1)/dv.limit)*dv.limit);
  loadTableData();
});
document.getElementById('dv-limit').addEventListener('change', e => {
  dv.limit = parseInt(e.target.value); dv.offset = 0; loadTableData();
});
let filterTO = null;
document.getElementById('dv-filter').addEventListener('input', e => {
  clearTimeout(filterTO);
  filterTO = setTimeout(() => {
    dv.filter = e.target.value; dv.offset = 0; loadTableData();
  }, 260);
});
document.getElementById('dv-add').addEventListener('click', async () => {
  const r = await fetch('/api/insert', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({table: state.currentTable}),
  }).then(x => x.json());
  if (r.ok) { toast('追加', 'ok'); await refreshSchema(); loadTableData(); }
  else toast(r.error, 'err');
});
document.getElementById('dv-refresh').addEventListener('click', () => {
  loadTableData(); toast('再読込', 'ok');
});
document.getElementById('dv-density').addEventListener('click', toggleDense);
document.getElementById('dv-zebra').addEventListener('click', toggleZebra);

const colsBtn   = document.getElementById('dv-cols-btn');
const colsPanel = document.getElementById('dv-cols-panel');
colsBtn.addEventListener('click', e => {
  e.stopPropagation();
  if (!dv.lastData) return;
  const tbl = state.schema.tables.find(t => t.name === state.currentTable);
  colsPanel.innerHTML = '<div class="ddh">列の表示/非表示</div>' +
    dv.lastData.columns.filter(c => c !== 'rowid').map(c => {
      const col = tbl.columns.find(x => x.name === c);
      const tp = col ? col.type : '';
      return '<div class="dd-item ' + (dv.hidden.has(c)?'':'on') +
        '" data-col="' + escapeAttr(c) + '">' +
        '<span class="chk">' + (dv.hidden.has(c)?'':'✓') + '</span>' +
        '<span>' + escapeHtml(c) + '</span>' +
        '<span class="tp">' + escapeHtml(tp) + '</span>' +
        '</div>';
    }).join('');
  colsPanel.classList.toggle('open');
  colsPanel.querySelectorAll('.dd-item').forEach(it => {
    it.addEventListener('click', () => {
      const c = it.dataset.col;
      if (dv.hidden.has(c)) dv.hidden.delete(c);
      else dv.hidden.add(c);
      it.classList.toggle('on', !dv.hidden.has(c));
      it.querySelector('.chk').textContent = dv.hidden.has(c) ? '' : '✓';
      renderData(dv.lastData);
    });
  });
});

const expBtn   = document.getElementById('dv-export-btn');
const expPanel = document.getElementById('dv-export-panel');
expBtn.addEventListener('click', e => {
  e.stopPropagation();
  expPanel.classList.toggle('open');
});
expPanel.querySelectorAll('.dd-item').forEach(it => {
  it.addEventListener('click', () => {
    const kind = it.dataset.exp;
    expPanel.classList.remove('open');
    const o = rowsForOutput();
    if (!o.rows.length) { toast('データなし', 'err'); return; }
    if (kind === 'csv')  download(toCSV(),      state.currentTable + '.csv',  'text/csv');
    else if (kind === 'tsv') download(toTSV(), state.currentTable + '.tsv', 'text/tab-separated-values');
    else if (kind === 'json') download(toJSON(), state.currentTable + '.json', 'application/json');
    else if (kind === 'sql')  download(toSQLInsert(), state.currentTable + '.sql', 'text/plain');
    toast(kind.toUpperCase() + ' 出力', 'ok');
  });
});

document.addEventListener('click', () => {
  colsPanel.classList.remove('open');
  expPanel.classList.remove('open');
});
colsPanel.addEventListener('click', e => e.stopPropagation());
expPanel.addEventListener('click', e => e.stopPropagation());

function activeInput() {
  return sql.mode === 'ask' ? askinput : sqlinput;
}

function updateTopOffset() {
  const h = sqlbar.offsetHeight;
  document.documentElement.style.setProperty('--top-offset', (h + 20) + 'px');
}

function autosize() {
  [sqlinput, askinput].forEach(inp => {
    inp.style.height = 'auto';
    inp.style.height = Math.min(inp.scrollHeight, 180) + 'px';
  });
  updateTopOffset();
}

function onInputChange() {
  sql.histIdx = -1;
  sql.histDraft = null;
  autosize();
}
sqlinput.addEventListener('input', onInputChange);
askinput.addEventListener('input', onInputChange);
autosize();

if (window.ResizeObserver) {
  const ro = new ResizeObserver(() => updateTopOffset());
  ro.observe(sqlbar);
}
addEventListener('resize', updateTopOffset);

[sqlinput, askinput].forEach(inp => {
  inp.addEventListener('focus', () => sqlbar.classList.add('focus'));
  inp.addEventListener('blur', () => {
    sqlbar.classList.remove('focus');
    setTimeout(() => sqlhistEl.classList.remove('show'), 200);
  });
});

document.querySelectorAll('#sqlmodes button').forEach(b => {
  b.addEventListener('click', () => {
    sql.mode = b.dataset.mode;
    document.querySelectorAll('#sqlmodes button').forEach(x => {
      x.classList.toggle('active', x === b);
    });
    if (sql.mode === 'ask') {
      sqlinput.style.display = 'none';
      askinput.style.display = '';
      askinput.focus();
    } else {
      askinput.style.display = 'none';
      sqlinput.style.display = '';
      sqlinput.focus();
    }
    autosize();
  });
});

function handleInputKeydown(inp) {
  return async e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      sql.mode = (inp === askinput) ? 'ask' : 'sql';
      await submitQuery();
      return;
    }

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const v = inp.value;
      const pos = inp.selectionStart;
      const onFirstLine = (v.lastIndexOf('\n', pos - 1) === -1);

      if (e.key === 'ArrowUp' && (onFirstLine || sql.histIdx >= 0)) {
        if (sql.history.length === 0) return;
        e.preventDefault();
        if (sql.histIdx < 0) {
          sql.histDraft = v;
          sql.histIdx = sql.history.length - 1;
          if (sql.histIdx > 0 && sql.history[sql.histIdx] === v) sql.histIdx--;
        } else {
          sql.histIdx = Math.max(0, sql.histIdx - 1);
        }
        inp.value = sql.history[sql.histIdx];
        inp.setSelectionRange(inp.value.length, inp.value.length);
        autosize();
        toast('履歴 ' + (sql.histIdx + 1) + '/' + sql.history.length, 'ok');
        return;
      }

      if (e.key === 'ArrowDown' && sql.histIdx >= 0) {
        e.preventDefault();
        sql.histIdx++;
        if (sql.histIdx >= sql.history.length) {
          sql.histIdx = -1;
          inp.value = sql.histDraft || '';
          sql.histDraft = null;
        } else {
          inp.value = sql.history[sql.histIdx];
        }
        inp.setSelectionRange(inp.value.length, inp.value.length);
        autosize();
        return;
      }
    }

    if (e.key === 'Tab') { e.preventDefault(); await complete(); return; }
    if (e.altKey && (e.key === 'f' || e.key === 'F')) {
      e.preventDefault(); formatCurrentInput(); return;
    }
    if (e.key === 'Escape') {
      if (sqlhistEl.classList.contains('show')) sqlhistEl.classList.remove('show');
      else inp.blur();
    }
  };
}
sqlinput.addEventListener('keydown', handleInputKeydown(sqlinput));
askinput.addEventListener('keydown', handleInputKeydown(askinput));

async function submitQuery() {
  const inp = activeInput();
  const v = inp.value.trim();
  if (!v) return;
  if (sql.mode === 'ask') { await runAsk(); return; }

  const looksLikeSQL = /^\s*(SELECT|WITH|INSERT|UPDATE|DELETE|EXPLAIN|SHOW|PRAGMA|CREATE|ALTER|DROP)\b/i.test(v);
  if (!looksLikeSQL && v.split(/\s+/).length >= 2) {
    askinput.value = v;
    sqlinput.value = '';
    sql.mode = 'ask';
    document.querySelectorAll('#sqlmodes button').forEach(x => {
      x.classList.toggle('active', x.dataset.mode === 'ask');
    });
    askinput.style.display = '';
    sqlinput.style.display = 'none';
    autosize();
    await runAsk();
    return;
  }
  await runSQL();
}

async function complete() {
  const v = sqlinput.value;
  const pos = sqlinput.selectionStart;
  const before = v.slice(0, pos);
  const m = before.match(/([A-Za-z_][A-Za-z0-9_]*)$/);
  if (!m) return;

  const prefix = m[1].toLowerCase();
  const prefixLen = m[1].length;
  const capturedPos = pos;

  const pool = new Set();
  if (state.schema) {
    state.schema.tables.forEach(t => {
      if (t.name.toLowerCase().startsWith(prefix)) pool.add(t.name);
      t.columns.forEach(c => {
        if (c.name.toLowerCase().startsWith(prefix)) pool.add(c.name);
      });
    });
  }
  ['SELECT','FROM','WHERE','ORDER','GROUP','BY','LIMIT','JOIN','LEFT',
   'INNER','ON','AS','UPDATE','DELETE','INSERT','INTO','VALUES','SET',
   'AND','OR','NOT','NULL','LIKE','COUNT','SUM','AVG','MAX','MIN','DISTINCT']
    .forEach(k => { if (k.toLowerCase().startsWith(prefix)) pool.add(k); });

  const arr = Array.from(pool).sort();
  if (!arr.length) return;

  const doInsert = word => {
    const cur = sqlinput.value;
    const start = capturedPos - prefixLen;
    sqlinput.value = cur.slice(0, start) + word + cur.slice(capturedPos);
    sqlinput.focus();
    sqlinput.setSelectionRange(start + word.length, start + word.length);
    autosize();
  };

  if (arr.length === 1) { doInsert(arr[0]); return; }
  showSuggestions(arr.map(a => ({sql: a})), doInsert);
}

function showSuggestions(items, onSelect) {
  sqlhistEl.innerHTML = '<div class="h">候補</div>' +
    items.map((it, i) =>
      '<div class="it" data-i="' + i + '">' + escapeHtml(it.sql) + '</div>'
    ).join('');
  sqlhistEl.classList.add('show');
  sqlhistEl.querySelectorAll('.it').forEach(el => {
    el.addEventListener('mousedown', ev => {
      ev.preventDefault();
      onSelect(items[parseInt(el.dataset.i)].sql);
      sqlhistEl.classList.remove('show');
    });
  });
}

async function runSQL() {
  const sql2 = sqlinput.value.trim();
  if (!sql2) return;
  sql.history = sql.history.filter(h => h !== sql2);
  sql.history.push(sql2); sql.histIdx = -1;
  sqlstatus.textContent = '実行中…'; sqlstatus.className = '';
  sqlbar.classList.remove('err');
  const t0 = performance.now();
  let r;
  try {
    r = await fetch('/api/query', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({sql: sql2}),
    }).then(x => x.json());
  } catch (e) {
    sqlstatus.textContent = '✖ ' + e.message;
    sqlstatus.className = 'err'; sqlbar.classList.add('err'); return;
  }
  const ms = (performance.now() - t0).toFixed(0);
  if (r.error) {
    sqlstatus.textContent = '✖ ' + ms + 'ms — ' + r.error;
    sqlstatus.className = 'err'; sqlbar.classList.add('err'); return;
  }
  if (r.columns.length > 0) {
    sqlstatus.textContent = '✔ ' + ms + 'ms — ' + r.rows.length + ' 行';
    sqlstatus.className = 'ok';
    showQueryResult(r);
  } else {
    sqlstatus.textContent = '✔ ' + ms + 'ms — 影響 ' + r.affected + ' 行';
    sqlstatus.className = 'ok';
    toast('影響行数 ' + r.affected, 'ok');
    await refreshSchema();
    if (state.currentTable &&
        state.schema.tables.some(t => t.name === state.currentTable)) {
      loadTableData();
    }
  }
}

async function runAsk() {
  const q = askinput.value.trim();
  if (!q) return;

  sql.mode = 'ask';
  document.querySelectorAll('#sqlmodes button').forEach(x => {
    x.classList.toggle('active', x.dataset.mode === 'ask');
  });
  askinput.style.display = '';
  sqlinput.style.display = 'none';
  sqlinput.value = '';
  autosize();

  sqlstatus.textContent = '生成中… (LLM)';
  sqlstatus.className = '';
  sqlbar.classList.remove('err');
  sqlbar.classList.add('asking');

  const t0 = performance.now();
  let accumulated = '';
  let finalSql = null, finalRaw = null, finalResult = null;
  let finalError = null, llmMs = null, finished = false;

  return new Promise(resolve => {
    let es;
    try {
      es = new EventSource('/api/ask_sse?q=' + encodeURIComponent(q));
    } catch (e) {
      sqlbar.classList.remove('asking');
      sqlstatus.textContent = '✖ EventSource 非対応';
      sqlstatus.className = 'err';
      sqlbar.classList.add('err');
      resolve(); return;
    }

    function finish() {
      if (finished) return;
      finished = true;
      try { es.close(); } catch (e) {}
      sqlbar.classList.remove('asking');
      const ms = (performance.now() - t0).toFixed(0);

      sql.mode = 'sql';
      document.querySelectorAll('#sqlmodes button').forEach(x => {
        x.classList.toggle('active', x.dataset.mode === 'sql');
      });
      askinput.style.display = 'none';
      sqlinput.style.display = '';

      if (finalSql) sqlinput.value = finalSql;
      else if (finalRaw) sqlinput.value = formatGeneratedSql(finalRaw);
      else if (accumulated) sqlinput.value = formatGeneratedSql(accumulated);
      autosize();

      if (finalSql) {
        sql.history = sql.history.filter(h => h !== finalSql);
        sql.history.push(finalSql);
        sql.histIdx = -1;
        sql.histDraft = null;
      }

      if (finalError) {
        sqlstatus.textContent = '✖ ' + ms + 'ms — ' + finalError;
        sqlstatus.className = 'err'; sqlbar.classList.add('err');
        resolve(); return;
      }
      const llmStr = (llmMs != null) ? ' (LLM ' + Math.round(llmMs) + 'ms)' : '';
      if (finalResult && finalResult.columns && finalResult.columns.length > 0) {
        sqlstatus.textContent = '✔ ' + ms + 'ms' + llmStr + ' — ' +
          finalResult.rows.length + ' 行';
        sqlstatus.className = 'ok';
        showQueryResult(finalResult);
      } else if (finalResult) {
        sqlstatus.textContent = '✔ ' + ms + 'ms' + llmStr +
          ' — 影響 ' + finalResult.affected + ' 行';
        sqlstatus.className = 'ok';
        toast('影響行数 ' + finalResult.affected, 'ok');
        refreshSchema();
        if (state.currentTable &&
            state.schema.tables.some(t => t.name === state.currentTable)) {
          loadTableData();
        }
      } else {
        sqlstatus.textContent = '✔ ' + ms + 'ms' + llmStr + ' — 完了';
        sqlstatus.className = 'ok';
      }
      resolve();
    }

    es.addEventListener('token', e => {
      try {
        const data = JSON.parse(e.data);
        const wasEmpty = (accumulated.length === 0);
        accumulated += (data.text || '');
        sqlinput.value = accumulated;
        autosize();
        sqlinput.scrollTop = sqlinput.scrollHeight;
        sqlstatus.textContent = '受信中… (' + accumulated.length + ' 文字)';
        if (wasEmpty) {
          sql.mode = 'sql';
          document.querySelectorAll('#sqlmodes button').forEach(x => {
            x.classList.toggle('active', x.dataset.mode === 'sql');
          });
          askinput.style.display = 'none';
          sqlinput.style.display = '';
        }
      } catch (err) {}
    });

    es.addEventListener('sql', e => {
      try {
        const data = JSON.parse(e.data);
        const formatted = formatGeneratedSql(data.sql);
        finalSql = formatted;
        sqlinput.value = formatted;
        autosize();
      } catch (err) {}
    });

    es.addEventListener('done', e => {
      try {
        const data = JSON.parse(e.data);
        if (data.error) {
          finalError = data.error;
          if (data.sql) finalSql = formatGeneratedSql(data.sql);
          if (data.raw) finalRaw = data.raw;
          if (data.llm_ms != null) llmMs = data.llm_ms;
        } else {
          finalResult = data;
          if (data.sql) finalSql = formatGeneratedSql(data.sql);
          if (data.raw) finalRaw = data.raw;
          if (data.llm_ms != null) llmMs = data.llm_ms;
        }
      } catch (err) {}
      finish();
    });

    es.addEventListener('error', () => {
      if (finished) return;
      if (!finalError && !finalResult && !finalSql && !accumulated) {
        finalError = '接続が閉じられました';
      }
      finish();
    });
  });
}

function showQueryResult(r) {
  sql.lastQResult = r;
  const el = document.getElementById('dataview');
  if (!el.classList.contains('open')) {
    el.classList.add('open');
    requestAnimationFrame(() => el.classList.add('vis'));
  }
  state.currentTable = null;
  setActiveItem(null);
  document.getElementById('er-link').classList.remove('act');

  if (selectBtn) selectBtn.disabled = true;

  const tab = document.getElementById('vtab-result');
  tab.style.display = '';
  document.getElementById('vtab-result-cnt').textContent = r.rows.length;
  
  const gtab = document.getElementById('vtab-graph');
  if (gtab) gtab.style.display = '';
  
  renderResultPane(r);
  switchDvTab('result');
}

function renderResultPane(r) {
  const limit = Math.min(r.rows.length, 2000);
  let html = '<table><thead><tr>';
  r.columns.forEach(c => { html += '<th>' + escapeHtml(c) + '</th>'; });
  html += '</tr></thead><tbody>';
  for (let i = 0; i < limit; i++) {
    const row = r.rows[i];
    html += '<tr>';
    row.forEach(v => {
      const cls = v === null ? 'null' : (typeof v === 'number' ? 'num' : '');
      html += '<td class="' + cls + '">' +
        (v === null ? 'NULL' : escapeHtml(String(v))) + '</td>';
    });
    html += '</tr>';
  }
  html += '</tbody></table>';
  resultPaneBody.innerHTML = html;
  document.getElementById('result-foot-info').innerHTML =
    '<b>' + r.rows.length + '</b> 行 · ' + r.elapsed_ms + 'ms' +
    (r.rows.length > limit
      ? ' <span style="color:#5a7c96">(表示 ' + limit + ')</span>' : '');
}

function clearQueryResult() {
  sql.lastQResult = null;
  resultPaneBody.innerHTML = '';
  const tab = document.getElementById('vtab-result');
  tab.style.display = 'none';

  const gtab = document.getElementById('vtab-graph');
  if (gtab) gtab.style.display = 'none';
  if (dv.tab === 'graph') switchDvTab('data');

  if (dv.tab === 'result') switchDvTab('data');
}

document.getElementById('qresult-clear').addEventListener('click', clearQueryResult);
document.getElementById('qresult-copy').addEventListener('click', async () => {
  if (!sql.lastQResult) return;
  const lines = [sql.lastQResult.columns.join('\t')];
  sql.lastQResult.rows.forEach(row => {
    lines.push(row.map(v =>
      v === null ? '' : String(v).replace(/\t/g, ' ')).join('\t'));
  });
  await navigator.clipboard.writeText(lines.join('\n'));
  toast('コピー', 'ok');
});

let cellViewValue = null;

function openCellView(col, rid) {
  if (!dv.lastData) return;
  const row = dv.lastData.rows.find(r => String(r[0]) === rid);
  if (!row) return;
  const idx = dv.lastData.columns.indexOf(col);
  if (idx < 0) return;
  const v = row[idx];
  const txt = v === null ? 'NULL' : String(v);

  cellViewValue = txt;
  document.getElementById('cellview-col').textContent = col;
  document.getElementById('cellview-len').textContent = '— 全 ' + txt.length + ' 文字';
  document.getElementById('cellview-body').textContent = txt;
  document.getElementById('cellview').classList.add('open');
}

function closeCellView() {
  document.getElementById('cellview').classList.remove('open');
  cellViewValue = null;
}

document.getElementById('cellview-close').addEventListener('click', closeCellView);
document.getElementById('cellview').addEventListener('click', e => {
  if (e.target.id === 'cellview') closeCellView();
});
document.getElementById('cellview-copy').addEventListener('click', async () => {
  if (cellViewValue === null) return;
  try {
    await navigator.clipboard.writeText(cellViewValue);
    toast('コピーしました', 'ok');
  } catch (e) { toast('コピー失敗', 'err'); }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' &&
      document.getElementById('cellview').classList.contains('open')) {
    e.stopPropagation();
    closeCellView();
  }
}, true);

function formatGeneratedSql(rawSql) {
  if (!rawSql) return rawSql;
  try {
    return formatSql(rawSql, {
      language: 'sqlite',
      keywordCase: 'upper',
      tabWidth: 2,
    });
  } catch (e) {
    console.warn('SQL format failed:', e);
    return rawSql;
  }
}

function formatCurrentInput() {
  const inp = activeInput();
  const v = inp.value.trim();
  if (!v) return;
  inp.value = formatGeneratedSql(v);
  autosize();
  toast('整形', 'ok');
}
document.getElementById('sql-format').addEventListener('click', e => {
  e.preventDefault();
  formatCurrentInput();
  activeInput().focus();
});

/* ═══════════════════════════════════════════════════════
   ドラッグ & ドロップ
   ═══════════════════════════════════════════════════════ */
let _charWidthCache = null;
function measureCharWidth(el) {
  if (_charWidthCache !== null) return _charWidthCache;
  const span = document.createElement('span');
  const style = getComputedStyle(el);
  span.style.fontFamily = style.fontFamily;
  span.style.fontSize = style.fontSize;
  span.style.fontWeight = style.fontWeight;
  span.style.letterSpacing = style.letterSpacing;
  span.style.visibility = 'hidden';
  span.style.position = 'absolute';
  span.style.whiteSpace = 'pre';
  span.textContent = 'MMMMMMMMMM';
  document.body.appendChild(span);
  _charWidthCache = span.offsetWidth / 10;
  span.remove();
  return _charWidthCache;
}

function pointToIndex(textarea, x, y) {
  const style = getComputedStyle(textarea);
  const rect = textarea.getBoundingClientRect();

  if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
    return null;
  }

  const paddingLeft = parseFloat(style.paddingLeft) || 0;
  const paddingTop  = parseFloat(style.paddingTop)  || 0;
  const borderLeft  = parseFloat(style.borderLeftWidth) || 0;
  const borderTop   = parseFloat(style.borderTopWidth)  || 0;

  const localX = x - rect.left - paddingLeft - borderLeft + textarea.scrollLeft;
  const localY = y - rect.top  - paddingTop  - borderTop  + textarea.scrollTop;

  let lineHeight = parseFloat(style.lineHeight);
  if (!lineHeight || isNaN(lineHeight)) {
    const fs = parseFloat(style.fontSize) || 14;
    lineHeight = fs * 1.6;
  }

  const charWidth = measureCharWidth(textarea);
  const line = Math.floor(localY / lineHeight);
  const col  = Math.round(localX / charWidth);

  const lines = textarea.value.split('\n');
  if (line < 0) return 0;
  if (line >= lines.length) return textarea.value.length;

  let index = 0;
  for (let i = 0; i < line; i++) index += lines[i].length + 1;
  index += Math.max(0, Math.min(col, lines[line].length));
  return index;
}

function insertAtCursor(inp, text, idx) {
  const val = inp.value;
  const before = val.slice(0, idx);
  const after  = val.slice(idx);

  let insert = text;
  if (before && !/\s$/.test(before) && !/^\s/.test(insert)) insert = ' ' + insert;
  if (after  && !/^\s/.test(after)  && !/\s$/.test(insert)) insert = insert + ' ';

  inp.value = before + insert + after;
  const newPos = (before + insert).length;
  inp.focus();
  inp.setSelectionRange(newPos, newPos);
  if (inp === sqlinput || inp === askinput) autosize();
}

document.addEventListener('dragstart', e => {
  const item = e.target.closest('[data-drag-value]');
  if (!item) return;
  const value = item.dataset.dragValue || '';
  if (!value) return;

  const payload = {
    type: item.dataset.dragType || 'text',
    value: value,
  };

  e.dataTransfer.effectAllowed = 'copy';
  e.dataTransfer.setData('text/plain', value);
  try {
    e.dataTransfer.setData('application/x-dbverse', JSON.stringify(payload));
  } catch (err) {}

  item.classList.add('dragging');
  sqlbar.classList.add('drop-ready');
});

document.addEventListener('dragend', e => {
  document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
  sqlbar.classList.remove('drop-ready');
  sqlbar.classList.remove('drop-hover');
});

sqlbar.addEventListener('dragover', e => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  sqlbar.classList.add('drop-hover');
});

sqlbar.addEventListener('dragleave', e => {
  if (!sqlbar.contains(e.relatedTarget)) {
    sqlbar.classList.remove('drop-hover');
  }
});

sqlbar.addEventListener('drop', e => {
  e.preventDefault();
  sqlbar.classList.remove('drop-hover');
  sqlbar.classList.remove('drop-ready');

  let payload;
  try {
    payload = JSON.parse(e.dataTransfer.getData('application/x-dbverse'));
  } catch (err) {
    payload = { type: 'text', value: e.dataTransfer.getData('text/plain') };
  }
  if (!payload || !payload.value) return;

  const inp = activeInput();
  const isAsk = (inp === askinput);
  const text = isAsk ? payload.value : qiJs(payload.value);

  const idx = pointToIndex(inp, e.clientX, e.clientY);
  const insertPos = (idx === null) ? inp.value.length : idx;

  insertAtCursor(inp, text, insertPos);

  toast((isAsk ? '自然言語' : 'SQL') + 'に挿入', 'ok');
});