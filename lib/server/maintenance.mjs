// 日々の後片付け。実行ログが際限なく増えないようにする。
import { getDb, COLLECTIONS } from './firebase.mjs';

/** 実行ログを何日ぶん残すか。 */
const KEEP_DAYS = 14;

/** 見送り・時刻切れの記録を何日ぶん残すか（投稿済みと失敗は残す）。 */
const KEEP_SKIPPED_DAYS = 30;

/** まとめ削除の単位（Firestore の上限は500）。 */
const BATCH_SIZE = 400;

async function deleteQuery(db, query) {
  const snap = await query.limit(BATCH_SIZE).get();
  if (snap.empty) return 0;
  const batch = db.batch();
  for (const doc of snap.docs) batch.delete(doc.ref);
  await batch.commit();
  return snap.size;
}

/** 古い実行ログと、古い見送り記録を削除する。 */
export async function pruneOld() {
  const db = getDb();
  const runsCutoff = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString();
  const runs = await deleteQuery(db, db.collection(COLLECTIONS.runs).where('startedAt', '<', runsCutoff));

  const skippedCutoff = new Date(Date.now() - KEEP_SKIPPED_DAYS * 86400000).toISOString();
  let skipped = 0;
  for (const status of ['skipped', 'missed']) {
    const snap = await db.collection(COLLECTIONS.posts).where('status', '==', status).limit(BATCH_SIZE).get();
    const old = snap.docs.filter((d) => String(d.data().createdAt ?? '') < skippedCutoff);
    if (!old.length) continue;
    const batch = db.batch();
    for (const doc of old) batch.delete(doc.ref);
    await batch.commit();
    skipped += old.length;
  }

  return { runs, skipped };
}
