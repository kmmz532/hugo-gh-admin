// GitHub・GitLab のアダプタ（providers/*.js）が共通で使う部分。画面の JS は backend.js 経由で読む。
import { config, escapeRe } from './config.js';
import { getItem, setItem } from './storage.js';
import { TOKEN_KEY, LOGIN_KEY, getSessionToken, setSessionToken, clearStoredSession } from './session.js';
import { t } from './i18n.js';

const SLUG_RE = /^[a-z0-9-]{1,80}$/;
// 画像は記事のリポジトリの static/images/<yyyy>/<8文字>.<ext> に置く
export const IMAGE_PATH_RE = new RegExp(`^${escapeRe(config.imagesDir)}/\\d{4}/[a-z0-9]{8}\\.(webp|png|jpg|gif|svg)$`);
// リポジトリ内のパス（static/images/...）と記事に書く公開パス（/images/...）の相互変換
export const toPublicPath = (path) => config.imagesURL + path.slice(config.imagesDir.length + 1);
export const toRepoPath = (publicPath) => `${config.imagesDir}/${publicPath.slice(config.imagesURL.length)}`;

export const repo = config.repo ?? '';
export const branch = config.branch ?? '';

export class ConflictError extends Error {}

// API がエラーを返したとき。status は HTTP のステータス、detail は API が返したメッセージ
export class ApiError extends Error {
  constructor(message, status, detail) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

// tokenProvider（サイトが用意する受け取り口）を設定したときは、そこから受け取ったトークンを優先する。タブを閉じると消える（sessionStorage）
const PROVIDER_PATH = config.tokenProvider ?? '';
export const getToken = () => (PROVIDER_PATH ? getSessionToken() : null) || getItem(TOKEN_KEY);
export const getLogin = () => getItem(LOGIN_KEY);

export function saveSession(token, login) {
  if (!(setItem(TOKEN_KEY, token) && setItem(LOGIN_KEY, login))) {
    throw new Error(t('error.storage_write'));
  }
}

export function clearSession() {
  clearStoredSession();
}

export const isLocalHost = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

// tokenProvider のモジュールは getGitHubToken()（GitLab では getGitLabToken()）を持つ
export async function ensureSessionToken() {
  if (!PROVIDER_PATH || getSessionToken()) return;
  try {
    const provider = await import(PROVIDER_PATH);
    const token = await (config.provider === 'gitlab' ? provider.getGitLabToken() : provider.getGitHubToken());
    if (token) setSessionToken(token);
  } catch (e) {
    console.warn(t('error.token_provider'), e);
  }
}

export const isValidSlug = (slug) => SLUG_RE.test(slug);

// 固定ページは「page:<slug>」の識別子で扱う。
// 記事の slug は英小文字・数字・ハイフンだけなので、記事と衝突しない
const PAGE_PREFIX = 'page:';
export const pageId = (slug) => PAGE_PREFIX + slug;
export const isPageId = (id) => id.startsWith(PAGE_PREFIX);
// 既存の URL（管理画面・検索・一覧など）と重なるため、固定ページに使えない slug
export const RESERVED_PAGE_SLUGS = ['admin', 'edit', 'login', 'search', 'archives', 'tags', 'categories', 'posts', 'page', 'images', 'lib', 'gh-admin', 'oauth', 'index'];
export const isValidPageSlug = (slug) => isValidSlug(slug) && !RESERVED_PAGE_SLUGS.includes(slug);

export function postPath(id) {
  if (isPageId(id)) {
    const slug = id.slice(PAGE_PREFIX.length);
    if (!isValidPageSlug(slug)) throw new Error(t('error.invalid_slug'));
    return `${config.pagesDir}/${slug}.md`;
  }
  if (!isValidSlug(id)) {
    throw new Error(t('error.invalid_slug'));
  }
  return `${config.postsDir}/${id}.md`;
}

// btoa / atob 単体は日本語で壊れるので UTF-8 バイト列を経由する
export function toBase64(text) {
  let bin = '';
  for (const byte of new TextEncoder().encode(text)) bin += String.fromCharCode(byte);
  return btoa(bin);
}

export function fromBase64(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

function redirectToLogin() {
  const ret = encodeURIComponent(location.pathname + location.search);
  location.href = `${config.loginURL}?return=${ret}`;
}

const errorMessage = (json) =>
  typeof json.message === 'string' ? json.message : JSON.stringify(json.message ?? json.error ?? '');

// API を呼ぶ。token を省略すると保存済みトークンを使う。GET の 404 は null を返す。
// headers: 追加のヘッダー。isConflict(status, message): 409・422 以外に ConflictError とする応答。
// session: false のときは、401 でも保存済みのログインを消さない（サイト設定の画面で使う）。
// withHeaders: true のときは { json, headers } を返す
export async function request(url, { method = 'GET', headers = {}, body, token = getToken(), isConflict = () => false, session = true, withHeaders = false } = {}) {
  const sent = { Authorization: `Bearer ${token}`, ...headers };
  if (body) sent['Content-Type'] = 'application/json';

  const res = await fetch(url, {
    method,
    headers: sent,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });

  // 失効した保存済みトークンは捨ててログインし直してもらう。
  // ログイン画面で入力中のトークンが弾かれたときは呼び出し側にエラーを返す。
  if (session && res.status === 401 && token === getToken()) {
    clearSession();
    redirectToLogin();
    throw new Error(t('error.session_expired'));
  }
  if (res.status === 404 && method === 'GET') return null;

  const json = await res.json().catch(() => ({}));
  const detail = errorMessage(json);
  if (res.status === 409 || res.status === 422 || isConflict(res.status, detail)) {
    throw new ConflictError(t('error.conflict', { status: res.status }));
  }
  if (!res.ok) {
    throw new ApiError(t('error.api', { status: res.status, message: detail }).trim(), res.status, detail);
  }
  return withHeaders ? { json, headers: res.headers } : json;
}
