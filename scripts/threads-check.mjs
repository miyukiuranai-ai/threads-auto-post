#!/usr/bin/env node
// トークンで何ができるかを、実際に叩いて確かめる。
//
// 権限を足してトークンを取り直したあとに実行すると、
// 「他人の投稿を集められるのか」「いいね数は取れるのか」が分かる。
//
// 使い方:
//   npm run threads:check
//   npm run threads:check -- --account mizuki_uranai_   （名義をしぼる）
//   npm run threads:check -- --query 占い               （キーワード検索で試す語）
//   npm run threads:check -- --profile someone          （プロフィールを見たい相手）
import { loadEnv } from './lib/env.mjs';
import { getDb, COLLECTIONS } from '../lib/server/firebase.mjs';
import {
  getMe,
  listMyThreads,
  getThreadInsights,
  parseInsights,
  keywordSearch,
  profileLookup,
  shortError,
} from '../lib/server/threads.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}

const OK = '✓';
const NG = '✗';

/** 1つ試して、結果を1行で出す。 */
async function probe(label, need, fn) {
  try {
    const note = await fn();
    console.log(`  ${OK} ${label.padEnd(22)} ${note ?? ''}`);
    return true;
  } catch (err) {
    console.log(`  ${NG} ${label.padEnd(22)} ${shortError(err)}`);
    console.log(`      ${need}`);
    return false;
  }
}

async function main() {
  loadEnv();
  const db = getDb();
  const only = arg('account', '')?.replace(/^@/, '').toLowerCase();
  const query = arg('query', '占い');
  const profile = arg('profile', '');

  const snap = await db.collection(COLLECTIONS.accounts).get();
  let accounts = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((a) => a.accessToken);
  if (only) accounts = accounts.filter((a) => String(a.name).toLowerCase() === only);

  if (!accounts.length) {
    console.log('名義が見つかりません。画面の「名義の管理」でトークンを登録してください。');
    return;
  }

  for (const account of accounts) {
    console.log(`\n=== @${account.name} ===`);
    const accessToken = account.accessToken;

    await probe('自分のプロフィール', 'threads_basic が要ります', async () => {
      const me = await getMe({ accessToken, fields: 'id,username' });
      return `@${me.username}`;
    });

    let threadId = null;
    await probe('自分の投稿の一覧', 'threads_basic が要ります', async () => {
      const res = await listMyThreads({ accessToken, userId: account.threadsUserId, limit: 5 });
      threadId = res.data?.[0]?.id ?? null;
      return `${res.data?.length ?? 0}件`;
    });

    if (threadId) {
      await probe('いいね数（インサイト）', 'threads_manage_insights を足してトークンを取り直してください', async () => {
        const values = parseInsights(await getThreadInsights({ accessToken, threadId }));
        return `いいね ${values.likes ?? '-'} / 表示 ${values.views ?? '-'}`;
      });
    } else {
      console.log(`  － いいね数（インサイト）     投稿がまだ無いので試せません`);
    }

    await probe('公開投稿の検索', 'threads_keyword_search を足してトークンを取り直してください（審査が要る場合あり）', async () => {
      const res = await keywordSearch({ accessToken, query, limit: 5 });
      const names = [...new Set((res.data ?? []).map((p) => p.username).filter(Boolean))];
      return `「${query}」で ${res.data?.length ?? 0}件${names.length ? `（${names.slice(0, 3).join('・')}…）` : ''}`;
    });

    if (profile) {
      await probe('他人のプロフィール', 'threads_profile_discovery を足してトークンを取り直してください（審査が要る場合あり）', async () => {
        const res = await profileLookup({ accessToken, username: profile.replace(/^@/, '') });
        return `@${res.username} フォロワー ${res.follower_count ?? '-'}`;
      });
    } else {
      console.log('  － 他人のプロフィール         --profile ユーザー名 を付けると試せます');
    }
  }

  console.log('\n✗ が出た行の下に、何を足せばよいかを書いています。');
  console.log('権限を足したら、必ず全名義のトークンを取り直してください（既存のトークンに後から権限は付きません）。');
}

main().catch((err) => {
  console.error('\n失敗しました: ' + err.message);
  process.exit(1);
});
