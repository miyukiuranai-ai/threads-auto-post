'use client';

import { useActionState } from 'react';
import { deleteTemplatesBulk } from '../_actions/templates';
import SubmitButton from '../_components/SubmitButton';

const initial = { ok: null, error: null };

/** いま絞り込んで表示している文章を、まとめて消す。 */
export default function BulkDeleteForm({ ids, label }) {
  const [state, action] = useActionState(async (_p, fd) => deleteTemplatesBulk(fd), initial);

  return (
    <details className="fold">
      <summary>絞り込んだ {ids.length} 本をまとめて削除する</summary>
      <form action={action} className="remove-box">
        <input type="hidden" name="ids" value={JSON.stringify(ids)} />
        <p>
          <strong>{label} の {ids.length} 本を削除します。</strong>
          <br />
          元に戻せません。確認のため「削除」と入力してください。
        </p>
        <div className="remove-row">
          <input name="confirm" placeholder="削除" autoComplete="off" />
          <SubmitButton className="btn btn-reject" pendingLabel="削除中…">
            まとめて削除
          </SubmitButton>
        </div>
        {state.error && <div className="remove-note over">{state.error}</div>}
        {state.ok && <div className="remove-note ok-text">{state.ok}</div>}
      </form>
    </details>
  );
}
