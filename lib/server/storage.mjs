// 画像・動画の置き場所（Firebase Storage）。
//
// Threads API はファイルそのものを受け取らず、URL を渡して取りに来させる方式なので、
// 一度どこかに置いて URL を作る必要がある。
// バケットは非公開のままにして、投稿のたびに期限つきの URL を発行する。
//
// Vercel は 4.5MB を超えるリクエストを通せないため、ファイル本体は
// ブラウザから直接バケットへ送る（PUT 用の一時 URL を発行する）。
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { getDb, COLLECTIONS } from './firebase.mjs';

/** Threads の受け付ける形式と上限（公式ドキュメントの値）。 */
export const MEDIA_LIMITS = {
  image: {
    types: ['image/jpeg', 'image/png'],
    maxBytes: 8 * 1024 * 1024, // 8MB
    note: 'JPEG か PNG。8MBまで。幅320〜1440px、縦横比は10:1まで',
  },
  video: {
    types: ['video/mp4', 'video/quicktime'],
    maxBytes: 1024 * 1024 * 1024, // 1GB
    note: 'MP4 か MOV（H.264/HEVC + AAC）。1GBまで、5分まで。23〜60fps、横1920pxまで',
  },
  /** 複数枚（カルーセル）にできる数。 */
  carousel: { min: 2, max: 20 },
};

/** 投稿に使う一時 URL の有効期間。投稿処理が終わるまで持てばよい。 */
const SIGNED_URL_MINUTES = 60;

/** アップロード用の一時 URL の有効期間。 */
const UPLOAD_URL_MINUTES = 30;

const BUCKET_KEY = Symbol.for('threads-auto-post.storage-bucket');

/** バケットを返す。名前は環境変数がなければプロジェクト ID から組み立てる。 */
export function getBucket() {
  if (globalThis[BUCKET_KEY]) return globalThis[BUCKET_KEY];

  // getDb() 側で初期化済みのアプリを使い回す
  getDb();
  const app = getApps()[0] ?? initializeApp({ credential: cert({}) });

  const name = process.env.FIREBASE_STORAGE_BUCKET ?? `${process.env.FIREBASE_PROJECT_ID}.firebasestorage.app`;

  const bucket = getStorage(app).bucket(name);
  globalThis[BUCKET_KEY] = bucket;
  return bucket;
}

/** 種類を判定する。対応していなければ null。 */
export function kindOf(contentType) {
  if (MEDIA_LIMITS.image.types.includes(contentType)) return 'image';
  if (MEDIA_LIMITS.video.types.includes(contentType)) return 'video';
  return null;
}

function extOf(contentType) {
  return contentType.split('/')[1].replace('quicktime', 'mov').replace('jpeg', 'jpg');
}

/**
 * 送ってよいか確かめ、送り先の一時 URL を作る。
 * fingerprint は「先頭4MBのSHA-256 + サイズ」。同じファイルは同じ場所に置く。
 */
export async function planUpload({ fingerprint, contentType, bytes }) {
  const kind = kindOf(contentType);
  if (!kind) {
    throw new Error(`この形式には対応していません（${contentType || '不明'}）。JPEG / PNG / MP4 / MOV を使ってください。`);
  }

  const limit = MEDIA_LIMITS[kind];
  if (!Number.isFinite(bytes) || bytes <= 0) throw new Error('ファイルを読み取れませんでした。');
  if (bytes > limit.maxBytes) {
    throw new Error(`ファイルが大きすぎます（${(bytes / 1024 / 1024).toFixed(1)}MB）。${limit.note}`);
  }
  if (!/^[0-9a-f]{64}-\d+$/.test(String(fingerprint ?? ''))) {
    throw new Error('ファイルの指紋を作れませんでした。');
  }

  const path = `uploads/${fingerprint.slice(0, 16)}-${bytes}.${extOf(contentType)}`;

  const [uploadUrl] = await getBucket()
    .file(path)
    .getSignedUrl({
      version: 'v4',
      action: 'write',
      contentType,
      expires: Date.now() + UPLOAD_URL_MINUTES * 60000,
    });

  return { uploadUrl, path, kind };
}

/** 送り終わったファイルを確かめて、投稿に付けられる形（media の1要素）を返す。 */
export async function confirmUpload({ fingerprint, path, contentType, bytes, name, uploadedBy }) {
  const kind = kindOf(contentType);
  if (!kind) throw new Error('この形式には対応していません。');
  if (!/^uploads\/[0-9a-f]{16}-\d+\.[a-z0-9]+$/.test(String(path ?? ''))) throw new Error('保存先が不正です。');

  const [exists] = await getBucket().file(path).exists();
  if (!exists) throw new Error('アップロードが完了していません。もう一度お試しください。');

  const now = new Date().toISOString();
  await getDb()
    .collection(COLLECTIONS.media)
    .doc(String(fingerprint).slice(0, 80))
    .set(
      {
        fingerprint,
        path,
        kind,
        contentType,
        bytes,
        name: name ?? null,
        uploadedBy: uploadedBy ?? null,
        createdAt: now,
      },
      { merge: true }
    );

  return { fingerprint, path, kind, contentType, bytes, name: name ?? null };
}

/** Threads に渡すための、期限つき URL を作る。 */
export async function signedUrl(path, minutes = SIGNED_URL_MINUTES) {
  const [url] = await getBucket()
    .file(path)
    .getSignedUrl({ action: 'read', expires: Date.now() + minutes * 60000 });
  return url;
}

/** 画面で見せるための短い URL（サムネイル用）。 */
export async function previewUrl(path) {
  try {
    return await signedUrl(path, 30);
  } catch {
    return null;
  }
}

/** media の配列を安全に読む（壊れた値は捨てる）。 */
export function normalizeMedia(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((m) => m && typeof m.path === 'string' && (m.kind === 'image' || m.kind === 'video'))
    .slice(0, MEDIA_LIMITS.carousel.max)
    .map((m) => ({
      fingerprint: String(m.fingerprint ?? ''),
      path: m.path,
      kind: m.kind,
      contentType: String(m.contentType ?? ''),
      bytes: Number(m.bytes ?? 0),
      name: m.name ? String(m.name).slice(0, 120) : null,
    }));
}
