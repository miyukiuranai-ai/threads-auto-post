'use client';

import { useActionState, useState } from 'react';
import { replyToPost } from './_actions/posts';
import SubmitButton from './_components/SubmitButton';

const initial = { ok: null, error: null };

/**
 * 伸びた投稿へ、自分で考えた返信を送る欄。
 * 書いた文章がそのまま返信になります（ツールが文章を考えることはありません）。
 */
export default function ReplyBox({ post, replies = [] }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [state, send] = useActionState(async (_p, fd) => {
    const r = await replyToPost(fd);
    if (r.ok) setBody('');
    return r;
  }, initial);

  const length = [...body].length;

  return (
    <div className="reply-box">
      {replies.length > 0 && (
        <ul className="reply-done">
          {replies.map((r, i) => (
            <li key={r.id ?? i}>
              <span className="badge" data-tone="ok">
                返信済み
              </span>
              <span>{r.body}</span>
            </li>
          ))}
        </ul>
      )}

      {!open ? (
        <button type="button" className="btn" onClick={() => setOpen(true)}>
          {replies.length ? 'もう一度返信する' : 'この投稿に返信する'}
        </button>
      ) : (
        <form action={send}>
          <input type="hidden" name="postId" value={post.id} />
          <textarea
            name="body"
            className="editor"
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="ここに書いた文章が、そのまま返信として送られます"
          />
          <div className="editor-foot">
            <span>
              <span className={length > 500 ? 'over' : 'stat-note'}>{length} / 500</span>
              {state.error && <span className="over" style={{ marginLeft: 10 }}>{state.error}</span>}
              {state.ok && <span className="ok-text" style={{ marginLeft: 10 }}>{state.ok}</span>}
            </span>
            <span className="actions-row">
              <button type="button" className="btn" onClick={() => setOpen(false)}>
                閉じる
              </button>
              <SubmitButton className="btn btn-primary" pendingLabel="送信中…" disabled={!body.trim() || length > 500}>
                返信を送る
              </SubmitButton>
            </span>
          </div>
        </form>
      )}
    </div>
  );
}
