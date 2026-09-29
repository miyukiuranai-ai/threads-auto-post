// 投稿の成果を返す。スプレッドシート（Apps Script）から読む想定。
// 認可は CRON_SECRET（Authorization: Bearer か ?key=）。
//
//   /api/report?key=...                  … JSON
//   /api/report?key=...&format=csv       … CSV（IMPORTDATA でも読める）
//   /api/report?key=...&hours=24         … 何時間ぶんか（既定48）
//   /api/report?key=...&minLikes=30      … このいいね数以上だけ
import { buildReport, toCsv } from '@/lib/server/report.mjs';
import { isAuthorizedCron } from '@/lib/server/cron-auth.mjs';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  if (!isAuthorizedCron(request)) {
    return Response.json({ error: '認可されていません。' }, { status: 401 });
  }

  try {
    const params = new URL(request.url).searchParams;
    const num = (name, fallback) => {
      const n = Number(params.get(name));
      return Number.isFinite(n) && n >= 0 ? n : fallback;
    };

    const report = await buildReport({
      hours: Math.min(num('hours', 48), 24 * 30),
      minLikes: num('minLikes', 0),
      limit: Math.min(num('limit', 500), 1000),
    });

    if (params.get('format') === 'csv') {
      return new Response(toCsv(report), {
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }
    return Response.json(report);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
