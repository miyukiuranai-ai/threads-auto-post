'use server';

import { revalidatePath } from 'next/cache';
import { getDb, COLLECTIONS } from '@/lib/server/firebase.mjs';
import { getCurrentUser, filterAccountsForUser } from '@/lib/server/auth.mjs';
import { listAccounts, getAccountWithToken } from '@/lib/server/repo.mjs';
import { replyToComment } from '@/lib/server/comments.mjs';

/**
 * 伸びた投稿に付いたコメントへ返す。
 * formData: postId, commentId, body
 */
export async function sendCommentReply(formData) {
  try {
    const user = await getCurrentUser();
    const postId = String(formData.get('postId') ?? '');

    const snap = await getDb().collection(COLLECTIONS.posts).doc(postId).get();
    if (!snap.exists) return { error: 'その投稿は見つかりませんでした。' };
    const post = { id: snap.id, ...snap.data() };

    const allowed = filterAccountsForUser(await listAccounts(), user);
    if (!allowed.some((a) => a.id === post.accountId)) return { error: 'この投稿を操作する権限がありません。' };

    const account = await getAccountWithToken(post.accountId);
    const result = await replyToComment({
      account,
      commentId: String(formData.get('commentId') ?? ''),
      body: formData.get('body'),
    });

    if (result.ok) revalidatePath('/replies');
    return result;
  } catch (err) {
    return { error: err.message };
  }
}
