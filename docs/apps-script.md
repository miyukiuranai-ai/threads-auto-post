# Google Apps Script の 5 分おきトリガー

新しい Apps Script プロジェクト（https://script.google.com → 新しいプロジェクト）に次を貼り、
「プロジェクトの設定」→「スクリプト プロパティ」に `BASE_URL`（Vercel の URL。末尾のスラッシュなし）と `CRON_SECRET`（`.env.local` と同じ値）を入れる。
「トリガー」→「トリガーを追加」で、関数 `tick`、時間主導型、「分ベースのタイマー」、「5 分おき」。

```js
function tick() {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('BASE_URL') + '/api/cron/tick?key=' + encodeURIComponent(props.getProperty('CRON_SECRET'));
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  Logger.log('tick ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 300));
}
```

一度 `tick` を手で実行して、ログに `200` と出れば動いています。
threads-ops-2 の Apps Script とは別のプロジェクトにしてください（触らない）。
