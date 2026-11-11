"""Qiita 記事「日本のオープンデータ100選」から data/catalog.json を生成する。

使い方:  python -I scripts/build_catalog.py          # 公開用（概要は冒頭の抜粋のみ。全文は元記事へ誘導）
         python -I scripts/build_catalog.py --full   # ローカル検証用（記事本文を全文保存。公開しないこと）
出典:    https://qiita.com/Retro-Maid/items/d99e436fe0b19e151709
出力:    data/catalog.json  (100 項目: 分類・提供元・概要・使い方・構成・規約・リンク先)
"""
import html
import json
import re
import sys
import urllib.request
from pathlib import Path

EXCERPT = 140  # 公開版で残す概要の文字数（引用の範囲に留める）
SRC = "https://qiita.com/Retro-Maid/items/d99e436fe0b19e151709"
OUT = Path(__file__).resolve().parent.parent / "data" / "catalog.json"

# 記事 H3 見出し（項目フィールド）の並び順
FIELD_KEYS = ["name", "org", "summary", "usage", "structure", "license", "link"]


def text(fragment: str) -> str:
    t = re.sub(r"<li[^>]*>", "\n- ", fragment)
    t = re.sub(r"<(br|/p)[^>]*>", "\n", t)
    t = html.unescape(re.sub(r"<[^>]+>", "", t))
    return re.sub(r"\n\s*\n+", "\n", t).strip()


FULL = "--full" in sys.argv


def main() -> None:
    req = urllib.request.Request(SRC, headers={"User-Agent": "Mozilla/5.0"})
    page = urllib.request.urlopen(req, timeout=60).read().decode("utf-8")
    start = page.index("<article ")
    article = page[start : page.index("</article>", start)]

    # 目次: 分類 (H3) -> 項目番号
    first_item = article.index("<h1", article.index("1. e-Gov") - 200)
    toc = article[:first_item]
    category_of: dict[int, str] = {}
    cur = None
    for m in re.finditer(r"<h3[^>]*>(.*?)</h3>|<li[^>]*>(.*?)</li>", toc, re.S):
        if m.group(1):
            cur = text(m.group(1))
        elif cur:
            mm = re.match(r"(\d+)\.", text(m.group(2)))
            if mm:
                category_of[int(mm.group(1))] = cur

    items = []
    for part in re.split(r"(?=<h1[ >])", article):
        m = re.match(r"<h1[^>]*>(.*?)</h1>", part, re.S)
        if not m:
            continue
        nm = re.match(r"(\d+)\.\s*(.*)", text(m.group(1)))
        if not nm:
            continue
        num = int(nm.group(1))
        blocks = list(re.finditer(r"<h3[^>]*>(.*?)</h3>(.*?)(?=<h3|$)", part, re.S))
        vals = [text(b.group(2)) for b in blocks]
        links = [
            [html.unescape(x) for x in re.findall(r'<a [^>]*href="([^"]+)"', b.group(2))
             if "qiita" not in x]
            for b in blocks
        ]
        rec = {"id": num, "name": nm.group(2), "category": category_of.get(num, "その他")}
        for key, v in zip(FIELD_KEYS, vals):
            if key not in ("name", "link"):  # name は H1 見出しを採用 / link は url に正規化
                rec[key] = v
        if not FULL:  # 記事本文の転載を避け、冒頭の抜粋 + 元記事リンクのみとする
            summ = rec.get("summary", "")
            rec["summary"] = summ if len(summ) <= EXCERPT else summ[:EXCERPT].rstrip() + "…"
            for k in ("usage", "structure", "license"):
                rec.pop(k, None)
        rec["url"] = (links[-1] or [""])[0] if links else ""
        rec["license_urls"] = links[-2] if len(links) >= 2 else []
        items.append(rec)

    items.sort(key=lambda r: r["id"])
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"source": SRC, "excerpt_only": not FULL, "count": len(items), "items": items},
                              ensure_ascii=False, indent=1), encoding="utf-8")
    sys.stdout.buffer.write(f"wrote {len(items)} items -> {OUT}\n".encode("utf-8"))


if __name__ == "__main__":
    main()
