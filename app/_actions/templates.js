'use server';

import { revalidatePath } from 'next/cache';
import { getDb, COLLECTIONS } from '@/lib/server/firebase.mjs';
import { getCurrentUser, filterAccountsForUser } from '@/lib/server/auth.mjs';
import { listAccounts, listTemplates, invalidate, TAGS } from '@/lib/server/repo.mjs';
import { addTemplates, splitTemplates, templatesFromCsv, parseTags, validateBody, bumpTemplateVersion } from '@/lib/server/templates.mjs';
import { normalizeMedia } from '@/lib/server/storage.mjs';

/** 取り込みファイルの上限（サーバーアクションの上限より小さく）。 */
const MAX_FILE_BYTES = 1.5 * 1024 * 1024;

/** 画面の「使う名義」の値（shared か名義 ID）を、保存する accountId にする。権限も確かめる。 */
async function resolveScope(value) {
  const user = await getCurrentUser();
  const scope = String(value ?? 'shared');
  if (scope === 'shared') return { accountId: null, user };
  const allowed = filterAccountsForUser(await listAccounts(), user);
  const account = allowed.find((a) => a.id === scope);
  if (!account) throw new Error('その名義は扱えません。');
  return { accountId: account.id, user };
}

function refresh() {
  invalidate(TAGS.templates, TAGS.accounts);
  revalidatePath('/templates');
  revalidatePath('/');
}

/**
 * 文章をまとめて取り込む。
 * formData: scope, tags, mode(separator/blank/line), text, file(.txt / .csv)
 */
export async function importTemplates(formData) {
  try {
    const { accountId, user } = await resolveScope(formData.get('scope'));
    const tags = parseTags(formData.get('tags'));
    const mode = String(formData.get('mode') ?? 'separator');

    let items = [];
    const file = formData.get('file');
    if (file && typeof file === 'object' && typeof file.arrayBuffer === 'function' && file.size > 0) {
      if (file.size > MAX_FILE_BYTES) return { error: 'ファイルが大きすぎます（1.5MBまで）。いくつかに分けてください。' };
      const text = new TextDecoder('utf-8').decode(await file.arrayBuffer());
      if (/\.csv$/i.test(file.name ?? '')) items = templatesFromCsv(text);
      else items = splitTemplates(text, mode).map((body) => ({ body }));
    }

    const pasted = String(formData.get('text') ?? '');
    if (pasted.trim()) items = [...items, ...splitTemplates(pasted, mode).map((body) => ({ body }))];

    if (!items.length) return { error: '取り込む文章がありません。貼り付けるか、ファイルを選んでください。' };

    const result = await addTemplates({ items, accountId, tags, createdBy: user.name });
    refresh();

    const where = accountId ? 'この名義用' : '全名義共通';
    const skippedNote = result.skipped.length ? `／ ${result.skipped.length}件は飛ばしました（${result.skipped.slice(0, 3).map((s) => `${s.index}番目: ${s.reason}`).join('、')}${result.skipped.length > 3 ? '…' : ''}）` : '';
    return { ok: `${where}に ${result.added} 本を登録しました ${skippedNote}`, added: result.added, skipped: result.skipped };
  } catch (err) {
    return { error: err.message };
  }
}

/** 1本の本文・タグ・使う名義を書き換える。 */
export async function updateTemplate(formData) {
  try {
    const id = String(formData.get('id') ?? '');
    const { accountId } = await resolveScope(formData.get('scope'));
    const body = String(formData.get('body') ?? '').replace(/\r\n?/g, '\n');
    const problem = validateBody(body);
    if (problem) return { error: problem };

    const db = getDb();
    await db.collection(COLLECTIONS.templates).doc(id).set(
      { body, tags: parseTags(formData.get('tags')), accountId, updatedAt: new Date().toISOString() },
      { merge: true }
    );
    await bumpTemplateVersion(db);
    refresh();
    return { ok: '保存しました。' };
  } catch (err) {
    return { error: err.message };
  }
}

/** 有効・無効を切り替える（無効な文章は自動投稿に使われない）。 */
export async function setTemplateEnabled(formData) {
  const id = String(formData.get('id') ?? '');
  const enabled = String(formData.get('enabled')) === 'on';
  await getCurrentUser();
  const db = getDb();
  await db.collection(COLLECTIONS.templates).doc(id).set({ enabled, updatedAt: new Date().toISOString() }, { merge: true });
  await bumpTemplateVersion(db);
  refresh();
}

/** 1本消す。 */
export async function deleteTemplate(formData) {
  const id = String(formData.get('id') ?? '');
  await getCurrentUser();
  const db = getDb();
  await db.collection(COLLECTIONS.templates).doc(id).delete();
  await bumpTemplateVersion(db);
  refresh();
}

/** 文章に画像・動画を付ける（外すのも同じ）。 */
export async function setTemplateMedia(formData) {
  try {
    const id = String(formData.get('id') ?? '');
    await getCurrentUser();
    let media = [];
    try {
      media = normalizeMedia(JSON.parse(String(formData.get('media') ?? '[]')));
    } catch {
      return { error: '素材の情報を読めませんでした。' };
    }
    await getDb().collection(COLLECTIONS.templates).doc(id).set({ media, updatedAt: new Date().toISOString() }, { merge: true });
    refresh();
    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * 絞り込みに当てはまる文章をまとめて消す。
 * formData: ids（JSON の配列）, confirm（「削除」と入力）
 */
export async function deleteTemplatesBulk(formData) {
  try {
    const user = await getCurrentUser();
    if (String(formData.get('confirm') ?? '').trim() !== '削除') return { error: '確認のため「削除」と入力してください。' };

    let ids = [];
    try {
      ids = JSON.parse(String(formData.get('ids') ?? '[]')).map(String);
    } catch {
      return { error: '対象を読めませんでした。' };
    }
    if (!ids.length) return { error: '対象がありません。' };

    // 見られる名義の分（と全名義共通）だけ消す
    const allowed = new Set(filterAccountsForUser(await listAccounts(), user).map((a) => a.id));
    const all = await listTemplates();
    const targets = all.filter((t) => ids.includes(t.id) && (t.accountId == null || allowed.has(t.accountId)));

    const db = getDb();
    for (let i = 0; i < targets.length; i += 400) {
      const batch = db.batch();
      for (const t of targets.slice(i, i + 400)) batch.delete(db.collection(COLLECTIONS.templates).doc(t.id));
      await batch.commit();
    }
    await bumpTemplateVersion(db);
    refresh();
    return { ok: `${targets.length}本を削除しました。` };
  } catch (err) {
    return { error: err.message };
  }
}
