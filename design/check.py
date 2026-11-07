#!/usr/bin/env python3
"""デザインルールの点検。ページごとに「ルールから外れている数」を数える。

使い方:  python3 design/check.py          （hiroopapa-rc の直下で実行）
         python3 design/check.py about.html  （1ページだけ）

数えるもの:
  直書き色   … ページ内に #xxxxxx / rgb() を直接書いている数（目標 0）
  上書き     … !important の数（目標 0）
  テーマ層   … <style id="…-theme"> の重ね塗りの数（目標 0）
  hg.css     … 共通スタイルを読み込んでいるか（目標 ✓）
"""
import re, sys, glob, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP = {"design/catalog.html"}

def check(path):
    s = open(path, encoding="utf-8").read()
    # SVG のロゴ・背景の中の色はロゴ素材として数えない
    body = re.sub(r"<svg.*?</svg>", "", s, flags=re.S)
    hexes = re.findall(r"#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![0-9a-fA-F-])", body)
    rgbs = re.findall(r"rgba?\(", body)
    return {
        "直書き色": len(hexes) + len(rgbs),
        "色の種類": len({h.upper() for h in hexes}),
        "上書き": body.count("!important"),
        "テーマ層": len(re.findall(r'<style id="[^"]*theme"', s)),
        "hg.css": "✓" if "hg.css" in s else "－",
    }

def main():
    os.chdir(ROOT)
    files = sys.argv[1:] or sorted(glob.glob("*.html"))
    files = [f for f in files if f not in SKIP]
    cols = ["直書き色", "色の種類", "上書き", "テーマ層", "hg.css"]
    print(f"{'ページ':24}" + "".join(f"{c:>8}" for c in cols))
    tot = {c: 0 for c in cols[:4]}
    done = 0
    for f in files:
        r = check(f)
        for c in tot: tot[c] += r[c]
        clean = r["直書き色"] == 0 and r["上書き"] == 0 and r["テーマ層"] == 0 and r["hg.css"] == "✓"
        done += clean
        print(f"{f:24}" + "".join(f"{str(r[c]):>8}" for c in cols) + ("  ◎" if clean else ""))
    print("-" * 64)
    print(f"{'合計':24}" + "".join(f"{tot[c]:>8}" for c in cols[:4]))
    print(f"\nルールどおりのページ: {done} / {len(files)}")

if __name__ == "__main__":
    main()
