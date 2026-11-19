import * as S from './store.js';
import * as D from './drive.js';
import { lineChart, budgetBars, groupedBars, ring } from './charts.js';

const { fmt, fmt2, GROUPS } = S;
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const parseAmount = (v) => {
  const s = String(v || '').replace(/\s|€/g, '');
  // admite "1.234,56", "1234,56" y "1234.56"
  const norm = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  const n = parseFloat(norm);
  return Number.isFinite(n) ? n : null;
};
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const userName = () => localStorage.getItem('cp.user') || (D.email() ? D.email().split('@')[0] : '');

const state = {
  view: localStorage.getItem('cp.view') || 'mes',
  month: S.monthKey(),
  concept: 'resumen',
  openCats: new Set(),
};

// ======================= Arranque =======================
S.load();
const redirect = D.handleRedirect();
let toastMsg = null;
if (redirect?.ok) toastMsg = 'Conectado con Google Drive';
else if (redirect?.error && redirect.error !== 'silent') toastMsg = 'Google: ' + redirect.error;

if (!redirect && D.autoReconnect()) {
  // se está redirigiendo a Google para renovar la sesión
} else {
  init();
}

function init() {
  S.ensureMonth(S.monthKey());
  S.onChange((origin) => {
    if (origin === 'local') D.scheduleSync();
    render();
  });
  D.onStatus(renderStatus);
  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') D.sync();
  });
  window.addEventListener('online', () => D.sync());
  render();
  D.sync();
  if (toastMsg) toast(toastMsg);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// ======================= Render =======================
function render() {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === state.view));
  $('#fab').hidden = !(state.view === 'mes' || state.view === 'dashboard');
  const v = $('#view');
  const y = window.scrollY;
  v.innerHTML = { mes: viewMes, dashboard: viewDashboard, historico: viewHistorico, ajustes: viewAjustes }[state.view]();
  window.scrollTo(0, y);
}

function go(view) {
  state.view = view;
  localStorage.setItem('cp.view', view);
  render();
  window.scrollTo(0, 0);
}

function renderStatus(st) {
  const el = $('#sync');
  if (!el) return;
  el.className = 'sync ' + st.state;
  el.title = st.msg;
  $('#sync-label').textContent =
    { off: 'Local', busy: 'Sync…', ok: 'Drive', auth: 'Reconectar', error: 'Error', offline: 'Offline' }[st.state] || '';
  if (state.view === 'ajustes') {
    const m = $('#drive-msg');
    if (m) m.textContent = st.msg;
  }
}

function monthNav() {
  return `<div class="monthnav">
    <button class="icon-btn" data-action="month" data-d="-1" aria-label="Mes anterior">‹</button>
    <h2>${S.monthLabel(state.month)}</h2>
    <button class="icon-btn" data-action="month" data-d="1" aria-label="Mes siguiente">›</button>
  </div>`;
}

// ---------- Pantalla: Mes (toma de datos) ----------
function viewMes() {
  const m = S.getMonth(state.month);
  if (!m) {
    return `${monthNav()}
      <div class="card center">
        <p class="muted">Este mes todavía no tiene datos.</p>
        <button class="btn primary" data-action="start-month">Empezar ${S.monthLabel(state.month)}</button>
        <p class="small muted">Se copiarán los ingresos del mes anterior y el reparto objetivo actual.</p>
      </div>`;
  }
  const s = S.summary(state.month);
  const avail = s.balance;
  const usedPct = s.income > 0 ? Math.min(100, ((s.spent + s.saved) / s.income) * 100) : 0;

  let html = monthNav();
  html += `<div class="card hero">
    <div class="hero-main"><span class="muted small">Disponible</span><strong class="${avail < 0 ? 'neg' : ''}">${fmt(avail)}</strong></div>
    <div class="progress"><div style="width:${usedPct}%"></div></div>
    <div class="kpis">
      <div><span>Ingresos</span><b>${fmt(s.income)}</b></div>
      <div><span>Gastado</span><b>${fmt(s.spent)}</b></div>
      <div><span>Ahorrado</span><b class="pos">${fmt(s.saved)}</b></div>
    </div>
  </div>`;

  // Ingresos
  html += `<div class="card">
    <div class="card-head"><h3>Ingresos del mes</h3><button class="link" data-action="income-edit">+ Añadir</button></div>
    ${m.incomes.length ? m.incomes.map((i) => `<button class="row" data-action="income-edit" data-id="${i.id}"><span>💶 ${esc(i.name)}</span><b>${fmt2(i.amount)}</b></button>`).join('') : '<p class="muted small">Añade tus nóminas y otros ingresos. Se copiarán automáticamente al mes siguiente.</p>'}
  </div>`;

  // Partidas por grupo
  for (const [g, meta] of Object.entries(GROUPS)) {
    const rows = Object.values(s.byCat).filter((r) => r.cat.group === g && (r.pct > 0 || r.real !== 0 || !r.cat.archived));
    if (!rows.length) continue;
    const G = s.groups[g];
    html += `<div class="card">
      <div class="card-head"><h3><i class="dot" style="background:${meta.color}"></i>${meta.label} <span class="muted small">${G.pct.toFixed(0)} %</span></h3>
      <span class="small ${G.real > G.budget && g !== 'ahorro' ? 'neg' : 'muted'}">${fmt(G.real)} / ${fmt(G.budget)}</span></div>
      ${rows.map((r) => catRow(r, g)).join('')}
    </div>`;
  }

  // Movimientos
  const mvs = S.movementsOf(state.month);
  html += `<div class="card"><div class="card-head"><h3>Movimientos</h3><span class="muted small">${mvs.length}</span></div>
    ${mvs.length ? movementList(mvs) : '<p class="muted small">Pulsa el botón + para apuntar un gasto o una aportación al ahorro.</p>'}
  </div>`;
  return html;
}

function catRow(r, g) {
  const left = r.budget - r.real;
  const p = r.budget > 0 ? Math.min(100, (r.real / r.budget) * 100) : r.real > 0 ? 100 : 0;
  const over = g !== 'ahorro' && r.real > r.budget && r.real > 0;
  const color = over ? 'var(--bad)' : GROUPS[g].color;
  return `<button class="catrow" data-action="cat-detail" data-id="${r.cat.id}">
    <span class="ico">${esc(r.cat.icon || '•')}</span>
    <span class="catrow-body">
      <span class="catrow-top"><span>${esc(r.cat.name)}</span><span class="${over ? 'neg' : ''}">${fmt(r.real)}<span class="muted"> / ${fmt(r.budget)}</span></span></span>
      <span class="mini"><span style="width:${p}%;background:${color}"></span></span>
      <span class="catrow-sub muted">${g === 'ahorro' ? (left > 0 ? `Faltan ${fmt(left)} para el objetivo` : 'Objetivo cumplido ✓') : left >= 0 ? `Quedan ${fmt(left)}` : `Excedido en ${fmt(-left)}`}</span>
    </span>
  </button>`;
}

function movementList(mvs) {
  let html = '';
  let lastDate = '';
  for (const mv of mvs) {
    if (mv.date !== lastDate) {
      lastDate = mv.date;
      const d = new Date(mv.date + 'T12:00:00');
      html += `<div class="daysep">${d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' })}</div>`;
    }
    const c = S.category(mv.catId) || { name: '¿?', icon: '❓', group: 'estilo' };
    html += `<button class="mvrow" data-action="mv-edit" data-id="${mv.id}">
      <span class="ico">${esc(c.icon)}</span>
      <span class="mv-body"><span>${esc(mv.note || c.name)}</span><span class="muted small">${esc(mv.note ? c.name : '')}${mv.by ? `${mv.note ? ' · ' : ''}${esc(mv.by)}` : ''}</span></span>
      <b class="${c.group === 'ahorro' ? 'pos' : ''}">${mv.amount < 0 ? '−' : ''}${fmt2(Math.abs(mv.amount))}</b>
    </button>`;
  }
  return html;
}

// ---------- Pantalla: Dashboard ----------
function lastMonths(n, upto = state.month) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(S.shiftMonth(upto, -i));
  const first = S.allMonthKeys()[0];
  return out.filter((k) => !first || k >= first);
}

function viewDashboard() {
  const s = S.summary(state.month);
  const risks = S.risks(state.month);
  const scored = risks.filter((r) => r.level !== 'na');
  const bad = scored.filter((r) => r.level === 'bad').length;
  const warn = scored.filter((r) => r.level === 'warn').length;
  const overall = bad >= 2 ? 'bad' : bad === 1 || warn >= 2 ? 'warn' : 'ok';
  const overallTxt = { ok: 'Riesgo bajo', warn: 'Riesgo moderado', bad: 'Riesgo alto' }[overall];
  const spendBudget = s.groups.necesidades.budget + s.groups.estilo.budget;

  let html = monthNav();
  html += `<div class="card rings">
    <div>${ring(s.savingsRate ?? 0, 'var(--ok)', s.savingsRate == null ? '—' : Math.round(s.savingsRate * 100) + '%')}<span>Tasa de ahorro</span></div>
    <div>${ring(spendBudget ? s.spent / spendBudget : 0, s.spent > spendBudget ? 'var(--bad)' : 'var(--accent)', spendBudget ? Math.round((s.spent / spendBudget) * 100) + '%' : '—')}<span>Presupuesto gastado</span></div>
    <div>${ring(s.income ? Math.max(0, s.balance) / s.income : 0, 'var(--estilo)', fmt(s.balance))}<span>Disponible</span></div>
  </div>`;

  html += `<div class="card">
    <div class="card-head"><h3>Indicadores de riesgo</h3><span class="pill ${overall}">${overallTxt}</span></div>
    ${risks.map((r) => `<div class="risk ${r.level}"><i></i><div><div class="risk-top"><span>${r.title}</span><b>${esc(r.value)}</b></div><div class="small muted">${esc(r.hint)}</div></div></div>`).join('')}
  </div>`;

  html += `<div class="card"><h3>Objetivo vs real</h3>
    ${groupedBars({
      groups: Object.entries(GROUPS).map(([g, m]) => ({
        label: m.label,
        bars: [
          { value: s.groups[g].budget, color: m.color, faded: true },
          { value: s.groups[g].real, color: m.color },
        ],
      })),
    })}
    <div class="legend"><span class="lg"><i style="background:var(--muted);opacity:.4"></i>Objetivo</span><span class="lg"><i style="background:var(--muted)"></i>Real</span></div>
  </div>`;

  html += `<div class="card"><h3>Partidas del mes</h3>
    ${budgetBars(
      Object.values(s.byCat)
        .filter((r) => r.budget > 0 || r.real !== 0)
        .sort((a, b) => Object.keys(GROUPS).indexOf(a.cat.group) - Object.keys(GROUPS).indexOf(b.cat.group))
        .map((r) => ({ label: `${r.cat.icon || ''} ${r.cat.name}`, real: r.real, budget: r.budget, color: GROUPS[r.cat.group]?.color })),
      fmt
    )}
  </div>`;

  // Evolución
  const keys = lastMonths(12);
  const labels = keys.map((k) => S.monthLabel(k, true));
  const sums = keys.map((k) => S.summary(k));
  const opts = [
    ['resumen', 'Ingresos, gastos y ahorro'],
    ['balance', 'Balance mensual'],
    ...Object.entries(GROUPS).map(([g, m]) => ['g:' + g, 'Grupo · ' + m.label]),
    ...S.activeCategories().map((c) => ['c:' + c.id, `${c.icon} ${c.name}`]),
  ];
  let chart;
  if (state.concept === 'resumen') {
    chart = lineChart({
      labels,
      series: [
        { name: 'Ingresos', color: 'var(--accent)', values: sums.map((x) => x.income) },
        { name: 'Gastos', color: 'var(--bad)', values: sums.map((x) => x.spent) },
        { name: 'Ahorro', color: 'var(--ok)', values: sums.map((x) => x.saved) },
      ],
    });
  } else if (state.concept === 'balance') {
    chart = lineChart({ labels, series: [{ name: 'Balance', color: 'var(--estilo)', values: sums.map((x) => x.balance) }] });
  } else if (state.concept.startsWith('g:')) {
    const g = state.concept.slice(2);
    chart = lineChart({
      labels,
      series: [
        { name: 'Real', color: GROUPS[g].color, values: sums.map((x) => x.groups[g].real) },
        { name: 'Objetivo', color: GROUPS[g].color, dashed: true, values: sums.map((x) => x.groups[g].budget) },
      ],
    });
  } else {
    const id = state.concept.slice(2);
    const c = S.category(id);
    const col = GROUPS[c?.group]?.color || 'var(--accent)';
    chart = lineChart({
      labels,
      series: [
        { name: 'Real', color: col, values: sums.map((x) => x.byCat[id]?.real ?? 0) },
        { name: 'Objetivo', color: col, dashed: true, values: sums.map((x) => x.byCat[id]?.budget ?? 0) },
      ],
    });
  }
  html += `<div class="card"><h3>Evolución (12 meses)</h3>
    <select class="select" data-action="concept">${opts.map(([v, l]) => `<option value="${v}" ${v === state.concept ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
    ${chart}
  </div>`;

  // Ahorro acumulado
  let acc = 0;
  const before = S.cumulative(S.shiftMonth(keys[0] || state.month, -1)).saved;
  acc = before;
  const accVals = sums.map((x) => (acc += x.saved));
  html += `<div class="card"><h3>Ahorro acumulado</h3>${lineChart({ labels, series: [{ name: 'Ahorro acumulado', color: 'var(--ok)', values: accVals }] })}</div>`;
  return html;
}

// ---------- Pantalla: Histórico ----------
function viewHistorico() {
  const tot = S.cumulative();
  const keys = S.allMonthKeys().filter((k) => S.summary(k).hasData).reverse();
  let html = `<h2 class="title">Histórico</h2>`;
  html += `<div class="card">
    <div class="card-head"><h3>Acumulado total</h3><span class="muted small">${tot.months} ${tot.months === 1 ? 'mes' : 'meses'}</span></div>
    <div class="kpis kpis-4">
      <div><span>Ingresos</span><b>${fmt(tot.income)}</b></div>
      <div><span>Gastos</span><b>${fmt(tot.spent)}</b></div>
      <div><span>Ahorro</span><b class="pos">${fmt(tot.saved)}</b></div>
      <div><span>Balance</span><b class="${tot.balance < 0 ? 'neg' : ''}">${fmt(tot.balance)}</b></div>
    </div>
    <p class="small muted">Tasa de ahorro media: <b>${tot.savingsRate == null ? '—' : (tot.savingsRate * 100).toFixed(1) + ' %'}</b>${tot.months ? ` · Gasto medio mensual: <b>${fmt(tot.spent / tot.months)}</b>` : ''}</p>
    ${budgetBars(Object.entries(GROUPS).map(([g, m]) => ({ label: m.label, real: tot.groups[g].real, budget: tot.groups[g].budget, color: m.color })), fmt)}
    <details class="details"><summary>Detalle por partida</summary>
      <table class="tbl"><thead><tr><th>Partida</th><th>Real</th><th>Objetivo</th><th>Desv.</th></tr></thead><tbody>
      ${Object.values(tot.byCat)
        .filter((r) => r.real || r.budget)
        .map((r) => {
          const d = r.real - r.budget;
          const bad = r.cat.group === 'ahorro' ? d < 0 : d > 0;
          return `<tr><td>${esc(r.cat.icon || '')} ${esc(r.cat.name)}</td><td>${fmt(r.real)}</td><td>${fmt(r.budget)}</td><td class="${bad ? 'neg' : 'pos'}">${d >= 0 ? '+' : ''}${fmt(d)}</td></tr>`;
        })
        .join('')}
      </tbody></table>
    </details>
  </div>`;

  html += `<div class="card"><h3>Meses</h3>`;
  if (!keys.length) html += '<p class="muted small">Aún no hay meses con datos.</p>';
  for (const k of keys) {
    const s = S.summary(k);
    const r = s.savingsRate;
    const lvl = r == null ? 'na' : r >= 0.2 ? 'ok' : r >= 0.1 ? 'warn' : 'bad';
    html += `<button class="hrow" data-action="open-month" data-k="${k}">
      <div class="hrow-top"><b>${S.monthLabel(k)}</b><span class="pill ${lvl}">${r == null ? '—' : Math.round(r * 100) + ' % ahorro'}</span></div>
      <div class="hrow-grid"><span>Ingresos<b>${fmt(s.income)}</b></span><span>Gastos<b>${fmt(s.spent)}</b></span><span>Ahorro<b class="pos">${fmt(s.saved)}</b></span><span>Balance<b class="${s.balance < 0 ? 'neg' : ''}">${fmt(s.balance)}</b></span></div>
    </button>`;
  }
  html += `</div>`;
  return html;
}

// ---------- Pantalla: Ajustes ----------
function viewAjustes() {
  const st = D.getStatus();
  const cats = S.get().categories.filter((c) => !c.archived);
  const total = cats.reduce((a, c) => a + (Number(c.pct) || 0), 0);
  let html = `<h2 class="title">Ajustes</h2>`;

  html += `<div class="card"><h3>Este móvil</h3>
    <label class="field"><span>Tu nombre (aparece en los movimientos que apuntes)</span>
    <input class="input" data-action="username" value="${esc(localStorage.getItem('cp.user') || '')}" placeholder="${esc(userName() || 'Ej.: Pedro')}"></label>
  </div>`;

  // Drive
  html += `<div class="card"><h3>Google Drive</h3>
    <p class="small" id="drive-msg">${esc(st.msg)}</p>`;
  if (D.isConnected()) {
    html += `<p class="small muted">Cuenta: <b>${esc(D.email() || '—')}</b><br>Última sincronización: ${D.lastSync() ? new Date(D.lastSync()).toLocaleString('es-ES') : '—'}</p>
      <div class="btns"><button class="btn primary" data-action="sync">Sincronizar ahora</button>
      ${st.state === 'auth' ? '<button class="btn" data-action="login">Reconectar</button>' : ''}
      <button class="btn ghost" data-action="logout">Desconectar</button></div>
      <div id="file-info" class="small muted"></div>
      <label class="field"><span>Compartir con la otra persona (su email de Google)</span>
      <div class="inline"><input class="input" id="share-email" type="email" placeholder="correo@gmail.com"><button class="btn" data-action="share">Compartir</button></div></label>
      <details class="details"><summary>Usar un archivo compartido por otra persona</summary>
        <p class="small muted">Normalmente no hace falta: la app encuentra sola el archivo compartido contigo. Si hay varios, pega aquí el enlace del correcto.</p>
        <div class="inline"><input class="input" id="file-link" placeholder="Enlace o ID del archivo"><button class="btn" data-action="use-file">Usar</button></div>
      </details>`;
  } else {
    html += `<p class="small muted">Conecta tu cuenta de Google para guardar los datos en Drive y compartirlos con el otro móvil. Mientras tanto, todo se guarda en este dispositivo.</p>
      <button class="btn primary" data-action="login" ${D.clientId() ? '' : 'disabled'}>Conectar con Google</button>`;
  }
  html += `<details class="details" ${D.clientId() ? '' : 'open'}><summary>Configuración técnica</summary>
      <label class="field"><span>ID de cliente OAuth de Google</span><input class="input" data-action="clientid" value="${esc(D.clientId())}" placeholder="xxxx.apps.googleusercontent.com"></label>
      <p class="small muted">URI de redirección autorizada que debes registrar en Google Cloud:</p>
      <code class="code" data-action="copy" data-text="${esc(D.redirectUri())}">${esc(D.redirectUri())}</code>
      <p class="small muted">Origen JavaScript autorizado:</p>
      <code class="code" data-action="copy" data-text="${esc(location.origin)}">${esc(location.origin)}</code>
    </details>
  </div>`;

  // Reparto
  html += `<div class="card"><div class="card-head"><h3>Partidas y reparto objetivo</h3><span class="pill ${Math.abs(total - 100) < 0.01 ? 'ok' : 'bad'}">${total.toFixed(1).replace('.0', '')} %</span></div>
    <p class="small muted">Porcentaje de los ingresos asignado a cada partida. Debe sumar 100 %. Los cambios se aplican al mes actual y siguientes; los meses pasados conservan su objetivo.</p>
    <div class="btns"><button class="btn small" data-action="preset" data-p="50,30,20">50/30/20</button><button class="btn small" data-action="preset" data-p="50,20,30">50/20/30</button><button class="btn small" data-action="preset" data-p="60,20,20">60/20/20</button></div>`;
  for (const [g, m] of Object.entries(GROUPS)) {
    const gc = cats.filter((c) => c.group === g);
    const gt = gc.reduce((a, c) => a + (Number(c.pct) || 0), 0);
    html += `<div class="grp"><div class="grp-head"><i class="dot" style="background:${m.color}"></i>${m.label}<span class="muted">${gt.toFixed(1).replace('.0', '')} %</span></div>
      ${gc.map((c) => `<div class="pctrow"><button class="link left" data-action="cat-edit" data-id="${c.id}">${esc(c.icon)} ${esc(c.name)}</button>
        <input class="input pct" inputmode="decimal" data-action="pct" data-id="${c.id}" value="${c.pct}"><span class="muted">%</span></div>`).join('')}
    </div>`;
  }
  html += `<button class="btn" data-action="cat-edit">+ Nueva partida</button></div>`;

  // Datos
  html += `<div class="card"><h3>Datos</h3>
    <div class="btns"><button class="btn" data-action="export">Exportar copia (JSON)</button><button class="btn" data-action="export-csv">Exportar movimientos (CSV)</button>
    <label class="btn">Importar copia<input type="file" accept="application/json,.json" data-action="import" hidden></label></div>
    <p class="small muted">Instala la app: en Safari pulsa Compartir → «Añadir a pantalla de inicio».</p>
  </div>`;

  setTimeout(loadFileInfo, 0);
  return html;
}

async function loadFileInfo() {
  const el = $('#file-info');
  if (!el) return;
  try {
    const info = await D.fileInfo();
    if (!info) return;
    const people = (info.permissions || []).filter((p) => p.emailAddress).map((p) => `${esc(p.displayName || p.emailAddress)} (${p.role === 'owner' ? 'propietario' : p.role === 'writer' ? 'editor' : p.role})`);
    el.innerHTML = `Archivo: <a href="${esc(info.webViewLink)}" target="_blank" rel="noopener">${esc(info.name)}</a>${people.length ? '<br>Acceso: ' + people.join(', ') : ''}`;
  } catch {}
}

// ======================= Hojas (formularios) =======================
function openSheet(html, onMount) {
  const sh = $('#sheet');
  $('#sheet-body').innerHTML = html;
  sh.hidden = false;
  requestAnimationFrame(() => sh.classList.add('open'));
  onMount?.($('#sheet-body'));
}
function closeSheet() {
  const sh = $('#sheet');
  sh.classList.remove('open');
  setTimeout(() => { sh.hidden = true; $('#sheet-body').innerHTML = ''; }, 220);
}

function categoryChips(selected) {
  return Object.entries(GROUPS).map(([g, m]) => {
    const cs = S.activeCategories().filter((c) => c.group === g);
    return `<div class="chips-title">${m.label}</div><div class="chips">${cs.map((c) => `<button type="button" class="chip ${c.id === selected ? 'sel' : ''}" data-cat="${c.id}" style="--c:${m.color}">${esc(c.icon)} ${esc(c.name)}</button>`).join('')}</div>`;
  }).join('');
}

function movementSheet(mv = null, presetCat = null) {
  const isNew = !mv;
  const [y, mo] = state.month.split('-').map(Number);
  const defDate = state.month === S.monthKey() ? todayISO() : `${state.month}-${String(Math.min(new Date().getDate(), S.daysInMonth(state.month))).padStart(2, '0')}`;
  let cat = mv?.catId || presetCat || '';
  openSheet(`
    <h3>${isNew ? 'Nuevo movimiento' : 'Editar movimiento'}</h3>
    <input class="input amount" id="f-amount" inputmode="decimal" placeholder="0,00 €" value="${mv ? String(Math.abs(mv.amount)).replace('.', ',') : ''}" autocomplete="off">
    <label class="check"><input type="checkbox" id="f-neg" ${mv && mv.amount < 0 ? 'checked' : ''}> Es una devolución / retirada (resta)</label>
    <div id="f-cats">${categoryChips(cat)}</div>
    <label class="field"><span>Fecha</span><input class="input" type="date" id="f-date" value="${mv?.date || defDate}"></label>
    <label class="field"><span>Nota (opcional)</span><input class="input" id="f-note" value="${esc(mv?.note || '')}" placeholder="Ej.: Mercadona"></label>
    <div class="btns end">
      ${isNew ? '' : '<button class="btn danger" id="f-del">Eliminar</button>'}
      <button class="btn ghost" data-action="close">Cancelar</button>
      <button class="btn primary" id="f-save">Guardar</button>
    </div>`, (root) => {
    if (isNew) setTimeout(() => $('#f-amount').focus(), 250);
    root.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => {
      cat = b.dataset.cat;
      root.querySelectorAll('.chip').forEach((x) => x.classList.toggle('sel', x === b));
    }));
    $('#f-save').addEventListener('click', () => {
      const amt = parseAmount($('#f-amount').value);
      if (!amt) return toast('Introduce un importe');
      if (!cat) return toast('Elige una partida');
      const date = $('#f-date').value || defDate;
      const amount = Math.abs(amt) * ($('#f-neg').checked ? -1 : 1);
      const note = $('#f-note').value.trim();
      if (isNew) S.addMovement({ amount, catId: cat, date, note, by: userName() });
      else S.updateMovement(mv.id, { amount, catId: cat, date, note });
      if (date.slice(0, 7) !== state.month) state.month = date.slice(0, 7);
      closeSheet();
      toast(isNew ? 'Apuntado' : 'Guardado');
    });
    $('#f-del')?.addEventListener('click', () => {
      if (!confirm('¿Eliminar este movimiento?')) return;
      S.deleteMovement(mv.id);
      closeSheet();
    });
  });
}

function incomeSheet(id) {
  const m = S.ensureMonth(state.month);
  const inc = m.incomes.find((i) => i.id === id);
  openSheet(`
    <h3>${inc ? 'Editar ingreso' : 'Nuevo ingreso'}</h3>
    <label class="field"><span>Concepto</span><input class="input" id="i-name" value="${esc(inc?.name || '')}" placeholder="Ej.: Nómina Pedro"></label>
    <label class="field"><span>Importe neto mensual</span><input class="input amount" id="i-amount" inputmode="decimal" value="${inc ? String(inc.amount).replace('.', ',') : ''}" placeholder="0,00 €"></label>
    <div class="btns end">
      ${inc ? '<button class="btn danger" id="i-del">Eliminar</button>' : ''}
      <button class="btn ghost" data-action="close">Cancelar</button>
      <button class="btn primary" id="i-save">Guardar</button>
    </div>`, () => {
    $('#i-save').addEventListener('click', () => {
      const name = $('#i-name').value.trim() || 'Ingreso';
      const amount = parseAmount($('#i-amount').value);
      if (amount == null) return toast('Introduce un importe');
      const incomes = m.incomes.map((i) => ({ ...i }));
      if (inc) Object.assign(incomes.find((i) => i.id === id), { name, amount });
      else incomes.push({ id: S.uid(), name, amount });
      S.updateMonth(state.month, { incomes });
      closeSheet();
    });
    $('#i-del')?.addEventListener('click', () => {
      S.updateMonth(state.month, { incomes: m.incomes.filter((i) => i.id !== id) });
      closeSheet();
    });
  });
}

function catDetailSheet(id) {
  const c = S.category(id);
  const s = S.summary(state.month);
  const r = s.byCat[id];
  const mvs = S.movementsOf(state.month).filter((m) => m.catId === id);
  openSheet(`
    <h3>${esc(c.icon)} ${esc(c.name)}</h3>
    <div class="kpis"><div><span>Objetivo</span><b>${fmt(r?.budget || 0)}</b></div><div><span>Real</span><b>${fmt(r?.real || 0)}</b></div><div><span>${c.group === 'ahorro' ? 'Pendiente' : 'Queda'}</span><b>${fmt((r?.budget || 0) - (r?.real || 0))}</b></div></div>
    <p class="small muted">${r?.pct ?? 0} % de los ingresos de ${S.monthLabel(state.month).toLowerCase()}.</p>
    ${mvs.length ? movementList(mvs) : '<p class="muted small">Sin movimientos este mes.</p>'}
    <div class="btns end"><button class="btn ghost" data-action="close">Cerrar</button><button class="btn primary" id="d-add">+ Apuntar aquí</button></div>
  `, () => {
    $('#d-add').addEventListener('click', () => movementSheet(null, id));
  });
}

function categoryEditSheet(id) {
  const c = id ? { ...S.category(id) } : { id: S.uid(), name: '', group: 'estilo', pct: 0, icon: '📌', archived: false };
  openSheet(`
    <h3>${id ? 'Editar partida' : 'Nueva partida'}</h3>
    <div class="inline"><input class="input icon-in" id="c-icon" value="${esc(c.icon)}" maxlength="4"><input class="input" id="c-name" value="${esc(c.name)}" placeholder="Nombre"></div>
    <label class="field"><span>Grupo</span><select class="select" id="c-group">${Object.entries(GROUPS).map(([g, m]) => `<option value="${g}" ${g === c.group ? 'selected' : ''}>${m.label}</option>`).join('')}</select></label>
    <label class="field"><span>% objetivo sobre ingresos</span><input class="input" id="c-pct" inputmode="decimal" value="${c.pct}"></label>
    <div class="btns end">
      ${id ? '<button class="btn danger" id="c-arch">Eliminar</button>' : ''}
      <button class="btn ghost" data-action="close">Cancelar</button>
      <button class="btn primary" id="c-save">Guardar</button>
    </div>`, () => {
    $('#c-save').addEventListener('click', () => {
      c.name = $('#c-name').value.trim();
      if (!c.name) return toast('Pon un nombre');
      c.icon = $('#c-icon').value.trim() || '•';
      c.group = $('#c-group').value;
      c.pct = parseAmount($('#c-pct').value) || 0;
      S.upsertCategory(c);
      applyTargetsToCurrentAndFuture();
      closeSheet();
    });
    $('#c-arch')?.addEventListener('click', () => {
      if (!confirm('Se ocultará la partida. Los movimientos ya apuntados se conservan. ¿Continuar?')) return;
      c.archived = true;
      c.pct = 0;
      S.upsertCategory(c);
      applyTargetsToCurrentAndFuture();
      closeSheet();
    });
  });
}

function applyTargetsToCurrentAndFuture() {
  const cur = S.monthKey();
  const t = S.currentTargets();
  for (const k of Object.keys(S.get().months)) if (k >= cur) S.updateMonth(k, { targets: { ...t } });
}

// ======================= Eventos =======================
function onClick(e) {
  const tab = e.target.closest('.tab');
  if (tab) return go(tab.dataset.view);
  if (e.target.id === 'sheet') return closeSheet();
  if (e.target.closest('#fab')) return movementSheet();
  if (e.target.closest('#sync')) {
    const st = D.getStatus().state;
    if (st === 'auth') return D.login();
    if (st === 'off') return go('ajustes');
    return D.sync();
  }
  const a = e.target.closest('[data-action]');
  if (!a) return;
  const act = a.dataset.action;
  switch (act) {
    case 'month': state.month = S.shiftMonth(state.month, Number(a.dataset.d)); render(); break;
    case 'start-month': S.ensureMonth(state.month); render(); break;
    case 'income-edit': incomeSheet(a.dataset.id); break;
    case 'cat-detail': catDetailSheet(a.dataset.id); break;
    case 'mv-edit': movementSheet(S.get().movements.find((m) => m.id === a.dataset.id)); break;
    case 'open-month': state.month = a.dataset.k; go('mes'); break;
    case 'close': closeSheet(); break;
    case 'login':
      try { D.login(); } catch (err) { toast(err.message); }
      break;
    case 'logout': if (confirm('¿Desconectar Google Drive en este móvil? Los datos locales se conservan.')) { D.logout(); render(); } break;
    case 'sync': D.sync().then(render); break;
    case 'share': {
      const v = $('#share-email').value;
      if (!/.+@.+\..+/.test(v)) return toast('Email no válido');
      D.shareWith(v).then(() => { toast('Compartido con ' + v); loadFileInfo(); }).catch((err) => toast(err.message));
      break;
    }
    case 'use-file': {
      const id = D.parseFileId($('#file-link').value);
      if (!id) return toast('Enlace no válido');
      D.useFile(id);
      D.sync().then(render);
      break;
    }
    case 'cat-edit': categoryEditSheet(a.dataset.id); break;
    case 'preset': applyPreset(a.dataset.p.split(',').map(Number)); break;
    case 'copy': navigator.clipboard?.writeText(a.dataset.text).then(() => toast('Copiado')); break;
    case 'export': download(`contabilidad-${S.monthKey()}.json`, JSON.stringify(S.get(), null, 2), 'application/json'); break;
    case 'export-csv': exportCsv(); break;
  }
}

function onChange(e) {
  const a = e.target.closest('[data-action]');
  if (!a) return;
  switch (a.dataset.action) {
    case 'concept': state.concept = a.value; render(); break;
    case 'username': localStorage.setItem('cp.user', a.value.trim()); toast('Guardado'); break;
    case 'clientid': D.setClientId(a.value); render(); break;
    case 'pct': {
      const c = { ...S.category(a.dataset.id) };
      c.pct = parseAmount(a.value) || 0;
      S.upsertCategory(c);
      applyTargetsToCurrentAndFuture();
      break;
    }
    case 'import': importFile(a.files[0]); break;
  }
}

function applyPreset([n, e, a]) {
  const want = { necesidades: n, estilo: e, ahorro: a };
  for (const g of Object.keys(GROUPS)) {
    const cs = S.activeCategories().filter((c) => c.group === g);
    const cur = cs.reduce((s, c) => s + (Number(c.pct) || 0), 0);
    cs.forEach((c, i) => {
      let p = cur > 0 ? (c.pct / cur) * want[g] : want[g] / cs.length;
      p = Math.round(p * 2) / 2;
      S.upsertCategory({ ...c, pct: p });
    });
    // corrige el redondeo en la última partida del grupo
    const after = S.activeCategories().filter((c) => c.group === g);
    const diff = want[g] - after.reduce((s, c) => s + c.pct, 0);
    if (after.length && Math.abs(diff) > 0.001) {
      const last = after[after.length - 1];
      S.upsertCategory({ ...last, pct: Math.round((last.pct + diff) * 2) / 2 });
    }
  }
  applyTargetsToCurrentAndFuture();
  toast(`Reparto ${n}/${e}/${a} aplicado`);
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function exportCsv() {
  const rows = [['Fecha', 'Grupo', 'Partida', 'Importe', 'Nota', 'Apuntado por']];
  for (const m of S.get().movements.filter((x) => !x.deleted).sort((a, b) => a.date.localeCompare(b.date))) {
    const c = S.category(m.catId) || {};
    rows.push([m.date, GROUPS[c.group]?.label || '', c.name || '', String(m.amount).replace('.', ','), m.note || '', m.by || '']);
  }
  const csv = '﻿' + rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n');
  download(`movimientos-${S.monthKey()}.csv`, csv, 'text/csv');
}

function importFile(file) {
  if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (!d.categories || !d.movements) throw new Error('Formato no reconocido');
      if (!confirm('¿Fusionar la copia importada con los datos actuales?')) return;
      S.replace(S.merge(S.get(), d));
      S.save();
      toast('Copia importada');
    } catch (err) { toast('No se pudo importar: ' + err.message); }
  };
  r.readAsText(file);
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}
