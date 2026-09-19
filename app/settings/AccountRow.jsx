'use client';

import { useState, useActionState } from 'react';
import { setAccountGroup, removeAccount } from '../_actions/accounts';
import { setAccountStatus } from '../_actions/schedule';
import SubmitButton from '../_components/SubmitButton';

const initial = { ok: null, error: null };

export default function AccountRow({ account, days, isAdmin, summary }) {
  const tone = days === null ? 'warn' : days < 0 ? 'danger' : days < 10 ? 'warn' : 'ok';
  const active = (account.status ?? 'active') === 'active';

  const [confirming, setConfirming] = useState(false);
  const [removeState, remove] = useActionState(async (_prev, formData) => removeAccount(formData), initial);

  return (
    <tr>
      <td>
        <strong>@{account.name}</strong>
        <div className="post-slot">
          <code>{account.threadsUserId}</code>
        </div>
      </td>

      <td>
        <span className="badge" data-tone={tone}>
          {days === null ? '不明' : days < 0 ? '失効' : `残り${days}日`}
        </span>
      </td>

      <td>
        <span className="badge" data-tone={active ? 'ok' : 'warn'}>
          {active ? '稼働中' : '停止中'}
        </span>
        <div className="post-slot">{summary}</div>
      </td>

      {isAdmin && (
        <td>
          <form action={setAccountGroup} className="schedule-form" style={{ marginTop: 0 }}>
            <input type="hidden" name="accountId" value={account.id} />
            <input type="text" name="group" defaultValue={account.group ?? 'main'} style={{ width: 90 }} />
            <SubmitButton className="btn" pendingLabel="…">
              変更
            </SubmitButton>
          </form>
        </td>
      )}

      <td>
        <div className="actions-row">
          <form action={setAccountStatus}>
            <input type="hidden" name="accountId" value={account.id} />
            <input type="hidden" name="status" value={active ? 'paused' : 'active'} />
            <SubmitButton className={active ? 'btn btn-hold' : 'btn btn-approve'} pendingLabel="更新中…" title="停止中は自動投稿と予約投稿を止めます。今すぐ投稿はできます">
              {active ? '停止する' : '稼働する'}
            </SubmitButton>
          </form>

          <button type="button" className="btn" onClick={() => setConfirming((v) => !v)}>
            {confirming ? '取消' : '外す'}
          </button>
        </div>

        {confirming && (
          <form action={remove} className="remove-box">
            <input type="hidden" name="accountId" value={account.id} />
            <p>
              <strong>@{account.name} をツールから外します。</strong>
              <br />
              この名義の投稿の記録と、この名義用の文章も消えます。元に戻せません。
              <br />
              Threads のアカウントと、すでに投稿された内容はそのまま残ります。
            </p>
            <div className="remove-row">
              <input name="confirm" placeholder={account.name} autoComplete="off" aria-label="確認のためユーザー名を入力" />
              <SubmitButton className="btn btn-reject" pendingLabel="削除中…">
                外す
              </SubmitButton>
            </div>
            <div className="remove-note">
              確認のため <code>{account.name}</code> と入力してください。
            </div>
          </form>
        )}

        {removeState.error && <div className="remove-note over">{removeState.error}</div>}
        {removeState.ok && <div className="remove-note ok-text">{removeState.ok}</div>}
      </td>
    </tr>
  );
}
