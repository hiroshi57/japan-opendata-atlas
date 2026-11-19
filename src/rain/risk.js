// 経路のリスク評価: 浸水想定区域（国土地理院 重ねるハザードマップ 洪水・想定最大規模）× 警察庁の事故データ
import { dist } from './track.js';

/* ---------- 事故データ（public/accidents.bin: 全事故の位置 + フラグ） ---------- */
const ACC_URL = location.protocol.startsWith('http')
  ? new URL('./accidents.bin', document.baseURI).href
  : 'https://hiroshi57.github.io/japan-opendata-atlas/accidents.bin'; // 単一 HTML 版（file://）用

let accPromise = null;
export function loadAccidents() {
  accPromise ??= fetch(ACC_URL)
    .then((r) => {
      if (!r.ok) throw new Error(`事故データを取得できません (${r.status})`);
      return r.arrayBuffer();
    })
    .then((buf) => {
      const dv = new DataView(buf);
      const n = dv.getUint32(4, true);
      return { n, year: dv.getUint32(8, true), lon: new Int32Array(buf, 16, n), lat: new Int32Array(buf, 16 + 4 * n, n), flag: new Uint8Array(buf, 16 + 8 * n, n) };
    });
  return accPromise;
}

const M_LAT = 110574;
const mPerLng = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);

/** 経路の各サンプル点（約10m間隔）に、近く(既定30m以内)の事故を最近傍の点へ割り当てる */
export async function accidentsAlong(route, radius = 30) {
  const A = await loadAccidents();
  const S = route.samples;
  const pad = 0.0008;
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const s of S) {
    minLng = Math.min(minLng, s.lng); maxLng = Math.max(maxLng, s.lng);
    minLat = Math.min(minLat, s.lat); maxLat = Math.max(maxLat, s.lat);
  }
  const CELL = 0.0005;
  const key = (lng, lat) => Math.floor(lat / CELL) * 400000 + Math.floor(lng / CELL);
  const grid = new Map();
  S.forEach((s, i) => {
    const k = key(s.lng, s.lat);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  });
  const all = new Array(S.length).fill(0);
  const rain = new Array(S.length).fill(0);
  const fatal = new Array(S.length).fill(0);
  const points = [];
  const x0 = (minLng - pad) * 1e5, x1 = (maxLng + pad) * 1e5, y0 = (minLat - pad) * 1e5, y1 = (maxLat + pad) * 1e5;
  for (let j = 0; j < A.n; j++) {
    const xl = A.lon[j], yl = A.lat[j];
    if (xl < x0 || xl > x1 || yl < y0 || yl > y1) continue;
    const lng = xl / 1e5, lat = yl / 1e5;
    const cx = Math.floor(lng / CELL), cy = Math.floor(lat / CELL);
    let best = -1, bd = radius;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cell = grid.get((cy + dy) * 400000 + cx + dx);
        if (!cell) continue;
        for (const i of cell) {
          const dm = Math.hypot((S[i].lng - lng) * mPerLng(lat), (S[i].lat - lat) * M_LAT);
          if (dm <= bd) { bd = dm; best = i; }
        }
      }
    }
    if (best < 0) continue;
    const f = A.flag[j];
    all[best]++;
    if (f & 2) rain[best]++;
    if (f & 1) fatal[best]++;
    points.push({ lng, lat, rain: !!(f & 2), fatal: !!(f & 1), i: best });
  }
  return { all, rain, fatal, points, year: A.year };
}

/** 任意の点の周囲(半径 m 以内)の事故件数 */
export async function accidentsAround(lng, lat, radii = [50, 100, 300]) {
  const A = await loadAccidents();
  const R = Math.max(...radii);
  const dLng = R / mPerLng(lat) * 1e5, dLat = (R / M_LAT) * 1e5;
  const out = radii.map(() => ({ all: 0, rain: 0, fatal: 0 }));
  for (let j = 0; j < A.n; j++) {
    if (Math.abs(A.lon[j] - lng * 1e5) > dLng || Math.abs(A.lat[j] - lat * 1e5) > dLat) continue;
    const dm = Math.hypot((A.lon[j] / 1e5 - lng) * mPerLng(lat), (A.lat[j] / 1e5 - lat) * M_LAT);
    radii.forEach((r, k) => {
      if (dm > r) return;
      out[k].all++;
      if (A.flag[j] & 2) out[k].rain++;
      if (A.flag[j] & 1) out[k].fatal++;
    });
  }
  return radii.map((r, k) => ({ radius: r, ...out[k] }));
}

/* ---------- 浸水想定区域（洪水・想定最大規模のラスタータイルを画素で判定） ---------- */
export const FLOOD_LEGEND = [
  { cls: 1, rgb: [247, 245, 169], label: '0.5m未満', w: 0.5 },
  { cls: 2, rgb: [255, 216, 192], label: '0.5〜3m', w: 1 },
  { cls: 3, rgb: [255, 183, 183], label: '3〜5m', w: 2 },
  { cls: 4, rgb: [255, 145, 145], label: '5〜10m', w: 3 },
  { cls: 5, rgb: [242, 133, 201], label: '10〜20m', w: 4 },
  { cls: 6, rgb: [220, 122, 220], label: '20m以上', w: 4 },
];
const FLOOD_Z = 15;
const TILE_URL = (x, y) => `https://disaportal.gsi.go.jp/raster/01_flood_l2_shinsuishin_data/${FLOOD_Z}/${x}/${y}.png`;
const tileCache = new Map();

function lngLatToTilePx(lng, lat) {
  const n = 2 ** FLOOD_Z;
  const fx = ((lng + 180) / 360) * n;
  const fy = ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n;
  return { x: Math.floor(fx), y: Math.floor(fy), px: Math.min(255, Math.floor((fx % 1) * 256)), py: Math.min(255, Math.floor((fy % 1) * 256)) };
}

function loadTile(x, y) {
  const k = `${x}/${y}`;
  if (!tileCache.has(k)) {
    tileCache.set(
      k,
      new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = c.height = 256;
          const g = c.getContext('2d', { willReadFrequently: true });
          g.drawImage(img, 0, 0);
          resolve(g.getImageData(0, 0, 256, 256).data);
        };
        img.onerror = () => resolve(null); // 浸水想定のないタイルは 404
        img.src = TILE_URL(x, y);
      }),
    );
  }
  return tileCache.get(k);
}

function classify(r, g, b, a) {
  if (a < 128) return 0;
  let best = 2, bd = Infinity;
  for (const L of FLOOD_LEGEND) {
    const d = (L.rgb[0] - r) ** 2 + (L.rgb[1] - g) ** 2 + (L.rgb[2] - b) ** 2;
    if (d < bd) { bd = d; best = L.cls; }
  }
  return best;
}

/** points: [{lng,lat}] → 各点の浸水想定の深さクラス（0=想定なし, 1〜6） */
export async function floodClasses(points) {
  const info = points.map((p) => lngLatToTilePx(p.lng, p.lat));
  const keys = [...new Set(info.map((t) => `${t.x}/${t.y}`))];
  const queue = [...keys];
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (queue.length) {
        const [x, y] = queue.pop().split('/').map(Number);
        await loadTile(x, y);
      }
    }),
  );
  const data = new Map();
  for (const k of keys) data.set(k, await tileCache.get(k));
  return info.map((t) => {
    const d = data.get(`${t.x}/${t.y}`);
    if (!d) return 0;
    const o = (t.py * 256 + t.px) * 4;
    return classify(d[o], d[o + 1], d[o + 2], d[o + 3]);
  });
}

/* ---------- 経路の評価 ---------- */
export async function evaluateRoute(route) {
  const [acc, cls] = await Promise.all([accidentsAlong(route), floodClasses(route.samples)]);
  const S = route.samples;
  const seg = route.length / Math.max(1, S.length - 1); // 1 サンプル当たりの距離[m]
  const lengthKm = route.length / 1000;
  const floodCells = cls.filter((c) => c > 0).length;
  const deepCells = cls.filter((c) => c >= 3).length;
  const wKm = cls.reduce((s, c) => s + (c ? FLOOD_LEGEND[c - 1].w : 0), 0) * seg / 1000;
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const total = sum(acc.all), rainN = sum(acc.rain), fatalN = sum(acc.fatal);
  // 100m 窓（±5 サンプル）の事故件数 → 区間リスク
  const win = 5;
  const per100 = S.map((_, i) => {
    let a = 0, r = 0;
    for (let k = Math.max(0, i - win); k <= Math.min(S.length - 1, i + win); k++) { a += acc.all[k]; r += acc.rain[k]; }
    return { all: a, rain: r };
  });
  const hotspots = [];
  const used = new Array(S.length).fill(false);
  [...per100.keys()].sort((a, b) => per100[b].rain * 3 + per100[b].all - (per100[a].rain * 3 + per100[a].all)).forEach((i) => {
    if (hotspots.length >= 3 || per100[i].all < 2 || used[i]) return;
    for (let k = Math.max(0, i - 15); k <= Math.min(S.length - 1, i + 15); k++) used[k] = true;
    hotspots.push({ i, lng: S[i].lng, lat: S[i].lat, ...per100[i] });
  });
  route.risk = {
    lengthKm, floodKm: (floodCells * seg) / 1000, deepFloodKm: (deepCells * seg) / 1000, floodWeightedKm: wKm,
    total, rain: rainN, fatal: fatalN, perKm: total / (lengthKm || 1), rainPerKm: rainN / (lengthKm || 1),
    accRisk: (rainN + (total - rainN) * 0.3 + fatalN * 2) / (lengthKm || 1),
    cls, acc, per100, hotspots, year: acc.year, maxFloodCls: Math.max(0, ...cls),
  };
  return route.risk;
}

/** リスク最大とみなす目安（1km あたり）: 浸水=深さ加重距離 3、事故=加重件数 8。これ以上は 1.0 に丸める */
export const CAPS = { flood: 3, acc: 8 };

/** 安全度(0〜100)を付ける。固定の基準で 0〜1 に換算するので、候補が 1 つでも点数が出る。mode: 'rain' | 'normal' */
export function scoreRoutes(routes, mode) {
  const W = mode === 'rain' ? { f: 0.6, a: 0.4 } : { f: 0.15, a: 0.85 };
  for (const r of routes.filter((x) => x.risk)) {
    const k = r.risk;
    k.floodN = Math.min(1, k.floodWeightedKm / (k.lengthKm || 1) / CAPS.flood);
    k.accN = Math.min(1, k.accRisk / CAPS.acc);
    k.total01 = W.f * k.floodN + W.a * k.accN;
    k.safety = Math.round(100 * (1 - k.total01));
  }
  return W;
}

/** 診断文（おすすめ・理由・注意）を作る */
export function verdict(routes, mode) {
  const done = routes.filter((r) => r.risk);
  const notes = [];
  if (done.every((r) => r.risk.floodKm / (r.risk.lengthKm || 1) > 0.8)) {
    notes.push('どのルートも、ほぼ全区間が浸水想定区域の中です。大雨や河川の増水のおそれがあるときは、移動そのものを見合わせる・高台を経由する・早めに出発するなども検討してください。');
  }
  if (done.length < 2) {
    const k = done[0]?.risk;
    return { title: k ? `この経路の安全度は ${k.safety}（目安）` : '', lines: ['比較する候補がないため、おすすめは出していません。別のルートを追加すると比べられます。'], best: null, notes };
  }
  const ranked = [...done].sort((a, b) => b.risk.safety - a.risk.safety || a.risk.total01 - b.risk.total01);
  const best = ranked[0];
  const gap = best.risk.safety - ranked[ranked.length - 1].risk.safety;
  const title = gap < 5 ? `${best.name} がわずかに安全寄りですが、ほぼ同程度です` : `${best.name} がおすすめです`;
  const f1 = (v) => v.toFixed(1);
  const lines = [];
  for (const o of ranked.slice(1)) {
    const good = [];
    const bad = [];
    const add = (diff, thr, txt) => {
      if (diff >= thr) good.push(txt(diff, '少ない', '短い', '低い'));
      else if (diff <= -thr) bad.push(txt(-diff, '多い', '長い', '高い'));
    };
    add(o.risk.deepFloodKm - best.risk.deepFloodKm, 0.3, (d, _n, l) => `浸水3m以上の想定区間が ${f1(d)}km ${l === '長い' ? l : '短い'}`);
    add(o.risk.floodKm - best.risk.floodKm, 0.3, (d, _n, l) => `浸水想定区域を通る距離が ${f1(d)}km ${l === '長い' ? l : '短い'}`);
    add(o.risk.rain - best.risk.rain, 2, (d, n) => `雨天の事故が ${d} 件${n}`);
    add(o.risk.accRisk - best.risk.accRisk, 0.5, (d, _n, _l, h) => `事故の多さ（1kmあたり）が ${f1(d)} ${h}`);
    if (best.durationSec != null && o.durationSec != null) add((o.durationSec - best.durationSec) / 60, 1, (d, _n, l) => `所要時間が約 ${Math.round(d)} 分 ${l === '長い' ? l : '短い'}`);
    const head = `${best.name} は ${o.name} より安全度が ${best.risk.safety - o.risk.safety} 点高い（${best.risk.safety} 対 ${o.risk.safety}）。`;
    const detail = good.length ? `${o.name} と比べて ${good.join('、')}。` : '';
    const caution = bad.length ? `ただし ${bad.join('、')}。` : '';
    lines.push(`${head}${detail}${caution}`);
  }
  return { title, lines, best, notes };
}

/** 写真（1地点）の診断文。risk = { flood: 深さクラス, around: [{radius, all, rain, fatal}×3] }。level: 0=懸念少なめ / 1=やや注意 / 2=要注意 */
export function photoVerdict(risk) {
  const f = risk.flood;
  const a100 = risk.around[1];
  const level = f >= 3 || a100.all >= 5 ? 2 : f >= 1 || a100.all >= 2 ? 1 : 0;
  const title = ['この場所に大きな懸念は少なめです', 'やや注意が必要な場所です', '大雨のとき、特に注意が必要な場所です'][level];
  const lines = [
    f ? `洪水の浸水想定区域の内側です（想定される浸水の深さ: ${FLOOD_LEGEND[f - 1].label}）。` : '洪水の浸水想定区域（想定最大規模）の外です。',
    a100.all
      ? `100m以内で ${a100.all} 件の事故が記録されています（うち雨天 ${a100.rain} 件、死亡事故 ${a100.fatal} 件）。`
      : '100m以内の事故記録はありません。',
    [
      '想定外の冠水や局地的な大雨はあり得ます。最新の気象・道路情報も確認してください。',
      '大雨のときは、冠水や見通しの悪化に注意してください。',
      '大雨の予報があるときは、この付近を通る・停まる予定を避けるか、早めに通過・退避してください。',
    ][level],
  ];
  return { level, title, lines };
}
