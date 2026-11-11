// 気象庁 火山: 常時観測火山の位置を 3D 地形上に表示
import { esc } from '../dom.js';

const URL_LIST = 'https://www.jma.go.jp/bosai/volcano/const/volcano_list.json';
const FAMOUS = ['富士山', '浅間山', '御嶽山', '阿蘇山', '桜島', '有珠山', '箱根山', '霧島山(新燃岳)'];

export async function setup({ map, section, h, caption, maplibregl, apply3D }) {
  const list = await fetch(URL_LIST).then((r) => r.json());
  const vols = list
    .filter((v) => Array.isArray(v.latlon) && v.latlon.length >= 2)
    .map((v) => ({ code: v.code, name: v.name_jp, en: v.name_en, lat: parseFloat(v.latlon[0]), lon: parseFloat(v.latlon[1]) }))
    .filter((v) => !Number.isNaN(v.lat));

  map.addSource('volcano', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: vols.map((v) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [v.lon, v.lat] },
        properties: { name: v.name, en: v.en },
      })),
    },
  });
  map.addLayer({
    id: 'volcano',
    type: 'circle',
    source: 'volcano',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 4, 10, 9],
      'circle-color': '#ef4444',
      'circle-stroke-color': '#fff',
      'circle-stroke-width': 1.5,
    },
  });

  const fly = (v) => map.flyTo({ center: [v.lon, v.lat], zoom: 11, pitch: 68, bearing: 20, speed: 0.9 });
  const buttons = h('div', { class: 'chips' });
  for (const name of FAMOUS) {
    const v = vols.find((x) => x.name === name) ?? vols.find((x) => x.name.startsWith(name.split('(')[0]));
    if (v) buttons.append(h('button', { type: 'button', class: 'mini', onclick: () => fly(v) }, name));
  }
  section('主な火山へ移動（3D）', buttons);
  caption.textContent = `気象庁 火山観測データ — 火山の位置 ${vols.length} 件を 3D 地形（標高: AWS Terrain Tiles）上に表示。ドラッグで回転・Ctrl/右ドラッグで傾き調整`;

  map.on('click', 'volcano', (e) => {
    const p = e.features[0].properties;
    new maplibregl.Popup({ maxWidth: '220px' }).setLngLat(e.lngLat).setHTML(`<b>${esc(p.name)}</b><br><small>${esc(p.en)}</small>`).addTo(map);
  });
  map.on('mouseenter', 'volcano', () => (map.getCanvas().style.cursor = 'pointer'));
  map.on('mouseleave', 'volcano', () => (map.getCanvas().style.cursor = ''));
}
