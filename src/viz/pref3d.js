// 都道府県別の指標を 3D 柱で表示する共通ビュー（統計ダッシュボード・官公需 など）
import { CAPITALS, PREF_NAMES } from './prefs.js';
import { nf } from '../dom.js';

const square = (lng, lat, dx = 0.24, dy = 0.2) => [[[lng - dx, lat - dy], [lng + dx, lat - dy], [lng + dx, lat + dy], [lng - dx, lat + dy], [lng - dx, lat - dy]]];
const MAX_H = 260000;
const RAMP = ['#eff6ff', '#bfdbfe', '#60a5fa', '#2563eb', '#1e3a8a'];

/**
 * indicators: [{ id, label, unit, digits, load(): Promise<{ values:number[47], year:string, source:string }> }]
 * 先頭の指標を初期表示し、ラジオで切替える。
 */
export async function setupPrefColumns({ map, section, h, caption, toast, maplibregl }, indicators) {
  map.addSource('pref3d', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'pref3d',
    type: 'fill-extrusion',
    source: 'pref3d',
    paint: {
      'fill-extrusion-height': ['get', 'h'],
      'fill-extrusion-base': 0,
      'fill-extrusion-opacity': 0.92,
      'fill-extrusion-color': ['interpolate', ['linear'], ['get', 't'], 0, RAMP[0], 0.25, RAMP[1], 0.5, RAMP[2], 0.75, RAMP[3], 1, RAMP[4]],
    },
  });

  const legend = h('div', { class: 'legend' });
  const rank = h('ol', { class: 'quake-list' });
  const radios = h('div', { class: 'radios' });
  let current = null;

  const fmt = (ind, v) => `${v.toLocaleString('ja-JP', { maximumFractionDigits: ind.digits ?? 0, minimumFractionDigits: ind.digits ?? 0 })}${ind.unit ?? ''}`;

  async function show(ind) {
    caption.textContent = `${ind.label} を読み込み中…`;
    let res;
    try {
      res = await ind.load();
    } catch (e) {
      toast(`「${ind.label}」を取得できませんでした: ${e.message}`);
      return;
    }
    current = ind;
    const vals = res.values;
    const min = Math.min(...vals.filter((v) => v != null));
    const max = Math.max(...vals.filter((v) => v != null));
    const features = CAPITALS.map(([, lng, lat], i) => {
      const v = vals[i];
      const t = v == null ? 0 : 0.12 + (0.88 * (v - min)) / (max - min || 1);
      return {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: square(lng, lat) },
        properties: { pref: PREF_NAMES[i], v: v ?? null, t, h: t * MAX_H, lng, lat },
      };
    });
    map.getSource('pref3d').setData({ type: 'FeatureCollection', features });

    legend.replaceChildren(
      h('div', { class: 'legend-bar', style: `background:linear-gradient(90deg,${RAMP.join(',')})` }),
      h('div', { class: 'legend-ticks' }, h('span', {}, fmt(ind, min)), h('span', {}, fmt(ind, max))),
      h('small', {}, '柱の高さ・色 = 値（最小〜最大に正規化）'),
    );
    const order = vals.map((v, i) => [v, i]).filter(([v]) => v != null).sort((a, b) => b[0] - a[0]);
    rank.replaceChildren(
      ...order.slice(0, 10).map(([v, i], k) =>
        h(
          'li',
          { onclick: () => map.flyTo({ center: [CAPITALS[i][1], CAPITALS[i][2]], zoom: 7, pitch: 60, speed: 1.2 }) },
          h('b', {}, PREF_NAMES[i]),
          ` ${fmt(ind, v)}`,
        ),
      ),
    );
    caption.textContent = `${ind.label}（${res.year}）— ${res.source}`;
  }

  if (indicators.length > 6) {
    // 指標が多い場合はグループ付きセレクトにする
    const sel = h('select', { class: 'ind-select', onchange: (e) => show(indicators[+e.target.value]) });
    const groups = new Map();
    indicators.forEach((ind, i) => {
      const g = ind.group ?? '指標';
      if (!groups.has(g)) groups.set(g, h('optgroup', { label: g }));
      groups.get(g).append(h('option', { value: i }, ind.label));
    });
    sel.append(...groups.values());
    radios.replaceChildren(sel);
  } else {
    indicators.forEach((ind, i) =>
      radios.append(h('label', {}, h('input', { type: 'radio', name: 'pref3d-ind', checked: i === 0, onchange: () => show(ind) }), ind.label)),
    );
  }
  section('指標', radios);
  section('凡例', legend);
  section('上位10都道府県（クリックで移動）', rank);

  map.on('click', 'pref3d', (e) => {
    const p = e.features[0].properties;
    new maplibregl.Popup({ maxWidth: '220px' })
      .setLngLat(e.lngLat)
      .setHTML(`<b>${p.pref}</b><br>${current?.label}: ${p.v == null || p.v === 'null' ? '—' : fmt(current, Number(p.v))}`)
      .addTo(map);
  });
  map.on('mouseenter', 'pref3d', () => (map.getCanvas().style.cursor = 'pointer'));
  map.on('mouseleave', 'pref3d', () => (map.getCanvas().style.cursor = ''));

  await show(indicators[0]);
}

/** 統計ダッシュボード API から都道府県別の最新値（47 件揃う最新年）を取得 */
export async function loadDashboardPref(code) {
  const url = `https://dashboard.e-stat.go.jp/api/1.0/Json/getData?Lang=JP&IndicatorCode=${code}&RegionalRank=3`;
  const j = await fetch(url).then((r) => r.json());
  const objs = j.GET_STATS?.STATISTICAL_DATA?.DATA_INF?.DATA_OBJ;
  if (!objs) throw new Error('データなし');
  const byTime = new Map();
  for (const { VALUE: v } of objs) {
    const m = /^(\d\d)000$/.exec(v['@regionCode']);
    if (!m || +m[1] < 1 || +m[1] > 47) continue;
    if (!byTime.has(v['@time'])) byTime.set(v['@time'], new Array(47).fill(null));
    byTime.get(v['@time'])[+m[1] - 1] = Number(v.$);
  }
  const latest = [...byTime.keys()].filter((t) => byTime.get(t).every((x) => x != null)).sort().pop();
  if (!latest) throw new Error('47都道府県分が揃う年がありません');
  return { values: byTime.get(latest), year: `${latest.slice(0, 4)}${latest.includes('FY') ? '年度' : '年'}`, source: '総務省 統計ダッシュボード API（e-Stat）' };
}
