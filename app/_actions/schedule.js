'use server';

import { revalidatePath } from 'next/cache';
import { getDb, COLLECTIONS, FieldValue } from '@/lib/server/firebase.mjs';
import { getCurrentUser, filterAccountsForUser } from '@/lib/server/auth.mjs';
import { listAccounts, invalidate, TAGS } from '@/lib/server/repo.mjs';
import { scheduleFromForm, computeNextInterval } from '@/lib/server/schedule.mjs';

function refresh() {
  invalidate(TAGS.accounts);
  revalidatePath('/schedule');
  revalidatePath('/');
}

/**
 * 選んだ名義に同じ自動投稿の設定を入れる。
 * formData: accountIds[], dailyEnabled, dailyTimes, intervalEnabled, intervalMinHours, intervalMaxHours,
 *           activeFrom, activeTo, order, source, tag, minGapMinutes
 */
export async function applySchedule(formData) {
  try {
    const user = await getCurrentUser();
    const allowed = filterAccountsForUser(await listAccounts(), user);
    const ids = formData.getAll('accountIds').map(String);
    const targets = allowed.filter((a) => ids.includes(a.id));
    if (!targets.length) return { error: '名義を1つ以上選んでください。' };

    const schedule = scheduleFromForm({
      dailyEnabled: formData.get('dailyEnabled') === 'on',
      dailyTimes: formData.get('dailyTimes'),
      intervalEnabled: formData.get('intervalEnabled') === 'on',
      intervalMinHours: formData.get('intervalMinHours'),
      intervalMaxHours: formData.get('intervalMaxHours'),
      activeFrom: formData.get('activeFrom'),
      activeTo: formData.get('activeTo'),
      order: formData.get('order'),
      source: formData.get('source'),
      tag: formData.get('tag'),
      minGapMinutes: formData.get('minGapMinutes'),
    });

    const db = getDb();
    const now = new Date();
    for (const account of targets) {
      // 間隔投稿は、次の時刻を名義ごとに別々に決める（同時刻に並ばないように）
      const next = schedule.intervalEnabled ? computeNextInterval({ now, schedule }) : null;
      await db
        .collection(COLLECTIONS.accounts)
        .doc(account.id)
        .set({ schedule: { ...schedule, nextIntervalAt: next }, updatedAt: now.toISOString() }, { merge: true });
    }

    refresh();
    return { ok: `${targets.length}件の名義に設定を入れました。` };
  } catch (err) {
    return { error: err.message };
  }
}

/** 名義の自動投稿を止める／再開する（設定は残す）。 */
export async function setAccountStatus(formData) {
  const user = await getCurrentUser();
  const allowed = filterAccountsForUser(await listAccounts(), user);
  const id = String(formData.get('accountId') ?? '');
  const status = String(formData.get('status'));
  if (!['active', 'paused'].includes(status) || !allowed.some((a) => a.id === id)) return;

  await getDb().collection(COLLECTIONS.accounts).doc(id).set({ status, updatedAt: new Date().toISOString() }, { merge: true });
  refresh();
  revalidatePath('/settings');
}

/** 見られる名義をまとめて稼働／停止にする。 */
export async function setAllStatus(formData) {
  const user = await getCurrentUser();
  const allowed = filterAccountsForUser(await listAccounts(), user);
  const status = String(formData.get('status'));
  if (!['active', 'paused'].includes(status)) return;

  const db = getDb();
  const batch = db.batch();
  for (const a of allowed) batch.set(db.collection(COLLECTIONS.accounts).doc(a.id), { status, updatedAt: new Date().toISOString() }, { merge: true });
  await batch.commit();
  refresh();
  revalidatePath('/settings');
}

/** 文章の一巡をやり直す（また最初から全部の文章を使う）。 */
export async function resetCycle(formData) {
  const user = await getCurrentUser();
  const allowed = filterAccountsForUser(await listAccounts(), user);
  const id = String(formData.get('accountId') ?? '');
  if (!allowed.some((a) => a.id === id)) return;
  await getDb().collection(COLLECTIONS.accounts).doc(id).set({ templateCycle: FieldValue.delete() }, { merge: true });
  refresh();
}
