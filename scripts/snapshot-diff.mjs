// スナップショット再取得後に実行する。`fetched`（取得時刻）以外が HEAD と同一のファイルは元に戻し、
// 実質的な変化があるファイルだけを残す（毎週ノイズだけのコミットが出るのを防ぐ）。
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

const dir = 'data/snapshots';
const strip = (o) => JSON.stringify(o, (k, v) => (k === 'fetched' ? undefined : v));
const changed = [];
for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
  const path = `${dir}/${f}`;
  let head = null;
  try {
    head = execFileSync('git', ['show', `HEAD:${path}`], { maxBuffer: 1 << 28 }).toString('utf-8');
  } catch {
    /* 新規ファイル */
  }
  const now = readFileSync(path, 'utf-8');
  if (head && strip(JSON.parse(head)) === strip(JSON.parse(now))) {
    execFileSync('git', ['checkout', '--', path]);
  } else {
    changed.push(f);
  }
}
console.log(changed.length ? `実質変化あり: ${changed.join(', ')}` : '実質変化なし');
