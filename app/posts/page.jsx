import { listAccounts, listPosts } from '@/lib/server/repo.mjs';
import { getCurrentUser, filterAccountsForUser } from '@/lib/server/auth.mjs';
import { toJstLabel, toLocalInput } from '@/lib/server/time.mjs';
import PostRow from './PostRow';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const FILTERS = [
  { key: 'upcoming', label: '予約中', statuses: ['scheduled', 'publishing'] },
  { key: 'posted', label: '投稿済み', statuses: ['posted', 'deleted'] },
  { key: 'failed', label: '失敗・時刻切れ', statuses: ['failed', 'missed'] },
  { key: 'other', label: '取消・見送り', statuses: ['canceled', 'skipped'] },
  { key: 'all', label: 'すべて', statuses: null },
];

export default async function PostsPage({ searchParams }) {
  const params = await searchParams;
  const user = await getCurrentUser();

  let accounts = [];
  let dbError = null;
  try {
    accounts = filterAccountsForUser(await listAccounts(), user);
  } catch (err) {
    dbError = err.message;
  }

  const accountId = params?.account && accounts.some((a) => a.id === params.account) ? params.account : '';
  const filterKey = params?.filter ?? 'upcoming';
  const filter = FILTERS.find((f) => f.key === filterKey) ?? FILTERS[0];

  let all = [];
  if (!dbError) {
    try {
      all = await listPosts(accountId || null);
      // 全名義のときは、見られる名義の分だけに絞る
      if (!accountId) {
        const visible = new Set(accounts.map((a) => a.id));
        all = all.filter((p) => visible.has(p.accountId));
      }
    } catch (err) {
      dbError = err.message;
    }
  }

  const posts = filter.statuses ? all.filter((p) => filter.statuses.includes(p.status)) : all;
  // 予約中は近い順、それ以外は新しい順
  if (filter.key === 'upcoming') posts.sort((a, b) => String(a.scheduledAt ?? '').localeCompare(String(b.scheduledAt ?? '')));

  const counts = all.reduce((acc, p) => {
    acc[p.status] = (acc[p.status] ?? 0) + 1;
    return acc;
  }, {});

  const query = (extra) => {
    const q = new URLSearchParams();
    const next = { account: accountId, filter: filter.key, ...extra };
    if (next.account) q.set('account', next.account);
    if (next.filter) q.set('filter', next.filter);
    return `/posts?${q.toString()}`;
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>投稿の予定と履歴</h1>
          <p className="page-desc">予約の変更・取消と、投稿した結果をここで確かめます。直近300件まで表示します。</p>
        </div>
      </div>

      {dbError && (
        <div className="notice" data-tone="danger">
          <strong>Firestore に接続できていません。</strong>
          <div style={{ marginTop: 6 }}>{dbError}</div>
        </div>
      )}

      <div className="filter-row">
        <a className="filter-chip" data-active={!accountId} href={query({ account: '' })}>
          全名義
        </a>
        {accounts.map((a) => (
          <a key={a.id} className="filter-chip" data-active={a.id === accountId} href={query({ account: a.id })}>
            @{a.name}
          </a>
        ))}
      </div>

      <div className="filter-row">
        {FILTERS.map((f) => {
          const n = f.statuses ? f.statuses.reduce((sum, s) => sum + (counts[s] ?? 0), 0) : all.length;
          return (
            <a key={f.key} className="filter-chip" data-active={f.key === filter.key} href={query({ filter: f.key })}>
              {f.label} {n}
            </a>
          );
        })}
      </div>

      <section className="card">
        <div className="card-head">
          <div className="card-title">
            ✦ {accountId ? `@${accounts.find((a) => a.id === accountId)?.name}` : '全名義'}
            <small>
              {filter.label} {posts.length}件
            </small>
          </div>
        </div>

        {posts.length === 0 ? (
          <div className="empty">該当する投稿はありません。</div>
        ) : (
          <div>
            {posts.map((p) => (
              <PostRow key={p.id} post={p} label={toJstLabel(p.scheduledAt ?? p.createdAt)} scheduledLocal={toLocalInput(p.scheduledAt)} showAccount={!accountId} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
