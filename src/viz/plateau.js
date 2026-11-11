// PLATEAU 3D 都市モデル: 建物を高さで色分けして 3D 表示（Indigo Lab 配布の MVT 変換データ）
const TILES = 'https://indigo-lab.github.io/plateau-lod2-mvt/{z}/{x}/{y}.pbf';

const PLACES = [
  ['東京駅', 139.7671, 35.6812, 15.6, -25],
  ['新宿', 139.6917, 35.6896, 15.6, 20],
  ['渋谷', 139.7016, 35.6591, 15.8, -40],
  ['六本木', 139.7314, 35.6628, 15.8, 30],
  ['東京タワー', 139.7454, 35.6586, 16, -60],
  ['東京スカイツリー', 139.8107, 35.7101, 15.6, 15],
  ['お台場', 139.7745, 35.6252, 15.2, 120],
];

export async function setup({ map, section, h, caption }) {
  map.addSource('plateau', { type: 'vector', tiles: [TILES], minzoom: 10, maxzoom: 16, attribution: '3D都市モデル Project PLATEAU（国土交通省）/ Indigo Lab MVT' });
  map.addLayer({
    id: 'plateau-bldg',
    type: 'fill-extrusion',
    source: 'plateau',
    'source-layer': 'bldg',
    minzoom: 12,
    paint: {
      'fill-extrusion-height': ['coalesce', ['get', 'z'], 4],
      'fill-extrusion-base': 0,
      'fill-extrusion-opacity': 0.92,
      'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'z'], 4], 0, '#c7d7e8', 15, '#8fb8de', 40, '#f2b45a', 100, '#e4572e', 200, '#7a1f5c'],
      'fill-extrusion-vertical-gradient': true,
    },
  });

  const legend = h(
    'div',
    { class: 'legend' },
    h('div', { class: 'legend-bar', style: 'background:linear-gradient(90deg,#c7d7e8,#8fb8de,#f2b45a,#e4572e,#7a1f5c)' }),
    h('div', { class: 'legend-ticks' }, ['0m', '15m', '40m', '100m', '200m〜'].map((t) => h('span', {}, t))),
    h('small', {}, '建物の高さ（色・押し出し高さ）'),
  );
  section('凡例', legend);

  const go = ([, lng, lat, z, b]) => map.flyTo({ center: [lng, lat], zoom: z, pitch: 62, bearing: b, speed: 0.9 });
  section('スポットへ移動', h('div', { class: 'chips' }, PLACES.map((p) => h('button', { type: 'button', class: 'mini', onclick: () => go(p) }, p[0]))));
  caption.textContent = '3D都市モデル PLATEAU — 東京都区部の建物（LOD2 由来）を高さで色分け。ズーム12以上で表示。ドラッグ回転 / 右ドラッグで傾き調整';
}
