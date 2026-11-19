// JPEG の EXIF から撮影位置・向き・撮影時刻だけを読む最小実装（外部ライブラリ不使用）
// 返り値: { lat, lon, dir, timeMs } （無い項目は null）
const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

export async function readExif(file) {
  const out = { lat: null, lon: null, dir: null, timeMs: null };
  if (!/jpe?g$/i.test(file.name) && file.type !== 'image/jpeg') return out;
  const buf = await file.slice(0, 256 * 1024).arrayBuffer();
  const v = new DataView(buf);
  if (v.getUint16(0) !== 0xffd8) return out;
  let p = 2;
  while (p + 4 < v.byteLength) {
    if (v.getUint8(p) !== 0xff) break;
    const marker = v.getUint8(p + 1);
    const len = v.getUint16(p + 2);
    if (marker === 0xe1 && v.getUint32(p + 4) === 0x45786966) return parseTiff(v, p + 10, out); // "Exif"
    if (marker === 0xda) break;
    p += 2 + len;
  }
  return out;
}

function parseTiff(v, base, out) {
  const le = v.getUint16(base) === 0x4949;
  const u16 = (o) => v.getUint16(base + o, le);
  const u32 = (o) => v.getUint32(base + o, le);
  const str = (o, n) => {
    let s = '';
    for (let i = 0; i < n && v.getUint8(base + o + i); i++) s += String.fromCharCode(v.getUint8(base + o + i));
    return s;
  };
  const rat = (o) => u32(o) / (u32(o + 4) || 1);
  const readIfd = (off) => {
    const tags = {};
    const n = u16(off);
    for (let i = 0; i < n; i++) {
      const e = off + 2 + i * 12;
      const tag = u16(e);
      const type = u16(e + 2);
      const count = u32(e + 4);
      const size = (TYPE_SIZE[type] ?? 1) * count;
      const valOff = size > 4 ? u32(e + 8) : e + 8;
      tags[tag] = { type, count, off: valOff };
    }
    return tags;
  };
  const ifd0 = readIfd(u32(4));
  const exifIfd = ifd0[0x8769] ? readIfd(u32(ifd0[0x8769].off === undefined ? 0 : ifd0[0x8769].off)) : null;
  const gps = ifd0[0x8825] ? readIfd(u32(ifd0[0x8825].off)) : null;
  // ポインタ型タグは値そのものがオフセット（readIfd の valOff は e+8 を指すので u32 で読む）
  if (exifIfd?.[0x9003]) {
    const m = /(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/.exec(str(exifIfd[0x9003].off, 19));
    if (m) out.timeMs = new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime(); // 端末のローカル時刻
  }
  if (gps) {
    const dms = (t) => rat(gps[t].off) + rat(gps[t].off + 8) / 60 + rat(gps[t].off + 16) / 3600;
    if (gps[1] && gps[2] && gps[3] && gps[4]) {
      out.lat = dms(2) * (str(gps[1].off, 1) === 'S' ? -1 : 1);
      out.lon = dms(4) * (str(gps[3].off, 1) === 'W' ? -1 : 1);
    }
    if (gps[0x11]) out.dir = rat(gps[0x11].off);
  }
  return out;
}
