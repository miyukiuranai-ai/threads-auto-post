import { listAccounts, listTemplates } from '@/lib/server/repo.mjs';
import { getCurrentUser, filterAccountsForUser } from '@/lib/server/auth.mjs';
import { toJstShort } from '@/lib/server/time.mjs';
import ImportForm from './ImportForm';
import TemplateRow from './TemplateRow';
import BulkDeleteForm from './BulkDeleteForm';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 100;

export default async function TemplatesPage({ searchParams }) {
  const params = await searchParams;
  const user = await getCurrentUser();

  let accounts = [];
  let templates = [];
  let dbError = null;
  try {
    accounts = filterAccountsForUser(await listAccounts(), user);
    const visible = new Set(accounts.map((a) => a.id));
    templates = (await listTemplates()).filter((t) => t.accountId == null || visible.has(t.accountId));
  } catch (err) {
    dbError = err.message;
  }

  const scope = params?.scope ?? 'all'; // all / shared / <accountId>
  const tag = params?.tag ?? '';
  const state = params?.state ?? 'all'; // all / enabled / disabled
  const q = String(params?.q ?? '').trim();
  const page = Math.max(1, Number(params?.page ?? 1) || 1);

  let filtered = templates;
  if (scope === 'shared') filtered = filtered.filter((t) => t.accountId == null);
  else if (scope !== 'all') filtered = filtered.filter((t) => t.accountId === scope);
  if (tag) filtered = filtered.filter((t) => (t.tags ?? []).includes(tag));
  if (state === 'enabled') filtered = filtered.filter((t) => t.enabled !== false);
  if (state === 'disabled') filtered = filtered.filter((t) => t.enabled === false);
  if (q) filtered = filtered.filter((t) => String(t.body ?? '').includes(q));

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const shown = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const allTags = [...new Set(templates.flatMap((t) => t.tags ?? []))].sort();
  const countShared = templates.filter((t) => t.accountId == null).length;
  const countByAccount = new Map(accounts.map((a) => [a.id, templates.filter((t) => t.accountId === a.id).length]));

  const link = (extra) => {
    const next = { scope, tag, state, q, page: 1, ...extra };
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v && !(k === 'scope' && v === 'all') && !(k === 'state' && v === 'all') && !(k === 'page' && v === 1)) sp.set(k, String(v));
    const s = sp.toString();
    return `/templates${s ? `?${s}` : ''}`;
  };

  const slim = accounts.map((a) => ({ id: a.id, name: a.name }));
  const scopeLabel = scope === 'all' ? 'すべて' : scope === 'shared' ? '全名義共通' : `@${accounts.find((a) => a.id === scope)?.name ?? scope}`;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>文章ストック</h1>
          <p className="page-desc">自動投稿は、ここに入れた文章から1本ずつ取り出して投稿します。全部で {templates.length} 本（有効 {templates.filter((t) => t.enabled !== false).length} 本）。</p>
        </div>
      </div>

      {dbError && (
        <div className="notice" data-tone="danger">
          <strong>Firestore に接続できていません。</strong>
          <div style={{ marginTop: 6 }}>{dbError}</div>
        </div>
      )}

      <section className="card">
        <div className="card-head">
          <div className="card-title">
            ✦ 文章を取り込む <small>数百本まとめて入れられます</small>
          </div>
        </div>
        <ImportForm accounts={slim} defaultScope={scope !== 'all' && scope !== 'shared' ? scope : 'shared'} />
      </section>

      <div className="filter-row">
        <a className="filter-chip" data-active={scope === 'all'} href={link({ scope: 'all' })}>
          すべて {templates.length}
        </a>
        <a className="filter-chip" data-active={scope === 'shared'} href={link({ scope: 'shared' })}>
          全名義共通 {countShared}
        </a>
        {accounts.map((a) => (
          <a key={a.id} className="filter-chip" data-active={scope === a.id} href={link({ scope: a.id })}>
            @{a.name} {countByAccount.get(a.id) ?? 0}
          </a>
        ))}
      </div>

      {(allTags.length > 0 || state !== 'all') && (
        <div className="filter-row">
          <span className="stat-note">タグ:</span>
          <a className="filter-chip" data-active={!tag} href={link({ tag: '' })}>
            指定なし
          </a>
          {allTags.map((t) => (
            <a key={t} className="filter-chip" data-active={tag === t} href={link({ tag: t })}>
              {t}
            </a>
          ))}
          <span className="stat-note" style={{ marginLeft: 10 }}>
            状態:
          </span>
          <a className="filter-chip" data-active={state === 'all'} href={link({ state: 'all' })}>
            すべて
          </a>
          <a className="filter-chip" data-active={state === 'enabled'} href={link({ state: 'enabled' })}>
            有効
          </a>
          <a className="filter-chip" data-active={state === 'disabled'} href={link({ state: 'disabled' })}>
            無効
          </a>
        </div>
      )}

      <form method="get" action="/templates" className="filter-row">
        <input type="hidden" name="scope" value={scope} />
        <input type="hidden" name="tag" value={tag} />
        <input type="hidden" name="state" value={state} />
        <input name="q" defaultValue={q} placeholder="本文で検索" className="inline-input" style={{ width: 260 }} />
        <button className="btn" type="submit">
          検索
        </button>
        {q && (
          <a className="btn" href={link({ q: '' })}>
            解除
          </a>
        )}
      </form>

      <section className="card">
        <div className="card-head">
          <div className="card-title">
            ✦ {scopeLabel}
            {tag && <span className="tag">{tag}</span>}
            <small>
              {filtered.length}本{totalPages > 1 ? `（${page} / ${totalPages}ページ）` : ''}
            </small>
          </div>
          {filtered.length > 0 && <BulkDeleteForm ids={filtered.map((t) => t.id)} label={`${scopeLabel}${tag ? `・タグ「${tag}」` : ''}${q ? `・「${q}」を含む` : ''}`} />}
        </div>

        {shown.length === 0 ? (
          <div className="empty">
            文章がまだありません。
            <br />
            上の欄に貼り付けて取り込んでください。
          </div>
        ) : (
          <div>
            {shown.map((t) => (
              <TemplateRow key={t.id} template={t} accounts={slim} lastUsedLabel={toJstShort(t.lastUsedAt)} />
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div className="filter-row" style={{ marginTop: 16 }}>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
              <a key={n} className="filter-chip" data-active={n === page} href={link({ page: n })}>
                {n}
              </a>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
