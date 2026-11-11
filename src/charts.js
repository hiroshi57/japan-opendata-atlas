import { h, nf } from './dom.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...kids.filter(Boolean));
  return el;
};

/** 横棒グラフ（HTML/CSS）。items: [{label, value, color?, sub?}] */
export function hbar(items, { color = '#2563eb', format = (v) => nf.format(v) } = {}) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return h(
    'div',
    { class: 'hbar' },
    items.map((it, idx) =>
      h(
        'div',
        { class: 'hbar-row', title: `${it.label}: ${format(it.value)}` },
        h('div', { class: 'hbar-label' }, it.label),
        h(
          'div',
          { class: 'hbar-track' },
          h('div', {
            class: 'hbar-fill',
            style: `width:${(it.value / max) * 100}%;background:${it.color ?? color};animation-delay:${idx * 25}ms`,
          }),
        ),
        h('div', { class: 'hbar-val' }, format(it.value), it.sub ? h('small', {}, ` ${it.sub}`) : null),
      ),
    ),
  );
}

/** 縦棒グラフ（SVG）。items: [{label, value}] */
export function vbar(items, { color = '#0f766e', height = 220 } = {}) {
  const W = 720;
  const pad = { l: 44, r: 8, t: 14, b: 30 };
  const max = Math.max(...items.map((i) => i.value), 1);
  const bw = (W - pad.l - pad.r) / items.length;
  const root = svg('svg', { viewBox: `0 0 ${W} ${height}`, class: 'chart-svg', role: 'img' });
  for (let g = 0; g <= 4; g++) {
    const y = pad.t + ((height - pad.t - pad.b) * (4 - g)) / 4;
    root.append(
      svg('line', { x1: pad.l, x2: W - pad.r, y1: y, y2: y, stroke: '#e5e7eb' }),
      Object.assign(svg('text', { x: pad.l - 6, y: y + 4, 'text-anchor': 'end', class: 'ax' }), {
        textContent: nf.format(Math.round((max * g) / 4)),
      }),
    );
  }
  items.forEach((it, i) => {
    const bh = ((height - pad.t - pad.b) * it.value) / max;
    const x = pad.l + i * bw + bw * 0.15;
    const r = svg('rect', {
      x,
      y: height - pad.b - bh,
      width: bw * 0.7,
      height: bh,
      fill: color,
      rx: 2,
    });
    r.append(Object.assign(svg('title'), { textContent: `${it.label}: ${nf.format(it.value)}` }));
    root.append(
      r,
      Object.assign(svg('text', { x: x + bw * 0.35, y: height - pad.b + 14, 'text-anchor': 'middle', class: 'ax' }), {
        textContent: it.label,
      }),
    );
  });
  return root;
}

/** 折れ線（SVG, ホバーで値表示）。x: ラベル配列, series: [{name, values, color}] */
export function line(x, series, { height = 300, unit = '', xName = '週', tickEvery = 0, tickLabel = (l) => l, zeroBase = true, digits = 0, width = 860 } = {}) {
  const W = width;
  const pad = { l: 56, r: 14, t: 16, b: 30 };
  const vals = series.flatMap((s) => s.values);
  const lo = zeroBase ? 0 : Math.floor(Math.min(...vals));
  const max = zeroBase ? Math.max(...vals, 1) : Math.ceil(Math.max(...vals)) || lo + 1;
  const px = (i) => pad.l + (i * (W - pad.l - pad.r)) / Math.max(x.length - 1, 1);
  const py = (v) => pad.t + (height - pad.t - pad.b) * (1 - (v - lo) / (max - lo || 1));
  const root = svg('svg', { viewBox: `0 0 ${W} ${height}`, class: 'chart-svg', role: 'img' });
  for (let g = 0; g <= 4; g++) {
    const y = pad.t + ((height - pad.t - pad.b) * (4 - g)) / 4;
    root.append(
      svg('line', { x1: pad.l, x2: W - pad.r, y1: y, y2: y, stroke: '#e5e7eb' }),
      Object.assign(svg('text', { x: pad.l - 6, y: y + 4, 'text-anchor': 'end', class: 'ax' }), {
        textContent: (lo + ((max - lo) * g) / 4).toLocaleString('ja-JP', { maximumFractionDigits: digits }),
      }),
    );
  }
  // X 軸ラベル: 1 月の点だけを対象に、ラベル間隔が詰まらないよう年を間引く
  if (tickEvery) {
    x.forEach((lab, i) => {
      if (i % tickEvery) return;
      root.append(Object.assign(svg('text', { x: px(i), y: height - 8, 'text-anchor': 'middle', class: 'ax' }), { textContent: tickLabel(lab) }));
    });
  }
  const yrs = tickEvery ? [] : x.map((l) => +l.slice(0, 4));
  const span = yrs[yrs.length - 1] - yrs[0] || 1;
  const step = Math.max(1, Math.ceil(span / 9));
  const shown = new Set();
  if (!tickEvery) x.forEach((lab, i) => {
    const yr = yrs[i];
    if (lab.slice(5, 7) !== '01' || yr % step !== 0 || shown.has(yr)) return;
    shown.add(yr);
    root.append(
      Object.assign(svg('text', { x: px(i), y: height - 8, 'text-anchor': 'middle', class: 'ax' }), { textContent: String(yr) }),
    );
  });
  series.forEach((s, si) => {
    const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join('');
    if (si === 0) {
      root.append(
        svg('path', {
          d: `${d}L${px(x.length - 1)},${py(lo)}L${px(0)},${py(lo)}Z`,
          fill: s.color,
          opacity: 0.12,
        }),
      );
    }
    root.append(svg('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 1.8 }));
  });
  const cursor = svg('line', { y1: pad.t, y2: height - pad.b, stroke: '#64748b', 'stroke-dasharray': '3 3', opacity: 0 });
  const tip = h('div', { class: 'chart-tip', hidden: true });
  root.append(cursor);
  root.addEventListener('mousemove', (e) => {
    const r = root.getBoundingClientRect();
    const vx = ((e.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(x.length - 1, Math.round(((vx - pad.l) / (W - pad.l - pad.r)) * (x.length - 1))));
    cursor.setAttribute('x1', px(i));
    cursor.setAttribute('x2', px(i));
    cursor.setAttribute('opacity', 1);
    tip.hidden = false;
    tip.replaceChildren(
      h('b', {}, `${xName} ${x[i]}`),
      ...series.map((s) => h('div', { style: `color:${s.color}` }, `${s.name}: ${s.values[i].toLocaleString('ja-JP', { maximumFractionDigits: digits })}${unit}`)),
    );
    tip.style.left = `${Math.min(e.clientX - r.left + 12, r.width - 170)}px`;
  });
  root.addEventListener('mouseleave', () => {
    cursor.setAttribute('opacity', 0);
    tip.hidden = true;
  });
  return h('div', { class: 'chart-wrap' }, root, tip);
}
