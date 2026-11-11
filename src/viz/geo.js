// 汎用の 2D/3D 地図ビュー。spec でレイヤー・初期視点・カスタム処理(setup)を宣言する。
import { createMap, BASES, set3D, setBase, whenLoaded, maplibregl } from './map-core.js';
import { h } from '../dom.js';

/**
 * spec: {
 *   center, zoom, pitch, bearing, base, terrain, pitch3d, exaggeration, bases[],
 *   caption,                       // 表示データの出典説明
 *   layers: [{ id, label, tiles | resolve(), minzoom, maxzoom, opacity, on, attribution }],
 *   setup(ctx)                     // GeoJSON/ベクタ等の独自描画
 * }
 */
export async function mountGeo(stage, spec) {
  stage.replaceChildren();
  const cleanups = [];
  const mapEl = h('div', { class: 'map' });
  const body = h('div', { class: 'panel-body' });
  const panel = h('details', { class: 'panel', open: innerWidth > 960 ? true : undefined }, h('summary', {}, 'レイヤー・表示'), body);
  const caption = h('div', { class: 'caption' }, spec.caption ?? '');
  const toastEl = h('div', { class: 'toast', hidden: true });
  const cards = h('div', { class: 'cards' });
  stage.append(mapEl, panel, caption, toastEl, cards);

  const toast = (msg) => {
    toastEl.textContent = msg;
    toastEl.hidden = !msg;
    if (msg) setTimeout(() => toastEl.textContent === msg && (toastEl.hidden = true), 7000);
  };
  const card = (title, el) => {
    const c = h('div', { class: 'float-card' }, h('div', { class: 'float-head' }, h('b', {}, title), h('button', { class: 'x', type: 'button', onclick: () => c.remove(), 'aria-label': '閉じる' }, '×')), el);
    cards.prepend(c);
    return c;
  };
  const section = (title, el) => {
    const s = h('div', { class: 'sec' }, h('div', { class: 'sec-title' }, title), el);
    body.append(s);
    return s;
  };

  const map = createMap(mapEl, spec);
  mapEl.__map = map; // デバッグ/自動テスト用
  await whenLoaded(map);

  // 表示位置のパーマリンク: #/{id}?v=経度,緯度,ズーム,傾き,方位（共有・再読込で復元）
  const view = new URLSearchParams(location.hash.split('?')[1] ?? '').get('v')?.split(',').map(Number);
  if (view?.length >= 3 && view.every(Number.isFinite)) map.jumpTo({ center: [view[0], view[1]], zoom: view[2], pitch: view[3] ?? 0, bearing: view[4] ?? 0 });
  const syncView = () => {
    const c = map.getCenter();
    const base = location.hash.split('?')[0] || '#/';
    history.replaceState(null, '', `${base}?v=${c.lng.toFixed(4)},${c.lat.toFixed(4)},${map.getZoom().toFixed(2)},${map.getPitch().toFixed(0)},${map.getBearing().toFixed(0)}`);
  };
  map.on('moveend', syncView);
  cleanups.push(() => map.off('moveend', syncView));

  // 2D / 3D
  const btn2d = h('button', { type: 'button', class: 'seg' }, '2D 平面');
  const btn3d = h('button', { type: 'button', class: 'seg' }, '3D 地形');
  let is3D = !!spec.terrain;
  const apply3D = (on) => {
    is3D = on;
    set3D(map, on, { pitch: spec.pitch3d ?? 60, exaggeration: spec.exaggeration });
    btn2d.classList.toggle('on', !on);
    btn3d.classList.toggle('on', on);
  };
  btn2d.onclick = () => apply3D(false);
  btn3d.onclick = () => apply3D(true);
  btn2d.classList.toggle('on', !spec.terrain);
  btn3d.classList.toggle('on', !!spec.terrain);
  const exag = h('input', {
    type: 'range', min: 1, max: 4, step: 0.5, value: spec.exaggeration ?? 1.5,
    oninput: (e) => {
      map.__exaggeration = +e.target.value;
      if (is3D) map.setTerrain({ source: 'dem', exaggeration: +e.target.value });
    },
  });
  section('表示', h('div', {}, h('div', { class: 'segs' }, btn2d, btn3d), h('label', { class: 'slider' }, '起伏の強調 ', exag)));

  // 背景
  const baseKeys = spec.bases ?? Object.keys(BASES);
  const current = spec.base ?? 'std';
  section(
    '背景（国土地理院）',
    h(
      'div',
      { class: 'radios' },
      baseKeys.map((k) =>
        h(
          'label',
          {},
          h('input', { type: 'radio', name: `base-${Math.random()}`, checked: k === current, onchange: () => setBase(map, k) }),
          BASES[k].label,
        ),
      ),
    ),
  );

  // タイル重ね合わせ
  const overlayBox = h('div', { class: 'checks' });
  let hasOverlay = false;
  for (const L of spec.layers ?? []) {
    try {
      const r = L.resolve ? await L.resolve() : { tiles: L.tiles };
      const id = `ov-${L.id}`;
      const first = r.frames ? r.frames[r.frames.length - 1].tiles : r.tiles;
      map.addSource(id, {
        type: 'raster',
        tiles: [first],
        tileSize: 256,
        minzoom: L.minzoom ?? 0,
        maxzoom: L.maxzoom ?? r.maxzoom ?? 18,
        attribution: L.attribution ?? '',
      });
      map.addLayer({
        id,
        type: 'raster',
        source: id,
        paint: { 'raster-opacity': L.opacity ?? 0.8, 'raster-fade-duration': 0 },
        layout: { visibility: L.on === false ? 'none' : 'visible' },
      });
      hasOverlay = true;
      overlayBox.append(
        h(
          'label',
          {},
          h('input', {
            type: 'checkbox',
            checked: L.on !== false,
            onchange: (e) => map.setLayoutProperty(id, 'visibility', e.target.checked ? 'visible' : 'none'),
          }),
          L.label,
        ),
      );
      if (r.frames) overlayBox.append(frameControls(map, id, r.frames, cleanups));
    } catch (err) {
      console.warn('[overlay]', L.id, err);
      toast(`「${L.label}」を取得できませんでした`);
    }
  }
  if (hasOverlay) section('重ねるデータ', overlayBox);

  // 地名検索（国土地理院 地名検索API）
  const results = h('ul', { class: 'place-results', hidden: true });
  let marker = null;
  const input = h('input', { type: 'search', placeholder: '地名・住所を検索（例: 富士山、東京駅）', 'aria-label': '地名検索' });
  const run = async () => {
    const q = input.value.trim();
    if (!q) return (results.hidden = true);
    try {
      const j = await fetch(`https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(q)}`).then((r) => r.json());
      const top = j.slice(0, 7);
      results.replaceChildren(
        ...(top.length
          ? top.map((f) =>
              h('li', {
                onclick: () => {
                  const [lng, lat] = f.geometry.coordinates;
                  marker?.remove();
                  marker = new maplibregl.Marker({ color: '#ef4444' }).setLngLat([lng, lat]).addTo(map);
                  map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 12), speed: 1.4 });
                  results.hidden = true;
                },
              }, f.properties.title),
            )
          : [h('li', { class: 'none' }, '見つかりませんでした')]),
      );
      results.hidden = false;
    } catch {
      toast('地名検索に失敗しました');
    }
  };
  input.addEventListener('keydown', (e) => e.key === 'Enter' && run());
  input.addEventListener('search', () => !input.value && (results.hidden = true));
  stage.append(h('div', { class: 'place' }, input, results));
  cleanups.push(() => marker?.remove());

  if (spec.setup) {
    try {
      await spec.setup({ map, stage, body, section, card, h, toast, caption, maplibregl, cleanups, apply3D });
    } catch (err) {
      console.error('[setup]', err);
      toast(`データ取得に失敗しました: ${err.message}`);
    }
  }

  return {
    destroy() {
      cleanups.forEach((fn) => fn());
      map.remove();
    },
  };
}

function frameControls(map, id, frames, cleanups) {
  let i = frames.length - 1;
  let timer = null;
  const label = h('span', { class: 'tlabel' }, frames[i].label);
  const slider = h('input', { type: 'range', min: 0, max: frames.length - 1, value: i });
  const show = (n) => {
    i = n;
    slider.value = n;
    label.textContent = frames[n].label;
    map.getSource(id)?.setTiles([frames[n].tiles]);
  };
  slider.oninput = () => show(+slider.value);
  const play = h('button', { type: 'button', class: 'mini' }, '▶ 再生');
  const stop = () => {
    clearInterval(timer);
    timer = null;
    play.textContent = '▶ 再生';
  };
  play.onclick = () => {
    if (timer) return stop();
    play.textContent = '■ 停止';
    timer = setInterval(() => show((i + 1) % frames.length), 700);
  };
  cleanups.push(stop);
  return h('div', { class: 'frames' }, play, slider, label, h('small', {}, '時刻は JST'));
}
