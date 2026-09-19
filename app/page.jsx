import { listAccounts, listTemplates, listPostedToday, countPostsByStatus, listRecentErrors, lastRunAt, daysUntil } from '@/lib/server/repo.mjs';
import { getCurrentUser, filterAccountsForUser } from '@/lib/server/auth.mjs';
import { scheduleSummary, nextAutoAt, isAutoEnabled } from '@/lib/server/schedule.mjs';
import { cycleSummary } from '@/lib/server/templates.mjs';
import { postingMode } from '@/lib/server/publish.mjs';
import { toJstShort, toJstLabel } from '@/lib/server/time.mjs';
import { setAccountStatus } from './_actions/schedule';
import SubmitButton from './_components/SubmitButton';
import DashboardActions from './DashboardActions';

export const dynamic = 'force-dynamic';

function tokenTone(days) {
  if (days === null) return 'warn';
  if (days < 0) return 'danger';
  if (days < 10) return 'warn';
  return 'ok';
}

export default async function OverviewPage() {
  const user = await getCurrentUser();

  let accounts = [];
  let templates = [];
  let postedToday = [];
  let counts = {};
  let errors = [];
  let last = null;
  let dbError = null;

  try {
    accounts = filterAccountsForUser(await listAccounts(), user);
    const visible = new Set(accounts.map((a) => a.id));
    const [t, p, c, e, l] = await Promise.allSettled([listTemplates(), listPostedToday(), countPostsByStatus(), listRecentErrors({ limit: 5 }), lastRunAt()]);
    if (t.status === 'fulfilled') templates = t.value.filter((x) => x.accountId == null || visible.has(x.accountId));
    if (p.status === 'fulfilled') postedToday = p.value.filter((x) => visible.has(x.accountId));
    if (c.status === 'fulfilled') counts = c.value;
    if (e.status === 'fulfilled') errors = e.value;
    if (l.status === 'fulfilled') last = l.value;
  } catch (err) {
    dbError = err.message;
  }

  const now = new Date();
  const todayByAccount = new Map();
  for (const p of postedToday) todayByAccount.set(p.accountId, (todayByAccount.get(p.accountId) ?? 0) + 1);

  const enabledTemplates = templates.filter((t) => t.enabled !== false).length;
  const autoAccounts = accounts.filter((a) => (a.status ?? 'active') === 'active' && isAutoEnabled(a.schedule));
  const tickStale = last ? Date.now() - new Date(last).getTime() > 20 * 60000 : true;
  const expiring = accounts.filter((a) => {
    const d = daysUntil(a.tokenExpiresAt);
    return d !== null && d < 10;
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>全体状況</h1>
          <p className="page-desc">名義ごとの状態と、次に自動投稿が出る時刻。</p>
        </div>
        {!dbError && <DashboardActions count={accounts.length} />}
      </div>

      {postingMode() === 'dry_run' && (
        <div className="notice">
          <strong>テストモードです（POSTING_MODE=dry_run）。</strong> 投稿の流れは動きますが Threads には送りません。本番にするには環境変数を <code>POSTING_MODE=live</code> にします。
        </div>
      )}

      {dbError && (
        <div className="notice" data-tone="danger">
          <strong>Firestore に接続できていません。</strong>
          <div style={{ marginTop: 6 }}>{dbError}</div>
          <div style={{ marginTop: 6 }}>
            <code>docs/SETUP.md</code> の手順で設定してください。
          </div>
        </div>
      )}

      {!dbError && accounts.length === 0 && (
        <div className="notice">
          <strong>名義がまだありません。</strong>
          <div style={{ marginTop: 6 }}>
            <a href="/settings" style={{ color: 'var(--accent)' }}>
              名義の管理
            </a>{' '}
            でトークンを貼り付けて追加してください。
          </div>
        </div>
      )}

      {!dbError && autoAccounts.length > 0 && tickStale && (
        <div className="notice" data-tone="danger">
          <strong>定期実行が{last ? '20分以上' : 'まだ一度も'}動いていません。</strong>
          <div style={{ marginTop: 6 }}>
            自動投稿と予約投稿は、5分おきに <code>/api/cron/tick</code> を呼ぶ仕組みが動いていないと出ません（docs/SETUP.md の「定期実行」）。
            {last && ` 最後に動いたのは ${toJstLabel(last)} です。`}
          </div>
        </div>
      )}

      {expiring.length > 0 && (
        <div className="notice">
          <strong>トークンの期限が近い名義があります: </strong>
          {expiring.map((a) => `@${a.name}（${daysUntil(a.tokenExpiresAt) < 0 ? '失効' : `残り${daysUntil(a.tokenExpiresAt)}日`}）`).join('、')}。
          定期実行が自動で延長しますが、失効したものは名義の管理でトークンを入れ直してください。
        </div>
      )}

      <div className="grid grid-5" style={{ marginBottom: 20 }}>
        <div className="stat">
          <div className="stat-label">名義</div>
          <div className="stat-value">{accounts.length}</div>
          <div className="stat-note">自動投稿あり {autoAccounts.length}件</div>
        </div>
        <div className="stat">
          <div className="stat-label">今日の投稿</div>
          <div className="stat-value">{postedToday.length}</div>
          <div className="stat-note">日本時間の0時から</div>
        </div>
        <div className="stat">
          <div className="stat-label">予約中</div>
          <div className="stat-value">{(counts.scheduled ?? 0) + (counts.publishing ?? 0)}</div>
          <div className="stat-note">準備待ち {counts.publishing ?? 0}件を含む</div>
        </div>
        <div className="stat">
          <div className="stat-label">失敗</div>
          <div className="stat-value">{counts.failed ?? 0}</div>
          <div className="stat-note">
            <a href="/posts?filter=failed" style={{ color: 'var(--accent)' }}>
              投稿の履歴で確認
            </a>
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">文章ストック</div>
          <div className="stat-value">{enabledTemplates}</div>
          <div className="stat-note">有効な本数（全 {templates.length} 本）</div>
        </div>
      </div>

      <section className="card">
        <div className="card-head">
          <div className="card-title">
            ✦ 名義ごとの状態 <small>{accounts.length}件</small>
          </div>
          <span className="stat-note">{last ? `定期実行: ${toJstShort(last)}` : ''}</span>
        </div>

        {accounts.length === 0 ? (
          <div className="stat-note">名義を追加すると、ここに一覧が出ます。</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>名義</th>
                  <th>状態</th>
                  <th>自動投稿</th>
                  <th>次の自動投稿</th>
                  <th className="num">今日</th>
                  <th>最終投稿</th>
                  <th>文章の残り</th>
                  <th>トークン</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => {
                  const active = (a.status ?? 'active') === 'active';
                  const next = active ? nextAutoAt({ now, schedule: a.schedule }) : null;
                  const cycle = cycleSummary(a);
                  const days = daysUntil(a.tokenExpiresAt);
                  return (
                    <tr key={a.id}>
                      <td>
                        <strong>@{a.name}</strong>
                      </td>
                      <td>
                        <form action={setAccountStatus}>
                          <input type="hidden" name="accountId" value={a.id} />
                          <input type="hidden" name="status" value={active ? 'paused' : 'active'} />
                          <SubmitButton className={active ? 'btn btn-approve' : 'btn btn-hold'} pendingLabel="…" title="押すと切り替わります">
                            {active ? '稼働中' : '停止中'}
                          </SubmitButton>
                        </form>
                      </td>
                      <td>
                        {scheduleSummary(a.schedule)}
                        {a.schedule?.tag && <div className="post-slot">タグ「{a.schedule.tag}」</div>}
                      </td>
                      <td>{!active ? '—' : !isAutoEnabled(a.schedule) ? '—' : next ? toJstShort(next) : '次の定期実行で決定'}</td>
                      <td className="num">{todayByAccount.get(a.id) ?? 0}</td>
                      <td>{a.lastPostedAt ? toJstShort(a.lastPostedAt) : '—'}</td>
                      <td>{cycle ? `${cycle.remaining} / ${cycle.total}` : '—'}</td>
                      <td>
                        <span className="badge" data-tone={tokenTone(days)}>
                          {days === null ? '不明' : days < 0 ? '失効' : `${days}日`}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <div className="card-title">
            ✦ 直近のエラー <small>定期実行のログから抽出します。</small>
          </div>
        </div>
        {errors.length === 0 ? (
          <div className="stat-note">エラーはありません。</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>日時</th>
                <th>処理</th>
                <th>内容</th>
              </tr>
            </thead>
            <tbody>
              {errors.map((e) => (
                <tr key={e.id}>
                  <td>{toJstLabel(e.startedAt)}</td>
                  <td>{e.job ?? '-'}</td>
                  <td>{e.message ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
