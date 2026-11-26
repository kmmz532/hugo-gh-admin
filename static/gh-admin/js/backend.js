// 画面の JS は保存先（GitHub・GitLab）の API をこのモジュール経由でのみ呼ぶ。
// 保存先は params.ghAdmin.provider で選ぶ（github または gitlab）。
import { config } from './config.js';
import * as github from './providers/github.js';
import * as gitlab from './providers/gitlab.js';
import { getToken, saveSession, isLocalHost, ensureSessionToken } from './core.js';

export {
  repo, branch, ConflictError, getToken, getLogin, saveSession, clearSession, isLocalHost, isValidSlug,
  pageId, isPageId, isValidPageSlug,
} from './core.js';

const provider = config.provider === 'gitlab' ? gitlab : github;

export const {
  AUTHOR_RE, COMMITS_PER_PAGE, getPost, listPostCommits, savePost, deletePost, commitChanges,
  saveImage, listImages, deleteImage, rawImageUrl, checkRepoPush, fetchLogin, siteFiles, startBuild,
} = provider;

// npm run dev が BLOG_DEV_TOKEN を渡されているときだけ、localhost でトークンを受け取って保存する。
// 本番のドメインでは何もしない。取れなければ通常どおりログイン画面を使う。
const DEV_SESSION_URL = 'http://127.0.0.1:1314/session';

export async function ensureDevSession() {
  await ensureSessionToken();
  if (!isLocalHost || getToken()) return;
  try {
    const res = await fetch(DEV_SESSION_URL, { cache: 'no-store' });
    if (!res.ok) return;
    const { token } = await res.json();
    if (token) saveSession(token, await fetchLogin(token));
  } catch {
    // dev サーバーが無い・トークンが不正なときは、手動ログインに任せる
  }
}
