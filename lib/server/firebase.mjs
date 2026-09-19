// Firestore クライアント（サーバー専用）。
// 環境変数は呼び出し側が用意しておくこと:
//   - Next.js: .env.local を自動で読み込む
//   - コマンド: scripts/lib/env.mjs の loadEnv() を先に呼ぶ
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

/**
 * 秘密鍵の改行表現を正規化する。
 * .env.local や Vercel の入力欄では改行が「バックスラッシュ + n」の2文字で入ることが多く、
 * 生の改行で入ることもある。どちらでも動くように実際の改行へ揃える。
 */
function normalizePrivateKey(key) {
  return key.replaceAll(String.raw`\n`, '\n').trim();
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`環境変数 ${name} が未設定です。docs/SETUP.md の「Firebase」の章を参照してください。`);
  }
  return value;
}

// Next.js はページごとに別のモジュールとして読み込むことがあるので、プロセス全体で1つを共有する
const DB_KEY = Symbol.for('threads-auto-post.firestore');

/** Firestore インスタンスを返す（プロセス内で1つだけ初期化）。 */
export function getDb() {
  if (globalThis[DB_KEY]) return globalThis[DB_KEY];

  const projectId = requireEnv('FIREBASE_PROJECT_ID');
  const clientEmail = requireEnv('FIREBASE_CLIENT_EMAIL');
  const privateKey = normalizePrivateKey(requireEnv('FIREBASE_PRIVATE_KEY'));

  const app =
    getApps()[0] ?? initializeApp({ credential: cert({ projectId, clientEmail, privateKey }), projectId });

  const db = getFirestore(app);
  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch {
    // 既に初期化済みのインスタンスを受け取った場合は設定済みなので無視する
  }

  globalThis[DB_KEY] = db;
  return db;
}

export { FieldValue };

/** 使うコレクション名。 */
export const COLLECTIONS = {
  /** 名義（Threads アカウント）。ドキュメント ID は Threads のユーザー ID */
  accounts: 'accounts',
  /** 文章ストック（自動投稿の元になる本文） */
  templates: 'templates',
  /** 投稿（予約中・投稿済み・失敗など。自動投稿も手動投稿もここ） */
  posts: 'posts',
  /** 定期実行のログ */
  runs: 'runs',
  /** アップロードした画像・動画の記録 */
  media: 'media',
  /** 小さな共有の値（ストックの更新番号など） */
  meta: 'meta',
};
