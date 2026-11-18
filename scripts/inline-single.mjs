// dist-single/ の JS・CSS を index.html に埋め込み、1 ファイルの HTML にして dist/ へ出力する。
// 出力: dist/japan-opendata-atlas.html（file:// でダブルクリックしても動く）
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const dir = 'dist-single';
let html = await readFile(path.join(dir, 'index.html'), 'utf-8');
const read = (rel) => readFile(path.join(dir, rel.replace(/^\.\//, '')), 'utf-8');

// <link rel="stylesheet" href="./assets/x.css"> → <style>
for (const m of [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)]) {
  const css = await read(m[1]);
  html = html.replace(m[0], () => `<style>${css}</style>`);
}

// <script type="module" src="./assets/x.js"> → インライン（`</script` は HTML を壊すのでエスケープ）
for (const m of [...html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g)]) {
  const js = (await read(m[1])).replace(/<\/script/gi, '<\\/script');
  html = html.replace(m[0], '');
  html = html.replace('</body>', () => `<script type="module">${js}</script>\n</body>`);
}

// favicon を data URI に（ファイル単体で表示できるように）
try {
  const svg = await readFile('public/favicon.svg', 'utf-8');
  html = html.replace(/<link rel="icon"[^>]*>/, `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" />`);
} catch {
  /* ファビコン無しでも動作に影響しない */
}

await mkdir('dist', { recursive: true });
const out = 'dist/japan-opendata-atlas.html';
await writeFile(out, html, 'utf-8');
const left = html.match(/(?:src|href)="\.\/assets\/[^"]+"/g);
console.log(`${out}  ${(Buffer.byteLength(html) / 1048576).toFixed(2)} MB  外部参照の残り: ${left ? left.join(', ') : 'なし'}`);
