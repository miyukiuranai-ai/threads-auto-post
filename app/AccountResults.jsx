import { SNAP_POINTS } from '@/lib/shared/snapshots.mjs';
import { likeTarget } from '@/lib/server/insights.mjs';
import { attributeOf } from '@/lib/server/profile.mjs';
import { toJstShort } from '@/lib/server/time.mjs';

/**
 * 名義ごとの成果。
 * 「30分後にいいねが目標に届いた名義」がひと目で分かるようにする。
 * どの名義が伸びているかを見て、投稿の型や時間を決めるため。
 */
export default function AccountResults({ posts, accounts, hours, periods = [] }) {
  const target = likeTarget();

  // 名義ごとに、記録できた投稿数と、各時点で目標に届いた数を数える
  const stats = accounts.map((account) => {
    const mine = posts.filter((p) => p.accountId === account.id && !p.dryRun);
    const measured = mine.filter((p) => p.snap30 || p.snap60);

    const hit30 = mine.filter((p) => (p.snap30?.likes ?? 0) >= target);
    const hit60 = mine.filter((p) => (p.snap60?.likes ?? 0) >= target);
    const bestAt30 = Math.max(...mine.map((p) => p.snap30?.likes ?? 0), 0);
    const latestHit = hit30.sort((a, b) => String(b.postedAt ?? '').localeCompare(String(a.postedAt ?? '')))[0] ?? null;

    return {
      account,
      posted: mine.length,
      measured: measured.length,
      hit30: hit30.length,
      hit60: hit60.length,
      bestAt30,
      latestHit,
      problem: mine.find((p) => p.insightsError)?.insightsError ?? null,
    };
  });

  const ranked = [...stats].sort((a, b) => b.hit30 - a.hit30 || b.bestAt30 - a.bestAt30 || b.measured - a.measured);
  const reached = ranked.filter((s) => s.hit30 > 0);
  const anyMeasured = stats.some((s) => s.measured > 0);

  return (
    <section className="card">
      <div className="card-head">
        <div className="card-title">
          ✦ 30分後にいいね{target}以上に届いた名義 <small>直近{hours}時間</small>
        </div>
        <span className="actions-row">
          {periods.map((p) => (
            <a key={p.hours} className="filter-chip" data-active={p.hours === hours} href={p.href}>
              {p.label}
            </a>
          ))}
        </span>
      </div>

      {accounts.length === 0 ? (
        <div className="stat-note">名義がまだありません。</div>
      ) : !anyMeasured ? (
        <div className="stat-note">
          まだいいね数の記録がありません。投稿の30分後・1時間後に自動で記録します。
          {stats.find((s) => s.problem) && (
            <div className="over" style={{ marginTop: 6 }}>{stats.find((s) => s.problem).problem}</div>
          )}
        </div>
      ) : (
        <>
          <div className="stat-note" style={{ marginBottom: 12 }}>
            {reached.length > 0 ? (
              <>
                届いた名義: <strong>{reached.map((s) => `@${s.account.name}`).join('・')}</strong>
              </>
            ) : (
              `直近${hours}時間で、30分後にいいね${target}以上に届いた名義はありません。`
            )}
          </div>

          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>名義</th>
                  <th>属性</th>
                  <th className="num">30分で到達</th>
                  <th className="num">1時間で到達</th>
                  <th className="num">記録できた</th>
                  <th className="num">30分の最高</th>
                  <th>直近の到達</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((s) => (
                  <tr key={s.account.id} data-hit={s.hit30 > 0}>
                    <td>
                      <strong>@{s.account.name}</strong>
                      {s.problem && <div className="post-slot over">いいね数を取れていません</div>}
                    </td>
                    <td>{attributeOf(s.account)}</td>
                    <td className="num">
                      {s.hit30 > 0 ? (
                        <span className="badge" data-tone="ok">
                          {s.hit30}件
                        </span>
                      ) : (
                        '0'
                      )}
                    </td>
                    <td className="num">{s.hit60}</td>
                    <td className="num">
                      {s.measured} / {s.posted}
                    </td>
                    <td className="num">{s.bestAt30 || '—'}</td>
                    <td>
                      {s.latestHit ? (
                        <>
                          {toJstShort(s.latestHit.postedAt)}
                          <div className="post-slot">
                            {s.latestHit.permalink ? (
                              <a href={s.latestHit.permalink} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
                                {String(s.latestHit.body ?? '').slice(0, 24)}…
                              </a>
                            ) : (
                              `${String(s.latestHit.body ?? '').slice(0, 24)}…`
                            )}
                          </div>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="stat-note" style={{ marginTop: 10 }}>
            「記録できた」は、{SNAP_POINTS.map((p) => p.label).join('と')}の数字を取れた投稿の数です。投稿してから30分経つまでは記録されません。
          </div>
        </>
      )}
    </section>
  );
}
