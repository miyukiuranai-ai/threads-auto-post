'use client';

import { setAllStatus } from './_actions/schedule';
import SubmitButton from './_components/SubmitButton';

/** 全名義をまとめて稼働・停止にするボタン。 */
export default function DashboardActions({ count }) {
  return (
    <div className="actions-row">
      <form action={setAllStatus}>
        <input type="hidden" name="status" value="active" />
        <SubmitButton className="btn btn-approve" pendingLabel="…" disabled={!count}>
          全部を稼働にする
        </SubmitButton>
      </form>
      <form
        action={setAllStatus}
        onSubmit={(e) => {
          if (!window.confirm('全名義の自動投稿と予約投稿を止めます。よろしいですか？（今すぐ投稿はできます）')) e.preventDefault();
        }}
      >
        <input type="hidden" name="status" value="paused" />
        <SubmitButton className="btn btn-hold" pendingLabel="…" disabled={!count}>
          全部を停止にする
        </SubmitButton>
      </form>
    </div>
  );
}
