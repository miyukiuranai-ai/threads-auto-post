import { listAccounts, daysUntil, lastRunAt } from '@/lib/server/repo.mjs';
import { getCurrentUser, filterAccountsForUser } from '@/lib/server/auth.mjs';
import { scheduleSummary } from '@/lib/server/schedule.mjs';
import { postingMode } from '@/lib/server/publish.mjs';
import { toJstLabel } from '@/lib/server/time.mjs';
import AddAccountsForm from './AddAccountsForm';
import AccountRow from './AccountRow';
import RefreshTokensButton from './RefreshTokensButton';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** 環境変数の設定状況だけを返す（値は出さない）。 */
function envStatus() {
  return [
    { key: 'FIREBASE_PROJECT_ID', label: 'Firebase プロジェクト', set: Boolean(process.env.FIREBASE_PROJECT_ID) },
    { key: 'FIREBASE_CLIENT_EMAIL', label: 'Firebase サービスアカウント', set: Boolean(process.env.FIREBASE_CLIENT_EMAIL) },
    { key: 'FIREBASE_PRIVATE_KEY', label: 'Firebase 秘密鍵', set: Boolean(process.env.FIREBASE_PRIVATE_KEY) },
    { key: 'FIREBASE_STORAGE_BUCKET', label: 'Storage バケット（画像・動画）', set: true, note: process.env.FIREBASE_STORAGE_BUCKET ? '設定済み' : '未指定（プロジェクトIDから組み立て）' },
    { key: 'CRON_SECRET', label: '定期実行の鍵', set: Boolean(process.env.CRON_SECRET) },
    { key: 'POSTING_MODE', label: '投稿モード', set: postingMode() === 'live', note: postingMode() === 'live' ? 'live（実際に投稿）' : 'dry_run（テスト。送らない）' },
  ];
}

export default async function SettingsPage() {
  const user = await getCurrentUser();
  const isAdmin = user.role === 'admin';

  let accounts = [];
  let dbError = null;
  let last = null;
  try {
    accounts = filterAccountsForUser(await listAccounts(), user);
    last = await lastRunAt();
  } catch (err) {
    dbError = err.message;
  }

  const tickStale = last ? Date.now() - new Date(last).getTime() > 20 * 60000 : true;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>名義の管理</h1>
          <p className="page-desc">{isAdmin ? 'すべての名義を確認・操作できます。' : `あなたのグループ（${user.group}）の名義だけが表示されます。`}</p>
        </div>
        <span className="badge" data-tone={isAdmin ? 'ok' : 'default'}>
          {user.name}（{isAdmin ? '管理者' : 'メンバー'}）
        </span>
      </div>

      {dbError && (
        <div className="notice" data-tone="danger">
          <strong>Firestore に接続できていません。</strong>
          <div style={{ marginTop: 6 }}>{dbError}</div>
          <div style={{ marginTop: 6 }}>
            <code>docs/SETUP.md</code> の手順で <code>.env.local</code>（Vercel では環境変数）を入れてください。
          </div>
        </div>
      )}

      <section className="card">
        <div className="card-head">
          <div className="card-title">
            ✦ 名義を追加 <small>トークンを貼り付けるだけで登録できます。複数はまとめて</small>
          </div>
        </div>
        <AddAccountsForm isAdmin={isAdmin} />
      </section>

      <section className="card">
        <div className="card-head">
          <div className="card-title">
            ✦ 連携済みの名義 <small>{accounts.length}件</small>
          </div>
          {isAdmin && accounts.length > 0 && <RefreshTokensButton />}
        </div>
        {accounts.length === 0 ? (
          <div className="stat-note">まだありません。上の欄にトークンを貼り付けて追加してください。</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>名義</th>
                  <th style={{ width: 110 }}>トークン期限</th>
                  <th>状態・自動投稿</th>
                  {isAdmin && <th style={{ width: 150 }}>担当</th>}
                  <th style={{ width: 260 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <AccountRow key={a.id} account={a} days={daysUntil(a.tokenExpiresAt)} isAdmin={isAdmin} summary={scheduleSummary(a.schedule)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="stat-note" style={{ marginBottom: 0, marginTop: 12 }}>
          トークンは60日で失効しますが、定期実行が毎日確かめて自動で延長します。失効してしまったら、同じ名義のトークンを取り直して上の欄に貼れば入れ替わります（設定はそのまま）。
        </p>
      </section>

      <section className="card">
        <div className="card-head">
          <div className="card-title">
            ✦ 定期実行 <small>5分おきに /api/cron/tick を呼ぶ仕組みが必要です（docs/SETUP.md）</small>
          </div>
        </div>
        <div className="field-row">
          <span className="badge" data-tone={dbError ? 'danger' : tickStale ? 'warn' : 'ok'}>
            {last ? `最後に動いた時刻: ${toJstLabel(last)}` : 'まだ一度も動いていません'}
          </span>
          {tickStale && !dbError && <span className="stat-note">20分以上動いていません。動いていないと自動投稿と予約投稿は出ません（今すぐ投稿は動きます）。</span>}
        </div>
        <p className="stat-note" style={{ marginBottom: 0 }}>
          手元で試すなら <code>npm run tick</code> で1回ぶん動かせます。
        </p>
      </section>

      {isAdmin && (
        <section className="card">
          <div className="card-head">
            <div className="card-title">
              ✦ 接続情報 <small>値は表示しません。設定の有無のみ確認できます。</small>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>項目</th>
                <th>環境変数</th>
                <th>状態</th>
              </tr>
            </thead>
            <tbody>
              {envStatus().map((e) => (
                <tr key={e.key}>
                  <td>{e.label}</td>
                  <td>
                    <code>{e.key}</code>
                  </td>
                  <td>
                    <span className="badge" data-tone={e.set ? 'ok' : 'danger'}>
                      {e.note ?? (e.set ? '設定済み' : '未設定')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
