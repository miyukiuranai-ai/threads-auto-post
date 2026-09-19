// 文章ストック。自動投稿はここから1本ずつ取り出して投稿する。
//
// 取り出し方（名義ごと）:
//   - ランダム … 一巡するまで同じ文章を出さない。全部使ったら最初から
//   - 順番     … 登録順。全部使ったら最初から
// 名義ごとに「今の一巡で使った ID・残りの ID」を accounts.templateCycle に持ち、
// 取り出しのたびにストック全体を読み直さない（Firestore の読み取りを抑える）。
// ストックを足したり消したりしたら meta/templates.version を上げ、次の取り出しで残りを組み直す。
import { getDb, COLLECTIONS, FieldValue } from './firebase.mjs';
import { normalizeMedia } from './storage.mjs';

/** Threads の本文の上限（文字数）。 */
export const MAX_BODY = 500;

/** 取り込みテキストの区切り方。 */
export const SPLIT_MODES = {
  separator: '「---」だけの行で区切る（本文の中に空行があってもよい）',
  blank: '空行で区切る（1つの文章の中に空行を入れない場合）',
  line: '1行 = 1本',
};

/** 本文を確かめる。問題なければ null、あれば理由。 */
export function validateBody(body) {
  const text = String(body ?? '');
  const length = [...text].length;
  if (!text.trim()) return '本文が空です。';
  if (length > MAX_BODY) return `本文が長すぎます（${length}文字。上限 ${MAX_BODY} 文字）。`;
  return null;
}

/** 文字数（絵文字も1文字と数える）。 */
export function bodyLength(body) {
  return [...String(body ?? '')].length;
}

/** 取り込みテキストを本文の配列にする。 */
export function splitTemplates(text, mode = 'separator') {
  const normalized = String(text ?? '')
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n');

  let parts;
  if (mode === 'line') {
    parts = normalized.split('\n');
  } else if (mode === 'blank') {
    parts = normalized.split(/\n[ \t　]*\n+/);
  } else {
    // 「---」「===」「***」（全角も可）だけの行で区切る
    parts = normalized.split(/^[ \t　]*(?:-{3,}|={3,}|\*{3,}|－{3,}|ー{3,}|＝{3,}|＊{3,})[ \t　]*$/m);
  }

  return parts
    .map((p) => p.replace(/^\n+|\n+$/g, '').replace(/[ \t　]+$/gm, ''))
    .filter((p) => p.trim().length > 0);
}

/** CSV を行 × 列に読む（引用符つきの改行・カンマにも対応）。 */
export function parseCsv(text) {
  const src = String(text ?? '').replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim().length));
}

/** CSV（1列目=本文、2列目=タグ。見出し行は自動で飛ばす）を取り込みの形にする。 */
export function templatesFromCsv(text) {
  const rows = parseCsv(text);
  const out = [];
  for (const [index, row] of rows.entries()) {
    const body = String(row[0] ?? '').replace(/\r\n?/g, '\n').trim();
    if (index === 0 && /^(本文|body|text|文章|内容)$/i.test(body)) continue;
    if (!body) continue;
    out.push({ body, tags: parseTags(row[1] ?? '') });
  }
  return out;
}

/** 「占い, 朝」「#占い #朝」のようなタグの文字列を配列にする。 */
export function parseTags(text) {
  return [
    ...new Set(
      String(text ?? '')
        .split(/[,、，\s　#＃]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => s.slice(0, 30))
    ),
  ].slice(0, 20);
}

/** ストックを変えたことを記録する（名義ごとの残りリストが組み直される）。 */
export async function bumpTemplateVersion(db = getDb()) {
  await db
    .collection(COLLECTIONS.meta)
    .doc('templates')
    .set({ version: FieldValue.increment(1), updatedAt: new Date().toISOString() }, { merge: true });
}

async function currentVersion(db) {
  const snap = await db.collection(COLLECTIONS.meta).doc('templates').get();
  return snap.exists ? Number(snap.data().version ?? 0) : 0;
}

/** Firestore の一括書き込みは1回500件まで。少なめに区切る。 */
const BATCH = 400;

/**
 * 文章をまとめて登録する。
 * @param {object} opts
 * @param {{body:string, tags?:string[], media?:object[]}[]} opts.items
 * @param {string|null} opts.accountId  null なら「全名義共通」
 * @param {string[]} [opts.tags]        全件に付けるタグ
 * @param {string} [opts.createdBy]
 */
export async function addTemplates({ items, accountId, tags = [], createdBy = null }) {
  const db = getDb();
  const now = new Date().toISOString();
  const base = Date.now();
  const skipped = [];
  const accepted = [];

  for (const [index, item] of items.entries()) {
    const body = String(item.body ?? '').replace(/\r\n?/g, '\n');
    const problem = validateBody(body);
    if (problem) {
      skipped.push({ index: index + 1, reason: problem, preview: body.trim().slice(0, 30) });
      continue;
    }
    accepted.push({
      body,
      tags: [...new Set([...(tags ?? []), ...(item.tags ?? [])])],
      media: normalizeMedia(item.media),
      accountId: accountId ?? null,
      enabled: true,
      order: base + index,
      useCount: 0,
      lastUsedAt: null,
      createdAt: now,
      updatedAt: now,
      createdBy,
    });
  }

  for (let i = 0; i < accepted.length; i += BATCH) {
    const batch = db.batch();
    for (const doc of accepted.slice(i, i + BATCH)) {
      batch.set(db.collection(COLLECTIONS.templates).doc(), doc);
    }
    await batch.commit();
  }

  if (accepted.length) await bumpTemplateVersion(db);
  return { added: accepted.length, skipped };
}

/** 名義の設定から、どのストックを使うかを表す鍵。変わったら一巡をやり直す。 */
export function poolKeyOf(account) {
  const s = account.schedule ?? {};
  return `${account.id}|${s.source ?? 'both'}|${s.tag ?? ''}|${s.order ?? 'random'}`;
}

function docsOf(snap) {
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** この名義が使えるストック（有効なものだけ）。登録順。 */
export async function loadPool(db, account) {
  const s = account.schedule ?? {};
  const source = s.source ?? 'both';
  const tag = String(s.tag ?? '').trim();

  const queries = [];
  if (source !== 'shared') queries.push(db.collection(COLLECTIONS.templates).where('accountId', '==', account.id).get());
  if (source !== 'own') queries.push(db.collection(COLLECTIONS.templates).where('accountId', '==', null).get());

  const snaps = await Promise.all(queries);
  const all = snaps.flatMap(docsOf);

  return all
    .filter((t) => t.enabled !== false)
    .filter((t) => !tag || (Array.isArray(t.tags) && t.tags.includes(tag)))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')))
    .map((t) => t.id);
}

function shuffle(list, rand = Math.random) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * 次に使う文章を1本取り出す。取り出した記録（名義の一巡・文章の使用回数）も保存する。
 * ストックが空なら null。
 */
export async function pickTemplate({ db = getDb(), account, rand = Math.random }) {
  const version = await currentVersion(db);
  const poolKey = poolKeyOf(account);
  const order = account.schedule?.order === 'sequential' ? 'sequential' : 'random';

  let cycle = account.templateCycle ?? null;
  const sameCycle = cycle && cycle.poolKey === poolKey;
  let used = sameCycle && Array.isArray(cycle.used) ? [...cycle.used] : [];
  let remaining = sameCycle && Array.isArray(cycle.remaining) ? [...cycle.remaining] : [];
  let total = sameCycle ? Number(cycle.total ?? 0) : 0;

  const needRebuild = !sameCycle || cycle.version !== version || remaining.length === 0;
  if (needRebuild) {
    const pool = await loadPool(db, account);
    if (!pool.length) {
      await saveCycle(db, account.id, { version, poolKey, used: [], remaining: [], total: 0 });
      return null;
    }
    const usedSet = new Set(used);
    let rest = pool.filter((id) => !usedSet.has(id));
    if (!rest.length) {
      // 全部使い切ったので、次の一巡へ
      used = [];
      rest = pool;
    }
    remaining = order === 'random' ? shuffle(rest, rand) : rest;
    total = pool.length;
  }

  // 消された・無効にされた文章は飛ばす
  while (remaining.length) {
    const id = remaining.shift();
    const snap = await db.collection(COLLECTIONS.templates).doc(id).get();
    if (!snap.exists || snap.data().enabled === false) continue;

    used.push(id);
    await saveCycle(db, account.id, { version, poolKey, used, remaining, total });
    await snap.ref.set(
      { useCount: FieldValue.increment(1), lastUsedAt: new Date().toISOString(), lastUsedBy: account.id },
      { merge: true }
    );
    return { id: snap.id, ...snap.data() };
  }

  await saveCycle(db, account.id, { version, poolKey, used, remaining: [], total });
  return null;
}

async function saveCycle(db, accountId, cycle) {
  await db
    .collection(COLLECTIONS.accounts)
    .doc(accountId)
    .set({ templateCycle: { ...cycle, updatedAt: new Date().toISOString() } }, { merge: true });
}

/** 画面用: この名義の一巡の進み具合。 */
export function cycleSummary(account) {
  const c = account?.templateCycle;
  if (!c || c.poolKey !== poolKeyOf(account)) return null;
  return { used: (c.used ?? []).length, remaining: (c.remaining ?? []).length, total: Number(c.total ?? 0) };
}
