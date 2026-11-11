// 気象庁 アメダス最新観測（約1,300地点）を要素別に色分けして表示
import { esc } from '../dom.js';
import { line } from '../charts.js';

const BASE = 'https://www.jma.go.jp/bosai/amedas';

const ELEMENTS = {
  temp: {
    label: '気温',
    unit: '℃',
    stops: [[-10, '#313695'], [0, '#74add1'], [10, '#abd9e9'], [15, '#fee090'], [20, '#fdae61'], [25, '#f46d43'], [30, '#d73027'], [35, '#a50026']],
  },
  precip: {
    label: '降水量(1時間)',
    unit: 'mm',
    stops: [[0, '#d9dde3'], [1, '#a6d8f0'], [5, '#4aa3df'], [20, '#1f5fbf'], [50, '#8e24aa'], [80, '#d50000']],
  },
  wind: {
    label: '風速',
    unit: 'm/s',
    stops: [[0, '#e8eefc'], [3, '#9ecae1'], [6, '#4292c6'], [10, '#fd8d3c'], [15, '#e31a1c'], [25, '#800026']],
  },
  humidity: {
    label: '湿度',
    unit: '%',
    stops: [[20, '#d95f0e'], [50, '#ffffbf'], [75, '#9ecae1'], [100, '#2c7fb8']],
  },
  sun: {
    label: '日照(1時間)',
    unit: 'h',
    stops: [[0, '#475569'], [0.5, '#fdd835'], [1, '#ff9800']],
  },
};

const p2 = (n) => String(n).padStart(2, '0');
const POINT_KEY = { temp: 'temp', precip: 'precipitation1h', wind: 'wind', humidity: 'humidity', sun: 'sun1h' };
const COLORS = { temp: '#dc2626', precip: '#2563eb', wind: '#0891b2', humidity: '#0d9488', sun: '#d97706' };

// 観測所の直近 24 時間（3 時間ごとのファイルを結合）
async function series24(code, stamp, key) {
  const base = Date.UTC(+stamp.slice(0, 4), +stamp.slice(4, 6) - 1, +stamp.slice(6, 8), +stamp.slice(8, 10), +stamp.slice(10, 12));
  const urls = [];
  for (let k = 0; k < 9; k++) {
    const d = new Date(base - k * 3 * 3600e3);
    const u = `${BASE}/data/point/${code}/${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}_${p2(Math.floor(d.getUTCHours() / 3) * 3)}.json`;
    if (!urls.includes(u)) urls.push(u);
  }
  const parts = await Promise.all(urls.map((u) => fetch(u).then((r) => (r.ok ? r.json() : {})).catch(() => ({}))));
  const merged = Object.assign({}, ...parts);
  const lo = base - 24 * 3600e3;
  const rows = Object.keys(merged)
    .sort()
    .filter((t) => Date.UTC(+t.slice(0, 4), +t.slice(4, 6) - 1, +t.slice(6, 8), +t.slice(8, 10), +t.slice(10, 12)) >= lo)
    .map((t) => [t, merged[t]?.[POINT_KEY[key]]?.[0]])
    .filter(([, v]) => v != null);
  return rows;
}

export async function setup({ map, section, card, h, caption, maplibregl }) {
  const [latest, table] = await Promise.all([
    fetch(`${BASE}/data/latest_time.txt`).then((r) => r.text()),
    fetch(`${BASE}/const/amedastable.json`).then((r) => r.json()),
  ]);
  const stamp = latest.trim().replace(/[-:T]/g, '').slice(0, 14);
  const obs = await fetch(`${BASE}/data/map/${stamp}.json`).then((r) => r.json());

  const val = (o, k) => (o?.[k] && o[k][1] === 0 && o[k][0] != null ? o[k][0] : null);
  const features = [];
  for (const [code, o] of Object.entries(obs)) {
    const st = table[code];
    if (!st) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [st.lon[0] + st.lon[1] / 60, st.lat[0] + st.lat[1] / 60] },
      properties: {
        code,
        name: st.kjName,
        en: st.enName,
        alt: st.alt,
        temp: val(o, 'temp'),
        precip: val(o, 'precipitation1h'),
        wind: val(o, 'wind'),
        humidity: val(o, 'humidity'),
        sun: val(o, 'sun1h'),
      },
    });
  }
  map.addSource('amedas', { type: 'geojson', data: { type: 'FeatureCollection', features } });
  map.addLayer({
    id: 'amedas',
    type: 'circle',
    source: 'amedas',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 3, 8, 7, 12, 11],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 0.8,
      'circle-opacity': 0.92,
    },
  });

  // 3D 柱表示（値を 0〜1 に正規化して高さにする）
  map.addSource('amedas3d', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'amedas3d',
    type: 'fill-extrusion',
    source: 'amedas3d',
    layout: { visibility: 'none' },
    paint: { 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 0.9, 'fill-extrusion-color': ['get', 'c'] },
  });
  let is3d = false;
  let currentKey = 'temp';
  const colorAt = (stops, v) => {
    if (v <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i++) {
      if (v <= stops[i][0]) return stops[i][1];
    }
    return stops.at(-1)[1];
  };
  const update3d = () => {
    const el = ELEMENTS[currentKey];
    const lo = el.stops[0][0];
    const hi = el.stops.at(-1)[0];
    const feats = [];
    for (const f of features) {
      const v = f.properties[currentKey];
      if (v == null) continue;
      const [lng, lat] = f.geometry.coordinates;
      const t = Math.max(0.03, Math.min(1, (v - lo) / (hi - lo)));
      feats.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [[[lng - 0.04, lat - 0.035], [lng + 0.04, lat - 0.035], [lng + 0.04, lat + 0.035], [lng - 0.04, lat + 0.035], [lng - 0.04, lat - 0.035]]] },
        properties: { h: t * 90000, c: colorAt(el.stops, v), name: f.properties.name },
      });
    }
    map.getSource('amedas3d').setData({ type: 'FeatureCollection', features: feats });
  };
  const legend = h('div', { class: 'legend' });
  const apply = (key) => {
    currentKey = key;
    if (is3d) update3d();
    const el = ELEMENTS[key];
    map.setFilter('amedas', ['!=', ['get', key], null]);
    map.setPaintProperty('amedas', 'circle-color', ['interpolate', ['linear'], ['get', key], ...el.stops.flat()]);
    const grad = el.stops.map(([v, c], i) => `${c} ${(i / (el.stops.length - 1)) * 100}%`).join(',');
    legend.replaceChildren(
      h('div', { class: 'legend-bar', style: `background:linear-gradient(90deg,${grad})` }),
      h(
        'div',
        { class: 'legend-ticks' },
        el.stops.map(([v]) => h('span', {}, String(v))),
      ),
      h('small', {}, `${el.label} (${el.unit})`),
    );
    const n = features.filter((f) => f.properties[key] != null).length;
    caption.textContent = `気象庁 アメダス（観測時刻 ${stamp.slice(4, 6)}/${stamp.slice(6, 8)} ${stamp.slice(8, 10)}:${stamp.slice(10, 12)} JST）— ${el.label}を観測中の ${n} 地点`;
  };

  const sel = h(
    'div',
    { class: 'radios' },
    Object.entries(ELEMENTS).map(([k, el], i) =>
      h('label', {}, h('input', { type: 'radio', name: 'amedas-el', checked: i === 0, onchange: () => apply(k) }), el.label),
    ),
  );
  section('観測要素', sel);
  section(
    '3D 表示',
    h(
      'label',
      { class: 'checks-one' },
      h('input', {
        type: 'checkbox',
        onchange: (e) => {
          is3d = e.target.checked;
          map.setLayoutProperty('amedas', 'visibility', is3d ? 'none' : 'visible');
          map.setLayoutProperty('amedas3d', 'visibility', is3d ? 'visible' : 'none');
          if (is3d) {
            update3d();
            map.easeTo({ pitch: 55, duration: 800 });
          } else map.easeTo({ pitch: 0, duration: 600 });
        },
      }),
      ' 観測値を 3D 柱で表示',
    ),
  );
  section('凡例', legend);
  apply('temp');

  let openCard = null;
  async function showSeries(code, name) {
    const key = currentKey;
    const box = h('div', { class: 'chart-box' }, h('small', {}, '取得中…'));
    openCard?.remove();
    openCard = card(`${name}（${ELEMENTS[key].label} 直近24時間）`, box);
    const rows = await series24(code, stamp, key);
    if (rows.length < 2) return box.replaceChildren(h('small', {}, 'この要素の時系列データがありません'));
    box.replaceChildren(
      line(
        rows.map(([t]) => `${t.slice(4, 6)}/${t.slice(6, 8)} ${t.slice(8, 10)}:${t.slice(10, 12)}`),
        [{ name: ELEMENTS[key].label, values: rows.map(([, v]) => v), color: COLORS[key] }],
        { width: 400, height: 210, unit: ELEMENTS[key].unit, xName: '時刻', tickEvery: Math.max(1, Math.round(rows.length / 6)), tickLabel: (l) => l.slice(6), zeroBase: key !== 'temp', digits: 1 },
      ),
    );
  }
  map.on('click', 'amedas', (e) => {
    const p = e.features[0].properties;
    showSeries(e.features[0].properties.code, p.name);
    const line = (k) => (p[k] == null || p[k] === 'null' ? '—' : `${p[k]} ${ELEMENTS[k].unit}`);
    new maplibregl.Popup({ maxWidth: '240px' })
      .setLngLat(e.lngLat)
      .setHTML(
        `<b>${esc(p.name)}</b> <small>${esc(p.en)}・標高${esc(p.alt)}m</small><br>気温 ${line('temp')}<br>降水(1h) ${line('precip')}<br>風速 ${line('wind')}<br>湿度 ${line('humidity')}<br>日照(1h) ${line('sun')}`,
      )
      .addTo(map);
  });
  map.on('mouseenter', 'amedas', () => (map.getCanvas().style.cursor = 'pointer'));
  map.on('mouseleave', 'amedas', () => (map.getCanvas().style.cursor = ''));
}
