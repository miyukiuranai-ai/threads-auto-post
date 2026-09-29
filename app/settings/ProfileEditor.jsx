'use client';

import { useActionState, useState } from 'react';
import { setAccountProfile } from '../_actions/accounts';
import SubmitButton from '../_components/SubmitButton';
import { SUGGESTED_KEYS, SUGGESTED_VALUES, PROFILE_LIMITS } from '@/lib/server/profile.mjs';

const initial = { ok: null, error: null };

/**
 * 名義の属性（年齢・職業など）の編集。
 * ここで入れた値が、文章の中の {職業} のような書き方に差し込まれる。
 */
export default function ProfileEditor({ account, needed = [] }) {
  const [state, save] = useActionState(async (_p, fd) => setAccountProfile(fd), initial);

  // 保存済みの属性と、文章が求めているのにまだ無い項目を並べる
  const [rows, setRows] = useState(() => {
    const saved = Object.entries(account.profile ?? {}).map(([key, value]) => ({ key, value: String(value ?? '') }));
    const lacking = needed.filter((k) => k !== 'ユーザー名' && !saved.some((r) => r.key === k)).map((key) => ({ key, value: '' }));
    const rest = saved.length + lacking.length === 0 ? [{ key: '', value: '' }] : [];
    return [...saved, ...lacking, ...rest];
  });

  const update = (i, field) => (e) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, [field]: e.target.value } : r)));
  const removeRow = (i) => setRows((prev) => prev.filter((_, j) => j !== i));
  const addRow = () => setRows((prev) => [...prev, { key: '', value: '' }]);

  const filledKeys = rows.filter((r) => r.key.trim() && r.value.trim()).map((r) => r.key.trim());
  const stillMissing = needed.filter((k) => k !== 'ユーザー名' && !filledKeys.includes(k));

  return (
    <form action={save} className="profile-box">
      <input type="hidden" name="accountId" value={account.id} />
      <input type="hidden" name="profile" value={JSON.stringify(rows)} />

      <p className="stat-note" style={{ marginTop: 0 }}>
        ここで入れた値が、文章の中の <code>{'{項目名}'}</code> に差し込まれます。たとえば「属性」に <strong>看護師</strong> と入れておくと、
        <code>{'{属性}'}だから夜は遅くて</code> と書いた文章が「看護師だから夜は遅くて」として投稿されます。
        <br />
        「属性」には人物像を表す言葉を入れます（看護師・保育士・教師・CA・女子大生・アラサー・おばさん・シンママ など）。
        年齢や住まいなど、別の言葉に置き換えたいものは項目を足してください。
      </p>

      <div className="profile-rows">
        {rows.map((row, i) => (
          <div className="profile-row" key={i}>
            <input
              list="profile-keys"
              value={row.key}
              onChange={update(i, 'key')}
              placeholder="項目名（例: 属性）"
              maxLength={PROFILE_LIMITS.keyLength}
              aria-label="項目名"
            />
            <span className="profile-eq">:</span>
            <input
              list={SUGGESTED_VALUES[row.key.trim()] ? `profile-values-${row.key.trim()}` : undefined}
              value={row.value}
              onChange={update(i, 'value')}
              placeholder="値（例: 看護師）"
              maxLength={PROFILE_LIMITS.valueLength}
              aria-label="値"
            />
            <button type="button" className="btn" onClick={() => removeRow(i)} title="この行を消す">
              ✕
            </button>
          </div>
        ))}
      </div>

      <datalist id="profile-keys">
        {[...new Set([...SUGGESTED_KEYS, ...needed])].map((k) => (
          <option key={k} value={k} />
        ))}
      </datalist>

      {Object.entries(SUGGESTED_VALUES).map(([key, values]) => (
        <datalist id={`profile-values-${key}`} key={key}>
          {values.map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
      ))}

      <div className="editor-foot">
        <span>
          {stillMissing.length > 0 && (
            <span className="over">この名義が使う文章に出てくる「{stillMissing.join('・')}」が、まだ空です。</span>
          )}
          {state.error && <span className="over">{state.error}</span>}
          {state.ok && <span className="ok-text">{state.ok}</span>}
        </span>
        <span className="actions-row">
          <button type="button" className="btn" onClick={addRow} disabled={rows.length >= PROFILE_LIMITS.items}>
            項目を足す
          </button>
          <SubmitButton className="btn btn-primary" pendingLabel="保存中…">
            属性を保存
          </SubmitButton>
        </span>
      </div>

      <div className="stat-note">
        <code>{'{ユーザー名}'}</code> はいつでも使えます（@{account.name} の名前が入ります）。値が空の項目を文章が使っていると、その投稿は出さずに見送ります。
      </div>
    </form>
  );
}
