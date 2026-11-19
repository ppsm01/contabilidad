// Modelo de datos, persistencia local, fusión (merge) y cálculos.

const LS_DATA = 'cp.data.v1';

export const GROUPS = {
  necesidades: { label: 'Necesidades', color: '#2f7de1' },
  estilo: { label: 'Estilo de vida', color: '#e8833a' },
  ahorro: { label: 'Ahorro', color: '#1f9d6b' },
};

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const now = () => new Date().toISOString();

export const monthKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

export function shiftMonth(key, delta) {
  const [y, m] = key.split('-').map(Number);
  return monthKey(new Date(y, m - 1 + delta, 1));
}

export function monthLabel(key, short = false) {
  const [y, m] = key.split('-').map(Number);
  const s = new Date(y, m - 1, 1).toLocaleDateString('es-ES', {
    month: short ? 'short' : 'long',
    year: short ? '2-digit' : 'numeric',
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function daysInMonth(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

// Reparto 50/30/20 adaptado
function defaultCategories() {
  const t = now();
  const c = (name, group, pct, icon) => ({
    id: uid(), name, group, pct, icon, archived: false, updatedAt: t,
  });
  return [
    c('Vivienda', 'necesidades', 25, '🏠'),
    c('Suministros', 'necesidades', 6, '💡'),
    c('Alimentación', 'necesidades', 10, '🛒'),
    c('Transporte', 'necesidades', 5, '🚗'),
    c('Seguros y salud', 'necesidades', 4, '🩺'),
    c('Restaurantes y ocio', 'estilo', 10, '🍽️'),
    c('Ropa y cuidado personal', 'estilo', 5, '👕'),
    c('Suscripciones', 'estilo', 3, '📺'),
    c('Viajes', 'estilo', 7, '✈️'),
    c('Otros', 'estilo', 5, '📦'),
    c('Fondo de emergencia', 'ahorro', 10, '🛟'),
    c('Inversión / largo plazo', 'ahorro', 10, '📈'),
  ];
}

export function emptyData() {
  return {
    version: 1,
    pristine: true, // aún sin datos introducidos por el usuario
    categories: defaultCategories(),
    months: {},
    movements: [],
    defaultIncomes: [], // plantilla de ingresos para meses nuevos
    defaultIncomesUpdatedAt: now(),
  };
}

let data = null;
const listeners = new Set();

export function load() {
  try {
    const raw = localStorage.getItem(LS_DATA);
    data = raw ? JSON.parse(raw) : emptyData();
  } catch {
    data = emptyData();
  }
  if (!data.months) data.months = {};
  if (!data.movements) data.movements = [];
  if (!data.defaultIncomes) data.defaultIncomes = [];
  return data;
}

export function get() {
  return data;
}

export function save({ silent = false, user = true } = {}) {
  if (user && !silent) delete data.pristine;
  try {
    localStorage.setItem(LS_DATA, JSON.stringify(data));
  } catch (e) {
    console.error('No se pudo guardar localmente', e);
  }
  if (!silent) listeners.forEach((fn) => fn('local'));
}

export function replace(newData) {
  data = newData;
  save({ silent: true });
  listeners.forEach((fn) => fn('remote'));
}

export function onChange(fn) {
  listeners.add(fn);
}

// ---------- Fusión de dos copias (última escritura gana, registro a registro) ----------
function newer(a, b) {
  if (!a) return b;
  if (!b) return a;
  return (b.updatedAt || '') > (a.updatedAt || '') ? b : a;
}

function mergeById(listA = [], listB = []) {
  const map = new Map();
  for (const x of listA) map.set(x.id, x);
  for (const y of listB) map.set(y.id, newer(map.get(y.id), y));
  return [...map.values()];
}

export function merge(a, b) {
  if (!a) return b;
  if (!b) return a;
  const months = { ...a.months };
  for (const [k, v] of Object.entries(b.months || {})) months[k] = newer(months[k], v);
  const di =
    (b.defaultIncomesUpdatedAt || '') > (a.defaultIncomesUpdatedAt || '')
      ? { defaultIncomes: b.defaultIncomes, defaultIncomesUpdatedAt: b.defaultIncomesUpdatedAt }
      : { defaultIncomes: a.defaultIncomes, defaultIncomesUpdatedAt: a.defaultIncomesUpdatedAt };
  return {
    version: 1,
    categories: mergeById(a.categories, b.categories),
    months,
    movements: mergeById(a.movements, b.movements),
    ...di,
  };
}

// ---------- Categorías ----------
export function activeCategories() {
  return data.categories.filter((c) => !c.archived);
}

export function category(id) {
  return data.categories.find((c) => c.id === id);
}

export function upsertCategory(cat) {
  cat.updatedAt = now();
  const i = data.categories.findIndex((c) => c.id === cat.id);
  if (i >= 0) data.categories[i] = cat;
  else data.categories.push(cat);
  save();
}

export function currentTargets() {
  const t = {};
  for (const c of activeCategories()) t[c.id] = Number(c.pct) || 0;
  return t;
}

// ---------- Meses ----------
export function getMonth(key) {
  return data.months[key] || null;
}

export function ensureMonth(key) {
  if (!data.months[key]) {
    // Copia los ingresos del mes anterior con datos, o la plantilla.
    const prevKey = Object.keys(data.months).filter((k) => k < key).sort().pop();
    const src = prevKey ? data.months[prevKey].incomes : data.defaultIncomes;
    data.months[key] = {
      incomes: (src || []).map((i) => ({ id: uid(), name: i.name, amount: i.amount })),
      targets: currentTargets(),
      updatedAt: now(),
    };
    save({ user: false });
  }
  return data.months[key];
}

export function updateMonth(key, patch) {
  const m = ensureMonth(key);
  Object.assign(m, patch, { updatedAt: now() });
  save();
}

export function monthTargets(key) {
  const m = getMonth(key);
  const t = m?.targets || currentTargets();
  // Las categorías creadas después del mes no tienen objetivo en ese mes
  return t;
}

// ---------- Movimientos ----------
export function movementsOf(key) {
  return data.movements
    .filter((m) => !m.deleted && m.month === key)
    .sort((a, b) => (b.date + b.updatedAt).localeCompare(a.date + a.updatedAt));
}

export function addMovement(mv) {
  const t = now();
  data.movements.push({ id: uid(), deleted: false, createdAt: t, updatedAt: t, ...mv, month: mv.date.slice(0, 7) });
  ensureMonth(mv.date.slice(0, 7));
  save();
}

export function updateMovement(id, patch) {
  const mv = data.movements.find((m) => m.id === id);
  if (!mv) return;
  Object.assign(mv, patch, { updatedAt: now() });
  if (patch.date) mv.month = patch.date.slice(0, 7);
  ensureMonth(mv.month);
  save();
}

export function deleteMovement(id) {
  updateMovement(id, { deleted: true });
}

// ---------- Cálculos ----------
export function allMonthKeys() {
  const keys = new Set(Object.keys(data.months));
  for (const m of data.movements) if (!m.deleted) keys.add(m.month);
  return [...keys].sort();
}

export function summary(key) {
  const m = getMonth(key);
  const income = (m?.incomes || []).reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const targets = monthTargets(key);
  const byCat = {};
  const cats = data.categories.filter(
    (c) => !c.archived || targets[c.id] != null || movementsOf(key).some((mv) => mv.catId === c.id)
  );
  for (const c of cats) {
    const pct = targets[c.id] ?? 0;
    byCat[c.id] = { cat: c, pct, budget: (income * pct) / 100, real: 0, count: 0 };
  }
  for (const mv of movementsOf(key)) {
    if (!byCat[mv.catId]) {
      const c = category(mv.catId) || { id: mv.catId, name: '¿Categoría eliminada?', group: 'estilo', icon: '❓' };
      byCat[mv.catId] = { cat: c, pct: 0, budget: 0, real: 0, count: 0 };
    }
    byCat[mv.catId].real += Number(mv.amount) || 0;
    byCat[mv.catId].count++;
  }
  const groups = {};
  for (const g of Object.keys(GROUPS)) groups[g] = { budget: 0, real: 0, pct: 0 };
  for (const r of Object.values(byCat)) {
    const g = groups[r.cat.group] || groups.estilo;
    g.budget += r.budget;
    g.real += r.real;
    g.pct += r.pct;
  }
  const spent = groups.necesidades.real + groups.estilo.real;
  const saved = groups.ahorro.real;
  return {
    key, income, byCat, groups, spent, saved,
    balance: income - spent - saved,
    savingsRate: income > 0 ? saved / income : null,
    hasData: income > 0 || movementsOf(key).length > 0,
  };
}

export function cumulative(uptoKey = null) {
  const keys = allMonthKeys().filter((k) => !uptoKey || k <= uptoKey);
  const tot = { income: 0, spent: 0, saved: 0, balance: 0, months: 0, byCat: {}, groups: {} };
  for (const g of Object.keys(GROUPS)) tot.groups[g] = { budget: 0, real: 0 };
  for (const k of keys) {
    const s = summary(k);
    if (!s.hasData) continue;
    tot.months++;
    tot.income += s.income;
    tot.spent += s.spent;
    tot.saved += s.saved;
    tot.balance += s.balance;
    for (const [id, r] of Object.entries(s.byCat)) {
      if (!tot.byCat[id]) tot.byCat[id] = { cat: r.cat, budget: 0, real: 0 };
      tot.byCat[id].budget += r.budget;
      tot.byCat[id].real += r.real;
    }
    for (const g of Object.keys(GROUPS)) {
      tot.groups[g].budget += s.groups[g].budget;
      tot.groups[g].real += s.groups[g].real;
    }
  }
  tot.savingsRate = tot.income > 0 ? tot.saved / tot.income : null;
  return tot;
}

// ---------- Indicadores de riesgo ----------
// level: ok | warn | bad | na
export function risks(key, today = new Date()) {
  const s = summary(key);
  const out = [];
  const pctStr = (v) => (v == null ? '—' : `${(v * 100).toFixed(0)} %`);

  // 1. Tasa de ahorro
  if (s.income > 0) {
    const r = s.savingsRate;
    out.push({
      id: 'ahorro', title: 'Tasa de ahorro', value: pctStr(r),
      level: r >= 0.2 ? 'ok' : r >= 0.1 ? 'warn' : 'bad',
      hint: 'Objetivo ≥ 20 % de los ingresos. Por debajo del 10 % es riesgo alto.',
    });
  } else out.push({ id: 'ahorro', title: 'Tasa de ahorro', value: '—', level: 'na', hint: 'Introduce los ingresos del mes.' });

  // 2. Peso de las necesidades
  if (s.income > 0) {
    const r = s.groups.necesidades.real / s.income;
    out.push({
      id: 'necesidades', title: 'Peso de necesidades', value: pctStr(r),
      level: r <= 0.5 ? 'ok' : r <= 0.6 ? 'warn' : 'bad',
      hint: 'Gastos básicos sobre ingresos. Más del 60 % deja poco margen ante imprevistos.',
    });
  }

  // 3. Ritmo de gasto (proyección a fin de mes)
  const budgetSpend = s.groups.necesidades.budget + s.groups.estilo.budget;
  if (budgetSpend > 0) {
    const isCurrent = key === monthKey(today);
    const days = daysInMonth(key);
    const elapsed = isCurrent ? today.getDate() : days;
    const projected = isCurrent ? (s.spent / elapsed) * days : s.spent;
    const r = projected / budgetSpend;
    out.push({
      id: 'ritmo', title: isCurrent ? 'Proyección fin de mes' : 'Gasto vs presupuesto', value: pctStr(r),
      level: r <= 1 ? 'ok' : r <= 1.1 ? 'warn' : 'bad',
      hint: isCurrent
        ? `Al ritmo actual gastarías ${fmt(projected)} de ${fmt(budgetSpend)} presupuestados.`
        : `Gastado ${fmt(s.spent)} de ${fmt(budgetSpend)} presupuestados.`,
    });
  }

  // 4. Partidas en exceso
  const over = Object.values(s.byCat).filter((r) => r.cat.group !== 'ahorro' && r.budget > 0 && r.real > r.budget * 1.0001);
  if (s.income > 0) {
    out.push({
      id: 'exceso', title: 'Partidas excedidas', value: String(over.length),
      level: over.length === 0 ? 'ok' : over.length <= 2 ? 'warn' : 'bad',
      hint: over.length ? over.map((r) => r.cat.name).join(', ') : 'Todas las partidas dentro de presupuesto.',
    });
  }

  // 5. Colchón de emergencia (meses de gastos básicos cubiertos)
  const emergencyCats = data.categories.filter((c) => /emergencia|colch/i.test(c.name)).map((c) => c.id);
  const keys = allMonthKeys().filter((k) => k <= key);
  let fund = 0;
  for (const mv of data.movements) if (!mv.deleted && mv.month <= key && emergencyCats.includes(mv.catId)) fund += Number(mv.amount) || 0;
  const recent = keys.slice(-3).map((k) => summary(k).groups.necesidades.real).filter((v) => v > 0);
  if (emergencyCats.length && recent.length) {
    const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const months = fund / avg;
    out.push({
      id: 'colchon', title: 'Colchón de emergencia', value: `${months.toFixed(1)} meses`,
      level: months >= 6 ? 'ok' : months >= 3 ? 'warn' : 'bad',
      hint: `${fmt(fund)} acumulados. Recomendado: entre 3 y 6 meses de gastos básicos (${fmt(avg)}/mes).`,
    });
  } else {
    out.push({ id: 'colchon', title: 'Colchón de emergencia', value: '—', level: 'na', hint: 'Registra aportaciones al fondo de emergencia y gastos básicos.' });
  }

  // 6. Balance del mes
  if (s.income > 0) {
    out.push({
      id: 'balance', title: 'Balance del mes', value: fmt(s.balance),
      level: s.balance >= 0 ? 'ok' : s.balance >= -0.05 * s.income ? 'warn' : 'bad',
      hint: s.balance >= 0 ? 'Ingresos suficientes para gastos y ahorro.' : 'Gastas y ahorras más de lo que ingresas: estás tirando de reservas.',
    });
  }

  // 7. Tendencia del gasto (últimos 3 meses vs 3 anteriores)
  const withData = keys.filter((k) => summary(k).spent > 0);
  if (withData.length >= 6) {
    const last = withData.slice(-3).map((k) => summary(k).spent);
    const prev = withData.slice(-6, -3).map((k) => summary(k).spent);
    const a = last.reduce((x, y) => x + y, 0) / 3;
    const b = prev.reduce((x, y) => x + y, 0) / 3;
    const r = b > 0 ? a / b - 1 : 0;
    out.push({
      id: 'tendencia', title: 'Tendencia del gasto', value: `${r >= 0 ? '+' : ''}${(r * 100).toFixed(0)} %`,
      level: r <= 0.05 ? 'ok' : r <= 0.15 ? 'warn' : 'bad',
      hint: 'Media de gasto de los últimos 3 meses frente a los 3 anteriores.',
    });
  } else {
    out.push({ id: 'tendencia', title: 'Tendencia del gasto', value: '—', level: 'na', hint: 'Necesita al menos 6 meses con gastos.' });
  }
  return out;
}

const nf = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmt = (v) => nf.format(Math.round(v || 0));
export const fmt2 = (v) => nf2.format(v || 0);
