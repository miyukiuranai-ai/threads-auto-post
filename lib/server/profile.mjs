// 名義ごとの属性（年齢・職業など）と、文章への差し込み。
//
// 文章の中に {職業} のように書いておくと、投稿するときにその名義の値へ置き換える。
// 同じ文章を、名義ごとに違う言い回しで出せるようにするための仕組み。
//   例: 「{職業}だから夜は遅くて、家には誰もいません」
//       → 看護師の名義なら「看護師だから夜は遅くて、家には誰もいません」
//
// AI は使わない。ただの置き換えなので、書いたとおりの文字がそのまま入る。

/** 置き換えの目印。全角の波かっこ ｛｝ でも書ける。 */
const PLACEHOLDER = /[{｛]([^{}｛｝\n]{1,40})[}｝]/g;

/** 項目名の前後の空白を落とす（「{ 職業 }」でも同じ扱いにする）。 */
const normalizeKey = (key) => String(key ?? '').trim();

/** 属性として登録できる項目の数と長さの上限（際限なく増えないように）。 */
export const PROFILE_LIMITS = { items: 20, keyLength: 20, valueLength: 60 };

/** 人物像を表す項目の名前。画面では一覧から選ぶ形にしている。 */
export const ATTRIBUTE_KEY = '属性';

/** 最初から選べる属性（画面の一覧に出る）。ここに無いものは「その他」で足せる。 */
export const ATTRIBUTE_CHOICES = ['看護師', '保育士', '教師', 'CA', '女子大生', 'アラサー', 'おばさん', 'シンママ'];

/** 属性以外で、よく使う項目名（入力補助に出す）。 */
export const SUGGESTED_KEYS = ['年齢', '住まい', '名前', '一人称', '職業', '趣味'];

/**
 * 画面の一覧に出す属性を作る。
 * 既定の8つに、すでにどれかの名義で使われている言葉を足す（「その他」で入れたものが次から選べる）。
 */
export function attributeChoices(accounts) {
  const used = (accounts ?? [])
    .map((a) => String(a?.profile?.[ATTRIBUTE_KEY] ?? '').trim())
    .filter(Boolean);
  return [...new Set([...ATTRIBUTE_CHOICES, ...used])];
}

/**
 * 名義から、差し込みに使える項目を作る。
 * ユーザー名はいつでも {ユーザー名} で使える。
 */
export function profileOf(account) {
  const out = {};
  for (const [rawKey, rawValue] of Object.entries(account?.profile ?? {})) {
    const key = normalizeKey(rawKey);
    const value = String(rawValue ?? '').trim();
    if (key && value) out[key] = value;
  }
  if (account?.name) out['ユーザー名'] = String(account.name);
  return out;
}

/** 文章の中で使われている項目名を、重なりを除いて返す。 */
export function findPlaceholders(body) {
  const out = [];
  for (const m of String(body ?? '').matchAll(PLACEHOLDER)) {
    const key = normalizeKey(m[1]);
    if (key && !out.includes(key)) out.push(key);
  }
  return out;
}

/**
 * 文章の {項目名} を、その名義の値に置き換える。
 * 値が無い項目は置き換えず、missing に残す。
 * （気づかないまま「{職業}」のような文字が投稿されるのを防ぐため、呼び出し側で止める）
 */
export function fillProfile(body, account) {
  const values = profileOf(account);
  const missing = [];
  const filled = String(body ?? '').replace(PLACEHOLDER, (whole, rawKey) => {
    const key = normalizeKey(rawKey);
    const value = values[key];
    if (value == null) {
      if (!missing.includes(key)) missing.push(key);
      return whole;
    }
    return value;
  });
  return { body: filled, missing };
}

/** その名義が使う文章すべてで必要になる項目名（設定漏れの案内に使う）。 */
export function neededKeys(templates) {
  const out = [];
  for (const t of templates ?? []) {
    for (const key of findPlaceholders(t.body)) if (!out.includes(key)) out.push(key);
  }
  return out;
}

/** まだ値を入れていない項目名。 */
export function missingKeys(account, templates) {
  const values = profileOf(account);
  return neededKeys(templates).filter((key) => values[key] == null);
}

/**
 * 画面のフォームから送られた項目を、保存できる形に整える。
 * 項目名が重なったら後の値で上書きし、空の行は捨てる。
 */
export function normalizeProfile(entries) {
  const out = {};
  for (const entry of Array.isArray(entries) ? entries : []) {
    const key = normalizeKey(entry?.key).slice(0, PROFILE_LIMITS.keyLength);
    const value = String(entry?.value ?? '').trim().replace(/\s+/g, ' ').slice(0, PROFILE_LIMITS.valueLength);
    if (!key || !value) continue;
    if (key === 'ユーザー名') continue; // これは名義の名前を使うので登録させない
    out[key] = value;
    if (Object.keys(out).length >= PROFILE_LIMITS.items) break;
  }
  return out;
}
