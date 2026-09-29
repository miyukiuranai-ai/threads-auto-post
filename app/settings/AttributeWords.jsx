'use client';

import { useActionState, useState } from 'react';
import { setAttributeWords } from '../_actions/attributes';
import SubmitButton from '../_components/SubmitButton';
import { ATTRIBUTE_KEY, PROFILE_LIMITS } from '@/lib/server/profile.mjs';

const initial = { ok: null, error: null };

/**
 * 属性ごとの言い回しの候補の編集。
 * 「看護師」に 看護師 / ナース / 夜勤ばっかの看護師 と入れておくと、
 * 文章の {属性} に毎回どれかが入る。同じ属性の名義すべてで共通。
 */
export default function AttributeWords({ attribute, words, accountNames = [] }) {
  const [state, save] = useActionState(async (_p, fd) => setAttributeWords(fd), initial);
  const [open, setOpen] = useState(false);

  const [rows, setRows] = useState(() => {
    const saved = Object.entries(words ?? {}).map(([key, list]) => ({ key, text: (list ?? []).join('\n') }));
    return saved.length ? saved : [{ key: ATTRIBUTE_KEY, text: attribute }];
  });

  const update = (i, field) => (e) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, [field]: e.target.value } : r)));
  const removeRow = (i) => setRows((prev) => prev.filter((_, j) => j !== i));
  const addRow = () => setRows((prev) => [...prev, { key: '', text: '' }]);

  // 見出しには「保存済みの数」を出す。入力欄の初期値を数えると、未設定でも1個あるように見えてしまう
  const savedTotal = Object.values(words ?? {}).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0);

  return (
    <div className="words-item">
      <div className="words-head">
        <button type="button" className="btn" onClick={() => setOpen((v) => !v)}>
          {open ? '閉じる' : '編集'}
        </button>
        <strong>{attribute}</strong>
        <span className="stat-note">
          {savedTotal > 0 ? `${savedTotal}個の言い回し` : '未設定（属性の名前がそのまま入ります）'}
          {accountNames.length > 0 && ` ・ ${accountNames.map((n) => `@${n}`).join('・')}`}
        </span>
      </div>

      {open && (
        <form action={save} className="words-box">
          <input type="hidden" name="attribute" value={attribute} />
          <input type="hidden" name="words" value={JSON.stringify(rows)} />

          <p className="stat-note" style={{ marginTop: 0 }}>
            差し込む場所ごとに、候補を<strong>1行に1つ</strong>入れてください。投稿のたびに、その中から1つが選ばれます。
            同じ投稿の中では同じ言葉が使われます。この設定は「{attribute}」の属性を付けた名義すべてで共通です。
          </p>

          {rows.map((row, i) => (
            <div className="words-row" key={i}>
              <div className="words-key">
                <input
                  value={row.key}
                  onChange={update(i, 'key')}
                  placeholder="差し込む場所（例: 属性）"
                  maxLength={PROFILE_LIMITS.keyLength}
                  aria-label="差し込む場所の名前"
                />
                <code>{`{${row.key.trim() || '項目名'}}`}</code>
                <button type="button" className="btn" onClick={() => removeRow(i)} title="この項目を消す">
                  ✕
                </button>
              </div>
              <textarea
                className="editor"
                rows={Math.min(8, Math.max(3, row.text.split('\n').length + 1))}
                value={row.text}
                onChange={update(i, 'text')}
                placeholder={row.key.trim() === ATTRIBUTE_KEY ? `${attribute}\n（別の言い方を1行に1つ）` : '1行に1つ'}
              />
            </div>
          ))}

          <div className="editor-foot">
            <span>
              {state.error && <span className="over">{state.error}</span>}
              {state.ok && <span className="ok-text">{state.ok}</span>}
            </span>
            <span className="actions-row">
              <button type="button" className="btn" onClick={addRow} disabled={rows.length >= PROFILE_LIMITS.items}>
                差し込む場所を足す
              </button>
              <SubmitButton className="btn btn-primary" pendingLabel="保存中…">
                保存
              </SubmitButton>
            </span>
          </div>

          <div className="stat-note">
            候補は1項目あたり {PROFILE_LIMITS.candidates} 個までです。
            <code>{'{属性}'}</code> を空にすると、属性の名前（{attribute}）がそのまま入ります。
          </div>
        </form>
      )}
    </div>
  );
}
