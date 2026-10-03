// 反応の記録の「形」だけを決めるところ。
// 画面（ブラウザ側）からも読むので、ここには Firestore など サーバー専用のものを入れない。

/** どの時点で記録するか。key は投稿のドキュメントに入れる名前。 */
export const SNAP_POINTS = [
  { key: 'snap30', minutes: 30, label: '30分後' },
  { key: 'snap60', minutes: 60, label: '1時間後' },
  { key: 'snap120', minutes: 120, label: '2時間後' },
];

/** 目標のいいね数の既定値。 */
export const DEFAULT_LIKE_TARGET = 30; // 30分後
export const DEFAULT_LIKE_TARGET_2H = 50; // 2時間後

/**
 * 「伸びた」とみなす枠。
 * tone は画面での色分け（green = 30分で伸びた、red = 2時間で伸びた）。
 * 上にあるものから先に当てはめるので、早く伸びたほうが優先される。
 */
export const HIT_RULES = [
  { key: 'snap30', minutes: 30, label: '30分後', tone: 'green', defaultTarget: DEFAULT_LIKE_TARGET },
  { key: 'snap120', minutes: 120, label: '2時間後', tone: 'red', defaultTarget: DEFAULT_LIKE_TARGET_2H },
];

/** 枠ごとの目標いいね数の既定。{ snap30: 30, snap120: 50 } の形。 */
export function defaultTargets() {
  return Object.fromEntries(HIT_RULES.map((r) => [r.key, r.defaultTarget]));
}

/** その枠の目標いいね数。数字ひとつを渡されたら、どの枠にもその数を使う。 */
function targetFor(rule, targets) {
  if (typeof targets === 'number') return targets;
  const n = targets?.[rule.key];
  return Number.isFinite(n) && n > 0 ? n : rule.defaultTarget;
}

/** その投稿の、記録できたいいね数のうち多いほう。 */
export function bestLikes(post) {
  return Math.max(...SNAP_POINTS.map((pt) => post?.[pt.key]?.likes ?? 0), 0);
}

/** どの枠に当てはまったか。当てはまらなければ null。 */
export function hitRuleOf(post, targets = defaultTargets()) {
  for (const rule of HIT_RULES) {
    if ((post?.[rule.key]?.likes ?? 0) >= targetFor(rule, targets)) return rule;
  }
  return null;
}

/** 目標のいいね数に届いたか。届いていれば、どの時点で届いたかを返す。 */
export function reachedTarget(post, targets = defaultTargets()) {
  return hitRuleOf(post, targets)?.label ?? null;
}
