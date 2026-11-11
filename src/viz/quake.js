// 気象庁 地震情報: 直近の震源をマグニチュード（大きさ）・深さ（色）で表示
import { esc } from '../dom.js';

const LIST = 'https://www.jma.go.jp/bosai/quake/data/list.json';

function parseCod(cod) {
  const m = /^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)([+-]\d+)?\/?$/.exec(cod ?? '');
  if (!m) return null;
  return { lat: +m[1], lon: +m[2], depth: m[3] != null ? Math.abs(+m[3]) / 1000 : null };
}

const fmt = (iso) => iso.slice(5, 16).replace('T', ' ').replace('-', '/');

export async function setup({ map, section, h, caption, maplibregl }) {
  const raw = await fetch(LIST).then((r) => r.json());
  const seen = new Set();
  const quakes = [];
  for (const q of raw) {
    if (seen.has(q.eid)) continue;
    seen.add(q.eid);
    const pos = parseCod(q.cod);
    const mag = parseFloat(q.mag);
    if (!pos || Number.isNaN(mag)) continue;
    quakes.push({ ...pos, mag, maxi: q.maxi, name: q.anm, at: q.at });
  }
  quakes.sort((a, b) => (a.at < b.at ? 1 : -1));

  map.addSource('quake', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: quakes.map((q) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [q.lon, q.lat] },
        properties: { mag: q.mag, depth: q.depth ?? -1, maxi: q.maxi, name: q.name, at: q.at },
      })),
    },
  });
  map.addLayer({
    id: 'quake',
    type: 'circle',
    source: 'quake',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['get', 'mag'], 1, 3, 3, 6, 5, 14, 7, 28, 9, 44],
      'circle-color': ['step', ['get', 'depth'], '#9ca3af', 0, '#e53935', 30, '#fb8c00', 70, '#fdd835', 150, '#43a047', 300, '#1e88e5'],
      'circle-opacity': 0.75,
      'circle-stroke-color': '#fff',
      'circle-stroke-width': 1,
    },
  });

  map.addSource('quake3d', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: quakes.map((q) => ({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [[[q.lon - 0.07, q.lat - 0.06], [q.lon + 0.07, q.lat - 0.06], [q.lon + 0.07, q.lat + 0.06], [q.lon - 0.07, q.lat + 0.06], [q.lon - 0.07, q.lat - 0.06]]] },
        properties: { mag: q.mag, depth: q.depth ?? -1, h: Math.pow(q.mag, 3.5) * 300 },
      })),
    },
  });
  map.addLayer({
    id: 'quake3d',
    type: 'fill-extrusion',
    source: 'quake3d',
    layout: { visibility: 'none' },
    paint: {
      'fill-extrusion-height': ['get', 'h'],
      'fill-extrusion-base': 0,
      'fill-extrusion-opacity': 0.85,
      'fill-extrusion-color': ['step', ['get', 'depth'], '#9ca3af', 0, '#e53935', 30, '#fb8c00', 70, '#fdd835', 150, '#43a047', 300, '#1e88e5'],
    },
  });
  section(
    '3D 表示',
    h(
      'label',
      { class: 'checks-one' },
      h('input', {
        type: 'checkbox',
        onchange: (e) => {
          const on = e.target.checked;
          map.setLayoutProperty('quake', 'visibility', on ? 'none' : 'visible');
          map.setLayoutProperty('quake3d', 'visibility', on ? 'visible' : 'none');
          map.easeTo({ pitch: on ? 55 : 0, duration: 700 });
        },
      }),
      ' 地震を 3D 柱で表示（高さ = 規模）',
    ),
  );

  const legend = h(
    'div',
    { class: 'legend-list' },
    [['#e53935', '0–30km'], ['#fb8c00', '30–70km'], ['#fdd835', '70–150km'], ['#43a047', '150–300km'], ['#1e88e5', '300km〜']].map(([c, t]) =>
      h('span', {}, h('i', { style: `background:${c}` }), t),
    ),
    h('small', {}, '円の大きさ = マグニチュード / 色 = 震源の深さ'),
  );
  section('凡例', legend);

  const list = h('ol', { class: 'quake-list' });
  quakes.slice(0, 12).forEach((q) =>
    list.append(
      h(
        'li',
        {
          onclick: () => map.flyTo({ center: [q.lon, q.lat], zoom: 7, speed: 1.2 }),
        },
        h('b', {}, `M${q.mag.toFixed(1)}`),
        ` ${q.name} `,
        h('small', {}, `${fmt(q.at)}${q.maxi ? ` 最大震度${q.maxi}` : ''}`),
      ),
    ),
  );
  section('直近の地震（クリックで移動）', list);

  caption.textContent = `気象庁 地震情報（防災情報）— 直近 ${quakes.length} 件の震源・マグニチュード・深さ（最新 ${fmt(quakes[0].at)} JST）`;

  map.on('click', 'quake', (e) => {
    const p = e.features[0].properties;
    new maplibregl.Popup({ maxWidth: '240px' })
      .setLngLat(e.lngLat)
      .setHTML(`<b>M${p.mag} ${esc(p.name)}</b><br>${esc(fmt(p.at))} JST<br>深さ ${p.depth >= 0 ? `${p.depth} km` : '不明'}<br>最大震度 ${esc(p.maxi || '—')}`)
      .addTo(map);
  });
  map.on('mouseenter', 'quake', () => (map.getCanvas().style.cursor = 'pointer'));
  map.on('mouseleave', 'quake', () => (map.getCanvas().style.cursor = ''));
}
