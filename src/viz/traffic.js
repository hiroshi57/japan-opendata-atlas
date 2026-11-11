// 警察庁 交通事故統計オープンデータ: 10km メッシュの事故件数を 3D 柱で、死亡事故を点で表示
import { esc, nf } from '../dom.js';
import data from '../../data/snapshots/jp_traffic_accidents.json';

const CITIES = [['東京', 139.7, 35.68], ['大阪', 135.5, 34.69], ['名古屋', 136.9, 35.18], ['福岡', 130.4, 33.59], ['札幌', 141.35, 43.06], ['仙台', 140.87, 38.27]];
const WD = ['日', '月', '火', '水', '木', '金', '土'];

const sq = (lng, lat, d = 0.042) => [[[lng - d, lat - d], [lng + d, lat - d], [lng + d, lat + d], [lng - d, lat + d], [lng - d, lat - d]]];

export async function setup({ map, section, card, h, caption, maplibregl }) {
  const max = data.cells[0][2];
  map.addSource('acc', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: data.cells.map(([lng, lat, n, d]) => ({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: sq(lng, lat) },
        properties: { n, d, t: n / max, h: Math.pow(n / max, 0.55) * 90000 },
      })),
    },
  });
  map.addLayer({
    id: 'acc',
    type: 'fill-extrusion',
    source: 'acc',
    paint: {
      'fill-extrusion-height': ['get', 'h'],
      'fill-extrusion-base': 0,
      'fill-extrusion-opacity': 0.9,
      'fill-extrusion-color': ['interpolate', ['linear'], ['get', 't'], 0, '#fff7bc', 0.05, '#fec44f', 0.2, '#fe9929', 0.5, '#d95f0e', 1, '#7f2704'],
    },
  });
  map.addSource('fatal', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: data.fatal.map(([lng, lat, d, hr, mo]) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: { d, hr, mo } })),
    },
  });
  map.addLayer({
    id: 'fatal',
    type: 'circle',
    source: 'fatal',
    layout: { visibility: 'none' },
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 1.6, 10, 5, 14, 8], 'circle-color': '#dc2626', 'circle-opacity': 0.75, 'circle-stroke-color': '#fff', 'circle-stroke-width': 0.6 },
  });

  const toggle = (id, label, on, extra) =>
    h('label', { class: 'checks-one' }, h('input', { type: 'checkbox', checked: on, onchange: (e) => { map.setLayoutProperty(id, 'visibility', e.target.checked ? 'visible' : 'none'); extra?.(e.target.checked); } }), ` ${label}`);
  section('レイヤー', h('div', { class: 'checks' }, toggle('acc', '事故件数（10kmメッシュ・3D柱）', true), toggle('fatal', `死亡事故の発生地点（${nf.format(data.fatal.length)}件）`, false)));
  section('都市へ移動', h('div', { class: 'chips' }, CITIES.map(([n, lng, lat]) => h('button', { type: 'button', class: 'mini', onclick: () => map.flyTo({ center: [lng, lat], zoom: 9, pitch: 60, bearing: 15, speed: 1 }) }, n))));
  section(
    '凡例',
    h('div', { class: 'legend' }, h('div', { class: 'legend-bar', style: 'background:linear-gradient(90deg,#fff7bc,#fec44f,#fe9929,#d95f0e,#7f2704)' }), h('div', { class: 'legend-ticks' }, h('span', {}, '少'), h('span', {}, `多（最大 ${nf.format(max)}件/メッシュ）`)), h('small', {}, '柱の高さ・色 = 事故件数')),
  );

  // 曜日×時間帯ヒートマップ + 月別
  const peak = Math.max(...data.heat.flat());
  const grid = h('div', { class: 'heat' });
  grid.append(h('span', {}), ...Array.from({ length: 24 }, (_, i) => h('span', { class: 'hx' }, i % 3 === 0 ? i : '')));
  data.heat.forEach((row, d) => {
    grid.append(h('span', { class: 'hy' }, WD[d]));
    row.forEach((v, hr) => grid.append(h('span', { class: 'hc', style: `background:rgba(217,95,14,${(0.08 + 0.92 * v / peak).toFixed(2)})`, title: `${WD[d]}曜 ${hr}時台: ${nf.format(v)}件` })));
  });
  const mpeak = Math.max(...data.months);
  const months = h('div', { class: 'mbars' }, data.months.map((v, i) => h('div', { title: `${i + 1}月: ${nf.format(v)}件` }, h('i', { style: `height:${(v / mpeak) * 100}%` }), h('small', {}, i + 1))));
  card(
    `${data.year}年 交通事故の傾向`,
    h('div', {}, h('div', { class: 'kv' }, h('div', {}, h('b', {}, nf.format(data.total)), h('small', {}, '事故件数')), h('div', {}, h('b', {}, nf.format(data.deaths)), h('small', {}, '死者数')), h('div', {}, h('b', {}, nf.format(data.injured)), h('small', {}, '負傷者数'))), h('small', { class: 'cap' }, '曜日 × 時間帯（濃いほど多い）'), grid, h('small', { class: 'cap' }, '月別件数'), months),
  );

  caption.textContent = `警察庁 交通事故統計オープンデータ（${data.year}年 本票・${nf.format(data.total)}件）— 10kmメッシュ集計。リポジトリ内スナップショット`;
  map.on('click', 'acc', (e) => {
    const p = e.features[0].properties;
    new maplibregl.Popup({ maxWidth: '220px' }).setLngLat(e.lngLat).setHTML(`<b>${nf.format(p.n)} 件</b><br>うち死亡事故での死者 ${nf.format(p.d)} 人<br><small>約10km四方</small>`).addTo(map);
  });
  map.on('click', 'fatal', (e) => {
    const p = e.features[0].properties;
    new maplibregl.Popup({ maxWidth: '200px' }).setLngLat(e.lngLat).setHTML(`<b>死亡事故</b><br>${esc(p.mo)}月 ${esc(p.hr)}時台・死者 ${esc(p.d)} 人`).addTo(map);
  });
}
