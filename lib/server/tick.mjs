// 定期実行の本体（5分おきに呼ばれる想定）。
//   1. 自動投稿の枠を確かめて、時刻が来ていれば文章ストックから投稿を作る
//   2. 予定時刻を過ぎた投稿（予約・自動）と、メディアの準備待ちの投稿を送る
//   3. 1日1回: トークンの延長と、古いログの片付け
import { getDb, COLLECTIONS } from './firebase.mjs';
import { runAutoPosting } from './auto.mjs';
import { publishDuePosts, postingMode } from './publish.mjs';
import { refreshTokens } from './tokens.mjs';
import { pruneOld } from './maintenance.mjs';

/** 1日1回の処理を、前回から何時間あけて行うか。 */
const DAILY_EVERY_HOURS = 20;

async function dailyDue(db) {
  const ref = db.collection(COLLECTIONS.meta).doc('maintenance');
  const snap = await ref.get();
  const last = snap.exists ? snap.data().lastAt : null;
  if (last && Date.now() - new Date(last).getTime() < DAILY_EVERY_HOURS * 3600000) return false;
  await ref.set({ lastAt: new Date().toISOString() }, { merge: true });
  return true;
}

/**
 * @param {object} opts
 * @param {number} [opts.budgetMs] 全体で使ってよい時間
 */
export async function runTick({ budgetMs = 270_000 } = {}) {
  const db = getDb();
  const startedAt = new Date().toISOString();
  const deadline = Date.now() + budgetMs;

  const snap = await db.collection(COLLECTIONS.accounts).get();
  const accounts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  let auto = [];
  try {
    auto = await runAutoPosting({ accounts, now: new Date() });
  } catch (err) {
    auto = [{ account: '-', kind: 'auto', result: 'error', reason: err.message }];
  }

  const published = await publishDuePosts({ accounts, deadline });

  let daily = null;
  if (Date.now() + 30_000 < deadline && (await dailyDue(db))) {
    try {
      const tokens = await refreshTokens({});
      const pruned = await pruneOld();
      daily = { tokens: tokens.results, pruned };
    } catch (err) {
      daily = { error: err.message };
    }
  }

  const summary = {};
  for (const r of published) summary[r.result] = (summary[r.result] ?? 0) + 1;
  const autoSummary = {};
  for (const r of auto) autoSummary[r.result] = (autoSummary[r.result] ?? 0) + 1;

  const failures = [
    ...published.filter((r) => r.result === 'failed').map((r) => `${r.account}: ${r.reason}`),
    ...auto.filter((r) => r.result === 'error' || r.result === 'no_template').map((r) => `${r.account}: ${r.reason}`),
  ];

  // 定期実行が動いていること自体は、何も起きなかった回も必ず記録する。
  // 画面の「最後に動いた時刻」がこれを見るため、投稿が無い日でも止まって見えないようにする。
  await db
    .collection(COLLECTIONS.meta)
    .doc('tick')
    .set(
      {
        lastAt: new Date().toISOString(),
        startedAt,
        mode: postingMode(),
        summary,
        autoSummary,
        failures: failures.length,
      },
      { merge: true }
    );

  // 詳しいログのほうは、何か起きた回だけ残す（件数が増えすぎるため）
  const happened = published.length || auto.some((r) => r.result !== 'planned') || daily;
  if (happened) {
    await db.collection(COLLECTIONS.runs).add({
      job: 'tick',
      startedAt,
      finishedAt: new Date().toISOString(),
      mode: postingMode(),
      status: failures.length ? 'failed' : 'ok',
      message: failures.join(' / '),
      summary,
      autoSummary,
      results: published,
      auto,
      ...(daily ? { daily } : {}),
    });
  }

  return { startedAt, mode: postingMode(), summary, autoSummary, published, auto, daily };
}
