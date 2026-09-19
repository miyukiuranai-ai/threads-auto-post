import './globals.css';
import { headers } from 'next/headers';
import Sidebar from './_components/Sidebar';
import { listAccounts } from '@/lib/server/repo.mjs';
import { getCurrentUser, filterAccountsForUser } from '@/lib/server/auth.mjs';
import { postingMode } from '@/lib/server/publish.mjs';

export const metadata = {
  title: 'threads-auto-post',
  description: '公式 Threads API で複数名義を一括で自動投稿する管理画面',
};

export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }) {
  // ログイン画面だけはサイドバーを出さない
  const pathname = (await headers()).get('x-pathname') ?? '';
  if (pathname === '/login') {
    return (
      <html lang="ja">
        <body>{children}</body>
      </html>
    );
  }

  const user = await getCurrentUser();

  // Firestore 未設定でも画面自体は開けるようにする（設定画面で案内を出す）
  let accountCount = null;
  let dbError = null;
  try {
    accountCount = filterAccountsForUser(await listAccounts(), user).length;
  } catch (err) {
    dbError = err.message;
  }

  return (
    <html lang="ja">
      <body>
        <div className="shell">
          <Sidebar user={user} mode={postingMode()} accountCount={accountCount} dbError={dbError} />
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
