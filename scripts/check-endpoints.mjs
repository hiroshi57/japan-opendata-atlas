// ビジュアルが依存する外部エンドポイントの死活チェック（壊れた API の早期発見用）
// 使い方: node scripts/check-endpoints.mjs   （1 件でも失敗したら exit 1）
const Z = '8/227/100';
const checks = [
  ['地理院タイル 標準地図', `https://cyberjapandata.gsi.go.jp/xyz/std/${Z}.png`, 'image'],
  ['地理院タイル 活断層図', 'https://cyberjapandata.gsi.go.jp/xyz/afm/11/1799/806.png', 'image'],
  ['地理院 地名検索', 'https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E6%9D%B1%E4%BA%AC%E9%A7%85', 'json'],
  ['標高 DEM (Terrarium)', 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/10/908/403.png', 'image'],
  ['重ねるハザードマップ 洪水', 'https://disaportal.gsi.go.jp/raster/01_flood_l2_shinsuishin_data/10/908/403.png', 'image'],
  ['PLATEAU MVT (Indigo Lab)', 'https://indigo-lab.github.io/plateau-lod2-mvt/14/14552/6451.pbf', ''],
  ['シームレス地質図', 'https://gbank.gsj.jp/seamless/v2/api/1.2/tiles/8/100/227.png', 'image'],
  ['気象庁 アメダス 最新時刻', 'https://www.jma.go.jp/bosai/amedas/data/latest_time.txt', 'text'],
  ['気象庁 地震情報', 'https://www.jma.go.jp/bosai/quake/data/list.json', 'json'],
  ['気象庁 ひまわり 時刻', 'https://www.jma.go.jp/bosai/himawari/data/satimg/targetTimes_jp.json', 'json'],
  ['気象庁 降水ナウキャスト 時刻', 'https://www.jma.go.jp/bosai/jmatile/data/nowc/targetTimes_N1.json', 'json'],
  ['気象庁 危険度分布 時刻', 'https://www.jma.go.jp/bosai/jmatile/data/risk/targetTimes.json', 'json'],
  ['気象庁 火山一覧', 'https://www.jma.go.jp/bosai/volcano/const/volcano_list.json', 'json'],
  ['J-SHIS 地点照会', 'https://www.j-shis.bosai.go.jp/map/api/pshm/Y2023/AVR/TTL_MTTL/meshinfo.geojson?position=139.7671,35.6812&epsg=4326', 'json'],
  ['統計ダッシュボード', 'https://dashboard.e-stat.go.jp/api/1.0/Json/getData?Lang=JP&IndicatorCode=0201010010000020030&RegionalRank=3', 'json'],
  ['e-Gov 法令API', 'https://laws.e-gov.go.jp/api/2/laws?limit=1', 'json'],
  ['ジャパンサーチ', 'https://jpsearch.go.jp/api/item/search/jps-cross?keyword=%E5%AF%8C%E5%A3%AB&size=1', 'json'],
  ['メディア芸術DB SPARQL', 'https://mediaarts-db.artmuseums.go.jp/sparql?output=json&query=SELECT%20*%20WHERE%20%7B%3Fs%20%3Fp%20%3Fo%7D%20LIMIT%201', ''],
];

let failed = 0;
await Promise.all(
  checks.map(async ([name, url, kind]) => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'japan-opendata-atlas-check', Origin: 'https://example.github.io' } });
      const type = res.headers.get('content-type') ?? '';
      const ok = res.ok && (!kind || type.includes(kind) || (kind === 'text' && type.includes('text')));
      const cors = res.headers.get('access-control-allow-origin') ? 'CORS✓' : 'CORS✗';
      console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} [${res.status}] ${cors}`);
      if (!ok) failed++;
    } catch (e) {
      console.log(`FAIL ${name} (${e.message})`);
      failed++;
    }
  }),
);
console.log(failed ? `\n${failed} 件失敗` : '\nすべて正常');
process.exit(failed ? 1 : 0);
