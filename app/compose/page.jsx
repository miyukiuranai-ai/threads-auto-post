import { listAccounts } from '@/lib/server/repo.mjs';
import { getCurrentUser, filterAccountsForUser } from '@/lib/server/auth.mjs';
import { toLocalInput } from '@/lib/server/time.mjs';
import { postingMode } from '@/lib/server/publish.mjs';
import ComposeForm from './ComposeForm';

export const dynamic = 'force-dynamic';

/** 「今すぐ投稿」は名義ごとに Threads の準備を待つので、サーバー関数の時間を長めに取る。 */
export const maxDuration = 60;

export default async function ComposePage() {
  const user = await getCurrentUser();

  let accounts = [];
  let dbError = null;
  try {
    accounts = filterAccountsForUser(await listAccounts(), user);
  } catch (err) {
    dbError = err.message;
  }

  // 予約の初期値は「1時間後」を10分単位に丸めた時刻
  const defaultAt = new Date(Math.ceil((Date.now() + 3600000) / 600000) * 600000).toISOString();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>今すぐ投稿・予約</h1>
          <p className="page-desc">選んだ名義に同じ内容を送ります。画像・動画も付けられます。</p>
        </div>
      </div>

      {postingMode() === 'dry_run' && (
        <div className="notice">
          <strong>テストモードです。</strong> POSTING_MODE=dry_run のため、Threads には実際に送りません。本番にするには環境変数を <code>POSTING_MODE=live</code> にします。
        </div>
      )}

      {dbError && (
        <div className="notice" data-tone="danger">
          <strong>Firestore に接続できていません。</strong>
          <div style={{ marginTop: 6 }}>{dbError}</div>
        </div>
      )}

      <ComposeForm accounts={accounts.map((a) => ({ id: a.id, name: a.name, status: a.status ?? 'active' }))} defaultLocal={toLocalInput(defaultAt)} />
    </>
  );
}
