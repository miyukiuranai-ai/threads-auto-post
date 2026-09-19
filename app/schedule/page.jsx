import { listAccounts, listTemplates } from '@/lib/server/repo.mjs';
import { getCurrentUser, filterAccountsForUser } from '@/lib/server/auth.mjs';
import { scheduleSummary, nextAutoAt, isAutoEnabled } from '@/lib/server/schedule.mjs';
import { cycleSummary } from '@/lib/server/templates.mjs';
import { toJstShort } from '@/lib/server/time.mjs';
import { setAccountStatus, resetCycle } from '../_actions/schedule';
import SubmitButton from '../_components/SubmitButton';
import ScheduleEditor from './ScheduleEditor';

export const dynamic = 'force-dynamic';

export default async function SchedulePage({ searchParams }) {
  const params = await searchParams;
  const user = await getCurrentUser();

  let accounts = [];
  let tags = [];
  let dbError = null;
  try {
    accounts = filterAccountsForUser(await listAccounts(), user);
    tags = [...new Set((await listTemplates()).flatMap((t) => t.tags ?? []))].sort();
  } catch (err) {
    dbError = err.message;
  }

  const loadFrom = params?.load && accounts.some((a) => a.id === params.load) ? params.load : null;
  const now = new Date();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>自動投稿の設定</h1>
          <p className="page-desc">名義ごとに「毎日の時刻」と「〇〜〇時間おき」を決めます。文章は文章ストックから自動で選ばれます。予約投稿・今すぐ投稿はこの設定と関係なくいつでもできます。</p>
        </div>
      </div>

      {dbError && (
        <div className="notice" data-tone="danger">
          <strong>Firestore に接続できていません。</strong>
          <div style={{ marginTop: 6 }}>{dbError}</div>
        </div>
      )}

      <section className="card">
        <div className="card-head">
          <div className="card-title">
            ✦ いまの設定 <small>{accounts.length}件</small>
          </div>
        </div>
        {accounts.length === 0 ? (
          <div className="stat-note">名義がまだありません。「名義の管理」でトークンを登録してください。</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>名義</th>
                  <th>状態</th>
                  <th>自動投稿</th>
                  <th>次の自動投稿</th>
                  <th>文章の一巡</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => {
                  const active = (a.status ?? 'active') === 'active';
                  const next = active ? nextAutoAt({ now, schedule: a.schedule }) : null;
                  const cycle = cycleSummary(a);
                  return (
                    <tr key={a.id}>
                      <td>
                        <strong>@{a.name}</strong>
                      </td>
                      <td>
                        <span className="badge" data-tone={active ? 'ok' : 'warn'}>
                          {active ? '稼働中' : '停止中'}
                        </span>
                      </td>
                      <td>
                        {scheduleSummary(a.schedule)}
                        {a.schedule?.tag && <div className="post-slot">タグ「{a.schedule.tag}」だけ</div>}
                      </td>
                      <td>{!active ? '停止中' : !isAutoEnabled(a.schedule) ? '—' : next ? toJstShort(next) : '計算中（次の定期実行で決まります）'}</td>
                      <td>
                        {cycle ? (
                          <>
                            {cycle.used} / {cycle.total} 本使用
                            <div className="post-slot">残り {cycle.remaining} 本</div>
                          </>
                        ) : (
                          <span className="stat-note">まだ使っていません</span>
                        )}
                      </td>
                      <td>
                        <div className="actions-row">
                          <a className="btn" href={`/schedule?load=${a.id}#editor`}>
                            この設定を読み込む
                          </a>
                          <form action={setAccountStatus}>
                            <input type="hidden" name="accountId" value={a.id} />
                            <input type="hidden" name="status" value={active ? 'paused' : 'active'} />
                            <SubmitButton className={active ? 'btn btn-hold' : 'btn btn-approve'} pendingLabel="…">
                              {active ? '停止' : '稼働'}
                            </SubmitButton>
                          </form>
                          {cycle && (
                            <form action={resetCycle}>
                              <input type="hidden" name="accountId" value={a.id} />
                              <SubmitButton className="btn" pendingLabel="…" title="使った記録を消して、また全部の文章から選び直します">
                                一巡をやり直す
                              </SubmitButton>
                            </form>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div id="editor" />
      <ScheduleEditor key={loadFrom ?? 'new'} accounts={accounts.map((a) => ({ id: a.id, name: a.name, status: a.status ?? 'active', schedule: a.schedule ?? null }))} tags={tags} loadFrom={loadFrom} />
    </>
  );
}
