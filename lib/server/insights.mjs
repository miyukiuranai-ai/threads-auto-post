// 投稿の反応（いいね数など）を、決まった時間が経ったところで記録する。
//
// 投稿の30分後と1時間後にいいねがいくつ付いたかを見たい、という運用のため。
// 定期実行（5分おき）のたびに、時間が来た投稿だけ Threads に問い合わせる。
//
// いいね数を取るには、トークンに threads_manage_insights の権限が要る。
// 権限が無い場合は理由を記録して、次の回からは同じ名義に何度も聞きにいかない。
import { getDb, COLLECTIONS } from './firebase.mjs';
import { getThreadInsights, parseInsights, isPermissionError, shortError } from './threads.mjs';
import { SNAP_POINTS, DEFAULT_LIKE_TARGET, reachedTarget, bestLikes } from '../shared/snapshots.mjs';

export { SNAP_POINTS, reachedTarget, bestLikes };

/** これだけ遅れたらもう記録しない（定期実行が長く止まっていた場合）。 */
const GIVE_UP_MINUTES = 180;

/** 「よく伸びた」とみなすいいね数。環境変数で変えられる。 */
export function likeTarget() {
  const n = Number(process.env.LIKE_TARGET);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : DEFAULT_LIKE_TARGET;
}

/**
 * 30分後に目標のいいね数を超えた名義の ID を返す。
 * 「どの名義が当たったか」だけを目で確かめたいので、名前だけを重なりなく返す。
 */
export function hitAccountNames({ posts, accounts, target = likeTarget(), point = 'snap30' }) {
  const names = new Map((accounts ?? []).map((a) => [a.id, a.name]));
  const hit = (posts ?? [])
    .filter((p) => !p.dryRun && (p[point]?.likes ?? 0) >= target)
    .map((p) => names.get(p.accountId))
    .filter(Boolean);
  return [...new Set(hit)];
}

/** 1回の定期実行で問い合わせる上限（時間を使いすぎないように）。 */
const MAX_CALLS = 60;

/** 何分前に投稿されたか。 */
function minutesSince(iso) {
  return (Date.now() - new Date(iso).getTime()) / 60000;
}

/**
 * 時間が来た投稿の反応を記録する。
 * @param {object} opts
 * @param {object[]} opts.accounts  トークン込みの名義
 * @param {number} [opts.deadline]  この時刻（ms）までに終える
 */
export async function takeSnapshots({ accounts, deadline = Date.now() + 60_000 }) {
  const db = getDb();

  // 直近に投稿したものだけを見る。postedAt の1条件だけなので、複合インデックスは要らない
  const cutoff = new Date(Date.now() - (GIVE_UP_MINUTES + 10) * 60000).toISOString();
  const snap = await db.collection(COLLECTIONS.posts).where('postedAt', '>=', cutoff).limit(300).get();

  const accountMap = new Map(accounts.map((a) => [a.id, a]));
  const results = [];
  const noPermission = new Set();
  let calls = 0;

  for (const doc of snap.docs) {
    if (calls >= MAX_CALLS || Date.now() > deadline) break;

    const post = { id: doc.id, ...doc.data() };
    if (post.status !== 'posted' || post.dryRun || !post.postedThreadId) continue;

    const age = minutesSince(post.postedAt);
    const due = SNAP_POINTS.filter((p) => !post[p.key] && age >= p.minutes && age < p.minutes + GIVE_UP_MINUTES);
    if (!due.length) continue;

    const account = accountMap.get(post.accountId);
    if (!account?.accessToken) continue;
    if (noPermission.has(account.id)) continue;

    try {
      const res = await getThreadInsights({ accessToken: account.accessToken, threadId: post.postedThreadId });
      calls += 1;
      const values = parseInsights(res);
      const now = new Date().toISOString();

      const update = {};
      for (const point of due) {
        update[point.key] = {
          likes: values.likes ?? 0,
          views: values.views ?? 0,
          replies: values.replies ?? 0,
          at: now,
          // 予定より遅れて取った場合に分かるようにしておく
          lateMinutes: Math.round(age - point.minutes),
        };
      }
      update.insightsError = null;
      await doc.ref.set(update, { merge: true });

      results.push({
        account: account.name,
        postId: post.id,
        points: due.map((p) => p.label),
        likes: values.likes ?? 0,
      });
    } catch (err) {
      calls += 1;
      const reason = isPermissionError(err)
        ? 'トークンに threads_manage_insights の権限がありません。Meta で権限を足してトークンを取り直してください'
        : shortError(err);

      if (isPermissionError(err)) noPermission.add(account.id);
      await doc.ref.set({ insightsError: reason }, { merge: true });
      results.push({ account: account.name, postId: post.id, error: reason });
    }
  }

  return results;
}
