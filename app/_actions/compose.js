'use server';

import { revalidatePath } from 'next/cache';
import { getDb, COLLECTIONS } from '@/lib/server/firebase.mjs';
import { getCurrentUser, filterAccountsForUser } from '@/lib/server/auth.mjs';
import { listAccounts, getAccountWithToken, listAttributeWords, invalidate, TAGS } from '@/lib/server/repo.mjs';
import { publishPost } from '@/lib/server/publish.mjs';
import { normalizeMedia } from '@/lib/server/storage.mjs';
import { validateBody } from '@/lib/server/templates.mjs';
import { fillProfile, attributeOf } from '@/lib/server/profile.mjs';
import { fromLocalInput } from '@/lib/server/time.mjs';

/** 「今すぐ投稿」で1回に使う時間。サーバー関数の上限（60秒）に収める。 */
const NOW_BUDGET_MS = 45_000;

/**
 * 今すぐ投稿、または予約する。選んだ名義すべてに同じ内容を送る。
 * formData: accountIds[]（複数）, body, media（JSON）, mode（now / reserve）, scheduledAtLocal
 */
export async function submitCompose(formData) {
  try {
    const user = await getCurrentUser();
    const allowed = filterAccountsForUser(await listAccounts(), user);

    const ids = formData.getAll('accountIds').map(String);
    const targets = allowed.filter((a) => ids.includes(a.id));
    if (!targets.length) return { error: '名義を1つ以上選んでください。' };

    const body = String(formData.get('body') ?? '').replace(/\r\n?/g, '\n');
    let media = [];
    try {
      media = normalizeMedia(JSON.parse(String(formData.get('media') ?? '[]')));
    } catch {
      return { error: '素材の情報を読めませんでした。' };
    }
    if (!media.length) {
      const problem = validateBody(body);
      if (problem) return { error: problem };
    } else if (validateBody(body) && body.trim()) {
      return { error: validateBody(body) };
    }

    const mode = String(formData.get('mode') ?? 'now') === 'reserve' ? 'reserve' : 'now';
    let scheduledAt = new Date().toISOString();
    if (mode === 'reserve') {
      scheduledAt = fromLocalInput(formData.get('scheduledAtLocal'));
      if (!scheduledAt) return { error: '予約する日時を入れてください。' };
      if (new Date(scheduledAt).getTime() < Date.now() - 60_000) return { error: '予約の日時が過去になっています。' };
    }

    // 本文に {職業} などがあれば、名義ごとの属性に置き換える。
    // 値が入っていない名義は投稿せず、理由を返す
    const filledFor = new Map();
    const blocked = [];
    const wordsByAttribute = await listAttributeWords();
    for (const account of targets) {
      const filled = fillProfile(body, account, wordsByAttribute[attributeOf(account)] ?? null);
      if (filled.missing.length) {
        blocked.push({ account: account.name, result: 'failed', reason: `文章が使っている「${filled.missing.join('・')}」がこの名義に設定されていません` });
        continue;
      }
      // 差し込んだ言葉のぶんで長くなりすぎたら送らない
      const tooLong = validateBody(filled.body);
      if (tooLong) {
        blocked.push({ account: account.name, result: 'failed', reason: `言い回しを差し込むと ${tooLong}` });
        continue;
      }
      filledFor.set(account.id, filled.body);
    }
    const ready = targets.filter((a) => filledFor.has(a.id));
    if (!ready.length) {
      return { error: '選んだ名義すべてで、本文に使っている項目が設定されていません。名義の管理の「属性」で入れてください。', results: blocked };
    }

    const db = getDb();
    const now = new Date().toISOString();
    const created = [];
    for (const account of ready) {
      const ref = db.collection(COLLECTIONS.posts).doc();
      await ref.set({
        accountId: account.id,
        accountName: account.name,
        body: filledFor.get(account.id),
        media,
        scheduledAt,
        status: 'scheduled',
        source: mode === 'now' ? 'manual_now' : 'manual',
        createdAt: now,
        createdBy: user.name,
      });
      created.push({ account, postId: ref.id });
    }

    invalidate(TAGS.posts);
    revalidatePath('/posts');
    revalidatePath('/');

    if (mode === 'reserve') {
      return {
        ok: `${created.length}件を予約しました。予定時刻になると自動で投稿されます（定期実行が5分おきに確かめます）。${blocked.length ? ` ${blocked.length}件は属性が足りず見送りました。` : ''}`,
        results: [...created.map((c) => ({ account: c.account.name, result: 'scheduled' })), ...blocked],
      };
    }

    // 今すぐ投稿: 名義ごとに並行して送る。時間内に終わらなかった分は定期実行が引き継ぐ
    const results = await Promise.all(
      created.map(async ({ account, postId }) => {
        const full = await getAccountWithToken(account.id);
        const post = { id: postId, body: filledFor.get(account.id), media };
        const r = await publishPost({ account: full, post, budgetMs: NOW_BUDGET_MS });
        return { account: account.name, ...r };
      })
    );

    invalidate(TAGS.posts, TAGS.accounts);
    revalidatePath('/posts');
    revalidatePath('/');

    const all = [...results, ...blocked];
    const posted = all.filter((r) => r.result === 'posted' || r.result === 'dry_run').length;
    const pending = all.filter((r) => r.result === 'pending').length;
    const failed = all.filter((r) => r.result === 'failed').length;
    const parts = [`投稿 ${posted}件`];
    if (pending) parts.push(`準備待ち ${pending}件（数分後に自動で公開）`);
    if (failed) parts.push(`失敗 ${failed}件`);

    return { ok: parts.join(' ／ '), results: all };
  } catch (err) {
    return { error: err.message };
  }
}
