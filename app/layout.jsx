import './globals.css';
import { headers } from 'next/headers';
import Sidebar from './_components/Sidebar';
import { listAccounts, listPostedSince } from '@/lib/server/repo.mjs';
import { getCurrentUser, filterAccountsForUser } from '@/lib/server/auth.mjs';
import { postingMode } from '@/lib/server/publish.mjs';
import { hitPosts, likeTargets } from '@/lib/server/insights.mjs';

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
  let hits = [];
  let dbError = null;
  try {
    const accounts = filterAccountsForUser(await listAccounts(), user);
    accountCount = accounts.length;

    // いいねが伸びた投稿を、どのページからでも見えるようにする
    const since = new Date(Date.now() - 24 * 3600000).toISOString();
    const visible = new Set(accounts.map((a) => a.id));
    const posts = (await listPostedSince(since)).filter((p) => visible.has(p.accountId));
    hits = hitPosts({ posts, accounts });
  } catch (err) {
    dbError = err.message;
  }

  return (
    <html lang="ja">
      <body>
        <div className="shell">
          <Sidebar user={user} mode={postingMode()} accountCount={accountCount} dbError={dbError} hits={hits} targets={likeTargets()} />
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
