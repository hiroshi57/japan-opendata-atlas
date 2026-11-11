"""巨大 CSV / ZIP を取得して集計し data/snapshots/ に保存する（Node 版では扱いにくいもの）。

使い方:  python -I scripts/fetch_snapshots.py
  - 警察庁 交通事故統計オープンデータ（本票）  -> jp_traffic_accidents.json   [項目 22]
  - 東京都交通局 GTFS（都営地下鉄の路線形状 / 都営バス停留所）-> toei_gtfs.json [項目 46, 77, 78]
"""
import csv
import io
import json
import urllib.error
import urllib.request
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "data" / "snapshots"
OUT.mkdir(parents=True, exist_ok=True)
NOW = datetime.now(timezone.utc).isoformat()


def get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    return urllib.request.urlopen(req, timeout=600).read()


def dms(s: str, deg_digits: int) -> float | None:
    """'430607590' -> 43°06'07.590" の十進度。"""
    s = s.strip()
    if not s.isdigit() or len(s) < deg_digits + 7:
        return None
    d = int(s[:deg_digits])
    m = int(s[deg_digits : deg_digits + 2])
    sec = int(s[deg_digits + 2 : deg_digits + 4]) + int(s[deg_digits + 4 :].ljust(3, "0")[:3]) / 1000
    return d + m / 60 + sec / 3600


def traffic() -> None:
    # 公開済みの最新年を自動で探す（前年 → 2 年前 → 3 年前）
    text = url = None
    for year in range(datetime.now().year - 1, datetime.now().year - 4, -1):
        url = f"https://www.npa.go.jp/publications/statistics/koutsuu/opendata/{year}/honhyo_{year}.csv"
        try:
            text = get(url).decode("cp932", errors="replace")
            break
        except urllib.error.HTTPError as e:
            if e.code != 404:
                raise
    if text is None:
        raise SystemExit("交通事故 CSV が見つかりません")
    rows = csv.reader(io.StringIO(text))
    next(rows)
    years = Counter()
    bins: dict[tuple[int, int], list[int]] = defaultdict(lambda: [0, 0])
    heat = [[0] * 24 for _ in range(7)]  # [曜日(日=0..土=6)][時]
    months = [0] * 12
    fatal = []
    total = deaths = injured = 0
    for r in rows:
        if len(r) < 63:
            continue
        lat = dms(r[60], 2)
        lon = dms(r[61], 3)
        if lat is None or lon is None or not (20 <= lat <= 46 and 122 <= lon <= 154):
            continue
        try:
            d, i = int(r[5]), int(r[6])
            hour, month, wd = int(r[13]), int(r[11]), int(r[62])
            years[int(r[10])] += 1
        except ValueError:
            continue
        total += 1
        deaths += d
        injured += i
        key = (round(lat / 0.1), round(lon / 0.1))
        bins[key][0] += 1
        bins[key][1] += d
        if 0 <= hour < 24 and 1 <= wd <= 7:
            heat[wd - 1][hour] += 1
        if 1 <= month <= 12:
            months[month - 1] += 1
        if r[4].strip() == "1" or d > 0:  # 事故内容 1=死亡事故
            fatal.append([round(lon, 4), round(lat, 4), d, hour, month])
    cells = [[round(k[1] * 0.1, 2), round(k[0] * 0.1, 2), v[0], v[1]] for k, v in bins.items()]
    cells.sort(key=lambda c: -c[2])
    data = {
        "source": url,
        "fetched": NOW,
        "year": years.most_common(1)[0][0],
        "total": total,
        "deaths": deaths,
        "injured": injured,
        "cells": cells,
        "heat": heat,
        "months": months,
        "fatal": fatal,
    }
    (OUT / "jp_traffic_accidents.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("traffic", total, "cells", len(cells), "fatal", len(fatal), "year", data["year"])


def read_csv(z: zipfile.ZipFile, name: str):
    return csv.DictReader(io.StringIO(z.read(name).decode("utf-8-sig")))


def toei() -> None:
    base = "https://api-public.odpt.org/api/v4/files/Toei/data/"
    train = zipfile.ZipFile(io.BytesIO(get(base + "Toei-Train-GTFS.zip")))
    bus = zipfile.ZipFile(io.BytesIO(get(base + "ToeiBus-GTFS.zip")))

    routes = {r["route_id"]: r for r in read_csv(train, "routes.txt")}
    train_stops = {s["stop_id"]: s for s in read_csv(train, "stops.txt")}
    trip_route = {t["trip_id"]: t["route_id"] for t in read_csv(train, "trips.txt")}
    seqs: dict[str, list[tuple[int, str]]] = defaultdict(list)
    for st in read_csv(train, "stop_times.txt"):
        seqs[st["trip_id"]].append((int(st["stop_sequence"]), st["stop_id"]))
    # 路線ごとに、停車駅数が最大の便 1 本を代表として、駅座標を結んだ折れ線を作る
    best: dict[str, list[tuple[int, str]]] = {}
    for tid, seq in seqs.items():
        rid = trip_route.get(tid)
        if rid and len(seq) > len(best.get(rid, [])):
            best[rid] = seq
    lines = []
    for rid, seq in best.items():
        r = routes[rid]
        seq.sort()
        coords = []
        for _, sid in seq:
            st = train_stops.get(sid)
            if st and st["stop_lat"]:
                coords.append([round(float(st["stop_lon"]), 5), round(float(st["stop_lat"]), 5)])
        if len(coords) > 1:
            lines.append({"name": r.get("route_long_name") or r.get("route_short_name"), "color": "#" + (r.get("route_color") or "666666"), "coords": coords})

    stops = [
        [round(float(s["stop_lon"]), 5), round(float(s["stop_lat"]), 5), s["stop_name"]]
        for s in read_csv(bus, "stops.txt")
        if s.get("location_type") == "1" and s["stop_lat"]
    ]
    stations = []
    seen_names = set()
    for s_ in train_stops.values():
        if s_["stop_lat"] and s_["stop_name"] not in seen_names:
            seen_names.add(s_["stop_name"])
            stations.append([round(float(s_["stop_lon"]), 5), round(float(s_["stop_lat"]), 5), s_["stop_name"]])
    bus_routes = sum(1 for _ in read_csv(bus, "routes.txt"))
    data = {"source": base, "fetched": NOW, "lines": lines, "busStops": stops, "stations": stations, "busRoutes": bus_routes}
    (OUT / "toei_gtfs.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("toei lines", len(lines), "busStops", len(stops), "stations", len(stations), "busRoutes", bus_routes)


if __name__ == "__main__":
    toei()
    traffic()
