import Link from 'next/link';
import { listAccounts, listPostedSince, getAccountWithToken } from '@/lib/server/repo.mjs';
import { getCurrentUser, filterAccountsForUser } from '@/lib/server/auth.mjs';
import { hitPosts, likeTargets } from '@/lib/server/insights.mjs';
import { loadComments } from '@/lib/server/comments.mjs';
import { getDb, COLLECTIONS } from '@/lib/server/firebase.mjs';
import { toJstShort } from '@/lib/server/time.mjs';
import CommentReply from './CommentReply';

export const dynamic = 'force-dynamic';

const TONE_LABEL = { green: '30分で伸びた', red: '2時間で伸びた' };

export default async function RepliesPage({ searchParams }) {
  const params = await searchParams;
  const postId = params?.post ? String(params.post) : null;
  const user = await getCurrentUser();
  const targets = likeTargets();

  let accounts = [];
  let hits = [];
  let dbError = null;
  try {
    accounts = filterAccountsForUser(await listAccounts(), user);
    const since = new Date(Date.now() - 24 * 3600000).toISOString();
    const visible = new Set(accounts.map((a) => a.id));
    const posts = (await listPostedSince(since)).filter((p) => visible.has(p.accountId));
    hits = hitPosts({ posts, accounts, targets });
  } catch (err) {
    dbError = err.message;
  }

  const chosen = postId ? hits.find((h) => h.postId === postId) ?? null : null;

  // 選ばれた投稿のコメントを、いま Threads へ聞きにいく（ためておかない）
  let comments = [];
  let commentError = null;
  if (chosen) {
    const snap = await getDb().collection(COLLECTIONS.posts).doc(chosen.postId).get();
    const post = snap.exists ? { id: snap.id, ...snap.data() } : null;
    const account = await getAccountWithToken(chosen.accountId);
    const loaded = await loadComments({ account, post });
    comments = loaded.replies;
    commentError = loaded.error;
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>伸びた投稿のコメント</h1>
          <p className="page-desc">
            いいねが伸びた投稿に、いま付いているコメントを出します。ためておかず、この画面を開いたときに取りにいくので、
            画面を開き直すと最新になります。コメントごとに、その場で自分の言葉で返信できます。
          </p>
        </div>
      </div>

      {dbError && (
        <div className="notice" data-tone="danger">
          <strong>Firestore に接続できていません。</strong>
          <div style={{ marginTop: 6 }}>{dbError}</div>
        </div>
      )}

      {/* 伸びた投稿の一覧。左のメニューの ID を押しても、ここへ来ます */}
      <section className="card">
        <div className="card-head">
          <div className="card-title">
            ✦ 伸びた投稿 <small>直近24時間・緑は30分で{targets.snap30}いいね、赤は2時間で{targets.snap120}いいね</small>
          </div>
          <span className="badge" data-tone={hits.length ? 'ok' : 'default'}>
            {hits.length}件
          </span>
        </div>

        {hits.length === 0 ? (
          <div className="stat-note">
            直近24時間で、目標に届いた投稿はありません。届いた投稿が出ると、ここと左のメニューに並びます。
          </div>
        ) : (
          <div className="hit-picker">
            {hits.map((h) => (
              <Link
                key={h.postId}
                href={`/replies?post=${encodeURIComponent(h.postId)}`}
                className="hit-card"
                data-tone={h.tone}
                data-active={h.postId === chosen?.postId}
              >
                <span className="hit-card-head">
                  <strong>@{h.name}</strong>
                  <span className="badge" data-tone={h.tone === 'red' ? 'danger' : 'ok'}>
                    {h.ruleLabel} {h.likes}
                  </span>
                </span>
                <span className="hit-card-body">{h.body.slice(0, 40)}…</span>
                <span className="stat-note">{toJstShort(h.postedAt)}</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {chosen && (
        <section className="card">
          <div className="card-head">
            <div className="card-title">
              ✦ @{chosen.name} の投稿に付いたコメント
              <small>
                {TONE_LABEL[chosen.tone]}（{chosen.ruleLabel}にいいね{chosen.likes}）
              </small>
            </div>
            {chosen.permalink && (
              <a className="btn" href={chosen.permalink} target="_blank" rel="noreferrer">
                Threads で開く
              </a>
            )}
          </div>

          <div className="origin-post">{chosen.body}</div>

          {commentError && (
            <div className="notice" data-tone="danger">
              <strong>コメントを取れませんでした。</strong>
              <div style={{ marginTop: 6 }}>{commentError}</div>
            </div>
          )}

          {!commentError && comments.length === 0 && (
            <div className="stat-note">いまのところコメントは付いていません。</div>
          )}

          {comments.length > 0 && (
            <ul className="comment-list">
              {comments.map((c) => (
                <li key={c.id} data-mine={c.isMine}>
                  <div className="comment-head">
                    <strong>@{c.username}</strong>
                    {c.isMine && (
                      <span className="badge" data-tone="accent">
                        自分
                      </span>
                    )}
                    <span className="stat-note">{c.at ? toJstShort(c.at) : ''}</span>
                    {c.hidden && (
                      <span className="badge" data-tone="warn">
                        非表示
                      </span>
                    )}
                    {c.permalink && (
                      <a href={c.permalink} target="_blank" rel="noreferrer" className="stat-note">
                        元を見る
                      </a>
                    )}
                  </div>
                  <div className="comment-text">{c.text}</div>
                  <CommentReply postId={chosen.postId} comment={c} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
