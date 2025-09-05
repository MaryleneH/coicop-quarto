// --------------------------- Config & state ------------------------------
const CSV_URL = 'data/coicop_example.csv';
let rows = [];

// ------------------------------ Utils ----------------------------------
const fmtPct = (x) => (Number.isFinite(x) ? `${x.toFixed(1)} %` : '');
const parseFloatSafe = (x) => { const n = parseFloat(x); return Number.isFinite(n) ? n : NaN; };
const uniqueSorted = (arr) => Array.from(new Set(arr)).sort((a,b)=> a.localeCompare(b,'fr'));

const toCSV = (arr) => {
  if (!arr.length) return '';
  const cols = Object.keys(arr[0]);
  const esc = (s) => '"' + String(s).replaceAll('"', '""') + '"';
  const head = cols.join(',');
  const body = arr.map(r => cols.map(c => esc(r[c] ?? '')).join(',')).join('
');
  return head + '
' + body + '
';
};
const downloadBlob = (filename, text) => { const blob = new Blob([text], {type: 'text/csv;charset=utf-8'}); const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=filename; a.click(); URL.revokeObjectURL(url); };

// ----------------------------- CSV IO -----------------------------------
async function loadCSVFromURL(url) { const res = await fetch(url); const text = await res.text(); return parseCSV(text); }
function parseCSV(text) {
  const lines = text.split(/
?
/).filter(Boolean);
  const head = lines.shift().match(/([^",]+|"[^"]*(?:""[^"]*)*")(?=,|$)/g).map(h=>h.replaceAll('""','"').replace(/^"|"$/g,''));
  const idx = Object.fromEntries(head.map((h,i)=>[h.trim(), i]));
  return lines.map(line => {
    const cells = line.match(/([^",]+|"[^"]*(?:""[^"]*)*")(?=,|$)/g)?.map(s=>s.replaceAll('""','"').replace(/^"|"$/g,'')) ?? line.split(',');
    return { code: cells[idx.code]?.trim(), label_fr: cells[idx.label_fr]?.trim(), parent: (cells[idx.parent]?.trim() || ''), level: cells[idx.level]?.trim(), weight: cells[idx.weight] ? parseFloatSafe(cells[idx.weight]) : NaN };
  }).filter(r => r.code);
}

// ----------------------------- Filtering --------------------------------
function filteredRows() {
  const root = document.querySelector('#root-select').value;
  const q = document.querySelector('#search-input').value?.toLowerCase() ?? '';
  let data = rows;
  if (root && root !== '(Tout)') data = data.filter(r => r.code === root || r.code.startsWith(root + '.'));
  if (q) data = data.filter(r => r.code.toLowerCase().includes(q) || (r.label_fr||'').toLowerCase().includes(q));
  return data;
}

// ----------------------------- KPIs -------------------------------------
function renderKpis() {
  const data = filteredRows();
  const n = data.length;
  const sum = data.reduce((acc, r) => acc + (Number.isFinite(r.weight) ? r.weight : 0), 0);
  const el = document.querySelector('#kpis');
  el.innerHTML = `
    <div class="card"><div class="title">Catégories (filtrées)</div><div class="value">${n.toLocaleString('fr-FR')}</div></div>
    <div class="card"><div class="title">Somme des poids (vue)</div><div class="value">${fmtPct(sum)}</div></div>
  `;
}

// ------------------------------ Plotly ----------------------------------
function ensureParentsSubset(data) {
  const byCode = new Map(rows.map(r => [r.code, r]));
  const keep = new Map(data.map(r => [r.code, r]));
  const addAncestor = (code) => { const r = byCode.get(code); if (!r) return; if (!keep.has(code)) keep.set(code, r); if (r.parent) addAncestor(r.parent); };
  for (const r of data) if (r.parent) addAncestor(r.parent);
  return Array.from(keep.values());
}

function plot() {
  const kind = document.querySelector('#kind-select').value;
  const depth = document.querySelector('#depth-select').value;
  let data = filteredRows();
  data = ensureParentsSubset(data);

  const hasAnyWeight = data.some(r => Number.isFinite(r.weight));
  const values = data.map(r => hasAnyWeight ? (Number.isFinite(r.weight) ? r.weight : 0) : 1);
  const ids = data.map(r => r.code);
  const labels = data.map(r => `${r.code} — ${r.label_fr}`);
  const parents = data.map(r => r.parent || '');

  const base = { ids, labels, parents, values, branchvalues: 'total', hovertemplate: hasAnyWeight ? '<b>%{label}</b><br>Poids : %{value:.1f} %<extra></extra>' : '<b>%{label}</b><br>Poids : non fourni<extra></extra>' };
  const trace = (kind === 'Sunburst') ? Object.assign({type:'sunburst'}, base) : Object.assign({type:'treemap', tiling:{packing:'squarify'}}, base);
  if (depth !== 'auto') trace.maxdepth = parseInt(depth, 10);

  Plotly.react('chart', [trace], {
    margin: {t: 28, l: 10, r: 10, b: 10},
    paper_bgcolor: 'white',
    plot_bgcolor: 'white',
    uniformtext: {mode:'hide', minsize:12},
    treemapcolorway: ['#2563eb','#16a34a','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#84cc16','#f97316'],
    extendsunburstcolors: true,
  }, {displayModeBar: true, displaylogo:false, responsive:true});
}

// ------------------------------ Table -----------------------------------
function renderTable() {
  const data = filteredRows().slice().sort((a,b)=> a.code.localeCompare(b.code,'fr'));
  const el = document.querySelector('#table');
  if (!data.length) { el.innerHTML = '<p>Aucune ligne.</p>'; return; }
  const header = ['code','label_fr','level','parent','poids_(%)'];
  const th = header.map(h => `<th>${h.replace('_',' ')}</th>`).join('');
  const rowsHtml = data.map(r => `<tr><td>${r.code}</td><td>${r.label_fr||''}</td><td>${r.level||''}</td><td>${r.parent||''}</td><td>${Number.isFinite(r.weight)?r.weight.toFixed(1):''}</td></tr>`).join('');
  el.innerHTML = `<table><thead><tr>${th}</tr></thead><tbody>${rowsHtml}</tbody></table>`;
}

function refresh(){ plot(); renderTable(); renderKpis(); }

// ------------------------------ UI wiring -------------------------------
function populateRoots() {
  const select = document.querySelector('#root-select');
  const codes = uniqueSorted(rows.filter(r => !r.parent).map(r => r.code));
  select.innerHTML = ['<option>(Tout)</option>', ...codes.map(c => `<option>${c}</option>`)].join('');
  select.value = '(Tout)';
}

function bindEvents() {
  const throttled = (fn, ms=100) => { let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); }; };
  window.addEventListener('resize', throttled(()=> Plotly.Plots.resize('chart'), 150));
  document.querySelector('#root-select').addEventListener('change', refresh);
  document.querySelector('#kind-select').addEventListener('change', refresh);
  document.querySelector('#depth-select').addEventListener('change', refresh);
  document.querySelector('#search-input').addEventListener('input', throttled(refresh, 200));
  document.querySelector('#download-btn').addEventListener('click', () => { const data = filteredRows(); downloadBlob('coicop_filtre.csv', toCSV(data)); });
  document.querySelector('#file-input').addEventListener('change', async (ev) => {
    const file = ev.target.files?.[0]; if (!file) return; const text = await file.text(); rows = parseCSV(text); populateRoots(); refresh();
  });
}

// ------------------------------- Boot -----------------------------------

(async function init(){ rows = await loadCSVFromURL(CSV_URL); populateRoots(); bindEvents(); refresh(); })();

// Utilities ---------------------------------------------------------------

const CSV_URL = 'data/coicop_example.csv';
let rows = [];

const parseFloatSafe = (x) => {
  const n = parseFloat(x);
  return Number.isFinite(n) ? n : NaN;
};

const toCSV = (arr) => {
  if (!arr.length) return '';
  const cols = Object.keys(arr[0]);
  const esc = (s) => '"' + String(s).replaceAll('"', '""') + '"';
  const head = cols.join(',');
  const body = arr.map(r => cols.map(c => esc(r[c] ?? '')).join(',')).join('\n');
  return head + '\n' + body + '\n';
};

const downloadBlob = (filename, text) => {
  const blob = new Blob([text], {type: 'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
};

const uniqueSorted = (arr) => Array.from(new Set(arr)).sort((a,b) => a.localeCompare(b));

// Data loading ------------------------------------------------------------
async function loadCSVFromURL(url) {
  const res = await fetch(url);
  const text = await res.text();
  return parseCSV(text);
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const head = lines.shift().split(',');
  const idx = Object.fromEntries(head.map((h,i)=>[h.trim(), i]));
  return lines.map(line => {
    // naive split supports quoted fields minimalistically
    const cells = line.match(/([^",]+|"[^"]*(?:""[^"]*)*")(?=,|$)/g)?.map(s=>s.replaceAll('""','"').replace(/^"|"$/g,'')) ?? line.split(',');
    return {
      code: cells[idx.code]?.trim(),
      label_fr: cells[idx.label_fr]?.trim(),
      parent: (cells[idx.parent]?.trim() || ''),
      level: cells[idx.level]?.trim(),
      weight: cells[idx.weight] ? parseFloatSafe(cells[idx.weight]) : NaN,
    };
  }).filter(r => r.code);
}

// Filtering ---------------------------------------------------------------
function filteredRows() {
  const root = document.querySelector('#root-select').value;
  const q = document.querySelector('#search-input').value?.toLowerCase() ?? '';
  let data = rows;
  if (root && root !== '(All)') data = data.filter(r => r.code === root || r.code.startsWith(root + '.'));
  if (q) data = data.filter(r => r.code.toLowerCase().includes(q) || (r.label_fr||'').toLowerCase().includes(q));
  return data;
}

// Plotly charts -----------------------------------------------------------
function ensureParentsSubset(data) {
  // Make sure ancestors of filtered codes are present (Plotly requires complete parent chain)
  const byCode = new Map(rows.map(r => [r.code, r]));
  const keep = new Map(data.map(r => [r.code, r]));
  const addAncestor = (code) => {
    const r = byCode.get(code);
    if (!r) return;
    if (!keep.has(code)) keep.set(code, r);
    if (r.parent) addAncestor(r.parent);
  };
  for (const r of data) if (r.parent) addAncestor(r.parent);
  return Array.from(keep.values());
}

function plot() {
  const kind = document.querySelector('#kind-select').value;
  let data = filteredRows();
  data = ensureParentsSubset(data);

  // If all weights are missing/NaN, use uniform sizes
  const hasAnyWeight = data.some(r => Number.isFinite(r.weight));
  const values = data.map(r => hasAnyWeight ? (Number.isFinite(r.weight) ? r.weight : 0) : 1);

  const ids = data.map(r => r.code);
  const labels = data.map(r => `${r.code} — ${r.label_fr}`);
  const parents = data.map(r => r.parent || '');

  const trace = (kind === 'Sunburst') ? {
    type: 'sunburst',
    ids, labels, parents, values, branchvalues: 'total'
  } : {
    type: 'treemap',
    ids, labels, parents, values, branchvalues: 'total'
  };

  Plotly.react('chart', [trace], {
    margin: {t: 30, l: 0, r: 0, b: 0},
  }, {displayModeBar: true});
}

// Table ------------------------------------------------------------------
function renderTable() {
  const data = filteredRows().slice().sort((a,b)=> a.code.localeCompare(b.code));
  const el = document.querySelector('#table');
  if (!data.length) { el.innerHTML = '<p>No rows.</p>'; return; }
  const header = ['code','label_fr','level','parent','weight'];
  const th = header.map(h => `<th>${h}</th>`).join('');
  const rowsHtml = data.map(r => `<tr><td>${r.code}</td><td>${r.label_fr||''}</td><td>${r.level||''}</td><td>${r.parent||''}</td><td>${Number.isFinite(r.weight)?r.weight:''}</td></tr>`).join('');
  el.innerHTML = `<table><thead><tr>${th}</tr></thead><tbody>${rowsHtml}</tbody></table>`;
}

function refresh() { plot(); renderTable(); }

// UI wiring ---------------------------------------------------------------
function populateRoots() {
  const select = document.querySelector('#root-select');
  const codes = uniqueSorted(rows.filter(r => !r.parent).map(r => r.code));
  select.innerHTML = ['<option>(All)</option>', ...codes.map(c => `<option>${c}</option>`)].join('');
  select.value = '(All)';
}

function bindEvents() {
  document.querySelector('#root-select').addEventListener('change', refresh);
  document.querySelector('#kind-select').addEventListener('change', refresh);
  document.querySelector('#search-input').addEventListener('input', refresh);
  document.querySelector('#download-btn').addEventListener('click', () => {
    const data = filteredRows();
    downloadBlob('coicop_filtered.csv', toCSV(data));
  });
  document.querySelector('#file-input').addEventListener('change', async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    rows = parseCSV(text);
    populateRoots();
    refresh();
  });
}

// Boot -------------------------------------------------------------------
(async function init() {
  rows = await loadCSVFromURL(CSV_URL);
  populateRoots();
  bindEvents();
  refresh();
})();