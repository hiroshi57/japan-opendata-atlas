// 雨の日ルート診断
//  タブ1「ルートを比べる」: 候補ルートを「浸水想定区域 × 雨天時の事故」で比較し、おすすめと理由を示す
//  タブ2「写真・動画を診断」: ① 選ぶ → ② 場所を決める → ③ 結果。自分の写真・動画・GPX も同じ基準で診断する
import { h } from '../dom.js';
import { mountGeo } from '../viz/geo.js';
import { maplibregl } from '../viz/map-core.js';
import { makeRoute, makeSync, readTrackFile, pointAtD, dist } from './track.js';
import { readExif } from './exif.js';
import { evaluateRoute, scoreRoutes, verdict, photoVerdict, accidentsAround, floodClasses, FLOOD_LEGEND } from './risk.js';

const COLORS = ['#2563eb', '#ea580c', '#16a34a', '#9333ea', '#0891b2', '#be123c'];
const PRESETS = [
  ['新小岩駅 → 亀有駅（江戸川・葛飾）', [139.8574, 35.7166], [139.847, 35.7655]],
  ['東京駅 → 新宿駅', [139.7671, 35.6812], [139.7003, 35.6896]],
  ['大阪駅 → なんば駅', [135.4959, 34.7025], [135.5013, 34.6657]],
];
const accColor = (n) => (n >= 5 ? '#dc2626' : n >= 3 ? '#f97316' : n >= 2 ? '#fbbf24' : n >= 1 ? '#fde68a' : '#eceff1');
const rainColor = (n) => (n >= 3 ? '#1d4ed8' : n >= 2 ? '#60a5fa' : n >= 1 ? '#bfdbfe' : '#eceff1');
const floodColor = (c) => (c ? `rgb(${FLOOD_LEGEND[c - 1].rgb.join(',')})` : '#eceff1');
const fmtMin = (s) => (s == null ? '—' : `${Math.round(s / 60)}分`);
const LEVEL_CLASS = ['ok', 'mid', 'high'];

export async function mountRain(stage) {
  stage.replaceChildren();
  stage.classList.add('rain');
  const S = { tab: 'compare', routes: [], sel: 0, mySel: -1, mode: 'rain', A: null, B: null, pick: null, draw: null, video: null, photos: [], sync: null, follow: true, snap: true };
  const cleanups = [];
  let G = null;
  const userRoutes = () => S.routes.filter((r) => r.source !== 'osrm');
  const active = () => (S.tab === 'media' ? S.routes[S.mySel] ?? userRoutes()[0] : S.routes[S.sel]);

  /* ================= 左パネルの部品 ================= */
  const banner = h('div', { class: 'r-banner' });
  const status = h('div', { class: 'r-status' }, '出発地と目的地を指定して「ルートを比べる」を押してください。');
  const say = (m, err = false) => {
    status.textContent = m;
    status.classList.toggle('err', err);
  };
  const inA = h('input', { type: 'search', placeholder: '出発地（例: 新小岩駅）', 'aria-label': '出発地' });
  const inB = h('input', { type: 'search', placeholder: '目的地（例: 亀有駅）', 'aria-label': '目的地' });
  const pickA = h('button', { type: 'button', class: 'mini' }, '地図で指定');
  const pickB = h('button', { type: 'button', class: 'mini' }, '地図で指定');
  const modeBtns = [['rain', '大雨のとき'], ['normal', 'ふだん']].map(([k, label]) => {
    const b = h('button', { type: 'button', class: `seg${S.mode === k ? ' on' : ''}`, onclick: () => setMode(k) }, label);
    b.dataset.k = k;
    return b;
  });
  const goBtn = h('button', { type: 'button', class: 'btn' }, 'ルートを比べる');
  const results = h('div', { class: 'r-results' });
  const mediaBox = h('div', { class: 'r-media' });
  const syncBox = h('div', { class: 'r-sync', hidden: true });
  const stripBox = h('div', { class: 'r-strips', hidden: true });
  const fileMedia = h('input', { type: 'file', accept: 'video/*,image/*', multiple: true, hidden: true });
  const fileTrack = h('input', { type: 'file', accept: '.gpx,.csv,.txt,application/gpx+xml,text/csv', hidden: true });

  // ---- タブ ----
  const tabBtn = (k, label) => {
    const b = h('button', { type: 'button', class: 'r-tab', onclick: () => setTab(k) }, label);
    b.dataset.k = k;
    return b;
  };
  const tabs = h('div', { class: 'r-tabs' }, tabBtn('compare', 'ルートを比べる'), tabBtn('media', '写真・動画を診断'));

  // ---- タブ1: ルート比較 ----
  const paneCompare = h(
    'div',
    { class: 'r-pane' },
    h('section', {},
      h('h3', {}, '1. 行き先を指定'),
      h('label', { class: 'r-field' }, h('b', { class: 'dot a' }, 'A'), inA, pickA),
      h('label', { class: 'r-field' }, h('b', { class: 'dot b' }, 'B'), inB, pickB),
      h('div', { class: 'r-presets' }, PRESETS.map(([n, a, b]) => h('button', { type: 'button', class: 'chip', onclick: () => preset(n, a, b) }, n))),
      h('div', { class: 'r-row' }, h('span', {}, '想定する天気'), h('div', { class: 'segs' }, modeBtns)),
      h('div', { class: 'r-row' }, goBtn),
      status,
    ),
    h('section', {}, h('h3', {}, '2. 診断結果'), results),
  );

  // ---- タブ2: 写真・動画 ----
  const step1Info = h('div', { class: 'r-stepinfo' });
  const needBox = h('div', { class: 'r-need' });
  const outBox = h('div', { class: 'r-out' });
  const stepEls = [1, 2, 3].map((n) => h('span', { class: 'r-stepno' }, String(n)));
  const stepCard = (i, title, ...kids) => h('section', { class: 'r-step' }, h('h3', {}, stepEls[i], title), ...kids);
  const dropHint = h('p', { class: 'r-note' }, '写真（JPEG）・動画（MP4）をここにドラッグしても読み込めます。端末内だけで処理し、外部には送信しません（地図タイルの取得のみ通信します）。');
  const paneMedia = h(
    'div',
    { class: 'r-pane', hidden: true },
    stepCard(0, '写真・動画を選ぶ',
      h('div', { class: 'r-row wrap' }, h('button', { type: 'button', class: 'btn', onclick: () => fileMedia.click() }, '写真・動画を選ぶ')),
      dropHint, step1Info),
    stepCard(1, '場所を決める', needBox),
    stepCard(2, '診断結果', outBox),
  );

  const caveat = h(
    'section',
    { class: 'r-caveat' },
    h('h3', {}, 'この診断の見かた'),
    h('ul', {},
      h('li', {}, '浸水想定区域は「想定最大規模の降雨」での浸水想定（国土地理院・重ねるハザードマップ）です。実際の雨量ごとの予測ではなく、アンダーパスや側溝の冠水、河川の水位は反映されません。'),
      h('li', {}, '事故は警察庁の公開データ（最新年）で、交通量では割っていません。雨天は天候が「雨」の事故だけを数えています。件数が少ない区間の差は偶然のこともあります。'),
      h('li', {}, '安全度（0〜100）は当サイト独自の目安です。浸水（1kmあたりの深さ加重距離）と事故（1kmあたりの加重件数: 雨天=1、その他=0.3、死亡は+2）を、「リスク最大」とみなす基準（浸水3、事故8）で0〜1に換算し、大雨のときは浸水6:事故4、ふだんは浸水1.5:事故8.5で合成しています。基準値は経験的に置いたもので、公的な指標ではありません。'),
      h('li', {}, '通行止め・交通規制・冠水の実況は反映されません。大雨の際は、必ず最新の道路交通情報・自治体の情報も確認してください。'),
      h('li', {}, 'ルート候補は OpenStreetMap のデータと OSRM（公開デモサーバー）、場所の検索は OpenStreetMap Nominatim と国土地理院の地名検索を使っています（© OpenStreetMap contributors）。'),
    ),
  );

  const side = h('div', { class: 'rain-side' }, banner, tabs, paneCompare, paneMedia, caveat, fileMedia, fileTrack);
  const mapPane = h('div', { class: 'stage rain-map' });
  stage.append(side, mapPane);
  mapPane.__rain = S; // デバッグ/自動テスト用

  /* ================= 地図 ================= */
  const handle = await mountGeo(mapPane, {
    center: [139.78, 35.7], zoom: 10.6, base: 'pale', bases: ['pale', 'std', 'photo', 'relief'],
    caption: '浸水想定区域（想定最大規模・国土地理院）と、警察庁 交通事故統計の事故地点で評価します',
    layers: [{ id: 'flood', label: '洪水浸水想定区域（想定最大規模）', tiles: 'https://disaportal.gsi.go.jp/raster/01_flood_l2_shinsuishin_data/{z}/{x}/{y}.png', minzoom: 2, maxzoom: 17, opacity: 0.6 }],
    setup: async (ctx) => {
      G = ctx;
    },
  });
  const map = G.map;
  map.addSource('rt', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addSource('acc', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addSource('draw', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'rt-casing', type: 'line', source: 'rt', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#fff', 'line-width': ['case', ['==', ['get', 'sel'], 1], 11, 7] } });
  map.addLayer({ id: 'rt-line', type: 'line', source: 'rt', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['==', ['get', 'sel'], 1], 6, 3.5], 'line-opacity': ['case', ['==', ['get', 'sel'], 1], 1, 0.75] } });
  map.addLayer({ id: 'draw-line', type: 'line', source: 'draw', paint: { 'line-color': '#111827', 'line-width': 3.5, 'line-dasharray': [2, 1.5] } });
  map.addLayer({ id: 'draw-pts', type: 'circle', source: 'draw', filter: ['==', '$type', 'Point'], paint: { 'circle-radius': 5, 'circle-color': '#111827', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
  map.addLayer({ id: 'acc', type: 'circle', source: 'acc', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 16, 7], 'circle-color': ['case', ['get', 'rain'], '#1d4ed8', '#6b7280'], 'circle-stroke-color': ['case', ['get', 'fatal'], '#dc2626', '#fff'], 'circle-stroke-width': ['case', ['get', 'fatal'], 2.2, 0.8], 'circle-opacity': 0.85 } });

  const markers = { a: null, b: null, cur: null, hot: [], photos: [] };
  const pin = (cls, text) => h('div', { class: `pin ${cls}` }, text);
  const putAB = (which, lnglat) => {
    S[which.toUpperCase()] = lnglat;
    markers[which]?.remove();
    markers[which] = new maplibregl.Marker({ element: pin(which, which.toUpperCase()) }).setLngLat(lnglat).addTo(map);
  };
  const flat = () => G.apply3D(false); // 位置指定・なぞりは、傾き・地形を戻して平面で行う

  /* ================= 「次にやること」バナー ================= */
  function nextAction() {
    if (S.pick) return { n: '!', text: `地図をクリックして、${S.pick.label}を指定してください。`, btns: [['キャンセル', cancelPick]] };
    if (S.draw) {
      return { n: '!', text: `通った道を順にクリックしてください（現在 ${S.draw.length} 点）。終わったら「確定」を押すと、そのまま診断します。`, btns: [['元に戻す', undoDraw], ['確定', () => endDraw(true), true], ['キャンセル', () => endDraw(false)]] };
    }
    if (S.tab === 'compare') {
      return S.routes.some((r) => r.risk)
        ? { n: '✓', text: '診断できました。表の行か地図上の線を選ぶと、そのルートの詳細が出ます。' }
        : { n: '1', text: '出発地と目的地を決めて「ルートを比べる」を押してください。' };
    }
    if (!S.photos.length && !S.video) return { n: '1', text: '「写真・動画を選ぶ」から、診断したい写真か動画を選んでください。' };
    const np = S.photos.find((p) => p.lat == null);
    if (np) return { n: '2', text: `写真「${np.name}」には位置情報がありません。撮った場所を、②で決めてください。` };
    if (S.video && !userRoutes().length) return { n: '2', text: '動画の道順が必要です。②で、GPX/CSV を読み込むか、地図をなぞってください。' };
    return { n: '3', text: '場所が決まりました。③で結果を確認できます。' };
  }
  function renderBanner() {
    const a = nextAction();
    banner.className = `r-banner${S.pick || S.draw ? ' act' : ''}`;
    banner.replaceChildren(
      h('b', { class: 'r-stepno' }, a.n),
      h('span', {}, a.text),
      ...(a.btns ?? []).map(([t, fn, primary]) => h('button', { type: 'button', class: `mini${primary ? ' primary' : ''}`, onclick: fn }, t)),
    );
  }

  /* ================= 地名検索 / 地図クリック ================= */
  // 施設名・駅名・住所の検索: OpenStreetMap Nominatim（施設名に強い）→ 見つからなければ国土地理院の地名検索
  async function geocodeAll(q) {
    const enc = encodeURIComponent(q);
    try {
      const j = await fetch(`https://nominatim.openstreetmap.org/search?q=${enc}&format=jsonv2&limit=5&countrycodes=jp&accept-language=ja`).then((r) => r.json());
      if (j.length) return j.map((x) => ({ lnglat: [+x.lon, +x.lat], title: x.display_name.split(', ').slice(0, 3).join(' / ') }));
    } catch {
      /* 次の検索へ */
    }
    const g = await fetch(`https://msearch.gsi.go.jp/address-search/AddressSearch?q=${enc}`).then((r) => r.json());
    return g.slice(0, 6).map((f) => ({ lnglat: f.geometry.coordinates, title: f.properties.title }));
  }
  async function resolve(input, which) {
    const q = input.value.trim();
    if (!q || input.dataset.pt) return;
    const r = (await geocodeAll(q))[0];
    if (!r) throw new Error(`「${q}」が見つかりません`);
    putAB(which, r.lnglat);
    input.value = r.title;
    input.dataset.pt = '1';
  }
  for (const [inp, which] of [[inA, 'a'], [inB, 'b']]) {
    inp.addEventListener('input', () => delete inp.dataset.pt);
    inp.addEventListener('keydown', (e) => e.key === 'Enter' && resolve(inp, which).catch((er) => say(er.message, true)));
  }
  const startPick = (spec) => {
    S.pick = spec;
    flat();
    map.getCanvas().style.cursor = 'crosshair';
    renderBanner();
  };
  const cancelPick = () => {
    S.pick = null;
    map.getCanvas().style.cursor = '';
    renderBanner();
  };
  pickA.onclick = () => startPick({ type: 'a', label: '出発地' });
  pickB.onclick = () => startPick({ type: 'b', label: '目的地' });

  function preset(name, a, b) {
    const [from, to] = name.split(' → ').map((s) => s.replace(/（.*/, ''));
    putAB('a', a);
    putAB('b', b);
    inA.value = from;
    inB.value = to;
    inA.dataset.pt = inB.dataset.pt = '1';
    compare();
  }

  /* ================= 候補ルートの取得 → 評価 ================= */
  async function compare() {
    try {
      await Promise.all([resolve(inA, 'a'), resolve(inB, 'b')]);
      if (!S.A || !S.B) return say('出発地と目的地を指定してください。', true);
      say('候補ルートを検索中…');
      const url = `https://router.project-osrm.org/route/v1/driving/${S.A.join(',')};${S.B.join(',')}?alternatives=3&overview=full&geometries=geojson`;
      const j = await fetch(url).then((r) => r.json());
      if (j.code !== 'Ok') throw new Error('ルートを取得できませんでした（距離が長すぎる／道路が近くにない可能性）');
      const mine = userRoutes();
      const found = j.routes.map((r, i) => makeRoute({ name: `ルート${'ABCD'[i]}`, coords: r.geometry.coordinates, source: 'osrm', durationSec: r.duration }));
      S.routes = [...found, ...mine];
      recolor();
      await evaluateAll();
      fit();
    } catch (e) {
      say(e.message, true);
    }
  }
  goBtn.onclick = compare;
  const recolor = () => S.routes.forEach((r, i) => (r.color = COLORS[i % COLORS.length]));

  async function evaluateAll() {
    say('浸水想定区域と事故データを照合中…（初回は事故データ 2.5MB を読み込みます）');
    await Promise.all(S.routes.filter((r) => !r.risk).map((r) => evaluateRoute(r)));
    scoreRoutes(S.routes, S.mode);
    const v = verdict(S.routes, S.mode);
    if (v.best) S.sel = Math.max(0, S.routes.indexOf(v.best));
    say('診断が完了しました。');
    render();
  }

  function setMode(k) {
    S.mode = k;
    modeBtns.forEach((b) => b.classList.toggle('on', b.dataset.k === k));
    if (S.routes.some((r) => r.risk)) {
      scoreRoutes(S.routes, k);
      render();
    }
  }

  function setTab(k) {
    S.tab = k;
    tabs.querySelectorAll('.r-tab').forEach((b) => b.classList.toggle('on', b.dataset.k === k));
    paneCompare.hidden = k !== 'compare';
    paneMedia.hidden = k !== 'media';
    side.scrollTop = 0;
    render();
  }

  /* ================= 描画 ================= */
  function render() {
    renderBanner();
    renderCompare();
    renderMedia();
    refreshMap();
    renderStrips();
    renderSync();
  }

  function renderCompare() {
    results.replaceChildren();
    const done = S.routes.filter((r) => r.risk);
    if (!done.length) return results.append(h('p', { class: 'r-note' }, 'ルートを比べると、ここにおすすめと理由が表示されます。'));
    const v = verdict(S.routes, S.mode);
    results.append(
      h('div', { class: `r-verdict${v.best ? '' : ' none'}`, style: v.best ? `--c:${v.best.color}` : '' },
        h('b', {}, v.title),
        v.lines.map((l) => h('p', {}, l)),
        v.notes.map((l) => h('p', { class: 'warn' }, l)),
        h('small', {}, S.mode === 'rain' ? '大雨のとき（浸水を重く評価）の判定です。' : 'ふだん（事故を重く評価）の判定です。')),
    );
    const rows = S.routes.map((r, i) => {
      const k = r.risk;
      if (!k) return null;
      return h('tr', { class: i === S.sel ? 'sel' : '', onclick: () => { S.sel = i; render(); } },
        h('td', {}, h('i', { class: 'sw', style: `background:${r.color}` }), r.name, v.best === r ? h('div', {}, h('em', { class: 'best' }, 'おすすめ')) : null),
        h('td', {}, `${k.lengthKm.toFixed(1)}km`, h('br'), h('small', {}, fmtMin(r.durationSec))),
        h('td', {}, k.floodKm < 0.05 ? 'なし' : `${k.floodKm.toFixed(1)}km`, h('br'), h('small', {}, k.deepFloodKm >= 0.05 ? `3m以上 ${k.deepFloodKm.toFixed(1)}km` : k.floodKm >= 0.05 ? `最大 ${FLOOD_LEGEND[k.maxFloodCls - 1].label}` : '')),
        h('td', {}, `${k.total}件`, h('br'), h('small', {}, `雨天${k.rain}・死亡${k.fatal}`)),
        h('td', {}, h('div', { class: 'score' }, h('b', {}, k.safety), h('span', { class: 'bar' }, h('i', { style: `width:${k.safety}%;background:${r.color}` })))),
      );
    });
    results.append(
      h('table', { class: 'r-table' },
        h('thead', {}, h('tr', {}, ['ルート', '距離', '浸水想定を通る距離', `事故（${done[0].risk.year}年・30m以内）`, '安全度'].map((t) => h('th', {}, t)))),
        h('tbody', {}, rows)),
      legend(),
    );
    const r = S.routes[S.sel];
    if (r?.risk?.hotspots.length) results.append(hotspotsEl(r));
    if (S.tab === 'compare' && r?.risk) results.append(stripBox);
  }

  const legend = () =>
    h('div', { class: 'r-legend' },
      h('small', {}, '浸水の深さ: '), FLOOD_LEGEND.map((L) => h('span', {}, h('i', { style: `background:rgb(${L.rgb})` }), L.label)),
      h('br'), h('small', {}, '事故の点: '), h('span', {}, h('i', { class: 'c rain' }), '雨天'), h('span', {}, h('i', { class: 'c' }), 'その他'), h('span', {}, h('i', { class: 'c fatal' }), '死亡事故（赤縁）'));
  const hotspotsEl = (r) =>
    h('div', { class: 'r-hot' }, h('b', {}, `${r.name} の事故が集中する地点`),
      r.risk.hotspots.map((p, i) => h('button', { type: 'button', class: 'mini', onclick: () => map.flyTo({ center: [p.lng, p.lat], zoom: 17, speed: 1.4 }) }, `${i + 1}. 100mで${p.all}件（雨天${p.rain}）`)));

  /* ---- タブ2: ステップの状態と中身 ---- */
  function renderMedia() {
    const np = S.photos.filter((p) => p.lat == null);
    const placedAll = (S.photos.length || S.video) && !np.length && !(S.video && !userRoutes().length);
    const hasResult = S.photos.some((p) => p.risk) || (S.video && active()?.risk);
    stepEls.forEach((el, i) => {
      const done = [!!(S.photos.length || S.video), !!placedAll, !!hasResult][i];
      el.className = `r-stepno${done ? ' done' : ''}`;
      el.textContent = done ? '✓' : String(i + 1);
    });
    step1Info.textContent = S.photos.length || S.video
      ? `読み込み済み: ${[S.photos.length ? `写真 ${S.photos.length} 枚` : '', S.video ? `動画 1 本（${Math.round(S.video.el.duration)}秒）` : ''].filter(Boolean).join(' ／ ')}`
      : '';

    // ② 場所を決める
    needBox.replaceChildren();
    if (!S.photos.length && !S.video) needBox.append(h('p', { class: 'r-note' }, '先に ① で写真か動画を選んでください。'));
    for (const p of np) needBox.append(placePicker(p));
    if (S.video && !userRoutes().length) {
      needBox.append(
        h('div', { class: 'r-need-card' },
          h('b', {}, '動画の道順を指定'),
          h('p', { class: 'r-note' }, 'GPX/CSV があれば読み込むだけで、再生位置と地図が連動します。無ければ、通った道を地図でなぞってください（一定の速度で走ったとみなします）。'),
          h('div', { class: 'r-row wrap' },
            h('button', { type: 'button', class: 'mini primary', onclick: () => fileTrack.click() }, 'GPX/CSV を読み込む'),
            h('button', { type: 'button', class: 'mini primary', onclick: startDraw }, '地図でなぞる'))),
      );
    }
    if (!np.length && (S.photos.length || S.video) && !(S.video && !userRoutes().length)) {
      needBox.append(h('p', { class: 'r-note ok' }, '場所はすべて決まっています。③ の結果をご覧ください。各ピンは地図上でドラッグすると微調整できます。'));
    }
    if (S.photos.length || S.video) {
      needBox.append(h('div', { class: 'r-row wrap' },
        userRoutes().length ? null : h('button', { type: 'button', class: 'mini', onclick: () => fileTrack.click() }, '経路ファイル（GPX/CSV）'),
        S.draw ? null : h('button', { type: 'button', class: 'mini', onclick: startDraw }, '地図でなぞって経路を追加'),
        userRoutes().length ? h('label', { class: 'checks-one' }, h('input', { type: 'checkbox', checked: S.snap, onchange: (e) => (S.snap = e.target.checked) }), ' 写真の位置を、なぞった経路に吸着させる') : null));
    }

    // ③ 結果
    outBox.replaceChildren();
    const r = active();
    if (S.video) {
      outBox.append(h('div', { class: 'r-card' }, h('b', {}, '動画'), mediaBox, syncBox, r?.risk ? routeSummary(r) : h('p', { class: 'r-note' }, '道順を指定すると、再生位置と地図が連動し、経路に沿ったリスクが表示されます。')));
      if (r?.risk) outBox.append(stripBox);
    } else if (r?.risk) {
      outBox.append(h('div', { class: 'r-card' }, h('b', {}, 'なぞった経路'), routeSummary(r)), stripBox);
    }
    for (const p of S.photos) if (p.lat != null) outBox.append(photoCard(p));
    if (!outBox.childNodes.length) outBox.append(h('p', { class: 'r-note' }, 'ここに診断結果が表示されます。'));
    if (r?.risk?.hotspots.length && S.tab === 'media') outBox.append(hotspotsEl(r));
    if (outBox.childNodes.length > 1) outBox.append(legend());
  }

  const routeSummary = (r) => {
    const k = r.risk;
    return h('div', { class: 'r-sum' },
      h('p', {}, h('b', {}, r.name), `（${k.lengthKm.toFixed(1)}km）`),
      h('p', {}, k.floodKm < 0.05 ? '浸水想定区域を通りません。' : `浸水想定区域を ${k.floodKm.toFixed(1)}km 通ります${k.deepFloodKm >= 0.05 ? `（うち3m以上の想定 ${k.deepFloodKm.toFixed(1)}km）` : ''}。`),
      h('p', {}, `30m以内の事故は ${k.total} 件（雨天 ${k.rain}・死亡 ${k.fatal}）。1kmあたり ${k.perKm.toFixed(1)} 件。`),
      h('p', {}, h('b', {}, `安全度 ${k.safety}`), h('small', {}, '（0〜100・目安。「ルートを比べる」で他のルートと比較できます）')));
  };

  function photoCard(p) {
    const body = p.risk
      ? (() => {
          const v = photoVerdict(p.risk);
          return [h('div', { class: `r-level ${LEVEL_CLASS[v.level]}` }, v.title), ...v.lines.map((l) => h('p', {}, l))];
        })()
      : [h('p', { class: 'r-note' }, '浸水想定と事故データを照合中…')];
    return h('div', { class: 'r-card photo-card', onclick: () => focusPhoto(p) },
      h('img', { src: p.url, alt: p.name }),
      h('div', {},
        h('b', {}, `${p.id + 1}. ${p.name}`),
        h('small', {}, ` 位置: ${p.how}`),
        ...body,
        h('button', { type: 'button', class: 'mini', onclick: (e) => { e.stopPropagation(); p.lat = null; p.lon = null; p.risk = null; p.how = null; render(); } }, '場所を変える')));
  }

  /** 場所を決められていない写真ごとの入力カード */
  function placePicker(p) {
    const list = h('ul', { class: 'place-results', hidden: true });
    const input = h('input', { type: 'search', placeholder: '撮った場所の名前（例: 札幌ドーム、新小岩駅）', 'aria-label': '場所の名前' });
    const run = async () => {
      const q = input.value.trim();
      if (!q) return;
      list.replaceChildren(h('li', { class: 'none' }, '検索中…'));
      list.hidden = false;
      try {
        const rs = await geocodeAll(q);
        list.replaceChildren(...(rs.length
          ? rs.map((r) => h('li', { onclick: () => setPhotoPos(p, r.lnglat[0], r.lnglat[1], `地名「${r.title}」`, { snap: false }) }, r.title))
          : [h('li', { class: 'none' }, '見つかりませんでした')]));
      } catch {
        list.replaceChildren(h('li', { class: 'none' }, '検索に失敗しました'));
      }
    };
    input.addEventListener('keydown', (e) => e.key === 'Enter' && run());
    return h('div', { class: 'r-need-card' },
      h('div', { class: 'r-need-head' }, h('img', { src: p.url, alt: p.name }), h('div', {}, h('b', {}, `${p.id + 1}. ${p.name}`), h('small', {}, '位置情報がありません'))),
      h('p', { class: 'r-note' }, '撮影場所を、次のどれかで指定してください。'),
      h('div', { class: 'r-field' }, input, h('button', { type: 'button', class: 'mini primary', onclick: run }, '地名で探す')),
      list,
      h('div', { class: 'r-row wrap' },
        h('button', { type: 'button', class: 'mini primary', onclick: () => startPick({ type: 'photo', id: p.id, label: `写真「${p.name}」を撮った場所` }) }, '地図をクリックして指定'),
        h('small', {}, '指定後に、ピンをドラッグして微調整もできます')));
  }

  function refreshMap() {
    const a = active();
    map.getSource('rt').setData({
      type: 'FeatureCollection',
      features: S.routes.map((r) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: r.coords }, properties: { color: r.color, sel: r === a ? 1 : 0 } })),
    });
    map.getSource('acc').setData({
      type: 'FeatureCollection',
      features: (a?.risk?.acc.points ?? []).map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng, p.lat] }, properties: { rain: p.rain, fatal: p.fatal } })),
    });
    markers.hot.forEach((m) => m.remove());
    markers.hot = (a?.risk?.hotspots ?? []).map((p, i) => new maplibregl.Marker({ element: pin('hot', String(i + 1)) }).setLngLat([p.lng, p.lat]).addTo(map));
    // 写真ピン（ドラッグで微調整）
    markers.photos.forEach((m) => m.remove());
    markers.photos = S.photos.filter((p) => p.lat != null).map((p) => {
      const m = new maplibregl.Marker({ element: pin('photo', String(p.id + 1)), draggable: true }).setLngLat([p.lon, p.lat]).addTo(map);
      m.getElement().addEventListener('click', () => focusPhoto(p));
      m.on('dragend', () => {
        const ll = m.getLngLat();
        setPhotoPos(p, ll.lng, ll.lat, 'ピンを移動', { snap: false, fly: false });
      });
      return m;
    });
  }

  function fit() {
    const pts = S.routes.flatMap((r) => r.coords);
    if (!pts.length) return;
    const b = pts.reduce((a, [x, y]) => [Math.min(a[0], x), Math.min(a[1], y), Math.max(a[2], x), Math.max(a[3], y)], [Infinity, Infinity, -Infinity, -Infinity]);
    map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 70, duration: 900 });
  }

  /* ================= 経路沿いの帯グラフ・動画の再生位置 ================= */
  const cv = h('canvas', { class: 'strip-cv' });
  const head = h('div', { class: 'strip-head' }, ...['事故', '雨天の事故', '浸水想定'].map((t) => h('span', {}, t)));
  const playhead = h('div', { class: 'playhead', hidden: true });
  const wrap = h('div', { class: 'strip-wrap' }, cv, playhead);
  stripBox.append(
    h('b', { class: 'strip-title' }),
    h('div', { class: 'strip-grid' }, head, wrap),
    h('label', { class: 'checks-one' }, h('input', { type: 'checkbox', checked: true, onchange: (e) => (S.follow = e.target.checked) }), ' 再生中、地図を追従させる'),
    h('small', { class: 'r-note' }, '帯をクリック（ドラッグ）すると、その地点へ移動し、動画があればその場面に飛びます。'),
  );

  function renderStrips() {
    const r = active();
    const show = !!r?.risk;
    stripBox.hidden = !show;
    if (!show) return;
    stripBox.querySelector('.strip-title').textContent = `${r.name} に沿ったリスク（左＝出発地、右＝目的地）`;
    const W = Math.max(200, wrap.clientWidth || 320);
    const dpr = window.devicePixelRatio || 1;
    cv.style.width = `${W}px`;
    cv.width = W * dpr;
    cv.height = 52 * dpr;
    const g = cv.getContext('2d');
    g.scale(dpr, dpr);
    const n = r.samples.length;
    const w = W / n + 0.6;
    r.samples.forEach((_, i) => {
      const x = (i / n) * W;
      g.fillStyle = accColor(r.risk.per100[i].all); g.fillRect(x, 0, w, 16);
      g.fillStyle = rainColor(r.risk.per100[i].rain); g.fillRect(x, 18, w, 16);
      g.fillStyle = floodColor(r.risk.cls[i]); g.fillRect(x, 36, w, 16);
    });
  }

  const showAt = (d, { seek = false } = {}) => {
    const r = active();
    if (!r) return;
    const p = pointAtD(r, d);
    if (!markers.cur) markers.cur = new maplibregl.Marker({ element: pin('cur', '') }).setLngLat([p.lng, p.lat]).addTo(map);
    markers.cur.setLngLat([p.lng, p.lat]);
    playhead.hidden = false;
    playhead.style.left = `${(d / (r.length || 1)) * 100}%`;
    if (S.follow && (seek || (S.video && !S.video.el.paused))) map.easeTo({ center: [p.lng, p.lat], duration: 400, zoom: Math.max(map.getZoom(), 15.5) });
    if (seek && S.video && S.sync) S.video.el.currentTime = Math.max(0, Math.min(S.video.el.duration, S.sync.tAtD(d)));
  };
  const onStrip = (e) => {
    const r = active();
    if (!r) return;
    const f = Math.min(1, Math.max(0, (e.clientX - wrap.getBoundingClientRect().left) / wrap.clientWidth));
    showAt(f * r.length, { seek: true });
  };
  let dragging = false;
  wrap.addEventListener('pointerdown', (e) => { dragging = true; wrap.setPointerCapture(e.pointerId); onStrip(e); });
  wrap.addEventListener('pointermove', (e) => dragging && onStrip(e));
  wrap.addEventListener('pointerup', () => (dragging = false));
  window.addEventListener('resize', renderStrips);
  cleanups.push(() => window.removeEventListener('resize', renderStrips));

  let raf = 0;
  const tick = () => {
    if (S.video && S.sync && active() && !S.video.el.paused) showAt(S.sync.dAtT(S.video.el.currentTime));
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  cleanups.push(() => cancelAnimationFrame(raf));

  function renderSync() {
    const r = active();
    const can = S.video && r && r.source !== 'osrm';
    syncBox.hidden = !can;
    if (!can) { S.sync = null; return; }
    if (!S.sync || S.sync.route !== r) {
      S.sync = makeSync(r, { duration: S.video.el.duration, startMs: S.video.startMs });
      S.sync.route = r;
    }
    const sy = S.sync;
    const num = (label, key, min, max, step = 1) => h('label', { class: 'r-field sm' }, label, h('input', { type: 'number', min, max, step, value: sy[key], onchange: (e) => { sy[key] = +e.target.value; showAt(sy.dAtT(S.video.el.currentTime)); } }));
    syncBox.replaceChildren(
      h('small', {}, sy.timed
        ? '経路の時刻と動画を自動で対応づけています（動画の開始は「ファイル更新日時 − 長さ」で推定）。ずれる場合は秒で補正:'
        : '経路に時刻が無いため、一定の速度で走ったとみなします。動画のうち走行している区間（秒）を指定:'),
      sy.timed ? num('ずれ補正(秒)', 'offset', -3600, 3600) : h('div', { class: 'r-row' }, num('開始(秒)', 'from', 0, S.video.el.duration), num('終了(秒)', 'to', 0, S.video.el.duration)),
    );
  }

  /* ================= 動画・写真の読み込み ================= */
  async function onMedia(files) {
    const vids = files.filter((f) => f.type.startsWith('video/'));
    const imgs = files.filter((f) => f.type.startsWith('image/'));
    if (!vids.length && !imgs.length) return say('写真（JPEG）か動画（MP4）を選んでください。', true);
    setTab('media');
    if (vids[0]) {
      if (S.video) URL.revokeObjectURL(S.video.el.src);
      const el = h('video', { src: URL.createObjectURL(vids[0]), controls: true, playsinline: true, preload: 'metadata', class: 'r-video' });
      await new Promise((res, rej) => {
        el.addEventListener('loadedmetadata', res, { once: true });
        el.addEventListener('error', () => rej(new Error('この動画は再生できません（形式非対応の可能性。Android 標準の MP4 (H.264) なら読み込めます）')), { once: true });
      });
      if (!Number.isFinite(el.duration)) {
        // MediaRecorder 等で作られた動画は duration が不定なので、末尾へシークして確定させる
        await new Promise((res) => {
          el.addEventListener('timeupdate', res, { once: true });
          el.currentTime = 1e101;
        });
        el.currentTime = 0;
      }
      S.video = { el, file: vids[0], startMs: vids[0].lastModified - el.duration * 1000 };
      S.sync = null;
      el.addEventListener('seeked', () => S.sync && active() && showAt(S.sync.dAtT(el.currentTime)));
      mediaBox.replaceChildren(el);
    }
    if (imgs.length) await addPhotos(imgs);
    render();
    needBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  async function addPhotos(files) {
    for (const f of files) {
      const ex = await readExif(f).catch(() => ({ lat: null, lon: null, dir: null, timeMs: null }));
      const p = { id: S.photos.length, name: f.name, url: URL.createObjectURL(f), ...ex, how: ex.lat != null ? '写真の位置情報（EXIF）' : null, risk: null };
      S.photos.push(p);
      locateByTime(p);
    }
    render();
    await Promise.all(S.photos.filter((p) => p.lat != null && !p.risk).map(evalPhoto));
    render();
  }

  function locateByTime(p) {
    if (p.lat != null || p.timeMs == null) return;
    for (const r of S.routes) {
      if (r.samples[0].ms == null) continue;
      let best = null;
      for (const s of r.samples) if (!best || Math.abs(s.ms - p.timeMs) < Math.abs(best.ms - p.timeMs)) best = s;
      if (best && Math.abs(best.ms - p.timeMs) < 180000) {
        Object.assign(p, { lat: best.lat, lon: best.lng, how: `GPX の時刻から推定（${r.name}）` });
        return;
      }
    }
  }

  async function evalPhoto(p) {
    const [around, cls] = await Promise.all([accidentsAround(p.lon, p.lat), floodClasses([{ lng: p.lon, lat: p.lat }])]);
    p.risk = { around, flood: cls[0] };
  }

  /** 写真の位置を設定する。経路があれば（snap）近くの経路へ吸着し、地図をその場所へ移動して結果を出す */
  async function setPhotoPos(p, lng, lat, how, { snap = true, fly = true } = {}) {
    let pos = { lng, lat };
    if (snap && S.snap) {
      let best = null;
      for (const r of userRoutes()) for (const s of r.samples) { const d = dist([lng, lat], [s.lng, s.lat]); if (d <= 250 && (!best || d < best.d)) best = { d, s }; }
      if (best) { pos = { lng: best.s.lng, lat: best.s.lat }; how = `${how}（なぞった経路に吸着）`; }
    }
    Object.assign(p, { lon: pos.lng, lat: pos.lat, how, risk: null });
    if (fly) map.flyTo({ center: [pos.lng, pos.lat], zoom: 16.5, pitch: 0, bearing: 0, speed: 1.3 });
    render();
    await evalPhoto(p);
    render();
    outBox.querySelector('.photo-card')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function focusPhoto(p) {
    if (p.lat != null) map.flyTo({ center: [p.lon, p.lat], zoom: 16.5, speed: 1.3 });
  }

  /* ================= 経路ファイル / なぞり ================= */
  async function addUserRoute({ name, coords, times }) {
    S.routes = S.routes.filter((r) => r.name !== name);
    const r = makeRoute({ name, coords, times, source: times ? 'gpx' : 'drawn', durationSec: times ? (times.at(-1) - times[0]) / 1000 : null });
    S.routes.push(r);
    recolor();
    S.photos.forEach((p) => locateByTime(p));
    S.mySel = S.routes.indexOf(r);
    setTab('media');
    say('経路を診断中…');
    await evaluateAll();
    S.mySel = S.routes.indexOf(r);
    S.sel = S.routes.indexOf(r);
    fit();
    render();
    await Promise.all(S.photos.filter((p) => p.lat != null && !p.risk).map(evalPhoto));
    render();
  }
  fileMedia.onchange = async () => {
    try { await onMedia([...fileMedia.files]); } catch (e) { say(e.message, true); setTab('media'); needBox.prepend(h('p', { class: 'r-note err' }, e.message)); }
    fileMedia.value = '';
  };
  fileTrack.onchange = async () => {
    try {
      const f = fileTrack.files[0];
      if (!f) return;
      const t = await readTrackFile(f);
      await addUserRoute({ name: `自分の走行（${f.name}）`, ...t });
    } catch (e) { setTab('media'); needBox.prepend(h('p', { class: 'r-note err' }, e.message)); }
    fileTrack.value = '';
  };

  const drawGeo = () => {
    const pts = S.draw ?? [];
    const feats = pts.map((c) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: {} }));
    if (pts.length > 1) feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: pts }, properties: {} });
    map.getSource('draw').setData({ type: 'FeatureCollection', features: feats });
  };
  function startDraw() {
    S.draw = [];
    flat();
    map.getCanvas().style.cursor = 'crosshair';
    setTab('media');
  }
  const undoDraw = () => {
    S.draw?.pop();
    drawGeo();
    renderBanner();
  };
  function endDraw(commit) {
    const pts = S.draw ?? [];
    if (commit && pts.length < 2) return say('2 点以上クリックしてください。', true);
    S.draw = null;
    map.getCanvas().style.cursor = '';
    drawGeo();
    renderBanner();
    if (commit) addUserRoute({ name: '自分の走行（なぞり）', coords: pts, times: null }).catch((e) => say(e.message, true));
    else render();
  }

  map.on('click', (e) => {
    const ll = [e.lngLat.lng, e.lngLat.lat];
    if (S.pick) {
      const k = S.pick;
      S.pick = null;
      map.getCanvas().style.cursor = '';
      if (k.type === 'a' || k.type === 'b') {
        putAB(k.type, ll);
        const inp = k.type === 'a' ? inA : inB;
        inp.value = `地図上の点（${ll[1].toFixed(4)}, ${ll[0].toFixed(4)}）`;
        inp.dataset.pt = '1';
        say(`${k.label}を指定しました。`);
        renderBanner();
      } else if (k.type === 'photo') {
        setPhotoPos(S.photos[k.id], ll[0], ll[1], '地図で指定');
      }
      return;
    }
    if (S.draw) {
      S.draw.push(ll);
      drawGeo();
      renderBanner();
    }
  });
  map.on('click', 'rt-line', (e) => {
    if (S.pick || S.draw) return;
    const i = S.routes.findIndex((r) => r.color === e.features[0].properties.color);
    if (i >= 0) { S.sel = i; if (S.routes[i].source !== 'osrm') S.mySel = i; render(); }
  });

  // ドラッグ＆ドロップで写真・動画を読み込む
  side.addEventListener('dragover', (e) => e.preventDefault());
  side.addEventListener('drop', (e) => {
    e.preventDefault();
    onMedia([...e.dataTransfer.files]).catch((er) => say(er.message, true));
  });

  /* ================= 書き出し ================= */
  G.setExport(() => {
    const rows = S.routes.filter((r) => r.risk).map((r) => ({
      種別: 'ルート', 名称: r.name, 距離km: +r.risk.lengthKm.toFixed(2), 所要分: r.durationSec != null ? Math.round(r.durationSec / 60) : '',
      浸水想定区域を通る距離km: +r.risk.floodKm.toFixed(2), '浸水3m以上km': +r.risk.deepFloodKm.toFixed(2),
      事故件数_30m以内: r.risk.total, 雨天の事故: r.risk.rain, 死亡事故: r.risk.fatal, 事故_件毎km: +r.risk.perKm.toFixed(2), 安全度_目安: r.risk.safety ?? '', 想定: S.mode === 'rain' ? '大雨のとき' : 'ふだん',
    }));
    for (const p of S.photos) rows.push({ 種別: '写真', 名称: p.name, 緯度: p.lat ?? '', 経度: p.lon ?? '', 位置の根拠: p.how ?? '', 浸水想定: p.risk ? (p.risk.flood ? FLOOD_LEGEND[p.risk.flood - 1].label : '区域外') : '', '事故_100m以内': p.risk?.around[1].all ?? '', '雨天事故_100m以内': p.risk?.around[1].rain ?? '' });
    return { name: '雨の日ルート診断', source: '国土地理院 重ねるハザードマップ（洪水・想定最大規模）／警察庁 交通事故統計オープンデータ／OSRM(OpenStreetMap)', rows };
  });

  tabs.querySelector('[data-k="compare"]').classList.add('on');
  renderBanner();

  return {
    canExport: () => true,
    exportData: handle.exportData,
    destroy() {
      cleanups.forEach((fn) => fn());
      Object.values(markers).flat().forEach((m) => m?.remove?.());
      S.photos.forEach((p) => URL.revokeObjectURL(p.url));
      if (S.video) URL.revokeObjectURL(S.video.el.src);
      handle.destroy();
    },
  };
}
