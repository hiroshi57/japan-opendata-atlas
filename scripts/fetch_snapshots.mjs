// ブラウザから直接取得できない（CORS 非対応 / 巨大）データを取得し、集計して data/snapshots/ に保存する。
// 使い方: node scripts/fetch_snapshots.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'snapshots');
await mkdir(OUT, { recursive: true });
const fetched = new Date().toISOString();
const save = (name, obj) => writeFile(path.join(OUT, name), JSON.stringify(obj), 'utf-8');

// 1) e-Gov データポータル (CKAN): 提供組織ごとのデータセット件数  [項目 1, 2]
{
  const url = 'https://data.e-gov.go.jp/data/api/action/package_search?rows=0&facet.field=%5B%22organization%22%5D&facet.limit=100';
  const j = await (await fetch(url)).json();
  const items = j.result.search_facets.organization.items
    .map((o) => ({ name: o.display_name, count: o.count }))
    .sort((a, b) => b.count - a.count);
  await save('egov_orgs.json', { source: url, fetched, total: j.result.count, items });
  console.log('egov_orgs', j.result.count, items.length);
}

// 2) 新型コロナ 新規陽性者数（日別 → 週別集計）  [項目 84]
{
  const url = 'https://covid19.mhlw.go.jp/public/opendata/newly_confirmed_cases_daily.csv';
  const text = (await (await fetch(url)).text()).replace(/^﻿/, '');
  const [head, ...rows] = text.trim().split(/\r?\n/);
  const cols = head.split(',');
  const weekKey = (d) => {
    const [y, m, dd] = d.split('/').map(Number);
    const t = new Date(Date.UTC(y, m - 1, dd));
    t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); // 月曜始まり
    return t.toISOString().slice(0, 10);
  };
  const weeks = new Map();
  for (const r of rows) {
    const c = r.split(',');
    const k = weekKey(c[0]);
    const acc = weeks.get(k) ?? new Array(cols.length - 1).fill(0);
    for (let i = 1; i < cols.length; i++) acc[i - 1] += Number(c[i]) || 0;
    weeks.set(k, acc);
  }
  const keys = [...weeks.keys()].sort();
  const series = {};
  cols.slice(1).forEach((name, i) => (series[name] = keys.map((k) => weeks.get(k)[i])));
  await save('covid_weekly.json', { source: url, fetched, weeks: keys, regions: cols.slice(1), series });
  console.log('covid_weekly', keys.length, 'weeks');
}

// 3) e-Gov 法令: 法令種別 × 公布年代の件数（現行法令 全件走査）  [項目 33]
{
  const base = 'https://laws.e-gov.go.jp/api/2/laws?limit=1000&offset=';
  const byType = {};
  const byDecade = {};
  let offset = 0;
  let total = 0;
  for (;;) {
    const j = await (await fetch(base + offset)).json();
    total = j.total_count;
    for (const l of j.laws) {
      const t = l.revision_info?.category ?? l.law_info.law_type;
      byType[t] = (byType[t] ?? 0) + 1;
      const y = Number((l.law_info.promulgation_date ?? '').slice(0, 4));
      if (y) {
        const d = Math.floor(y / 10) * 10;
        byDecade[d] = (byDecade[d] ?? 0) + 1;
      }
    }
    if (j.next_offset == null || j.next_offset >= total) break;
    offset = j.next_offset;
    console.log('laws offset', offset, '/', total);
  }
  await save('laws_stats.json', { source: base, fetched, total, byType, byDecade });
  console.log('laws_stats', total);
}

// 4) 日本銀行 時系列統計データ: ドル円 スポット 17時時点 月中平均  [項目 91]
{
  const base = 'https://www.stat-search.boj.or.jp/api/v1/getDataCode?format=json&lang=jp&db=FM08&code=FXERM07&startDate=197301';
  const dates = [];
  const values = [];
  let name = '';
  let unit = '';
  let pos = '';
  for (let i = 0; i < 20; i++) {
    const j = await (await fetch(base + (pos ? `&startPosition=${pos}` : ''))).json();
    const rs = j.RESULTSET?.[0];
    if (!rs) break;
    name = rs.NAME_OF_TIME_SERIES_J;
    unit = rs.UNIT_J;
    rs.VALUES.SURVEY_DATES.forEach((d, k) => {
      const v = rs.VALUES.VALUES[k];
      if (v != null) {
        dates.push(`${String(d).slice(0, 4)}-${String(d).slice(4, 6)}`);
        values.push(v);
      }
    });
    if (!j.NEXTPOSITION) break;
    pos = j.NEXTPOSITION;
  }
  await save('boj_usdjpy.json', { source: base, fetched, name, unit, dates, values });
  console.log('boj_usdjpy', dates.length, dates[0], dates.at(-1));
}

// 5) 官公需情報ポータル: 都道府県別 公示件数（キーワード別）  [項目 32]
{
  const keywords = ['工事', '委託', '物品'];
  const hits = {};
  for (const kw of keywords) {
    hits[kw] = [];
    for (let p = 1; p <= 47; p++) {
      const url = `https://www.kkj.go.jp/api/?Query=${encodeURIComponent(kw)}&Count=1&LG_Code=${String(p).padStart(2, '0')}`;
      let n = 0;
      for (let t = 0; t < 3 && !n; t++) {
        const xml = await (await fetch(url)).text();
        n = Number(/<SearchHits>(\d+)<\/SearchHits>/.exec(xml)?.[1] ?? 0);
        if (!n) await new Promise((r) => setTimeout(r, 500));
      }
      hits[kw].push(n);
      await new Promise((r) => setTimeout(r, 120));
    }
    console.log('kkj', kw, hits[kw].reduce((a, b) => a + b, 0));
  }
  await save('kkj_hits.json', { source: 'https://www.kkj.go.jp/api/', fetched, keywords, hits });
}
