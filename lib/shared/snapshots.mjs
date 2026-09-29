// 反応の記録の「形」だけを決めるところ。
// 画面（ブラウザ側）からも読むので、ここには Firestore など サーバー専用のものを入れない。

/** どの時点で記録するか。key は投稿のドキュメントに入れる名前。 */
export const SNAP_POINTS = [
  { key: 'snap30', minutes: 30, label: '30分後' },
  { key: 'snap60', minutes: 60, label: '1時間後' },
];

/** 目標のいいね数の既定値。 */
export const DEFAULT_LIKE_TARGET = 30;

/** その投稿の、記録できたいいね数のうち多いほう。 */
export function bestLikes(post) {
  return Math.max(...SNAP_POINTS.map((pt) => post?.[pt.key]?.likes ?? 0), 0);
}

/** 目標のいいね数に届いたか。届いていれば、どの時点で届いたかを返す。 */
export function reachedTarget(post, target = DEFAULT_LIKE_TARGET) {
  for (const point of SNAP_POINTS) {
    if ((post?.[point.key]?.likes ?? 0) >= target) return point.label;
  }
  return null;
}
