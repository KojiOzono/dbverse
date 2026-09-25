// graph.js — SQL結果のグラフ + Chronos-2 予測
console.log('[graph.js] loaded');

import { toast, escapeHtml } from './main.js';

// ─────────────── Chronos 設定（config.py 由来） ───────────────
let CHRONOS_ENABLED = true;
let configReady = null;

function loadChronosConfig() {
  if (configReady) return configReady;
  configReady = fetch('/api/config')
    .then(r => r.json())
    .then(cfg => {
      const c = cfg.chronos || cfg.CHRONOS;
      if (c && typeof c.enabled === 'boolean') CHRONOS_ENABLED = c.enabled;
    })
    .catch(() => {});
  return configReady;
}

const gs = {
  result: null,
  xIdx: 0,
  yIdx: 1,
  fcEnabled: false,
  predLen: 10,
  busy: false,
};

// ─────────────── Plotly 動的ロード ───────────────
let plotlyPromise = null;
function loadPlotly() {
  if (plotlyPromise) return plotlyPromise;
  plotlyPromise = new Promise((resolve, reject) => {
    if (window.Plotly) return resolve(window.Plotly);
    const s = document.createElement('script');
    s.src = 'https://cdn.plot.ly/plotly-2.27.0.min.js';
    s.charset = 'utf-8';
    s.onload = () => resolve(window.Plotly);
    s.onerror = () => reject(new Error('Plotly load failed'));
    document.head.appendChild(s);
  });
  return plotlyPromise;
}

// ═══════════════════════════════════════════
// 公開API
// ═══════════════════════════════════════════
export async function renderGraph(result) {
  if (!result || !result.columns || !result.rows) return;
  await loadChronosConfig();       // ★ config を待つ
  gs.result = result;
  gs.xIdx = 0;
  gs.yIdx = Math.min(1, result.columns.length - 1);
  gs.fcEnabled = false;
  gs.predLen = 10;

  initToolbar();
  applyChronosEnabled();
  updateForecastToggle();
  updateGraph();
}

// ═══════════════════════════════════════════
// Chronos 有効/無効の反映（無効時はトグルを押せなくする）
// ═══════════════════════════════════════════
function applyChronosEnabled() {
  if (CHRONOS_ENABLED) return;

  const toggle = document.getElementById('graph-fc-toggle');
  const slider = document.getElementById('graph-pred-len');
  const reason = document.getElementById('graph-fc-reason');

  if (toggle) {
    toggle.checked = false;
    toggle.disabled = true;
  }
  if (slider) slider.disabled = true;
  gs.fcEnabled = false;
  if (reason) {
    reason.textContent = '予測機能は無効です';
    reason.style.display = '';
  }
}

// ═══════════════════════════════════════════
// ツールバー
// ═══════════════════════════════════════════
function initToolbar() {
  const xSel = document.getElementById('graph-x');
  const ySel = document.getElementById('graph-y');
  const toggle = document.getElementById('graph-fc-toggle');
  const slider = document.getElementById('graph-pred-len');
  const sliderVal = document.getElementById('graph-pred-len-val');

  const opts = gs.result.columns.map((c, i) =>
    `<option value="${i}">${escapeHtml(c)}</option>`).join('');
  xSel.innerHTML = opts;
  ySel.innerHTML = opts;
  xSel.value = String(gs.xIdx);
  ySel.value = String(gs.yIdx);
  toggle.checked = false;
  slider.value = String(gs.predLen);
  slider.disabled = true;
  sliderVal.textContent = String(gs.predLen);

  xSel.onchange = e => {
    gs.xIdx = parseInt(e.target.value);
    updateForecastToggle();
    updateGraph();
  };
  ySel.onchange = e => {
    gs.yIdx = parseInt(e.target.value);
    updateGraph();
  };
  toggle.onchange = e => {
    gs.fcEnabled = e.target.checked;
    slider.disabled = !gs.fcEnabled;
    updateGraph();
  };
  slider.oninput = e => {
    sliderVal.textContent = e.target.value;
  };
  slider.onchange = e => {
    gs.predLen = parseInt(e.target.value);
    if (gs.fcEnabled) updateGraph();
  };
}

// ═══════════════════════════════════════════
// 時間軸判定（値ベース）
// ═══════════════════════════════════════════
const TIME_PATTERNS = [
  /^\d{4}-\d{1,2}-\d{1,2}([ T]\d{1,2}:\d{1,2}(:\d{1,2})?)?/,
  /^\d{4}\/\d{1,2}\/\d{1,2}/,
  /^\d{4}\.\d{1,2}\.\d{1,2}/,               // 追加：2026.09.15
  /^\d{4}-\d{1,2}$/,
  /^\d{4}\/\d{1,2}$/,
  /^\d{4}\.\d{1,2}$/,                       // 追加：2026.09
  /^\d{4}年\d{1,2}月/,
  /^(19|20|21)\d{2}$/,                      // 変更：4桁年
  /^\d{4}-W\d{1,2}$/,
  /^\d{4}W\d{1,2}$/,
  /^(19|20|21)\d{2}(0[1-9]|1[0-2])$/,       // 追加：202609
];
function isTimeAxis(values) {
  if (!values || values.length < 2) return false;
  const sample = values.slice(0, Math.min(10, values.length));
  let hits = 0, total = 0;
  for (const v of sample) {
    if (v === null || v === undefined || v === '') continue;
    total++;
    if (TIME_PATTERNS.some(re => re.test(String(v).trim()))) hits++;
  }
  return total > 0 && hits >= Math.ceil(total * 0.7);
}

function columnValues(idx) {
  return gs.result.rows.map(r => r[idx]);
}

// ═══════════════════════════════════════════
// 予測トグルの活性/非活性
// ═══════════════════════════════════════════
function updateForecastToggle() {
  if (!CHRONOS_ENABLED) return;

  const toggle = document.getElementById('graph-fc-toggle');
  const slider = document.getElementById('graph-pred-len');
  const reason = document.getElementById('graph-fc-reason');

  const rawX = columnValues(gs.xIdx).map(v => v === null ? '' : v);
  const ok = isTimeAxis(rawX);

  if (!ok) {
    toggle.checked = false;
    gs.fcEnabled = false;
    toggle.disabled = true;
    slider.disabled = true;
    if (reason) {
      const xCol = gs.result.columns[gs.xIdx];
      reason.textContent = `${xCol} は時系列ではないため予測できません`;
      reason.style.display = '';
    }
  } else {
    toggle.disabled = false;
    slider.disabled = !gs.fcEnabled;
    if (reason) {
      reason.textContent = '';
      reason.style.display = 'none';
    }
  }
}

// ═══════════════════════════════════════════
// 描画更新
// ═══════════════════════════════════════════
async function updateGraph() {
  if (gs.busy) return;
  const body = document.getElementById('graph-body');
  const meta = document.getElementById('graph-meta');
  const xCol = gs.result.columns[gs.xIdx];
  const yCol = gs.result.columns[gs.yIdx];
  meta.textContent = `${xCol} × ${yCol} · ${gs.result.rows.length}点`;

  const rawX = columnValues(gs.xIdx).map(v => v === null ? '' : v);
  const xVals = isTimeAxis(rawX) ? rawX : rawX.map(Number);
  const yVals = columnValues(gs.yIdx).map(v => Number(v));

  gs.busy = true;
  try {
    const Plotly = await loadPlotly();
    let forecast = null;
    if (gs.fcEnabled && CHRONOS_ENABLED) {
      try {
        forecast = await fetchForecast(xVals, yVals, gs.predLen);
      } catch (e) {
        toast('予測失敗: ' + e.message, 'err');
      }
    }
    plotChart(Plotly, body, { xVals, yVals, forecast });
  } catch (e) {
    body.innerHTML = '<div class="graph-empty">Plotly の読み込みに失敗しました</div>';
  } finally {
    gs.busy = false;
  }
}

async function fetchForecast(xVals, yVals, predLen) {
  const res = await fetch('/api/forecast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      values: yVals,
      pred_len: predLen,
      x_values: xVals,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.error || `HTTP ${res.status}`);
  }
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

// ═══════════════════════════════════════════
// Plotly 描画
// ═══════════════════════════════════════════
function plotChart(Plotly, body, { xVals, yVals, forecast }) {
  const traces = [];

  if (forecast) {
    const futureX = futureLabels(xVals, forecast.prediction_length);
    let maxIdx = 0;
    const isNum = typeof xVals[0] === 'number';
    for (let i = 1; i < xVals.length; i++) {
      const cmp = isNum
        ? Number(xVals[i]) - Number(xVals[maxIdx])
        : String(xVals[i]).localeCompare(String(xVals[maxIdx]));
      if (cmp > 0) maxIdx = i;
    }
    const xF = [xVals[maxIdx], ...futureX];
    const anchor = yVals[maxIdx];
    const median = [anchor, ...forecast.median];
    const low80  = [anchor, ...forecast.low_80];
    const high80 = [anchor, ...forecast.high_80];
    const low50  = [anchor, ...forecast.low_50];
    const high50 = [anchor, ...forecast.high_50];

    traces.push(
      { x: xF, y: high80, mode: 'lines', line: { width: 0 }, showlegend: false, hoverinfo: 'skip' },
      { x: xF, y: low80, mode: 'lines', line: { width: 0 }, fill: 'tonexty',
        fillcolor: 'rgba(77,232,255,0.10)', name: '80%予測区間', hoverinfo: 'skip' },
      { x: xF, y: high50, mode: 'lines', line: { width: 0 }, showlegend: false, hoverinfo: 'skip' },
      { x: xF, y: low50, mode: 'lines', line: { width: 0 }, fill: 'tonexty',
        fillcolor: 'rgba(77,232,255,0.25)', name: '50%予測区間', hoverinfo: 'skip' },
      { x: xF, y: median, mode: 'lines+markers',
        line: { color: '#4de8ff', width: 2, dash: 'dash' },
        marker: { size: 4, color: '#4de8ff' },
        name: '中央値予測' },
    );
  }

  traces.push({
    x: xVals, y: yVals, mode: 'lines+markers',
    line: { color: '#cfe6f5', width: 1.8 },
    marker: { size: 4, color: '#cfe6f5' },
    name: '過去データ',
  });

  const layout = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { color: '#a8cce0', family: '"SF Mono","Courier New",monospace', size: 11 },
    xaxis: {
      gridcolor: 'rgba(12,244,255,0.08)',
      linecolor: 'rgba(12,244,255,0.25)',
      zerolinecolor: 'rgba(12,244,255,0.15)',
      tickfont: { color: '#7a9cb0' },
    },
    yaxis: {
      gridcolor: 'rgba(12,244,255,0.08)',
      linecolor: 'rgba(12,244,255,0.25)',
      zerolinecolor: 'rgba(12,244,255,0.15)',
      tickfont: { color: '#7a9cb0' },
    },
    legend: {
      orientation: 'h', yanchor: 'bottom', y: 1.02, xanchor: 'right', x: 1,
      font: { size: 10, color: '#a8cce0' }, bgcolor: 'rgba(0,0,0,0)',
    },
    margin: { t: 20, r: 16, b: 40, l: 48 },
    hovermode: 'x unified',
    hoverlabel: {
      bgcolor: '#040a15', bordercolor: '#0cf5',
      font: { color: '#eaf6ff', size: 11 },
    },
  };

  const config = {
    responsive: true,
    displaylogo: false,
    modeBarButtonsToRemove: ['lasso2d', 'select2d'],
  };

  Plotly.newPlot(body, traces, layout, config);
  setTimeout(() => { try { Plotly.Plots.resize(body); } catch (e) {} }, 50);
}

// ═══════════════════════════════════════════
// 未来ラベル生成（X の配列を受け取る）
// ═══════════════════════════════════════════
function futureLabels(xVals, n) {
  const lastLabel = String(xVals[xVals.length - 1]);
  let m;

  m = /^(\d{4})-(\d{1,2})$/.exec(lastLabel);
  if (m) {
    let y = +m[1], mo = +m[2];
    const out = [];
    for (let i = 0; i < n; i++) {
      mo++; if (mo > 12) { mo = 1; y++; }
      out.push(`${y}-${String(mo).padStart(2, '0')}`);
    }
    return out;
  }

  m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(lastLabel);
  if (m) {
    const base = new Date(+m[1], +m[2] - 1, +m[3]);
    const out = [];
    for (let i = 1; i <= n; i++) {
      const d = new Date(base); d.setDate(d.getDate() + i);
      out.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
    }
    return out;
  }

  m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})/.exec(lastLabel);
  if (m) {
    const base = new Date(+m[1], +m[2] - 1, +m[3]);
    const out = [];
    for (let i = 1; i <= n; i++) {
      const d = new Date(base); d.setDate(d.getDate() + i);
      out.push(`${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`);
    }
    return out;
  }

  m = /^(\d{4})\/(\d{1,2})$/.exec(lastLabel);
  if (m) {
    let y = +m[1], mo = +m[2];
    const out = [];
    for (let i = 0; i < n; i++) {
      mo++; if (mo > 12) { mo = 1; y++; }
      out.push(`${y}/${String(mo).padStart(2, '0')}`);
    }
    return out;
  }

  m = /^(\d{4})$/.exec(lastLabel);
  if (m) {
    let y = +m[1];
    const out = [];
    for (let i = 1; i <= n; i++) out.push(String(y + i));
    return out;
  }

  const nums = xVals.map(Number).filter(Number.isFinite);
  if (nums.length > 1) {
    const maxX = Math.max(...nums);
    const minX = Math.min(...nums);
    const step = (maxX - minX) / (nums.length - 1);
    const out = [];
    for (let i = 1; i <= n; i++) {
      out.push(maxX + step * i);
    }
    return out;
  }

  return Array.from({ length: n }, (_, i) => `+${i + 1}`);
}