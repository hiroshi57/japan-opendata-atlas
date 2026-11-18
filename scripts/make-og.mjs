// OGP 画像 (1200x630) を生成して public/og-image.png に保存する。
// 右半分は実際のサイト画面（PLATEAU 3D）のスクリーンショット、左半分は件数入りのタイトル。
// 使い方: npm run build && npx vite preview --port 4173 &  →  node scripts/make-og.mjs
//   環境変数: SITE（既定 http://localhost:4173/）, CHROME_PATH
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
import catalog from '../data/catalog.json' with { type: 'json' };
import { VIZ } from '../src/viz/registry.js';

const SITE = process.env.SITE ?? 'http://localhost:4173/';
const chrome = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && existsSync(p));
if (!chrome) throw new Error('Chrome が見つかりません（CHROME_PATH を指定してください）');

const total = catalog.items.length;
const viz = Object.keys(VIZ).length;
const d3 = Object.values(VIZ).filter((v) => v.badges.includes('3D')).length;

const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'], defaultViewport: { width: 1500, height: 900 } });
const page = await browser.newPage();
await page.goto(`${SITE}#/12?v=139.7660,35.6835,16.1,62,-32`, { waitUntil: 'networkidle2', timeout: 90000 });
await page.addStyleTag({ content: '.panel,.place,.caption,.cards,.maplibregl-ctrl,.toast{display:none!important}' });
await new Promise((r) => setTimeout(r, 14000)); // 3D タイルの読み込みを待つ
const box = await (await page.$('.stage')).boundingBox();
const shot = await page.screenshot({ encoding: 'base64', clip: { x: box.x + (box.width - 640) / 2, y: box.y + (box.height - 630) / 2, width: 640, height: 630 } });

const html = `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}
body{width:1200px;height:630px;background:#f1ece1;color:#18262a;font-family:'Yu Gothic UI','Meiryo','Hiragino Sans',sans-serif;display:flex;overflow:hidden}
.l{width:560px;padding:56px 48px 44px 60px;display:flex;flex-direction:column}
.k{font-size:22px;font-weight:700;letter-spacing:.08em;color:#0f766e}
h1{margin-top:24px;font-size:58px;line-height:1.2;white-space:nowrap;font-weight:800;letter-spacing:-.02em}
p{margin-top:20px;margin-bottom:18px;font-size:23px;line-height:1.55;color:#44545a}
.n{margin-top:auto;display:flex;border-top:3px solid #18262a}
.n div{flex:1;padding-top:14px}
.n div+div{padding-left:22px;border-left:1px solid #b9b3a4}
.n b{display:block;font-size:56px;line-height:1;font-variant-numeric:tabular-nums}
.n span{display:block;margin-top:6px;font-size:18px;color:#44545a}
.u{margin-top:22px;font-size:19px;color:#6a7a7f}
.r{position:relative;width:640px;height:630px;border-left:8px solid #0f766e}
.r img{display:block;width:632px;height:630px;object-fit:cover}
</style>
<div class="l"><div class="k">JAPAN OPEN DATA ATLAS</div>
<h1>日本のオープン<br>データを、地図と<br>グラフで。</h1>
<p>「オープンデータ100選」を、<br>その場で取得した2D・3Dのビジュアルに。</p>
<div class="n"><div><b>${total}</b><span>カタログ項目</span></div><div><b>${viz}</b><span>ビジュアル化</span></div><div><b>${d3}</b><span>3D表示</span></div></div>
<div class="u">hiroshi57.github.io/japan-opendata-atlas</div></div>
<div class="r"><img src="data:image/png;base64,${shot}"></div>`;

const out = await browser.newPage();
await out.setViewport({ width: 1200, height: 630 });
await out.setContent(html, { waitUntil: 'load' });
await writeFile('public/og-image.png', await out.screenshot({ type: 'png' }));
await browser.close();
console.log(`public/og-image.png を生成（項目 ${total} / 可視化 ${viz} / 3D ${d3}）`);
