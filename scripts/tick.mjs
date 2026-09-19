#!/usr/bin/env node
// 定期実行を手元で1回ぶん動かす（自動投稿の枠・予約投稿の送信・1日1回の手入れ）。
// 使い方: npm run tick
import { loadEnv } from './lib/env.mjs';
import { runTick } from '../lib/server/tick.mjs';

async function main() {
  loadEnv();
  const r = await runTick({ budgetMs: 270_000 });
  console.log(`モード: ${r.mode}`);
  console.log('自動投稿:', JSON.stringify(r.autoSummary));
  for (const a of r.auto) console.log(`  @${a.account} ${a.kind} ${a.result}${a.at ? ` ${a.at}` : ''}${a.reason ? ` … ${a.reason}` : ''}`);
  console.log('送信:', JSON.stringify(r.summary));
  for (const p of r.published) console.log(`  @${p.account} ${p.result}${p.permalink ? ` ${p.permalink}` : ''}${p.reason ? ` … ${p.reason}` : ''}`);
  if (r.daily) console.log('1日1回の手入れ:', JSON.stringify(r.daily));
}

main().catch((err) => {
  console.error('\n失敗しました: ' + err.message);
  process.exit(1);
});
