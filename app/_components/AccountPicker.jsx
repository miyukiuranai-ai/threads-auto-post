'use client';

import { useState } from 'react';

/**
 * 名義をまとめて選ぶ欄。チェックボックスの並びに「すべて選択」を添える。
 * フォームの中で使い、name で複数の値を送る。
 */
export default function AccountPicker({ accounts, name = 'accountIds', initial = [], disabled = false, hint }) {
  const [selected, setSelected] = useState(() => new Set(initial));

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allSelected = accounts.length > 0 && accounts.every((a) => selected.has(a.id));

  return (
    <div>
      <div className="field-row" style={{ justifyContent: 'space-between' }}>
        <span style={{ fontWeight: 700, fontSize: 13 }}>
          名義を選ぶ <small style={{ color: 'var(--ink-muted)', fontWeight: 400 }}>{selected.size} / {accounts.length} 件</small>
        </span>
        <span className="actions-row">
          <button type="button" className="btn" disabled={disabled} onClick={() => setSelected(new Set(accounts.map((a) => a.id)))}>
            すべて選択
          </button>
          <button type="button" className="btn" disabled={disabled} onClick={() => setSelected(new Set())}>
            解除
          </button>
          {!allSelected && (
            <button type="button" className="btn" disabled={disabled} onClick={() => setSelected(new Set(accounts.filter((a) => (a.status ?? 'active') === 'active').map((a) => a.id)))}>
              稼働中だけ
            </button>
          )}
        </span>
      </div>

      {accounts.length === 0 ? (
        <div className="stat-note">名義がまだありません。「名義の管理」でトークンを登録してください。</div>
      ) : (
        <div className="check-grid">
          {accounts.map((a) => (
            <label key={a.id} className="check-cell" data-checked={selected.has(a.id)}>
              <input type="checkbox" name={name} value={a.id} checked={selected.has(a.id)} onChange={() => toggle(a.id)} disabled={disabled} />
              <span>@{a.name}</span>
              {(a.status ?? 'active') === 'paused' && <small>停止中</small>}
            </label>
          ))}
        </div>
      )}
      {hint && <div className="stat-note">{hint}</div>}
    </div>
  );
}
