// 投稿の成果を、表計算ソフトへ渡せる形にまとめる。
//
// スプレッドシートからは Apps Script で /api/report を読み、行をそのまま貼る想定。
// どの名義がよく伸びたかを見たいので、名義・属性・いいね数・目標に届いたかを並べる。
import { getDb, COLLECTIONS } from './firebase.mjs';
import { reachedTarget, bestLikes } from '../shared/snapshots.mjs';
import { likeTarget } from './insights.mjs';
import { attributeOf } from './profile.mjs';
import { toJstLabel } from './time.mjs';

/** 見出し（スプレッドシートの1行目）。 */
export const REPORT_HEADER = [
  '投稿日時',
  '名義',
  '属性',
  '30分後のいいね',
  '1時間後のいいね',
  '30分後の表示',
  '1時間後の表示',
  '目標到達',
  '本文',
  'リンク',
  '記録の問題',
];

/** 本文は1行に収める（改行があると表がずれるため）。 */
function flatten(text) {
  return String(text ?? '').replace(/\r?\n/g, ' ').trim();
}

/**
 * 直近の投稿を、見出しに合わせた行の配列にする。
 * @param {object} opts
 * @param {number} [opts.hours]       何時間ぶんを対象にするか
 * @param {number} [opts.minLikes]    このいいね数以上だけに絞る（0 なら全部）
 * @param {number} [opts.limit]
 */
export async function buildReport({ hours = 48, minLikes = 0, limit = 500 } = {}) {
  const db = getDb();
  const target = likeTarget();
  const since = new Date(Date.now() - hours * 3600000).toISOString();

  const [postsSnap, accountsSnap] = await Promise.all([
    db.collection(COLLECTIONS.posts).where('postedAt', '>=', since).limit(limit).get(),
    db.collection(COLLECTIONS.accounts).get(),
  ]);

  const accounts = new Map(accountsSnap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));

  const posts = postsSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((p) => (p.status === 'posted' || p.status === 'deleted') && !p.dryRun)
    .sort((a, b) => String(b.postedAt ?? '').localeCompare(String(a.postedAt ?? '')));

  const rows = [];
  for (const post of posts) {
    if (minLikes > 0 && bestLikes(post) < minLikes) continue;

    const account = accounts.get(post.accountId);
    rows.push([
      toJstLabel(post.postedAt),
      account?.name ?? post.accountName ?? post.accountId,
      account ? attributeOf(account) : '',
      post.snap30?.likes ?? '',
      post.snap60?.likes ?? '',
      post.snap30?.views ?? '',
      post.snap60?.views ?? '',
      reachedTarget(post, target) ?? '',
      flatten(post.body),
      post.permalink ?? '',
      post.insightsError ?? '',
    ]);
  }

  return { target, hours, header: REPORT_HEADER, rows };
}

/** CSV にする（スプレッドシートの IMPORTDATA でも読めるように）。 */
export function toCsv({ header, rows }) {
  const cell = (v) => {
    const text = String(v ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [header, ...rows].map((row) => row.map(cell).join(',')).join('\r\n');
}
