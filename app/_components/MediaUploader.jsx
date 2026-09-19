'use client';

import { useEffect, useState } from 'react';
import { requestUpload, finishUpload } from '../_actions/media';

const ACCEPT = 'image/jpeg,image/png,video/mp4,video/quicktime';
const MAX_ITEMS = 20;

/** 先頭4MBの指紋。同じファイルを同じ場所に置くために使う（全体を読むと動画で重くなるため）。 */
async function fingerprintOf(file) {
  const head = await file.slice(0, 4 * 1024 * 1024).arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', head);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex}-${file.size}`;
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)}MB`;

/** 進み具合を出したいので fetch ではなく XHR を使う。 */
function put(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`アップロードに失敗しました（${xhr.status}）。Storage の CORS 設定（npm run storage:setup）を確認してください。`)));
    xhr.onerror = () => reject(new Error('アップロードに失敗しました。通信か、Storage の CORS 設定（npm run storage:setup）を確認してください。'));
    xhr.send(file);
  });
}

/** 選んだ画像の小さな見本（ブラウザの中だけ）。 */
function Thumb({ file, entry }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!file) return undefined;
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  if (entry?.kind === 'video') return <div className="media-thumb" style={{ display: 'grid', placeItems: 'center', fontSize: 11 }}>動画</div>;
  return url ? <img src={url} alt="" className="media-thumb" /> : <div className="media-thumb" />;
}

/**
 * 画像・動画の添付。ブラウザから直接 Firebase Storage へ送り、
 * 送り終わった素材の一覧（media の配列）を onChange で返す。
 *
 * @param {object} props
 * @param {object[]} props.value           いま付いている素材
 * @param {(next:object[]) => void} props.onChange
 * @param {boolean} [props.disabled]
 * @param {boolean} [props.compact]        一覧の中で使うときに説明を短くする
 */
export default function MediaUploader({ value = [], onChange, disabled = false, compact = false }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [files, setFiles] = useState({}); // fingerprint → File（サムネイル用）
  const [dragging, setDragging] = useState(false);

  async function takeFiles(list) {
    const picked = [...(list ?? [])];
    if (!picked.length) return;
    setError(null);

    if (value.length + picked.length > MAX_ITEMS) {
      setError(`素材は${MAX_ITEMS}個までです。`);
      return;
    }

    let next = [...value];
    try {
      for (const [i, file] of picked.entries()) {
        const label = picked.length > 1 ? `${i + 1}/${picked.length} ` : '';
        setBusy(`${label}確認中…`);
        const fingerprint = await fingerprintOf(file);
        if (next.some((m) => m.fingerprint === fingerprint)) continue;

        const ask = new FormData();
        ask.set('fingerprint', fingerprint);
        ask.set('contentType', file.type);
        ask.set('bytes', String(file.size));
        const plan = await requestUpload(ask);
        if (plan.error) throw new Error(plan.error);

        setBusy(`${label}送信中… 0%`);
        await put(plan.uploadUrl, file, (pct) => setBusy(`${label}送信中… ${pct}%`));

        setBusy(`${label}登録中…`);
        const done = new FormData();
        done.set('fingerprint', fingerprint);
        done.set('path', plan.path);
        done.set('contentType', file.type);
        done.set('bytes', String(file.size));
        done.set('name', file.name);
        const saved = await finishUpload(done);
        if (saved.error) throw new Error(saved.error);

        next = [...next, saved.entry];
        setFiles((prev) => ({ ...prev, [fingerprint]: file }));
        onChange(next);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  function remove(fingerprint) {
    onChange(value.filter((m) => m.fingerprint !== fingerprint));
  }

  return (
    <div className="media-field">
      {value.length > 0 && (
        <ul className="media-list">
          {value.map((m) => (
            <li key={m.fingerprint ?? m.path}>
              <Thumb file={files[m.fingerprint]} entry={m} />
              <span className="badge" data-tone="ok">
                {m.kind === 'video' ? '動画' : '画像'}
              </span>
              <span className="media-name">{m.name ?? m.path?.split('/').pop()}</span>
              <span className="media-size">{mb(m.bytes ?? 0)}</span>
              <button type="button" className="btn" onClick={() => remove(m.fingerprint)} disabled={disabled || Boolean(busy)}>
                外す
              </button>
            </li>
          ))}
        </ul>
      )}

      <div
        className={`drop${dragging ? ' is-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy && !disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!busy && !disabled) takeFiles(e.dataTransfer?.files);
        }}
      >
        <label className="media-pick">
          <input
            type="file"
            accept={ACCEPT}
            multiple
            onChange={(e) => {
              const list = e.target.files;
              e.target.value = '';
              takeFiles(list);
            }}
            disabled={disabled || Boolean(busy)}
          />
          <span className="btn" data-pending={Boolean(busy)}>
            {busy ?? (value.length ? 'さらに追加' : '画像・動画を追加')}
          </span>
        </label>
        {!compact && <span className="media-note" style={{ marginLeft: 10 }}>ここにファイルを落としても追加できます。</span>}
      </div>

      {!compact && (
        <div className="media-note">
          画像 JPEG/PNG・8MBまで／動画 MP4/MOV・1GB・5分まで。2つ以上入れると複数枚の投稿になります（20個まで）。動画は Threads 側の変換に数分かかります。
        </div>
      )}

      {error && <div className="media-note over">{error}</div>}
    </div>
  );
}
