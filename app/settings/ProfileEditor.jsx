'use client';

import { useActionState, useState } from 'react';
import { setAccountProfile } from '../_actions/accounts';
import SubmitButton from '../_components/SubmitButton';
import { ATTRIBUTE_KEY, SUGGESTED_KEYS, PROFILE_LIMITS } from '@/lib/server/profile.mjs';

const initial = { ok: null, error: null };

/** 「その他」を選んだときだけ、自分で入力する欄を出すための目印。 */
const OTHER = '__other__';

/**
 * 名義の属性（人物像・年齢など）の編集。
 * ここで入れた値が、文章の中の {属性} のような書き方に差し込まれる。
 *
 * 属性は一覧から選ぶ（毎回打ち間違えないように）。一覧に無いものは「その他」で足せて、
 * 一度使えば他の名義の一覧にも出てくる。
 */
export default function ProfileEditor({ account, needed = [], choices = [] }) {
  const [state, save] = useActionState(async (_p, fd) => setAccountProfile(fd), initial);

  const saved = account.profile ?? {};
  const savedAttr = String(saved[ATTRIBUTE_KEY] ?? '');

  // 保存済みの値が一覧に無ければ、「その他」の入力欄に入れておく
  const [attr, setAttr] = useState(() => (!savedAttr || choices.includes(savedAttr) ? savedAttr : OTHER));
  const [otherAttr, setOtherAttr] = useState(() => (savedAttr && !choices.includes(savedAttr) ? savedAttr : ''));

  // 属性以外の項目（年齢・住まいなど）。文章が使っているのに未設定のものは、空の行として出しておく
  const [rows, setRows] = useState(() => {
    const others = Object.entries(saved)
      .filter(([key]) => key !== ATTRIBUTE_KEY)
      .map(([key, value]) => ({ key, value: String(value ?? '') }));
    const lacking = needed
      .filter((k) => k !== ATTRIBUTE_KEY && k !== 'ユーザー名' && !others.some((r) => r.key === k))
      .map((key) => ({ key, value: '' }));
    return [...others, ...lacking];
  });

  const update = (i, field) => (e) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, [field]: e.target.value } : r)));
  const removeRow = (i) => setRows((prev) => prev.filter((_, j) => j !== i));
  const addRow = () => setRows((prev) => [...prev, { key: '', value: '' }]);

  const attrValue = (attr === OTHER ? otherAttr : attr).trim();
  const entries = [{ key: ATTRIBUTE_KEY, value: attrValue }, ...rows];
  const filledKeys = entries.filter((r) => r.key.trim() && r.value.trim()).map((r) => r.key.trim());
  const stillMissing = needed.filter((k) => k !== 'ユーザー名' && !filledKeys.includes(k));

  return (
    <form action={save} className="profile-box">
      <input type="hidden" name="accountId" value={account.id} />
      <input type="hidden" name="profile" value={JSON.stringify(entries)} />

      <label className="field" style={{ marginBottom: 12 }}>
        <span>属性（人物像）</span>
        <select value={attr} onChange={(e) => setAttr(e.target.value)}>
          <option value="">未設定</option>
          {choices.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
          <option value={OTHER}>その他（自分で入力）</option>
        </select>
        {attr === OTHER && (
          <input
            value={otherAttr}
            onChange={(e) => setOtherAttr(e.target.value)}
            placeholder="例: OL"
            maxLength={PROFILE_LIMITS.valueLength}
            style={{ marginTop: 6 }}
            aria-label="属性を自分で入力"
          />
        )}
        <small>
          文章に <code>{'{属性}'}</code> と書いた場所へ、ここで選んだ言葉が入ります。
          <strong>{attrValue || '（未設定）'}</strong> を選ぶと、<code>{'{属性}'}だから夜は遅くて</code> は
          「{attrValue ? `${attrValue}だから夜は遅くて` : '…'}」として投稿されます。
          「その他」で入れた言葉は、次から他の名義の一覧にも出ます。
        </small>
      </label>

      <div className="profile-sub">その他の項目（任意）</div>
      <div className="profile-rows">
        {rows.map((row, i) => (
          <div className="profile-row" key={i}>
            <input
              list="profile-keys"
              value={row.key}
              onChange={update(i, 'key')}
              placeholder="項目名（例: 年齢）"
              maxLength={PROFILE_LIMITS.keyLength}
              aria-label="項目名"
            />
            <span className="profile-eq">:</span>
            <input
              value={row.value}
              onChange={update(i, 'value')}
              placeholder="値（例: 24）"
              maxLength={PROFILE_LIMITS.valueLength}
              aria-label="値"
            />
            <button type="button" className="btn" onClick={() => removeRow(i)} title="この行を消す">
              ✕
            </button>
          </div>
        ))}
        {rows.length === 0 && <div className="stat-note">年齢や住まいなど、他にも差し込みたい言葉があれば足してください。</div>}
      </div>

      <datalist id="profile-keys">
        {[...new Set([...SUGGESTED_KEYS, ...needed])].filter((k) => k !== ATTRIBUTE_KEY).map((k) => (
          <option key={k} value={k} />
        ))}
      </datalist>

      <div className="editor-foot">
        <span>
          {stillMissing.length > 0 && (
            <span className="over">この名義が使う文章に出てくる「{stillMissing.join('・')}」が、まだ空です。</span>
          )}
          {state.error && <span className="over">{state.error}</span>}
          {state.ok && <span className="ok-text">{state.ok}</span>}
        </span>
        <span className="actions-row">
          <button type="button" className="btn" onClick={addRow} disabled={rows.length >= PROFILE_LIMITS.items - 1}>
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
