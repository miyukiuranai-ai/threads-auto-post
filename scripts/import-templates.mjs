#!/usr/bin/env node
// 文章をファイルから取り込む（画面の「文章ストック」と同じ）。
// 使い方:
//   npm run templates:import -- --file ./import/texts.txt                 # 全名義共通。「---」の行で区切る
//   npm run templates:import -- --file ./import/texts.txt --account uta001012 --mode blank --tags 朝,占い
//   npm run templates:import -- --file ./import/texts.csv                 # 1列目=本文、2列目=タグ
import { readFileSync } from 'node:fs';
import { loadEnv } from './lib/env.mjs';
import { getDb, COLLECTIONS } from '../lib/server/firebase.mjs';
import { addTemplates, splitTemplates, templatesFromCsv, parseTags } from '../lib/server/templates.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}

async function main() {
  loadEnv();
  const file = arg('file');
  if (!file) throw new Error('--file <パス> を指定してください。');
  const mode = arg('mode', 'separator');
  const tags = parseTags(arg('tags', ''));
  const accountKey = arg('account', '');

  let accountId = null;
  if (accountKey) {
    const snap = await getDb().collection(COLLECTIONS.accounts).get();
    const needle = accountKey.replace(/^@/, '').toLowerCase();
    const account = snap.docs.map((d) => ({ id: d.id, ...d.data() })).find((a) => String(a.name).toLowerCase() === needle || a.id === accountKey);
    if (!account) throw new Error(`名義 ${accountKey} が見つかりません。`);
    accountId = account.id;
  }

  const text = readFileSync(file, 'utf8');
  const items = /\.csv$/i.test(file) ? templatesFromCsv(text) : splitTemplates(text, mode).map((body) => ({ body }));
  if (!items.length) throw new Error('取り込む文章がありません。区切り方（--mode separator|blank|line）を確かめてください。');

  const r = await addTemplates({ items, accountId, tags, createdBy: 'cli' });
  console.log(`${accountId ? `名義 ${accountKey} 用` : '全名義共通'}に ${r.added} 本を登録しました。`);
  for (const s of r.skipped) console.log(`  飛ばした ${s.index}番目: ${s.reason}（${s.preview}…）`);
}

main().catch((err) => {
  console.error('\n失敗しました: ' + err.message);
  process.exit(1);
});
