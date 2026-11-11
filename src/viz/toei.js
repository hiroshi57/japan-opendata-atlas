// 東京都交通局（ODPT 公開 GTFS）: 都営地下鉄・都電等の路線と駅、都営バスの停留所
import { esc, nf } from '../dom.js';
import gtfs from '../../data/snapshots/toei_gtfs.json';

const pts = (arr) => ({ type: 'FeatureCollection', features: arr.map(([lng, lat, name]) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: { name } })) });

export async function setup({ map, section, h, caption, maplibregl }) {
  map.addSource('toei-lines', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: gtfs.lines.map((l) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: l.coords }, properties: { name: l.name, color: l.color } })) },
  });
  map.addSource('toei-bus', { type: 'geojson', data: pts(gtfs.busStops) });
  map.addSource('toei-st', { type: 'geojson', data: pts(gtfs.stations) });

  map.addLayer({ id: 'toei-bus', type: 'circle', source: 'toei-bus', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 1.4, 13, 4, 16, 7], 'circle-color': '#16a34a', 'circle-opacity': 0.65, 'circle-stroke-color': '#fff', 'circle-stroke-width': 0.5 } });
  map.addLayer({ id: 'toei-lines-casing', type: 'line', source: 'toei-lines', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#fff', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 5, 14, 11] } });
  map.addLayer({ id: 'toei-lines', type: 'line', source: 'toei-lines', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 3, 14, 7] } });
  map.addLayer({ id: 'toei-st', type: 'circle', source: 'toei-st', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 2.4, 14, 6], 'circle-color': '#fff', 'circle-stroke-color': '#111827', 'circle-stroke-width': 1.6 } });

  const tog = (ids, label, on = true) =>
    h('label', { class: 'checks-one' }, h('input', { type: 'checkbox', checked: on, onchange: (e) => ids.forEach((id) => map.setLayoutProperty(id, 'visibility', e.target.checked ? 'visible' : 'none')) }), ` ${label}`);
  section('レイヤー', h('div', { class: 'checks' }, tog(['toei-lines-casing', 'toei-lines'], `都営地下鉄・都電・舎人ライナー（${gtfs.lines.length}路線）`), tog(['toei-st'], `駅（${nf.format(gtfs.stations.length)}）`), tog(['toei-bus'], `都営バス停留所（${nf.format(gtfs.busStops.length)}・${gtfs.busRoutes}系統）`)));
  section('路線', h('div', { class: 'legend-list' }, gtfs.lines.map((l) => h('span', {}, h('i', { style: `background:${l.color};border-radius:3px;width:16px;height:6px` }), l.name))));
  caption.textContent = '東京都交通局 — ODPT 公開 GTFS（都営地下鉄・都電・日暮里舎人ライナーの路線と駅 / 都営バス停留所）。リポジトリ内スナップショット';

  for (const id of ['toei-st', 'toei-bus']) {
    map.on('click', id, (e) => new maplibregl.Popup({ maxWidth: '220px' }).setLngLat(e.lngLat).setHTML(`<b>${esc(e.features[0].properties.name)}</b><br><small>${id === 'toei-st' ? '駅' : 'バス停'}</small>`).addTo(map));
    map.on('mouseenter', id, () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', id, () => (map.getCanvas().style.cursor = ''));
  }
  map.on('click', 'toei-lines', (e) => new maplibregl.Popup().setLngLat(e.lngLat).setHTML(`<b>${esc(e.features[0].properties.name)}</b>`).addTo(map));
}
