// Threads Graph API の薄いラッパー。副作用（環境変数の読み込み等）は持たせない。

export const GRAPH_BASE = 'https://graph.threads.net';
export const GRAPH_VERSION = 'v1.0';

export class ThreadsApiError extends Error {
  constructor(message, { status, body, endpoint }) {
    super(message);
    this.name = 'ThreadsApiError';
    this.status = status;
    this.body = body;
    this.endpoint = endpoint;
  }
}

/** エラー文の最後の行だけ（画面に出すときに読みやすい）。 */
export function shortError(err) {
  return String(err?.message ?? err)
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .pop();
}

async function parseResponse(res, endpoint) {
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new ThreadsApiError(`レスポンスがJSONではありません: ${text.slice(0, 300)}`, {
      status: res.status,
      body: text,
      endpoint,
    });
  }
  if (!res.ok || json.error) {
    const err = json.error ?? {};
    const detail = [err.message, err.type, err.code && `code=${err.code}`, err.error_subcode && `subcode=${err.error_subcode}`]
      .filter(Boolean)
      .join(' / ');
    throw new ThreadsApiError(
      `Threads API エラー (HTTP ${res.status}) ${endpoint}\n  ${detail || JSON.stringify(json)}`,
      { status: res.status, body: json, endpoint }
    );
  }
  return json;
}

async function get(path, params) {
  const url = new URL(path.startsWith('http') ? path : `${GRAPH_BASE}${path}`);
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, { method: 'GET' });
  return parseResponse(res, `GET ${url.pathname}`);
}

async function post(path, params) {
  const url = new URL(path.startsWith('http') ? path : `${GRAPH_BASE}${path}`);
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== null) body.set(k, String(v));
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  return parseResponse(res, `POST ${url.pathname}`);
}

/** 長期トークンの延長（発行から24時間以上経過かつ有効なトークンが対象）。 */
export function refreshLongLivedToken({ accessToken }) {
  return get('/refresh_access_token', {
    grant_type: 'th_refresh_token',
    access_token: accessToken,
  });
}

/** 自分のプロフィールを取得。 */
export function getMe({ accessToken, fields = 'id,username,threads_profile_picture_url' }) {
  return get(`/${GRAPH_VERSION}/me`, { fields, access_token: accessToken });
}

/** テキスト投稿のコンテナを作成（1段階目）。 */
export function createTextContainer({ accessToken, userId, text }) {
  return post(`/${GRAPH_VERSION}/${userId}/threads`, {
    media_type: 'TEXT',
    text,
    access_token: accessToken,
  });
}

// ---------- 画像・動画の投稿 ----------
//
// 画像 : media_type=IMAGE + image_url
// 動画 : media_type=VIDEO + video_url（変換が終わるまで公開できない）
// 複数 : 子を is_carousel_item=true で作り、media_type=CAROUSEL + children でまとめる（2〜20枚）

/** 画像1枚・動画1本のコンテナを作る。カルーセルの子にもこれを使う。 */
export function createMediaContainer({ accessToken, userId, kind, url, text, isCarouselItem = false }) {
  const params = {
    media_type: kind === 'video' ? 'VIDEO' : 'IMAGE',
    [kind === 'video' ? 'video_url' : 'image_url']: url,
    access_token: accessToken,
  };
  if (isCarouselItem) params.is_carousel_item = 'true';
  else params.text = text;
  return post(`/${GRAPH_VERSION}/${userId}/threads`, params);
}

/** 複数枚をまとめるコンテナを作る。 */
export function createCarouselContainer({ accessToken, userId, childIds, text }) {
  return post(`/${GRAPH_VERSION}/${userId}/threads`, {
    media_type: 'CAROUSEL',
    children: childIds.join(','),
    text,
    access_token: accessToken,
  });
}

/** コンテナの状態。FINISHED になるまで公開できない。 */
export function getContainerStatus({ accessToken, containerId }) {
  return get(`/${GRAPH_VERSION}/${containerId}`, {
    fields: 'status,error_message',
    access_token: accessToken,
  });
}

/** コンテナを公開（2段階目）。 */
export function publishContainer({ accessToken, userId, creationId }) {
  return post(`/${GRAPH_VERSION}/${userId}/threads_publish`, {
    creation_id: creationId,
    access_token: accessToken,
  });
}

/** 投稿済みスレッドの情報を取得。 */
export function getThread({ accessToken, threadId, fields = 'id,permalink,text,timestamp,media_type' }) {
  return get(`/${GRAPH_VERSION}/${threadId}`, { fields, access_token: accessToken });
}

/** 自分の投稿を削除する。threads_delete が必要。 */
export async function deleteThread({ accessToken, threadId }) {
  const url = new URL(`${GRAPH_BASE}/${GRAPH_VERSION}/${threadId}`);
  url.searchParams.set('access_token', accessToken);
  const res = await fetch(url, { method: 'DELETE' });
  return parseResponse(res, `DELETE /${threadId}`);
}

/** 「メディアの準備がまだ」を表すサブコード。少し待ってやり直せばよい。 */
export const MEDIA_NOT_READY_SUBCODE = 4279009;
