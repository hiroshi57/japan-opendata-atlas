// 地図以外のビジュアル: グラフ（スナップショット集約データ）とライブ検索ギャラリー
import { h, esc, nf } from '../dom.js';
import { hbar, vbar, line } from '../charts.js';
import { PREF_NAMES as PREFS } from './prefs.js';
import egov from '../../data/snapshots/egov_orgs.json';
import covid from '../../data/snapshots/covid_weekly.json';
import laws from '../../data/snapshots/laws_stats.json';

const page = (title, sub, ...kids) => h('div', { class: 'view' }, h('h2', {}, title), h('p', { class: 'view-sub' }, sub), ...kids);
const foot = (src, fetched) =>
  h('div', { class: 'caption static' }, `出典: ${src}${fetched ? `（取得 ${fetched.slice(0, 10)}・リポジトリ内スナップショット）` : ''}`);

/* ---------- e-Gov データポータル: 提供組織別データセット数 ---------- */
export function mountEgov(stage) {
  stage.replaceChildren(
    page(
      'e-Govデータポータル — 提供組織別のデータセット数',
      `全 ${nf.format(egov.total)} 件のデータセットを、提供組織ごとに集計（CKAN API の facet）。`,
      hbar(egov.items.map((i) => ({ label: i.name, value: i.count })), { color: '#2563eb' }),
      foot('e-Govデータポータル メタデータ取得API (data.e-gov.go.jp)', egov.fetched),
    ),
  );
  return { destroy() {} };
}

/* ---------- 新型コロナ 新規陽性者数（週別） ---------- */

export function mountCovid(stage) {
  const names = ['全国', ...PREFS];
  const keys = ['ALL', ...covid.regions.filter((r) => r !== 'ALL')];
  const optsOf = (withNone) => [
    withNone ? h('option', { value: '' }, '比較なし') : null,
    ...names.map((n, i) => h('option', { value: keys[i], selected: !withNone && i === 0 ? true : undefined }, n)),
  ];
  const a = h('select', {}, optsOf(false));
  const b = h('select', {}, optsOf(true));
  const out = h('div');
  const stats = h('div', { class: 'stats' });
  const render = () => {
    const ser = [{ key: a.value, color: '#dc2626' }];
    if (b.value) ser.push({ key: b.value, color: '#2563eb' });
    const nm = (k) => names[keys.indexOf(k)];
    const series = ser.map((s) => ({ name: nm(s.key), values: covid.series[s.key], color: s.color }));
    out.replaceChildren(line(covid.weeks, series, { unit: ' 人' }));
    const v = series[0].values;
    const peak = Math.max(...v);
    stats.replaceChildren(
      h('div', {}, h('b', {}, nf.format(v.reduce((x, y) => x + y, 0))), h('small', {}, `${series[0].name} 累計(週次合算)`)),
      h('div', {}, h('b', {}, nf.format(peak)), h('small', {}, `週間ピーク（${covid.weeks[v.indexOf(peak)]} の週）`)),
      h('div', {}, h('b', {}, covid.weeks.length), h('small', {}, '集計週数')),
    );
  };
  a.onchange = b.onchange = render;
  render();
  stage.replaceChildren(
    page(
      '新型コロナウイルス感染症 — 新規陽性者数（週別）',
      '厚生労働省オープンデータ（日別・都道府県別）を週(月曜始まり)で集計。ホバーで値を表示。',
      h('div', { class: 'toolbar' }, h('label', {}, '地域 ', a), h('label', {}, '比較 ', b)),
      stats,
      out,
      foot('厚生労働省 新型コロナウイルス感染症オープンデータ', covid.fetched),
    ),
  );
  return { destroy() {} };
}

/* ---------- e-Gov 法令: 統計 + ライブ検索 ---------- */
export function mountLaws(stage) {
  const decades = Object.entries(laws.byDecade)
    .map(([d, n]) => ({ label: `${d}s`, value: n }))
    .sort((x, y) => parseInt(x.label) - parseInt(y.label));
  const types = Object.entries(laws.byType)
    .map(([label, value]) => ({ label, value }))
    .sort((x, y) => y.value - x.value);
  const results = h('ul', { class: 'law-list' });
  const input = h('input', { type: 'search', placeholder: '法令名で検索（例: 個人情報、道路、憲法）', value: '' });
  const note = h('small', {});
  const search = async () => {
    const q = input.value.trim();
    if (!q) return results.replaceChildren();
    note.textContent = '検索中…';
    try {
      const j = await fetch(`https://laws.e-gov.go.jp/api/2/laws?law_title=${encodeURIComponent(q)}&limit=20`).then((r) => r.json());
      note.textContent = `${nf.format(j.total_count)} 件ヒット（上位 ${j.count} 件を表示 / e-Gov法令API）`;
      results.replaceChildren(
        ...j.laws.map((l) =>
          h(
            'li',
            {},
            h('a', { href: `https://laws.e-gov.go.jp/law/${l.law_info.law_id}`, target: '_blank', rel: 'noopener' }, l.revision_info.law_title),
            h('small', {}, ` ${l.revision_info.category ?? ''}・公布 ${l.law_info.promulgation_date ?? ''}`),
          ),
        ),
      );
    } catch (e) {
      note.textContent = `検索に失敗しました: ${e.message}`;
    }
  };
  input.addEventListener('keydown', (e) => e.key === 'Enter' && search());
  stage.replaceChildren(
    page(
      `e-Gov法令 — 現行法令 ${nf.format(laws.total)} 件の内訳`,
      '公布年代ごとの件数と、法令の種別。下の検索欄からは e-Gov法令API をブラウザから直接呼び出します。',
      h('h3', {}, '公布年代別'),
      vbar(decades),
      h('h3', {}, '種別'),
      hbar(types, { color: '#0f766e' }),
      h('h3', {}, '法令名で検索（ライブ）'),
      h('div', { class: 'toolbar' }, input, h('button', { type: 'button', class: 'mini', onclick: search }, '検索')),
      note,
      results,
      foot('e-Gov法令API v2 (laws.e-gov.go.jp)', laws.fetched),
    ),
  );
  return { destroy() {} };
}

/* ---------- ジャパンサーチ: 文化財・作品ギャラリー ---------- */
export function mountGallery(stage) {
  const KEYWORDS = ['浮世絵', '富士山', '土器', '着物', '古地図', '仏像', '城'];
  const grid = h('div', { class: 'gallery' });
  const input = h('input', { type: 'search', value: '浮世絵', placeholder: 'キーワード' });
  const note = h('small', {});
  const search = async (kw) => {
    const q = (kw ?? input.value).trim();
    if (!q) return;
    input.value = q;
    note.textContent = '検索中…';
    grid.replaceChildren();
    try {
      const j = await fetch(`https://jpsearch.go.jp/api/item/search/jps-cross?keyword=${encodeURIComponent(q)}&size=36&from=0`).then((r) => r.json());
      const items = (j.list ?? []).filter((x) => x.common?.thumbnailUrl?.[0]);
      note.textContent = `「${q}」: ${nf.format(j.hit ?? 0)} 件（サムネイルのある ${items.length} 件を表示）`;
      grid.replaceChildren(
        ...items.map((x) => {
          const c = x.common;
          return h(
            'a',
            { class: 'tile', href: c.linkUrl ?? '#', target: '_blank', rel: 'noopener', title: c.title },
            h('img', { src: c.thumbnailUrl[0], alt: c.title, loading: 'lazy', onerror: (e) => e.target.closest('.tile')?.remove() }),
            h('span', {}, c.title),
          );
        }),
      );
    } catch (e) {
      note.textContent = `取得に失敗しました: ${e.message}`;
    }
  };
  input.addEventListener('keydown', (e) => e.key === 'Enter' && search());
  stage.replaceChildren(
    page(
      'ジャパンサーチ — 横断検索ギャラリー',
      '全国の文化機関が持つ作品・資料を、ジャパンサーチ API から検索してサムネイルで一覧します。',
      h(
        'div',
        { class: 'toolbar' },
        input,
        h('button', { type: 'button', class: 'mini', onclick: () => search() }, '検索'),
        ...KEYWORDS.map((k) => h('button', { type: 'button', class: 'chip', onclick: () => search(k) }, k)),
      ),
      note,
      grid,
      h('div', { class: 'caption static' }, '出典: ジャパンサーチ (jpsearch.go.jp) — 各画像の権利は提供機関に帰属します。クリックで提供元ページへ。'),
    ),
  );
  search('浮世絵');
  return { destroy() {} };
}
