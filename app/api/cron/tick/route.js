// 定期実行の入口。5分おきに呼ばれ、自動投稿の枠と予約投稿を処理する。
// 認可は CRON_SECRET（Authorization: Bearer か ?key=）。
import { runTick } from '@/lib/server/tick.mjs';
import { isAuthorizedCron } from '@/lib/server/cron-auth.mjs';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request) {
  if (!isAuthorizedCron(request)) {
    return Response.json({ error: '認可されていません。' }, { status: 401 });
  }
  try {
    const result = await runTick({ budgetMs: 270_000 });
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
