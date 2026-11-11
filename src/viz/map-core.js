import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// v6 のワーカーは Vite のバンドルに含まれないため、資産として出力して URL を明示する
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

maplibregl.setWorkerUrl(new URL(workerUrl, location.href).href);

export { maplibregl };

const GSI = 'https://cyberjapandata.gsi.go.jp/xyz';

/** 背景地図（すべて国土地理院タイル） */
export const BASES = {
  std: { label: '標準地図', tiles: `${GSI}/std/{z}/{x}/{y}.png`, maxzoom: 18 },
  pale: { label: '淡色地図', tiles: `${GSI}/pale/{z}/{x}/{y}.png`, maxzoom: 18 },
  photo: { label: '写真', tiles: `${GSI}/seamlessphoto/{z}/{x}/{y}.jpg`, maxzoom: 18 },
  relief: { label: '色別標高図', tiles: `${GSI}/relief/{z}/{x}/{y}.png`, maxzoom: 15 },
};

// 3D 地形用 DEM（Terrarium 形式。日本域は国土地理院データ等を含む）
const DEM_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

export function createMap(container, opts = {}) {
  const {
    center = [137.5, 37.5],
    zoom = 5,
    pitch = 0,
    bearing = 0,
    base = 'std',
    terrain = false,
    exaggeration = 1.5,
  } = opts;

  const sources = {
    dem: {
      type: 'raster-dem',
      tiles: [DEM_TILES],
      encoding: 'terrarium',
      tileSize: 256,
      maxzoom: 15,
      attribution: '標高: AWS Terrain Tiles',
    },
  };
  const layers = [{ id: 'bg', type: 'background', paint: { 'background-color': '#dbe5ee' } }];
  for (const [k, b] of Object.entries(BASES)) {
    sources[`base-${k}`] = {
      type: 'raster',
      tiles: [b.tiles],
      tileSize: 256,
      maxzoom: b.maxzoom,
      attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>',
    };
    layers.push({
      id: `base-${k}`,
      type: 'raster',
      source: `base-${k}`,
      layout: { visibility: k === base ? 'visible' : 'none' },
    });
  }
  layers.push({
    id: 'hillshade',
    type: 'hillshade',
    source: 'dem',
    layout: { visibility: 'none' },
    paint: { 'hillshade-exaggeration': 0.35 },
  });

  const map = new maplibregl.Map({
    container,
    style: { version: 8, sources, layers },
    center,
    zoom,
    pitch,
    bearing,
    maxPitch: 85,
    attributionControl: { compact: true },
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');
  map.on('error', (e) => {
    const status = e?.error?.status;
    if (status === 404 || status === 403 || e?.tile) return; // 範囲外タイルは無視
    console.warn('[map]', e?.error ?? e);
  });
  map.__exaggeration = exaggeration;
  if (terrain) map.once('load', () => set3D(map, true, { pitch }));
  return map;
}

export function setBase(map, key) {
  for (const k of Object.keys(BASES)) map.setLayoutProperty(`base-${k}`, 'visibility', k === key ? 'visible' : 'none');
}

export function set3D(map, on, { pitch = 60, exaggeration } = {}) {
  if (on) {
    map.setTerrain({ source: 'dem', exaggeration: exaggeration ?? map.__exaggeration });
    map.setLayoutProperty('hillshade', 'visibility', 'visible');
    map.easeTo({ pitch, duration: 800 });
  } else {
    map.setTerrain(null);
    map.setLayoutProperty('hillshade', 'visibility', 'none');
    map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
  }
}

export const whenLoaded = (map) => new Promise((res) => (map.isStyleLoaded() ? res() : map.once('load', res)));
