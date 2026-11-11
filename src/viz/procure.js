// 官公需情報ポータル: 都道府県別の公示件数（リポジトリ内スナップショット）を 3D 柱で表示
import { setupPrefColumns } from './pref3d.js';
import kkj from '../../data/snapshots/kkj_hits.json';

export async function setup(ctx) {
  const indicators = kkj.keywords.map((kw) => ({
    id: kw,
    label: `「${kw}」を含む公示`,
    unit: ' 件',
    load: async () => ({ values: kkj.hits[kw], year: `${kkj.fetched.slice(0, 10)} 取得`, source: '官公需情報ポータルサイト 検索API（スナップショット）' }),
  }));
  await setupPrefColumns(ctx, indicators);
}
