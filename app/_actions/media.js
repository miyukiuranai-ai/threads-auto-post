'use server';

import { getCurrentUser } from '@/lib/server/auth.mjs';
import { planUpload, confirmUpload } from '@/lib/server/storage.mjs';

/** 送り先の一時 URL を作る。ファイル本体はブラウザから直接バケットへ送る。 */
export async function requestUpload(formData) {
  try {
    await getCurrentUser();
    const plan = await planUpload({
      fingerprint: String(formData.get('fingerprint') ?? ''),
      contentType: String(formData.get('contentType') ?? ''),
      bytes: Number(formData.get('bytes')),
    });
    return { ok: true, ...plan };
  } catch (err) {
    return { error: err.message };
  }
}

/** 送り終わったファイルを確かめ、投稿に付けられる形にして返す。 */
export async function finishUpload(formData) {
  try {
    const user = await getCurrentUser();
    const entry = await confirmUpload({
      fingerprint: String(formData.get('fingerprint') ?? ''),
      path: String(formData.get('path') ?? ''),
      contentType: String(formData.get('contentType') ?? ''),
      bytes: Number(formData.get('bytes')),
      name: String(formData.get('name') ?? '').slice(0, 120),
      uploadedBy: user.name,
    });
    return { ok: true, entry };
  } catch (err) {
    return { error: err.message };
  }
}
