// 自動投稿。名義ごとの設定（毎日の時刻・〇〜〇時間おき）にしたがって、
// 文章ストックから1本取り出して投稿の予定を作る。実際の送信は publish.mjs が行う。
//
// 同じ枠を二重に作らないよう、投稿のドキュメント ID を「名義 + 枠」から決めて create() する。
// すでにあれば失敗するので、定期実行が重なっても1本しかできない。
import { getDb, COLLECTIONS } from './firebase.mjs';
import { normalizeSchedule, computeNextInterval, DAILY_GRACE_MINUTES } from './schedule.mjs';
import { pickTemplate } from './templates.mjs';
import { jstDateKey, jstToIso } from './time.mjs';

/** 直前の投稿・近い予約と重ならないかを確かめる。重なるなら理由を返す。 */
async function gapProblem({ db, account, slotIso, nowMs, minGapMinutes }) {
  if (!minGapMinutes) return null;
  const gapMs = minGapMinutes * 60000;
  const slotMs = new Date(slotIso).getTime();

  // 実際に出るのは「いま」なので、枠の時刻と現在時刻の両方で直前の投稿との近さを見る
  if (account.lastPostedAt) {
    const last = new Date(account.lastPostedAt).getTime();
    const diff = Math.min(Math.abs(slotMs - last), Math.abs(nowMs - last));
    if (diff < gapMs) return `直前の投稿から${Math.round(diff / 60000)}分しか経っていない`;
  }

  // 近い時刻に予約投稿があれば、そちらを優先して自動投稿は見送る
  const snap = await db.collection(COLLECTIONS.posts).where('accountId', '==', account.id).where('status', '==', 'scheduled').limit(50).get();
  for (const doc of snap.docs) {
    const p = doc.data();
    if (p.source === 'auto' || !p.scheduledAt) continue;
    const diff = Math.abs(new Date(p.scheduledAt).getTime() - slotMs);
    if (diff < gapMs) return `${Math.round(diff / 60000)}分以内に予約投稿がある`;
  }
  return null;
}

/** 文章を1本取り出して投稿を作る。ID が既にあれば何もしない（false）。 */
async function createAutoPost({ db, account, postId, slotIso, kind }) {
  const ref = db.collection(COLLECTIONS.posts).doc(postId);
  const exists = await ref.get();
  if (exists.exists) return { created: false, reason: 'exists' };

  const template = await pickTemplate({ db, account });
  if (!template) return { created: false, reason: '使える文章がありません（ストックが空か、すべて無効）' };

  const now = new Date().toISOString();
  try {
    await ref.create({
      accountId: account.id,
      accountName: account.name ?? null,
      body: template.body,
      media: Array.isArray(template.media) ? template.media : [],
      scheduledAt: slotIso,
      status: 'scheduled',
      source: 'auto',
      autoKind: kind,
      templateId: template.id,
      createdAt: now,
      createdBy: 'auto',
    });
  } catch (err) {
    if (err.code === 6 || /already exists/i.test(String(err.message))) return { created: false, reason: 'exists' };
    throw err;
  }
  return { created: true, templateId: template.id };
}

/**
 * 全名義の自動投稿の枠を確かめ、時刻が来ていれば投稿を作る。
 * @returns {{account:string, kind:string, result:string, reason?:string, at?:string}[]}
 */
export async function runAutoPosting({ accounts, now = new Date() }) {
  const db = getDb();
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const results = [];

  for (const account of accounts) {
    if ((account.status ?? 'active') === 'paused') continue;
    const schedule = normalizeSchedule(account.schedule);
    const name = account.name ?? account.id;

    try {
      // ---- 毎日の決まった時刻 ----
      if (schedule.dailyEnabled && schedule.dailyTimes.length) {
        const today = jstDateKey(nowMs);
        for (const time of schedule.dailyTimes) {
          const slotIso = jstToIso(today, time);
          const slotMs = new Date(slotIso).getTime();
          if (slotMs > nowMs) continue;
          const lateMinutes = (nowMs - slotMs) / 60000;
          if (lateMinutes > DAILY_GRACE_MINUTES) continue; // 見送り（記録はしない。毎回出ると煩いため）

          const postId = `auto-${account.id}-${today.replaceAll('-', '')}-${time.replace(':', '')}`;
          const existing = await db.collection(COLLECTIONS.posts).doc(postId).get();
          if (existing.exists) continue;

          const gap = await gapProblem({ db, account, slotIso, nowMs, minGapMinutes: schedule.minGapMinutes });
          if (gap) {
            // 見送ったことを記録して、同じ枠を何度も試さないようにする
            await db.collection(COLLECTIONS.posts).doc(postId).set({
              accountId: account.id,
              accountName: name,
              status: 'skipped',
              source: 'auto',
              autoKind: 'daily',
              scheduledAt: slotIso,
              error: `見送り: ${gap}`,
              createdAt: nowIso,
            });
            results.push({ account: name, kind: 'daily', result: 'skipped', reason: gap, at: slotIso });
            continue;
          }

          const r = await createAutoPost({ db, account, postId, slotIso, kind: 'daily' });
          if (r.created) results.push({ account: name, kind: 'daily', result: 'created', at: slotIso });
          else if (r.reason !== 'exists') results.push({ account: name, kind: 'daily', result: 'no_template', reason: r.reason, at: slotIso });
        }
      }

      // ---- 〇〜〇時間おき ----
      if (schedule.intervalEnabled) {
        const accountRef = db.collection(COLLECTIONS.accounts).doc(account.id);
        let next = schedule.nextIntervalAt;

        if (!next) {
          next = computeNextInterval({ now, schedule });
          await accountRef.set({ schedule: { ...schedule, nextIntervalAt: next } }, { merge: true });
          results.push({ account: name, kind: 'interval', result: 'planned', at: next });
        } else if (new Date(next).getTime() <= nowMs) {
          const lateMinutes = (nowMs - new Date(next).getTime()) / 60000;
          const slotIso = next;
          const postId = `auto-${account.id}-i${new Date(next).getTime()}`;

          if (lateMinutes <= DAILY_GRACE_MINUTES) {
            const gap = await gapProblem({ db, account, slotIso, nowMs, minGapMinutes: schedule.minGapMinutes });
            if (gap) {
              // 少し先へずらす
              next = new Date(nowMs + Math.max(5, schedule.minGapMinutes) * 60000).toISOString();
              await accountRef.set({ schedule: { ...schedule, nextIntervalAt: next } }, { merge: true });
              results.push({ account: name, kind: 'interval', result: 'postponed', reason: gap, at: next });
              continue;
            }
            const r = await createAutoPost({ db, account, postId, slotIso, kind: 'interval' });
            if (r.created) results.push({ account: name, kind: 'interval', result: 'created', at: slotIso });
            else if (r.reason !== 'exists') results.push({ account: name, kind: 'interval', result: 'no_template', reason: r.reason, at: slotIso });
          } else {
            results.push({ account: name, kind: 'interval', result: 'missed', reason: `予定から${Math.round(lateMinutes)}分遅れたため見送り`, at: slotIso });
          }

          next = computeNextInterval({ now, schedule });
          await accountRef.set({ schedule: { ...schedule, nextIntervalAt: next } }, { merge: true });
          results.push({ account: name, kind: 'interval', result: 'planned', at: next });
        }
      }
    } catch (err) {
      // この名義の処理だけを諦め、次の名義へ進む
      results.push({ account: name, kind: 'auto', result: 'error', reason: err.message });
    }
  }

  return results;
}
