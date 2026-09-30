'use client';

import { useActionState, useState } from 'react';
import { updateTemplate, setTemplateEnabled, deleteTemplate, setTemplateMedia } from '../_actions/templates';
import SubmitButton from '../_components/SubmitButton';
import MediaUploader from '../_components/MediaUploader';
import AttributePicker from './AttributePicker';
import { findPlaceholders } from '@/lib/server/profile.mjs';

const initial = { ok: null, error: null };

export default function TemplateRow({ template, accounts, choices = [], lastUsedLabel }) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(template.body ?? '');
  const [media, setMedia] = useState(Array.isArray(template.media) ? template.media : []);
  const [mediaMsg, setMediaMsg] = useState(null);
  const [state, save] = useActionState(async (_p, fd) => updateTemplate(fd), initial);
  const enabled = template.enabled !== false;
  const owner = template.accountId ? accounts.find((a) => a.id === template.accountId) : null;
  const length = [...body].length;
  // {職業} のような差し込みが入っているか（編集中はその場で数え直す）
  const placeholders = findPlaceholders(editing ? body : template.body);
  const attributes = Array.isArray(template.attributes) ? template.attributes.filter(Boolean) : [];
  const isReply = template.kind === 'reply';

  async function onMediaChange(next) {
    setMedia(next);
    const fd = new FormData();
    fd.set('id', template.id);
    fd.set('media', JSON.stringify(next));
    const r = await setTemplateMedia(fd);
    setMediaMsg(r.error ? r.error : null);
  }

  return (
    <article className="tpl-row" data-disabled={!enabled}>
      <div>
        <div className="tpl-meta">
          <span className="badge" data-tone={owner ? 'accent' : 'default'}>
            {owner ? `@${owner.name}` : template.accountId ? '（外された名義）' : '全名義共通'}
          </span>
          {isReply && (
            <span className="badge" data-tone="warn" title="伸びた投稿への返信に使います">
              返信用
            </span>
          )}
          {(template.tags ?? []).map((t) => (
            <span key={t} className="tag">
              {t}
            </span>
          ))}
          <span>使用 {template.useCount ?? 0}回</span>
          {template.lastUsedAt && <span>最終 {lastUsedLabel}</span>}
          {media.length > 0 && <span>添付 {media.length}個</span>}
          {attributes.length > 0 && (
            <span className="badge" data-tone="accent" title="この属性の名義だけが使います">
              {attributes.join('・')}だけ
            </span>
          )}
          {placeholders.map((k) => (
            <span key={k} className="tag tag-fill" title="名義の属性が差し込まれます">
              {'{'}
              {k}
              {'}'}
            </span>
          ))}
          {!enabled && (
            <span className="badge" data-tone="warn">
              無効
            </span>
          )}
        </div>

        {editing ? (
          <form action={save}>
            <input type="hidden" name="id" value={template.id} />
            <textarea name="body" className="editor" rows={Math.min(20, body.split('\n').length + 2)} value={body} onChange={(e) => setBody(e.target.value)} />
            <div className="field" style={{ marginTop: 10, marginBottom: 8 }}>
              <span>使わせる属性</span>
              <AttributePicker choices={[...new Set([...choices, ...attributes])]} initial={attributes} />
            </div>
            <div className="field-grid">
              <label className="field" style={{ marginBottom: 8 }}>
                <span>使いどころ</span>
                <select name="kind" defaultValue={isReply ? 'reply' : 'post'}>
                  <option value="post">投稿用</option>
                  <option value="reply">返信用（伸びた投稿への返信）</option>
                </select>
              </label>
              <label className="field" style={{ marginBottom: 8 }}>
                <span>タグ</span>
                <input name="tags" defaultValue={(template.tags ?? []).join(', ')} />
              </label>
              <label className="field" style={{ marginBottom: 8 }}>
                <span>使う名義</span>
                <select name="scope" defaultValue={template.accountId ?? 'shared'}>
                  <option value="shared">全名義共通</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      @{a.name} だけ
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="editor-foot">
              <span className={length > 500 ? 'over' : ''}>
                {length} / 500文字 {state.error && <span className="over"> {state.error}</span>}
                {state.ok && <span className="ok-text"> {state.ok}</span>}
              </span>
              <span className="actions-row">
                <SubmitButton className="btn btn-primary" pendingLabel="保存中…" disabled={length === 0 || length > 500}>
                  保存
                </SubmitButton>
                <button type="button" className="btn" onClick={() => setEditing(false)}>
                  閉じる
                </button>
              </span>
            </div>
            <MediaUploader value={media} onChange={onMediaChange} compact />
            {mediaMsg && <div className="media-note over">{mediaMsg}</div>}
          </form>
        ) : (
          <div className="post-body">{template.body}</div>
        )}
      </div>

      <div className="tpl-actions">
        <div className="actions-row">
          <button type="button" className="btn" onClick={() => setEditing((v) => !v)}>
            {editing ? '閉じる' : '編集・添付'}
          </button>
          <form action={setTemplateEnabled}>
            <input type="hidden" name="id" value={template.id} />
            <input type="hidden" name="enabled" value={enabled ? 'off' : 'on'} />
            <SubmitButton className={enabled ? 'btn btn-hold' : 'btn btn-approve'} pendingLabel="…">
              {enabled ? '無効にする' : '有効にする'}
            </SubmitButton>
          </form>
        </div>
        <form
          action={deleteTemplate}
          onSubmit={(e) => {
            if (!window.confirm('この文章を消します。よろしいですか？')) e.preventDefault();
          }}
        >
          <input type="hidden" name="id" value={template.id} />
          <SubmitButton className="btn btn-reject" pendingLabel="…">
            削除
          </SubmitButton>
        </form>
      </div>
    </article>
  );
}
