import './style.css';
import catalog from '../data/catalog.json';
import laws from '../data/snapshots/laws_stats.json';
import egov from '../data/snapshots/egov_orgs.json';
import boj from '../data/snapshots/boj_usdjpy.json';
import { VIZ, BADGE_FILTERS } from './viz/registry.js';
import { h, nf } from './dom.js';
import { hbar } from './charts.js';

const items = catalog.items;
const byId = new Map(items.map((i) => [i.id, i]));
const categories = [...new Set(items.map((i) => i.category))];
const vizCount = items.filter((i) => VIZ[i.id]).length;

const ICONS = ['🏛️', '📊', '🗺️', '🏙️', '🌋', '🛡️', '🩺', '🏢', '📑', '🎎', '🚇', '🌾', '🛰️', '🏘️', '🏯', '🧩'];
const COLORS = ['#0f766e', '#2563eb', '#7c3aed', '#db2777', '#ea580c', '#dc2626', '#0891b2', '#4f46e5', '#ca8a04', '#9333ea', '#0d9488', '#65a30d', '#0284c7', '#c026d3', '#e11d48', '#475569'];
const catIdx = (c) => categories.indexOf(c);
const catColor = (c) => COLORS[catIdx(c) % COLORS.length];
const catIcon = (c) => ICONS[catIdx(c) % ICONS.length];

const $app = document.getElementById('app');
const $side = document.getElementById('sidebar');
const $main = document.getElementById('content');
const state = { q: '', chip: 'all', current: null, handle: null, token: 0 };

/* ---------- テーマ ---------- */
const THEME_KEY = 'atlas-theme';
const preferred = () => localStorage.getItem(THEME_KEY) ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  localStorage.setItem(THEME_KEY, t);
  const b = document.getElementById('theme-btn');
  if (b) b.textContent = t === 'dark' ? '☀️' : '🌙';
}
applyTheme(preferred());

/* ---------- ユーティリティ ---------- */
const URL_RE = /(https?:\/\/[^\s)、。）」]+)/g;
const linkify = (text) => text.split(URL_RE).map((part, i) => (i % 2 ? h('a', { href: part, target: '_blank', rel: 'noopener' }, part) : part));
const badgeEl = (b) => h('span', { class: `badge b-${b}` }, b);
const pad = (n) => String(n).padStart(2, '0');

/* ---------- 左カラム ---------- */
function buildSidebar() {
  const search = h('div', { class: 'searchbox' }, h('input', {
    type: 'search',
    placeholder: '項目・提供元・キーワードで絞り込み',
    'aria-label': '検索',
    oninput: (e) => {
      state.q = e.target.value.trim();
      renderList();
    },
  }));
  const chips = h(
    'div',
    { class: 'chips' },
    [['all', `すべて ${items.length}`], ['viz', `可視化あり ${vizCount}`], ...BADGE_FILTERS.map((b) => [b, b])].map(([k, label]) =>
      h('button', {
        type: 'button',
        class: `chip${state.chip === k ? ' on' : ''}`,
        'data-chip': k,
        onclick: () => {
          state.chip = k;
          chips.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.dataset.chip === k));
          renderList();
        },
      }, label),
    ),
  );
  $side.replaceChildren(
    h(
      'header',
      { class: 'brand' },
      h(
        'div',
        { class: 'brand-row' },
        h('a', { href: '#/', class: 'logo' }, h('span', { class: 'logo-mark' }, '◎'), h('span', {}, 'Japan Open Data Atlas')),
        h('div', { style: 'display:flex;gap:6px' },
          h('button', { id: 'theme-btn', type: 'button', class: 'icon-btn', title: 'テーマ切替', onclick: () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark') }, document.documentElement.dataset.theme === 'dark' ? '☀️' : '🌙'),
          h('button', { type: 'button', class: 'icon-btn menu-btn', title: '項目一覧', onclick: () => $app.classList.toggle('menu-open') }, '☰'),
        ),
      ),
      h('p', {}, '日本のオープンデータ100選を 2D / 3D で可視化'),
    ),
    h('div', { class: 'side-tools' }, search, chips),
    h('nav', { id: 'list' }),
    h('footer', { class: 'side-foot' }, '出典: ', h('a', { href: catalog.source, target: '_blank', rel: 'noopener' }, 'Qiita「日本のオープンデータ100選」'), ' (Retro-Maid)'),
  );
  renderList();
}

function matches(it) {
  const v = VIZ[it.id];
  if (state.chip === 'viz' && !v) return false;
  if (BADGE_FILTERS.includes(state.chip) && !v?.badges.includes(state.chip)) return false;
  if (!state.q) return true;
  const hay = `${it.id} ${it.name} ${it.org} ${it.category} ${it.summary}`.toLowerCase();
  return state.q.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
}

function renderList() {
  const list = document.getElementById('list');
  const filtering = !!state.q || state.chip !== 'all';
  const frag = document.createDocumentFragment();
  for (const cat of categories) {
    const its = items.filter((i) => i.category === cat && matches(i));
    if (!its.length) continue;
    const nviz = its.filter((i) => VIZ[i.id]).length;
    const hasCurrent = its.some((i) => i.id === state.current);
    frag.append(
      h(
        'details',
        { class: 'cat', style: `--c:${catColor(cat)}`, open: filtering || hasCurrent || cat === categories[0] ? true : undefined },
        h('summary', {}, h('span', { class: 'cat-ico' }, catIcon(cat)), h('span', { class: 't' }, cat), h('em', {}, nviz ? h('b', {}, `${nviz}/`) : null, its.length)),
        its.map((it) => {
          const v = VIZ[it.id];
          return h(
            'a',
            { class: `item${it.id === state.current ? ' active' : ''}${v ? ' has-viz' : ''}`, href: `#/${it.id}`, 'data-id': it.id },
            h('span', { class: 'num' }, it.id),
            h('span', { class: 'name' }, it.name),
            v ? h('span', { class: 'badges' }, v.badges.map(badgeEl)) : null,
          );
        }),
      ),
    );
  }
  if (!frag.childNodes.length) frag.append(h('p', { class: 'empty' }, '該当する項目がありません'));
  list.replaceChildren(frag);
}

function markActive() {
  document.querySelectorAll('#list .item').forEach((a) => a.classList.toggle('active', +a.dataset.id === state.current));
  const act = document.querySelector('#list .item.active');
  if (act) {
    act.closest('details').open = true;
    act.scrollIntoView({ block: 'nearest' });
  }
}

/* ---------- 右カラム ---------- */
function teardown() {
  state.token++;
  try {
    state.handle?.destroy?.();
  } catch (e) {
    console.warn(e);
  }
  state.handle = null;
}

// ホーム: ライブ値カード
function liveCard({ href, color, title, value, sub, live }) {
  const v = h('b', { class: value ? '' : 'skeleton' }, value ?? '0000000');
  const s = h('span', { class: value ? '' : 'skeleton' }, sub ?? '読み込み中…………');
  const el = h('a', { class: 'live', href, style: `--c:${color}` }, h('small', {}, live ? h('i', { class: 'dot' }) : null, title), v, s);
  el.set = (val, subtitle) => {
    v.className = '';
    s.className = '';
    v.textContent = val;
    s.textContent = subtitle;
  };
  return el;
}

function fillLive(cards) {
  const [qk, hot, cold, fx, lw, eg] = cards;
  fx.set(`${boj.values.at(-1).toFixed(2)} 円`, `ドル円 月中平均（${boj.dates.at(-1)}）`);
  lw.set(`${nf.format(laws.total)} 件`, 'e-Gov法令に収録の現行法令');
  eg.set(`${nf.format(egov.total)} 件`, 'e-Govデータポータルのデータセット');

  fetch('https://www.jma.go.jp/bosai/quake/data/list.json')
    .then((r) => r.json())
    .then((list) => {
      const q = list.find((x) => x.cod && !Number.isNaN(parseFloat(x.mag)));
      const t = q.at.slice(5, 16).replace('T', ' ').replace('-', '/');
      qk.set(`M${parseFloat(q.mag).toFixed(1)}`, `${q.anm}（${t} JST${q.maxi ? `・最大震度${q.maxi}` : ''}）`);
    })
    .catch(() => qk.set('—', '取得できませんでした'));

  const A = 'https://www.jma.go.jp/bosai/amedas';
  Promise.all([fetch(`${A}/data/latest_time.txt`).then((r) => r.text()), fetch(`${A}/const/amedastable.json`).then((r) => r.json())])
    .then(async ([t, table]) => {
      const stamp = t.trim().replace(/[-:T]/g, '').slice(0, 14);
      const obs = await fetch(`${A}/data/map/${stamp}.json`).then((r) => r.json());
      const rows = Object.entries(obs)
        .map(([c, o]) => [c, o.temp?.[1] === 0 ? o.temp[0] : null])
        .filter(([c, v]) => v != null && table[c]);
      rows.sort((a, b) => b[1] - a[1]);
      const [hc, hv] = rows[0];
      const [cc, cv] = rows.at(-1);
      const when = `${stamp.slice(8, 10)}:${stamp.slice(10, 12)} 現在`;
      hot.set(`${hv.toFixed(1)} ℃`, `全国最高: ${table[hc].kjName}（${when}）`);
      cold.set(`${cv.toFixed(1)} ℃`, `全国最低: ${table[cc].kjName}（${when}）`);
    })
    .catch(() => {
      hot.set('—', '取得できませんでした');
      cold.set('—', '取得できませんでした');
    });
}

function showHome() {
  teardown();
  state.current = null;
  $app.classList.remove('menu-open');
  const live = [
    liveCard({ href: '#/20', color: '#dc2626', title: '最新の地震', live: true }),
    liveCard({ href: '#/18', color: '#ea580c', title: '全国の最高気温', live: true }),
    liveCard({ href: '#/18', color: '#0284c7', title: '全国の最低気温', live: true }),
    liveCard({ href: '#/91', color: '#7c3aed', title: '為替（日銀）' }),
    liveCard({ href: '#/33', color: '#0f766e', title: '現行法令数' }),
    liveCard({ href: '#/1', color: '#2563eb', title: '公開データセット数' }),
  ];
  fillLive(live);

  const catCards = categories.map((c) => {
    const its = items.filter((i) => i.category === c);
    const nv = its.filter((i) => VIZ[i.id]).length;
    const first = its.find((i) => VIZ[i.id]) ?? its[0];
    return h(
      'a',
      { class: 'cat-card', href: `#/${first.id}`, style: `--c:${catColor(c)}` },
      h('span', { class: 'ico' }, catIcon(c)),
      h('b', {}, c),
      h('small', {}, `${its.length} 項目${nv ? ` ・ 可視化 ${nv}` : ''}`),
      h('span', { class: 'bar' }, h('i', { style: `width:${(nv / its.length) * 100}%` })),
    );
  });
  const vcards = items.filter((i) => VIZ[i.id]).map((i) =>
    h(
      'a',
      { class: 'vcard', href: `#/${i.id}`, style: `--c:${catColor(i.category)}` },
      h('div', { class: 'vcard-top' }, h('span', { class: 'num' }, `#${i.id}`), h('span', { class: 'badges' }, VIZ[i.id].badges.map(badgeEl))),
      h('b', {}, i.name),
      h('small', {}, i.org),
    ),
  );
  const counts = categories
    .map((c) => ({ label: c, value: items.filter((i) => i.category === c).length, viz: items.filter((i) => i.category === c && VIZ[i.id]).length, color: catColor(c) }))
    .sort((a, b) => b.value - a.value);
  const firstViz = items.find((i) => VIZ[i.id]);
  $main.replaceChildren(
    h(
      'div',
      { class: 'home' },
      h(
        'section',
        { class: 'hero' },
        h('h1', {}, '日本のオープンデータを、地図とグラフで眺める'),
        h('p', { class: 'lead' }, `Qiita「日本のオープンデータ100選」の ${items.length} 項目を、リンク先まで辿って整理。API が使えるものは、その場で 2D / 3D のビジュアルにしています。左の一覧から項目を選んでください。`),
        h(
          'div',
          { class: 'stats' },
          h('div', {}, h('b', {}, items.length), h('small', {}, 'カタログ収録項目')),
          h('div', {}, h('b', {}, categories.length), h('small', {}, '分類')),
          h('div', {}, h('b', {}, vizCount), h('small', {}, 'ビジュアル化できた項目')),
          h('div', {}, h('b', {}, items.filter((i) => VIZ[i.id]?.badges.includes('3D')).length), h('small', {}, '3D 表示に対応')),
        ),
        h('div', { class: 'hero-cta' }, h('a', { class: 'btn', href: '#/12' }, '🏙️ PLATEAU 3D 都市モデルを見る'), h('a', { class: 'btn ghost', href: `#/${firstViz.id}` }, 'ビジュアル一覧へ')),
      ),
      h(
        'div',
        { class: 'home-body' },
        h('h3', {}, '📡 いまの日本（ライブ取得）'),
        h('div', { class: 'live-grid' }, live),
        h('h3', {}, '分類から探す'),
        h('div', { class: 'cat-grid' }, catCards),
        h('h3', {}, `可視化できる項目（${vizCount}）`),
        h('div', { class: 'vgrid' }, vcards),
        h('h3', {}, '分類ごとの項目数'),
        hbar(counts.map((c) => ({ label: c.label, value: c.value, color: c.color, sub: c.viz ? `(可視化 ${c.viz})` : '' }))),
        h('p', { class: 'note' }, '※ 可視化は、APIキー不要でブラウザから直接取得できる公開データ（またはリポジトリ内のスナップショット）に限っています。それ以外の項目は、解説とリンク先を表示します。'),
      ),
    ),
  );
  markActive();
  $main.scrollTop = 0;
}

async function showItem(id) {
  const it = byId.get(id);
  if (!it) return showHome();
  teardown();
  const token = state.token;
  state.current = id;
  $app.classList.remove('menu-open');
  markActive();

  const v = VIZ[id];
  const stage = h('div', { class: 'stage' });
  const idx = items.findIndex((i) => i.id === id);
  const prev = items[idx - 1];
  const next = items[idx + 1];
  const fsBtn = h('button', { type: 'button', class: 'btn ghost sq', title: '全画面', onclick: () => (document.fullscreenElement ? document.exitFullscreen() : stage.requestFullscreen?.()) }, '⛶');
  const head = h(
    'div',
    { class: 'head', style: `--c:${catColor(it.category)}` },
    h(
      'div',
      { class: 'head-main' },
      h('div', { class: 'crumb' }, catIcon(it.category), ' ', it.category),
      h('h1', {}, h('span', { class: 'num' }, it.id), it.name),
      h('div', { class: 'meta' }, h('span', {}, `提供元: ${it.org}`), v ? v.badges.map(badgeEl) : h('span', { class: 'badge b-info' }, '解説のみ')),
    ),
    h('div', { class: 'actions' }, v ? fsBtn : null, it.url ? h('a', { class: 'btn', href: it.url, target: '_blank', rel: 'noopener' }, '公式サイト ↗') : null),
  );
  const pager = h(
    'div',
    { class: 'pager' },
    prev ? h('a', { href: `#/${prev.id}` }, `← ${prev.id}. ${prev.name}`) : h('span'),
    next ? h('a', { href: `#/${next.id}` }, `${next.id}. ${next.name} →`) : h('span'),
  );

  if (v) {
    const detail = buildDetail(it, true);
    head.querySelector('.actions').prepend(h('button', { type: 'button', class: 'btn ghost', onclick: () => detail.classList.toggle('open') }, '解説 ▾'));
    $main.replaceChildren(head, stage, detail, pager);
    stage.append(h('div', { class: 'loading' }, 'データを読み込み中…'));
    try {
      const handle = await v.mount(stage, { item: it });
      if (token !== state.token) return handle?.destroy?.();
      state.handle = handle;
    } catch (err) {
      console.error(err);
      stage.replaceChildren(h('div', { class: 'error' }, `ビジュアルを表示できませんでした: ${err.message}`));
    }
  } else {
    stage.classList.add('info');
    stage.append(
      h(
        'div',
        { class: 'info-note' },
        h('b', {}, 'この項目は解説とリンク先の表示です'),
        h('span', {}, 'APIキー登録・ZIP/CSV一括配布・ブラウザからの直接取得不可などの理由で、このサイトでは自動描画していません。公式サイトからデータを取得してください。'),
      ),
      buildDetail(it, false),
    );
    $main.replaceChildren(head, stage, pager);
  }
  $main.scrollTop = 0;
}

function buildDetail(it, collapsible) {
  const sections = [];
  if (it.summary) sections.push(h('section', {}, h('h3', {}, '概要（冒頭の抜粋）'), h('p', {}, linkify(it.summary))));
  if (it.license_urls?.length) {
    sections.push(
      h('section', {}, h('h3', {}, '利用規約・ライセンス'), h('p', {}, it.license_urls.map((u) => h('a', { href: u, target: '_blank', rel: 'noopener', style: 'display:block' }, u)))),
    );
  }
  sections.push(
    h(
      'section',
      {},
      h('h3', {}, '詳しい解説'),
      h('p', {}, '使い方・データ構成・ライセンスの詳細は、元記事「日本のオープンデータ100選」の ', h('b', {}, `${it.id}. ${it.name}`), ' の項をご覧ください。', h('br'), h('a', { href: catalog.source, target: '_blank', rel: 'noopener' }, '元記事（Qiita）を開く ↗')),
    ),
  );
  return h('div', { class: `detail${collapsible ? '' : ' open static'}` }, h('div', { class: 'detail-body' }, sections));
}

/* ---------- ルーティング ---------- */
function route() {
  const m = /^#\/(\d+)(?:\?.*)?$/.exec(location.hash);
  if (m) showItem(+m[1]);
  else showHome();
}
window.addEventListener('hashchange', route);
buildSidebar();
route();
