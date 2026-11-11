// 統計ダッシュボード: 都道府県別の主要指標（ライブ API）を 3D 柱で表示
import { setupPrefColumns, loadDashboardPref } from './pref3d.js';

// 各コードは API で「47 都道府県分が揃うデータ」を確認済みのもの
const IND = [
  { group: '人口・世帯', id: '0201010000000010000', label: '総人口', unit: ' 人' },
  { group: '人口・世帯', id: '0201010010000020030', label: '65歳以上人口の割合', unit: ' %', digits: 1 },
  { group: '人口・世帯', id: '0201010010000020010', label: '0〜14歳人口の割合', unit: ' %', digits: 1 },
  { group: '人口・世帯', id: '0203010010000020010', label: '合計特殊出生率', unit: '', digits: 2 },
  { group: '人口・世帯', id: '0201300000000020010', label: '人口密度（総面積1km²あたり）', unit: ' 人/km²', digits: 1 },
  { group: '人口・世帯', id: '0201300100000020010', label: '人口密度（可住地面積1km²あたり）', unit: ' 人/km²', digits: 1 },
  { group: '人口・世帯', id: '0202030000000020010', label: '一般世帯の一世帯当たり人員', unit: ' 人', digits: 2 },
  { group: '人口・世帯', id: '0801010102010020000', label: '持ち家比率', unit: ' %', digits: 1 },
  { group: '自然環境', id: '0102010000000010010', label: '年平均気温', unit: ' ℃', digits: 1 },
  { group: '自然環境', id: '0101010100000020010', label: '可住地面積割合', unit: ' %', digits: 1 },
  { group: '社会・安全', id: '1402020000000010010', label: '刑法犯認知件数', unit: ' 件' },
  { group: '社会・安全', id: '1404020100000010010', label: '交通事故発生件数', unit: ' 件' },
  { group: '社会・安全', id: '1505130000000010070', label: '自殺者数', unit: ' 人' },
  { group: '医療・福祉', id: '1505040000000010000', label: '医師数', unit: ' 人' },
  { group: '医療・福祉', id: '1503060701000010010', label: '保育所等利用待機児童数', unit: ' 人' },
  { group: '教育・文化', id: '1201110500010010012', label: '高校卒業者の大学進学者数', unit: ' 人' },
  { group: '教育・文化', id: '1202010400000010010', label: '図書館数', unit: ' 館' },
  { group: '生活', id: '1405050102000010010', label: '1人1日当たりのごみ排出量', unit: ' g', digits: 0 },
];

export async function setup(ctx) {
  await setupPrefColumns(
    ctx,
    IND.map((i) => ({ ...i, load: () => loadDashboardPref(i.id) })),
  );
}
