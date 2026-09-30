// 伸びた投稿に、自分で返信を足す。
//
// 30分後にいいねが目標に届いた投稿だけを対象にする。
// 返信の文章は「文章ストック」の中の『返信用』から取り出すので、
// 属性での出し分けも {属性} の差し込みも、普通の投稿と同じように効く。
//
// 同じ投稿に二度返信しないよう、送る前に印を付けてから送る。
import { getDb, COLLECTIONS } from './firebase.mjs';
import { createReply, shortError } from './threads.mjs';
import { pickTemplate, validateBody } from './templates.mjs';
import { fillProfile, attributeOf } from './profile.mjs';
import { likeTarget } from './insights.mjs';
import { accountProblem, postingMode, CLAIM_TIMEOUT_MS } from './publish.mjs';

/** いつ返信するか。 */
export const REPLY_TRIGGERS = {
  snap30: '30分後に届いたら',
  any: '30分後か1時間後に届いたら',
};

/** 目標に届いてから、何分後まで返信してよいか（遅れて気づいた分を延々と送らない）。 */
const GIVE_UP_MINUTES = 6 * 60;

/** 1回の定期実行で送る上限。 */
const MAX_PER_TICK = 20;

/** その名義の自動返信の設定。 */
export function replySettings(account) {
  const r = account?.schedule?.autoReply ?? {};
  return {
    enabled: Boolean(r.enabled),
    trigger: r.trigger === 'any' ? 'any' : 'snap30',
  };
}

/** その投稿が返信の対象か。対象ならどの時点で届いたかを返す。 */
export function replyDue(post, { trigger, target }) {
  if ((post.snap30?.likes ?? 0) >= target) return '30分後';
  if (trigger === 'any' && (post.snap60?.likes ?? 0) >= target) return '1時間後';
  return null;
}

/**
 * 伸びた投稿に返信を送る。
 * @param {object[]} opts.accounts トークン込みの名義
 * @param {number} opts.deadline  この時刻（ms）までに終える
 */
export async function runAutoReplies({ accounts, deadline = Date.now() + 60_000 }) {
  const db = getDb();
  const target = likeTarget();
  const results = [];

  // 自動返信を使う名義だけに絞る
  const targets = accounts.filter((a) => (a.status ?? 'active') !== 'paused' && replySettings(a).enabled);
  if (!targets.length) return results;

  // 直近に投稿したものだけを見る（postedAt の1条件だけなので複合インデックスは要らない）
  const cutoff = new Date(Date.now() - (GIVE_UP_MINUTES + 60) * 60000).toISOString();
  const snap = await db.collection(COLLECTIONS.posts).where('postedAt', '>=', cutoff).limit(300).get();

  // 属性ごとの言い回し（{属性} などの差し込みに使う）
  const wordsSnap = await db.collection(COLLECTIONS.attributes).get();
  const wordsByAttribute = {};
  for (const doc of wordsSnap.docs) wordsByAttribute[doc.id] = doc.data().words ?? {};
  const wordsFor = (account) => wordsByAttribute[attributeOf(account)] ?? null;

  const byId = new Map(targets.map((a) => [a.id, a]));
  let sent = 0;

  for (const doc of snap.docs) {
    if (sent >= MAX_PER_TICK || Date.now() > deadline) break;

    const post = { id: doc.id, ...doc.data() };
    if (post.status !== 'posted' || post.dryRun || !post.postedThreadId) continue;
    if (post.replyThreadId || post.replySkipped) continue; // もう送った・見送った

    const account = byId.get(post.accountId);
    if (!account) continue;

    const settings = replySettings(account);
    const when = replyDue(post, { trigger: settings.trigger, target });
    if (!when) continue;

    const problem = accountProblem(account);
    if (problem) {
      results.push({ account: account.name, postId: post.id, result: 'failed', reason: problem });
      continue;
    }

    // 送る前に印を付ける。同時に走った実行が同じ投稿に二度返信しないようにする
    const claimed = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(doc.ref);
      if (!fresh.exists) return false;
      const data = fresh.data();
      if (data.replyThreadId || data.replySkipped) return false;
      // 途中で止まったときのために、古い印は無かったことにする
      const claimed = data.replyClaimedAt ? new Date(data.replyClaimedAt).getTime() : 0;
      if (claimed && Date.now() - claimed < CLAIM_TIMEOUT_MS) return false;
      tx.set(doc.ref, { replyClaimedAt: new Date().toISOString() }, { merge: true });
      return true;
    }).catch(() => false);
    if (!claimed) continue;

    // 返信用の文章を1本取り出す（この名義で差し込めるものだけ）
    let problemText = null;
    const template = await pickTemplate({
      db,
      account,
      kind: 'reply',
      accept: (t) => {
        const check = fillProfile(t.body, account, wordsFor(account));
        if (check.missing.length) {
          problemText = `返信文が使っている「${check.missing.join('・')}」が、この名義に設定されていません`;
          return false;
        }
        if (validateBody(check.body)) {
          problemText = `言い回しを差し込むと ${validateBody(check.body)}`;
          return false;
        }
        return true;
      },
    });

    if (!template) {
      const reason = problemText ?? '返信用の文章がありません（文章ストックで「返信用」として入れてください）';
      await doc.ref.set({ replySkipped: reason, replyClaimedAt: null }, { merge: true });
      results.push({ account: account.name, postId: post.id, result: 'no_template', reason });
      continue;
    }

    const filled = fillProfile(template.body, account, wordsFor(account));

    if (postingMode() === 'dry_run') {
      await doc.ref.set(
        { replyThreadId: 'dry_run', replyBody: filled.body, replyAt: new Date().toISOString(), replyWhen: when, replyDryRun: true, replyClaimedAt: null },
        { merge: true }
      );
      results.push({ account: account.name, postId: post.id, result: 'dry_run', when });
      sent += 1;
      continue;
    }

    try {
      const published = await createReply({
        accessToken: account.accessToken,
        userId: account.threadsUserId,
        text: filled.body,
        replyToId: post.postedThreadId,
      });
      await doc.ref.set(
        {
          replyThreadId: published.id,
          replyBody: filled.body,
          replyTemplateId: template.id,
          replyAt: new Date().toISOString(),
          replyWhen: when,
          replyDryRun: false,
          replyError: null,
          replyClaimedAt: null,
        },
        { merge: true }
      );
      results.push({ account: account.name, postId: post.id, result: 'replied', when, likes: post.snap30?.likes ?? 0 });
      sent += 1;
    } catch (err) {
      const reason = shortError(err);
      await doc.ref.set({ replyError: reason, replyClaimedAt: null }, { merge: true });
      results.push({ account: account.name, postId: post.id, result: 'failed', reason });
    }
  }

  return results;
}

