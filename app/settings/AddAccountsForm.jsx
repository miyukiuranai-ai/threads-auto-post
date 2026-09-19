'use client';

import { useActionState } from 'react';
import { addAccounts } from '../_actions/accounts';
import SubmitButton from '../_components/SubmitButton';

const initial = { ok: null, error: null, results: null };

export default function AddAccountsForm({ isAdmin }) {
  const [state, action] = useActionState(async (_prev, formData) => addAccounts(formData), initial);

  return (
    <form action={action}>
      <p className="stat-note" style={{ marginTop: 0, marginBottom: 10 }}>
        Meta for Developers の「ユーザートークン生成ツール」で発行した長期アクセストークンを貼り付けてください。
        <strong>1行に1つ</strong>ずつ貼れば、まとめて登録できます。持ち主を確認して登録し、登録直後は自動投稿の設定が空なので、設定するまで自動では投稿されません。
      </p>

      <textarea name="accessTokens" className="editor" rows={4} placeholder={'THAAX... で始まる長いトークンを貼り付け\nTHAAX... （2つ目の名義）\nTHAAX... （3つ目の名義）'} required />

      {isAdmin && (
        <div className="field-row" style={{ marginTop: 10 }}>
          <span className="stat-note">担当グループ（任意）</span>
          <input name="group" placeholder="main" className="inline-input" style={{ width: 140 }} />
          <small className="stat-note">メンバーを分けて使うときだけ。普段は空でよい。</small>
        </div>
      )}

      <div className="editor-foot">
        <span>
          {state.error && <span className="over">{state.error}</span>}
          {state.ok && <span className="ok-text">{state.ok}</span>}
        </span>
        <SubmitButton className="btn btn-primary" pendingLabel="確認中…">
          名義を追加
        </SubmitButton>
      </div>

      {state.results && (
        <ul className="result-list">
          {state.results.map((r) => (
            <li key={r.line}>
              <span className="stat-note">{r.line}行目</span>
              {r.account && <strong>@{r.account}</strong>}
              <span className="badge" data-tone={r.result === 'failed' ? 'danger' : 'ok'}>
                {r.result === 'added' ? '追加' : r.result === 'updated' ? 'トークン更新' : '失敗'}
              </span>
              {r.reason && <span className="stat-note">{r.reason}</span>}
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
