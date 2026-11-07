# 広尾親父RC サイト

部員専用の静的サイト（手書きHTML）と、サイト案内の LINE bot（`chatbot/`）。

## 見た目を作る・直すとき（必ず）
- 先に `design/DESIGN.md` と `design/catalog.html` を読む
- 色・文字・部品は `hg.css` が正本。ページの中に色コードを書かない、`!important` で上から塗らない
- 渡す前に `python3 design/check.py <ページ>` を実行し、数字が増えていないこと（移行済みのページは ◎）を確かめる
