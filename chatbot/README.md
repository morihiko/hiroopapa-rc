# 広尾親父RC bot

サイトの各ページ右下に出る「🏃 広尾親父RC bot」の仕組みと、立ち上げ手順。

## 仕組み（3部品）

| 部品 | 場所 | 役割 |
|---|---|---|
| 小窓 | `../chat.js`（各ページが読み込む） | 質問を中継へ送り、答えを表示する。パスワード画面が出ている間は隠れる |
| 中継 | `worker.js`（Cloudflare Workers） | API鍵を預かる。公開サイトの本文を1日1回取り直して「サイト資料」にし、Claude に渡す |
| 回答 | Claude Haiku 5.5 | サイト資料だけを根拠に答える。資料にないことは「載っていない」と言う |

- 質問数の上限: 1日100問（`wrangler.toml` の `DAILY_LIMIT`）、同じ相手は1分に10問
- 合言葉: 小窓の `CLUB_TOKEN` と中継の secret `CLUB_TOKEN` が一致した質問だけ受け付ける
- 費用の目安: 1問1〜2円。月50問なら100円以下。固定費なし
- サイトを更新すれば翌日には答えに反映される（急ぐときは下の「資料を作り直す」）

## 立ち上げ手順（本人作業、15分）

前提: Node.js が入っていること（`node -v`）。

### 1. Cloudflare アカウント（無料）
https://dash.cloudflare.com/sign-up で作る。カード登録は不要。

### 2. ログインして保管庫を作る
```bash
cd ~/ai-office/hiroopapa-rc/chatbot
npx wrangler@latest login
npx wrangler@latest kv namespace create CHAT_KV
```
出力の `id = "xxxx"` を `wrangler.toml` の `REPLACE_WITH_KV_ID` に貼る。

### 3. 鍵と合言葉を預ける
```bash
npx wrangler@latest secret put ANTHROPIC_API_KEY
```
（Console の API キーを貼る。PTAボットと同じ鍵でよい）
```bash
npx wrangler@latest secret put CLUB_TOKEN
```
（`chat.js` の `CLUB_TOKEN` と同じ文字列を貼る）

### 4. 配置する
```bash
npx wrangler@latest deploy
```
出力の `https://hiroopapa-rc-bot.<名前>.workers.dev` を `../chat.js` の `WORKER_URL` に貼る。

### 5. サイトを更新する
```bash
cd ~/ai-office/hiroopapa-rc && git add -A && git commit -m "広尾親父RC bot の接続先を設定" && git push
```
1分ほどで公開サイトに小窓が出る。

## 日々の運用

- **使った量を見る**: Cloudflare ダッシュボード → Workers → hiroopapa-rc-bot → Logs に1問ごとのトークン数が出る。お金は Console の Usage で見る
- **資料を作り直す**（サイト更新を今すぐ反映）:
  ```bash
  cd ~/ai-office/hiroopapa-rc/chatbot && npx wrangler@latest kv key delete --binding CHAT_KV "kb:v1"
  ```
- **上限を変える**: `wrangler.toml` の `DAILY_LIMIT` を直して `npx wrangler@latest deploy`
- **止める**: Cloudflare ダッシュボードで Worker を削除するか、`chat.js` の読み込みを各ページから外す

## 資料に入るページ

about / run-guide / pain / races / races-2025 / garmin / kintore / links / swim-guide / bike-guide / trailrun-guide / triathlon-guide と、history.html の活動アーカイブ（日付・種別・大会名・内容・参加者・思い出・記録）。
story・manual・recruit は入れていない。増やすときは `worker.js` の `PAGES` に足す（Haiku の安い単価は10万トークンまで。現状は約9.5万）。
