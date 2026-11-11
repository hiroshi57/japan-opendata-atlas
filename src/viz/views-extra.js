// 追加のグラフビュー: 日本銀行 ドル円 / メディア芸術データベース（SPARQL ライブ）
import { h } from '../dom.js';
import { hbar, line } from '../charts.js';
import boj from '../../data/snapshots/boj_usdjpy.json';

const page = (title, sub, ...kids) => h('div', { class: 'view' }, h('h2', {}, title), h('p', { class: 'view-sub' }, sub), ...kids);
const foot = (src, fetched) =>
  h('div', { class: 'caption static' }, `出典: ${src}${fetched ? `（取得 ${fetched.slice(0, 10)}・リポジトリ内スナップショット）` : ''}`);

/* ---------- 日本銀行: ドル円 月中平均 ---------- */
export function mountBoj(stage) {
  const last = boj.values.at(-1);
  const max = Math.max(...boj.values);
  const min = Math.min(...boj.values);
  stage.replaceChildren(
    page(
      '日本銀行 時系列統計 — ドル円相場（月中平均）',
      `${boj.name}（単位: ${boj.unit}）。${boj.dates[0]} 〜 ${boj.dates.at(-1)}。ホバーで値を表示。`,
      h(
        'div',
        { class: 'stats' },
        h('div', {}, h('b', {}, last.toFixed(2)), h('small', {}, `直近 (${boj.dates.at(-1)})`)),
        h('div', {}, h('b', {}, max.toFixed(1)), h('small', {}, `期間最高 (${boj.dates[boj.values.indexOf(max)]})`)),
        h('div', {}, h('b', {}, min.toFixed(1)), h('small', {}, `期間最安 (${boj.dates[boj.values.indexOf(min)]})`)),
      ),
      line(boj.dates.map((d) => `${d}-01`), [{ name: 'ドル円', values: boj.values, color: '#7c3aed' }], { unit: ' 円', xName: '年月' }),
      foot('日本銀行 時系列統計データ検索サイト API', boj.fetched),
    ),
  );
  return { destroy() {} };
}

/* ---------- メディア芸術データベース: 収録データの種別内訳 ---------- */
const MADB_LABEL = {
  Supplement: '付録・附属物',
  MangaBook: 'マンガ単行本',
  AnimationTVProgram: 'アニメTV番組',
  MangaMagazineIssue: 'マンガ雑誌 号',
  MangaBookSeries: 'マンガ単行本シリーズ',
  Agent: '人物・団体',
  AnimationVideoPackage: 'アニメ映像パッケージ',
  AnimationVideoPackageSeries: 'アニメ映像パッケージ シリーズ',
  GamePackage: 'ゲームパッケージ',
  MangaMagazinePublication: 'マンガ雑誌 掲載作品',
  MediaArtExhibitionOrPerformance: 'メディアアート 展示・上演',
  GameRelatedItem: 'ゲーム関連資料',
  MediaArtEvent: 'メディアアート イベント',
  AnimationRelatedItem: 'アニメ関連資料',
  MangaOther: 'マンガ その他',
  GameWork: 'ゲーム作品',
};

export function mountMediaArts(stage) {
  const body = h('div', {}, h('p', { class: 'view-sub' }, 'SPARQL エンドポイントに問い合わせ中…'));
  const q = 'SELECT ?type (COUNT(*) AS ?n) WHERE {?s a ?type} GROUP BY ?type ORDER BY DESC(?n) LIMIT 16';
  fetch(`https://mediaarts-db.artmuseums.go.jp/sparql?output=json&query=${encodeURIComponent(q)}`)
    .then((r) => r.json())
    .then((j) => {
      const rows = j.results.bindings.map((b) => {
        const key = b.type.value.split('#').pop().split('/').pop();
        return { label: MADB_LABEL[key] ?? key, value: Number(b.n.value), sub: key };
      });
      body.replaceChildren(
        h('p', { class: 'view-sub' }, `上位 ${rows.length} 種別（レコード数）。マンガ・アニメ・ゲーム・メディアアートの4分野を横断するデータです。`),
        hbar(rows, { color: '#db2777' }),
      );
    })
    .catch((e) => body.replaceChildren(h('div', { class: 'error-inline' }, `取得に失敗しました: ${e.message}`)));
  stage.replaceChildren(
    page(
      'メディア芸術データベース — 収録データの種別内訳',
      'マンガ・アニメ・ゲーム・メディアアートの所蔵・書誌データを、SPARQL でその場で集計しています。',
      body,
      h('div', { class: 'caption static' }, '出典: 文化庁 メディア芸術データベース (mediaarts-db.artmuseums.go.jp) SPARQL endpoint — ライブ取得'),
    ),
  );
  return { destroy() {} };
}
