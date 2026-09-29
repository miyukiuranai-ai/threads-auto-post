'use server';

import { revalidatePath } from 'next/cache';
import { getDb, COLLECTIONS } from '@/lib/server/firebase.mjs';
import { getCurrentUser } from '@/lib/server/auth.mjs';
import { invalidate, TAGS } from '@/lib/server/repo.mjs';
import { normalizeWords, splitCandidates, PROFILE_LIMITS } from '@/lib/server/profile.mjs';

/**
 * 属性ごとの言い回しの候補を保存する。
 * ここに入れた言葉が、文章の {属性} などに毎回1つずつ選ばれて入る。
 * 属性ごとに1か所なので、同じ属性の名義が何個あっても登録は1回で済む。
 */
export async function setAttributeWords(formData) {
  try {
    const user = await getCurrentUser();
    if (user.role !== 'admin') return { error: '管理者だけが変更できます。' };

    const attribute = String(formData.get('attribute') ?? '').trim();
    if (!attribute) return { error: '属性が指定されていません。' };

    // 画面からは「項目名」と「改行で区切った候補」の組で送られてくる
    let rows = [];
    try {
      rows = JSON.parse(String(formData.get('words') ?? '[]'));
    } catch {
      return { error: '入力を読み取れませんでした。' };
    }

    const words = normalizeWords(
      Object.fromEntries(
        (Array.isArray(rows) ? rows : [])
          .filter((r) => String(r?.key ?? '').trim())
          .slice(0, PROFILE_LIMITS.items)
          .map((r) => [r.key, splitCandidates(r.text)])
      )
    );

    await getDb()
      .collection(COLLECTIONS.attributes)
      .doc(attribute)
      .set({ words, updatedAt: new Date().toISOString(), updatedBy: user.name }, { merge: true });

    invalidate(TAGS.accounts);
    revalidatePath('/settings');
    revalidatePath('/compose');

    const total = Object.values(words).reduce((sum, list) => sum + list.length, 0);
    return { ok: total ? `「${attribute}」に ${Object.keys(words).length} 項目・${total} 個の言い回しを保存しました。` : `「${attribute}」の言い回しを空にしました。` };
  } catch (err) {
    return { error: err.message };
  }
}
