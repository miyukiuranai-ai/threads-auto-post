'use server';

import { revalidatePath } from 'next/cache';
import { getDb, COLLECTIONS } from '@/lib/server/firebase.mjs';
import { getCurrentUser, filterAccountsForUser } from '@/lib/server/auth.mjs';
import { listAccounts, getAccountWithToken, invalidate, TAGS } from '@/lib/server/repo.mjs';
import { publishPost } from '@/lib/server/publish.mjs';
import { deleteThread, shortError } from '@/lib/server/threads.mjs';
import { validateBody } from '@/lib/server/templates.mjs';
import { fromLocalInput } from '@/lib/server/time.mjs';

/** その投稿を触ってよいか確かめ、投稿と名義を返す。 */
async function loadPost(postId) {
  const user = await getCurrentUser();
  const snap = await getDb().collection(COLLECTIONS.posts).doc(String(postId)).get();
  if (!snap.exists) throw new Error('その投稿は見つかりませんでした。');

  const post = { id: snap.id, ...snap.data() };
  const accounts = filterAccountsForUser(await listAccounts(), user);
  const account = accounts.find((a) => a.id === post.accountId);
  if (!account) throw new Error('この投稿を操作する権限がありません。');
  return { post, account, user };
}

function refresh() {
  invalidate(TAGS.posts, TAGS.accounts);
  revalidatePath('/posts');
  revalidatePath('/');
}

/** 予約を取り消す（記録は「取消」として残す）。 */
export async function cancelPost(formData) {
  const { post } = await loadPost(formData.get('postId'));
  if (!['scheduled', 'failed'].includes(post.status)) return;
  await getDb().collection(COLLECTIONS.posts).doc(post.id).set({ status: 'canceled', canceledAt: new Date().toISOString() }, { merge: true });
  refresh();
}

/** 予約の時刻を変える。 */
export async function reschedulePost(formData) {
  const { post } = await loadPost(formData.get('postId'));
  const scheduledAt = fromLocalInput(formData.get('scheduledAtLocal'));
  if (!scheduledAt) return;
  await getDb()
    .collection(COLLECTIONS.posts)
    .doc(post.id)
    .set({ scheduledAt, status: 'scheduled', error: null, editedAt: new Date().toISOString() }, { merge: true });
  refresh();
}

/** 予約中の本文を書き換える。 */
export async function updatePostBody(formData) {
  const { post } = await loadPost(formData.get('postId'));
  const body = String(formData.get('body') ?? '').replace(/\r\n?/g, '\n');
  const hasMedia = Array.isArray(post.media) && post.media.length > 0;
  if (!hasMedia && validateBody(body)) return;
  if (!['scheduled', 'failed', 'missed', 'canceled'].includes(post.status)) return;
  await getDb().collection(COLLECTIONS.posts).doc(post.id).set({ body, editedAt: new Date().toISOString() }, { merge: true });
  refresh();
}

/** 失敗・時刻切れ・取消の投稿を、いま送り直す。 */
export async function retryPostNow(formData) {
  try {
    const { post, account } = await loadPost(formData.get('postId'));
    if (!['failed', 'missed', 'canceled', 'scheduled'].includes(post.status)) return { error: 'この投稿は送り直せません。' };

    const ref = getDb().collection(COLLECTIONS.posts).doc(post.id);
    await ref.set({ status: 'scheduled', scheduledAt: new Date().toISOString(), error: null, containerId: null, retriedAt: new Date().toISOString() }, { merge: true });

    const full = await getAccountWithToken(account.id);
    const r = await publishPost({ account: full, post: { ...post, containerId: null }, budgetMs: 45_000 });
    refresh();
    if (r.result === 'failed') return { error: `失敗: ${r.reason}` };
    return { ok: r.result === 'pending' ? '準備待ちです。数分後に自動で公開されます。' : '投稿しました。' };
  } catch (err) {
    return { error: err.message };
  }
}

/** 記録を消す（Threads 側には触らない）。 */
export async function deletePostRecord(formData) {
  const { post } = await loadPost(formData.get('postId'));
  if (['scheduled', 'publishing'].includes(post.status)) return;
  await getDb().collection(COLLECTIONS.posts).doc(post.id).delete();
  refresh();
}

/** 投稿済みのものを Threads から削除する。 */
export async function deleteFromThreads(formData) {
  try {
    const { post, account } = await loadPost(formData.get('postId'));
    if (post.status !== 'posted' || !post.postedThreadId || post.dryRun) return { error: '削除できる投稿ではありません。' };
    const full = await getAccountWithToken(account.id);
    await deleteThread({ accessToken: full.accessToken, threadId: post.postedThreadId });
    await getDb()
      .collection(COLLECTIONS.posts)
      .doc(post.id)
      .set({ status: 'deleted', deletedAt: new Date().toISOString() }, { merge: true });
    refresh();
    return { ok: 'Threads から削除しました。' };
  } catch (err) {
    return { error: shortError(err) };
  }
}
