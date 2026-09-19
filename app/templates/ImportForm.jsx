'use client';

import { useActionState, useState } from 'react';
import { importTemplates } from '../_actions/templates';
import SubmitButton from '../_components/SubmitButton';

const initial = { ok: null, error: null, skipped: null };

const MODES = [
  { key: 'separator', label: '「---」だけの行で区切る', hint: '本文の中に空行があってもよい。いちばん確実な方法です。' },
  { key: 'blank', label: '空行で区切る', hint: '1つの文章の中に空行を入れない場合に。' },
  { key: 'line', label: '1行 = 1本', hint: '短い一言をたくさん入れるときに。' },
];

export default function ImportForm({ accounts, defaultScope = 'shared' }) {
  const [state, action] = useActionState(async (_prev, formData) => importTemplates(formData), initial);
  const [mode, setMode] = useState('separator');
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');

  // 貼り付けた文章が何本になるかを、送る前に数えて見せる
  const count = countParts(text, mode);

  return (
    <form action={action}>
      <div className="field-grid">
        <label className="field">
          <span>使う名義</span>
          <select name="scope" defaultValue={defaultScope}>
            <option value="shared">全名義共通（どの名義の自動投稿にも使う）</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                @{a.name} だけ
              </option>
            ))}
          </select>
          <small>名義ごとに文章を分けたいときは、名義を選んで取り込みます。同じ文章が複数の名義から出るのを避けられます。</small>
        </label>

        <label className="field">
          <span>タグ（任意）</span>
          <input name="tags" placeholder="例: 朝, 占い" />
          <small>取り込む全部に付きます。自動投稿の設定で「このタグの文章だけ使う」と絞れます。</small>
        </label>

        <label className="field">
          <span>区切り方</span>
          <select name="mode" value={mode} onChange={(e) => setMode(e.target.value)}>
            {MODES.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
          <small>{MODES.find((m) => m.key === mode)?.hint}</small>
        </label>

        <label className="field">
          <span>ファイルから（任意）</span>
          <input type="file" name="file" accept=".txt,.csv,text/plain,text/csv" onChange={(e) => setFileName(e.target.files?.[0]?.name ?? '')} />
          <small>
            .txt は上の区切り方で分けます。.csv は1列目が本文、2列目がタグ（Excel で「CSV UTF-8」で保存）。
            {fileName && ` 選択中: ${fileName}`}
          </small>
        </label>
      </div>

      <label className="field">
        <span>貼り付けて取り込む</span>
        <textarea
          name="text"
          rows={10}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={mode === 'line' ? '1行に1本ずつ' : mode === 'blank' ? '文章と文章のあいだを空行で区切る' : '文章1\n---\n文章2\n---\n文章3'}
        />
        <small>{text.trim() ? `いまの区切り方で ${count} 本になります。` : '数百本まとめて貼り付けても構いません。'} 1本 500 文字まで。長すぎるものは飛ばして知らせます。</small>
      </label>

      <div className="editor-foot">
        <span>
          {state.error && <span className="over">{state.error}</span>}
          {state.ok && <span className="ok-text">{state.ok}</span>}
        </span>
        <SubmitButton className="btn btn-primary" pendingLabel="取り込み中…" disabled={!text.trim() && !fileName}>
          取り込む
        </SubmitButton>
      </div>

      {state.skipped?.length > 0 && (
        <details className="fold" style={{ marginTop: 8 }}>
          <summary>飛ばした {state.skipped.length} 件の理由</summary>
          <ul className="result-list">
            {state.skipped.map((s) => (
              <li key={s.index}>
                <span className="badge" data-tone="danger">
                  {s.index}番目
                </span>
                <span>{s.reason}</span>
                <span className="stat-note">{s.preview}…</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </form>
  );
}

function countParts(text, mode) {
  const normalized = String(text ?? '').replace(/\r\n?/g, '\n');
  let parts;
  if (mode === 'line') parts = normalized.split('\n');
  else if (mode === 'blank') parts = normalized.split(/\n[ \t　]*\n+/);
  else parts = normalized.split(/^[ \t　]*(?:-{3,}|={3,}|\*{3,}|－{3,}|ー{3,}|＝{3,}|＊{3,})[ \t　]*$/m);
  return parts.filter((p) => p.trim().length > 0).length;
}
