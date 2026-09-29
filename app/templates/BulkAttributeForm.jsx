'use client';

import { useActionState } from 'react';
import { setTemplatesAttributes } from '../_actions/templates';
import SubmitButton from '../_components/SubmitButton';
import AttributePicker from './AttributePicker';

const initial = { ok: null, error: null };

/** いま絞り込んで表示している文章に、使わせる属性をまとめて設定する。 */
export default function BulkAttributeForm({ ids, label, choices }) {
  const [state, action] = useActionState(async (_p, fd) => setTemplatesAttributes(fd), initial);

  return (
    <details className="fold">
      <summary>絞り込んだ {ids.length} 本に、使わせる属性をまとめて設定する</summary>
      <form action={action} className="bulk-box">
        <input type="hidden" name="ids" value={JSON.stringify(ids)} />
        <p className="stat-note" style={{ marginTop: 0 }}>
          <strong>{label}</strong> の {ids.length} 本が対象です。選んだ属性の名義だけがこの文章を使うようになります。
          何も選ばずに保存すると、どの名義でも使う文章に戻ります。
        </p>
        <AttributePicker choices={choices} />
        <div className="editor-foot">
          <span>
            {state.error && <span className="over">{state.error}</span>}
            {state.ok && <span className="ok-text">{state.ok}</span>}
          </span>
          <SubmitButton className="btn btn-primary" pendingLabel="設定中…">
            まとめて設定
          </SubmitButton>
        </div>
      </form>
    </details>
  );
}
