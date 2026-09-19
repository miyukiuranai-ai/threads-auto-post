// Firestore の読み取りをまとめる層。画面はここだけを使う。
//
// 画面は何度も開かれるので、読み取りを抑える工夫を2段構えで入れている:
//   1. cache()          … 1回の描画のなかで同じ問い合わせを1度にまとめる
//   2. unstable_cache() … 数十秒のあいだ結果を使い回す。操作したときはタグで捨てる
import { cache } from 'react';
import { unstable_cache, revalidateTag } from 'next/cache';
import { getDb, COLLECTIONS } from './firebase.mjs';
import { jstDateKey, jstToIso } from './time.mjs';

const docToObj = (d) => ({ id: d.id, ...d.data() });

/** 結果を使い回す秒数。短くしすぎると読み取りが増える。 */
const CACHE_SECONDS = 30;

export const TAGS = {
  accounts: 'accounts',
  templates: 'templates',
  posts: 'posts',
  runs: 'runs',
};

/** 画面から何か操作したときに、使い回している結果を捨てる。 */
export function invalidate(...tags) {
  for (const tag of tags) revalidateTag(tag);
}

/** 名義一覧（名前順）。トークンは画面へ渡さない。 */
export const listAccounts = cache(
  unstable_cache(
    async () => {
      const snap = await getDb().collection(COLLECTIONS.accounts).get();
      return snap.docs
        .map(docToObj)
        .map(({ accessToken, ...rest }) => ({ ...rest, hasToken: Boolean(accessToken) }))
        .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
    },
    ['accounts'],
    { revalidate: CACHE_SECONDS, tags: [TAGS.accounts] }
  )
);

/** 名義1件（トークン込み。サーバーアクションの中だけで使う）。 */
export async function getAccountWithToken(id) {
  const snap = await getDb().collection(COLLECTIONS.accounts).doc(String(id)).get();
  return snap.exists ? docToObj(snap) : null;
}

/** 文章ストック（全件。並べ替えは登録順）。 */
export const listTemplates = cache(
  unstable_cache(
    async () => {
      const snap = await getDb().collection(COLLECTIONS.templates).get();
      return snap.docs.map(docToObj).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    },
    ['templates'],
    { revalidate: CACHE_SECONDS, tags: [TAGS.templates] }
  )
);

/**
 * 投稿の一覧。
 * 名義を指定したときはその名義の直近、指定しなければ全体の直近。新しい順。
 */
export const listPosts = cache(
  unstable_cache(
    async (accountId, limit = 300) => {
      let query = getDb().collection(COLLECTIONS.posts);
      let snap;
      if (accountId) {
        snap = await query.where('accountId', '==', accountId).limit(limit).get();
      } else {
        snap = await query.orderBy('createdAt', 'desc').limit(limit).get();
      }
      const key = (p) => String(p.scheduledAt ?? p.createdAt ?? '');
      return snap.docs.map(docToObj).sort((a, b) => key(b).localeCompare(key(a)));
    },
    ['posts'],
    { revalidate: CACHE_SECONDS, tags: [TAGS.posts] }
  )
);

/** 今日（日本時間）投稿した分。名義ごとの件数の集計に使う。 */
export const listPostedToday = cache(
  unstable_cache(
    async () => {
      const start = jstToIso(jstDateKey(), '00:00');
      const snap = await getDb().collection(COLLECTIONS.posts).where('postedAt', '>=', start).limit(1000).get();
      return snap.docs.map(docToObj);
    },
    ['posted-today'],
    { revalidate: CACHE_SECONDS, tags: [TAGS.posts] }
  )
);

/** 状態ごとの件数（予約中・投稿中・失敗）。 */
export const countPostsByStatus = cache(
  unstable_cache(
    async () => {
      const db = getDb();
      const out = {};
      for (const status of ['scheduled', 'publishing', 'failed']) {
        try {
          out[status] = (await db.collection(COLLECTIONS.posts).where('status', '==', status).count().get()).data().count;
        } catch {
          out[status] = 0;
        }
      }
      return out;
    },
    ['post-counts'],
    { revalidate: CACHE_SECONDS, tags: [TAGS.posts] }
  )
);

/** 定期実行のログ（新しい順）。 */
export const listRuns = cache(
  unstable_cache(
    async (limit = 20) => {
      const snap = await getDb().collection(COLLECTIONS.runs).orderBy('startedAt', 'desc').limit(limit).get();
      return snap.docs.map(docToObj);
    },
    ['runs'],
    { revalidate: CACHE_SECONDS, tags: [TAGS.runs] }
  )
);

/** 直近のエラーだけ抜き出す。 */
export async function listRecentErrors({ limit = 5 } = {}) {
  const runs = await listRuns(30);
  return runs.filter((r) => r.status === 'failed').slice(0, limit);
}

/** 最後に定期実行が動いた時刻（動いているかの確認用）。 */
export async function lastRunAt() {
  const runs = await listRuns(1);
  return runs[0]?.finishedAt ?? null;
}

/** トークン失効までの残日数。期限が無ければ null。 */
export function daysUntil(iso) {
  if (!iso) return null;
  return Math.floor((new Date(iso).getTime() - Date.now()) / 86400000);
}
