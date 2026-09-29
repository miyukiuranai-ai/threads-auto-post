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
export const PROFILE_LIMITS = { items: 20, keyLength: 20, valueLength: 60, candidates: 30 };

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

/** その名義に付いている属性（看護師など）。無ければ空文字。 */
export function attributeOf(account) {
  return String(account?.profile?.[ATTRIBUTE_KEY] ?? '').trim();
}

/**
 * 属性ごとの言い回しを整える。
 * { 属性: ['看護師', 'ナース'], 前置き: ['夜勤明けで'] } の形にする。
 */
export function normalizeWords(words) {
  const out = {};
  for (const [rawKey, rawList] of Object.entries(words ?? {})) {
    const key = normalizeKey(rawKey).slice(0, PROFILE_LIMITS.keyLength);
    if (!key) continue;
    const list = (Array.isArray(rawList) ? rawList : String(rawList ?? '').split('\n'))
      .map((v) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, PROFILE_LIMITS.valueLength))
      .filter(Boolean);
    const unique = [...new Set(list)].slice(0, PROFILE_LIMITS.candidates);
    if (unique.length) out[key] = unique;
    if (Object.keys(out).length >= PROFILE_LIMITS.items) break;
  }
  return out;
}

/** 改行で区切られた文字列を、候補の配列にする（画面の入力欄用）。 */
export function splitCandidates(text) {
  return String(text ?? '')
    .split(/[\n]+/)
    .map((v) => v.trim())
    .filter(Boolean);
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
 * 文章の {項目名} を、その名義の言葉に置き換える。
 *
 * どの言葉を使うかは、次の順で決める。
 *   1. 名義に直接入れた値（「他の項目も使う」で入れたもの）
 *   2. その名義の属性に登録した言い回しの候補 → 毎回そこから1つ選ぶ
 *   3. {属性} だけは、候補が無ければ属性の名前そのもの（看護師 など）
 *   4. {ユーザー名} は名義の名前
 * どれも無ければ置き換えず missing に残す（呼び出し側が投稿を止める）。
 *
 * @param {string} body
 * @param {object} account
 * @param {object} [words]  その名義の属性に登録した候補 { 属性: [...], 前置き: [...] }
 * @param {() => number} [rand]  候補の選び方（試験で固定するため）
 */
export function fillProfile(body, account, words = null, rand = Math.random) {
  const values = profileOf(account);
  const candidates = normalizeWords(words);
  const attribute = attributeOf(account);

  // 同じ投稿の中では、同じ項目には同じ言葉を使う
  const chosen = {};
  const pick = (key) => {
    if (chosen[key] != null) return chosen[key];

    let value = values[key];
    if (value == null && key !== ATTRIBUTE_KEY && candidates[key]?.length) {
      value = candidates[key][Math.floor(rand() * candidates[key].length)];
    }
    // 属性は「どの候補を使うか」の選び手なので、候補を先に見る
    if (key === ATTRIBUTE_KEY) {
      const list = candidates[ATTRIBUTE_KEY];
      value = list?.length ? list[Math.floor(rand() * list.length)] : attribute || undefined;
    }
    chosen[key] = value ?? null;
    return chosen[key];
  };

  const missing = [];
  const filled = String(body ?? '').replace(PLACEHOLDER, (whole, rawKey) => {
    const key = normalizeKey(rawKey);
    const value = pick(key);
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

/** まだ言葉が決まっていない項目名（属性の候補も見る）。 */
export function missingKeys(account, templates, words = null) {
  const values = profileOf(account);
  const candidates = normalizeWords(words);
  const attribute = attributeOf(account);
  return neededKeys(templates).filter((key) => {
    if (key === ATTRIBUTE_KEY) return !(candidates[ATTRIBUTE_KEY]?.length || attribute);
    return values[key] == null && !candidates[key]?.length;
  });
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
