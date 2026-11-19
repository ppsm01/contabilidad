// Gráficos SVG ligeros, sin dependencias (funcionan sin conexión).

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

const short = (v) => {
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toFixed(1).replace('.0', '') + 'M';
  if (a >= 1e3) return (v / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace('.0', '') + 'k';
  return String(Math.round(v));
};

/**
 * Gráfico de líneas.
 * series: [{ name, color, values: number[], dashed? }]
 */
export function lineChart({ labels, series, height = 200, unit = '€' }) {
  const W = 340, H = height, L = 38, R = 10, T = 12, B = 26;
  const all = series.flatMap((s) => s.values).filter((v) => v != null);
  const minV = Math.min(0, ...all);
  const maxV = niceMax(Math.max(...all, 1));
  const n = Math.max(labels.length, 1);
  const x = (i) => L + (n === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (n - 1));
  const y = (v) => T + (H - T - B) * (1 - (v - minV) / (maxV - minV || 1));
  let g = '';
  for (let k = 0; k <= 4; k++) {
    const v = minV + ((maxV - minV) * k) / 4;
    g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/>`;
    g += `<text x="${L - 5}" y="${y(v) + 3}" class="axis" text-anchor="end">${short(v)}</text>`;
  }
  const step = Math.ceil(n / 6);
  labels.forEach((lb, i) => {
    if (i % step === 0 || i === n - 1)
      g += `<text x="${x(i)}" y="${H - 8}" class="axis" text-anchor="${n > 1 && i === n - 1 ? 'end' : n > 1 && i === 0 ? 'start' : 'middle'}">${esc(lb)}</text>`;
  });
  for (const s of series) {
    const pts = s.values.map((v, i) => (v == null ? null : [x(i), y(v)])).filter(Boolean);
    if (!pts.length) continue;
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" ${s.dashed ? 'stroke-dasharray="5 4"' : ''}/>`;
    if (!s.dashed) for (const p of pts) g += `<circle cx="${p[0]}" cy="${p[1]}" r="2.8" fill="${s.color}"/>`;
  }
  const legend = series
    .map((s) => `<span class="lg"><i style="background:${s.color}${s.dashed ? ';opacity:.55' : ''}"></i>${esc(s.name)}</span>`)
    .join('');
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico de evolución en ${unit}">${g}</svg><div class="legend">${legend}</div></div>`;
}

/**
 * Barras horizontales real vs objetivo.
 * rows: [{ label, real, budget, color }]
 */
export function budgetBars(rows, fmt) {
  return `<div class="bbars">${rows
    .map((r) => {
      const max = Math.max(r.real, r.budget, 1);
      const scale = Math.max(max, r.budget * 1.25);
      const wReal = Math.max(0, (r.real / scale) * 100);
      const wBud = (r.budget / scale) * 100;
      const over = r.budget > 0 && r.real > r.budget;
      const pct = r.budget > 0 ? Math.round((r.real / r.budget) * 100) : null;
      return `<div class="bbar">
        <div class="bbar-head"><span>${esc(r.label)}</span><span class="${over ? 'neg' : 'muted'}">${fmt(r.real)} / ${fmt(r.budget)}${pct != null ? ` · ${pct}%` : ''}</span></div>
        <div class="bbar-track"><div class="bbar-fill ${over ? 'over' : ''}" style="width:${wReal}%;background:${over ? '' : r.color}"></div>${r.budget > 0 ? `<div class="bbar-target" style="left:${wBud}%"></div>` : ''}</div>
      </div>`;
    })
    .join('')}</div>`;
}

/**
 * Barras verticales agrupadas (p. ej. objetivo vs real por grupo).
 * groups: [{ label, bars: [{ value, color, name }] }]
 */
export function groupedBars({ groups, height = 170 }) {
  const W = 340, H = height, L = 38, R = 8, T = 10, B = 24;
  const maxV = niceMax(Math.max(1, ...groups.flatMap((g) => g.bars.map((b) => b.value))));
  const y = (v) => T + (H - T - B) * (1 - v / maxV);
  const gw = (W - L - R) / groups.length;
  let s = '';
  for (let k = 0; k <= 4; k++) {
    const v = (maxV * k) / 4;
    s += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 5}" y="${y(v) + 3}" class="axis" text-anchor="end">${short(v)}</text>`;
  }
  groups.forEach((g, i) => {
    const nb = g.bars.length;
    const bw = Math.min(26, (gw - 16) / nb);
    const x0 = L + i * gw + (gw - bw * nb - 4 * (nb - 1)) / 2;
    g.bars.forEach((b, j) => {
      const yy = y(Math.max(0, b.value));
      s += `<rect x="${x0 + j * (bw + 4)}" y="${yy}" width="${bw}" height="${Math.max(0, H - B - yy)}" rx="3" fill="${b.color}" ${b.faded ? 'opacity=".35"' : ''}/>`;
    });
    s += `<text x="${L + i * gw + gw / 2}" y="${H - 8}" class="axis" text-anchor="middle">${esc(g.label)}</text>`;
  });
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}">${s}</svg></div>`;
}

/** Anillo de progreso */
export function ring(value, color, label) {
  const r = 30, c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value || 0));
  return `<svg viewBox="0 0 80 80" class="ring"><circle cx="40" cy="40" r="${r}" class="ring-bg"/><circle cx="40" cy="40" r="${r}" fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${c * v} ${c}" transform="rotate(-90 40 40)"/><text x="40" y="45" text-anchor="middle" class="ring-txt">${esc(label)}</text></svg>`;
}
