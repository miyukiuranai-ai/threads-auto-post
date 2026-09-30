// 管理画面へのアクセス制限と、利用者の受け渡し。
// 定期実行と成果の読み出し（/api/cron, /api/report）は CRON_SECRET で守られているので対象外にする。
import { NextResponse } from 'next/server';
import { isAuthConfigured, USER_HEADERS } from '@/lib/server/auth-core.mjs';
import { SESSION_COOKIE, readSession } from '@/lib/server/session.mjs';

// /api/cron と /api/report は CRON_SECRET で守られているので、ログインの対象から外す。
// 外し忘れると、スプレッドシートから読んだときにログイン画面の HTML が返ってしまう。
export const config = {
  matcher: ['/((?!api/cron|api/report|_next/static|_next/image|favicon.ico).*)'],
};

const LOGIN_PATH = '/login';

/** 画面側で「どのページか」「誰が見ているか」を判断できるようにヘッダへ載せる。 */
function pass(request, user) {
  const headers = new Headers(request.headers);
  headers.set('x-pathname', request.nextUrl.pathname);
  if (user) {
    headers.set(USER_HEADERS.name, user.name);
    headers.set(USER_HEADERS.role, user.role);
    headers.set(USER_HEADERS.group, user.group ?? '');
  }
  return NextResponse.next({ request: { headers } });
}

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  // 未設定ならそのまま通す（ローカル開発でいちいち聞かれないように）
  if (!isAuthConfigured()) return pass(request, null);

  const user = await readSession(request.cookies.get(SESSION_COOKIE)?.value);

  if (pathname === LOGIN_PATH) {
    // ログイン済みなら、ログイン画面には留まらせない
    if (user) return NextResponse.redirect(new URL('/', request.url));
    return pass(request, null);
  }

  if (!user) {
    const to = new URL(LOGIN_PATH, request.url);
    if (pathname !== '/') to.searchParams.set('next', pathname + request.nextUrl.search);
    return NextResponse.redirect(to);
  }

  return pass(request, user);
}
