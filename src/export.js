// 表示中データの CSV / JSON 書き出し。
// 各ビジュアルの handle が exportData() => { name, source, rows:[{列名: 値}] } を返せば、右上にボタンが出る。
import { h } from './dom.js';

export function toCsv(rows) {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // 先頭に BOM を付け、Excel でも文字化けしないようにする
  return `﻿${[cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n')}`;
}

export function download(filename, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

const safe = (s) => String(s).replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60);

export function buildFiles(item, data) {
  const base = `atlas-${item.id}_${safe(data.name)}`;
  const json = {
    item: { id: item.id, name: item.name, url: item.url },
    dataset: data.name,
    source: data.source,
    exported_at: new Date().toISOString(),
    count: data.rows.length,
    rows: data.rows,
  };
  return {
    csv: { name: `${base}.csv`, text: toCsv(data.rows), mime: 'text/csv;charset=utf-8' },
    json: { name: `${base}.json`, text: JSON.stringify(json, null, 2), mime: 'application/json' },
  };
}

/** handle が書き出しに対応していれば、actions 内の「公式サイト」ボタンの手前に書き出しメニューを挿入する */
export function attachExport(handle, item, actions) {
  if (!handle?.exportData || handle.canExport?.() === false) return;
  const menu = h('div', { class: 'menu', hidden: true });
  const note = h('small', { class: 'warn' });
  const toggle = h('button', { type: 'button', class: 'btn ghost', 'aria-haspopup': 'true', onclick: () => { note.textContent = ''; menu.hidden = !menu.hidden; } }, 'データ書き出し ▾');
  const run = (fmt) => {
    const data = handle.exportData();
    if (!data?.rows?.length) {
      note.textContent = 'データの読み込み後にもう一度お試しください';
      return;
    }
    menu.hidden = true;
    const f = buildFiles(item, data)[fmt];
    download(f.name, f.text, f.mime);
  };
  menu.append(
    h('button', { type: 'button', onclick: () => run('csv') }, 'CSV（Excel 対応）'),
    h('button', { type: 'button', onclick: () => run('json') }, 'JSON'),
    note,
    h('small', {}, '利用条件は各データの提供元の規約に従ってください'),
  );
  const wrap = h('div', { class: 'dl' }, toggle, menu);
  document.addEventListener('click', (e) => !wrap.contains(e.target) && (menu.hidden = true));
  actions.insertBefore(wrap, actions.querySelector('a.btn'));
}
