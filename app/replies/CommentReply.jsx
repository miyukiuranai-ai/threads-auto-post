'use client';

import { useActionState, useState } from 'react';
import { sendCommentReply } from '../_actions/comments';
import SubmitButton from '../_components/SubmitButton';

const initial = { ok: null, error: null };

/**
 * 1件のコメントへ返す欄。
 * 書いた文章がそのまま送られます（ツールが文章を考えることはありません）。
 */
export default function CommentReply({ postId, comment }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [state, send] = useActionState(async (_p, fd) => {
    const r = await sendCommentReply(fd);
    if (r.ok) {
      setBody('');
      setOpen(false);
    }
    return r;
  }, initial);

  const length = [...body].length;

  return (
    <div className="comment-reply">
      {state.ok && <div className="ok-text">{state.ok}</div>}
      {state.error && <div className="over">{state.error}</div>}

      {!open ? (
        <button type="button" className="btn" onClick={() => setOpen(true)}>
          返信する
        </button>
      ) : (
        <form action={send}>
          <input type="hidden" name="postId" value={postId} />
          <input type="hidden" name="commentId" value={comment.id} />
          <textarea
            name="body"
            className="editor"
            rows={2}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={`@${comment.username} への返信`}
            autoFocus
          />
          <div className="editor-foot">
            <span className={length > 500 ? 'over' : 'stat-note'}>{length} / 500</span>
            <span className="actions-row">
              <button type="button" className="btn" onClick={() => setOpen(false)}>
                やめる
              </button>
              <SubmitButton className="btn btn-primary" pendingLabel="送信中…" disabled={!body.trim() || length > 500}>
                送る
              </SubmitButton>
            </span>
          </div>
        </form>
      )}
    </div>
  );
}
