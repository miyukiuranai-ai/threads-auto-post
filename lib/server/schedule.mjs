// 名義ごとの自動投稿の設定。
//
//   毎日の決まった時刻（dailyTimes）と、〇〜〇時間おき（interval）の2通り。両方 ON でもよい。
//   予約投稿・今すぐ投稿は、この設定とは別にいつでもできる。
import { isTimeKey, jstDateKey, jstParts, jstToIso, addDays, minutesOfDay, parseTimes } from './time.mjs';

export const DEFAULT_SCHEDULE = {
  /** 毎日決まった時刻に投稿する */
  dailyEnabled: false,
  dailyTimes: [],
  /** 〇〜〇分おきに投稿する（画面では時間で入力） */
  intervalEnabled: false,
  intervalMinMinutes: 180,
  intervalMaxMinutes: 360,
  /** 間隔投稿を動かす時間帯（この外には出さない。同じ値なら終日） */
  activeFrom: '07:00',
  activeTo: '23:00',
  /** 次に間隔投稿を出す時刻（ツールが計算して保存する） */
  nextIntervalAt: null,
  /** 文章の取り出し方: random（ランダム。一巡するまで重複なし）/ sequential（登録順） */
  order: 'random',
  /** どのストックを使うか: both（この名義用＋全名義共通）/ own / shared */
  source: 'both',
  /** タグで絞る（空なら絞らない） */
  tag: '',
  /** 直前の投稿からこの分数以内なら自動投稿を見送る（予約投稿と重ならないように） */
  minGapMinutes: 30,
};

/** 決まった時刻の投稿は、この分数まで遅れても出す。それ以上遅れたら見送る（定期実行が止まっていた場合など）。 */
export const DAILY_GRACE_MINUTES = 60;

/** 取り出し方の表示名。 */
export const ORDER_LABEL = { random: 'ランダム（一巡するまで重複なし）', sequential: '登録順' };
export const SOURCE_LABEL = { both: 'この名義用 ＋ 全名義共通', own: 'この名義用だけ', shared: '全名義共通だけ' };

const clampInt = (v, min, max, fallback) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};

/** 保存されている値を、欠けや壊れを補って返す。 */
export function normalizeSchedule(input) {
  const s = { ...DEFAULT_SCHEDULE, ...(input && typeof input === 'object' ? input : {}) };
  s.dailyEnabled = Boolean(s.dailyEnabled);
  s.dailyTimes = Array.isArray(s.dailyTimes) ? [...new Set(s.dailyTimes.filter(isTimeKey))].sort() : [];
  s.intervalEnabled = Boolean(s.intervalEnabled);
  s.intervalMinMinutes = clampInt(s.intervalMinMinutes, 10, 7 * 1440, DEFAULT_SCHEDULE.intervalMinMinutes);
  s.intervalMaxMinutes = clampInt(s.intervalMaxMinutes, s.intervalMinMinutes, 7 * 1440, Math.max(s.intervalMinMinutes, DEFAULT_SCHEDULE.intervalMaxMinutes));
  s.activeFrom = isTimeKey(s.activeFrom) ? s.activeFrom : DEFAULT_SCHEDULE.activeFrom;
  s.activeTo = isTimeKey(s.activeTo) ? s.activeTo : DEFAULT_SCHEDULE.activeTo;
  s.order = s.order === 'sequential' ? 'sequential' : 'random';
  s.source = ['both', 'own', 'shared'].includes(s.source) ? s.source : 'both';
  s.tag = String(s.tag ?? '').trim().slice(0, 30);
  s.minGapMinutes = clampInt(s.minGapMinutes, 0, 1440, DEFAULT_SCHEDULE.minGapMinutes);
  s.nextIntervalAt = typeof s.nextIntervalAt === 'string' && !Number.isNaN(new Date(s.nextIntervalAt).getTime()) ? s.nextIntervalAt : null;
  return s;
}

/**
 * 画面のフォームの値から設定を作る。読めない値は理由つきで例外にする。
 * @param {object} form  { dailyEnabled, dailyTimes(文字列), intervalEnabled, intervalMinHours, intervalMaxHours, activeFrom, activeTo, order, source, tag, minGapMinutes }
 */
export function scheduleFromForm(form) {
  const dailyEnabled = Boolean(form.dailyEnabled);
  const dailyTimes = parseTimes(form.dailyTimes ?? '');
  if (dailyEnabled && !dailyTimes.length) throw new Error('毎日の投稿を ON にするなら、時刻を1つ以上入れてください（例: 07:00, 12:30, 21:00）。');

  const minH = Number(String(form.intervalMinHours ?? '').trim());
  const maxH = Number(String(form.intervalMaxHours ?? '').trim());
  const intervalEnabled = Boolean(form.intervalEnabled);
  if (intervalEnabled) {
    if (!Number.isFinite(minH) || !Number.isFinite(maxH) || minH <= 0 || maxH <= 0) {
      throw new Error('「〇時間から〇時間おき」は 0 より大きい数字で入れてください（例: 2 と 5）。');
    }
    if (maxH < minH) throw new Error('間隔の上限は下限以上にしてください。');
  }
  const activeFrom = String(form.activeFrom ?? '07:00');
  const activeTo = String(form.activeTo ?? '23:00');
  if (!isTimeKey(activeFrom) || !isTimeKey(activeTo)) throw new Error('時間帯の時刻は HH:MM で入れてください。');

  return normalizeSchedule({
    dailyEnabled,
    dailyTimes,
    intervalEnabled,
    intervalMinMinutes: intervalEnabled ? Math.round(minH * 60) : DEFAULT_SCHEDULE.intervalMinMinutes,
    intervalMaxMinutes: intervalEnabled ? Math.round(maxH * 60) : DEFAULT_SCHEDULE.intervalMaxMinutes,
    activeFrom,
    activeTo,
    order: form.order,
    source: form.source,
    tag: form.tag,
    minGapMinutes: form.minGapMinutes,
    // 間隔の設定を変えたら、次の時刻は計算し直す
    nextIntervalAt: null,
  });
}

/** 時刻（0時からの分）が時間帯に入っているか。from > to なら日をまたぐ時間帯。 */
export function isWithinWindow(minutes, from, to) {
  const f = minutesOfDay(from);
  const t = minutesOfDay(to);
  if (f === t) return true;
  if (f < t) return minutes >= f && minutes < t;
  return minutes >= f || minutes < t;
}

/** 時間帯の次の開始時刻（now より後）。 */
function nextWindowStart(nowMs, from) {
  const today = jstDateKey(nowMs);
  for (const day of [today, addDays(today, 1)]) {
    const iso = jstToIso(day, from);
    if (new Date(iso).getTime() > nowMs) return new Date(iso).getTime();
  }
  return nowMs;
}

/** 次の間隔投稿の時刻を決める。時間帯の外に出たら次の開始時刻へ寄せる。 */
export function computeNextInterval({ now = new Date(), schedule, rand = Math.random }) {
  const s = normalizeSchedule(schedule);
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const span = s.intervalMaxMinutes - s.intervalMinMinutes;
  const gap = s.intervalMinMinutes + rand() * span;
  let t = nowMs + Math.round(gap * 60000);

  const p = jstParts(t);
  if (!isWithinWindow(p.h * 60 + p.mi, s.activeFrom, s.activeTo)) {
    // 開始時刻ぴったりに全名義が並ばないよう、少しだけばらす
    t = nextWindowStart(t, s.activeFrom) + Math.round(rand() * 15 * 60000);
  }
  return new Date(t).toISOString();
}

/** 毎日の投稿の、いちばん近い次の時刻（表示用）。 */
export function nextDailyAt({ now = new Date(), schedule }) {
  const s = normalizeSchedule(schedule);
  if (!s.dailyEnabled || !s.dailyTimes.length) return null;
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const today = jstDateKey(nowMs);
  for (const day of [today, addDays(today, 1)]) {
    for (const time of s.dailyTimes) {
      const iso = jstToIso(day, time);
      if (new Date(iso).getTime() > nowMs) return iso;
    }
  }
  return null;
}

/** 次に自動投稿が出る時刻（毎日・間隔のうち早いほう）。無ければ null。 */
export function nextAutoAt({ now = new Date(), schedule }) {
  const s = normalizeSchedule(schedule);
  const candidates = [];
  const daily = nextDailyAt({ now, schedule: s });
  if (daily) candidates.push(daily);
  if (s.intervalEnabled && s.nextIntervalAt) candidates.push(s.nextIntervalAt);
  if (!candidates.length) return null;
  return candidates.sort()[0];
}

const hours = (minutes) => {
  const h = minutes / 60;
  return Number.isInteger(h) ? String(h) : h.toFixed(1).replace(/\.0$/, '');
};

/** 一覧に出す短い説明。 */
export function scheduleSummary(schedule) {
  const s = normalizeSchedule(schedule);
  const parts = [];
  if (s.dailyEnabled && s.dailyTimes.length) parts.push(`毎日 ${s.dailyTimes.join('・')}`);
  if (s.intervalEnabled) {
    const window = s.activeFrom === s.activeTo ? '終日' : `${s.activeFrom}〜${s.activeTo}`;
    parts.push(`${hours(s.intervalMinMinutes)}〜${hours(s.intervalMaxMinutes)}時間おき（${window}）`);
  }
  return parts.length ? parts.join(' ／ ') : '自動投稿なし';
}

/** 自動投稿が有効か（毎日か間隔のどちらかが ON）。 */
export function isAutoEnabled(schedule) {
  const s = normalizeSchedule(schedule);
  return (s.dailyEnabled && s.dailyTimes.length > 0) || s.intervalEnabled;
}
