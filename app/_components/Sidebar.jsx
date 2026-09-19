'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { logout } from '../_actions/auth';
import SubmitButton from './SubmitButton';

const NAV = [
  { href: '/', label: '全体状況', sub: '名義ごとの状態と次の投稿' },
  { href: '/compose', label: '今すぐ投稿・予約', sub: '文章と画像・動画を送る' },
  { href: '/posts', label: '投稿の予定と履歴', sub: '予約の変更・取消、結果' },
  { href: '/templates', label: '文章ストック', sub: '自動投稿に使う文章' },
  { href: '/schedule', label: '自動投稿の設定', sub: '毎日の時刻・〇時間おき' },
  { href: '/settings', label: '名義の管理', sub: 'トークンの登録・停止' },
];

export default function Sidebar({ user, mode, accountCount, dbError }) {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">T</div>
        <div>
          <div className="brand-title">threads-auto-post</div>
          <div className="brand-sub">{accountCount != null ? `名義 ${accountCount}件` : '複数名義の一括投稿'}</div>
        </div>
      </div>

      <nav className="nav">
        {NAV.map((item) => (
          <Link key={item.href} href={item.href} data-active={item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)}>
            {item.label}
            <span className="nav-sub">{item.sub}</span>
          </Link>
        ))}
      </nav>

      <div className="sidebar-foot">
        <div className="brand-sub" style={{ marginBottom: 6 }}>
          投稿モード
        </div>
        <div className="guard">
          <span className="dot" data-state={dbError ? 'stopped' : mode === 'dry_run' ? 'warn' : 'ok'} />
          {dbError ? 'DB未接続' : mode === 'dry_run' ? 'テスト（送らない）' : '本番（実際に投稿）'}
        </div>

        {user && (
          <div className="sidebar-user">
            <div>
              <div className="sidebar-user-name">{user.name}</div>
              <div className="brand-sub">{user.role === 'admin' ? '管理者' : `メンバー・${user.group ?? '-'}`}</div>
            </div>
            <form action={logout}>
              <SubmitButton className="btn btn-logout" pendingLabel="…">
                ログアウト
              </SubmitButton>
            </form>
          </div>
        )}
      </div>
    </aside>
  );
}
