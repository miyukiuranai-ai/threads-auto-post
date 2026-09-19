// Vercel Cron から毎日呼ばれるトークン延長エンドポイント（tick の中でも1日1回行うので、二重の備え）。
import { refreshTokens } from '@/lib/server/tokens.mjs';
import { pruneOld } from '@/lib/server/maintenance.mjs';
import { isAuthorizedCron } from '@/lib/server/cron-auth.mjs';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request) {
  if (!isAuthorizedCron(request)) {
    return Response.json({ error: '認可されていません。' }, { status: 401 });
  }
  try {
    const tokens = await refreshTokens({});
    const pruned = await pruneOld();
    return Response.json({ ...tokens, pruned });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
