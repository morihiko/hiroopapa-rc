# 広尾親父RC bot

サイトの各ページ右下に出る「🏃 広尾親父RC bot」と、同じ中継につながる LINE 公式アカウントの仕組み・立ち上げ手順。

## 仕組み（3部品）

| 部品 | 場所 | 役割 |
|---|---|---|
| 小窓 | `../chat.js`（各ページが読み込む） | 質問を中継へ送り、答えを表示する。パスワード画面が出ている間は隠れる |
| LINE | LINE 公式アカウント → 中継の `/line` | 最初にサイトと同じ4桁の合言葉を送った相手（グループはグループごと）にだけ答える。1対1では全部の文字メッセージに、グループでは「@広尾親父RC bot」と呼びかけたときだけ答える。会話の続きは1時間おぼえる |
| 中継 | `worker.js`（Cloudflare Workers） | API鍵を預かる。公開サイトの本文を1日1回取り直して「サイト資料」にし、Claude に渡す |
| 回答 | Claude Haiku 5.5 | サイト資料だけを根拠に答える。資料にないことは「載っていない」と言う |

- 質問数の上限: 1日100問（`wrangler.toml` の `DAILY_LIMIT`）、同じ相手は1分に10問
- 合言葉: 小窓の `CLUB_TOKEN` と中継の secret `CLUB_TOKEN` が一致した質問だけ受け付ける
- LINE の合言葉: secret `LINE_PASS`（サイトのパスワードと同じ4桁）。間違いは1時間に5回まで。許可済みの相手は KV の `line:ok:<id>` に残る（取り消すときはそのキーを消す）
- 費用の目安: 1問1〜2円。月50問なら100円以下。固定費なし
- サイトを更新すれば翌日には答えに反映される（急ぐときは下の「資料を作り直す」）

## 公開範囲

LINE 公式アカウントは未認証のままにする（検索結果・おすすめ・Web 版プロフィールに出ない）。アカウント認証は申請しない。

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

## LINE 版の立ち上げ（本人作業、20分）

LINE 側の費用はゼロです。答えは「応答メッセージ」扱いで通数に数えられません。返信が間に合わなかったときだけ push（月200通の無料枠）を使います。

### 1. LINE 公式アカウントを作る
https://entry.line.biz/start/jp/ から「LINE公式アカウントを作成」。認証は不要（未認証アカウントで可）。
名前は「広尾親父RC bot」。

### 2. Messaging API を有効にする
LINE Official Account Manager → 設定 → Messaging API → 「Messaging APIを利用する」。プロバイダー名は自分の名前など何でも可。
終わると **Channel secret** が表示される。

### 3. LINE Developers で設定する
https://developers.line.biz/console/ → 作ったチャネル →
- 「Messaging API設定」タブ → **チャネルアクセストークン（長期）** を発行
- 同タブ → **Webhook URL** に `https://hiroopapa-rc-bot.hiroopapa-rc.workers.dev/line` を入れ、**Webhookの利用** をオン
- 同タブ → 「LINE公式アカウント機能」→ **応答メッセージ: 無効**、**あいさつメッセージ: 無効**（bot が自分で返すため）
- グループでも使うなら 同じ欄の **グループ・複数人チャットへの参加を許可する: 許可**

### 4. 鍵を中継に預ける（Mac で）
```bash
cd ~/ai-office/hiroopapa-rc/chatbot && npx -y wrangler@latest secret put LINE_CHANNEL_SECRET
```
（Channel secret を貼って Enter）
```bash
cd ~/ai-office/hiroopapa-rc/chatbot && npx -y wrangler@latest secret put LINE_CHANNEL_ACCESS_TOKEN
```
（チャネルアクセストークンを貼って Enter）
```bash
cd ~/ai-office/hiroopapa-rc/chatbot && npx -y wrangler@latest secret put LINE_PASS
```
（サイトと同じ4桁を貼って Enter）

### 5. 確かめる
LINE Developers の Webhook URL 欄の「検証」を押して「成功」が出れば接続完了。
自分の LINE で QR コードから友だち追加し、合言葉の4桁を送ってから「次の定例ランはいつ？」と送る。

グループに入れるときは、グループの招待から追加し、「@広尾親父RC bot 質問」の形で呼ぶ。

## 日々の運用

- **使った量を見る**: Cloudflare ダッシュボード → Workers → hiroopapa-rc-bot → Logs に1問ごとのトークン数が出る。お金は Console の Usage で見る
- **資料を作り直す**（サイト更新を今すぐ反映）:
  ```bash
  cd ~/ai-office/hiroopapa-rc/chatbot && npx wrangler@latest kv key delete --binding CHAT_KV "kb:v1"
  ```
- **上限を変える**: `wrangler.toml` の `DAILY_LIMIT` を直して `npx wrangler@latest deploy`
- **止める**: Cloudflare ダッシュボードで Worker を削除するか、`chat.js` の読み込みを各ページから外す。LINE だけ止めるなら Developers で Webhook の利用をオフ

## 資料に入るページ

about / run-guide / pain / races / races-2025 / garmin / kintore / links / swim-guide / bike-guide / trailrun-guide / triathlon-guide と、history.html の活動アーカイブ（日付・種別・大会名・内容・参加者・思い出・記録）。
story・manual は入れていない。増やすときは `worker.js` の `PAGES` に足す（Haiku の安い単価は10万トークンまで。現状は約9.5万）。
