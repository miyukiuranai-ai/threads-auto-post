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

/**
 * 投稿ごとの反応（いいね・表示数など）。threads_manage_insights の権限が必要。
 * 権限が無いトークンではエラーになるので、呼び出し側で理由を出すこと。
 */
export function getThreadInsights({ accessToken, threadId, metrics = 'likes,views,replies,reposts,quotes' }) {
  return get(`/${GRAPH_VERSION}/${threadId}/insights`, { metric: metrics, access_token: accessToken });
}

/** インサイトの返事を { likes: 12, views: 300, ... } の形にする。 */
export function parseInsights(res) {
  const out = {};
  for (const item of res?.data ?? []) {
    const name = String(item?.name ?? '');
    // 指標によって values[0].value か total_value.value に入る
    const value = item?.values?.[0]?.value ?? item?.total_value?.value;
    if (name && Number.isFinite(Number(value))) out[name] = Number(value);
  }
  return out;
}

/** 権限が足りないためのエラーか（案内の出し分けに使う）。 */
export function isPermissionError(err) {
  const body = err?.body?.error ?? {};
  if (body.code === 10 || body.code === 200 || body.type === 'OAuthException') return true;
  return /permission|scope|insights/i.test(String(err?.message ?? ''));
}

/** その投稿に付いた返信（コメント）を、新しい順に取る。threads_read_replies が要る。 */
export async function getReplies({ accessToken, threadId, limit = 50 }) {
  const fields = 'id,text,username,timestamp,permalink,has_replies,is_reply,hide_status';
  const json = await get(`/${GRAPH_VERSION}/${threadId}/replies`, {
    fields,
    reverse: 'false',
    limit,
    access_token: accessToken,
  });
  return Array.isArray(json.data) ? json.data : [];
}

/**
 * 自分の投稿に返信する。
 * 作ってすぐは公開できないことがあるので、少し待ってから公開し、だめなら数回やり直す。
 */
export async function createReply({ accessToken, userId, text, replyToId, waitMs = 5000, attempts = 3 }) {
  const container = await post(`/${GRAPH_VERSION}/${userId}/threads`, {
    media_type: 'TEXT',
    text,
    reply_to_id: replyToId,
    access_token: accessToken,
  });

  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    await new Promise((r) => setTimeout(r, waitMs * (i + 1)));
    try {
      return await post(`/${GRAPH_VERSION}/${userId}/threads_publish`, {
        creation_id: container.id,
        access_token: accessToken,
      });
    } catch (err) {
      lastError = err;
      // まだ用意ができていない場合だけやり直す
      if (err.body?.error?.error_subcode !== MEDIA_NOT_READY_SUBCODE) throw err;
    }
  }
  throw lastError;
}

// ---------- 他のアカウントを調べる（審査が要るかもしれない権限） ----------
//
// 競合がどう運用しているかを見るためのもの。
// どちらも開発モードのまま使えるかどうかは、実際に叩いて確かめること（npm run threads:check）。

/** 公開投稿をキーワードで探す。threads_keyword_search が必要。 */
export function keywordSearch({ accessToken, query, searchType = 'TOP', searchMode = 'KEYWORD', limit = 25, after }) {
  return get(`/${GRAPH_VERSION}/keyword_search`, {
    q: query,
    // search_mode は KEYWORD か TAG のみ。省くと弾かれる
    search_mode: searchMode,
    search_type: searchType,
    fields: 'id,text,media_type,permalink,timestamp,username,has_replies,is_quote_post,is_reply',
    limit,
    after,
    access_token: accessToken,
  });
}

/** 公開アカウントのプロフィール。threads_profile_discovery が必要。 */
export function profileLookup({ accessToken, username }) {
  return get(`/${GRAPH_VERSION}/profile_lookup`, {
    username,
    fields: 'id,username,name,follower_count,biography,is_verified',
    access_token: accessToken,
  });
}

/** 自分の投稿の一覧。分析の下地に使う。 */
export function listMyThreads({ accessToken, userId, limit = 25, since, until, after }) {
  return get(`/${GRAPH_VERSION}/${userId}/threads`, {
    fields: 'id,media_type,text,permalink,timestamp',
    limit,
    since,
    until,
    after,
    access_token: accessToken,
  });
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
