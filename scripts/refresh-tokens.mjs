#!/usr/bin/env node
// 全名義のトークンをいま延長する。使い方: npm run token:refresh [-- --all]
import { loadEnv } from './lib/env.mjs';
import { refreshTokens } from '../lib/server/tokens.mjs';

async function main() {
  loadEnv();
  const r = await refreshTokens({ all: process.argv.includes('--all') });
  for (const x of r.results) console.log(`@${x.account}: ${x.result}${x.daysLeft != null ? `（残り ${x.daysLeft} 日）` : ''}${x.reason ? ` … ${x.reason}` : ''}`);
}

main().catch((err) => {
  console.error('\n失敗しました: ' + err.message);
  process.exit(1);
});
