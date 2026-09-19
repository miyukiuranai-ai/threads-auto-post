'use client';

import { useActionState, useState } from 'react';
import { cancelPost, reschedulePost, updatePostBody, retryPostNow, deletePostRecord, deleteFromThreads } from '../_actions/posts';
import SubmitButton from '../_components/SubmitButton';

export const STATUS_LABEL = {
  scheduled: { text: '予約中', tone: 'accent' },
  publishing: { text: '投稿中（準備待ち）', tone: 'warn' },
  posted: { text: '投稿済み', tone: 'ok' },
  failed: { text: '失敗', tone: 'danger' },
  missed: { text: '時刻切れ', tone: 'danger' },
  canceled: { text: '取消', tone: 'default' },
  skipped: { text: '見送り', tone: 'default' },
  deleted: { text: 'Threads から削除済み', tone: 'default' },
};

const SOURCE_LABEL = {
  auto: '自動（ストックから）',
  manual: '予約',
  manual_now: '今すぐ投稿',
};

const initial = { ok: null, error: null };

export default function PostRow({ post, label, scheduledLocal, showAccount }) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(post.body ?? '');
  const status = STATUS_LABEL[post.status] ?? { text: post.status, tone: 'default' };
  const media = Array.isArray(post.media) ? post.media : [];
  const [retryState, retry] = useActionState(async (_p, fd) => retryPostNow(fd), initial);
  const [deleteState, removeFromThreads] = useActionState(async (_p, fd) => deleteFromThreads(fd), initial);
  const editable = ['scheduled', 'failed', 'missed', 'canceled'].includes(post.status);

  return (
    <article className="post-row">
      <div>
        <div className="post-time">{label.split(' ')[1] ?? label}</div>
        <div className="post-slot">{label.split(' ')[0]}</div>
        {showAccount && <div className="post-slot">@{post.accountName ?? post.accountId}</div>}
        <div className="post-slot">{SOURCE_LABEL[post.source] ?? post.source ?? '-'}</div>
        {post.dryRun && <div className="post-slot">テスト（送っていない）</div>}
      </div>

      <div>
        {editing ? (
          <form action={updatePostBody}>
            <input type="hidden" name="postId" value={post.id} />
            <textarea name="body" className="editor" rows={Math.min(20, body.split('\n').length + 2)} value={body} onChange={(e) => setBody(e.target.value)} />
            <div className="editor-foot">
              <span className={[...body].length > 500 ? 'over' : ''}>{[...body].length} / 500文字</span>
              <span className="actions-row">
                <SubmitButton className="btn btn-primary" pendingLabel="保存中…" disabled={[...body].length > 500}>
                  保存
                </SubmitButton>
                <button type="button" className="btn" onClick={() => { setBody(post.body ?? ''); setEditing(false); }}>
                  取消
                </button>
              </span>
            </div>
          </form>
        ) : (
          <div className="post-body">{post.body || <span className="stat-note">（本文なし）</span>}</div>
        )}

        {media.length > 0 && (
          <div className="post-slot" style={{ marginTop: 6 }}>
            添付: {media.map((m) => (m.kind === 'video' ? '動画' : '画像')).join('・')}（{media.length}個）
          </div>
        )}
        {post.error && (
          <div className="post-slot" style={{ color: 'var(--danger)', marginTop: 6 }}>
            {post.error}
          </div>
        )}
        {post.permalink && (
          <div className="post-slot" style={{ marginTop: 6 }}>
            <a href={post.permalink} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
              投稿を開く ↗
            </a>
          </div>
        )}

        {post.status === 'scheduled' && (
          <form action={reschedulePost} className="schedule-form">
            <input type="hidden" name="postId" value={post.id} />
            <label>
              予定時刻
              <input type="datetime-local" name="scheduledAtLocal" defaultValue={scheduledLocal} />
            </label>
            <SubmitButton className="btn" pendingLabel="変更中…">
              変更
            </SubmitButton>
          </form>
        )}

        {retryState.error && <div className="remove-note over">{retryState.error}</div>}
        {retryState.ok && <div className="remove-note ok-text">{retryState.ok}</div>}
        {deleteState.error && <div className="remove-note over">{deleteState.error}</div>}
        {deleteState.ok && <div className="remove-note ok-text">{deleteState.ok}</div>}
      </div>

      <div className="post-actions">
        <span className="badge" data-tone={status.tone}>
          {status.text}
        </span>

        <div className="actions-row">
          {editable && (
            <button type="button" className="btn" onClick={() => setEditing((v) => !v)}>
              {editing ? '閉じる' : '本文を編集'}
            </button>
          )}
          {['scheduled', 'failed'].includes(post.status) && (
            <form action={cancelPost}>
              <input type="hidden" name="postId" value={post.id} />
              <SubmitButton className="btn btn-hold" pendingLabel="…">
                取消
              </SubmitButton>
            </form>
          )}
        </div>

        {['failed', 'missed', 'canceled'].includes(post.status) && (
          <form action={retry}>
            <input type="hidden" name="postId" value={post.id} />
            <SubmitButton className="btn btn-approve" pendingLabel="送信中…">
              今すぐ送り直す
            </SubmitButton>
          </form>
        )}

        {post.status === 'posted' && post.postedThreadId && !post.dryRun && (
          <form
            action={removeFromThreads}
            onSubmit={(e) => {
              if (!window.confirm('Threads からこの投稿を消します。戻せません。よろしいですか？')) e.preventDefault();
            }}
          >
            <input type="hidden" name="postId" value={post.id} />
            <SubmitButton className="btn btn-reject" pendingLabel="削除中…">
              Threads から削除
            </SubmitButton>
          </form>
        )}

        {!['scheduled', 'publishing'].includes(post.status) && (
          <form action={deletePostRecord}>
            <input type="hidden" name="postId" value={post.id} />
            <SubmitButton className="btn" pendingLabel="…" title="この画面の記録だけを消します。Threads 側はそのままです">
              記録を消す
            </SubmitButton>
          </form>
        )}
      </div>
    </article>
  );
}
