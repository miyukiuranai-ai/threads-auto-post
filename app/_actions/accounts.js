'use server';

import { revalidatePath } from 'next/cache';
import { getDb, COLLECTIONS } from '@/lib/server/firebase.mjs';
import { getMe, shortError } from '@/lib/server/threads.mjs';
import { getCurrentUser, filterAccountsForUser } from '@/lib/server/auth.mjs';
import { DEFAULT_GROUP } from '@/lib/server/auth-core.mjs';
import { listAccounts, invalidate, TAGS } from '@/lib/server/repo.mjs';
import { DEFAULT_SCHEDULE } from '@/lib/server/schedule.mjs';
import { bumpTemplateVersion } from '@/lib/server/templates.mjs';
import { refreshTokens } from '@/lib/server/tokens.mjs';

/** 生成ツールで発行した長期トークンは60日で失効する。 */
const LONG_LIVED_DAYS = 60;

function refresh() {
  invalidate(TAGS.accounts);
  revalidatePath('/settings');
  revalidatePath('/schedule');
  revalidatePath('/');
}

/**
 * 名義を追加する。トークンを1行に1つ貼り付けると、それぞれ持ち主を確かめて登録する。
 * 既にある名義ならトークンだけ入れ替える（設定は残る）。
 */
export async function addAccounts(formData) {
  const user = await getCurrentUser();
  const tokens = [...new Set(String(formData.get('accessTokens') ?? '').split(/\s+/).map((s) => s.trim()).filter(Boolean))];
  if (!tokens.length) return { error: 'トークンを入力してください。' };
  if (tokens.length > 50) return { error: '一度に登録できるのは50件までです。' };

  const group = user.role === 'admin' ? String(formData.get('group') ?? '').trim() || DEFAULT_GROUP : user.group;
  const db = getDb();
  const results = [];

  for (const [i, token] of tokens.entries()) {
    let me;
    try {
      me = await getMe({ accessToken: token, fields: 'id,username' });
    } catch (err) {
      results.push({ line: i + 1, result: 'failed', reason: `トークンを確認できませんでした: ${shortError(err)}` });
      continue;
    }

    const ref = db.collection(COLLECTIONS.accounts).doc(me.id);
    const snap = await ref.get();
    const prev = snap.exists ? snap.data() : {};

    // 他の人のグループの名義は上書きさせない
    if (snap.exists && user.role !== 'admin' && (prev.group ?? DEFAULT_GROUP) !== user.group) {
      results.push({ line: i + 1, account: me.username, result: 'failed', reason: '別のグループで登録されています' });
      continue;
    }

    const now = new Date().toISOString();
    await ref.set(
      {
        name: me.username,
        threadsUserId: me.id,
        accessToken: token,
        tokenExpiresAt: new Date(Date.now() + LONG_LIVED_DAYS * 86400000).toISOString(),
        tokenImportedAt: now,
        group: prev.group ?? group,
        status: prev.status ?? 'active',
        schedule: prev.schedule ?? { ...DEFAULT_SCHEDULE },
        createdAt: prev.createdAt ?? now,
        updatedAt: now,
      },
      { merge: true }
    );
    results.push({ line: i + 1, account: me.username, result: snap.exists ? 'updated' : 'added' });
  }

  refresh();
  const added = results.filter((r) => r.result === 'added').length;
  const updated = results.filter((r) => r.result === 'updated').length;
  const failed = results.filter((r) => r.result === 'failed').length;
  return { ok: `追加 ${added}件 ／ 更新 ${updated}件${failed ? ` ／ 失敗 ${failed}件` : ''}`, results };
}

/** 名義のグループを変える（管理者だけ）。 */
export async function setAccountGroup(formData) {
  const user = await getCurrentUser();
  if (user.role !== 'admin') return;

  const id = String(formData.get('accountId'));
  const group = String(formData.get('group') ?? '').trim() || DEFAULT_GROUP;
  await getDb().collection(COLLECTIONS.accounts).doc(id).set({ group, updatedAt: new Date().toISOString() }, { merge: true });
  refresh();
}

/** トークンをいま延長する（60日の期限を伸ばす）。 */
export async function refreshAllTokens() {
  const user = await getCurrentUser();
  if (user.role !== 'admin') return { error: '管理者だけが実行できます。' };
  const r = await refreshTokens({ all: true });
  refresh();
  const bad = r.results.filter((x) => x.result === 'failed' || x.result === 'expired');
  return { ok: `延長 ${r.results.filter((x) => x.result === 'refreshed').length}件${bad.length ? ` ／ 失敗 ${bad.length}件（${bad.map((x) => `@${x.account}: ${x.reason}`).join('、')}）` : ''}` };
}

/** Firestore の一括削除は1回500件まで。少なめに区切って回す。 */
const DELETE_CHUNK = 300;

async function deleteQuery(db, query) {
  let removed = 0;
  for (;;) {
    const snap = await query.limit(DELETE_CHUNK).get();
    if (snap.empty) return removed;
    const batch = db.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    await batch.commit();
    removed += snap.size;
    if (snap.size < DELETE_CHUNK) return removed;
  }
}

/**
 * 名義をツールから外す。
 * 消えるのはこのツールが持っているデータ（投稿の記録と、この名義用の文章）だけで、
 * Threads 側のアカウントも、すでに投稿された内容もそのまま残る。
 */
export async function removeAccount(formData) {
  const user = await getCurrentUser();
  const db = getDb();

  const id = String(formData.get('accountId') ?? '');
  const typed = String(formData.get('confirm') ?? '').trim().replace(/^@/, '');

  const snap = await db.collection(COLLECTIONS.accounts).doc(id).get();
  if (!snap.exists) return { error: 'その名義は見つかりませんでした。' };
  const account = { id: snap.id, ...snap.data() };

  if (user.role !== 'admin' && (account.group ?? DEFAULT_GROUP) !== user.group) return { error: 'この名義を削除する権限がありません。' };
  if (typed !== account.name) return { error: '入力した名前が一致しません。' };

  const removed = {
    posts: await deleteQuery(db, db.collection(COLLECTIONS.posts).where('accountId', '==', id)),
    templates: await deleteQuery(db, db.collection(COLLECTIONS.templates).where('accountId', '==', id)),
  };
  await db.collection(COLLECTIONS.accounts).doc(id).delete();
  await bumpTemplateVersion(db);

  invalidate(TAGS.accounts, TAGS.posts, TAGS.templates);
  revalidatePath('/settings');
  revalidatePath('/templates');
  revalidatePath('/posts');
  revalidatePath('/');

  return { ok: `@${account.name} を外しました（投稿の記録 ${removed.posts}件 ／ この名義用の文章 ${removed.templates}本を削除）。Threads 側のアカウントと投稿はそのままです。` };
}
