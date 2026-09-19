// 投稿を Threads へ送る。
//
// Threads の投稿は「コンテナを作る → 準備ができるのを待つ → 公開する」の2段階。
// 画像・動画は準備に時間がかかる（動画は数分）ので、待ちきれなかった投稿は
// コンテナの ID を残して「投稿中」のまま置き、次の定期実行で続きから公開する。
import { getDb, COLLECTIONS } from './firebase.mjs';
import {
  createTextContainer,
  createMediaContainer,
  createCarouselContainer,
  getContainerStatus,
  publishContainer,
  getThread,
  shortError,
  MEDIA_NOT_READY_SUBCODE,
} from './threads.mjs';
import { signedUrl, normalizeMedia, MEDIA_LIMITS } from './storage.mjs';

/**
 * 投稿モード。
 *   live    … 実際に投稿する（既定）
 *   dry_run … 投稿の流れは動くが Threads には送らない（試すとき用）
 */
export function postingMode() {
  return process.env.POSTING_MODE === 'dry_run' ? 'dry_run' : 'live';
}

/** 途中で落ちた「投稿中」の印を、この時間が過ぎたら引き取る。 */
export const CLAIM_TIMEOUT_MS = 10 * 60_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 名義が投稿できる状態か。問題があれば理由を返す。 */
export function accountProblem(account) {
  if (!account) return '名義が見つかりません';
  if (!account.accessToken) return `@${account.name} のトークンがありません`;
  if (account.tokenExpiresAt && new Date(account.tokenExpiresAt).getTime() < Date.now()) {
    return `@${account.name} のトークンが失効しています。設定画面でトークンを入れ直してください`;
  }
  return null;
}

/**
 * この投稿の担当権を取る（同時に走った実行が二重に公開しないように）。
 * 取れたら true。他の実行が既に取っていたら false。
 */
async function claimPost(db, postId) {
  const ref = db.collection(COLLECTIONS.posts).doc(postId);
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return false;
      const post = snap.data();

      if (post.status === 'publishing') {
        // 「メディアの準備待ち」で置かれたもの（claimedAt が空）はすぐ引き取る。
        // 途中で落ちた可能性があるものは、十分に古ければ引き取る
        if (post.claimedAt) {
          const age = Date.now() - new Date(post.claimedAt).getTime();
          if (age < CLAIM_TIMEOUT_MS) return false;
        }
      } else if (post.status !== 'scheduled') {
        return false;
      }

      tx.set(ref, { status: 'publishing', claimedAt: new Date().toISOString() }, { merge: true });
      return true;
    });
  } catch {
    return false;
  }
}

/**
 * 投稿の中身に合わせてコンテナを作る。
 *   素材なし   TEXT
 *   1つ        IMAGE / VIDEO
 *   2つ以上    子を作ってから CAROUSEL（2〜20）
 */
async function buildContainer({ account, text, media }) {
  const accessToken = account.accessToken;
  const userId = account.threadsUserId;

  if (!media.length) {
    const container = await createTextContainer({ accessToken, userId, text });
    return container.id;
  }

  if (media.length > MEDIA_LIMITS.carousel.max) {
    throw new Error(`素材は${MEDIA_LIMITS.carousel.max}個までです（いまは${media.length}個）。`);
  }

  // 期限つき URL を作って渡す。バケットは公開しない
  const urls = await Promise.all(media.map((m) => signedUrl(m.path)));

  if (media.length === 1) {
    const container = await createMediaContainer({ accessToken, userId, kind: media[0].kind, url: urls[0], text });
    return container.id;
  }

  const children = [];
  for (const [i, m] of media.entries()) {
    const child = await createMediaContainer({ accessToken, userId, kind: m.kind, url: urls[i], isCarouselItem: true });
    children.push(child.id);
  }
  const container = await createCarouselContainer({ accessToken, userId, childIds: children, text });
  return container.id;
}

/**
 * コンテナの準備ができるまで待つ。期限内に終わらなければ false。
 * 公式の案内はテキストで約30秒、動画は1分おきに最大5分。
 * 実際には状態を見て終わり次第進めるほうが速いので、状態を見る。
 */
async function waitReady({ account, containerId, deadline, hasVideo }) {
  const interval = hasVideo ? 15_000 : 4_000;
  await sleep(Math.min(2_000, Math.max(0, deadline - Date.now())));
  for (;;) {
    const { status, error_message: errorMessage } = await getContainerStatus({
      accessToken: account.accessToken,
      containerId,
    });
    if (status === 'FINISHED') return true;
    if (status === 'ERROR' || status === 'EXPIRED') {
      throw new Error(`メディアの処理に失敗しました（${status}${errorMessage ? ': ' + errorMessage : ''}）。`);
    }
    if (Date.now() + interval > deadline) return false;
    await sleep(interval);
  }
}

/**
 * 1件を投稿する。
 * @param {object} opts
 * @param {object} opts.account
 * @param {object} opts.post       { id, body, media, ... }
 * @param {number} [opts.budgetMs] この呼び出しで使ってよい時間。過ぎたら「投稿中」のまま次に回す
 * @param {boolean} [opts.force]   dry_run でも実際に投稿する
 * @returns {{result:'posted'|'dry_run'|'pending'|'failed'|'skipped', reason?:string, permalink?:string, threadId?:string}}
 */
export async function publishPost({ account, post, budgetMs = 240_000, force = false }) {
  const db = getDb();
  const ref = db.collection(COLLECTIONS.posts).doc(post.id);
  const deadline = Date.now() + budgetMs;

  const problem = accountProblem(account);
  if (problem) {
    await ref.set({ status: 'failed', error: problem, failedAt: new Date().toISOString() }, { merge: true });
    return { result: 'failed', reason: problem };
  }

  if (!(await claimPost(db, post.id))) {
    return { result: 'skipped', reason: '他の実行が処理中です' };
  }

  if (postingMode() === 'dry_run' && !force) {
    await ref.set({ status: 'posted', dryRun: true, postedAt: new Date().toISOString(), claimedAt: null }, { merge: true });
    return { result: 'dry_run', reason: 'POSTING_MODE=dry_run のため実際には投稿していません' };
  }

  const media = normalizeMedia(post.media);
  const hasVideo = media.some((m) => m.kind === 'video');

  try {
    let containerId = post.containerId ?? null;
    if (!containerId) {
      try {
        containerId = await buildContainer({ account, text: post.body, media });
      } catch (err) {
        // 画像つきは Threads 側が画像を取りに来る途中で一時的に失敗することがある。一度だけ作り直す
        if (!media.length) throw err;
        await sleep(8_000);
        containerId = await buildContainer({ account, text: post.body, media });
      }
      await ref.set({ containerId, containerCreatedAt: new Date().toISOString() }, { merge: true });
    }

    const ready = await waitReady({ account, containerId, deadline, hasVideo });
    if (!ready) {
      await ref.set({ status: 'publishing', claimedAt: null, waitingSince: post.waitingSince ?? new Date().toISOString() }, { merge: true });
      return { result: 'pending', reason: 'メディアの準備待ち。次の定期実行で公開します' };
    }

    let published = null;
    for (let attempt = 0; ; attempt += 1) {
      try {
        published = await publishContainer({
          accessToken: account.accessToken,
          userId: account.threadsUserId,
          creationId: containerId,
        });
        break;
      } catch (err) {
        const subcode = err.body?.error?.error_subcode;
        if (subcode !== MEDIA_NOT_READY_SUBCODE || attempt >= 5) throw err;
        if (Date.now() + 6_000 > deadline) {
          await ref.set({ status: 'publishing', claimedAt: null }, { merge: true });
          return { result: 'pending', reason: 'メディアの準備待ち。次の定期実行で公開します' };
        }
        await sleep(6_000);
      }
    }

    let permalink = null;
    try {
      const thread = await getThread({ accessToken: account.accessToken, threadId: published.id });
      permalink = thread.permalink ?? null;
    } catch {
      // permalink が取れなくても投稿自体は成功している
    }

    const postedAt = new Date().toISOString();
    await ref.set(
      { status: 'posted', dryRun: false, postedThreadId: published.id, permalink, postedAt, error: null, claimedAt: null },
      { merge: true }
    );
    await db
      .collection(COLLECTIONS.accounts)
      .doc(account.id)
      .set({ lastPostedAt: postedAt, lastPostId: post.id }, { merge: true });

    return { result: 'posted', threadId: published.id, permalink };
  } catch (err) {
    const reason = shortError(err);
    await ref.set({ status: 'failed', error: reason, failedAt: new Date().toISOString(), claimedAt: null }, { merge: true });
    return { result: 'failed', reason };
  }
}

/** 予約投稿がどれだけ遅れても出すか（分）。これを超えたら「時刻切れ」にする。 */
export const MANUAL_LATE_LIMIT_MINUTES = 24 * 60;

/**
 * 予定時刻を過ぎた投稿と、メディアの準備待ちの投稿を処理する。
 * 名義ごとに順に送り、名義どうしは並行して進める。
 * @param {object} opts
 * @param {object[]} opts.accounts
 * @param {number} opts.deadline   この時刻（ms）までに終える。残りは次の実行へ
 * @param {number} [opts.concurrency]
 */
export async function publishDuePosts({ accounts, deadline, concurrency = 4, autoGraceMinutes = 60 }) {
  const db = getDb();
  const nowIso = new Date().toISOString();

  const [scheduledSnap, publishingSnap] = await Promise.all([
    db.collection(COLLECTIONS.posts).where('status', '==', 'scheduled').limit(300).get(),
    db.collection(COLLECTIONS.posts).where('status', '==', 'publishing').limit(100).get(),
  ]);
  const toObj = (d) => ({ id: d.id, ...d.data() });

  const due = scheduledSnap.docs.map(toObj).filter((p) => p.scheduledAt && p.scheduledAt <= nowIso);
  const resume = publishingSnap.docs.map(toObj).filter((p) => {
    if (!p.claimedAt) return true;
    return Date.now() - new Date(p.claimedAt).getTime() >= CLAIM_TIMEOUT_MS;
  });

  const results = [];
  const byAccount = new Map();
  for (const post of [...due, ...resume]) {
    if (!byAccount.has(post.accountId)) byAccount.set(post.accountId, []);
    byAccount.get(post.accountId).push(post);
  }

  const accountMap = new Map(accounts.map((a) => [a.id, a]));

  const work = [...byAccount.entries()].map(([accountId, posts]) => async () => {
    const account = accountMap.get(accountId);
    const name = account?.name ?? accountId;

    for (const post of posts.sort((a, b) => String(a.scheduledAt ?? '').localeCompare(String(b.scheduledAt ?? '')))) {
      if (!account) {
        await db.collection(COLLECTIONS.posts).doc(post.id).set({ status: 'failed', error: '名義が見つかりません（外されています）', failedAt: nowIso }, { merge: true });
        results.push({ account: name, postId: post.id, result: 'failed', reason: '名義が見つかりません' });
        continue;
      }

      // 停止中の名義は、予約と自動投稿を止める（今すぐ投稿は画面から直接送るのでここを通らない）
      if ((account.status ?? 'active') === 'paused' && post.status === 'scheduled') {
        results.push({ account: name, postId: post.id, result: 'skipped', reason: '名義が停止中' });
        continue;
      }

      // 遅れすぎた投稿は出さない（定期実行が長く止まっていた場合に、まとめて出てしまうのを防ぐ）
      if (post.status === 'scheduled') {
        const lateMinutes = (Date.now() - new Date(post.scheduledAt).getTime()) / 60000;
        const limit = post.source === 'auto' ? autoGraceMinutes : MANUAL_LATE_LIMIT_MINUTES;
        if (lateMinutes > limit) {
          await db.collection(COLLECTIONS.posts).doc(post.id).set(
            { status: 'missed', missedAt: nowIso, error: `予定時刻から${Math.round(lateMinutes)}分過ぎたため見送りました` },
            { merge: true }
          );
          results.push({ account: name, postId: post.id, result: 'missed', reason: `予定から${Math.round(lateMinutes)}分遅れ` });
          continue;
        }
      }

      const remaining = deadline - Date.now();
      if (remaining < 20_000) {
        results.push({ account: name, postId: post.id, result: 'deferred', reason: '時間切れ。次の実行で送ります' });
        continue;
      }

      const r = await publishPost({ account, post, budgetMs: Math.min(remaining - 5_000, 4 * 60_000) });
      results.push({ account: name, postId: post.id, ...r });
    }
  });

  // 名義どうしは並行して進める（同時に動かす数は抑える）
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, work.length) }, async () => {
    while (index < work.length) {
      const job = work[index++];
      await job();
    }
  });
  await Promise.all(workers);

  return results;
}
