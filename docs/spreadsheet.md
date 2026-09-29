# スプレッドシートで成果を見る

投稿の **30分後** と **1時間後** のいいね数を自動で記録し、スプレッドシートに書き出します。
どの名義・どの属性の投稿が伸びたかを、表で見られるようにするためです。

## 0. 先に必要なこと（これをやらないと、いいね数が取れません）

いいね数を取るには、トークンに `threads_manage_insights` の権限が要ります。**既存のトークンには後から権限が付かない**ので、権限を足してから取り直します。

1. https://developers.facebook.com/apps → このツール用のアプリを開く。
2. 左メニュー「ユースケース」→ Threads の「カスタマイズ」。
3. `threads_manage_insights` の行の「**追加**」を押す。
4. **全名義のトークンを取り直す**（シークレットウィンドウでその名義にログイン → ユーザートークン生成ツール → 生成 → コピー）。
5. 画面の「名義の管理」に貼り付ける。1行に1つずつ貼れば、まとめて入れ替えられます。

取り直さないと、画面の「いいねが伸びた投稿」に「トークンに threads_manage_insights の権限がありません」と赤く出ます。

## 1. 記録は自動で行われます

5分おきの定期実行が、投稿の30分後・1時間後にいいね数と表示数を記録します。設定は要りません。

記録した結果は次の2か所で見られます。

- **全体状況** の「いいねが伸びた投稿」… 直近24時間で、いいね30以上に届いた投稿の一覧
- **投稿の予定と履歴** の各行 … その投稿の「30分後 / 1時間後」のいいね数と表示数

目標のいいね数（既定30）を変えるには、Vercel の環境変数に `LIKE_TARGET` を入れて再デプロイします。

## 2. スプレッドシートに出す

Google Apps Script で読み込みます。定期実行に使っているプロジェクトに、次の関数を**足して**ください（`tick` はそのまま残します）。

```js
function writeReport() {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('BASE_URL')
    + '/api/report?hours=48&key=' + encodeURIComponent(props.getProperty('CRON_SECRET'));

  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    Logger.log('失敗 ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 300));
    return;
  }

  const report = JSON.parse(res.getContentText());
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('成果')
    || SpreadsheetApp.getActiveSpreadsheet().insertSheet('成果');

  sheet.clearContents();
  const rows = [report.header].concat(report.rows);
  sheet.getRange(1, 1, rows.length, report.header.length).setValues(rows);
  sheet.setFrozenRows(1);
  Logger.log(report.rows.length + ' 行を書きました');
}
```

**手順**

1. スプレッドシートを新しく作る（https://sheets.new）。
2. そのシートの「拡張機能」→「Apps Script」を開く。**シートに紐づいたプロジェクト**になります。
3. 上のコードを貼り、「プロジェクトの設定」→「スクリプト プロパティ」に `BASE_URL` と `CRON_SECRET` を入れる（定期実行のプロジェクトと同じ値）。
4. `writeReport` を手で1回実行して、シートに行が入るか確かめる。初回は承認が要ります。
5. トリガーを足す（`writeReport`、時間主導型、1時間おき など）。

実行するたびに「成果」シートが書き換わります。履歴を残したいときは `sheet.clearContents()` の行を消して `sheet.appendRow(...)` に変えるなど、ご自身で調整してください。

## 3. いいね30以上だけを出す

URL に `minLikes` を足すと、そのいいね数以上の投稿だけになります。

```
/api/report?hours=48&minLikes=30&key=...
```

伸びた投稿だけを別のシートに出したいときに使えます。

## 4. 関数を使わずに読む方法（IMPORTDATA）

Apps Script を使わず、シートのセルに直接書く方法もあります。

```
=IMPORTDATA("https://threads-auto-post-xxxx.vercel.app/api/report?format=csv&hours=48&key=あなたのCRON_SECRET")
```

手軽ですが、**シートを見られる人に鍵が見えてしまいます。** 自分だけで使うシート以外では使わないでください。

## 出てくる列

| 列 | 中身 |
| --- | --- |
| 投稿日時 | 日本時間 |
| 名義 | @なしのユーザー名 |
| 属性 | 看護師・シンママなど |
| 30分後のいいね / 1時間後のいいね | 記録できた数。空欄はまだ記録前 |
| 30分後の表示 / 1時間後の表示 | 表示回数 |
| 目標到達 | いいね30以上に届いた時点。届いていなければ空欄 |
| 本文 | 実際に投稿された文章（改行は空白に置き換え） |
| リンク | Threads の投稿へのリンク |
| 記録の問題 | いいね数を取れなかった理由 |
