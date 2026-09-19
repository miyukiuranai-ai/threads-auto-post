#!/usr/bin/env node
// 接続を一つずつ確かめる。npm run setup:check
import { loadEnv } from './lib/env.mjs';

const OK = '✓';
const NG = '✗';
const results = [];
function row(name, ok, note = '') {
  results.push(`${ok ? OK : NG} ${name}${note ? `  … ${note}` : ''}`);
  return ok;
}
function withTimeout(p, ms = 20000, what = '') {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} が ${ms / 1000} 秒以内に応答しない（接続先・鍵・ネットワークを確認）`)), ms))]);
}
function hint(e) {
  const m = String(e.message || e);
  if (/PERMISSION_DENIED|permission/i.test(m)) return `権限がない: ${m.slice(0, 120)}`;
  if (/NOT_FOUND|does not exist/i.test(m)) return `見つからない: ${m.slice(0, 120)}（Firestore / Storage を有効化したか、名前が合っているか）`;
  if (/DECODER|PEM|private key/i.test(m)) return `鍵の形が不正: ${m.slice(0, 100)}（npm run env:init -- --sa ファイル で入れ直す）`;
  if (/401|403|invalid.*key|authentication|UNAUTHENTICATED/i.test(m)) return `認証に失敗: ${m.slice(0, 120)}`;
  return m.slice(0, 160);
}

async function main() {
  try {
    loadEnv();
  } catch (e) {
    row('.env.local', false, e.message.split('\n')[0]);
  }
  const required = ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY', 'ADMIN_PASSWORD', 'SESSION_SECRET', 'CRON_SECRET'];
  for (const k of required) row(`環境変数 ${k}`, Boolean(process.env[k]), process.env[k] ? '' : '.env.local に入れる（npm run env:init が作る）');
  row('環境変数 FIREBASE_STORAGE_BUCKET', true, process.env.FIREBASE_STORAGE_BUCKET || `未指定（${process.env.FIREBASE_PROJECT_ID}.firebasestorage.app を使う）`);
  row('POSTING_MODE', true, `${process.env.POSTING_MODE || 'live'}（dry_run にすると Threads に送らない）`);

  let db = null;
  try {
    const { getDb } = await import('../lib/server/firebase.mjs');
    db = getDb();
    const ref = db.collection('_healthcheck').doc('setup-check');
    await withTimeout(ref.set({ at: new Date().toISOString() }), 20000, 'Firestore');
    await withTimeout(ref.delete(), 20000, 'Firestore');
    row('Firestore 読み書き', true, `project ${process.env.FIREBASE_PROJECT_ID}`);
  } catch (e) {
    db = null;
    row('Firestore 読み書き', false, hint(e));
  }

  try {
    const { getBucket } = await import('../lib/server/storage.mjs');
    const bucket = getBucket();
    const [exists] = await withTimeout(bucket.exists(), 20000, 'Storage');
    row('Storage バケット', exists, exists ? bucket.name : `バケット ${bucket.name} が見つからない（Firebase コンソール → Storage を有効化。名前が違えば FIREBASE_STORAGE_BUCKET に）`);
    if (exists) {
      const [meta] = await withTimeout(bucket.getMetadata(), 20000, 'Storage');
      row('Storage CORS（画像・動画の送信に必要）', Boolean(meta?.cors?.length), meta?.cors?.length ? '設定済み' : 'npm run storage:setup を実行');
    }
  } catch (e) {
    row('Storage バケット', false, `${hint(e)}（画像・動画を使わないなら無くても動く）`);
  }

  if (db) {
    try {
      const { getMe } = await import('../lib/server/threads.mjs');
      const accSnap = await db.collection('accounts').get();
      const accounts = accSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (!accounts.length) row('名義', false, 'まだ 0 件。画面の「名義の管理」でトークンを貼って追加');
      for (const a of accounts) {
        if (!a.accessToken) {
          row(`名義 @${a.name}`, false, 'トークン未登録');
          continue;
        }
        try {
          const me = await withTimeout(getMe({ accessToken: a.accessToken, fields: 'id,username' }), 20000, 'Threads');
          const days = a.tokenExpiresAt ? Math.floor((new Date(a.tokenExpiresAt) - Date.now()) / 86400000) : '?';
          row(`名義 @${a.name}`, true, `Threads ID ${me.id}、トークン残り ${days} 日、状態 ${a.status ?? 'active'}`);
        } catch (e) {
          row(`名義 @${a.name}`, false, hint(e));
        }
      }
      const templates = await db.collection('templates').count().get();
      row('文章ストック', templates.data().count > 0, templates.data().count ? `${templates.data().count} 本` : '画面の「文章ストック」で取り込む（無くても今すぐ投稿・予約はできる）');
    } catch (e) {
      row('名義の確認', false, hint(e));
    }
  }

  console.log(results.join('\n'));
  const ng = results.filter((r) => r.startsWith(NG)).length;
  console.log(ng ? `\n${ng} 件が未完了です。` : '\nすべて通りました。');
  process.exit(0);
}
main().catch((e) => {
  console.error('エラー:', e.message);
  process.exit(1);
});
