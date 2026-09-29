'use client';

import { useActionState, useState } from 'react';
import { submitCompose } from '../_actions/compose';
import SubmitButton from '../_components/SubmitButton';
import MediaUploader from '../_components/MediaUploader';
import AccountPicker from '../_components/AccountPicker';
import { fillProfile, findPlaceholders } from '@/lib/server/profile.mjs';

const initial = { ok: null, error: null, results: null };
const MAX = 500;

const RESULT_LABEL = {
  posted: { text: '投稿しました', tone: 'ok' },
  dry_run: { text: 'テスト（送っていません）', tone: 'warn' },
  pending: { text: '準備待ち', tone: 'warn' },
  scheduled: { text: '予約しました', tone: 'ok' },
  failed: { text: '失敗', tone: 'danger' },
  skipped: { text: '見送り', tone: 'warn' },
};

export default function ComposeForm({ accounts, defaultLocal }) {
  const [state, action] = useActionState(async (_prev, formData) => submitCompose(formData), initial);
  const [body, setBody] = useState('');
  const [media, setMedia] = useState([]);
  const [mode, setMode] = useState('now');
  const [picked, setPicked] = useState([]);
  const length = [...body].length;

  // {職業} のような差し込みが本文にあるとき、名義ごとの仕上がりを確かめられるようにする
  const placeholders = findPlaceholders(body);
  const previews = placeholders.length
    ? accounts.filter((a) => picked.includes(a.id)).map((a) => ({ account: a, ...fillProfile(body, a) }))
    : [];
  const lacking = previews.filter((p) => p.missing.length > 0);

  return (
    <form action={action}>
      <section className="card">
        <div className="card-head">
          <div className="card-title">1. どの名義で投稿するか</div>
        </div>
        <AccountPicker accounts={accounts} onChange={setPicked} hint="複数選ぶと、同じ内容がそれぞれの名義から投稿されます。停止中の名義でも「今すぐ投稿」はできます。" />
      </section>

      <section className="card">
        <div className="card-head">
          <div className="card-title">2. 内容</div>
        </div>
        <textarea
          name="body"
          className="editor"
          rows={8}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="本文（500文字まで）。画像・動画だけの投稿なら空でも構いません。"
        />
        <div className="editor-foot">
          <span className={length > MAX ? 'over' : ''}>
            {length} / {MAX}文字
          </span>
        </div>

        <input type="hidden" name="media" value={JSON.stringify(media)} />
        <MediaUploader value={media} onChange={setMedia} />

        {placeholders.length > 0 && (
          <div className="preview-box">
            <div className="preview-head">
              名義ごとの仕上がり
              <small>
                {placeholders.map((k) => `{${k}}`).join('・')} が、それぞれの名義の属性に置き換わります
              </small>
            </div>
            {previews.length === 0 ? (
              <div className="stat-note">名義を選ぶと、ここに仕上がりが出ます。</div>
            ) : (
              previews.map((p) => (
                <div className="preview-item" key={p.account.id} data-missing={p.missing.length > 0}>
                  <strong>@{p.account.name}</strong>
                  {p.missing.length > 0 ? (
                    <span className="over">
                      属性「{p.missing.join('・')}」が未設定です。名義の管理で入れてください（この名義には投稿しません）
                    </span>
                  ) : (
                    <span className="preview-body">{p.body}</span>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <div className="card-title">3. いつ投稿するか</div>
        </div>
        <div className="field-row" style={{ gap: 18 }}>
          <label className="check">
            <input type="radio" name="mode" value="now" checked={mode === 'now'} onChange={() => setMode('now')} />
            今すぐ投稿
          </label>
          <label className="check">
            <input type="radio" name="mode" value="reserve" checked={mode === 'reserve'} onChange={() => setMode('reserve')} />
            予約する
          </label>
          {mode === 'reserve' && (
            <label className="field-row">
              <input type="datetime-local" name="scheduledAtLocal" defaultValue={defaultLocal} className="inline-input" style={{ width: 'auto' }} required />
              <small className="stat-note">日本時間</small>
            </label>
          )}
        </div>

        <div className="editor-foot" style={{ marginTop: 16 }}>
          <span>
            {state.error && <span className="over">{state.error}</span>}
            {state.ok && <span className="ok-text">{state.ok}</span>}
          </span>
          <SubmitButton
            className="btn btn-primary btn-lg"
            pendingLabel={mode === 'now' ? '投稿中…（最大1分ほど）' : '予約中…'}
            disabled={length > MAX || (length === 0 && media.length === 0) || (previews.length > 0 && lacking.length === previews.length)}
          >
            {mode === 'now' ? '今すぐ投稿する' : '予約する'}
          </SubmitButton>
        </div>

        {state.results && (
          <ul className="result-list">
            {state.results.map((r, i) => {
              const label = RESULT_LABEL[r.result] ?? { text: r.result, tone: 'default' };
              return (
                <li key={`${r.account}-${i}`}>
                  <strong>@{r.account}</strong>
                  <span className="badge" data-tone={label.tone}>
                    {label.text}
                  </span>
                  {r.permalink && (
                    <a href={r.permalink} target="_blank" rel="noreferrer" className="btn">
                      投稿を見る
                    </a>
                  )}
                  {r.reason && <span className="stat-note">{r.reason}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </form>
  );
}
