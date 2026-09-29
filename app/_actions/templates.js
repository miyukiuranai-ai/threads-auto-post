'use server';

import { revalidatePath } from 'next/cache';
import { getDb, COLLECTIONS } from '@/lib/server/firebase.mjs';
import { getCurrentUser, filterAccountsForUser } from '@/lib/server/auth.mjs';
import { listAccounts, listTemplates, invalidate, TAGS } from '@/lib/server/repo.mjs';
import { addTemplates, splitTemplates, templatesFromCsv, parseTags, validateBody, bumpTemplateVersion, normalizeAttributes, MAX_BODY } from '@/lib/server/templates.mjs';
import { findPlaceholders, ATTRIBUTE_KEY } from '@/lib/server/profile.mjs';
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
    const attributes = normalizeAttributes(formData.getAll('attributes').map(String));
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

    const result = await addTemplates({ items, accountId, tags, attributes, createdBy: user.name });
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
      {
        body,
        tags: parseTags(formData.get('tags')),
        attributes: normalizeAttributes(formData.getAll('attributes').map(String)),
        accountId,
        updatedAt: new Date().toISOString(),
      },
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
 * 絞り込んだ文章の「属性を差し込む版」をまとめて作る。
 * 元の文章はそのまま残るので、属性あり・なしの両方が一巡に入る。
 * formData: ids（JSON の配列）, position（head / tail）, key（差し込む項目名）, tag（付けるタグ）
 */
export async function duplicateWithPlaceholder(formData) {
  try {
    const user = await getCurrentUser();

    let ids = [];
    try {
      ids = JSON.parse(String(formData.get('ids') ?? '[]')).map(String);
    } catch {
      return { error: '対象を読めませんでした。' };
    }
    if (!ids.length) return { error: '対象がありません。' };

    const key = String(formData.get('key') ?? ATTRIBUTE_KEY).trim() || ATTRIBUTE_KEY;
    const position = String(formData.get('position') ?? 'head') === 'tail' ? 'tail' : 'head';
    const tag = String(formData.get('tag') ?? '').trim();
    const mark = `{${key}}`;

    const allowed = new Set(filterAccountsForUser(await listAccounts(), user).map((a) => a.id));
    const all = await listTemplates();
    const targets = all.filter((t) => ids.includes(t.id) && (t.accountId == null || allowed.has(t.accountId)));

    // 元の文章と同じ名義のまま複製したいので、名義ごとに分けて作る
    const byAccount = new Map();
    let skipped = 0;
    for (const t of targets) {
      const body = String(t.body ?? '');
      // すでに差し込みが入っているものは複製しない（二重に付かないように）
      if (findPlaceholders(body).length) {
        skipped += 1;
        continue;
      }
      const next = position === 'head' ? `${mark}${body}` : `${body}${mark}`;
      // 差し込んだ言葉のぶんで上限を超えないよう、少し余裕を見ておく
      if (validateBody(next) || [...next].length > MAX_BODY - 40) {
        skipped += 1;
        continue;
      }
      const accountId = t.accountId ?? null;
      if (!byAccount.has(accountId)) byAccount.set(accountId, []);
      byAccount.get(accountId).push({
        body: next,
        tags: [...new Set([...(t.tags ?? []), ...(tag ? [tag] : [])])],
        attributes: t.attributes ?? [],
        media: t.media ?? [],
      });
    }

    const total = [...byAccount.values()].reduce((sum, list) => sum + list.length, 0);
    if (!total) {
      return { error: `作れる複製がありませんでした（${skipped}本は差し込み済みか、長さが上限に近すぎます）。` };
    }

    let added = 0;
    for (const [accountId, list] of byAccount) {
      const r = await addTemplates({ items: list, accountId, createdBy: user.name });
      added += r.added;
    }

    refresh();
    return {
      ok: `${added}本の「${mark} を${position === 'head' ? '先頭' : '末尾'}に付けた版」を作りました。元の文章はそのまま残っています。${skipped ? `（${skipped}本は対象外）` : ''}`,
    };
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * 絞り込んだ文章に、使わせる属性をまとめて設定する。
 * 何も選ばなければ「どの名義でも使う」に戻る。
 * formData: ids（JSON の配列）, attributes（複数）
 */
export async function setTemplatesAttributes(formData) {
  try {
    const user = await getCurrentUser();
    const attributes = normalizeAttributes(formData.getAll('attributes').map(String));

    let ids = [];
    try {
      ids = JSON.parse(String(formData.get('ids') ?? '[]')).map(String);
    } catch {
      return { error: '対象を読めませんでした。' };
    }
    if (!ids.length) return { error: '対象がありません。' };

    // 見られる名義の分（と全名義共通）だけ触る
    const allowed = new Set(filterAccountsForUser(await listAccounts(), user).map((a) => a.id));
    const all = await listTemplates();
    const targets = all.filter((t) => ids.includes(t.id) && (t.accountId == null || allowed.has(t.accountId)));

    const db = getDb();
    const now = new Date().toISOString();
    for (let i = 0; i < targets.length; i += 400) {
      const batch = db.batch();
      for (const t of targets.slice(i, i + 400)) {
        batch.set(db.collection(COLLECTIONS.templates).doc(t.id), { attributes, updatedAt: now }, { merge: true });
      }
      await batch.commit();
    }
    await bumpTemplateVersion(db);
    refresh();

    return {
      ok: attributes.length
        ? `${targets.length}本を「${attributes.join('・')}」の名義だけが使うようにしました。`
        : `${targets.length}本を、どの名義でも使えるようにしました。`,
    };
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
