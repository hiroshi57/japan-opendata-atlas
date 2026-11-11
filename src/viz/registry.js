// カタログ項目 ID → ビジュアル定義。ここに無い項目は「情報カード」表示になる。
// 各エンドポイントは「キー不要・CORS 可」を実測で確認済みのものだけを採用。
import { fmtJst14 } from '../dom.js';

const GSI = 'https://cyberjapandata.gsi.go.jp/xyz';
const JMA = 'https://www.jma.go.jp/bosai';
const TOKYO = [139.7671, 35.6812];

const geo = (spec) => async (stage) => (await import('./geo.js')).mountGeo(stage, spec);
const withSetup = (mod, spec) => geo({ ...spec, setup: async (ctx) => (await mod()).setup(ctx) });

// 気象庁のタイル時刻（UTC）→ 直近フレーム列
const nowcastFrames = async () => {
  const t = await fetch(`${JMA}/jmatile/data/nowc/targetTimes_N1.json`).then((r) => r.json());
  const frames = t
    .slice(0, 12)
    .reverse()
    .map((x) => ({ label: fmtJst14(x.validtime), tiles: `${JMA}/jmatile/data/nowc/${x.basetime}/none/${x.validtime}/surf/hrpns/{z}/{x}/{y}.png` }));
  return { frames, maxzoom: 10 };
};
const himawariFrames = (band) => async () => {
  const t = await fetch(`${JMA}/himawari/data/satimg/targetTimes_jp.json`).then((r) => r.json());
  const frames = t.slice(-18).map((x) => ({
    label: fmtJst14(x.validtime),
    tiles: `${JMA}/himawari/data/satimg/${x.basetime}/jp/${x.validtime}/${band}/{z}/{x}/{y}.jpg`,
  }));
  return { frames, maxzoom: 6 };
};

// 気象庁タイル: validtime が現在以前で最新のエントリを選ぶ
const currentEntry = (list) => {
  const now = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  return [...list].filter((x) => x.validtime <= now).sort((a, b) => (a.validtime < b.validtime ? 1 : -1))[0] ?? list[0];
};
const riskLayer = (el) => async () => {
  const t = await fetch(`${JMA}/jmatile/data/risk/targetTimes.json`).then((r) => r.json());
  const x = currentEntry(t.filter((e) => e.member === 'immed0'));
  return { tiles: `${JMA}/jmatile/data/risk/${x.basetime}/${x.member}/${x.validtime}/surf/${el}/{z}/{x}/{y}.png`, maxzoom: 10 };
};
const snowLayer = async () => {
  const t = await fetch(`${JMA}/jmatile/data/snow/targetTimes.json`).then((r) => r.json());
  const x = currentEntry(t);
  return { tiles: `${JMA}/jmatile/data/snow/${x.basetime}/none/${x.validtime}/surf/snowd/{z}/{x}/{y}.png`, maxzoom: 8 };
};

export const VIZ = {
  1: { badges: ['グラフ'], mount: async (s) => (await import('./views.js')).mountEgov(s) },
  2: { badges: ['グラフ'], mount: async (s) => (await import('./views.js')).mountEgov(s) },
  9: {
    badges: ['2D', '3D'],
    mount: geo({
      center: TOKYO, zoom: 14, base: 'std', pitch3d: 60,
      caption: '国土地理院タイル「標準地図」（基盤地図情報を基に作成された電子国土基本図）。3D地形に切り替えると起伏が確認できます。',
    }),
  },
  10: {
    badges: ['2D', '3D'],
    mount: geo({
      center: [138.7274, 35.3606], zoom: 11, pitch: 65, bearing: 25, terrain: true, base: 'photo', exaggeration: 1.4,
      caption: '地理院タイル — 標準/淡色/写真/色別標高図 と 土地条件図(重ね合わせ)。初期表示は富士山の3D地形。',
      layers: [
        { id: 'hillshade', label: '陰影起伏図', tiles: `${GSI}/hillshademap/{z}/{x}/{y}.png`, minzoom: 2, maxzoom: 16, opacity: 0.55, on: false, attribution: '国土地理院' },
        { id: 'slope', label: '傾斜量図', tiles: `${GSI}/slopemap/{z}/{x}/{y}.png`, minzoom: 3, maxzoom: 15, opacity: 0.6, on: false, attribution: '国土地理院' },
        { id: 'lcm', label: '土地条件図', tiles: `${GSI}/lcm25k_2012/{z}/{x}/{y}.png`, minzoom: 10, maxzoom: 16, opacity: 0.75, on: false, attribution: '国土地理院' },
      ],
    }),
  },
  11: {
    badges: ['2D', '3D'],
    mount: geo({
      center: [139.85, 35.7], zoom: 11, base: 'pale',
      caption: '重ねるハザードマップ（国土地理院 防災地理院タイル）— 洪水浸水想定区域・土砂災害警戒区域・高潮浸水想定区域。避難所の点データはこの経路ではタイル提供がないため未表示。',
      layers: [
        { id: 'flood', label: '洪水浸水想定区域（想定最大規模）', tiles: 'https://disaportal.gsi.go.jp/raster/01_flood_l2_shinsuishin_data/{z}/{x}/{y}.png', minzoom: 2, maxzoom: 17, opacity: 0.7 },
        { id: 'hightide', label: '高潮浸水想定区域', tiles: 'https://disaportal.gsi.go.jp/raster/03_hightide_l2_shinsuishin_data/{z}/{x}/{y}.png', minzoom: 2, maxzoom: 17, opacity: 0.7, on: false },
        { id: 'kyukeisha', label: '急傾斜地崩壊危険区域', tiles: 'https://disaportal.gsi.go.jp/raster/05_kyukeishakeikaikuiki/{z}/{x}/{y}.png', minzoom: 2, maxzoom: 17, opacity: 0.8, on: false },
        { id: 'jisuberi', label: '地すべり警戒区域', tiles: 'https://disaportal.gsi.go.jp/raster/05_jisuberikeikaikuiki/{z}/{x}/{y}.png', minzoom: 2, maxzoom: 17, opacity: 0.8, on: false },
        { id: 'doseki', label: '土砂災害警戒区域（土石流）', tiles: 'https://disaportal.gsi.go.jp/raster/05_dosekiryukeikaikuiki/{z}/{x}/{y}.png', minzoom: 2, maxzoom: 17, opacity: 0.8, on: false },
      ],
    }),
  },
  12: {
    badges: ['3D'],
    mount: withSetup(() => import('./plateau.js'), {
      center: TOKYO, zoom: 15.6, pitch: 62, bearing: -25, base: 'pale', bases: ['pale', 'std', 'photo'],
      caption: '3D都市モデル PLATEAU',
    }),
  },
  18: {
    badges: ['2D', '3D'],
    mount: withSetup(() => import('./amedas.js'), { center: [137.5, 37.2], zoom: 4.8, base: 'pale', bases: ['pale', 'std', 'photo', 'relief'], caption: '気象庁 アメダス' }),
  },
  19: {
    badges: ['2D'],
    mount: geo({
      center: [137, 36], zoom: 4.6, base: 'pale', bases: ['pale', 'std', 'photo'],
      caption: '気象庁 — 高解像度降水ナウキャスト（レーダー）とひまわり画像。▶再生で直近の推移を表示（時刻は JST）。',
      layers: [
        { id: 'himawari', label: 'ひまわり（トゥルーカラー再現）', resolve: himawariFrames('REP/ETC'), opacity: 0.85, on: true, attribution: '気象庁' },
        { id: 'himawari-ir', label: 'ひまわり（赤外）', resolve: himawariFrames('B13/TBB'), opacity: 0.85, on: false, attribution: '気象庁' },
        { id: 'nowcast', label: '降水ナウキャスト', resolve: nowcastFrames, opacity: 0.85, on: true, attribution: '気象庁' },
      ],
    }),
  },
  20: {
    badges: ['2D', '3D'],
    mount: withSetup(() => import('./quake.js'), {
      center: [138, 37], zoom: 4.6, base: 'pale', bases: ['pale', 'std', 'photo', 'relief'], caption: '気象庁 地震情報',
      layers: [
        { id: 'risk-land', label: '土砂災害の危険度分布', resolve: riskLayer('land'), opacity: 0.8, on: false, attribution: '気象庁' },
        { id: 'risk-inund', label: '浸水害の危険度分布', resolve: riskLayer('inund'), opacity: 0.8, on: false, attribution: '気象庁' },
        { id: 'risk-flood', label: '洪水警報の危険度分布', resolve: riskLayer('flood'), opacity: 0.8, on: false, attribution: '気象庁' },
        { id: 'snow', label: '積雪の深さ', resolve: snowLayer, opacity: 0.75, on: false, attribution: '気象庁' },
      ],
    }),
  },
  21: {
    badges: ['3D', '2D'],
    mount: withSetup(() => import('./jshis.js'), { center: [136.5, 36.2], zoom: 5, pitch: 50, bearing: 0, base: 'pale', bases: ['pale', 'std', 'relief'], caption: 'J-SHIS' }),
  },
  33: { badges: ['グラフ', '一覧'], mount: async (s) => (await import('./views.js')).mountLaws(s) },
  35: { badges: ['ギャラリー'], mount: async (s) => (await import('./views.js')).mountGallery(s) },
  73: {
    badges: ['2D', '3D'],
    mount: geo({
      center: [137.5, 36.5], zoom: 6, base: 'pale',
      caption: '20万分の1日本シームレス地質図 V2（産業技術総合研究所）— 日本全国の地質を色分けして重ね合わせ表示。',
      layers: [{ id: 'geology', label: '20万分の1日本シームレス地質図 V2', tiles: 'https://gbank.gsj.jp/seamless/v2/api/1.2/tiles/{z}/{y}/{x}.png', minzoom: 3, maxzoom: 13, opacity: 0.8, attribution: '産総研 地質調査総合センター' }],
    }),
  },
  22: {
    badges: ['3D', '2D'],
    mount: withSetup(() => import('./traffic.js'), { center: [137.5, 37], zoom: 5.1, pitch: 55, base: 'pale', bases: ['pale', 'std', 'relief'], caption: '交通事故統計' }),
  },
  46: {
    badges: ['2D'],
    mount: withSetup(() => import('./toei.js'), { center: [139.76, 35.69], zoom: 10.6, base: 'pale', bases: ['pale', 'std', 'photo'], caption: '東京都交通局' }),
  },
  77: {
    badges: ['2D'],
    mount: withSetup(() => import('./toei.js'), { center: [139.76, 35.69], zoom: 10.6, base: 'pale', bases: ['pale', 'std', 'photo'], caption: 'GTFS-JP（東京都交通局の例）' }),
  },
  78: {
    badges: ['2D'],
    mount: withSetup(() => import('./toei.js'), { center: [139.76, 35.69], zoom: 10.6, base: 'pale', bases: ['pale', 'std', 'photo'], caption: '公共交通オープンデータセンター（東京都交通局の例）' }),
  },
  30: {
    badges: ['3D'],
    mount: withSetup(() => import('./dashboard.js'), { center: [137.5, 37], zoom: 5, pitch: 55, base: 'pale', bases: ['pale', 'std', 'relief'], caption: '統計ダッシュボード' }),
  },
  32: {
    badges: ['3D'],
    mount: withSetup(() => import('./procure.js'), { center: [137.5, 37], zoom: 5, pitch: 55, base: 'pale', bases: ['pale', 'std', 'relief'], caption: '官公需情報ポータル' }),
  },
  38: { badges: ['グラフ'], mount: async (s) => (await import('./views-extra.js')).mountMediaArts(s) },
  91: { badges: ['グラフ'], mount: async (s) => (await import('./views-extra.js')).mountBoj(s) },
  99: {
    badges: ['2D', '3D'],
    mount: geo({
      center: [135.4, 34.9], zoom: 9.5, base: 'pale', bases: ['pale', 'std', 'photo', 'relief'],
      caption: '国土地理院「活断層図」（地理院タイル）— 産総研の活断層データベースそのものではなく、同分野の国土地理院の主題図を表示しています。近畿・中部を初期表示（図のある範囲のみ）。',
      layers: [{ id: 'afm', label: '活断層図', tiles: `${GSI}/afm/{z}/{x}/{y}.png`, minzoom: 8, maxzoom: 16, opacity: 0.9, attribution: '国土地理院' }],
    }),
  },
  82: {
    badges: ['3D'],
    mount: withSetup(() => import('./volcano.js'), {
      center: [138.73, 35.36], zoom: 8.5, pitch: 62, bearing: 15, terrain: true, base: 'photo', exaggeration: 1.6, bases: ['photo', 'std', 'relief'], caption: '気象庁 火山',
    }),
  },
  84: { badges: ['グラフ'], mount: async (s) => (await import('./views.js')).mountCovid(s) },
};

export const BADGE_FILTERS = ['3D', '2D', 'グラフ', 'ギャラリー'];
