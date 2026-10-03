// 伸びた投稿へ、自分で考えた返信を送る。
//
// 自動返信（auto-reply.mjs）とは別のもので、こちらは人が書いた文章をそのまま送る。
// 画面からも定期実行からも同じ手順になるよう、送る中身はここにまとめている。
import { getDb, COLLECTIONS } from './firebase.mjs';
import { createReply, shortError } from './threads.mjs';
import { validateBody } from './templates.mjs';
import { accountProblem, postingMode } from './publish.mjs';

/**
 * 1件の投稿へ返信を送り、記録を残す。
 * 同じ投稿に何度でも返せる（送ったぶんは `replies` に積み上がる）。
 *
 * @param {object} opts
 * @param {object} opts.post     返信先の投稿（Firestore の中身）
 * @param {object} opts.account  トークン込みの名義
 * @param {string} opts.body     送る文章（人が書いたもの）
 * @param {string} [opts.by]     送った人の名前（記録用）
 * @returns {Promise<{ok?:string, error?:string}>}
 */
export async function sendManualReply({ db = getDb(), post, account, body, by = null }) {
  const text = String(body ?? '').replace(/\r\n?/g, '\n').trim();
  if (!text) return { error: '返信の文章を入れてください。' };

  const problem = validateBody(text);
  if (problem) return { error: problem };

  if (!post || post.status !== 'posted' || !post.postedThreadId) {
    return { error: 'まだ投稿されていないものには返信できません。' };
  }

  const tokenProblem = accountProblem(account);
  if (tokenProblem) return { error: tokenProblem };

  // テスト（送らない）モードのときは、実際には送らずに記録だけ残す
  const dryRun = postingMode() === 'dry_run';
  let replyId = 'dry_run';
  if (!dryRun) {
    try {
      const published = await createReply({
        accessToken: account.accessToken,
        userId: account.threadsUserId,
        text,
        replyToId: post.postedThreadId,
      });
      replyId = published.id;
    } catch (err) {
      return { error: `返信を送れませんでした: ${shortError(err)}` };
    }
  }

  const entry = { id: replyId, body: text, at: new Date().toISOString(), by, dryRun };
  const replies = [...(Array.isArray(post.replies) ? post.replies : []), entry];
  await db.collection(COLLECTIONS.posts).doc(post.id).set({ replies }, { merge: true });

  return { ok: dryRun ? 'テストモードなので送っていません（記録だけ残しました）。' : '返信しました。' };
}
