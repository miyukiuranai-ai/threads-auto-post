import LoginForm from './LoginForm';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'ログイン｜threads-auto-post' };

export default async function LoginPage({ searchParams }) {
  const params = await searchParams;

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="brand" style={{ padding: 0, marginBottom: 18 }}>
          <div className="brand-mark">T</div>
          <div>
            <div className="brand-title" style={{ color: 'var(--ink)' }}>
              threads-auto-post
            </div>
            <div className="stat-note">複数名義の一括投稿</div>
          </div>
        </div>

        <LoginForm next={params?.next ?? ''} />

        <p className="stat-note" style={{ marginBottom: 0 }}>
          IDとパスワードは <code>.env.local</code>（Vercel では環境変数）の ADMIN_USER / ADMIN_PASSWORD です。
        </p>
      </div>
    </div>
  );
}
