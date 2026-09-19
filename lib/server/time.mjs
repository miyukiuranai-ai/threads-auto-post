// 日本時間の扱い。
// サーバー（Vercel）は UTC で動くので、画面と設定は日本時間、保存は ISO（UTC）に統一する。
// 日本には夏時間が無いので、9時間ずらすだけでよい。

export const JST_OFFSET_MS = 9 * 3600000;

const pad = (n) => String(n).padStart(2, '0');

function toMillis(input) {
  if (input instanceof Date) return input.getTime();
  if (typeof input === 'number') return input;
  return new Date(input).getTime();
}

/** 日本時間の年月日・時分・曜日。 */
export function jstParts(input = new Date()) {
  const d = new Date(toMillis(input) + JST_OFFSET_MS);
  return {
    y: d.getUTCFullYear(),
    mo: d.getUTCMonth() + 1,
    d: d.getUTCDate(),
    h: d.getUTCHours(),
    mi: d.getUTCMinutes(),
    dow: d.getUTCDay(),
  };
}

/** 日本時間の日付 "YYYY-MM-DD"。 */
export function jstDateKey(input = new Date()) {
  const p = jstParts(input);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}`;
}

/** 日本時間の時刻 "HH:MM"。 */
export function jstTimeKey(input = new Date()) {
  const p = jstParts(input);
  return `${pad(p.h)}:${pad(p.mi)}`;
}

/** 日本時間の日付と時刻を ISO（UTC）にする。 */
export function jstToIso(dateKey, timeKey) {
  const [y, mo, d] = dateKey.split('-').map(Number);
  const [h, mi] = timeKey.split(':').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, mi) - JST_OFFSET_MS).toISOString();
}

/** 日付キーに日数を足す。 */
export function addDays(dateKey, n) {
  const [y, mo, d] = dateKey.split('-').map(Number);
  const t = Date.UTC(y, mo - 1, d) + n * 86400000;
  const x = new Date(t);
  return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`;
}

/** 画面に出す "YYYY-MM-DD HH:MM"（日本時間）。 */
export function toJstLabel(iso) {
  if (!iso) return '-';
  const t = toMillis(iso);
  if (Number.isNaN(t)) return '-';
  return `${jstDateKey(t)} ${jstTimeKey(t)}`;
}

/** 短い表示 "MM/DD HH:MM"。 */
export function toJstShort(iso) {
  if (!iso) return '-';
  const t = toMillis(iso);
  if (Number.isNaN(t)) return '-';
  const p = jstParts(t);
  return `${pad(p.mo)}/${pad(p.d)} ${pad(p.h)}:${pad(p.mi)}`;
}

/** datetime-local 用の "YYYY-MM-DDTHH:MM"（日本時間）。 */
export function toLocalInput(iso) {
  if (!iso) return '';
  const t = toMillis(iso);
  if (Number.isNaN(t)) return '';
  return `${jstDateKey(t)}T${jstTimeKey(t)}`;
}

/** datetime-local の値（日本時間として扱う）を ISO にする。壊れていれば null。 */
export function fromLocalInput(value) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(String(value ?? '').trim());
  if (!m) return null;
  const iso = jstToIso(m[1], m[2]);
  return Number.isNaN(new Date(iso).getTime()) ? null : iso;
}

/** "HH:MM" → 0時からの分。 */
export function minutesOfDay(timeKey) {
  const [h, mi] = timeKey.split(':').map(Number);
  return h * 60 + mi;
}

/** 分 → "HH:MM"。 */
export function timeKeyOfMinutes(minutes) {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/**
 * 「7:00, 12時30分 21:00」のような入力を "HH:MM" の一覧にする（重複を除き、時刻順）。
 * 読めない部分があれば理由つきで例外にする。
 */
export function parseTimes(text) {
  const raw = String(text ?? '')
    .replace(/[／/、，]/g, ',')
    .replace(/[　\s]+/g, ',')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const out = new Set();
  for (const item of raw) {
    let m = /^(\d{1,2})[:：時](\d{1,2})?分?$/.exec(item);
    if (!m) throw new Error(`時刻の書き方が読めません: 「${item}」。例: 07:00, 12:30, 21:00`);
    const h = Number(m[1]);
    const mi = Number(m[2] ?? 0);
    if (h > 23 || mi > 59) throw new Error(`時刻の範囲が不正です: 「${item}」`);
    out.add(`${pad(h)}:${pad(mi)}`);
  }
  return [...out].sort();
}

/** "HH:MM" として正しいか。 */
export function isTimeKey(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value ?? ''));
}

/** 2つの ISO の差（分）。 */
export function minutesBetween(a, b) {
  return Math.round((toMillis(b) - toMillis(a)) / 60000);
}
