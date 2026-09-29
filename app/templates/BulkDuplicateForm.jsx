'use client';

import { useActionState, useState } from 'react';
import { duplicateWithPlaceholder } from '../_actions/templates';
import SubmitButton from '../_components/SubmitButton';

const initial = { ok: null, error: null };

/**
 * 属性を差し込む版をまとめて作る。
 * 元の文章はそのまま残るので、属性あり・なしの両方が投稿されるようになる。
 */
export default function BulkDuplicateForm({ ids, label }) {
  const [state, action] = useActionState(async (_p, fd) => duplicateWithPlaceholder(fd), initial);
  const [position, setPosition] = useState('head');
  const [key, setKey] = useState('属性');

  const mark = `{${key.trim() || '属性'}}`;
  const example = position === 'head' ? `${mark}今日誰か会ってみる？` : `今日誰か会ってみる？${mark}`;

  return (
    <details className="fold">
      <summary>絞り込んだ {ids.length} 本の「属性つき版」をまとめて作る</summary>
      <form action={action} className="bulk-box">
        <input type="hidden" name="ids" value={JSON.stringify(ids)} />

        <p className="stat-note" style={{ marginTop: 0 }}>
          <strong>{label}</strong> の {ids.length} 本をもとに、差し込みを付けた文章を新しく作ります。
          <strong>元の文章はそのまま残ります</strong>ので、属性あり・なしの両方が一巡の中に入り、順番が回るたびに混ざって出ます。
        </p>

        <div className="field-grid">
          <label className="field">
            <span>差し込む場所</span>
            <select name="key" value={key} onChange={(e) => setKey(e.target.value)}>
              <option value="属性">{'{属性}'}</option>
              <option value="前置き">{'{前置き}'}</option>
            </select>
            <small>「属性ごとの言い回し」で候補を登録した項目を選んでください。</small>
          </label>

          <label className="field">
            <span>付ける位置</span>
            <select name="position" value={position} onChange={(e) => setPosition(e.target.value)}>
              <option value="head">先頭に付ける</option>
              <option value="tail">末尾に付ける</option>
            </select>
            <small>
              例: <code>{example}</code>
            </small>
          </label>

          <label className="field">
            <span>付けるタグ（任意）</span>
            <input name="tag" defaultValue="属性つき" placeholder="属性つき" />
            <small>後から見分けたり、まとめて消したりするときに使えます。</small>
          </label>
        </div>

        <div className="stat-note">
          すでに <code>{'{ }'}</code> の差し込みが入っている文章と、付けると500文字を超える文章は飛ばします。
          候補には <code>看護師です。</code> のように語尾まで入れておくと、そのままつながります。
        </div>

        <div className="editor-foot">
          <span>
            {state.error && <span className="over">{state.error}</span>}
            {state.ok && <span className="ok-text">{state.ok}</span>}
          </span>
          <SubmitButton className="btn btn-primary" pendingLabel="作成中…">
            属性つき版を作る
          </SubmitButton>
        </div>
      </form>
    </details>
  );
}
