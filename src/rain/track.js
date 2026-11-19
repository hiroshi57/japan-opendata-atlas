// 経路の幾何・ファイル読み込み（GPX / CSV）・動画との時刻同期
const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;

/** 2 点間の距離 [m]（ハーバーサイン）。点は [lng, lat] */
export function dist(a, b) {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function bearing(a, b) {
  const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]));
  const x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * 座標列から経路オブジェクトを作る。
 * samples: 約 step[m] ごとに等間隔へ再サンプルした点 { lng, lat, d, ms }（ms は各点の絶対時刻。無ければ null）
 */
export function makeRoute({ name, coords, times = null, source = 'osrm', color = '#2563eb', durationSec = null, step = 10 }) {
  const cd = [0];
  for (let i = 1; i < coords.length; i++) cd.push(cd[i - 1] + dist(coords[i - 1], coords[i]));
  const length = cd[cd.length - 1];
  const samples = [];
  const n = Math.max(1, Math.ceil(length / step));
  let seg = 0;
  for (let k = 0; k <= n; k++) {
    const d = Math.min(length, (k * length) / n);
    while (seg < coords.length - 2 && cd[seg + 1] < d) seg++;
    const span = cd[seg + 1] - cd[seg] || 1;
    const f = Math.min(1, Math.max(0, (d - cd[seg]) / span));
    const a = coords[seg];
    const b = coords[seg + 1] ?? coords[seg];
    samples.push({
      lng: a[0] + (b[0] - a[0]) * f,
      lat: a[1] + (b[1] - a[1]) * f,
      d,
      ms: times ? times[seg] + (times[seg + 1] - times[seg]) * f : null,
    });
  }
  return { name, coords, source, color, length, durationSec, samples, risk: null };
}

/** 動画の再生位置 ⇔ 経路上の距離 の対応 */
export function makeSync(route, { duration, startMs }) {
  const s = { offset: 0, from: 0, to: duration, duration, startMs };
  const timed = route.samples[0].ms != null;
  s.timed = timed;
  s.tAtD = (d) => {
    if (timed) {
      const ms = interp(route.samples, 'd', 'ms', d);
      return (ms - s.startMs - s.offset * 1000) / 1000;
    }
    return s.from + ((s.to - s.from) * d) / (route.length || 1);
  };
  s.dAtT = (t) => {
    if (timed) {
      const abs = s.startMs + s.offset * 1000 + t * 1000;
      return interp(route.samples, 'ms', 'd', abs);
    }
    const f = (t - s.from) / ((s.to - s.from) || 1);
    return Math.min(route.length, Math.max(0, f * route.length));
  };
  return s;
}

function interp(arr, kx, ky, x) {
  if (x <= arr[0][kx]) return arr[0][ky];
  const last = arr[arr.length - 1];
  if (x >= last[kx]) return last[ky];
  let lo = 0;
  let hi = arr.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (arr[mid][kx] <= x) lo = mid;
    else hi = mid;
  }
  const span = arr[hi][kx] - arr[lo][kx] || 1;
  return arr[lo][ky] + ((arr[hi][ky] - arr[lo][ky]) * (x - arr[lo][kx])) / span;
}

export function pointAtD(route, d) {
  const i = Math.min(route.samples.length - 1, Math.max(0, Math.round(d / (route.length / (route.samples.length - 1 || 1)))));
  const a = route.samples[Math.max(0, i - 1)];
  const b = route.samples[Math.min(route.samples.length - 1, i + 1)];
  return { lng: route.samples[i].lng, lat: route.samples[i].lat, heading: bearing([a.lng, a.lat], [b.lng, b.lat]), i };
}

/* ---------- ファイル読み込み ---------- */
export function parseGpx(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const nodes = [...doc.querySelectorAll('trkpt, rtept')];
  const coords = [];
  const times = [];
  for (const n of nodes) {
    const lat = parseFloat(n.getAttribute('lat'));
    const lon = parseFloat(n.getAttribute('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    coords.push([lon, lat]);
    times.push(Date.parse(n.querySelector('time')?.textContent ?? ''));
  }
  return { coords, times: times.length && times.every(Number.isFinite) ? times : null };
}

export function parseCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { coords: [], times: null };
  const head = lines[0].split(',').map((s) => s.trim());
  const hasHeader = head.some((h) => /[A-Za-z]/.test(h));
  let iLat = head.findIndex((h) => /^lat/i.test(h));
  let iLng = head.findIndex((h) => /^(lon|lng)/i.test(h));
  const iTime = head.findIndex((h) => /time|date/i.test(h));
  if (iLat < 0 || iLng < 0) {
    iLat = 0;
    iLng = 1;
  }
  const coords = [];
  const times = [];
  for (const line of lines.slice(hasHeader ? 1 : 0)) {
    const c = line.split(',');
    let lat = parseFloat(c[iLat]);
    let lon = parseFloat(c[iLng]);
    if (lat > 90 && lon < 90) [lat, lon] = [lon, lat]; // 緯度経度が逆でも救う
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    coords.push([lon, lat]);
    times.push(iTime >= 0 ? Date.parse(c[iTime]) : NaN);
  }
  return { coords, times: iTime >= 0 && times.every(Number.isFinite) ? times : null };
}

export async function readTrackFile(file) {
  const text = await file.text();
  const isGpx = /\.gpx$/i.test(file.name) || /<gpx[\s>]/i.test(text.slice(0, 2000));
  const r = isGpx ? parseGpx(text) : parseCsv(text);
  if (r.coords.length < 2) throw new Error('経路の点が 2 つ以上見つかりません（GPX / CSV(lat,lon[,time]) に対応）');
  return r;
}
