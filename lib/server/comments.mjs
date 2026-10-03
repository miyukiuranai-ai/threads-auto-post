// 伸びた投稿に付いた返信（コメント）を読み、そこへ返す。
//
// ためておかず、画面を開いたときにそのつど Threads へ聞きにいく。
// 伸びた投稿だけが対象なので、問い合わせは1画面につき1回で済む。
//
// 読むには threads_read_replies、相手の返信へ返すには threads_manage_replies が要る。
// 権限が無いときは、何をすればよいかが分かる文言を返す。
import { getReplies, createReply, isPermissionError, shortError } from './threads.mjs';
import { validateBody } from './templates.mjs';
import { accountProblem, postingMode } from './publish.mjs';

/** 権限が足りないときの案内文。 */
const NEED_READ = 'トークンに threads_read_replies の権限がありません。Meta でこの権限を足して、この名義のトークンを取り直してください';
const NEED_WRITE = 'トークンに threads_manage_replies の権限がありません。Meta でこの権限を足して、この名義のトークンを取り直してください';

/**
 * その投稿に「いま付いている」返信を取る。
 * @returns {Promise<{replies:object[], error:string|null}>}
 */
export async function loadComments({ account, post, limit = 50 }) {
  const problem = accountProblem(account);
  if (problem) return { replies: [], error: problem };
  if (!post?.postedThreadId) return { replies: [], error: 'この投稿はまだ Threads に出ていません。' };

  try {
    const data = await getReplies({ accessToken: account.accessToken, threadId: post.postedThreadId, limit });
    // 自分で足した返信は、相手からのコメントと混ざらないよう後ろに回す
    const mine = String(account.name ?? '').toLowerCase();
    return {
      replies: data.map((r) => ({
        id: String(r.id),
        text: String(r.text ?? ''),
        username: String(r.username ?? ''),
        at: r.timestamp ?? null,
        permalink: r.permalink ?? null,
        hidden: r.hide_status === 'HIDDEN',
        isMine: String(r.username ?? '').toLowerCase() === mine,
      })),
      error: null,
    };
  } catch (err) {
    return { replies: [], error: isPermissionError(err) ? NEED_READ : shortError(err) };
  }
}

/**
 * 相手の返信（コメント）へ返す。
 * 書いた文章がそのまま送られる（ツールが文章を考えることはしない）。
 * @returns {Promise<{ok?:string, error?:string, id?:string}>}
 */
export async function replyToComment({ account, commentId, body }) {
  const text = String(body ?? '').replace(/\r\n?/g, '\n').trim();
  if (!text) return { error: '返信の文章を入れてください。' };

  const problem = validateBody(text);
  if (problem) return { error: problem };

  const tokenProblem = accountProblem(account);
  if (tokenProblem) return { error: tokenProblem };
  if (!commentId) return { error: '返信先が分かりませんでした。画面を開き直してください。' };

  // テスト（送らない）モードのときは、実際には送らない
  if (postingMode() === 'dry_run') {
    return { ok: 'テストモードなので送っていません。', id: 'dry_run' };
  }

  try {
    const published = await createReply({
      accessToken: account.accessToken,
      userId: account.threadsUserId,
      text,
      replyToId: commentId,
    });
    return { ok: '返信しました。', id: published.id };
  } catch (err) {
    return { error: isPermissionError(err) ? NEED_WRITE : `返信を送れませんでした: ${shortError(err)}` };
  }
}
