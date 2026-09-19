# 実際に使えるようにする手順（threads-auto-post）

上から順にやれば動きます。「あなたがやること」と「コマンド」を分けて書いています。
threads-ops-2 を動かしたことがあれば、同じ流れです（Anthropic のキーは要りません）。

## 0. 前提
- Node.js 18 以上（推奨 22）。`node -v` で確認。
- git が入っていること。
- Google アカウント（Firebase 用）、Meta for Developers のアカウント、Vercel のアカウント（GitHub 連携）。

## 1. 手元のフォルダに置く
PowerShell かコマンドプロンプトで:

```
cd "C:\Users\user\Desktop\AI関連\システム関連"
git clone https://github.com/miyukiuranai-ai/threads-auto-post.git
cd threads-auto-post
npm install
```

`C:\Users\user\Desktop\AI関連\システム関連\threads-auto-post` ができます。

## 2. Firebase（データと画像の置き場）
**threads-ops-2 とは別のプロジェクトを作ってください。** 同じコレクション名（accounts / posts など）を使うので、同じプロジェクトに入れると混ざります。

1. https://console.firebase.google.com で「プロジェクトを追加」。名前は `threads-auto-post` など。Google アナリティクスは不要。
2. 左メニュー「構築」→「Firestore Database」→「データベースを作成」。ロケーションは `asia-northeast1（東京）`、モードは「本番環境モード」。
3. 画像・動画を使うなら「構築」→「Storage」→「使ってみる」。本番環境モードで作成。ロケーションは Firestore と同じ。作成後のバケット名（`xxxx.firebasestorage.app` の形）を控える。
   - Storage には Blaze（従量課金）プランへの切り替えを求められます。画像・動画の量なら月に数円〜数十円程度です。文章だけなら Storage は飛ばしてよい。
4. 歯車 →「プロジェクトの設定」→「サービス アカウント」→「新しい秘密鍵の生成」。JSON がダウンロードされる。この JSON は絶対に git に入れない。

## 3. `.env.local` を作る
ダウンロードした JSON のパスを渡すと、Firebase の項目と秘密の鍵（SESSION_SECRET / CRON_SECRET）を自動で書きます。

```
npm run env:init -- --sa "C:\path\to\threads-auto-post-firebase-adminsdk-xxxx.json" --admin-user admin --admin-password 好きなパスワード
```

- バケット名が `プロジェクトID.firebasestorage.app` と違うときは `--bucket 実際の名前` を足す。
- 管理者以外の人（メンバー）を作るなら、`.env.local` の `MEMBERS` に `suzuki:パスワード:teamB` のように書く（カンマ区切りで複数可）。
- 取り込みが済んだら JSON ファイルは削除してよい。

## 4. 接続の確認
```
npm run setup:check
```
✗ が出た行の右に理由と対処が出ます。Storage を使うなら、続けて CORS（ブラウザから直接ファイルを送る許可）を入れます:
```
npm run storage:setup
```

## 5. ローカルで画面を開く
```
npm run dev
```
http://localhost:3000 を開き、ADMIN_USER / ADMIN_PASSWORD でログイン。

## 6. Threads のアプリと名義のトークン
Threads 公式 API を使うには Meta のアプリが要ります。**threads-ops-2 で使っているアプリをそのまま使えます**（6-1 は飛ばして 6-2 へ）。

### 6-1. アプリを作る（初めてのとき）
1. https://developers.facebook.com/apps →「アプリを作成」→ ユースケースで「Threads API にアクセス」を選ぶ。
2. 「ユースケース」→ Threads →「カスタマイズ」で権限 `threads_basic` と `threads_content_publish` を追加（投稿の削除も使うなら `threads_delete`）。
3. アプリは「開発モード」のままでよい。App Review はしない。その代わり、使う名義を「テスター」として登録する（6-2）。

### 6-2. 名義ごとにトークンを取る
1. Meta 側: 「アプリの役割」→「役割」→「ユーザーを追加」→「Threads テスター」→ 名義の Threads ユーザー名を入力。
2. 名義側: その名義で Threads アプリを開き、設定 →「アカウント」→「ウェブサイトの権限」→「招待」で承認する。**これをしないとトークンが出ません。**
3. **シークレットウィンドウ**で https://www.threads.com/ にその名義でログインし、同じウィンドウで https://developers.facebook.com/ → アプリ → ユースケース → Threads → 設定 の最下部「ユーザートークン生成ツール」→ その名義の「アクセストークンを生成」→ コピー。
   - どの名義のトークンが出るかは、**そのブラウザが threads.com にログインしている名義**で決まります。ダイアログの見出しが目的の名義になっているか確かめてからコピー。
4. 画面の「名義の管理」の欄に貼り付けて「名義を追加」。**1行に1つずつ貼れば、まとめて登録できます。**
5. 名義の数だけ 1〜4 を繰り返す。

トークンは 60 日で失効しますが、定期実行（第 9 章）が毎日確かめて自動で延長します。失効してしまったら、同じ名義のトークンを取り直して貼れば入れ替わります（設定は残ります）。

## 7. 文章ストックを入れる
画面の「文章ストック」で、文章を貼り付けて「取り込む」。区切りは `---` だけの行（本文に空行があってもよい）。ファイル（.txt / .csv）でも入れられます。
名義ごとに分けたいときは「使う名義」で名義を選んでから取り込みます。

## 8. 自動投稿の設定
画面の「自動投稿の設定」で名義を選び（複数まとめても可）、
- 「毎日決まった時刻に投稿する」に時刻（例: 07:00, 12:30, 21:00）
- 「〇時間から〇時間おき」に間隔（例: 2 と 5）と時間帯（例: 07:00〜23:00）
を入れて「選んだ名義に適用する」。両方 ON でも、片方だけでも構いません。

まず試すだけなら、`.env.local` の `POSTING_MODE=dry_run` にすると、投稿の流れは動くが Threads には送りません（画面にテストモードと出ます）。

手元で定期実行を 1 回ぶん動かすには:
```
npm run tick
```

## 9. Vercel に載せる（常時動かす）
1. https://vercel.com/new で GitHub の `miyukiuranai-ai/threads-auto-post` を Import。Framework は Next.js が自動で選ばれる。
2. 「Environment Variables」に `.env.local` の内容を全部入れる（Key 欄に `.env.local` の中身を丸ごと貼ると、行ごとに分かれて入る）。`APP_URL` は後で Vercel の URL に直す。
3. Deploy。出来た URL（`https://threads-auto-post-xxxx.vercel.app`）でログインできるか確認。
4. `.env.local` の `APP_URL` を Vercel の URL にして、Storage の CORS を設定し直す:
   ```
   npm run storage:setup -- --origin https://threads-auto-post-xxxx.vercel.app
   ```
   Vercel の環境変数の `APP_URL` も同じ値にする（見た目だけなので急がなくてよい）。
5. Vercel の「Settings」→「Cron Jobs」に `vercel.json` の 1 本（毎日 03:00 JST のトークン延長）が出ていることを確認。Hobby プランは 1 日 1 回までなので、5 分おきの処理は次の章で外から叩く。

## 10. 定期実行（5 分おき）— これが無いと自動投稿と予約投稿は出ません
Google Apps Script がいちばん簡単で無料です。`docs/apps-script.md` のコードを新しい Apps Script プロジェクトに貼り、スクリプト プロパティに `BASE_URL`（Vercel の URL）と `CRON_SECRET`（`.env.local` と同じ値）を入れ、時間主導型トリガーを「5 分おき」で `tick` に作る。

GitHub Actions でもよい（`docs/github-actions-tick.yml.example` を `.github/workflows/tick.yml` に置き、リポジトリの Secrets に `CRON_SECRET`、Variables に `APP_URL` を入れる）。GitHub Actions の定期実行は数分遅れることがあります。

画面の「名義の管理」に「最後に動いた時刻」が出るので、動いているか確かめられます。

## 11. 本番にする
`POSTING_MODE=live`（既定）で実際に投稿されます。dry_run で試していたなら Vercel の環境変数を `live` にして Redeploy。

## 困ったとき
- `npm run setup:check` を最初に実行する。
- 画面の「全体状況」の「直近のエラー」に定期実行のエラーが出る。
- 画像・動画の送信で失敗する → `npm run storage:setup -- --origin <画面の URL>` を実行したか確認。
- 「定期実行が動いていません」と出る → 第 10 章の仕組みが動いているか、`CRON_SECRET` が一致しているか確認。
- Firestore の「複合インデックスが必要」というエラーは出ない設計（問い合わせは等値だけ）。
- threads-ops-2 の Firestore・バケット・Apps Script には一切触れない。
