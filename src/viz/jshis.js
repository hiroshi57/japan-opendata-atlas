// J-SHIS 地震ハザードステーション: 全国 47 都道府県庁所在地の「今後30年の震度6弱以上の確率」を 3D 柱で表示
// 地図クリックで任意地点の確率も取得できる
import { esc } from '../dom.js';
import { CAPITALS } from './prefs.js';

const API = (lng, lat) =>
  `https://www.j-shis.bosai.go.jp/map/api/pshm/Y2023/AVR/TTL_MTTL/meshinfo.geojson?position=${lng},${lat}&epsg=4326`;



const LEVELS = [
  ['T30_I45_PS', '震度5弱以上'],
  ['T30_I50_PS', '震度5強以上'],
  ['T30_I55_PS', '震度6弱以上'],
  ['T30_I60_PS', '震度6強以上'],
];

async function query(lng, lat) {
  const j = await fetch(API(lng, lat)).then((r) => r.json());
  const p = j.features?.[0]?.properties;
  if (!p) throw new Error('no data');
  return p;
}

const square = (lng, lat, dx = 0.24, dy = 0.2) => [[[lng - dx, lat - dy], [lng + dx, lat - dy], [lng + dx, lat + dy], [lng - dx, lat + dy], [lng - dx, lat - dy]]];

export async function setup({ map, section, h, caption, toast, maplibregl }) {
  map.addSource('jshis', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'jshis',
    type: 'fill-extrusion',
    source: 'jshis',
    paint: {
      'fill-extrusion-height': ['*', ['get', 'p'], 260000],
      'fill-extrusion-base': 0,
      'fill-extrusion-opacity': 0.9,
      'fill-extrusion-color': ['interpolate', ['linear'], ['get', 'p'], 0, '#ffffcc', 0.1, '#fed976', 0.3, '#fd8d3c', 0.6, '#e31a1c', 0.9, '#800026'],
    },
  });

  const legend = h(
    'div',
    { class: 'legend' },
    h('div', { class: 'legend-bar', style: 'background:linear-gradient(90deg,#ffffcc,#fed976,#fd8d3c,#e31a1c,#800026)' }),
    h('div', { class: 'legend-ticks' }, ['0%', '10%', '30%', '60%', '90%'].map((t) => h('span', {}, t))),
    h('small', {}, '柱の高さ・色 = 今後30年に震度6弱以上の揺れに見舞われる確率'),
  );
  section('凡例', legend);
  const card = h('div', { class: 'jshis-card' }, h('small', {}, '地図上の任意の地点をクリックすると、その地点の確率を取得します。'));
  section('地点の確率', card);

  const show = (title, p) => {
    card.replaceChildren(
      h('b', {}, title),
      ...LEVELS.map(([k, label]) => {
        const v = Number(p[k]);
        return h(
          'div',
          { class: 'pbar' },
          h('span', {}, label),
          h('div', { class: 'pbar-track' }, h('div', { class: 'pbar-fill', style: `width:${(v * 100).toFixed(1)}%` })),
          h('em', {}, `${(v * 100).toFixed(1)}%`),
        );
      }),
      h('small', {}, '今後30年以内・平均ケース（J-SHIS 2023 年版）'),
    );
  };

  // 47 地点を 6 並列で取得し、順次反映
  const features = [];
  let idx = 0;
  let done = 0;
  const worker = async () => {
    while (idx < CAPITALS.length) {
      const [name, lng, lat] = CAPITALS[idx++];
      try {
        const p = await query(lng, lat);
        features.push({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: square(lng, lat) },
          properties: { name, p: Number(p.T30_I55_PS), raw: JSON.stringify(p) },
        });
      } catch {
        /* 取得失敗地点はスキップ */
      }
      done++;
      caption.textContent = `J-SHIS 地震ハザードステーション — 都道府県庁所在地の確率を取得中 ${done}/${CAPITALS.length}`;
      map.getSource('jshis')?.setData({ type: 'FeatureCollection', features: [...features] });
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  caption.textContent = `J-SHIS 地震ハザードステーション — ${features.length} 都市の「今後30年に震度6弱以上」確率を3D柱で表示（出典: 防災科学技術研究所）`;
  if (!features.length) toast('J-SHIS API からデータを取得できませんでした');

  map.on('click', 'jshis', (e) => {
    const f = e.features[0];
    show(`${f.properties.name}`, JSON.parse(f.properties.raw));
  });
  map.on('click', async (e) => {
    if (map.queryRenderedFeatures(e.point, { layers: ['jshis'] }).length) return;
    try {
      const p = await query(e.lngLat.lng.toFixed(5), e.lngLat.lat.toFixed(5));
      show(`経度 ${e.lngLat.lng.toFixed(3)} / 緯度 ${e.lngLat.lat.toFixed(3)}`, p);
      new maplibregl.Popup({ closeButton: false }).setLngLat(e.lngLat).setHTML(`<b>震度6弱以上 ${(Number(p.T30_I55_PS) * 100).toFixed(1)}%</b><br><small>今後30年</small>`).addTo(map);
    } catch {
      new maplibregl.Popup({ closeButton: false }).setLngLat(e.lngLat).setHTML(esc('この地点のデータはありません（海域など）')).addTo(map);
    }
  });
}
