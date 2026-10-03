import { Fragment } from 'react';
import { SNAP_POINTS, reachedTarget, bestLikes, hitRuleOf } from '@/lib/shared/snapshots.mjs';
import { likeTargets } from '@/lib/server/insights.mjs';
import { attributeOf } from '@/lib/server/profile.mjs';
import { toJstShort } from '@/lib/server/time.mjs';
import ReplyBox from './ReplyBox';

/**
 * よく伸びた投稿の一覧。
 * どの名義のどの文章がいいねを集めたかを、ひと目で分かるようにする。
 * 伸びた投稿には、その場で自分の言葉で返信を足せる。
 */
export default function TopPosts({ posts, accounts, hours = 24 }) {
  const targets = likeTargets();
  const accountMap = new Map(accounts.map((a) => [a.id, a]));

  const hits = posts
    .filter((p) => !p.dryRun && hitRuleOf(p, targets))
    .sort((a, b) => bestLikes(b) - bestLikes(a))
    .slice(0, 20);

  const measured = posts.filter((p) => !p.dryRun && (p.snap30 || p.snap60)).length;
  const problem = posts.find((p) => p.insightsError)?.insightsError ?? null;

  return (
    <section className="card">
      <div className="card-head">
        <div className="card-title">
          ✦ いいねが伸びた投稿 <small>直近{hours}時間・30分で{targets.snap30}いいね、または2時間で{targets.snap120}いいね</small>
        </div>
        <span className="badge" data-tone={hits.length ? 'ok' : 'default'}>
          {hits.length}件 / 記録できた {measured}件
        </span>
      </div>

      {problem && (
        <div className="notice" data-tone="danger">
          <strong>いいね数を取れていません。</strong>
          <div style={{ marginTop: 6 }}>{problem}</div>
        </div>
      )}

      {hits.length === 0 ? (
        <div className="stat-note">
          {measured === 0
            ? 'まだ記録がありません。投稿の30分後・1時間後に自動で記録します。'
            : `直近${hours}時間で、目標に届いた投稿はありません。`}
        </div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>投稿日時</th>
                <th>名義</th>
                <th>属性</th>
                <th className="num">30分後</th>
                <th className="num">1時間後</th>
                <th>本文</th>
              </tr>
            </thead>
            <tbody>
              {hits.map((p) => {
                const account = accountMap.get(p.accountId);
                const replies = Array.isArray(p.replies) ? p.replies : [];
                return (
                  <Fragment key={p.id}>
                  <tr>
                    <td>{toJstShort(p.postedAt)}</td>
                    <td>
                      <strong>@{account?.name ?? p.accountName ?? p.accountId}</strong>
                    </td>
                    <td>{account ? attributeOf(account) : ''}</td>
                    <td className="num">{p.snap30?.likes ?? '—'}</td>
                    <td className="num">
                      {p.snap60?.likes ?? '—'}
                      {reachedTarget(p, targets) && ' ★'}
                    </td>
                    <td>
                      {p.permalink ? (
                        <a href={p.permalink} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
                          {String(p.body ?? '').slice(0, 30)}…
                        </a>
                      ) : (
                        `${String(p.body ?? '').slice(0, 30)}…`
                      )}
                    </td>
                  </tr>
                  {/* 自分の言葉で返信を足す欄。この行の投稿にぶら下がります */}
                  <tr className="reply-row">
                    <td colSpan={6}>
                      <ReplyBox post={{ id: p.id }} replies={replies} />
                    </td>
                  </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
